import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { editConfig, loadConfig } from '../src/config/config.js';
import {
  legacyWatchMigration,
  libraryId,
  libraryOverrides,
  watchedFolders,
} from '../src/config/libraries.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

describe('libraries', () => {
  it('turns a library into overrides, leaving out what it does not set', () => {
    expect(libraryOverrides({ id: 'a', name: 'A', source: '/s' })).toEqual({});
    expect(
      libraryOverrides({
        id: 'a',
        name: 'A',
        source: '/s',
        destination: { movies: '/m', series: '/t' },
        profile: 'jellyfin',
        mode: 'hardlink',
        threshold: 90,
      }),
    ).toEqual({
      destMovies: '/m',
      destSeries: '/t',
      profile: 'jellyfin',
      mode: 'hardlink',
      threshold: 90,
    });
    expect(libraryOverrides({ id: 'a', name: 'A', source: '/s', destination: '/d' })).toEqual({
      dest: '/d',
    });
  });

  it('lists the sources of the watched libraries only', () => {
    expect(
      watchedFolders({
        libraries: [
          { id: 'a', name: 'A', source: '/a', watch: true },
          { id: 'b', name: 'B', source: '/b' },
          { id: 'c', name: 'C', source: '/c', watch: false },
        ],
      }),
    ).toEqual(['/a']);
  });

  it('builds a readable id, unique among the others', () => {
    expect(libraryId('Téléchargements → Plex', new Set())).toBe('telechargements-plex');
    expect(libraryId('Films', new Set(['films', 'films-2']))).toBe('films-3');
    expect(libraryId('→→', new Set())).toBe('library');
  });

  it('rejects two libraries with the same id', async () => {
    const dir = await makeDir();
    await put(
      join(dir, 'config.yaml'),
      'libraries:\n  - {id: a, name: A, source: /a}\n  - {id: a, name: B, source: /b}\n',
    );
    await expect(loadConfig(dir)).rejects.toMatchObject({ info: { code: 'config.invalid' } });
  });

  describe('legacy watch folders', () => {
    it('moves them into libraries and keeps the other watch settings and the comments', async () => {
      const dir = await makeDir();
      await put(
        join(dir, 'config.yaml'),
        '# mine\nwatch:\n  folders: [/dl/complete, /dl/more/]\n  settleSeconds: 30\n',
      );
      const edits = legacyWatchMigration(await loadConfig(dir));
      const config = await editConfig(dir, edits);
      expect(config.watch).toEqual({ settleSeconds: 30 });
      expect(config.libraries).toEqual([
        { id: 'complete', name: 'complete', source: '/dl/complete', watch: true },
        { id: 'more', name: 'more', source: '/dl/more/', watch: true },
      ]);
      expect(await readFile(join(dir, 'config.yaml'), 'utf8')).toContain('# mine');
      expect(legacyWatchMigration(config)).toEqual([]);
    });

    it('drops the watch key when nothing else is in it, and reuses a library on that source', async () => {
      const dir = await makeDir();
      await put(
        join(dir, 'config.yaml'),
        'watch:\n  folders: [/dl]\nlibraries:\n  - {id: dl, name: Mine, source: /dl, mode: move}\n',
      );
      const config = await editConfig(dir, legacyWatchMigration(await loadConfig(dir)));
      expect(config.watch).toBeUndefined();
      expect(config.libraries).toEqual([
        { id: 'dl', name: 'Mine', source: '/dl', mode: 'move', watch: true },
      ]);
    });
  });
});
