import {
  foldTitle,
  pickCollection,
  type CollectionImage,
  type CollectionImageServer,
  type CollectionImageType,
  type CollectionTarget,
  type FoundCollection,
} from './collection-images.js';
import type { DeliveryResult } from './delivery.js';
import type { HttpRequest } from './formats.js';
import { isInside, mapPath, type PathMapping } from './paths.js';
import {
  MAX_PARTIAL_SCANS,
  type Logger,
  type RefreshReport,
  type RefreshTarget,
  type Send,
} from './plex.js';

export interface JellyfinOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly paths?: readonly PathMapping[] | undefined;
}

export interface JellyfinLibrary {
  readonly name: string;
  /** `movies`, `tvshows`, `music`…; `null` for a library of mixed content. */
  readonly type: string | null;
  readonly locations: readonly string[];
}

const LIBRARIES_TTL_MS = 10 * 60_000;

const JELLYFIN_TYPE = { movie: 'movies', series: 'tvshows' } as const;

/** The libraries of `GET /Library/VirtualFolders`, with their folders. */
export function parseLibraries(json: string): JellyfinLibrary[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((item: unknown) => {
    const folder = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    const locations = Array.isArray(folder.Locations) ? (folder.Locations as unknown[]) : [];
    return {
      name: typeof folder.Name === 'string' ? folder.Name : '',
      type: typeof folder.CollectionType === 'string' ? folder.CollectionType : null,
      locations: locations.filter((location): location is string => typeof location === 'string'),
    };
  });
}

/** The `Items` of a Jellyfin answer: their id and name. */
export function parseItems(json: string): { id: string; name: string }[] {
  const parsed: unknown = JSON.parse(json);
  const items = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as {
    Items?: unknown;
  };
  return (Array.isArray(items.Items) ? (items.Items as unknown[]) : []).flatMap((item) => {
    const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    return typeof entry.Id === 'string' && typeof entry.Name === 'string'
      ? [{ id: entry.Id, name: entry.Name }]
      : [];
  });
}

/**
 * Tells Jellyfin which paths were created (`POST /Library/Media/Updated`), which is lighter than a
 * full scan; past a few folders one `POST /Library/Refresh` is cheaper. The key goes in the
 * `Authorization` header: the older `X-Emby-Token` and `api_key` forms are deprecated.
 *
 * Jellyfin answers success for any path, even one that is in no library, so a wrong path mapping
 * would go unnoticed. Each path is therefore checked against the libraries first (of the right
 * type, a movie going to a movie library), and reported when none holds it.
 */
export class JellyfinClient implements CollectionImageServer {
  readonly kind = 'jellyfin';
  private libraries: { at: number; list: JellyfinLibrary[] } | undefined;

  constructor(
    private readonly options: JellyfinOptions,
    private readonly send: Send,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Used by the test endpoint: can Jellyfin be reached, and does it accept the key? */
  check(): Promise<DeliveryResult> {
    return this.send(this.request('GET', '/Library/VirtualFolders'));
  }

  /**
   * A collection is a `BoxSet`, which Jellyfin keeps in a library of its own rather than in the
   * movie library, so it is searched by name across the server. `SearchTerm` is a fuzzy match: the
   * name is compared again here, and two of the same name are told apart by their movies.
   */
  async find(target: CollectionTarget): Promise<FoundCollection> {
    const query = new URLSearchParams({
      IncludeItemTypes: 'BoxSet',
      Recursive: 'true',
      SearchTerm: target.name,
    });
    const listed = await this.send(this.request('GET', `/Items?${query.toString()}`));
    if (!listed.ok || listed.text === undefined) {
      return { status: 'error', error: listed.error ?? `HTTP ${String(listed.status)}` };
    }
    const name = foldTitle(target.name);
    const found = parseItems(listed.text);
    const named = found.filter((item) => foldTitle(item.name) === name);
    if (named.length === 0) {
      // Said once, so "Jellyfin has none" and "it has one under another name" can be told apart.
      this.log.info(
        `Jellyfin: no box set named "${target.name}" (the search found ${
          found.length === 0 ? 'none' : found.map((item) => `"${item.name}"`).join(', ')
        })`,
      );
      return { status: 'missing' };
    }
    const candidates = await Promise.all(
      named.map(async ({ id }) => {
        if (named.length === 1) {
          return { id, titles: [] as string[] };
        }
        const children = await this.send(
          this.request('GET', `/Items?${new URLSearchParams({ ParentId: id }).toString()}`),
        );
        return {
          id,
          titles: children.text === undefined ? [] : parseItems(children.text).map((i) => i.name),
        };
      }),
    );
    const id = pickCollection(candidates, target.titles);
    return id === undefined ? { status: 'missing' } : { status: 'found', id };
  }

  /**
   * Jellyfin takes the image as base64 text with the image's own `Content-Type`. A backdrop is
   * *added* to the ones there, so the first one is deleted beforehand: the new one takes its place.
   * A later "replace all images" refresh of the collection's metadata fetches Jellyfin's own again
   * and drops this one: Kinoshelf does not see it, the image is sent again by hand.
   */
  async upload(
    id: string,
    type: CollectionImageType,
    image: CollectionImage,
  ): Promise<DeliveryResult> {
    if (type === 'fanart') {
      // Nothing to delete is an answer too: only the upload's counts.
      await this.send(this.request('DELETE', `/Items/${encodeURIComponent(id)}/Images/Backdrop/0`));
    }
    return this.send({
      ...this.request(
        'POST',
        `/Items/${encodeURIComponent(id)}/Images/${type === 'poster' ? 'Primary' : 'Backdrop'}`,
        Buffer.from(image.bytes).toString('base64'),
      ),
      headers: {
        Authorization: `MediaBrowser Token="${this.options.apiKey}"`,
        'content-type': image.mime,
      },
    });
  }

  async refresh(targets: readonly RefreshTarget[]): Promise<RefreshReport> {
    const report = { refreshed: 0, skipped: [] as string[], failed: [] as string[] };
    const libraries = await this.listLibraries();
    const paths: string[] = [];
    for (const target of targets) {
      const path = mapPath(target.path, this.options.paths);
      if (path === undefined) {
        this.log.warn(`Jellyfin: no path mapping covers ${target.path}`);
        report.skipped.push(target.path);
      } else if (libraries && !holds(libraries, path, target.kind)) {
        this.log.warn(`Jellyfin: no ${JELLYFIN_TYPE[target.kind]} library holds ${path}`);
        report.skipped.push(target.path);
      } else {
        paths.push(path);
      }
    }
    if (paths.length === 0) {
      return report;
    }

    const whole = paths.length > MAX_PARTIAL_SCANS;
    const result = await this.send(
      whole
        ? this.request('POST', '/Library/Refresh')
        : this.request(
            'POST',
            '/Library/Media/Updated',
            JSON.stringify({ Updates: paths.map((Path) => ({ Path, UpdateType: 'Created' })) }),
          ),
    );
    if (result.ok) {
      report.refreshed = whole ? 1 : paths.length;
    } else {
      report.failed.push(...paths);
      this.libraries = undefined; // the libraries may have changed
      this.log.warn(`Jellyfin: refresh failed (${result.error ?? result.status})`);
    }
    return report;
  }

  /** `undefined` when they cannot be listed: the paths are then sent unchecked. */
  private async listLibraries(): Promise<JellyfinLibrary[] | undefined> {
    if (this.libraries && this.now() - this.libraries.at < LIBRARIES_TTL_MS) {
      return this.libraries.list;
    }
    const result = await this.send(this.request('GET', '/Library/VirtualFolders'));
    if (!result.ok || result.text === undefined) {
      this.log.warn(
        `Jellyfin: could not list the libraries, paths are sent unchecked (${result.error ?? result.status})`,
      );
      return undefined;
    }
    this.libraries = { at: this.now(), list: parseLibraries(result.text) };
    return this.libraries.list;
  }

  private request(method: HttpRequest['method'], path: string, body?: string): HttpRequest {
    return {
      method,
      url: `${this.options.url.replace(/\/+$/, '')}${path}`,
      headers: {
        Authorization: `MediaBrowser Token="${this.options.apiKey}"`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body }),
    };
  }
}

/** A library of the right type holds the path; one of mixed content takes anything. */
function holds(
  libraries: readonly JellyfinLibrary[],
  path: string,
  kind: RefreshTarget['kind'],
): boolean {
  return libraries.some(
    (library) =>
      (library.type === null || library.type === JELLYFIN_TYPE[kind]) &&
      library.locations.some((location) => isInside(path, location)),
  );
}
