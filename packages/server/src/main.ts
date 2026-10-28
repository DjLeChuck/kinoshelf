#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import {
  configDirectory,
  ensureConfigDirectory,
  KinoshelfError,
  loadConfig,
  type Config,
} from '@kinoshelf/core';
import { createTranslator, describeError, detectLocale } from '@kinoshelf/i18n';
import { buildApp } from './app.js';
import { generateApiKey, hasApiKey, MIN_API_KEY_LENGTH, setApiKey } from './auth.js';
import { openDatabase } from './database.js';
import { runNotifyCommand } from './notify-command.js';
import { createShutdown } from './shutdown.js';

const DEFAULT_RETENTION_DAYS = 90;

const configDir = configDirectory(undefined, process.env);

// Typed errors (an unwritable volume, an unreadable config.yaml) are printed translated: a stack
// trace tells whoever starts the container nothing about what to fix.
function failStartup(error: unknown): never {
  if (error instanceof KinoshelfError) {
    const t = createTranslator(detectLocale(undefined, undefined, process.env));
    process.stderr.write(`${describeError(t, error.info)}\n`);
    process.exit(1);
  }
  throw error;
}

// `kinoshelf-server api-key create`: the key goes to stdout only, never through the logger, so
// it cannot end up in shipped logs. It replaces the previous key.
if (process.argv[2] === 'api-key') {
  if (process.argv[3] !== 'create') {
    process.stderr.write('Usage: kinoshelf-server api-key create\n');
    process.exit(2);
  }
  const database = await openDatabase(configDir).catch(failStartup);
  const key = generateApiKey();
  setApiKey(database, key);
  database.close();
  process.stdout.write(`${key}\n`);
  process.exit(0);
}

// `kinoshelf-server notify test|refresh`: checks the media servers and webhooks of config.yaml
// from inside the container, without starting the server (see notify-command.ts).
if (process.argv[2] === 'notify') {
  const config = await loadConfig(configDir).catch(failStartup);
  process.exit(
    await runNotifyCommand(process.argv.slice(3), {
      config,
      env: process.env,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    }),
  );
}

// `dist/` sits next to `package.json`, so this resolves the same in a checkout and once installed.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

let config: Config;
let database: Database.Database;
try {
  await ensureConfigDirectory(configDir);
  config = await loadConfig(configDir);
  database = await openDatabase(configDir);
} catch (error) {
  failStartup(error);
}

const fromEnv = process.env.KINOSHELF_API_KEY;
if (fromEnv !== undefined && fromEnv !== '') {
  if (fromEnv.length < MIN_API_KEY_LENGTH) {
    process.stderr.write(`KINOSHELF_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters.\n`);
    process.exit(1);
  }
  setApiKey(database, fromEnv);
}

const host = process.env.KINOSHELF_HOST ?? '0.0.0.0';
const port = Number(process.env.KINOSHELF_PORT ?? 8484);

const app = await buildApp({
  version,
  config,
  configDir,
  database,
  env: process.env,
  logger: true,
  // Finished jobs older than this are forgotten; 0 in config.yaml keeps everything.
  retentionDays: config.retentionDays ?? DEFAULT_RETENTION_DAYS,
});

if (!hasApiKey(database)) {
  app.log.warn(
    'No API key: /api answers 503 until one exists. Set KINOSHELF_API_KEY, or run `kinoshelf-server api-key create`.',
  );
}

await app.listen({ host, port });

const shutdown = createShutdown({
  close: () => app.close().finally(() => database.close()),
  busy: () => app.jobs.busy,
  log: (message) => {
    app.log.warn(message);
  },
  forceExit: () => process.exit(1),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, shutdown);
}
