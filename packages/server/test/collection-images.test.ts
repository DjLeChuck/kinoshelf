import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CollectionInfo, MetadataProvider } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { syncState } from '../src/collection-images.js';
import { PlexClient, parseChildren, parseCollections } from '../src/notify/plex.js';
import { JellyfinClient, parseItems } from '../src/notify/jellyfin.js';
import { pickCollection } from '../src/notify/collection-images.js';
import { closeFakeServers, fakeServer, type Received } from './fake-server.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(async () => {
  await cleanup();
  await closeFakeServers();
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const COLLECTION = { provider: 'tmdb', id: 726871 };
const DUNE = { provider: 'tmdb', id: 438631 };
const KEY = 'tmdb:726871';

describe('syncState', () => {
  const image = { hash: 'aaa' };
  const at = '2026-11-01T10:00:00.000Z';

  it('is `default` when nothing was chosen, whatever a server was sent', () => {
    expect(syncState(undefined, undefined).state).toBe('default');
    expect(syncState(undefined, { state: 'sent', hash: 'aaa', at, message: null }).state).toBe(
      'default',
    );
  });

  it('is `pending` for a choice no send has left a trace of', () => {
    expect(syncState(image, undefined).state).toBe('pending');
  });

  it('is `sent` while the image sent is the image chosen, `pending` once it changed', () => {
    const sent = { state: 'sent', hash: 'aaa', at, message: null } as const;
    expect(syncState(image, sent)).toEqual({ state: 'sent', at, message: null });
    expect(syncState({ hash: 'bbb' }, sent).state).toBe('pending');
  });

  it('keeps `missing` and `error` as they were left, with the message', () => {
    expect(syncState(image, { state: 'missing', hash: null, at, message: null }).state).toBe(
      'missing',
    );
    expect(syncState(image, { state: 'error', hash: null, at, message: 'HTTP 400' })).toEqual({
      state: 'error',
      at,
      message: 'HTTP 400',
    });
  });
});

describe('pickCollection', () => {
  it('takes a lone candidate as it is', () => {
    expect(pickCollection([{ id: '7', titles: [] }], ['Dune'])).toBe('7');
  });

  it('tells collections of the same name apart by the movies they hold', () => {
    const candidates = [
      { id: 'a', titles: ['Le Hobbit', 'Un voyage inattendu'] },
      { id: 'b', titles: ['Dune', 'Dune : Deuxième partie'] },
    ];
    expect(pickCollection(candidates, ['dune', 'Dune : Deuxieme partie'])).toBe('b');
  });

  it('takes none when no movie is shared, rather than a coin toss', () => {
    const candidates = [
      { id: 'a', titles: ['X'] },
      { id: 'b', titles: ['Y'] },
    ];
    expect(pickCollection(candidates, ['Dune'])).toBeUndefined();
  });
});

const COLLECTIONS_XML = (entries: [string, string][]): string =>
  `<MediaContainer>${entries
    .map(([id, title]) => `<Directory ratingKey="${id}" title="${title}" type="collection"/>`)
    .join('')}</MediaContainer>`;
const SECTIONS_XML =
  '<MediaContainer><Directory key="3" type="movie"><Location path="/mnt/movies"/></Directory></MediaContainer>';

describe('PlexClient collections', () => {
  const logger = { info: () => undefined, warn: () => undefined };

  function plex(answers: Record<string, string>) {
    const calls: { method: string; url: string; body?: string | Uint8Array; headers: object }[] =
      [];
    const client = new PlexClient(
      { url: 'http://plex:32400', token: 'T', paths: [{ from: '/films', to: '/mnt/movies' }] },
      (request) => {
        calls.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          ...(request.body !== undefined && { body: request.body }),
        });
        const path = request.url.replace('http://plex:32400', '');
        const text = answers[path];
        return Promise.resolve(
          text === undefined
            ? { ok: request.method === 'POST', status: 200, attempts: 1 }
            : { ok: true, status: 200, attempts: 1, text },
        );
      },
      logger,
    );
    return { client, calls };
  }

  it('reads the collections and their movies', () => {
    expect(parseCollections(COLLECTIONS_XML([['9', 'Dune - Saga']]))).toEqual([
      { id: '9', title: 'Dune - Saga' },
    ]);
    expect(
      parseChildren(
        '<MediaContainer><Video title="Dune"/><Video title="Dune 2"/></MediaContainer>',
      ),
    ).toEqual(['Dune', 'Dune 2']);
  });

  it('looks for the collection in the section holding the library, by name', async () => {
    const { client, calls } = plex({
      '/library/sections': SECTIONS_XML,
      '/library/sections/3/collections': COLLECTIONS_XML([
        ['8', 'Autre'],
        ['9', 'Dune - Saga'],
      ]),
    });
    const found = await client.find({
      name: 'dune - saga',
      titles: ['Dune'],
      libraryPath: '/films/Dune (2021)',
    });
    expect(found).toEqual({ status: 'found', id: '9' });
    expect(calls.map((call) => call.url)).toEqual([
      'http://plex:32400/library/sections',
      'http://plex:32400/library/sections/3/collections',
    ]);
  });

  it('says `missing` when the section has no collection of that name', async () => {
    const { client } = plex({
      '/library/sections': SECTIONS_XML,
      '/library/sections/3/collections': COLLECTIONS_XML([['8', 'Autre']]),
    });
    expect(
      await client.find({ name: 'Dune - Saga', titles: [], libraryPath: '/films/Dune' }),
    ).toEqual({ status: 'missing' });
  });

  it('picks, among collections of the same name, the one holding our movies', async () => {
    const { client } = plex({
      '/library/sections': SECTIONS_XML,
      '/library/sections/3/collections': COLLECTIONS_XML([
        ['1', 'Saga'],
        ['2', 'Saga'],
      ]),
      '/library/collections/1/children': '<MediaContainer><Video title="Alien"/></MediaContainer>',
      '/library/collections/2/children': '<MediaContainer><Video title="Dune"/></MediaContainer>',
    });
    expect(await client.find({ name: 'Saga', titles: ['Dune'], libraryPath: '/films/x' })).toEqual({
      status: 'found',
      id: '2',
    });
  });

  it('uploads the poster and the background as the body of a POST, with the image’s type', async () => {
    const { client, calls } = plex({});
    await client.upload('9', 'poster', { bytes: JPEG, mime: 'image/jpeg' });
    await client.upload('9', 'fanart', { bytes: JPEG, mime: 'image/png' });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'http://plex:32400/library/metadata/9/posters',
        body: JPEG,
        headers: { 'X-Plex-Token': 'T', Accept: 'application/xml', 'Content-Type': 'image/jpeg' },
      },
      {
        method: 'POST',
        url: 'http://plex:32400/library/metadata/9/arts',
        body: JPEG,
        headers: { 'X-Plex-Token': 'T', Accept: 'application/xml', 'Content-Type': 'image/png' },
      },
    ]);
  });
});

describe('JellyfinClient collections', () => {
  const logger = { info: () => undefined, warn: () => undefined };

  function jellyfin(listing: string) {
    const calls: { method: string; url: string; body?: string | Uint8Array; headers: object }[] =
      [];
    const client = new JellyfinClient(
      { url: 'http://jf:8096', apiKey: 'KEY' },
      (request) => {
        calls.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          ...(request.body !== undefined && { body: request.body }),
        });
        return Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          ...(request.method === 'GET' && { text: listing }),
        });
      },
      logger,
    );
    return { client, calls };
  }

  it('searches the box sets by name and checks the name again', async () => {
    const { client, calls } = jellyfin(
      JSON.stringify({
        Items: [
          { Id: 'x', Name: 'Dune - Saga (2)' },
          { Id: 'jf1', Name: 'Dune - Saga' },
        ],
      }),
    );
    expect(parseItems(JSON.stringify({ Items: [{ Id: 'a', Name: 'B' }] }))).toEqual([
      { id: 'a', name: 'B' },
    ]);
    const found = await client.find({ name: 'Dune - Saga', titles: [], libraryPath: '/films' });
    expect(found).toEqual({ status: 'found', id: 'jf1' });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/Items');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      IncludeItemTypes: 'BoxSet',
      Recursive: 'true',
      SearchTerm: 'Dune - Saga',
    });
    expect(calls[0]?.headers).toEqual({ Authorization: 'MediaBrowser Token="KEY"' });
  });

  it('uploads the poster as base64 text with the image’s type', async () => {
    const { client, calls } = jellyfin('{}');
    await client.upload('jf1', 'poster', { bytes: JPEG, mime: 'image/jpeg' });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'http://jf:8096/Items/jf1/Images/Primary',
        headers: { Authorization: 'MediaBrowser Token="KEY"', 'content-type': 'image/jpeg' },
        body: Buffer.from(JPEG).toString('base64'),
      },
    ]);
  });

  it('replaces the background: the first one is deleted, the new one is added', async () => {
    const { client, calls } = jellyfin('{}');
    await client.upload('jf1', 'fanart', { bytes: JPEG, mime: 'image/png' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'DELETE http://jf:8096/Items/jf1/Images/Backdrop/0',
      'POST http://jf:8096/Items/jf1/Images/Backdrop',
    ]);
  });
});

// ---- The screen, against real local servers ----

const saga: MetadataProvider = {
  ...fakeProvider,
  getMovieDetails: async (id) => {
    const details = await fakeProvider.getMovieDetails(id);
    return details && id.id === DUNE.id
      ? { ...details, collection: { id: COLLECTION, name: 'Dune - Saga' } }
      : details;
  },
  getCollection: (): Promise<CollectionInfo | null> =>
    Promise.resolve({
      id: COLLECTION,
      name: 'Dune - Saga',
      posterPath: '/collectionposter.jpg',
      // TMDB's order is not the releases': the screen sorts by year.
      parts: [
        { id: { provider: 'tmdb', id: 693134 }, title: 'Dune : Deuxième partie', year: 2024 },
        { id: DUNE, title: 'Dune', year: 2021 },
      ],
    }),
};

interface ServerState {
  state: string;
  message: string | null;
}
interface Summary {
  key: string;
  name: string;
  status: string;
  images: { poster: { source: { type: string } } | null; fanart: unknown };
  servers: { kind: string; states: { poster: ServerState; fanart: ServerState } }[];
}
interface Task {
  status: string;
  outcomes: { key: string; sent: number; missing: number; failures: { error: string }[] }[];
}

async function screen(options: { plexKnows?: boolean } = {}) {
  const root = await makeDir();
  await put(join(root, 'Dune.2021.mkv'), 'dune');
  const known = { plex: options.plexKnows ?? true, jellyfin: true };
  /** What Plex answers the next uploads, one each; 200 once the list is empty. */
  const plexUploads: number[] = [];
  /** What TMDB’s image server serves: another picture makes another hash. */
  const served = { bytes: JPEG };
  const plex = await fakeServer((r: Received) => {
    if (r.url === '/library/sections') {
      return { body: SECTIONS_XML };
    }
    if (r.url === '/library/sections/3/collections') {
      return { body: COLLECTIONS_XML(known.plex ? [['900', 'Dune - Saga']] : []) };
    }
    return r.method === 'POST' ? { status: plexUploads.shift() ?? 200 } : {};
  });
  const jellyfin = await fakeServer((r) =>
    r.url.startsWith('/Items?')
      ? {
          body: JSON.stringify({
            Items: known.jellyfin ? [{ Id: 'jf1', Name: 'Dune - Saga' }] : [],
          }),
        }
      : { status: 204 },
  );
  const configDir = await makeDir();
  const h = await harness({
    createProvider: () => saga,
    configDir,
    fetchImage: () => Promise.resolve(served.bytes),
    config: {
      libraries: [
        {
          id: 'films',
          name: 'Films',
          source: root,
          type: 'movie',
          naming: 'no-id',
          metadata: 'nfo',
        },
        { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
      ],
      apiKey: { plex: 'PTOKEN', jellyfin: 'JKEY' },
      notify: {
        plex: { url: plex.url, paths: [{ from: root, to: '/mnt/movies' }] },
        jellyfin: { url: jellyfin.url },
      },
    },
  });
  const scan = async () => {
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
  };
  await scan();
  const list = async () =>
    (await h.request('GET', '/api/libraries/films/collections')).json<{
      servers: string[];
      pending: number;
      collections: Summary[];
    }>();
  const collection = async (key = KEY) =>
    (await list()).collections.find((one) => one.key === key) as Summary;
  const choose = (type: 'poster' | 'fanart', source = 'tmdb', value = '/collectionposter.jpg') =>
    h.request('PUT', `/api/libraries/films/collections/${encodeURIComponent(KEY)}/images/${type}`, {
      source,
      value,
    });
  const send = async () => {
    const started = await h.request('POST', '/api/libraries/films/collections/send', {});
    expect(started.statusCode).toBe(202);
    return settled();
  };
  const settled = async (): Promise<Task> => {
    for (;;) {
      const { send: task } = (
        await h.request('GET', '/api/libraries/films/collections/send')
      ).json<{
        send: Task | null;
      }>();
      if (task && task.status !== 'running') {
        return task;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const stateOf = async (server: string, type: 'poster' | 'fanart' = 'poster') =>
    (await collection()).servers.find((one) => one.kind === server)?.states[type];
  return {
    h,
    root,
    configDir,
    plex,
    jellyfin,
    known,
    plexUploads,
    served,
    scan,
    list,
    collection,
    choose,
    send,
    settled,
    stateOf,
  };
}

describe('the Collections screen', () => {
  it('lists the effective collections with no image chosen: the servers keep theirs', async () => {
    const { list } = await screen();
    const body = await list();
    expect(body.servers).toEqual(['plex', 'jellyfin']);
    expect(body.pending).toBe(0);
    expect(body.collections).toEqual([
      expect.objectContaining({
        key: KEY,
        status: 'default',
        images: { poster: null, fanart: null },
      }),
    ]);
  });

  it('lists the films by year and offers TMDB’s own images until one is chosen', async () => {
    const { collection } = await screen();
    const one = (await collection()) as unknown as {
      films: { year: number }[];
      tmdbImages: { poster: string | null; fanart: string | null };
    };
    expect(one.films.map((film) => film.year)).toEqual([2021, 2024]);
    expect(one.tmdbImages.poster).toBe('/collectionposter.jpg');
    expect(one.tmdbImages.fanart).toBeNull();
  });

  it('chooses TMDB’s own poster for a collection with none, and sends nothing', async () => {
    const { h, settled, collection, plex, jellyfin } = await screen();
    const started = await h.request('POST', '/api/libraries/films/collections/adopt-tmdb', {});
    expect(started.statusCode).toBe(202);
    const task = await settled();
    expect(task.outcomes).toEqual([
      { key: KEY, name: 'Dune - Saga', sent: 0, missing: 0, chosen: 1, failures: [] },
    ]);
    const one = await collection();
    expect(one.images.poster?.source.type).toBe('tmdb');
    expect(one.status).toBe('pending');
    expect(plex.received).toEqual([]);
    expect(jellyfin.received).toEqual([]);
  });

  it('keeps a chosen image in Kinoshelf’s data and marks the servers `pending`, sending nothing', async () => {
    const { choose, collection, list, plex, jellyfin, configDir, h } = await screen();
    const answer = await choose('poster');
    expect(answer.statusCode).toBe(204);

    const one = await collection();
    expect(one.status).toBe('pending');
    expect(one.images.poster?.source.type).toBe('tmdb');
    expect(one.servers.map((s) => [s.kind, s.states.poster.state, s.states.fanart.state])).toEqual([
      ['plex', 'pending', 'default'],
      ['jellyfin', 'pending', 'default'],
    ]);
    expect((await list()).pending).toBe(1);
    // Nothing went to a server, and the file is in the data, not in a folder of a movie.
    expect(plex.received).toEqual([]);
    expect(jellyfin.received).toEqual([]);
    expect(await readdir(join(configDir, 'collection-images'))).toHaveLength(1);
    const file = await h.request(
      'GET',
      `/api/libraries/films/collections/${encodeURIComponent(KEY)}/images/poster/file`,
    );
    expect(file.rawPayload).toEqual(Buffer.from(JPEG));
  });

  it('keeps the choice through a new scan, which reads TMDB again', async () => {
    const { choose, scan, collection } = await screen();
    await choose('poster');
    await scan();
    expect((await collection()).images.poster).not.toBeNull();
  });

  it('refuses an image TMDB does not offer, and a TMDB image for a collection of one’s own', async () => {
    const { choose } = await screen();
    const refused = await choose('poster', 'tmdb', '/nothing.jpg');
    expect(refused.statusCode).toBe(422);
  });

  it('sends the image to Plex and Jellyfin, then says `sent`', async () => {
    const { choose, send, stateOf, plex, jellyfin, collection, served } = await screen();
    await choose('poster');
    const task = await send();

    expect(task.outcomes).toEqual([
      { key: KEY, name: 'Dune - Saga', sent: 2, missing: 0, chosen: 0, failures: [] },
    ]);
    const upload = plex.received.find((r) => r.method === 'POST');
    expect(upload?.url).toBe('/library/metadata/900/posters');
    expect(upload?.headers['content-type']).toBe('image/jpeg');
    expect(upload?.headers['x-plex-token']).toBe('PTOKEN');
    const jfUpload = jellyfin.received.find((r) => r.method === 'POST');
    expect(jfUpload?.url).toBe('/Items/jf1/Images/Primary');
    expect(jfUpload?.body).toBe(Buffer.from(JPEG).toString('base64'));
    expect((await stateOf('plex'))?.state).toBe('sent');
    expect((await stateOf('jellyfin'))?.state).toBe('sent');
    expect((await collection()).status).toBe('sent');

    // A different picture makes it `pending` again: the hash sent is no longer the one chosen.
    served.bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 7, 7]);
    await choose('poster', 'tmdb', '/collectionposter2.jpg');
    expect((await stateOf('plex'))?.state).toBe('pending');
    expect((await stateOf('jellyfin'))?.state).toBe('pending');
  });

  it('says `error` with what the server said, and sends again what failed', async () => {
    const { choose, send, stateOf, plexUploads, collection } = await screen();
    plexUploads.push(400);
    await choose('poster');
    const task = await send();
    expect(task.outcomes[0]).toMatchObject({ sent: 1, failures: [{ error: 'HTTP 400' }] });
    expect(await stateOf('plex')).toMatchObject({ state: 'error', message: 'HTTP 400' });
    expect((await stateOf('jellyfin'))?.state).toBe('sent');
    expect((await collection()).status).toBe('error');

    // Only what failed goes again.
    const again = await send();
    expect(again.outcomes[0]).toMatchObject({ sent: 1, failures: [] });
    expect((await stateOf('plex'))?.state).toBe('sent');
  });

  it('looks for the collection again when the id it kept is a 404', async () => {
    const { choose, send, stateOf, plexUploads, plex, served } = await screen();
    await choose('poster');
    await send();
    const finds = () => plex.received.filter((r) => r.url === '/library/sections/3/collections');
    const posts = () => plex.received.filter((r) => r.method === 'POST');
    expect(finds()).toHaveLength(1);

    // The collection was deleted and made again: the id kept is stale, the next upload is a 404.
    served.bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
    await choose('poster', 'tmdb', '/collectionposter2.jpg');
    expect((await stateOf('plex'))?.state).toBe('pending');
    plexUploads.push(404);
    await send();
    expect(finds()).toHaveLength(2);
    expect(posts()).toHaveLength(3);
    expect((await stateOf('plex'))?.state).toBe('sent');
  });

  it('marks a collection the server has not created `missing`, and sends it when it appears', async () => {
    const { choose, send, stateOf, known, scan, collection, plex } = await screen({
      plexKnows: false,
    });
    await choose('poster');
    const task = await send();
    expect(task.outcomes[0]).toMatchObject({ sent: 1, missing: 1 });
    expect((await stateOf('plex'))?.state).toBe('missing');
    expect((await stateOf('jellyfin'))?.state).toBe('sent');
    expect((await collection()).status).toBe('missing');

    // Plex creates the collection when it scans; Kinoshelf's next scan finds it and sends.
    known.plex = true;
    await scan();
    for (let waited = 0; (await stateOf('plex'))?.state !== 'sent' && waited < 200; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await stateOf('plex'))?.state).toBe('sent');
    expect(plex.received.some((r) => r.url === '/library/metadata/900/posters')).toBe(true);
  });

  it('does not send a new choice by itself', async () => {
    const { choose, scan, stateOf, plex } = await screen();
    await choose('poster');
    await scan();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await stateOf('plex'))?.state).toBe('pending');
    expect(plex.received.some((r) => r.method === 'POST')).toBe(false);
  });

  it('goes back to `default` when the choice is dropped, the file with it', async () => {
    const { choose, h, collection, configDir } = await screen();
    await choose('poster');
    const dropped = await h.request(
      'DELETE',
      `/api/libraries/films/collections/${encodeURIComponent(KEY)}/images/poster`,
    );
    expect(dropped.statusCode).toBe(204);
    expect((await collection()).status).toBe('default');
    expect(await readdir(join(configDir, 'collection-images'))).toEqual([]);
  });

  it('refuses a send for a library that writes no NFO', async () => {
    const h = await harness({
      createProvider: () => saga,
      config: {
        libraries: [
          {
            id: 'films',
            name: 'Films',
            source: await makeDir(),
            type: 'movie',
            metadata: 'none',
          },
        ],
      },
    });
    const refused = await h.request('POST', '/api/libraries/films/collections/send', {});
    expect(refused.statusCode).toBe(409);
  });
});

describe('renaming a collection of one’s own', () => {
  async function custom() {
    const ctx = await screen();
    const { h, root } = ctx;
    // Organize the film so its NFO and poster exist, then file it in a collection of one's own.
    const items = (await h.request('GET', '/api/libraries/films/items')).json<{
      items: { id: string }[];
    }>().items;
    await h.request('POST', '/api/libraries/films/execute', { items: items.map((i) => i.id) });
    await h.app.jobs.idle();
    const filed = (await h.request('GET', '/api/libraries/films/items')).json<{
      items: { id: string }[];
    }>().items;
    await h.request('PUT', '/api/libraries/films/collection', {
      items: filed.map((i) => i.id),
      choice: 'custom',
      name: 'Univers Arrakis',
    });
    return { ...ctx, nfo: join(root, 'Dune (2021)', 'movie.nfo') };
  }
  const key = 'custom:univers arrakis';
  const url = (suffix = '') =>
    `/api/libraries/films/collections/${encodeURIComponent(key)}${suffix}`;

  it('counts the NFO a rename would rewrite, then rewrites them and keeps the image chosen', async () => {
    const { h, nfo, list } = await custom();
    expect((await list()).collections.map((c) => c.key)).toEqual([key]);

    // The movie's own poster is the image: the collection has no TMDB.
    const film = (await list()).collections[0] as Summary & { films: { itemId: string }[] };
    const chosen = await h.request('PUT', url('/images/poster'), {
      source: 'film',
      value: film.films[0]?.itemId,
    });
    expect(chosen.statusCode).toBe(204);

    const dry = await h.request('POST', url('/rename'), { name: 'Arrakis', dryRun: true });
    expect(dry.json()).toMatchObject({ key: 'custom:arrakis', rewritten: 1, batchId: null });
    expect(await readFile(nfo, 'utf8')).toContain('<name>Univers Arrakis</name>');

    const done = await h.request('POST', url('/rename'), { name: 'Arrakis' });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ key: 'custom:arrakis', movies: 1, rewritten: 1 });
    expect(await readFile(nfo, 'utf8')).toContain('<name>Arrakis</name>');

    const renamed = (await list()).collections;
    expect(renamed.map((c) => c.key)).toEqual(['custom:arrakis']);
    expect(renamed[0]?.name).toBe('Arrakis');
    expect(renamed[0]?.images.poster?.source.type).toBe('film');
    // What was sent under the old name is not the new collection's: its servers start again.
    expect(renamed[0]?.servers.map((s) => s.states.poster.state)).toEqual(['pending', 'pending']);
  });

  it('refuses to rename a collection of TMDB’s', async () => {
    const { h } = await screen();
    const refused = await h.request(
      'POST',
      `/api/libraries/films/collections/${encodeURIComponent(KEY)}/rename`,
      { name: 'Autre' },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('collection.not-custom');
  });
});
