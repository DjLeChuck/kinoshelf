// Runs the real parser and matcher, against the live TMDB, over a list of paths.
//   pnpm --filter @kinoshelf/corpus analyze /abs/path/list.txt [--language fr] [--out results.json]
//                                                          [--matching '{"threshold":85}']
// List format: one path per line (relative or absolute), as from `find`. Only video files are
// kept, and hidden entries
// (`._x.avi` from macOS, dotfiles) are skipped, as the scanner skips them. Needs TMDB_API_KEY
// (.env). TMDB answers are cached on disk in .work/, so a rerun after a code change is free.
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import Database from 'better-sqlite3';
import { GuessitParser, Matcher, VIDEO_EXTENSIONS, isSample } from '@kinoshelf/core';
import { SqliteHttpCache, TmdbProvider } from '@kinoshelf/provider-tmdb';
import { absolute, parseArgs, workPath } from './lib.mjs';

const { options, positional } = parseArgs(process.argv.slice(2));
const [list] = positional;
if (!list) {
  console.error(
    'usage: analyze <list.txt> [--language fr] [--out results.json] [--matching <json>]',
  );
  process.exit(2);
}
if (!process.env.TMDB_API_KEY) {
  console.error('TMDB_API_KEY is not set (put it in .env)');
  process.exit(1);
}

const language = typeof options.language === 'string' ? options.language : 'en-US';
const out = typeof options.out === 'string' ? absolute(options.out) : workPath('results.json');
const matching = typeof options.matching === 'string' ? JSON.parse(options.matching) : {};

const all = readFileSync(absolute(list), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.replace(/^\.\//, ''));
// A raw `find` lists everything: keep video files only (samples excluded), as the scanner does.
const videos = all.filter(
  (p) => VIDEO_EXTENSIONS.includes(extname(p).slice(1).toLowerCase()) && !isSample(p),
);
const lines = videos.filter((p) => !p.split('/').some((segment) => segment.startsWith('.')));
console.error(
  `${all.length} lines, ${all.length - videos.length} not video, ${videos.length - lines.length} hidden, ${lines.length} to match (language ${language})`,
);

const database = new Database(workPath(`tmdb-cache-${language}.sqlite`));
const provider = new TmdbProvider({
  apiKey: process.env.TMDB_API_KEY,
  language,
  concurrency: 8,
  cache: new SqliteHttpCache(database),
});
const parser = new GuessitParser();
const matcher = new Matcher(provider, matching);

const results = new Array(lines.length);
let next = 0;
let done = 0;
async function worker() {
  while (next < lines.length) {
    const index = next++;
    const path = lines[index];
    const parsed = parser.parse(path);
    let outcome;
    try {
      outcome = await matcher.match(parsed);
    } catch (error) {
      outcome = { status: 'error', reason: String(error.info?.code ?? error.message) };
    }
    const best = outcome.status === 'matched' ? outcome.best : undefined;
    results[index] = {
      path,
      kind: parsed.kind,
      title: parsed.title,
      subtitle: parsed.subtitle,
      year: parsed.year,
      season: parsed.season,
      episodes: parsed.episodes,
      country: parsed.country,
      status: outcome.status,
      tmdb: best?.candidate.id.id,
      mTitle: best?.candidate.title,
      mYear: best?.candidate.year,
      mKind: best?.candidate.kind,
      score: best?.score,
      cands:
        outcome.status === 'ambiguous'
          ? outcome.candidates.slice(0, 3).map((c) => ({
              id: c.candidate.id.id,
              title: c.candidate.title,
              year: c.candidate.year,
              score: c.score,
            }))
          : undefined,
      reason: outcome.reason,
    };
    if (++done % 500 === 0) console.error(`  ${done}/${lines.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

writeFileSync(out, JSON.stringify({ language, results }));
const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(`done: ${JSON.stringify(counts)} -> ${out}`);
