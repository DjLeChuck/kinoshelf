import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSidecars } from '../src/planning/sidecars.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

describe('findSidecars with a shared listing', () => {
  it('reads a folder once for all its videos, and finds each one its own files', async () => {
    const root = await makeDir();
    const one = await put(join(root, 'S01E01.mkv'));
    const two = await put(join(root, 'S01E02.mkv'));
    await put(join(root, 'S01E01.en.srt'));
    await put(join(root, 'S01E02.nfo'));

    const listings = new Map<string, Promise<string[]>>();
    const first = await findSidecars(one, undefined, listings);
    const second = await findSidecars(two, undefined, listings);

    expect(listings.size).toBe(1);
    expect([...listings.keys()]).toEqual([dirname(one)]);
    expect(first.map(({ suffix }) => suffix)).toEqual(['.en.srt']);
    expect(second.map(({ suffix }) => suffix)).toEqual(['.nfo']);
  });
});

describe('findSidecars in a Subs folder', () => {
  const suffixesOf = async (source: string) =>
    (await findSidecars(source)).map(({ path, suffix }) => [basename(path), suffix]);

  it('takes the files of a movie release, named by their language', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'Subs', '2_French.srt'));
    await put(join(root, 'Subs', '3_English.srt'));
    await put(join(root, 'Subs', '4_English_Forced.srt'));
    await put(join(root, 'Subs', '5_English SDH.srt'));

    expect(await suffixesOf(video)).toEqual([
      ['2_French.srt', '.fr.srt'],
      ['3_English.srt', '.en.srt'],
      ['4_English_Forced.srt', '.en.forced.srt'],
      ['5_English SDH.srt', '.en.sdh.srt'],
    ]);
  });

  it('leaves behind a file whose language is not told, and a second one for a language taken', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'Subs', 'Dune.srt'));
    await put(join(root, 'Subs', '2_French.srt'));
    await put(join(root, 'Subs', '3_French.srt'));

    expect(await suffixesOf(video)).toEqual([['2_French.srt', '.fr.srt']]);
  });

  it('does not take a word of the title for a language', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Amelie.mkv'));
    await put(join(root, 'Subs', 'Le Destin de Amelie.srt'));
    expect(await suffixesOf(video)).toEqual([]);
  });

  it('reads a bare code, only when it is all the name says', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'Subs', 'es.srt'));
    await put(join(root, 'Subs', 'it.srt'));
    await put(join(root, 'Subs', 'no yes.srt'));
    expect(await suffixesOf(video)).toEqual([
      ['es.srt', '.es.srt'],
      ['it.srt', '.it.srt'],
    ]);
  });

  it('keeps an idx and its sub together', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'Subs', '2_French.idx'));
    await put(join(root, 'Subs', '2_French.sub'));
    expect(await suffixesOf(video)).toEqual([
      ['2_French.idx', '.fr.idx'],
      ['2_French.sub', '.fr.sub'],
    ]);
  });

  it('gives each episode of a season pack its own sub-folder, found by name or by number', async () => {
    const root = await makeDir();
    const one = await put(join(root, 'Show.S01E01.1080p.mkv'));
    const two = await put(join(root, 'Show.S01E02.1080p.mkv'));
    await put(join(root, 'Subs', 'Show.S01E01.1080p', '2_English.srt'));
    await put(join(root, 'Subs', 'Show.S01E02.1080p', '2_English.srt'));
    await put(join(root, 'Subs', 'Show.S01E02.1080p', '3_French.srt'));
    await put(join(root, 'Subs', 'Show 1x01 en français.srt'));

    expect(await suffixesOf(one)).toEqual([
      ['Show 1x01 en français.srt', '.fr.srt'],
      ['2_English.srt', '.en.srt'],
    ]);
    expect(await suffixesOf(two)).toEqual([
      ['2_English.srt', '.en.srt'],
      ['3_French.srt', '.fr.srt'],
    ]);
  });

  it('gives a flat file of a season pack to the episode it names, and to no other', async () => {
    const root = await makeDir();
    const one = await put(join(root, 'Show.S01E01.mkv'));
    const two = await put(join(root, 'Show.S01E02.mkv'));
    await put(join(root, 'Subs', 'Show.S01E02.French.srt'));
    expect(await suffixesOf(one)).toEqual([]);
    expect(await suffixesOf(two)).toEqual([['Show.S01E02.French.srt', '.fr.srt']]);
  });

  it('is not troubled by a sample beside the video, nor by a folder that is no Subs', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'sample-dune.mkv'));
    await put(join(root, 'Subs', 'French.srt'));
    await put(join(root, 'Extras', 'French.srt'));
    expect(await suffixesOf(video)).toEqual([['French.srt', '.fr.srt']]);
  });

  it('keeps what sits beside the video first: its suffix is not taken twice', async () => {
    const root = await makeDir();
    const video = await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'Dune.2021.fr.srt'));
    await put(join(root, 'Subs', 'French.srt'));
    expect(await suffixesOf(video)).toEqual([['Dune.2021.fr.srt', '.fr.srt']]);
  });
});
