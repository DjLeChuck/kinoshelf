import { describe, expect, it } from 'vitest';
import type { ReportOperation } from '../src/lib/library-items.js';
import { previewOf } from '../src/lib/run-preview.js';

const op = (
  destination: string,
  type: ReportOperation['type'] = 'transfer',
  role: string | null = type === 'transfer' ? 'main' : null,
): ReportOperation => ({ type, role, source: null, destination, status: 'done', error: null });

const FOLDER = '28 Jours plus tard (2002) {tmdb-170}';
const movie = (folder: string, size = '1080p'): ReportOperation[] => [
  op(`/media/movies/${folder}/${folder} - ${size}.mkv`),
  op(`/media/movies/${folder}/${folder} - ${size}.nfo`, 'transfer', 'sidecar'),
  op(`/media/movies/${folder}/movie.nfo`, 'write-file'),
  op(`/media/movies/${folder}/poster.jpg`, 'download'),
];

describe('previewOf', () => {
  it('tells the shared root once and each movie’s folder once', () => {
    const preview = previewOf({
      items: [
        { entryId: 'a', results: movie(FOLDER) },
        { entryId: 'b', results: movie('28 Semaines plus tard (2007) {tmdb-1562}') },
      ],
    });
    expect(preview.root).toBe('/media/movies/');
    expect(preview.items[0]?.folders.map(({ path }) => path)).toEqual([FOLDER]);
    expect(preview.items[0]?.count).toBe(4);
  });

  it('drops from a file name what its folder already says', () => {
    const folder = previewOf({ items: [{ entryId: 'a', results: movie(FOLDER) }] }).items[0]
      ?.folders[0];
    expect(folder?.moved.map(({ short }) => short)).toEqual(['… - 1080p.mkv', '… - 1080p.nfo']);
    expect(folder?.written.map(({ short }) => short)).toEqual(['movie.nfo', 'poster.jpg']);
  });

  it('keeps the whole name when it does not start with its folder’s', () => {
    const preview = previewOf({
      items: [{ entryId: 'a', results: [op('/lib/Show/Season 01/Show - S01E01.mkv')] }],
    });
    expect(preview.items[0]?.folders[0]?.moved[0]?.short).toBe('Show - S01E01.mkv');
  });

  it('shows a single movie’s folder, not a root as long as the folder itself', () => {
    const preview = previewOf({ items: [{ entryId: 'a', results: movie(FOLDER) }] });
    expect(preview.root).toBe('/media/movies/');
    expect(preview.items[0]?.folders[0]?.path).toBe(FOLDER);
  });

  it('groups an episode’s files by folder when they land in several', () => {
    const preview = previewOf({
      items: [
        {
          entryId: 'a',
          results: [op('/tv/Show/Season 01/e01.mkv'), op('/tv/Show/tvshow.nfo', 'write-file')],
        },
      ],
    });
    expect(preview.root).toBe('/tv/');
    expect(preview.items[0]?.folders.map(({ path }) => path)).toEqual(['Show/Season 01', 'Show']);
  });

  it('flags an item with a blocked operation', () => {
    const blocked: ReportOperation = { ...op('/m/A/a.mkv'), status: 'failed' };
    const preview = previewOf({ items: [{ entryId: 'a', results: [blocked] }] });
    expect(preview.items[0]?.failed).toBe(true);
  });
});
