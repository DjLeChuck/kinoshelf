import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { isSample, VIDEO_EXTENSIONS, type WatchConfig } from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';

/** What download clients append to a file while it is not complete. */
const INCOMPLETE_EXTENSIONS = ['!qb', 'part', 'crdownload', 'tmp', '!ut', 'bc!', 'aria2'];

const DEFAULT_SETTLE_SECONDS = 30;
/** A missed event (a full inotify queue, a share) must not leave a file unseen for long. */
const SAFETY_SCAN_MS = 600_000;
/** Used when events cannot be had, and when a scan left files still settling. */
const FALLBACK_POLL_MS = 60_000;

export interface FolderStatus {
  readonly path: string;
  /** False when the folder is missing or unreadable (an unmounted share, say). */
  readonly available: boolean;
}

export interface WatchStatus {
  readonly enabled: boolean;
  readonly mode: 'events' | 'poll';
  readonly folders: readonly FolderStatus[];
  /** Releases seen but not yet submitted: still being written, or settling. */
  readonly pending: number;
  readonly lastScanAt: string | null;
}

export interface ScanResult {
  /** Jobs created by this scan. */
  readonly submitted: number;
  readonly pending: number;
  /** Releases seen again that an earlier scan already submitted. */
  readonly known: number;
}

export interface WatcherDeps {
  readonly database: Database;
  /** Queues the analysis of a path; the watcher never writes to the disk itself. */
  readonly submit: (path: string, apply: boolean) => void;
  readonly log: { warn(message: string): void };
  /** Replaced in tests. */
  readonly now?: () => number;
}

interface VideoFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** One release: a folder under the watched one, or a file lying directly in it. */
interface Release {
  readonly path: string;
  readonly videos: VideoFile[];
  incomplete: boolean;
}

/**
 * Submits what lands in folders that only hold finished downloads. The disk is not polled by
 * default: the kernel's change notifications only wake a scan, which then judges completeness
 * itself, since an event says something moved, not that it is finished. A release is submitted
 * once all its files have stayed unchanged for `settleSeconds` and none carries an incomplete
 * suffix; `scan({ force: true })` skips the wait, for a person who knows it is done.
 *
 * Meant for the folder a client moves completed downloads to. Pointed at the live download folder
 * it cannot tell a stalled torrent from a finished one.
 */
export class FolderWatcher {
  private config: WatchConfig | undefined;
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;
  private safetyTimer: NodeJS.Timeout | undefined;
  private wake: NodeJS.Timeout | undefined;
  private polling = false;
  private chain: Promise<unknown> = Promise.resolve();
  private available = new Map<string, boolean>();
  private pending = 0;
  private lastScanAt: string | null = null;

  constructor(private readonly deps: WatcherDeps) {}

  /** (Re)starts with the given settings; none (or no folder) stops it. */
  configure(config: WatchConfig | undefined): void {
    this.halt();
    this.config = config;
    this.available = new Map();
    if (!config) {
      this.pending = 0;
      return;
    }
    const pollMs = (config.pollSeconds ?? 0) * 1000;
    if (pollMs > 0) {
      this.polling = true;
      this.timer = setInterval(() => void this.scan(), pollMs).unref();
    } else {
      this.listen(config);
      this.safetyTimer = setInterval(() => void this.scan(), SAFETY_SCAN_MS).unref();
    }
    // What arrived while the server was down.
    void this.scan();
  }

  status(): WatchStatus {
    return {
      enabled: this.config !== undefined,
      mode: this.polling ? 'poll' : 'events',
      folders: (this.config?.folders ?? []).map((path) => ({
        path,
        available: this.available.get(path) ?? false,
      })),
      pending: this.pending,
      lastScanAt: this.lastScanAt,
    };
  }

  /** One scan at a time: two at once would submit the same release twice. */
  scan(options: { force?: boolean } = {}): Promise<ScanResult> {
    const run = this.chain.then(() => this.scanFolders(options.force ?? false));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Waits for the scan in progress; for tests and shutdown. */
  async idle(): Promise<void> {
    await this.chain;
  }

  stop(): void {
    this.halt();
    this.config = undefined;
  }

  private halt(): void {
    for (const watcher of this.watchers.splice(0)) {
      watcher.close();
    }
    clearInterval(this.timer);
    clearInterval(this.safetyTimer);
    clearTimeout(this.wake);
    this.timer = this.safetyTimer = this.wake = undefined;
    this.polling = false;
  }

  /** A burst of events (a release being written) leads to one scan, once it goes quiet. */
  private schedule(delayMs: number): void {
    clearTimeout(this.wake);
    this.wake = setTimeout(() => void this.scan(), delayMs).unref();
  }

  private listen(config: WatchConfig): void {
    const quiet = Math.max(1, config.settleSeconds ?? DEFAULT_SETTLE_SECONDS) * 1000;
    for (const folder of config.folders) {
      try {
        const watcher = watch(folder, { recursive: true }, () => {
          this.schedule(quiet);
        });
        watcher.on('error', () => {
          this.fallBackToPolling(folder);
        });
        this.watchers.push(watcher);
      } catch {
        // Missing folder, or no inotify watch left: scanning still works.
        this.fallBackToPolling(folder);
      }
    }
  }

  private fallBackToPolling(folder: string): void {
    if (this.timer) {
      return;
    }
    this.deps.log.warn(`Cannot watch ${folder} for changes: scanning it every minute instead.`);
    this.timer = setInterval(() => void this.scan(), FALLBACK_POLL_MS).unref();
  }

  private async scanFolders(force: boolean): Promise<ScanResult> {
    const config = this.config;
    let submitted = 0;
    let pending = 0;
    let known = 0;
    if (config) {
      for (const folder of config.folders) {
        const result = await this.scanFolder(folder, config, force);
        submitted += result.submitted;
        pending += result.pending;
        known += result.known;
      }
    }
    this.pending = pending;
    this.lastScanAt = new Date(this.now()).toISOString();
    // Files still settling are not announced by any event: look again once they might be done.
    if (pending > 0 && !this.polling) {
      this.schedule(Math.max(5, config?.settleSeconds ?? DEFAULT_SETTLE_SECONDS) * 1000);
    }
    return { submitted, pending, known };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async scanFolder(
    folder: string,
    config: WatchConfig,
    force: boolean,
  ): Promise<ScanResult> {
    const releases = await collect(folder);
    this.available.set(folder, releases !== undefined);
    // An unreadable folder says nothing about what is in it: keep what was recorded.
    if (!releases) {
      return { submitted: 0, pending: 0, known: 0 };
    }

    const settleMs = (config.settleSeconds ?? DEFAULT_SETTLE_SECONDS) * 1000;
    const now = this.now();
    const known = this.knownFiles(folder);
    // Someone who asks for a scan wants what is not queued: a file remembered while its job was
    // since deleted (history cleared) would otherwise stay unreachable until its date changes.
    const queued = force ? this.queuedPaths(folder) : undefined;
    let submitted = 0;
    let pending = 0;
    let remembered = 0;
    const seen: VideoFile[] = [];

    for (const release of releases.values()) {
      seen.push(...release.videos);
      const fresh = release.videos.filter(
        (file) =>
          !known.has(key(file)) ||
          (queued !== undefined && !queued.has(release.path) && !queued.has(file.path)),
      );
      if (fresh.length === 0) {
        // A folder with only samples or an NFO has nothing to be known for.
        if (release.videos.length > 0) {
          remembered++;
        }
        continue;
      }
      const settled = release.videos.every((file) => now - file.mtimeMs >= settleMs);
      if (release.incomplete || (!force && !settled)) {
        pending++;
        continue;
      }
      // A release already submitted and then completed with more files: only the new ones.
      const paths =
        fresh.length === release.videos.length ? [release.path] : fresh.map((f) => f.path);
      for (const path of paths) {
        this.deps.submit(path, config.apply ?? false);
        submitted++;
      }
      this.remember(fresh);
    }

    this.forget(folder, seen);
    return { submitted, pending, known: remembered };
  }

  private knownFiles(folder: string): Set<string> {
    const rows = this.deps.database
      .prepare<[string], { path: string; size: number; mtime_ms: number }>(
        "SELECT path, size, mtime_ms FROM watched_files WHERE path LIKE ? ESCAPE '\\'",
      )
      .all(`${escapeLike(folder)}/%`);
    return new Set(rows.map((row) => `${row.path}\0${row.size}\0${row.mtime_ms}`));
  }

  private queuedPaths(folder: string): Set<string> {
    const rows = this.deps.database
      .prepare<[string], { path: string }>(
        "SELECT DISTINCT path FROM jobs WHERE path LIKE ? ESCAPE '\\'",
      )
      .all(`${escapeLike(folder)}/%`);
    return new Set(rows.map((row) => row.path));
  }

  private remember(files: readonly VideoFile[]): void {
    const insert = this.deps.database.prepare(
      'INSERT OR IGNORE INTO watched_files (path, size, mtime_ms, submitted_at) VALUES (?, ?, ?, ?)',
    );
    const at = new Date(this.now()).toISOString();
    this.deps.database.transaction(() => {
      for (const file of files) {
        insert.run(file.path, file.size, file.mtimeMs, at);
      }
    })();
  }

  /** Rows for files that are gone (moved by the transfer, deleted) would only pile up. */
  private forget(folder: string, present: readonly VideoFile[]): void {
    const here = new Set(present.map(key));
    const rows = this.deps.database
      .prepare<[string], { path: string; size: number; mtime_ms: number }>(
        "SELECT path, size, mtime_ms FROM watched_files WHERE path LIKE ? ESCAPE '\\'",
      )
      .all(`${escapeLike(folder)}/%`);
    const drop = this.deps.database.prepare(
      'DELETE FROM watched_files WHERE path = ? AND size = ? AND mtime_ms = ?',
    );
    this.deps.database.transaction(() => {
      for (const row of rows) {
        if (!here.has(`${row.path}\0${row.size}\0${row.mtime_ms}`)) {
          drop.run(row.path, row.size, row.mtime_ms);
        }
      }
    })();
  }
}

const key = (file: VideoFile): string => `${file.path}\0${file.size}\0${file.mtimeMs}`;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Releases under `folder`, or `undefined` when it cannot be read. Hidden entries and symbolic
 * links are skipped, as everywhere else.
 */
async function collect(folder: string): Promise<Map<string, Release> | undefined> {
  const root = folder.replace(/[\\/]+$/, '');
  const releases = new Map<string, Release>();
  try {
    await walk(root, root, releases);
  } catch {
    return undefined;
  }
  return releases;
}

async function walk(
  root: string,
  directory: string,
  releases: Map<string, Release>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, path, releases);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const segments = relative(root, path).split(sep);
    const releasePath = segments.length === 1 ? path : join(root, segments[0] ?? '');
    let release = releases.get(releasePath);
    if (!release) {
      release = { path: releasePath, videos: [], incomplete: false };
      releases.set(releasePath, release);
    }
    const extension = extname(path).slice(1).toLowerCase();
    if (INCOMPLETE_EXTENSIONS.includes(extension)) {
      release.incomplete = true;
    } else if (VIDEO_EXTENSIONS.includes(extension) && !isSample(path)) {
      try {
        const info = await stat(path);
        release.videos.push({ path, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
      } catch {
        // Gone between the listing and the stat: the next scan will tell.
        release.incomplete = true;
      }
    }
  }
}
