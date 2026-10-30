// The stack the tests run against: the real `kinoshelf-server` (and the built web UI), with a
// fake TMDB standing in for the network. Playwright starts this file and waits for /health.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { E2E_DIR: dir, E2E_TMDB_PORT: tmdbPort } = process.env;
if (!dir || !tmdbPort) {
  throw new Error('E2E_DIR and E2E_TMDB_PORT are set by playwright.config.ts');
}

// A fresh disk every run: the tests count on what is (not) in the library.
rmSync(dir, { recursive: true, force: true });
for (const folder of ['config', 'incoming', 'library']) {
  mkdirSync(join(dir, folder), { recursive: true });
}
writeFileSync(join(dir, 'config', 'config.yaml'), `destination: ${join(dir, 'library')}\n`);

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

// A 1x1 PNG, so a poster really renders.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const json = (body) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  if (url.pathname.startsWith('/t/p/')) {
    response.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
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
    json({ results: [] });
  } else if (/\/alternative_titles$/.test(url.pathname)) {
    json({ titles: [], results: [] });
  } else {
    response.writeHead(404).end();
  }
}).listen(Number(tmdbPort), '127.0.0.1');

const serverMain = new URL('../server/dist/main.js', import.meta.url);
await import(pathToFileURL(serverMain.pathname).href);
