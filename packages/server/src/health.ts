import { stat } from 'node:fs/promises';
import type { Config, Database } from '@kinoshelf/core';
import type { PlexSession } from './plex-session.js';
import type { FolderWatcher } from './watcher.js';

/** Where a problem sits: the Health card it is shown on. */
export type HealthArea = 'ffprobe' | 'database' | 'disk' | 'watch' | 'media' | 'webhooks';

/** Something the person has to fix: the server cannot do its job until they do. */
export interface HealthProblem {
  readonly area: HealthArea;
  /** Stable, translated at the edge (`web.health.problem.<code>`). */
  readonly code:
    | 'database-unreadable'
    | 'library-unreachable'
    | 'watch-folder-unreachable'
    | 'plex-signed-out'
    // Warnings, found by the report (they cost a disk read or a probe): never in the verdict.
    | 'ffprobe-missing'
    | 'disk-low'
    | 'webhook-failing'
    | 'media-refresh-failed';
  readonly params?: Readonly<Record<string, string>>;
}

export interface HealthDeps {
  readonly database: Database;
  readonly config: () => Config;
  readonly watcher: FolderWatcher;
  readonly plexSession: PlexSession;
  /** Told when the number of errors changes, for the clients' badge. */
  readonly changed: () => void;
}

/** A share that went away is noticed within the minute, with no event to say so. */
const RECHECK_MS = 60_000;

/**
 * The server's verdict, light enough to be read often: only what is wrong enough to be an error
 * (a warning, such as a disk filling up, never turns the badge red), and no disk space, whose
 * cost would be paid at each event. The Health page asks for the details itself.
 */
export class Health {
  private known: number | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: HealthDeps) {}

  async problems(): Promise<HealthProblem[]> {
    const { config, watcher, plexSession, database } = this.deps;
    const found: HealthProblem[] = [];

    try {
      database.prepare('SELECT 1').get();
    } catch {
      found.push({ area: 'database', code: 'database-unreadable' });
    }

    const current = config();
    const sources = await Promise.all(
      (current.libraries ?? []).map(async (library) => ({
        library,
        readable: await stat(library.source).then(
          (info) => info.isDirectory(),
          () => false,
        ),
      })),
    );
    for (const { library, readable } of sources) {
      if (!readable) {
        found.push({
          area: 'disk',
          code: 'library-unreachable',
          params: { name: library.name, path: library.source },
        });
      }
    }

    // `available` is only known once the watcher has looked: until then, nothing to report.
    const { folders, lastScanAt } = watcher.status();
    for (const folder of folders) {
      if (lastScanAt !== null && !folder.available) {
        found.push({
          area: 'watch',
          code: 'watch-folder-unreachable',
          params: { path: folder.path },
        });
      }
    }

    // Only matters to someone who asks Plex to refresh with that sign-in.
    if (current.notify?.plex && plexSession.account.error) {
      found.push({ area: 'media', code: 'plex-signed-out' });
    }
    return found;
  }

  /** Reads the verdict again, and tells the clients if the number of errors is not the same. */
  async check(): Promise<number> {
    const { length } = await this.problems();
    if (this.known !== undefined && this.known !== length) {
      this.deps.changed();
    }
    this.known = length;
    return length;
  }

  start(): void {
    this.stop();
    void this.check();
    this.timer = setInterval(() => void this.check(), RECHECK_MS).unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
