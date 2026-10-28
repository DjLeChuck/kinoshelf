#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { configDirectory, loadConfig } from '@kinoshelf/core';
import { buildApp } from './app.js';
import { generateApiKey, hasApiKey, MIN_API_KEY_LENGTH, setApiKey } from './auth.js';
import { openDatabase } from './database.js';
import { createShutdown } from './shutdown.js';

const DEFAULT_RETENTION_DAYS = 90;

const configDir = configDirectory(undefined, process.env);

// `kinoshelf-server api-key create`: the key goes to stdout only, never through the logger, so
// it cannot end up in shipped logs. It replaces the previous key.
if (process.argv[2] === 'api-key') {
  if (process.argv[3] !== 'create') {
    process.stderr.write('Usage: kinoshelf-server api-key create\n');
    process.exit(2);
  }
  const database = openDatabase(configDir);
  const key = generateApiKey();
  setApiKey(database, key);
  database.close();
  process.stdout.write(`${key}\n`);
  process.exit(0);
}

// `dist/` sits next to `package.json`, so this resolves the same in a checkout and once installed.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const config = await loadConfig(configDir);
const database = openDatabase(configDir);

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
