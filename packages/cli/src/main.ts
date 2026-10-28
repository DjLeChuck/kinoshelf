#!/usr/bin/env node
import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  io: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    ...(process.stderr.isTTY && {
      progress: (text: string) => process.stderr.write(text ? `\r${text}` : '\r\u001b[K'),
    }),
  },
});
