import { XMLParser } from 'fast-xml-parser';
import type { DeliveryResult } from './delivery.js';
import type { HttpRequest } from './formats.js';
import { isInside, mapPath, type PathMapping } from './paths.js';

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
  isArray: (name) => name === 'Directory' || name === 'Location',
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

/** Above this many folders one scan of the whole library is cheaper than as many partial ones. */
export const MAX_PARTIAL_SCANS = 20;
const SECTIONS_TTL_MS = 10 * 60_000;

const PLEX_TYPE = { movie: 'movie', series: 'show' } as const;

export interface PlexOptions {
  readonly url: string;
  readonly token: string;
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
export class PlexClient {
  private sections: { at: number; list: PlexSection[] } | undefined;

  constructor(
    private readonly options: PlexOptions,
    private readonly send: Send,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Used by the test endpoint: can Plex be reached, and does it accept the token? */
  async check(): Promise<DeliveryResult & { sections?: number }> {
    const result = await this.send(this.get('/library/sections'));
    return result.ok && result.text !== undefined
      ? { ...result, sections: parseSections(result.text).length }
      : result;
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
      const result = await this.send(this.get(`/library/sections/${section}/refresh${query}`));
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
    const result = await this.send(this.get('/library/sections'));
    if (!result.ok || result.text === undefined) {
      this.log.warn(`Plex: could not list the libraries (${result.error ?? result.status})`);
      return [];
    }
    this.sections = { at: this.now(), list: parseSections(result.text) };
    return this.sections.list;
  }

  private get(path: string): HttpRequest {
    return {
      method: 'GET',
      url: `${this.options.url.replace(/\/+$/, '')}${path}`,
      headers: { 'X-Plex-Token': this.options.token, Accept: 'application/xml' },
    };
  }
}
