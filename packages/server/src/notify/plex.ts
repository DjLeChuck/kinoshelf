import { XMLParser } from 'fast-xml-parser';
import type { DeliveryResult } from './delivery.js';
import type { HttpRequest } from './formats.js';
import {
  foldTitle,
  pickCollection,
  type CollectionImage,
  type CollectionImageServer,
  type CollectionImageType,
  type CollectionTarget,
  type FoundCollection,
} from './collection-images.js';
import { isInside, mapPath, type PathMapping } from './paths.js';

/** What a call adds to a plain read. */
interface RequestInit {
  readonly method?: HttpRequest['method'];
  readonly body?: Uint8Array;
  readonly headers?: Record<string, string>;
}

export type Send = (request: HttpRequest) => Promise<DeliveryResult>;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RefreshTarget {
  readonly path: string;
  readonly kind: 'movie' | 'series';
}

export interface RefreshReport {
  readonly refreshed: number;
  readonly skipped: string[];
  readonly failed: string[];
}

export interface PlexSection {
  readonly key: string;
  /** `movie`, `show`, `artist`… */
  readonly type: string;
  readonly locations: readonly string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'Directory' || name === 'Location' || name === 'Video',
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** The libraries of `GET /library/sections` (XML by default), with their folders. */
export function parseSections(xml: string): PlexSection[] {
  const container = asRecord(asRecord(parser.parse(xml) as unknown).MediaContainer);
  const directories = Array.isArray(container.Directory) ? (container.Directory as unknown[]) : [];
  return directories.map((directory) => {
    const section = asRecord(directory);
    const locations = Array.isArray(section.Location) ? (section.Location as unknown[]) : [];
    return {
      key: String(section['@_key']),
      type: String(section['@_type']),
      locations: locations.map((location) => String(asRecord(location)['@_path'])),
    };
  });
}

/** An XML attribute as text: the parser reads a number as one. */
const attribute = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** The collections of `GET /library/sections/{key}/collections`: Plex's own key and the title. */
export function parseCollections(xml: string): { id: string; title: string }[] {
  const container = asRecord(asRecord(parser.parse(xml) as unknown).MediaContainer);
  const directories = Array.isArray(container.Directory) ? (container.Directory as unknown[]) : [];
  return directories.flatMap((directory) => {
    const entry = asRecord(directory);
    const id = attribute(entry['@_ratingKey']);
    return id === '' ? [] : [{ id, title: attribute(entry['@_title']) }];
  });
}

/** The titles of a collection's movies (`GET /library/collections/{key}/children`). */
export function parseChildren(xml: string): string[] {
  const container = asRecord(asRecord(parser.parse(xml) as unknown).MediaContainer);
  const videos = Array.isArray(container.Video) ? (container.Video as unknown[]) : [];
  return videos.map((video) => attribute(asRecord(video)['@_title']));
}

/** Above this many folders one scan of the whole library is cheaper than as many partial ones. */
export const MAX_PARTIAL_SCANS = 20;
const SECTIONS_TTL_MS = 10 * 60_000;

const PLEX_TYPE = { movie: 'movie', series: 'show' } as const;

/** Where the token comes from when it is not typed: signed-in tokens last a week and are renewed. */
export interface PlexTokenSource {
  token(): Promise<string | undefined>;
  /** A new token after the server refused the last one; `undefined` when there is none. */
  renew(): Promise<string | undefined>;
}

export interface PlexOptions {
  readonly url: string;
  readonly token: string | PlexTokenSource;
  /** The library to scan, when it should not be found by the folder. */
  readonly section?: number | undefined;
  readonly paths?: readonly PathMapping[] | undefined;
}

/**
 * Asks Plex to look at the folders a transfer wrote to (the documented `path` parameter of a
 * library refresh), which is far lighter than scanning everything. Plex only knows its own view of
 * the disk, so each folder is translated first. The library is the one of the right type (a movie
 * goes to a movie library) whose folder holds the path, the deepest folder winning: two libraries
 * may share one, as an "optimized versions" folder does.
 */
export class PlexClient implements CollectionImageServer {
  readonly kind = 'plex';
  private sections: { at: number; list: PlexSection[] } | undefined;
  /** Why the libraries could not be listed last time, so a caller can say it rather than "none holds it". */
  private listError: string | undefined;

  constructor(
    private readonly options: PlexOptions,
    private readonly send: Send,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Used by the test endpoint: can Plex be reached, and does it accept the token? */
  async check(): Promise<DeliveryResult & { sections?: number }> {
    const result = await this.request('/library/sections');
    return result.ok && result.text !== undefined
      ? { ...result, sections: parseSections(result.text).length }
      : result;
  }

  /**
   * The collection by its name, in the section holding the library's folder. Two of the same
   * name (it happens) are told apart by the movies they hold.
   */
  async find(target: CollectionTarget): Promise<FoundCollection> {
    const path = mapPath(target.libraryPath, this.options.paths);
    if (path === undefined) {
      return { status: 'error', error: 'no path mapping' };
    }
    const section = await this.sectionFor(path, 'movie');
    if (section === undefined) {
      return {
        status: 'error',
        error:
          this.listError === undefined
            ? 'no movie library holds the folder'
            : `could not list the libraries (${this.listError})`,
      };
    }
    const listed = await this.request(`/library/sections/${section}/collections`);
    if (!listed.ok || listed.text === undefined) {
      return { status: 'error', error: listed.error ?? `HTTP ${String(listed.status)}` };
    }
    const name = foldTitle(target.name);
    const named = parseCollections(listed.text).filter(({ title }) => foldTitle(title) === name);
    if (named.length === 0) {
      return { status: 'missing' };
    }
    const candidates = await Promise.all(
      named.map(async ({ id }) => {
        // A lone collection of that name needs no telling apart.
        if (named.length === 1) {
          return { id, titles: [] as string[] };
        }
        const children = await this.request(`/library/collections/${id}/children`);
        return { id, titles: children.text === undefined ? [] : parseChildren(children.text) };
      }),
    );
    const id = pickCollection(candidates, target.titles);
    return id === undefined ? { status: 'missing' } : { status: 'found', id };
  }

  /**
   * Uploads the image as the collection's poster or background. Plex makes an uploaded image the
   * selected one (python-plexapi relies on that too), so there is no second call to choose it.
   */
  upload(id: string, type: CollectionImageType, image: CollectionImage): Promise<DeliveryResult> {
    return this.request(`/library/metadata/${id}/${type === 'poster' ? 'posters' : 'arts'}`, {
      method: 'POST',
      body: image.bytes,
      headers: { 'Content-Type': image.mime },
    });
  }

  async refresh(targets: readonly RefreshTarget[]): Promise<RefreshReport> {
    const report = { refreshed: 0, skipped: [] as string[], failed: [] as string[] };
    const resolved: { path: string; section: string }[] = [];

    for (const target of targets) {
      const path = mapPath(target.path, this.options.paths);
      if (path === undefined) {
        this.log.warn(`Plex: no path mapping covers ${target.path}`);
        report.skipped.push(target.path);
        continue;
      }
      const section = await this.sectionFor(path, target.kind);
      if (section === undefined) {
        this.log.warn(`Plex: no ${PLEX_TYPE[target.kind]} library holds ${path}`);
        report.skipped.push(target.path);
        continue;
      }
      resolved.push({ path, section });
    }

    const whole = resolved.length > MAX_PARTIAL_SCANS;
    const calls = whole
      ? [...new Set(resolved.map((r) => r.section))].map((section) => ({
          section,
          path: undefined,
        }))
      : resolved;
    for (const { section, path } of calls) {
      const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`;
      const result = await this.request(`/library/sections/${section}/refresh${query}`);
      if (result.ok) {
        report.refreshed++;
      } else {
        report.failed.push(path ?? `section ${section}`);
        this.log.warn(
          `Plex: refresh of ${path ?? `section ${section}`} failed (${result.error ?? result.status})`,
        );
        if (result.status === 404) {
          this.sections = undefined; // the libraries may have changed
        }
      }
    }
    return report;
  }

  private async sectionFor(path: string, kind: RefreshTarget['kind']): Promise<string | undefined> {
    if (this.options.section !== undefined) {
      return String(this.options.section);
    }
    const wanted = PLEX_TYPE[kind];
    let best: { key: string; length: number } | undefined;
    for (const section of await this.listSections()) {
      if (section.type !== wanted) {
        continue;
      }
      for (const location of section.locations) {
        if (isInside(path, location) && location.length > (best?.length ?? -1)) {
          best = { key: section.key, length: location.length };
        }
      }
    }
    return best?.key;
  }

  private async listSections(): Promise<PlexSection[]> {
    if (this.sections && this.now() - this.sections.at < SECTIONS_TTL_MS) {
      return this.sections.list;
    }
    const result = await this.request('/library/sections');
    if (!result.ok || result.text === undefined) {
      this.listError = result.error ?? `HTTP ${String(result.status)}`;
      this.log.warn(`Plex: could not list the libraries (${this.listError})`);
      return [];
    }
    this.listError = undefined;
    this.sections = { at: this.now(), list: parseSections(result.text) };
    return this.sections.list;
  }

  /**
   * One call to the server. A refused token is renewed and the call made again, once: a media
   * server may drop a token plex.tv still counts good (it was revoked, or the server restarted).
   */
  private async request(path: string, init: RequestInit = {}): Promise<DeliveryResult> {
    const source = this.options.token;
    const first = typeof source === 'string' ? source : await source.token();
    if (first === undefined) {
      return { ok: false, attempts: 0, error: 'not signed in' };
    }
    const result = await this.send(this.get(path, first, init));
    if (result.status !== 401 || typeof source === 'string') {
      return result;
    }
    const renewed = await source.renew();
    return renewed === undefined || renewed === first
      ? result
      : this.send(this.get(path, renewed, init));
  }

  private get(path: string, token: string, init: RequestInit): HttpRequest {
    return {
      method: init.method ?? 'GET',
      url: `${this.options.url.replace(/\/+$/, '')}${path}`,
      headers: { 'X-Plex-Token': token, Accept: 'application/xml', ...init.headers },
      ...(init.body !== undefined && { body: init.body }),
    };
  }
}
