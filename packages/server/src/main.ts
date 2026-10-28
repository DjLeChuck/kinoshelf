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
import { findWebRoot } from './web.js';
import { describeListenError, parseServerCommand } from './startup.js';

const DEFAULT_RETENTION_DAYS = 90;

const configDir = configDirectory(undefined, process.env);
// The language of what is printed before config.yaml is read: the environment's.
const t = createTranslator(detectLocale(undefined, undefined, process.env));

// Typed errors (an unwritable volume, an unreadable config.yaml) are printed translated: a stack
// trace tells whoever starts the container nothing about what to fix.
function failStartup(error: unknown): never {
  if (error instanceof KinoshelfError) {
    process.stderr.write(`${describeError(t, error.info)}\n`);
    process.exit(1);
  }
  throw error;
}

const command = parseServerCommand(process.argv.slice(2));
if (command.kind === 'help') {
  process.stdout.write(`${t('server.help')}\n`);
  process.exit(0);
}
if (command.kind === 'usage-error') {
  process.stderr.write(`${t('server.help')}\n`);
  process.exit(2);
}

// `kinoshelf-server api-key create`: the key goes to stdout only, never through the logger, so
// it cannot end up in shipped logs. It replaces the previous key.
if (command.kind === 'api-key') {
  const database = await openDatabase(configDir).catch(failStartup);
  const key = generateApiKey();
  setApiKey(database, key);
  database.close();
  process.stdout.write(`${key}\n`);
  process.exit(0);
}

// `kinoshelf-server notify test|refresh`: checks the media servers and webhooks of config.yaml
// from inside the container, without starting the server (see notify-command.ts).
if (command.kind === 'notify') {
  const config = await loadConfig(configDir).catch(failStartup);
  process.exit(
    await runNotifyCommand(command.args, {
      config,
      env: process.env,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      usage: t('server.help'),
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

const webRoot = findWebRoot(process.env);

const app = await buildApp({
  version,
  ...(webRoot && { webRoot }),
  config,
  configDir,
  database,
  env: process.env,
  logger: true,
  // Finished jobs older than this are forgotten; 0 in config.yaml keeps everything.
  retentionDays: config.retentionDays ?? DEFAULT_RETENTION_DAYS,
});

if (!webRoot) {
  app.log.info('No web UI found (KINOSHELF_WEB_DIR): serving the API only.');
}

if (!hasApiKey(database)) {
  app.log.warn(
    'No API key: /api answers 503 until one exists. Set KINOSHELF_API_KEY, or run `kinoshelf-server api-key create`.',
  );
}

try {
  await app.listen({ host, port });
} catch (error) {
  // A port already taken is the usual mistake (a second container, or `kinoshelf-server` typed in
  // the one that already runs it): say so rather than print a stack trace.
  const reason = describeListenError(error, host, port);
  if (!reason) {
    throw error;
  }
  await app.close();
  database.close();
  process.stderr.write(`${describeError(t, reason)}\n`);
  process.exit(1);
}

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
