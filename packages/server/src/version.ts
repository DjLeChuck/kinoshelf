import { readFileSync } from 'node:fs';

/**
 * Set by the bundler of the standalone binary (`--define:KINOSHELF_VERSION=…`), where there is no
 * `package.json` to read.
 */
declare const KINOSHELF_VERSION: string | undefined;

/**
 * `dist/` sits next to `package.json`, so the file resolves the same in a checkout and once
 * installed.
 */
export function serverVersion(): string {
  if (typeof KINOSHELF_VERSION !== 'undefined') return KINOSHELF_VERSION;
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}
