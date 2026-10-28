// Records the TMDB responses the corpus needs into data/recordings.json. Run with
// `pnpm corpus:record` (needs TMDB_API_KEY in .env, and a build). It prints counts only,
// never a URL: with a v3 key the URL carries the key.
import { readFile, writeFile } from 'node:fs/promises';
import { TmdbProvider } from '@kinoshelf/provider-tmdb';
import { Matcher, GuessitParser } from '@kinoshelf/core';

const key = process.env.TMDB_API_KEY ?? '';
if (!key) {
  console.error('TMDB_API_KEY is not set');
  process.exit(1);
}

const data = new URL('../data/', import.meta.url);
const entries = JSON.parse(await readFile(new URL('corpus.json', data), 'utf8'));
const recordings = {};

const keyOf = (url) => {
  const query = new URLSearchParams(url.searchParams);
  query.delete('api_key');
  query.sort();
  return `${url.pathname}?${query.toString()}`;
};

const recording = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const response = await fetch(url, init);
  const body = await response.text();
  if (response.status === 200 || response.status === 404) {
    let stored = body;
    // Cast and crew lists make season responses huge and Kinoshelf never reads them.
    if (/^\/3\/tv\/\d+\/season\/\d+$/.test(url.pathname) && response.status === 200) {
      const season = JSON.parse(body);
      for (const episode of season.episodes ?? []) {
        delete episode.crew;
        delete episode.guest_stars;
      }
      stored = JSON.stringify(season);
    }
    recordings[keyOf(url)] = { status: response.status, body: stored };
  }
  return new Response(body, { status: response.status, headers: response.headers });
};

const provider = new TmdbProvider({ apiKey: key, fetch: recording, language: 'en-US' });
const parser = new GuessitParser();
const matcher = new Matcher(provider);

for (const entry of entries) {
  await matcher.match(parser.parse(entry.path));
}

const sorted = Object.fromEntries(
  Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)),
);
await writeFile(new URL('recordings.json', data), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(
  `recorded ${Object.keys(sorted).length} distinct responses for ${entries.length} entries`,
);
