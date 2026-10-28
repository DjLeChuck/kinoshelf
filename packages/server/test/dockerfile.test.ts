import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');

/** `find -iname` globs of the Dockerfile's cleanup step, as case-insensitive regular expressions. */
function cleanupPatterns(): RegExp[] {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  return [...dockerfile.matchAll(/-i?name '([^']+)'/g)].map(
    ([, glob]) =>
      new RegExp(
        `^${(glob ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`,
        'i',
      ),
  );
}

describe('the Docker image cleanup', () => {
  // The cleanup deletes by name across the whole dependency tree, ours included: a module named
  // like a README or a history file would vanish from the image and the server would not start.
  it.each([
    'core/src',
    'i18n/src',
    'server/src',
    'server/src/notify',
    'providers/tmdb/src',
    'cli/src',
  ])('does not delete any module of packages/%s', (directory) => {
    const patterns = cleanupPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    const names = readdirSync(join(root, 'packages', directory)).flatMap((file) =>
      file.endsWith('.ts') ? [file.replace(/\.ts$/, '.js'), file.replace(/\.ts$/, '.d.ts')] : [],
    );
    const hit = names.filter((name) => patterns.some((pattern) => pattern.test(name)));
    // `.d.ts` files are deleted on purpose: only the runtime modules matter.
    expect(hit.filter((name) => !name.endsWith('.d.ts'))).toEqual([]);
  });

  it('would have caught the glob that deleted history.js', () => {
    const loose = new RegExp('^HISTORY.*$', 'i');
    expect(loose.test('history.js')).toBe(true);
    expect(cleanupPatterns().some((pattern) => pattern.test('history.js'))).toBe(false);
  });
});
