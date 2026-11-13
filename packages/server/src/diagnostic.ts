import type { Config } from '@kinoshelf/core';
import type { HealthReport } from './health-report.js';
import type { LogStore } from './logs.js';
import { presentSettings } from './settings.js';
import type { TmdbUsage } from './tmdb-usage.js';
import { zip } from './zip.js';

/** The newest lines the archive carries: enough to see what led to a problem, small enough to attach. */
export const DIAGNOSTIC_LOG_LINES = 2000;

type Env = Readonly<Record<string, string | undefined>>;

export interface DiagnosticDeps {
  readonly config: () => Config;
  readonly env: Env;
  readonly version: string;
  readonly logs: LogStore;
  readonly tmdbUsage: TmdbUsage;
  readonly report: () => Promise<HealthReport>;
  readonly now?: () => Date;
}

/**
 * The configuration as a person may share it: the settings exactly as `GET /api/settings`
 * presents them (a secret is only said to be set, never shown) and the libraries, which hold
 * folders and choices but no secret.
 */
export function diagnosticConfig(config: Config, env: Env) {
  return {
    settings: presentSettings(config, env),
    apiKey: { source: (env.KINOSHELF_API_KEY ?? '') !== '' ? 'env' : 'settings' },
    libraries: config.libraries ?? [],
  };
}

/** What identifies this install in a bug report, secret-free. */
export async function diagnosticSummary(deps: DiagnosticDeps) {
  const report = await deps.report();
  return {
    kinoshelf: report.server.version,
    node: report.server.node,
    platform: report.server.arch,
    ffprobe: report.ffprobe.version,
    uptimeSeconds: report.server.uptimeSeconds,
    locale: deps.config().locale ?? null,
  };
}

export const diagnosticFilename = (now: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `kinoshelf-diagnostic-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.zip`
  );
};

/**
 * The archive to attach to a bug report. Every part is already wiped of secrets where it was
 * made: the log when a line is written, the settings by `presentSettings`, the health report by
 * `redactUrl`. Nothing is read from the environment but the key's source.
 */
export async function buildDiagnostic(deps: DiagnosticDeps): Promise<Buffer> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const [summary, health] = await Promise.all([diagnosticSummary(deps), deps.report()]);
  // The page is newest first; a log reads oldest first.
  const lines = [...deps.logs.page({ limit: DIAGNOSTIC_LOG_LINES }).entries]
    .reverse()
    .map((entry) => JSON.stringify(entry))
    .join('\n');

  return zip(
    [
      { name: 'summary.json', data: json({ generatedAt: now.toISOString(), ...summary }) },
      { name: 'config.json', data: json(diagnosticConfig(deps.config(), deps.env)) },
      { name: 'health.json', data: json(health) },
      { name: 'tmdb-usage.json', data: json(deps.tmdbUsage.report('7d')) },
      { name: 'logs.ndjson', data: Buffer.from(lines === '' ? '' : `${lines}\n`) },
    ],
    now,
  );
}
