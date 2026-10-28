// Adds entries to data/corpus.json, skipping a (path, language) already there.
//   pnpm --filter @kinoshelf/corpus merge [entries.json]
// Then run `corpus:record` (needs TMDB_API_KEY) and `corpus:report`.
import { readFileSync, writeFileSync } from 'node:fs';
import { absolute, parseArgs, workPath } from './lib.mjs';

const { positional } = parseArgs(process.argv.slice(2));
const incoming = JSON.parse(
  readFileSync(positional[0] ? absolute(positional[0]) : workPath('entries.json'), 'utf8'),
);
const file = new URL('../data/corpus.json', import.meta.url);
const corpus = JSON.parse(readFileSync(file, 'utf8'));

const known = new Set(corpus.map((e) => `${e.path}|${e.language ?? ''}`));
const added = incoming.filter((e) => !known.has(`${e.path}|${e.language ?? ''}`));
// Before the trailing "review" cases written by hand, so the file keeps its shape.
const at = corpus.findIndex((e) => e.path.startsWith('Show.Name'));
corpus.splice(at === -1 ? corpus.length : at, 0, ...added);
writeFileSync(file, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(
  `${added.length} added (${incoming.length - added.length} already there) -> ${corpus.length} entries. Run prettier, then corpus:record and corpus:report.`,
);
