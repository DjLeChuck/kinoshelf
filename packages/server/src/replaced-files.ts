import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@kinoshelf/core';
import type { FastifyBaseLogger } from 'fastify';
import { ApiError } from './api-error.js';
import { failureOf, type MatchFailure } from './matches.js';
import type { ProgressTracker } from './progress.js';

const DAY_MS = 86_400_000;

/** A file kept in `<config>/replaced/`, with what the journal says of it. */
interface ReplacedFile {
  readonly path: string;
  readonly bytes: number;
  /** When it was set aside: the journal's date, else the file's own change time (a leftover). */
  readonly at: number;
  /** The batch whose undo would bring it back; `undefined` for a file no pending entry names. */
  readonly batch: string | undefined;
}

export interface ReplacedFigures {
  readonly files: number;
  readonly bytes: number;
  /** What "Empty" would delete now, with the retention in force. */
  readonly due: {
    readonly files: number;
    readonly bytes: number;
    /** How many batches of the History could no longer restore all they set aside. */
    readonly batches: number;
  };
  /** The retention in force, in days (0: every file). */
  readonly days: number;
}

export interface ReplacedTask {
  status: 'running' | 'done' | 'failed';
  done: number;
  total: number;
  startedAt: string;
  endedAt: string | null;
  all: boolean;
  /** What was deleted, once the task ends. */
  freed: { files: number; bytes: number; batches: number; failed: number } | null;
  error: MatchFailure | null;
}

export interface ReplacedDeps {
  /** Under the `maintenance` component of the log. */
  readonly log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  readonly database: Database;
  readonly dir: string;
  readonly progress: ProgressTracker;
  /** A scan, a transfer or an undo runs: a file it is about to restore must not go. */
  readonly busy: () => boolean;
  /** The retention setting, in days (0: every file). */
  readonly days: () => number;
}

/**
 * What a tidy-up, an image replacement or a collection edit set aside (`<config>/replaced/`), and
 * the only place Kinoshelf deletes for good. **The one irreversible action of the Maintenance tab**:
 * the journal keeps its entries, so an undo of a batch whose file is gone skips it
 * (`undo.backup-missing`) instead of failing. **Never inside the request**: a start answers 202.
 */
export class ReplacedFiles {
  private latest: ReplacedTask | undefined;

  constructor(private readonly deps: ReplacedDeps) {}

  task(): ReplacedTask | null {
    return this.latest ?? null;
  }

  /** Flat folder of `<uuid><ext>` files; anything else in there is none of ours. */
  private async inspect(): Promise<ReplacedFile[]> {
    const entries = await readdir(this.deps.dir, { withFileTypes: true }).catch(() => []);
    // The batch of each file, from the journal: a file can only be restored by a pending entry.
    const named = new Map<string, { batch: string; at: number; pending: boolean }>();
    for (const row of this.deps.database
      .prepare<[], { backup: string; batch_id: string; at: string; undone_at: string | null }>(
        'SELECT backup, batch_id, at, undone_at FROM journal_entries WHERE backup IS NOT NULL',
      )
      .all()) {
      named.set(row.backup, {
        batch: row.batch_id,
        at: Date.parse(row.at),
        pending: row.undone_at === null,
      });
    }

    const files: ReplacedFile[] = [];
    const names = entries.filter((entry) => entry.isFile()).map(({ name }) => name);
    // A few at a time: a tidy-up of a big library leaves thousands.
    for (let from = 0; from < names.length; from += 64) {
      const slice = await Promise.all(
        names.slice(from, from + 64).map(async (name): Promise<ReplacedFile | undefined> => {
          const path = join(this.deps.dir, name);
          const info = await stat(path).catch(() => undefined);
          if (!info) {
            return undefined;
          }
          const entry = named.get(path);
          return {
            path,
            bytes: info.size,
            at: entry && !Number.isNaN(entry.at) ? entry.at : info.ctimeMs,
            batch: entry?.pending ? entry.batch : undefined,
          };
        }),
      );
      files.push(...slice.filter((file): file is ReplacedFile => file !== undefined));
    }
    return files;
  }

  private dueOf(files: readonly ReplacedFile[], all: boolean, now: number): ReplacedFile[] {
    const days = this.deps.days();
    if (all || days <= 0) {
      return [...files];
    }
    return files.filter(({ at }) => at < now - days * DAY_MS);
  }

  async figures(now: number = Date.now()): Promise<ReplacedFigures> {
    const files = await this.inspect();
    const due = this.dueOf(files, false, now);
    return {
      files: files.length,
      bytes: files.reduce((sum, { bytes }) => sum + bytes, 0),
      due: {
        files: due.length,
        bytes: due.reduce((sum, { bytes }) => sum + bytes, 0),
        batches: batchesOf(due).length,
      },
      days: this.deps.days(),
    };
  }

  /** Starts emptying; `all` ignores the retention. Answers with the task, which goes on in memory. */
  start(options: { all: boolean }, now: number = Date.now()): ReplacedTask {
    if (this.deps.busy() || this.latest?.status === 'running') {
      throw new ApiError(409, 'maintenance.replaced-busy');
    }
    const task: ReplacedTask = {
      status: 'running',
      done: 0,
      total: 0,
      startedAt: new Date(now).toISOString(),
      endedAt: null,
      all: options.all,
      freed: null,
      error: null,
    };
    this.latest = task;
    this.deps.progress.announce();
    void this.run(task, options.all, now)
      .then(
        () => {
          task.status = 'done';
        },
        (error: unknown) => {
          task.status = 'failed';
          task.error = failureOf(error);
        },
      )
      .finally(() => {
        task.endedAt = new Date().toISOString();
        this.deps.progress.announce();
      });
    return task;
  }

  private async run(task: ReplacedTask, all: boolean, now: number): Promise<void> {
    const due = this.dueOf(await this.inspect(), all, now);
    task.total = due.length;
    this.deps.progress.announce();
    const freed = { files: 0, bytes: 0, batches: 0, failed: 0 };
    const gone: ReplacedFile[] = [];
    for (const file of due) {
      try {
        await unlink(file.path);
        freed.files++;
        freed.bytes += file.bytes;
        gone.push(file);
      } catch (error) {
        // Already gone (an undo took it) is what was asked; anything else is counted and reported.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          freed.failed++;
        }
      }
      task.done++;
      this.deps.progress.announce();
    }
    freed.batches = batchesOf(gone).length;
    task.freed = freed;
    this.deps.log.info({ ...freed, all }, 'Emptied the files set aside');
  }
}

/** The pending batches that named these files, once each. */
const batchesOf = (files: readonly ReplacedFile[]): string[] => [
  ...new Set(files.flatMap(({ batch }) => (batch === undefined ? [] : [batch]))),
];
