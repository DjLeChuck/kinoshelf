import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@kinoshelf/core';
import type { FastifyBaseLogger } from 'fastify';
import { ApiError } from './api-error.js';
import { failureOf, type MatchFailure } from './matches.js';
import type { ProgressTracker } from './progress.js';

export type DatabaseTaskKind = 'backup' | 'vacuum';

/** One backup of the database kept in the config folder. */
export interface BackupFile {
  readonly name: string;
  readonly bytes: number;
  /** The file's date, ISO. */
  readonly at: string;
}

/** The latest backup or compaction, in the server's memory like a tidy-up. */
export interface DatabaseTask {
  readonly kind: DatabaseTaskKind;
  status: 'running' | 'done' | 'failed';
  /** Pages copied and total, for a backup; a compaction cannot tell how far it has got. */
  done: number;
  total: number;
  startedAt: string;
  endedAt: string | null;
  /** The backup made, and how many older ones the rotation removed. */
  backup: { file: BackupFile; removed: number } | null;
  /** The database's size before and after a compaction. */
  size: { before: number; after: number } | null;
  error: MatchFailure | null;
}

export interface DatabaseTasksDeps {
  /** Under the `maintenance` component of the log. */
  readonly log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  readonly database: Database;
  readonly configDir: string;
  readonly progress: ProgressTracker;
  /** A scan or a transfer is running: a compaction would wait for the database, so it is refused. */
  readonly busy: () => boolean;
  /** How many backups are kept (the setting, read at each backup). */
  readonly keep: () => number;
}

const BACKUP_PREFIX = 'kinoshelf-';
const BACKUP_SUFFIX = '.sqlite';

const two = (n: number): string => String(n).padStart(2, '0');

/** `kinoshelf-20261114-2310.sqlite`, in UTC so that names sort as dates whatever the zone. */
export function backupName(date: Date): string {
  return (
    `${BACKUP_PREFIX}${String(date.getUTCFullYear())}${two(date.getUTCMonth() + 1)}` +
    `${two(date.getUTCDate())}-${two(date.getUTCHours())}${two(date.getUTCMinutes())}${BACKUP_SUFFIX}`
  );
}

/**
 * Backup and compaction of the SQLite file (journal, TMDB cache, the lists). **Never inside the
 * request**: a start answers 202 and the page follows the `progress` event. One of them at a time.
 * A backup copies page by page, yielding to the event loop, so the server keeps answering; a
 * compaction (`VACUUM`) cannot be cut up and holds the event loop for its duration, hence it is
 * refused while a scan or a transfer runs and done only after the answer left.
 */
export class DatabaseTasks {
  private latest = new Map<DatabaseTaskKind, DatabaseTask>();

  constructor(private readonly deps: DatabaseTasksDeps) {}

  get dir(): string {
    return join(this.deps.configDir, 'backups');
  }

  tasks(): DatabaseTask[] {
    return [...this.latest.values()];
  }

  /** The backups on disk, newest first. */
  async backups(): Promise<BackupFile[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const files = await Promise.all(
      names
        .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
        .map(async (name): Promise<BackupFile | undefined> => {
          const info = await stat(join(this.dir, name)).catch(() => undefined);
          return info && { name, bytes: info.size, at: info.mtime.toISOString() };
        }),
    );
    return files
      .filter((file): file is BackupFile => file !== undefined)
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  private begin(kind: DatabaseTaskKind): DatabaseTask {
    if ([...this.latest.values()].some(({ status }) => status === 'running')) {
      throw new ApiError(409, 'maintenance.database-task-running');
    }
    const task: DatabaseTask = {
      kind,
      status: 'running',
      done: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      endedAt: null,
      backup: null,
      size: null,
      error: null,
    };
    this.latest.set(kind, task);
    this.deps.progress.announce();
    return task;
  }

  private finish(task: DatabaseTask, error?: unknown): void {
    if (error === undefined) {
      task.status = 'done';
    } else {
      task.status = 'failed';
      task.error = failureOf(error);
    }
    task.endedAt = new Date().toISOString();
    if (task.status === 'done') {
      this.deps.log.info(
        {
          ...(task.backup && { backup: task.backup.file.name, removed: task.backup.removed }),
          ...(task.size && { before: task.size.before, after: task.size.after }),
        },
        task.kind === 'backup' ? 'Backed up the database' : 'Compacted the database',
      );
    } else {
      this.deps.log.warn({ error: task.error?.code }, `The ${task.kind} of the database failed`);
    }
    this.deps.progress.announce();
  }

  startBackup(now: Date = new Date()): DatabaseTask {
    const task = this.begin('backup');
    void this.backup(task, now).then(
      () => {
        this.finish(task);
      },
      (error: unknown) => {
        this.finish(
          task,
          error instanceof ApiError
            ? error
            : new ApiError(500, 'maintenance.backup-failed', {
                reason: error instanceof Error ? error.message : String(error),
              }),
        );
      },
    );
    return task;
  }

  private async backup(task: DatabaseTask, now: Date): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = backupName(now);
    const final = join(this.dir, name);
    // Written under another name then renamed: a half-copied file is never taken for a backup.
    const partial = `${final}.partial`;
    try {
      await this.deps.database.backup(partial, (remaining, total) => {
        Object.assign(task, { done: total - remaining, total });
        this.deps.progress.announce();
      });
      await rename(partial, final);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }

    // Rotation: only after the new one is safe, so a failure never leaves fewer copies than before.
    const all = await this.backups();
    const surplus = all.slice(Math.max(1, this.deps.keep()));
    await Promise.all(surplus.map(({ name: old }) => rm(join(this.dir, old), { force: true })));
    const file = all.find((candidate) => candidate.name === name);
    if (file) {
      task.backup = { file, removed: surplus.length };
    }
  }

  startVacuum(): DatabaseTask {
    if (this.deps.busy()) {
      throw new ApiError(409, 'maintenance.busy');
    }
    const task = this.begin('vacuum');
    // After the answer has left: the compaction holds the event loop.
    setImmediate(() => {
      try {
        const sizeOf = (): number => {
          // The log is folded in first, or the figure would miss what it still holds.
          this.deps.database.pragma('wal_checkpoint(TRUNCATE)');
          return (
            Number(this.deps.database.pragma('page_count', { simple: true })) *
            Number(this.deps.database.pragma('page_size', { simple: true }))
          );
        };
        const before = sizeOf();
        this.deps.database.exec('VACUUM');
        task.size = { before, after: sizeOf() };
        this.finish(task);
      } catch {
        this.finish(task, new ApiError(500, 'maintenance.vacuum-failed'));
      }
    });
    return task;
  }
}
