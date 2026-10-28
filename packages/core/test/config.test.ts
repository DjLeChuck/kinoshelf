import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configDirectory, ensureConfigDirectory, loadConfig } from '../src/config/config.js';
import { KinoshelfError } from '../src/errors.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

// root ignores file modes, so these cases cannot fail there.
const asUser = process.getuid?.() === 0 ? it.skip : it;

describe('config directory permissions', () => {
  asUser('reports a directory that cannot be written, with the uid', async () => {
    const dir = await makeDir();
    await chmod(dir, 0o555);
    try {
      await expect(ensureConfigDirectory(dir)).rejects.toMatchObject({
        info: { code: 'config.dir-not-writable', params: { path: dir } },
      });
    } finally {
      await chmod(dir, 0o755);
    }
  });

  it('creates a missing directory', async () => {
    const dir = join(await makeDir(), 'a', 'b');
    await ensureConfigDirectory(dir);
    await ensureConfigDirectory(dir);
  });

  asUser('reports an unreadable config.yaml as a permission error', async () => {
    const dir = await makeDir();
    await put(join(dir, 'config.yaml'), 'locale: fr\n');
    await chmod(join(dir, 'config.yaml'), 0o000);
    await expect(loadConfig(dir)).rejects.toMatchObject({
      info: { code: 'fs.permission-denied', params: { path: join(dir, 'config.yaml') } },
    });
  });
});

describe('loadConfig', () => {
  it('treats a missing file as no configuration', async () => {
    expect(await loadConfig(await makeDir())).toEqual({});
  });

  it('reads known settings', async () => {
    const dir = await makeDir();
    await put(
      join(dir, 'config.yaml'),
      'locale: fr\nmode: hardlink\nthreshold: 90\nprofile: plex\ndestination: /media\n',
    );
    expect(await loadConfig(dir)).toEqual({
      locale: 'fr',
      mode: 'hardlink',
      threshold: 90,
      profile: 'plex',
      destination: '/media',
    });
  });

  it('reads the key of each service and a destination per kind', async () => {
    const dir = await makeDir();
    await put(
      join(dir, 'config.yaml'),
      'apiKey:\n  tmdb: abc\ndestination:\n  movies: /films\n  series: /shows\n',
    );
    expect(await loadConfig(dir)).toEqual({
      apiKey: { tmdb: 'abc' },
      destination: { movies: '/films', series: '/shows' },
    });
  });

  it('reads the retention and rejects a negative or fractional one', async () => {
    const dir = await makeDir();
    await put(join(dir, 'config.yaml'), 'retentionDays: 30\n');
    expect(await loadConfig(dir)).toEqual({ retentionDays: 30 });
    for (const bad of ['-1', '1.5', 'soon']) {
      await put(join(dir, 'config.yaml'), `retentionDays: ${bad}\n`);
      await expect(loadConfig(dir)).rejects.toMatchObject({ info: { code: 'config.invalid' } });
    }
  });

  it('reads the notification targets and the media server keys', async () => {
    const dir = await makeDir();
    await put(
      join(dir, 'config.yaml'),
      [
        'apiKey:',
        '  plex: tok',
        '  jellyfin: key',
        'notify:',
        '  webhooks:',
        '    - url: https://gotify.example/message',
        '      format: gotify',
        '      on: [failed, needs-review]',
        '      headers: { X-Gotify-Key: abc }',
        '  plex:',
        '    url: http://plex:32400',
        '    section: 3',
        '    paths:',
        '      - { from: /media/movies, to: /mnt/videos/movies }',
        '  jellyfin:',
        '    url: http://jellyfin:8096',
        '',
      ].join('\n'),
    );
    expect(await loadConfig(dir)).toEqual({
      apiKey: { plex: 'tok', jellyfin: 'key' },
      notify: {
        webhooks: [
          {
            url: 'https://gotify.example/message',
            format: 'gotify',
            on: ['failed', 'needs-review'],
            headers: { 'X-Gotify-Key': 'abc' },
          },
        ],
        plex: {
          url: 'http://plex:32400',
          section: 3,
          paths: [{ from: '/media/movies', to: '/mnt/videos/movies' }],
        },
        jellyfin: { url: 'http://jellyfin:8096' },
      },
    });
  });

  it.each([
    ['a webhook without url', 'notify:\n  webhooks:\n    - format: ntfy\n'],
    ['an unknown format', 'notify:\n  webhooks:\n    - { url: "https://a.b/c", format: slack }\n'],
    ['an unknown event', 'notify:\n  webhooks:\n    - { url: "https://a.b/c", on: [done] }\n'],
    ['no event at all', 'notify:\n  webhooks:\n    - { url: "https://a.b/c", on: [] }\n'],
    ['a url that is not one', 'notify:\n  plex:\n    url: plex\n'],
    [
      'a mapping without target',
      'notify:\n  plex:\n    url: "http://p:1"\n    paths:\n      - { from: /a }\n',
    ],
    ['an unknown notify key', 'notify:\n  email: a@b.c\n'],
  ])('rejects a notify section with %s', async (_name, content) => {
    const dir = await makeDir();
    await put(join(dir, 'config.yaml'), content);
    await expect(loadConfig(dir)).rejects.toMatchObject({ info: { code: 'config.invalid' } });
  });

  it('treats an empty file as no configuration', async () => {
    const dir = await makeDir();
    await put(join(dir, 'config.yaml'), '');
    expect(await loadConfig(dir)).toEqual({});
  });

  it.each([
    ['unknown key', 'colour: blue\n'],
    ['bad mode', 'mode: teleport\n'],
    ['threshold out of range', 'threshold: 150\n'],
    ['bad yaml', 'locale: [unclosed\n'],
    ['wrong type', 'threshold: high\n'],
    ['the former tmdbApiKey', 'tmdbApiKey: abc\n'],
    ['the former destinationMovies', 'destinationMovies: /films\n'],
    ['a destination with one kind only', 'destination:\n  movies: /films\n'],
    ['an unknown service key', 'apiKey:\n  tvdb: abc\n'],
  ])('rejects %s with the file path', async (_name, content) => {
    const dir = await makeDir();
    await put(join(dir, 'config.yaml'), content);
    await expect(loadConfig(dir)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof KinoshelfError &&
        error.info.code === 'config.invalid' &&
        error.info.params?.path === join(dir, 'config.yaml'),
    );
  });
});

describe('configDirectory', () => {
  it('prefers the flag, then the environment, then XDG, then the home directory', () => {
    expect(configDirectory('/flag', { KINOSHELF_CONFIG_DIR: '/env' })).toBe('/flag');
    expect(configDirectory(undefined, { KINOSHELF_CONFIG_DIR: '/env' })).toBe('/env');
    expect(configDirectory(undefined, { XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/kinoshelf');
    expect(configDirectory(undefined, {})).toMatch(/\.config[\\/]kinoshelf$/);
  });
});
