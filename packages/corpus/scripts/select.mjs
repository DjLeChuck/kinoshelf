// Prunes an analysis into corpus entries: one episode per series, plus movies picked to stress
// the matcher, plus hand-picked cases. It also lists what a human must confirm.
//   pnpm --filter @kinoshelf/corpus select [results.json] [--seed 2026] [--curated curated.json]
//                                          [--out entries.json]
// The expected result of a matched file comes from the matcher, so it proves nothing by itself:
// the entries whose title and year agree with the file name are marked verified, the others go
// to `<out>.confirm.json` for a human to check. `--curated` is a JSON array of
//   { "match": "<substring of a path>", "outcome": "review" | "matched", "tmdb": 123, "note": "why" }
// for the files that are not simply "matched" (homonyms, numbering differences, known gaps...).
import { readFileSync, writeFileSync } from 'node:fs';
import {
  absolute,
  lastSegments,
  norm,
  parseArgs,
  seasonEpisodes,
  seeded,
  workPath,
} from './lib.mjs';

const { options, positional } = parseArgs(process.argv.slice(2));
const { language, results } = JSON.parse(
  readFileSync(positional[0] ? absolute(positional[0]) : workPath('results.json'), 'utf8'),
);
const out = typeof options.out === 'string' ? absolute(options.out) : workPath('entries.json');
const random = seeded(Number(options.seed ?? 2026));
const fileName = (r) => r.path.split('/').at(-1);

const matched = results.filter((r) => r.status === 'matched');
const movies = matched.filter((r) => r.mKind === 'movie');
const shows = matched.filter((r) => r.mKind === 'series' && seasonEpisodes(fileName(r)));

const chosen = new Set(); // works already represented
const take = (pool, n) => {
  const free = pool.filter((r) => !chosen.has(r.tmdb));
  for (let i = free.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const picked = free.slice(0, n);
  picked.forEach((r) => chosen.add(r.tmdb));
  return picked;
};

// One episode per series, from the middle of what the library holds.
const bySeries = new Map();
for (const r of shows) bySeries.set(r.tmdb, [...(bySeries.get(r.tmdb) ?? []), r]);
const selected = [];
for (const [id, rows] of bySeries) {
  rows.sort((a, b) => a.season - b.season || (a.episodes[0] ?? 0) - (b.episodes[0] ?? 0));
  selected.push(rows[Math.floor(rows.length / 2)]);
  chosen.add(id);
}
// Movies that stress something: a subtitle after a dash, a digit or roman numeral in the title,
// apostrophes or accents, a score below 100, then a few ordinary ones as a control.
selected.push(
  ...take(
    movies.filter((r) => fileName(r).includes(' - ')),
    22,
  ),
  ...take(
    movies.filter((r) => /\b\d\b|\b[IVX]{2,}\b/.test(r.title ?? '')),
    12,
  ),
  ...take(
    movies.filter((r) => /['’&:!]/.test(fileName(r)) || /[éèêàçôûîïëü]/i.test(r.title ?? '')),
    12,
  ),
  ...take(
    movies.filter((r) => r.score < 100),
    10,
  ),
  ...take(movies, 10),
);

const confirm = [];
const entries = selected.map((r) => {
  const isSeries = r.mKind === 'series';
  const expect = isSeries
    ? { status: 'matched', tmdb: r.tmdb, kind: 'series', ...seasonEpisodes(fileName(r)) }
    : { status: 'matched', tmdb: r.tmdb, kind: 'movie' };
  const name = norm(fileName(r));
  const title = norm(r.mTitle);
  const verified = isSeries
    ? title === norm(r.title) || title.startsWith(norm(r.title))
    : r.year === r.mYear &&
      (name.includes(title) || name.startsWith(title.slice(0, Math.max(6, title.length - 4))));
  if (!verified) confirm.push({ tmdb: r.tmdb, title: r.mTitle, year: r.mYear, path: r.path });
  return {
    path: lastSegments(r.path),
    ...(language !== 'en-US' && { language }),
    note: 'from a real library',
    expect,
  };
});

if (typeof options.curated === 'string') {
  for (const item of JSON.parse(readFileSync(absolute(options.curated), 'utf8'))) {
    const r = results.find((x) => x.path.includes(item.match));
    if (!r) throw new Error(`curated: no path contains "${item.match}"`);
    const se = seasonEpisodes(fileName(r));
    const expect =
      item.outcome === 'review'
        ? { status: 'review' }
        : { status: 'matched', tmdb: item.tmdb, kind: se ? 'series' : 'movie', ...se };
    entries.push({
      path: lastSegments(r.path),
      ...(language !== 'en-US' && { language }),
      note: `from a real library. ${item.note}`,
      expect,
    });
  }
}

writeFileSync(out, JSON.stringify(entries, null, 1));
writeFileSync(out.replace(/\.json$/, '.confirm.json'), JSON.stringify(confirm, null, 1));
console.log(
  `${entries.length} entries (${bySeries.size} series, ${entries.length - bySeries.size} others) -> ${out}`,
);
console.log(
  `${confirm.length} to confirm by a human -> ${out.replace(/\.json$/, '.confirm.json')}`,
);
for (const c of confirm)
  console.log(`  #${c.tmdb} ${c.title} (${c.year})  <- ${c.path.slice(-90)}`);
