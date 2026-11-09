import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { itemId } from '../src/library-items.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  await cleanup();
});

const servers: Server[] = [];

/** The first bytes of a PNG and of a JPEG, with the sizes a reader looks for. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 3, 0x20, 0, 0, 1, 0x2c]),
  Buffer.alloc(9),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, 0x05, 0xdc, 0x03, 0xe8]),
  Buffer.alloc(12),
]);
const OLD_POSTER = Buffer.concat([JPEG, Buffer.from('old poster')]);

/** The provider's images, by what the fake serves for them. */
const fetchImage = (url: string): Promise<Uint8Array> => {
  if (url.endsWith('/gone.jpg')) {
    return Promise.reject(new Error('down'));
  }
  return Promise.resolve(url.endsWith('.png') ? PNG : Buffer.concat([JPEG, Buffer.from(url)]));
};

const FOLDER = 'Dune (2021)';

async function organized(
  options: {
    metadata?: 'nfo' | 'none';
    allowLocal?: boolean;
    flat?: boolean;
    fetch?: typeof fetchImage;
  } = {},
) {
  const root = await makeDir();
  const dir = options.flat ? root : join(root, FOLDER);
  const file = await put(join(dir, `${FOLDER}.mkv`), 'video');
  await writeFile(join(dir, 'poster.jpg'), OLD_POSTER);
  const h = await harness({
    configDir: await makeDir(),
    fetchImage: options.fetch ?? fetchImage,
    config: {
      ...(options.allowLocal && { allowLocalImageUrls: true }),
      libraries: [
        {
          id: 'films',
          name: 'Films',
          source: root,
          type: 'movie',
          naming: 'no-id',
          metadata: options.metadata ?? 'nfo',
        },
      ],
    },
  });
  await h.request('POST', '/api/libraries/films/scan');
  await h.app.jobs.idle();
  const base = `/api/libraries/films/items/${itemId(file)}/images`;
  return { h, root, dir, base };
}

type Harness = Awaited<ReturnType<typeof organized>>['h'];

interface Listing {
  files: Record<string, string | null>;
  current: Record<
    string,
    { width: number | null; height: number | null; path: string | null } | null
  >;
  candidates: Record<string, { path: string }[]>;
}

const apply = (h: Harness, base: string, images: object[]) => h.request('POST', base, { images });

const codeOf = (response: { json: () => unknown }): unknown =>
  (response.json() as { error: { code: string } }).error.code;

async function serve(body: Buffer, type = 'image/png'): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': type }).end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('the images of a movie', () => {
  it('lists the files the profile writes, what is in place and what the provider offers', async () => {
    const { h, base } = await organized();
    const listing = (await h.request('GET', base)).json<Listing>();

    expect(listing.files).toEqual({
      poster: 'poster.jpg',
      fanart: 'background.jpg',
      logo: 'logo.png',
    });
    expect(listing.current.poster).toMatchObject({ width: 1000, height: 1500, path: null });
    expect(listing.current.logo).toBeNull();
    // Only what can be written under the profile's name: a JPEG for poster.jpg, a PNG for logo.png.
    expect(listing.candidates.poster?.map(({ path }) => path)).toEqual([
      '/poster.jpg',
      '/poster2.jpg',
    ]);
    expect(listing.candidates.logo?.map(({ path }) => path)).toEqual(['/logo.png']);
  });

  it('serves the image in place', async () => {
    const { h, base } = await organized();
    const file = await h.request('GET', `${base}/poster/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.rawPayload.equals(OLD_POSTER)).toBe(true);
    expect((await h.request('GET', `${base}/logo/file`)).statusCode).toBe(404);
  });

  it('replaces a poster and adds a logo in one batch, and says which offered image is in place', async () => {
    const { h, base, dir } = await organized();
    const response = await apply(h, base, [
      { type: 'poster', source: 'tmdb', value: '/poster2.jpg' },
      { type: 'logo', source: 'tmdb', value: '/logo.png' },
    ]);
    expect(response.statusCode).toBe(200);

    expect(
      (await readFile(join(dir, 'poster.jpg'), 'utf8')).includes('/standard/poster2.jpg'),
    ).toBe(true);
    expect((await readFile(join(dir, 'logo.png'))).equals(PNG)).toBe(true);

    const listing = (await h.request('GET', base)).json<Listing>();
    expect(listing.current.poster?.path).toBe('/poster2.jpg');
    expect(listing.current.logo?.path).toBe('/logo.png');

    const batch = (
      await h.request('GET', `/api/batches/${response.json<{ batchId: string }>().batchId}`)
    ).json<{ extras: { kind: string }[] }>();
    expect(batch.extras.map(({ kind }) => kind).sort()).toEqual(['downloaded', 'replaced']);

    // The list sees the logo at once, with no new scan.
    const page = (await h.request('GET', '/api/libraries/films/items')).json<{
      items: { logo: boolean | null }[];
    }>();
    expect(page.items[0]?.logo).toBe(true);
  });

  it('puts the old poster back and removes the new logo when the batch is undone', async () => {
    const { h, base, dir } = await organized();
    const { batchId } = (
      await apply(h, base, [
        { type: 'poster', source: 'tmdb', value: '/poster2.jpg' },
        { type: 'logo', source: 'tmdb', value: '/logo.png' },
      ])
    ).json<{ batchId: string }>();

    const undo = await h.request('POST', `/api/batches/${batchId}/undo`, {});
    expect(undo.statusCode).toBe(200);
    expect((await readFile(join(dir, 'poster.jpg'))).equals(OLD_POSTER)).toBe(true);
    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
    const page = (await h.request('GET', '/api/libraries/films/items')).json<{
      items: { logo: boolean | null; poster: boolean | null }[];
    }>();
    expect(page.items[0]).toMatchObject({ logo: false, poster: true });
  });

  it('keeps a poster the user changed since, when the batch is undone', async () => {
    const { h, base, dir } = await organized();
    const { batchId } = (
      await apply(h, base, [{ type: 'poster', source: 'tmdb', value: '/poster2.jpg' }])
    ).json<{ batchId: string }>();
    await put(join(dir, 'poster.jpg'), 'mine, replaced by hand');

    await h.request('POST', `/api/batches/${batchId}/undo`, {});
    expect(await readFile(join(dir, 'poster.jpg'), 'utf8')).toBe('mine, replaced by hand');
  });

  it('refuses an image the provider does not offer, writing nothing', async () => {
    const { h, base, dir } = await organized();
    const response = await apply(h, base, [
      { type: 'logo', source: 'tmdb', value: '/logo.png' },
      { type: 'poster', source: 'tmdb', value: '/not-offered.jpg' },
    ]);
    expect(response.statusCode).toBe(422);
    expect(codeOf(response)).toBe('image.not-offered');
    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
    expect((await readFile(join(dir, 'poster.jpg'))).equals(OLD_POSTER)).toBe(true);
  });

  it('refuses the same type twice', async () => {
    const { h, base } = await organized();
    const response = await apply(h, base, [
      { type: 'poster', source: 'tmdb', value: '/poster.jpg' },
      { type: 'poster', source: 'tmdb', value: '/poster2.jpg' },
    ]);
    expect(response.statusCode).toBe(400);
  });

  it('is a bad gateway when the provider cannot be reached, and writes nothing', async () => {
    const { h, base, dir } = await organized({ fetch: () => Promise.reject(new Error('down')) });
    const response = await apply(h, base, [
      { type: 'logo', source: 'tmdb', value: '/logo.png' },
      { type: 'poster', source: 'tmdb', value: '/poster2.jpg' },
    ]);
    expect(response.statusCode).toBe(502);
    expect(codeOf(response)).toBe('image.unavailable');
    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
    expect((await readFile(join(dir, 'poster.jpg'))).equals(OLD_POSTER)).toBe(true);
  });

  it.each([
    ['without metadata', { metadata: 'none' as const }],
    ['loose in the library folder', { flat: true }],
  ])('has no images to change for a movie %s', async (_name, options) => {
    const { h, base } = await organized(options);
    const response = await h.request('GET', base);
    expect(response.statusCode).toBe(409);
    expect(codeOf(response)).toBe('image.not-editable');
  });
});

describe('the page of a movie says whether its images can be changed', () => {
  const page = async (h: Harness, base: string) =>
    (await h.request('GET', base.replace(/\/images$/, ''))).json<{
      images: { poster: boolean; fanart: boolean; logo: boolean } | null;
      logoPath: string | null;
    }>();

  it('does when the profile writes images', async () => {
    const { h, base } = await organized();
    expect(await page(h, base)).toMatchObject({
      images: { poster: true, fanart: false, logo: false },
      logoPath: '/logo.png',
    });
  });

  it.each([
    ['without metadata', { metadata: 'none' as const }],
    ['loose in the library folder', { flat: true }],
  ])('does not for a movie %s', async (_name, options) => {
    const { h, base } = await organized(options);
    expect((await page(h, base)).images).toBeNull();
  });
});

describe('an image given by address', () => {
  it('is downloaded and written when the settings allow the local network', async () => {
    const { h, base, dir } = await organized({ allowLocal: true });
    const origin = await serve(PNG);
    const response = await apply(h, base, [
      { type: 'logo', source: 'url', value: `${origin}/mine.png` },
    ]);
    expect(response.statusCode).toBe(200);
    expect((await readFile(join(dir, 'logo.png'))).equals(PNG)).toBe(true);
    const listing = (await h.request('GET', base)).json<Listing>();
    expect(listing.current.logo).toMatchObject({ width: 800, height: 300, path: null });
  });

  it('is previewed with its size, writing nothing', async () => {
    const { h, base, dir } = await organized({ allowLocal: true });
    const origin = await serve(PNG);
    const response = await h.request('POST', `${base}/preview`, {
      type: 'logo',
      url: `${origin}/mine.png`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ format: 'png', width: 800, height: 300 });
    expect(response.json<{ data: string }>().data).toMatch(/^data:image\/png;base64,/);
    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
  });

  it('is not previewed when its format is not the file’s, nor on the local network', async () => {
    const { h, base } = await organized();
    const origin = await serve(PNG);
    const blocked = await h.request('POST', `${base}/preview`, {
      type: 'logo',
      url: `${origin}/mine.png`,
    });
    expect(codeOf(blocked)).toBe('image.url-blocked');
    const local = await organized({ allowLocal: true });
    const mismatch = await local.h.request('POST', `${local.base}/preview`, {
      type: 'poster',
      url: `${origin}/mine.png`,
    });
    expect(mismatch.statusCode).toBe(422);
    expect(codeOf(mismatch)).toBe('image.format-mismatch');
  });

  it('is refused on the local network by default, writing nothing', async () => {
    const { h, base, dir } = await organized();
    const origin = await serve(PNG);
    const response = await apply(h, base, [
      { type: 'logo', source: 'url', value: `${origin}/mine.png` },
    ]);
    expect(response.statusCode).toBe(422);
    expect(codeOf(response)).toBe('image.url-blocked');
    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
  });

  it.each([
    ['not an address', 'nope', 'image.url-invalid'],
    ['a file address', 'file:///etc/passwd', 'image.url-invalid'],
  ])('refuses %s', async (_name, value, code) => {
    const { h, base } = await organized({ allowLocal: true });
    const response = await apply(h, base, [{ type: 'logo', source: 'url', value }]);
    expect(response.statusCode).toBe(422);
    expect(codeOf(response)).toBe(code);
  });

  it('refuses a page, an unsupported format and a format the file cannot take, writing nothing', async () => {
    const { h, base, dir } = await organized({ allowLocal: true });
    const page = await serve(Buffer.from('<html></html>'), 'text/html');
    expect(
      codeOf(await apply(h, base, [{ type: 'logo', source: 'url', value: `${page}/a.png` }])),
    ).toBe('image.url-not-image');

    const webp = await serve(
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]),
      'image/webp',
    );
    expect(
      codeOf(await apply(h, base, [{ type: 'poster', source: 'url', value: `${webp}/a.webp` }])),
    ).toBe('image.url-unsupported');

    // A PNG cannot be written as poster.jpg, nor a JPEG as logo.png: the name would lie.
    const png = await serve(PNG);
    const wrong = await apply(h, base, [{ type: 'poster', source: 'url', value: `${png}/a.png` }]);
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toEqual({
      error: { code: 'image.format-mismatch', params: { found: 'PNG', expected: 'JPEG' } },
    });

    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
    expect((await readFile(join(dir, 'poster.jpg'))).equals(OLD_POSTER)).toBe(true);
  });

  it('writes none of the images when one of them fails', async () => {
    const { h, base, dir } = await organized({ allowLocal: true });
    const png = await serve(PNG);
    const response = await apply(h, base, [
      { type: 'logo', source: 'url', value: `${png}/ok.png` },
      { type: 'fanart', source: 'url', value: 'nope' },
    ]);
    expect(response.statusCode).toBe(422);
    await expect(readFile(join(dir, 'logo.png'))).rejects.toThrow();
  });
});

describe('the images of a show', () => {
  const SHOW = { provider: 'tmdb', id: 95396 };
  const provider = {
    ...fakeProvider,
    searchSeries: () =>
      Promise.resolve([
        {
          kind: 'series' as const,
          id: SHOW,
          title: 'Severance',
          originalTitle: 'Severance',
          alternativeTitles: [],
          year: 2022,
        },
      ]),
    getSeason: () =>
      Promise.resolve({ season: 1, episodes: [{ season: 1, episode: 1, airDate: '2022-02-18' }] }),
    getSeriesDetails: () =>
      Promise.resolve({
        kind: 'series' as const,
        id: SHOW,
        title: 'Severance',
        originalTitle: 'Severance',
        genres: [],
        tags: [],
        studios: [],
        countries: [],
        cast: [],
        firstAirDate: '2022-02-18',
        seasons: [],
      }),
  };

  async function show() {
    const root = await makeDir();
    const dir = join(root, 'Severance (2022)');
    await put(join(dir, 'Season 01', 'Severance (2022) - s01e01.mkv'), 'video');
    await writeFile(join(dir, 'poster.jpg'), OLD_POSTER);
    const h = await harness({
      configDir: await makeDir(),
      fetchImage,
      createProvider: () => provider,
      config: {
        libraries: [
          {
            id: 'shows',
            name: 'Shows',
            source: root,
            type: 'series',
            naming: 'no-id',
            metadata: 'nfo',
          },
        ],
      },
    });
    await h.request('POST', '/api/libraries/shows/scan');
    await h.app.jobs.idle();
    return { h, dir, base: `/api/libraries/shows/shows/${String(SHOW.id)}/images` };
  }

  it('lists the images of the show, in its own folder, never a season’s', async () => {
    const { h, dir, base } = await show();
    const listing = (await h.request('GET', base)).json<Listing & { folder: string }>();
    expect(listing.folder).toBe(dir);
    expect(listing.files.logo).toBe('logo.png');
    expect(listing.current.poster).toMatchObject({ width: 1000, height: 1500 });
  });

  it('writes a logo beside the show’s other files and the list sees it', async () => {
    const { h, dir, base } = await show();
    const response = await apply(h, base, [{ type: 'logo', source: 'tmdb', value: '/logo.png' }]);
    expect(response.statusCode).toBe(200);
    expect((await readFile(join(dir, 'logo.png'))).equals(PNG)).toBe(true);
    await h.app.seriesFiles.idle();
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<{
      items: { logo: boolean | null }[];
    }>();
    expect(shows.items[0]?.logo).toBe(true);
  });

  it('says on its page that the images can be changed, with its logo', async () => {
    const { h, base } = await show();
    const page = (await h.request('GET', base.replace(/\/images$/, ''))).json<{
      images: { poster: boolean; fanart: boolean; logo: boolean } | null;
      logoPath: string | null;
    }>();
    expect(page.images).toEqual({ poster: true, fanart: false, logo: false });
    expect(page).toHaveProperty('logoPath');
  });

  it('has nothing to change for a show the library does not hold', async () => {
    const { h } = await show();
    const response = await h.request('GET', '/api/libraries/shows/shows/1/images');
    expect(response.statusCode).toBe(409);
    expect(codeOf(response)).toBe('image.not-editable');
  });
});
