import type { DeliveryResult } from './delivery.js';
import type { HttpRequest } from './formats.js';
import { mapPath, type PathMapping } from './paths.js';
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

/**
 * Tells Jellyfin which paths were created (`POST /Library/Media/Updated`), which is lighter than a
 * full scan; past a few folders one `POST /Library/Refresh` is cheaper. The key goes in the
 * `Authorization` header: the older `X-Emby-Token` and `api_key` forms are deprecated.
 */
export class JellyfinClient {
  constructor(
    private readonly options: JellyfinOptions,
    private readonly send: Send,
    private readonly log: Logger,
  ) {}

  /** Used by the test endpoint: can Jellyfin be reached, and does it accept the key? */
  check(): Promise<DeliveryResult> {
    return this.send(this.request('GET', '/Library/VirtualFolders'));
  }

  async refresh(targets: readonly RefreshTarget[]): Promise<RefreshReport> {
    const report = { refreshed: 0, skipped: [] as string[], failed: [] as string[] };
    const paths: string[] = [];
    for (const target of targets) {
      const path = mapPath(target.path, this.options.paths);
      if (path === undefined) {
        this.log.warn(`Jellyfin: no path mapping covers ${target.path}`);
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
      this.log.warn(`Jellyfin: refresh failed (${result.error ?? result.status})`);
    }
    return report;
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
