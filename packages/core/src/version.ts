import { readFileSync } from 'node:fs';

/**
 * Set by the bundler of the standalone binary (`--define:KINOSHELF_VERSION=…`), where there is no
 * `package.json` to read.
 */
declare const KINOSHELF_VERSION: string | undefined;

/**
 * The version of the package whose `package.json` is at `manifest`. `dist/` sits next to it, so
 * `new URL('../package.json', import.meta.url)` resolves the same in a checkout and once installed.
 */
export function packageVersion(manifest: URL): string {
  if (typeof KINOSHELF_VERSION !== 'undefined') return KINOSHELF_VERSION;
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}
