import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deliver } from '../src/notify/delivery.js';
import { buildRequest, type WebhookConfig } from '../src/notify/formats.js';
import { JellyfinClient, parseLibraries } from '../src/notify/jellyfin.js';
import type { Notification } from '../src/notify/message.js';
import { isInside, mapPath, redactUrl } from '../src/notify/paths.js';
import { MAX_PARTIAL_SCANS, parseSections, PlexClient, type Send } from '../src/notify/plex.js';

const SECTIONS_XML = readFileSync(
  join(import.meta.dirname, 'fixtures', 'plex-sections.xml'),
  'utf8',
);

const quiet = { info: () => undefined, warn: () => undefined };

describe('mapPath', () => {
  const mappings = [
    { from: '/media/movies', to: '/mnt/videos/movies' },
    { from: '/media/series/', to: '/mnt/videos/tv-shows/' },
  ];

  it('translates a path under a mapped folder, keeping the rest', () => {
    expect(mapPath('/media/movies/Dune (2021)', mappings)).toBe('/mnt/videos/movies/Dune (2021)');
    expect(mapPath('/media/series/Show/Season 01', mappings)).toBe(
      '/mnt/videos/tv-shows/Show/Season 01',
    );
    expect(mapPath('/media/movies', mappings)).toBe('/mnt/videos/movies');
  });

  it('leaves paths alone when there is no mapping at all', () => {
    expect(mapPath('/media/movies/x', [])).toBe('/media/movies/x');
    expect(mapPath('/media/movies/x')).toBe('/media/movies/x');
  });

  it('gives up on a path no mapping covers, rather than guessing', () => {
    expect(mapPath('/elsewhere/x', mappings)).toBeUndefined();
  });

  it('does not take a folder for the one whose name it starts with', () => {
    expect(mapPath('/media/movies2/x', mappings)).toBeUndefined();
    expect(isInside('/media/movies2', '/media/movies')).toBe(false);
    expect(isInside('/media/movies', '/media/movies/')).toBe(true);
  });
});

describe('redactUrl', () => {
  it('keeps only the host: the rest may be a secret', () => {
    expect(redactUrl('https://discord.com/api/webhooks/123/SECRET')).toBe('https://discord.com/…');
    expect(redactUrl('https://gotify.example:8443/message?token=SECRET')).toBe(
      'https://gotify.example:8443/…',
    );
    expect(redactUrl('not a url')).toBe('[invalid url]');
  });
});

const failed: Notification = {
  event: 'failed',
  reason: 'files',
  title: 'T',
  message: 'M',
  at: '2026-10-28T12:00:00.000Z',
};
const ok: Notification = { ...failed, event: 'transferred' };

describe('buildRequest', () => {
  const target = (
    format: WebhookConfig['format'],
    url = 'https://h.example/path',
  ): WebhookConfig => ({
    url,
    ...(format && { format }),
  });
  const json = (body: string | undefined) => JSON.parse(body ?? '') as Record<string, unknown>;

  it('posts Kinoshelf’s own JSON by default', () => {
    const request = buildRequest(target(undefined), failed);
    expect(request).toMatchObject({ method: 'POST', url: 'https://h.example/path' });
    expect(json(request.body)).toMatchObject({
      event: 'failed',
      reason: 'files',
      title: 'T',
      message: 'M',
    });
  });

  it('speaks Gotify, loud for a failure', () => {
    expect(json(buildRequest(target('gotify'), failed).body)).toEqual({
      title: 'T',
      message: 'M',
      priority: 8,
    });
    expect(json(buildRequest(target('gotify'), ok).body).priority).toBe(5);
  });

  it('speaks ntfy: JSON to the server root, the topic being the last segment', () => {
    const request = buildRequest(target('ntfy', 'https://ntfy.example/kinoshelf'), failed);
    expect(request.url).toBe('https://ntfy.example/');
    expect(json(request.body)).toEqual({
      topic: 'kinoshelf',
      title: 'T',
      message: 'M',
      priority: 4,
      tags: ['warning'],
    });
    expect(
      json(buildRequest(target('ntfy', 'https://ntfy.example/kinoshelf'), ok).body),
    ).toMatchObject({
      priority: 3,
      tags: ['white_check_mark'],
    });
  });

  it('keeps a path prefix of the ntfy server', () => {
    expect(buildRequest(target('ntfy', 'https://example.org/ntfy/alerts'), ok).url).toBe(
      'https://example.org/ntfy/',
    );
  });

  it('speaks Discord, within its limit', () => {
    expect(json(buildRequest(target('discord'), ok).body)).toEqual({ content: '**T**\nM' });
    const long = buildRequest(target('discord'), { ...ok, message: 'x'.repeat(5000) });
    expect((json(long.body).content as string).length).toBe(2000);
  });

  it('lets the target’s own headers win', () => {
    const request = buildRequest(
      { ...target('gotify'), headers: { 'X-Gotify-Key': 'k', 'content-type': 'text/x' } },
      ok,
    );
    expect(request.headers).toEqual({ 'X-Gotify-Key': 'k', 'content-type': 'text/x' });
  });
});

describe('deliver', () => {
  const request = {
    method: 'POST',
    url: 'https://h.example/hook?token=SECRET',
    headers: {},
    body: '{}',
  } as const;
  const response = (status: number, text = '') =>
    new Response(status === 204 ? null : text, { status });
  const sleeps = () => {
    const calls: number[] = [];
    return {
      calls,
      sleep: (ms: number) => {
        calls.push(ms);
        return Promise.resolve();
      },
    };
  };

  it('succeeds at once on a 2xx', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response(204)));
    const { sleep, calls } = sleeps();
    expect(await deliver(request, { fetch: fetchMock, sleep })).toMatchObject({
      ok: true,
      status: 204,
      attempts: 1,
    });
    expect(calls).toEqual([]);
  });

  it('tries again after a 5xx, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const { sleep, calls } = sleeps();
    expect(await deliver(request, { fetch: fetchMock, sleep })).toMatchObject({
      ok: true,
      attempts: 2,
    });
    expect(calls).toEqual([1000]);
  });

  it('tries again after a 429 and a network error, up to three attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(response(500));
    const { sleep, calls } = sleeps();
    const result = await deliver(request, { fetch: fetchMock, sleep });
    expect(result).toMatchObject({ ok: false, attempts: 3, status: 500 });
    expect(calls).toEqual([1000, 5000]);
  });

  it('does not try again on another 4xx: waiting cannot fix a wrong key', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response(401)));
    const { sleep, calls } = sleeps();
    expect(await deliver(request, { fetch: fetchMock, sleep })).toMatchObject({
      ok: false,
      status: 401,
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('never puts the URL in the error, since it may hold a secret', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error(`request to ${request.url} failed`)));
    const result = await deliver(request, { fetch: fetchMock, sleep: () => Promise.resolve() });
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('SECRET');
  });

  it('reports the system error Node hides under "fetch failed"', async () => {
    const hidden = new TypeError('fetch failed', {
      cause: new AggregateError([Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })]),
    });
    const direct = new TypeError('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
    });
    const noCode = new TypeError('fetch failed', { cause: new Error('bad port') });
    const options = { sleep: () => Promise.resolve(), delays: [] };
    expect(
      (await deliver(request, { ...options, fetch: () => Promise.reject(hidden) })).error,
    ).toBe('ECONNREFUSED');
    expect(
      (await deliver(request, { ...options, fetch: () => Promise.reject(noCode) })).error,
    ).toBe('bad port');
    expect(
      (await deliver(request, { ...options, fetch: () => Promise.reject(direct) })).error,
    ).toBe('ENOTFOUND');
  });

  it('reports a timeout as such', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error); // what a real fetch rejects with
          });
        }),
    );
    const result = await deliver(request, {
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
      timeoutMs: 5,
      delays: [],
    });
    expect(result).toMatchObject({ ok: false, error: 'timeout', attempts: 1 });
  });
});

describe('parseSections', () => {
  it('reads the libraries and their folders from Plex’s XML', () => {
    expect(parseSections(SECTIONS_XML)).toEqual([
      {
        key: '3',
        type: 'movie',
        locations: ['/mnt/videos/movies', '/mnt/videos/optimized-versions'],
      },
      {
        key: '6',
        type: 'show',
        locations: ['/mnt/videos/tv-shows', '/mnt/videos/optimized-versions'],
      },
      { key: '8', type: 'artist', locations: ['/mnt/videos/musics'] },
    ]);
  });

  it('copes with a single library and with an empty answer', () => {
    expect(
      parseSections(
        '<MediaContainer><Directory key="1" type="movie"><Location path="/a"/></Directory></MediaContainer>',
      ),
    ).toEqual([{ key: '1', type: 'movie', locations: ['/a'] }]);
    expect(parseSections('<MediaContainer size="0"/>')).toEqual([]);
  });
});

describe('PlexClient', () => {
  /** A Plex that answers the section list and records the refreshes. */
  function plex(
    options: {
      section?: number;
      paths?: { from: string; to: string }[];
      refresh?: (url: string) => number;
    } = {},
  ) {
    const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
    const send: Send = (request) => {
      calls.push({ url: request.url, headers: request.headers });
      if (request.url.endsWith('/library/sections')) {
        return Promise.resolve({ ok: true, status: 200, attempts: 1, text: SECTIONS_XML });
      }
      const status = options.refresh?.(request.url) ?? 200;
      return Promise.resolve({
        ok: status < 300,
        status,
        attempts: 1,
        ...(status >= 300 && { error: `HTTP ${status}` }),
      });
    };
    const client = new PlexClient(
      {
        url: 'http://plex:32400/',
        token: 'TOKEN',
        ...(options.section !== undefined && { section: options.section }),
        paths: options.paths ?? [],
      },
      send,
      quiet,
    );
    return { client, calls };
  }
  const refreshes = (calls: { url: string }[]) =>
    calls.filter((c) => c.url.includes('/refresh')).map((c) => c.url);

  it('refreshes the folder in the library of its type, with the token in a header', async () => {
    const { client, calls } = plex({
      paths: [{ from: '/media/movies', to: '/mnt/videos/movies' }],
    });

    const report = await client.refresh([{ path: '/media/movies/Dune (2021)', kind: 'movie' }]);

    expect(report).toMatchObject({ refreshed: 1, skipped: [], failed: [] });
    expect(refreshes(calls)).toEqual([
      `http://plex:32400/library/sections/3/refresh?path=${encodeURIComponent('/mnt/videos/movies/Dune (2021)')}`,
    ]);
    expect(calls.every((c) => c.headers['X-Plex-Token'] === 'TOKEN')).toBe(true);
  });

  it('puts a series in the show library, and a shared folder in the library of its own type', async () => {
    const { client, calls } = plex();
    await client.refresh([
      { path: '/mnt/videos/tv-shows/Show/Season 01', kind: 'series' },
      { path: '/mnt/videos/optimized-versions/a', kind: 'movie' }, // held by both the movie and the show library
      { path: '/mnt/videos/optimized-versions/b', kind: 'series' },
    ]);
    expect(refreshes(calls).map((u) => u.match(/sections\/(\d+)\//)?.[1])).toEqual(['6', '3', '6']);
  });

  it('skips a path no library holds, and one no mapping covers, without calling Plex for it', async () => {
    const { client, calls } = plex({
      paths: [{ from: '/media/movies', to: '/mnt/videos/movies' }],
    });
    const report = await client.refresh([
      { path: '/other/place', kind: 'movie' }, // no mapping
      { path: '/media/movies/x', kind: 'series' }, // mapped, but /mnt/videos/movies is no show library
    ]);
    expect(report.skipped).toEqual(['/other/place', '/media/movies/x']);
    expect(refreshes(calls)).toEqual([]);
  });

  it('uses the library it is told to, without looking them up', async () => {
    const { client, calls } = plex({ section: 8 });
    await client.refresh([{ path: '/anywhere', kind: 'movie' }]);
    expect(calls.some((c) => c.url.endsWith('/library/sections'))).toBe(false);
    expect(refreshes(calls)).toEqual([
      'http://plex:32400/library/sections/8/refresh?path=%2Fanywhere',
    ]);
  });

  it('asks for the list of libraries once, not for every folder', async () => {
    const { client, calls } = plex();
    await client.refresh([
      { path: '/mnt/videos/movies/a', kind: 'movie' },
      { path: '/mnt/videos/movies/b', kind: 'movie' },
    ]);
    await client.refresh([{ path: '/mnt/videos/movies/c', kind: 'movie' }]);
    expect(calls.filter((c) => c.url.endsWith('/library/sections'))).toHaveLength(1);
  });

  it('scans whole libraries rather than a long list of folders', async () => {
    const { client, calls } = plex();
    const many = Array.from({ length: MAX_PARTIAL_SCANS + 1 }, (_, i) => ({
      path: `/mnt/videos/movies/Film ${i}`,
      kind: 'movie' as const,
    }));
    await client.refresh(many);
    expect(refreshes(calls)).toEqual(['http://plex:32400/library/sections/3/refresh']);
  });

  it('reports a refresh that fails and forgets the libraries when Plex says 404', async () => {
    const { client, calls } = plex({ refresh: () => 404 });
    const report = await client.refresh([{ path: '/mnt/videos/movies/a', kind: 'movie' }]);
    expect(report).toMatchObject({ refreshed: 0, failed: ['/mnt/videos/movies/a'] });

    await client.refresh([{ path: '/mnt/videos/movies/b', kind: 'movie' }]);
    expect(calls.filter((c) => c.url.endsWith('/library/sections'))).toHaveLength(2); // asked again
  });
});

const LIBRARIES_JSON = readFileSync(
  join(import.meta.dirname, 'fixtures', 'jellyfin-virtual-folders.json'),
  'utf8',
);

describe('parseLibraries', () => {
  it('reads the libraries and their folders from Jellyfin’s JSON', () => {
    expect(parseLibraries(LIBRARIES_JSON)).toEqual([
      { name: 'Séries', type: 'tvshows', locations: ['/data/tv-shows'] },
      { name: 'Films', type: 'movies', locations: ['/data/movies'] },
    ]);
  });

  it('copes with a library of mixed content, and with an answer that is not a list', () => {
    expect(parseLibraries('[{"Name":"Tout","Locations":["/data/all"]}]')).toEqual([
      { name: 'Tout', type: null, locations: ['/data/all'] },
    ]);
    expect(parseLibraries('{}')).toEqual([]);
  });
});

describe('JellyfinClient', () => {
  interface Call {
    method: string;
    url: string;
    headers: Readonly<Record<string, string>>;
    body?: string;
  }

  /** A Jellyfin that lists its libraries (the real ones) and answers the refresh with `status`. */
  function jellyfin(
    options: {
      status?: number;
      paths?: { from: string; to: string }[];
      libraries?: string;
      listingStatus?: number;
    } = {},
  ) {
    const { status = 204, paths = [{ from: '/media/movies', to: '/data/movies' }] } = options;
    const calls: Call[] = [];
    const warnings: string[] = [];
    const client = new JellyfinClient(
      { url: 'http://jf:8096/', apiKey: 'KEY', paths },
      (request) => {
        calls.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          ...(request.body && { body: request.body }),
        });
        if (request.method === 'GET') {
          const listing = options.listingStatus ?? 200;
          return Promise.resolve({
            ok: listing < 300,
            status: listing,
            attempts: 1,
            text: options.libraries ?? LIBRARIES_JSON,
            ...(listing >= 300 && { error: `HTTP ${listing}` }),
          });
        }
        return Promise.resolve({
          ok: status < 300,
          status,
          attempts: 1,
          ...(status >= 300 && { error: `HTTP ${status}` }),
        });
      },
      { info: () => undefined, warn: (m) => warnings.push(m) },
    );
    return { client, calls, warnings };
  }
  const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST');

  it('tells Jellyfin which paths were created, with the key in the Authorization header', async () => {
    const { client, calls } = jellyfin();
    const report = await client.refresh([
      { path: '/media/movies/Dune (2021)', kind: 'movie' },
      { path: '/media/movies/Alien (1979)', kind: 'movie' },
    ]);

    expect(report).toMatchObject({ refreshed: 2, failed: [], skipped: [] });
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]).toMatchObject({
      method: 'POST',
      url: 'http://jf:8096/Library/Media/Updated',
      headers: { Authorization: 'MediaBrowser Token="KEY"', 'content-type': 'application/json' },
    });
    expect(JSON.parse(posts(calls)[0]?.body ?? '')).toEqual({
      Updates: [
        { Path: '/data/movies/Dune (2021)', UpdateType: 'Created' },
        { Path: '/data/movies/Alien (1979)', UpdateType: 'Created' },
      ],
    });
  });

  it('does not take its own success for proof: a path in no library is reported, not sent', async () => {
    // Jellyfin answers success whatever the path, so a wrong mapping would pass unnoticed.
    const { client, calls, warnings } = jellyfin({ paths: [] });
    const report = await client.refresh([{ path: '/mnt/Downloads', kind: 'movie' }]);

    expect(report).toMatchObject({ refreshed: 0, skipped: ['/mnt/Downloads'] });
    expect(posts(calls)).toEqual([]);
    expect(warnings).toEqual(['Jellyfin: no movies library holds /mnt/Downloads']);
  });

  it('puts a series in the series library: a movie library does not hold it', async () => {
    const { client, calls } = jellyfin({ paths: [] });
    const report = await client.refresh([
      { path: '/data/movies/Dune (2021)', kind: 'movie' },
      { path: '/data/movies/Show/Season 01', kind: 'series' }, // in the movie library
      { path: '/data/tv-shows/Show/Season 01', kind: 'series' },
    ]);
    expect(report.skipped).toEqual(['/data/movies/Show/Season 01']);
    expect(
      (JSON.parse(posts(calls)[0]?.body ?? '') as { Updates: { Path: string }[] }).Updates.map(
        (u) => u.Path,
      ),
    ).toEqual(['/data/movies/Dune (2021)', '/data/tv-shows/Show/Season 01']);
  });

  it('accepts any kind in a library of mixed content', async () => {
    const { client, calls } = jellyfin({
      paths: [],
      libraries: '[{"Name":"Tout","Locations":["/data/all"]}]',
    });
    const report = await client.refresh([
      { path: '/data/all/a', kind: 'movie' },
      { path: '/data/all/b', kind: 'series' },
    ]);
    expect(report.refreshed).toBe(2);
    expect(posts(calls)).toHaveLength(1);
  });

  it('sends the paths unchecked, and says so, when it cannot list its libraries', async () => {
    const { client, calls, warnings } = jellyfin({ paths: [], listingStatus: 401 });
    const report = await client.refresh([{ path: '/anywhere/x', kind: 'movie' }]);
    expect(report.refreshed).toBe(1);
    expect(posts(calls)).toHaveLength(1);
    expect(warnings[0]).toContain('paths are sent unchecked');
  });

  it('asks for the list of libraries once, not for every refresh', async () => {
    const { client, calls } = jellyfin({ paths: [] });
    await client.refresh([{ path: '/data/movies/a', kind: 'movie' }]);
    await client.refresh([{ path: '/data/movies/b', kind: 'movie' }]);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  it('skips what no mapping covers, and sends nothing when nothing is left', async () => {
    const { client, calls } = jellyfin();
    const report = await client.refresh([{ path: '/elsewhere/x', kind: 'movie' }]);
    expect(report.skipped).toEqual(['/elsewhere/x']);
    expect(posts(calls)).toEqual([]);
  });

  it('refreshes the whole library rather than a long list of paths', async () => {
    const { client, calls } = jellyfin({ paths: [] });
    const many = Array.from({ length: MAX_PARTIAL_SCANS + 1 }, (_, i) => ({
      path: `/data/movies/Film ${i}`,
      kind: 'movie' as const,
    }));
    await client.refresh(many);
    expect(posts(calls)).toMatchObject([{ url: 'http://jf:8096/Library/Refresh' }]);
  });

  it('reports a refusal, and asks for the libraries again afterwards', async () => {
    const { client, calls } = jellyfin({ status: 401 });
    expect(await client.refresh([{ path: '/media/movies/x', kind: 'movie' }])).toMatchObject({
      refreshed: 0,
      failed: ['/data/movies/x'],
    });
    await client.refresh([{ path: '/media/movies/y', kind: 'movie' }]);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });
});
