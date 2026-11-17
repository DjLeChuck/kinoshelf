import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryJournal, tidySubtitles, undoBatch, type TidyLibrary } from '../src/index.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A movie library holding Dune, already named as the profile wants, with a Subs folder beside it. */
async function setup(subs: Record<string, string>, folderName = 'Subs') {
  const library: TidyLibrary = { id: 'films', type: 'movie', source: await makeDir() };
  const folder = join(library.source, 'Dune (2021)');
  await put(join(folder, 'Dune (2021).mkv'), 'video');
  for (const [name, content] of Object.entries(subs)) {
    await put(join(folder, folderName, name), content);
  }
  return { library, folder, journal: new MemoryJournal(), folderName };
}

const run = (s: Awaited<ReturnType<typeof setup>>, dryRun = false) =>
  tidySubtitles(s.library, { journal: s.journal, dryRun });

describe('tidySubtitles', () => {
  it('brings a Subs folder next to a video already in place, named by language, and undo puts it back', async () => {
    const s = await setup({
      '2_French.srt': 'fr',
      '3_English_Forced.srt': 'en',
      '4_English SDH.srt': 'sdh',
    });

    const { batchId, files, left } = await run(s);

    expect(files.map((f) => [f.status, f.destination.slice(s.folder.length + 1)])).toEqual([
      ['done', 'Dune (2021).fr.srt'],
      ['done', 'Dune (2021).en.forced.srt'],
      ['done', 'Dune (2021).en.sdh.srt'],
    ]);
    expect(left).toEqual([]);
    expect(await readFile(join(s.folder, 'Dune (2021).fr.srt'), 'utf8')).toBe('fr');
    // The Subs folder is empty, so it goes.
    expect(await exists(join(s.folder, 'Subs'))).toBe(false);

    await undoBatch(s.journal, batchId ?? '');
    expect(await readFile(join(s.folder, 'Subs', '2_French.srt'), 'utf8')).toBe('fr');
    expect(await exists(join(s.folder, 'Dune (2021).fr.srt'))).toBe(false);
  });

  it.each(['Sub', 'Subtitles', 'Subtitle'])('reads a folder called %s too', async (name) => {
    const s = await setup({ 'French.srt': 'fr' }, name);
    const { files } = await run(s);
    expect(files.map((f) => f.status)).toEqual(['done']);
    expect(await exists(join(s.folder, 'Dune (2021).fr.srt'))).toBe(true);
  });

  it('writes nothing in a dry run', async () => {
    const s = await setup({ '2_French.srt': 'fr' });
    const { batchId, files } = await run(s, true);
    expect(batchId).toBeNull();
    expect(files.map((f) => f.status)).toEqual(['would-do']);
    expect(await exists(join(s.folder, 'Subs', '2_French.srt'))).toBe(true);
  });

  it('leaves a file with no language, and a second one for a language taken, and says why', async () => {
    const s = await setup({ '2_French.srt': 'fr', '3_French.srt': 'again', 'Dune.srt': 'unknown' });
    const { files, left } = await run(s);
    expect(files.map((f) => f.status)).toEqual(['done']);
    expect(left.map(({ path, reason }) => [path.slice(s.folder.length + 1), reason])).toEqual([
      [join('Subs', '3_French.srt'), 'language-taken'],
      [join('Subs', 'Dune.srt'), 'language-unknown'],
    ]);
    // What stays keeps its folder.
    expect(await exists(join(s.folder, 'Subs', 'Dune.srt'))).toBe(true);
  });

  it('never overwrites a file already beside the video, and is idempotent', async () => {
    const s = await setup({ '2_French.srt': 'from Subs' });
    await put(join(s.folder, 'Dune (2021).fr.srt'), 'mine');

    const first = await run(s);
    // The French file is already beside the video: nothing from Subs takes its name.
    expect(first.files).toEqual([]);
    expect(await readFile(join(s.folder, 'Dune (2021).fr.srt'), 'utf8')).toBe('mine');

    const again = await run(s);
    expect(again).toMatchObject({ batchId: null, files: [] });
  });

  it('gives each episode of a season its own files, by sub-folder or by number', async () => {
    const library: TidyLibrary = { id: 'shows', type: 'series', source: await makeDir() };
    const season = join(library.source, 'Show (2020)', 'Season 01');
    await put(join(season, 'Show (2020) - s01e01.mkv'));
    await put(join(season, 'Show (2020) - s01e02.mkv'));
    await put(join(season, 'Subs', 'Show (2020) - s01e01', '2_English.srt'));
    await put(join(season, 'Subs', 'Show 1x02 French.srt'));
    const journal = new MemoryJournal();

    const { files } = await tidySubtitles(library, { journal, dryRun: false });

    expect(files.map((f) => f.destination.slice(season.length + 1)).sort()).toEqual([
      'Show (2020) - s01e01.en.srt',
      'Show (2020) - s01e02.fr.srt',
    ]);
  });

  it('keeps a Subs folder that holds something of the owner’s', async () => {
    const s = await setup({ '2_French.srt': 'fr', 'notes.txt': 'mine' });
    await run(s);
    expect(await exists(join(s.folder, 'Subs', 'notes.txt'))).toBe(true);
  });

  it('tells the progress', async () => {
    const s = await setup({ '2_French.srt': 'fr' });
    const seen: number[][] = [];
    await tidySubtitles(s.library, {
      journal: s.journal,
      dryRun: true,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
});
