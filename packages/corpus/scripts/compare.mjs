// Compares two analyses of the same list, to check a change against real files.
//   pnpm --filter @kinoshelf/corpus compare before.json after.json
// A file matched before and not matched to the same work now is a regression to understand;
// a file not matched before and matched now is an improvement to look at (is it the right work?).
import { readFileSync } from 'node:fs';
import { absolute, parseArgs } from './lib.mjs';

const { positional } = parseArgs(process.argv.slice(2));
const [a, b] = positional.map((p) => JSON.parse(readFileSync(absolute(p), 'utf8')).results);
if (!a || !b || a.length !== b.length) {
  console.error('usage: compare before.json after.json (same list)');
  process.exit(2);
}
const changed = a
  .map((x, i) => [x, b[i]])
  .filter(([x, y]) => x.status === 'matched' && (y.status !== 'matched' || y.tmdb !== x.tmdb));
const gained = a
  .map((x, i) => [x, b[i]])
  .filter(([x, y]) => x.status !== 'matched' && y.status === 'matched');
const tally = (rows) => rows.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());

console.log(
  `matched before: ${a.filter((r) => r.status === 'matched').length}, after: ${b.filter((r) => r.status === 'matched').length}`,
);
console.log(`\nMatched before and different now: ${changed.length}`);
for (const [key, n] of tally(
  changed.map(
    ([x, y]) =>
      `${x.mTitle} (${x.mYear}) -> ${y.status} ${y.mTitle ?? ''} ${y.mYear ?? ''}  e.g. ${x.path.slice(-60)}`,
  ),
))
  console.log(`  ${n}x ${key}`);
console.log(`\nNewly matched: ${gained.length}`);
for (const [key, n] of tally(
  gained.map(([, y]) => `${y.mTitle} (${y.mYear}) #${y.tmdb} score ${y.score}`),
).entries())
  console.log(`  ${n}x ${key}`);
process.exitCode = 0;
