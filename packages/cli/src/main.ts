#!/usr/bin/env node
import { isSea } from 'node:sea';
import { packageVersion } from '@kinoshelf/core';
import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  version: packageVersion(new URL('../package.json', import.meta.url)),
  standalone: isSea(),
  io: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    ...(process.stderr.isTTY && {
      progress: (text: string) => process.stderr.write(text ? `\r${text}` : '\r\u001b[K'),
    }),
  },
});
