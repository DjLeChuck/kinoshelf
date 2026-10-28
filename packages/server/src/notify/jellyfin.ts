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

/**
 * Tells Jellyfin which paths were created (`POST /Library/Media/Updated`), which is lighter than a
 * full scan; past a few folders one `POST /Library/Refresh` is cheaper. The key goes in the
 * `Authorization` header: the older `X-Emby-Token` and `api_key` forms are deprecated.
 *
 * Jellyfin answers success for any path, even one that is in no library, so a wrong path mapping
 * would go unnoticed. Each path is therefore checked against the libraries first (of the right
 * type, a movie going to a movie library), and reported when none holds it.
 */
export class JellyfinClient {
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

  private request(method: 'GET' | 'POST', path: string, body?: string): HttpRequest {
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
