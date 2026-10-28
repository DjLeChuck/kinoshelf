// Explains an analysis: what is not matched and why, and which works were identified.
//   pnpm --filter @kinoshelf/corpus inspect [results.json]
import { readFileSync } from 'node:fs';
import { absolute, parseArgs, workPath } from './lib.mjs';

const { positional } = parseArgs(process.argv.slice(2));
const { language, results } = JSON.parse(
  readFileSync(positional[0] ? absolute(positional[0]) : workPath('results.json'), 'utf8'),
);

const count = (rows, key) =>
  rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});
const matched = results.filter((r) => r.status === 'matched');
const rest = results.filter((r) => r.status !== 'matched');
console.log(`${results.length} files (${language}): ${JSON.stringify(count(results, 'status'))}`);

console.log('\n=== Not matched, grouped by the title the parser read (largest first)');
const groups = new Map();
for (const r of rest) {
  const key = (r.title ?? '(no title)').toLowerCase().slice(0, 40);
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [title, rows] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const first = rows[0];
  const top = first.cands?.[0];
  const detail = top
    ? `${top.title.slice(0, 34)} (${top.year ?? '?'}) #${top.id} ${top.score}${first.cands[1] ? ` | 2nd ${first.cands[1].score}` : ''}`
    : (first.reason ?? '');
  console.log(
    `${String(rows.length).padStart(4)} ${first.kind.slice(0, 3)} ${title.padEnd(40)} ${detail}`,
  );
  console.log(`       e.g. ${first.path.slice(-100)}`);
}

console.log('\n=== Identified works (what each parsed title became)');
const works = new Map();
for (const r of matched) {
  const key = `${r.tmdb}|${r.mTitle}|${r.mYear}|${r.mKind}`;
  const w = works.get(key) ?? { n: 0, seasons: new Set(), titles: new Set() };
  w.n += 1;
  if (r.season !== undefined) w.seasons.add(r.season);
  w.titles.add(r.title ?? '?');
  works.set(key, w);
}
for (const [key, w] of [...works].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) {
  const [id, title, year, kind] = key.split('|');
  const seasons = [...w.seasons].sort((a, b) => a - b);
  console.log(
    `${id.padStart(8)} ${`${title} (${year})`.slice(0, 44).padEnd(44)} ${kind.padEnd(6)} ${String(w.n).padStart(4)}  ${seasons.length ? `S${seasons[0]}-${seasons.at(-1)}` : '-'}  ${[...w.titles].join(' | ').slice(0, 50)}`,
  );
}
console.log(
  `... ${works.size} distinct works, lowest score ${Math.min(...matched.map((r) => r.score))}, below 90: ${matched.filter((r) => r.score < 90).length}`,
);

const odd = results.filter((r) => (r.season ?? 0) > 60);
if (odd.length)
  console.log(
    `\n!! ${odd.length} files with an implausible season (>60), likely a parser issue:\n${odd
      .slice(0, 5)
      .map((r) => `   ${r.path.slice(-90)} -> S${r.season}`)
      .join('\n')}`,
  );
