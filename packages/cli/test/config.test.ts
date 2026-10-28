import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configDirectory, loadConfig } from '../src/config.js';
import { CliError } from '../src/errors.js';
import { cleanup, makeDir, put } from './helpers.js';

afterEach(cleanup);

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
  ])('rejects %s with the file path', async (_name, content) => {
    const dir = await makeDir();
    await put(join(dir, 'config.yaml'), content);
    await expect(loadConfig(dir)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CliError &&
        error.code === 'config.invalid' &&
        error.params?.path === join(dir, 'config.yaml'),
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
