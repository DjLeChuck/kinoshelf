// The stack the tests run against: the real `kinoshelf-server` and the built web UI (or the
// standalone binary, see the end), with a fake TMDB standing in for the network. Playwright
// starts this file and waits for /health.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const { E2E_DIR: dir, E2E_TMDB_PORT: tmdbPort, E2E_PLEX_PORT: plexPort } = process.env;
if (!dir || !tmdbPort || !plexPort) {
  throw new Error('E2E_DIR, E2E_TMDB_PORT and E2E_PLEX_PORT are set by playwright.config.ts');
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
    // The specs read names with the id and no metadata files; the defaults are no-id and nfo.
    'naming: with-id',
    'metadata: none',
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
  } else if (/^\/3\/tv\/\d+\/season\/\d+\/episode\/\d+\/images$/.test(url.pathname)) {
    // An episode's stills: no text on them.
    json({
      stills: [
        image('/stilla.jpg', null, 1920, 1080, 8),
        image('/stillb.jpg', null, 1920, 1080, 3),
      ],
    });
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
        // Dune belongs to a saga of which the library can hold only the first film.
        ...(found.id === 438631 && {
          belongs_to_collection: { id: 726871, name: 'Dune - Saga' },
        }),
      });
    } else {
      response.writeHead(404).end();
    }
  } else if (url.pathname === '/3/collection/726871') {
    json({
      id: 726871,
      name: 'Dune - Saga',
      overview: 'Spice.',
      parts: [
        { id: 438631, title: 'Dune', release_date: '2021-09-15' },
        { id: 693134, title: 'Dune : Part Two', release_date: '2024-02-27' },
      ],
    });
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

// A fake plex.tv, enough for the sign-in: opening its approval page (what the user does in the
// tab Kinoshelf opens) claims the PIN. Signatures are checked by the server's own tests, which
// hold a fake that verifies them; this one only proves the page walks the whole way.
let claimed = false;
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const plexToken = () =>
  `${part({ alg: 'EdDSA' })}.${part({ exp: Math.floor(Date.now() / 1000) + 7 * 86400 })}.sig`;
createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://plex.test');
  const json = (body) =>
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (url.pathname === '/auth') {
    claimed = true;
    response.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Kinoshelf approved</h1>');
  } else if (request.method === 'POST' && url.pathname === '/api/v2/pins') {
    claimed = false;
    json({ id: 111, code: 'e2e-pin' });
  } else if (url.pathname === '/api/v2/pins/111') {
    json({ authToken: claimed ? plexToken() : null });
  } else if (url.pathname === '/api/v2/auth/nonce') {
    json({ nonce: 'e2e-nonce' });
  } else if (request.method === 'POST' && url.pathname === '/api/v2/auth/token') {
    json({ auth_token: plexToken() });
  } else if (url.pathname === '/api/v2/resources') {
    json([
      {
        name: 'Living room',
        provides: 'server',
        owned: true,
        connections: [
          { uri: 'https://relay.plex.example:8443', local: false, relay: true },
          {
            uri: 'https://192-168-1-10.0123456789abcdef0123456789abcdef.plex.direct:32400',
            local: true,
            relay: false,
          },
        ],
      },
    ]);
  } else {
    response.writeHead(404).end();
  }
}).listen(Number(plexPort), '127.0.0.1');

// `KINOSHELF_E2E_BINARY`: the standalone binary (an absolute path) instead of the built server, so
// the same specs prove the executable that gets released. It takes the environment as it is.
const binary = process.env.KINOSHELF_E2E_BINARY;
if (binary) {
  const child = spawn(binary, ['serve'], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', (error) => {
    console.error(`Cannot run ${binary}: ${error.message}`);
    process.exit(1);
  });
  // The fake TMDB and plex.tv die with this process, which follows the binary.
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const serverMain = new URL('../server/dist/main.js', import.meta.url);
  await import(serverMain.href);
}
