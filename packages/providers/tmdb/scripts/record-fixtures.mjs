// Records real TMDB responses into test/fixtures. Run with `pnpm fixtures:record` (needs
// TMDB_API_KEY, see .env). It logs file names and statuses only: never a URL or a header,
// because with a v3 key the URL carries the key.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';

const key = process.env.TMDB_API_KEY ?? '';
if (!key) {
  console.error('TMDB_API_KEY is not set');
  process.exit(1);
}

const dir = new URL('../test/fixtures/', import.meta.url);
const TOP = 5;

async function get(path, params = {}) {
  const url = new URL(path, 'https://api.themoviedb.org');
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }
  const headers = { accept: 'application/json' };
  if (key.startsWith('eyJ')) {
    headers.authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set('api_key', key);
  }
  const response = await fetch(url, { headers });
  return { status: response.status, json: await response.json() };
}

async function save(name, { status, json }, expected = 200) {
  if (status !== expected) {
    throw new Error(`${name}: expected status ${expected}, got ${status}`);
  }
  await writeFile(new URL(name, dir), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`recorded ${name} (${status})`);
}

await mkdir(dir, { recursive: true });
for (const file of await readdir(dir)) {
  if (file.endsWith('.json')) {
    await rm(new URL(file, dir));
  }
}

const common = { include_adult: 'false', language: 'en-US' };

const movies = await get('/3/search/movie', { query: 'Dune', year: 2021, ...common });
await save('search-movie-dune-2021.json', movies);
for (const { id } of movies.json.results.slice(0, TOP)) {
  const alt = await get(`/3/movie/${id}/alternative_titles`);
  if (alt.status === 200) {
    await save(`alt-titles-movie-${id}.json`, alt);
  }
}

const shows = await get('/3/search/tv', {
  query: 'The Bear',
  first_air_date_year: 2022,
  ...common,
});
await save('search-tv-the-bear-2022.json', shows);
for (const { id } of shows.json.results.slice(0, TOP)) {
  const alt = await get(`/3/tv/${id}/alternative_titles`);
  if (alt.status === 200) {
    await save(`alt-titles-tv-${id}.json`, alt);
  }
}

// Cast and crew lists make season responses huge and Kinoshelf never reads them.
const season = await get('/3/tv/136315/season/3', { language: 'en-US' });
for (const episode of season.json.episodes ?? []) {
  delete episode.crew;
  delete episode.guest_stars;
}
await save('season-136315-3.json', season);
await save(
  'season-136315-99.json',
  await get('/3/tv/136315/season/99', { language: 'en-US' }),
  404,
);
