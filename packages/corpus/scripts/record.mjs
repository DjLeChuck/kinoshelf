// Records the TMDB responses the corpus needs into data/recordings.json, trimmed to the fields
// Kinoshelf reads (search results, alternative titles, seasons). Run with
// `pnpm corpus:record` (needs TMDB_API_KEY in .env, and a build). It prints counts only,
// never a URL: with a v3 key the URL carries the key. Only what is not recorded yet is fetched, so
// adding entries does not rewrite the rest of the file; `--refresh` records everything again
// (TMDB's data drifts, so that rewrites much of it).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { TmdbProvider } from '@kinoshelf/provider-tmdb';
import { Matcher, GuessitParser } from '@kinoshelf/core';
import { aliasesOf } from '../dist/run.js';

const key = process.env.TMDB_API_KEY ?? '';
if (!key) {
  console.error('TMDB_API_KEY is not set');
  process.exit(1);
}

const data = new URL('../data/', import.meta.url);
const entries = JSON.parse(await readFile(new URL('corpus.json', data), 'utf8'));
const refresh = process.argv.includes('--refresh');
const recordings = refresh
  ? {}
  : JSON.parse(await readFile(new URL('recordings.json', data), 'utf8').catch(() => '{}'));
let fetched = 0;

const keyOf = (url) => {
  const query = new URLSearchParams(url.searchParams);
  query.delete('api_key');
  query.sort();
  return `${url.pathname}?${query.toString()}`;
};

const recording = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const known = recordings[keyOf(url)];
  if (known) {
    return new Response(known.body, { status: known.status });
  }
  fetched++;
  const response = await fetch(url, init);
  const body = await response.text();
  if (response.status === 200 || response.status === 404) {
    let stored = body;
    // A season is trimmed to what Kinoshelf reads: episode numbers, names and air dates.
    if (/^\/3\/tv\/\d+\/season\/\d+$/.test(url.pathname) && response.status === 200) {
      const season = JSON.parse(body);
      stored = JSON.stringify({
        season_number: season.season_number,
        episodes: (season.episodes ?? []).map((e) => ({
          season_number: e.season_number,
          episode_number: e.episode_number,
          name: e.name,
          air_date: e.air_date,
        })),
      });
    }
    // A work looked up by id (an alias) is one record shaped like a search result.
    if (/^\/3\/(movie|tv)\/\d+$/.test(url.pathname) && response.status === 200) {
      const keep = url.pathname.startsWith('/3/movie')
        ? ['id', 'title', 'original_title', 'release_date', 'poster_path', 'popularity']
        : [
            'id',
            'name',
            'original_name',
            'first_air_date',
            'origin_country',
            'poster_path',
            'popularity',
          ];
      const work = JSON.parse(body);
      stored = JSON.stringify(
        Object.fromEntries(keep.filter((k) => k in work).map((k) => [k, work[k]])),
      );
    }
    // Search results are 20 long records; keep only the fields Kinoshelf reads.
    if (/^\/3\/search\/(movie|tv)$/.test(url.pathname) && response.status === 200) {
      const keep = url.pathname.endsWith('movie')
        ? ['id', 'title', 'original_title', 'release_date', 'poster_path', 'popularity']
        : [
            'id',
            'name',
            'original_name',
            'first_air_date',
            'origin_country',
            'poster_path',
            'popularity',
          ];
      const search = JSON.parse(body);
      stored = JSON.stringify({
        results: search.results.map((r) =>
          Object.fromEntries(keep.filter((k) => k in r).map((k) => [k, r[k]])),
        ),
      });
    }
    // Alternative titles: only `title` is read (not the country or type of each).
    if (
      /^\/3\/(movie|tv)\/\d+\/alternative_titles$/.test(url.pathname) &&
      response.status === 200
    ) {
      const alt = JSON.parse(body);
      const field = 'titles' in alt ? 'titles' : 'results';
      stored = JSON.stringify({ id: alt.id, [field]: alt[field].map((t) => ({ title: t.title })) });
    }
    recordings[keyOf(url)] = { status: response.status, body: stored };
  }
  return new Response(body, { status: response.status, headers: response.headers });
};

const parser = new GuessitParser();
const providers = new Map();
const matchers = new Map();
for (const entry of entries) {
  const language = entry.language ?? 'en-US';
  if (!providers.has(language)) {
    providers.set(language, new TmdbProvider({ apiKey: key, fetch: recording, language }));
  }
  const parsed = parser.parse(entry.path);
  const aliases = aliasesOf(entry, parsed);
  if (aliases) {
    await new Matcher(providers.get(language), {}, aliases).match(parsed);
    continue;
  }
  if (!matchers.has(language)) {
    matchers.set(language, new Matcher(providers.get(language)));
  }
  await matchers.get(language).match(parsed);
}

const sorted = Object.fromEntries(
  Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)),
);
// Written the way `pnpm format` would, so recording leaves nothing for it to rewrite afterwards.
const file = new URL('recordings.json', data);
const path = fileURLToPath(file);
await writeFile(
  file,
  await format(JSON.stringify(sorted, null, 1), { ...(await resolveConfig(path)), filepath: path }),
);
console.log(
  `recorded ${Object.keys(sorted).length} distinct responses for ${entries.length} entries (${fetched} fetched)`,
);
