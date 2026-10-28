#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildApp } from './app.js';

// `dist/` sits next to `package.json`, so this resolves the same in a checkout and once installed.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const host = process.env.KINOSHELF_HOST ?? '0.0.0.0';
const port = Number(process.env.KINOSHELF_PORT ?? 8484);

const app = await buildApp({ version, logger: true });
await app.listen({ host, port });
