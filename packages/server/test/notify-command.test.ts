import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '@kinoshelf/core';
import { runNotifyCommand } from '../src/notify-command.js';
import { closeFakeServers, fakeServer, type Received } from './fake-server.js';

afterEach(closeFakeServers);

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

/** Plex and Jellyfin as local servers, the real libraries of both, and a config that maps to them. */
async function servers(options: { jellyfinStatus?: number } = {}) {
  const hook = await fakeServer();
  const plex = await fakeServer((r) =>
    r.url === '/library/sections' ? { body: fixture('plex-sections.xml') } : {},
  );
  const jellyfin = await fakeServer((r) =>
    r.url === '/Library/VirtualFolders'
      ? { status: options.jellyfinStatus ?? 200, body: fixture('jellyfin-virtual-folders.json') }
      : { status: options.jellyfinStatus ?? 204 },
  );
  const config: Config = {
    apiKey: { plex: 'PTOKEN', jellyfin: 'JKEY' },
    notify: {
      webhooks: [{ url: `${hook.url}/hook?token=SECRET` }],
      plex: {
        url: plex.url,
        paths: [{ from: '/media/movies', to: '/mnt/videos/movies' }],
      },
      jellyfin: {
        url: jellyfin.url,
        paths: [{ from: '/media/movies', to: '/data/movies' }],
      },
    },
  };
  return { config, hook, plex, jellyfin };
}

async function run(args: string[], config: Config) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runNotifyCommand(args, {
    config,
    env: {},
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err, json: () => JSON.parse(out.join('\n')) as unknown };
}

const writes = (server: { received: Received[] }) =>
  server.received.filter((r) => r.method !== 'GET' || r.url.includes('/refresh'));

describe('kinoshelf-server notify test', () => {
  it('reaches every target and changes nothing on the media servers', async () => {
    const { config, hook, plex, jellyfin } = await servers();

    const result = await run(['test'], config);

    expect(result.code).toBe(0);
    expect(result.json()).toEqual([
      {
        target: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/…$/) as string,
        kind: 'webhook',
        ok: true,
        status: 200,
      },
      { target: 'plex', kind: 'plex', ok: true, status: 200 },
      { target: 'jellyfin', kind: 'jellyfin', ok: true, status: 200 },
    ]);
    expect(hook.received).toHaveLength(1); // the test message
    expect(writes(plex)).toEqual([]);
    expect(writes(jellyfin)).toEqual([]);
    expect(result.out).not.toContain('SECRET');
  });

  it('answers at once when a target is down, instead of waiting for retries', async () => {
    const down = await fakeServer();
    const url = down.url;
    await down.close();
    const started = Date.now();

    const result = await run(['test'], { notify: { webhooks: [{ url: `${url}/hook` }] } });

    expect(result.code).toBe(1);
    expect(result.json()).toEqual([
      { target: `${url}/…`, kind: 'webhook', ok: false, error: 'ECONNREFUSED' },
    ]);
    expect(Date.now() - started).toBeLessThan(1000); // retries would wait 6 s
  });

  it('exits 1 and says which target refused', async () => {
    const { config } = await servers({ jellyfinStatus: 401 });
    const result = await run(['test'], config);
    expect(result.code).toBe(1);
    expect(
      (result.json() as { kind: string; ok: boolean; status?: number }[]).find(
        (r) => r.kind === 'jellyfin',
      ),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

describe('kinoshelf-server notify refresh', () => {
  it('asks Plex and Jellyfin to look at the folder, with the paths mapped as in production', async () => {
    const { config, plex, jellyfin } = await servers();

    const result = await run(['refresh', '/media/movies/Dune (2021)'], config);

    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      dryRun: false,
      plex: { refreshed: 1, skipped: [], failed: [] },
      jellyfin: { refreshed: 1, skipped: [], failed: [] },
      wouldSend: [],
    });
    expect(writes(plex).map((r) => decodeURIComponent(r.url))).toEqual([
      '/library/sections/3/refresh?path=/mnt/videos/movies/Dune (2021)',
    ]);
    expect(writes(jellyfin)).toHaveLength(1);
    expect(JSON.parse(writes(jellyfin)[0]?.body ?? '')).toEqual({
      Updates: [{ Path: '/data/movies/Dune (2021)', UpdateType: 'Created' }],
    });
  });

  it('with --dry-run, reads everything but sends nothing, and shows what would go', async () => {
    const { config, plex, jellyfin } = await servers();

    const result = await run(['refresh', '/media/movies/Dune (2021)', '--dry-run'], config);

    expect(result.code).toBe(0);
    expect(writes(plex)).toEqual([]);
    expect(writes(jellyfin)).toEqual([]);
    expect(plex.received.map((r) => r.url)).toEqual(['/library/sections']); // still read the libraries
    expect(result.json()).toMatchObject({
      dryRun: true,
      plex: { wouldRefresh: 1, skipped: [], failed: [] },
      jellyfin: { wouldRefresh: 1, skipped: [], failed: [] },
      wouldSend: [
        { method: 'GET', path: '/library/sections/3/refresh?path=/mnt/videos/movies/Dune (2021)' },
        {
          method: 'POST',
          path: '/Library/Media/Updated',
          body: JSON.stringify({
            Updates: [{ Path: '/data/movies/Dune (2021)', UpdateType: 'Created' }],
          }),
        },
      ],
    });
    expect(result.out).not.toContain('refreshed'); // nothing was: it would be
    expect(result.out).not.toContain('PTOKEN');
    expect(result.out).not.toContain('JKEY');
  });

  it('exits 1 and sends nothing for a folder no library holds: a mapping that is wrong', async () => {
    const { config, plex, jellyfin } = await servers();

    const result = await run(['refresh', '/mnt/Downloads'], config);

    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({
      plex: { refreshed: 0, skipped: ['/mnt/Downloads'] },
      jellyfin: { refreshed: 0, skipped: ['/mnt/Downloads'] },
    });
    expect(writes(plex)).toEqual([]);
    expect(writes(jellyfin)).toEqual([]);
    expect(result.err.some((line) => line.startsWith('warn: Plex: no path mapping covers'))).toBe(
      true,
    );
  });

  it('takes a series folder with --kind series', async () => {
    const { config } = await servers();
    config.notify = {
      plex: {
        url: config.notify?.plex?.url ?? '',
        paths: [{ from: '/media/series', to: '/mnt/videos/tv-shows' }],
      },
    };
    const result = await run(
      ['refresh', '/media/series/Show/Season 01', '--kind', 'series', '--dry-run'],
      config,
    );
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      wouldSend: [{ path: '/library/sections/6/refresh?path=/mnt/videos/tv-shows/Show/Season 01' }],
    });
  });
});

describe('the command line', () => {
  it.each([
    ['no command', []],
    ['an unknown command', ['ping']],
    ['refresh without a path', ['refresh']],
    ['a relative path', ['refresh', 'movies/Dune']],
    ['an unknown kind', ['refresh', '/a', '--kind', 'music']],
    ['an unknown option', ['refresh', '/a', '--force']],
    ['two paths', ['refresh', '/a', '/b']],
  ])('is refused with the usage, exit 2: %s', async (_name, args) => {
    const { config } = await servers();
    const result = await run(args, config);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('Usage: kinoshelf-server notify test');
    expect(result.out).toBe('');
  });

  it('says there is nothing to check when nothing is configured', async () => {
    const result = await run(['test'], {});
    expect(result.code).toBe(1);
    expect(result.json()).toEqual({ error: { code: 'notify.nothing-configured' } });
    expect(
      (await run(['refresh', '/a'], { notify: { webhooks: [{ url: 'http://x.example/h' }] } }))
        .code,
    ).toBe(1);
  });
});
