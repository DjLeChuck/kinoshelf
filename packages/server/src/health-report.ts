import { statfs, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, Database } from '@kinoshelf/core';
import type { Completeness } from './completeness.js';
import type { Health, HealthProblem } from './health.js';
import type { DeliveryRecord, Notifier } from './notify/notifier.js';
import { ffprobeVersion, type ProbeQueue } from './probe.js';
import { migrationState, type MigrationState } from './schema-info.js';

/** Under this share of free space a disk is a warning, not an error: nothing is broken yet. */
export const LOW_DISK_RATIO = 0.05;

export interface HealthReportDeps {
  readonly health: Health;
  readonly database: Database;
  readonly config: () => Config;
  readonly configDir: string;
  readonly version: string;
  readonly notifier: Notifier;
  readonly probes: ProbeQueue;
  readonly completeness: Completeness;
  readonly now?: () => number;
}

export interface DiskReport {
  readonly libraryId: string;
  readonly name: string;
  readonly path: string;
  /** `null` when the folder cannot be read: the problem says why. */
  readonly totalBytes: number | null;
  readonly freeBytes: number | null;
}

export interface HealthReport {
  readonly problems: readonly (HealthProblem & { readonly severity: 'error' | 'warn' })[];
  readonly server: {
    readonly version: string;
    readonly uptimeSeconds: number;
    readonly node: string;
    readonly arch: string;
    readonly configDir: string;
  };
  readonly ffprobe: { readonly version: string | null };
  readonly database: {
    readonly sizeBytes: number | null;
    readonly journalEntries: number;
    readonly cacheEntries: number;
    readonly migrations: MigrationState;
  };
  readonly disks: readonly DiskReport[];
  readonly queue: {
    readonly analyses: { readonly running: number; readonly queued: number };
    readonly transfers: { readonly running: number; readonly queued: number };
    /** Videos ffprobe has still to read, and shows whose missing episodes are still to count. */
    readonly probes: number;
    readonly completeness: number;
  };
  readonly notify: {
    readonly webhooks: number;
    readonly plex: boolean;
    readonly jellyfin: boolean;
    readonly recent: readonly DeliveryRecord[];
  };
}

function counts(database: Database, table: 'jobs' | 'executions') {
  const rows = database
    .prepare<[], { status: string; n: number }>(
      `SELECT status, COUNT(*) AS n FROM ${table} WHERE status IN ('queued', 'running') GROUP BY status`,
    )
    .all();
  const of = (status: string): number => rows.find((row) => row.status === status)?.n ?? 0;
  return { running: of('running'), queued: of('queued') };
}

/** A table that may not exist yet (the TMDB cache is created on demand). */
function rowsOf(database: Database, table: string): number {
  try {
    return database.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
  } catch {
    return 0;
  }
}

async function diskOf(library: NonNullable<Config['libraries']>[number]): Promise<DiskReport> {
  const base = { libraryId: library.id, name: library.name, path: library.source };
  try {
    const info = await statfs(library.source);
    return {
      ...base,
      totalBytes: info.blocks * info.bsize,
      // `bavail`, not `bfree`: the space the server may use, not root's reserve.
      freeBytes: info.bavail * info.bsize,
    };
  } catch {
    return { ...base, totalBytes: null, freeBytes: null };
  }
}

/** The latest outcome per target decides: an old failure the target recovered from is history. */
function latestPerTarget(recent: readonly DeliveryRecord[], kind: DeliveryRecord['kind']) {
  const seen = new Map<string, DeliveryRecord>();
  for (const record of recent) {
    if (record.kind === kind && !seen.has(record.target)) {
      seen.set(record.target, record);
    }
  }
  return [...seen.values()];
}

/**
 * Everything the Health page draws, read at once when it opens. It is the slow cousin of
 * `Health.check` (disk space, `ffprobe`, the size of the database file) and is never asked for
 * the navigation's badge.
 */
export async function healthReport(deps: HealthReportDeps): Promise<HealthReport> {
  const { database, notifier, config } = deps;
  const libraries = config().libraries ?? [];
  const [errors, disks, version, file] = await Promise.all([
    deps.health.problems(),
    Promise.all(libraries.map(diskOf)),
    ffprobeVersion(),
    stat(join(deps.configDir, 'kinoshelf.sqlite')).then(
      (info) => info.size,
      () => null,
    ),
  ]);

  const recent = notifier.recent();
  const warnings: HealthProblem[] = [];
  if (version === null) {
    warnings.push({ area: 'ffprobe', code: 'ffprobe-missing' });
  }
  for (const disk of disks) {
    if (
      disk.totalBytes !== null &&
      disk.freeBytes !== null &&
      disk.totalBytes > 0 &&
      disk.freeBytes / disk.totalBytes < LOW_DISK_RATIO
    ) {
      warnings.push({ area: 'disk', code: 'disk-low', params: { name: disk.name } });
    }
  }
  for (const record of latestPerTarget(recent, 'webhook')) {
    if (!record.ok) {
      warnings.push({
        area: 'webhooks',
        code: 'webhook-failing',
        params: { target: record.target },
      });
    }
  }
  for (const kind of ['plex', 'jellyfin'] as const) {
    if (latestPerTarget(recent, kind).some((record) => !record.ok)) {
      warnings.push({ area: 'media', code: 'media-refresh-failed', params: { target: kind } });
    }
  }

  const targets = notifier.targets;
  return {
    problems: [
      ...errors.map((problem) => ({ ...problem, severity: 'error' as const })),
      ...warnings.map((problem) => ({ ...problem, severity: 'warn' as const })),
    ],
    server: {
      version: deps.version,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      arch: `${process.platform}-${process.arch}`,
      configDir: deps.configDir,
    },
    ffprobe: { version },
    database: {
      sizeBytes: file,
      journalEntries: rowsOf(database, 'journal_entries'),
      cacheEntries: rowsOf(database, 'tmdb_http_cache'),
      migrations: migrationState(database),
    },
    disks,
    queue: {
      analyses: counts(database, 'jobs'),
      transfers: counts(database, 'executions'),
      probes: deps.probes.pending,
      completeness: deps.completeness.pending,
    },
    notify: { ...targets, recent },
  };
}
