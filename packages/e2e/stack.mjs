// The stack the tests run against: the real `kinoshelf-server` (and the built web UI), with a
// fake TMDB standing in for the network. Playwright starts this file and waits for /health.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const { E2E_DIR: dir, E2E_TMDB_PORT: tmdbPort } = process.env;
if (!dir || !tmdbPort) {
  throw new Error('E2E_DIR and E2E_TMDB_PORT are set by playwright.config.ts');
}

// A fresh disk every run: the tests count on what is (not) in the library.
rmSync(dir, { recursive: true, force: true });
for (const folder of ['config', 'incoming', 'library/films', 'library/series']) {
  mkdirSync(join(dir, folder), { recursive: true });
}
// One library of each kind: the first of its type is where a job with no library goes.
writeFileSync(
  join(dir, 'config', 'config.yaml'),
  [
    'libraries:',
    '  - id: films',
    '    name: Films',
    '    type: movie',
    `    source: ${join(dir, 'library', 'films')}`,
    '  - id: series',
    '    name: Series',
    '    type: series',
    `    source: ${join(dir, 'library', 'series')}`,
    '',
  ].join('\n'),
);

const film = (id, title, year, poster) => ({
  id,
  title,
  original_title: title,
  release_date: `${year}-01-01`,
  overview: '',
  poster_path: poster,
  popularity: 10,
});
const catalog = [
  film(438631, 'Dune', 2021, '/dune2021.jpg'),
  film(841, 'Dune', 1984, '/dune1984.jpg'),
  film(348, 'Alien', 1979, '/alien.jpg'),
];

// One show: two seasons, the second not finished, so a library can lack an aired episode and
// still owe nothing for the ones to come. Aired dates are in the past, the unaired one far ahead.
const SHOW_ID = 95396;
const show = {
  id: SHOW_ID,
  name: 'Severance',
  original_name: 'Severance',
  first_air_date: '2022-02-18',
  overview: 'Work and life, split.',
  poster_path: '/severance.jpg',
  popularity: 10,
};
const SEASONS = {
  1: [
    ['Good News About Hell', '2022-02-18'],
    ['Half Loop', '2022-02-18'],
    ['In Perpetuity', '2022-02-25'],
  ],
  2: [
    ['Hello, Ms. Cobel', '2025-01-17'],
    ['Goodbye, Mrs. Selvig', '2999-01-24'],
  ],
};

// A 1x1 PNG, so a poster really renders.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A 1x1 JPEG: a `.jpg` the fake serves is one for real, since an image is written only in the
// format of the file the profile names.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

// What TMDB offers for a work's `/images`: two posters, a background (no text), two logos.
const image = (file_path, iso_639_1, width, height, votes) => ({
  file_path,
  iso_639_1,
  width,
  height,
  vote_average: 5.5,
  vote_count: votes,
});
const IMAGES = {
  posters: [
    image('/posteren.jpg', 'en', 2000, 3000, 22),
    image('/posterfr.jpg', 'fr', 2000, 3000, 14),
  ],
  backdrops: [image('/backdropa.jpg', null, 3840, 2160, 9)],
  logos: [image('/logoen.png', 'en', 1200, 460, 6), image('/logofr.png', 'fr', 800, 310, 3)],
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const json = (body) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  if (url.pathname.startsWith('/t/p/')) {
    const jpeg = url.pathname.endsWith('.jpg');
    response
      .writeHead(200, { 'content-type': jpeg ? 'image/jpeg' : 'image/png' })
      .end(jpeg ? JPEG : PNG);
  } else if (/^\/3\/(movie|tv)\/\d+\/images$/.test(url.pathname)) {
    json(IMAGES);
  } else if (url.pathname === '/3/search/movie') {
    const word = (url.searchParams.get('query') ?? '').toLowerCase().split(' ')[0];
    json({ results: word ? catalog.filter((c) => c.title.toLowerCase().startsWith(word)) : [] });
  } else if (/^\/3\/movie\/\d+$/.test(url.pathname)) {
    // The details an NFO is built from: the film itself, with no cast and no genres.
    const found = catalog.find((c) => `/3/movie/${c.id}` === url.pathname);
    if (found) {
      json({
        ...found,
        backdrop_path: '/backdrop.jpg',
        genres: [],
        credits: { cast: [], crew: [] },
        external_ids: {},
      });
    } else {
      response.writeHead(404).end();
    }
  } else if (url.pathname === '/3/search/tv') {
    const word = (url.searchParams.get('query') ?? '').toLowerCase().split(' ')[0];
    json({ results: word && 'severance'.startsWith(word) ? [show] : [] });
  } else if (url.pathname === `/3/tv/${SHOW_ID}`) {
    json({
      ...show,
      backdrop_path: '/backdrop.jpg',
      status: 'Returning Series',
      genres: [{ id: 18, name: 'Drama' }],
      credits: { cast: [], crew: [] },
      external_ids: {},
      seasons: Object.keys(SEASONS).map((number) => ({
        season_number: Number(number),
        name: `Season ${number}`,
        poster_path: null,
      })),
    });
  } else if (new RegExp(`^/3/tv/${SHOW_ID}/season/\\d+$`).test(url.pathname)) {
    const number = Number(url.pathname.split('/').pop());
    const episodes = SEASONS[number];
    if (episodes) {
      json({
        season_number: number,
        episodes: episodes.map(([name, air_date], index) => ({
          season_number: number,
          episode_number: index + 1,
          name,
          air_date,
        })),
      });
    } else {
      response.writeHead(404).end();
    }
  } else if (/\/alternative_titles$/.test(url.pathname)) {
    json({ titles: [], results: [] });
  } else {
    response.writeHead(404).end();
  }
}).listen(Number(tmdbPort), '127.0.0.1');

const serverMain = new URL('../server/dist/main.js', import.meta.url);
await import(serverMain.href);
