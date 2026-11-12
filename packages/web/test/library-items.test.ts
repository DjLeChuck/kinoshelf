import { describe, expect, it } from 'vitest';
import {
  inChunks,
  canNameVersion,
  PICTURE_SIZES,
  sizeOfItem,
  canRun,
  episodeLabel,
  groupSettling,
  settleKey,
  type LibraryItem,
  isSettling,
  isStalled,
  itemsUrl,
  partition,
  tally,
  scanPercent,
  showsUrl,
  showStatusKey,
  type ScanProgress,
} from '../src/lib/library-items.js';

const progress = (over: Partial<ScanProgress> = {}): ScanProgress => ({
  phase: 'identify',
  found: 100,
  done: 25,
  total: 100,
  current: null,
  idleSeconds: 0,
  ...over,
});

describe('itemsUrl', () => {
  it('asks only for what is set, and encodes the text', () => {
    expect(itemsUrl('films', { limit: 50 })).toBe('/api/libraries/films/items?limit=50');
    expect(itemsUrl('films', { state: 'review', q: ' blade runner ', limit: 100 })).toBe(
      '/api/libraries/films/items?state=review&q=blade%20runner&limit=100',
    );
    expect(itemsUrl('films', { q: '  ', limit: 50 })).not.toContain('q=');
  });

  it('combines a state with the versions and a direction', () => {
    expect(
      itemsUrl('films', { state: 'rename', multi: true, sort: 'year', dir: 'asc', limit: 50 }),
    ).toBe('/api/libraries/films/items?state=rename&multi=true&sort=year&dir=asc&limit=50');
    expect(itemsUrl('films', { multi: false, limit: 50 })).not.toContain('multi');
  });
});

describe('scanPercent', () => {
  it('is unknown while the folder is still being walked, and a whole percent after', () => {
    expect(scanPercent(null)).toBeUndefined();
    expect(scanPercent(progress({ phase: 'discover' }))).toBeUndefined();
    expect(scanPercent(progress({ total: 0 }))).toBeUndefined();
    expect(scanPercent(progress())).toBe(25);
    expect(scanPercent(progress({ done: 100 }))).toBe(100);
    expect(scanPercent(progress({ phase: 'plan', done: 100 }))).toBeUndefined();
    expect(scanPercent(progress({ phase: 'read', done: 50 }))).toBe(50);
  });
});

describe('isStalled', () => {
  it('says so after a minute without movement', () => {
    expect(isStalled(progress({ idleSeconds: 59 }))).toBe(false);
    expect(isStalled(progress({ idleSeconds: 60 }))).toBe(true);
    expect(isStalled(null)).toBe(false);
  });
});

describe('showsUrl', () => {
  it('asks only for what is set', () => {
    expect(showsUrl('series', { limit: 50 })).toBe('/api/libraries/series/shows?limit=50');
    expect(showsUrl('series', { q: ' the office ', missing: true, limit: 20 })).toBe(
      '/api/libraries/series/shows?q=the%20office&missing=true&limit=20',
    );
    expect(showsUrl('series', { missing: false, limit: 50 })).not.toContain('missing');
    expect(showsUrl('series', { incomplete: true, limit: 50 })).toBe(
      '/api/libraries/series/shows?incomplete=true&limit=50',
    );
    expect(
      showsUrl('series', { state: 'rename', multi: true, sort: 'missing', dir: 'asc', limit: 50 }),
    ).toBe('/api/libraries/series/shows?state=rename&multi=true&sort=missing&dir=asc&limit=50');
    expect(showsUrl('series', { sort: 'title', limit: 50 })).not.toContain('sort');
  });
});

describe('episodeLabel', () => {
  it('pads the numbers and shows the end of a range', () => {
    expect(episodeLabel(1, 2)).toBe('S01E02');
    expect(episodeLabel(12, 105)).toBe('S12E105');
    expect(episodeLabel(1, 2, 3)).toBe('S01E02-E03');
    expect(episodeLabel(0, 1)).toBe('S00E01');
  });

  it('is empty for a file without a season or an episode', () => {
    expect(episodeLabel(null, null)).toBe('');
    expect(episodeLabel(1, null)).toBe('');
  });
});

describe('isSettling', () => {
  it('is true for the files a person must decide', () => {
    expect(isSettling({ state: 'review' })).toBe(true);
    expect(isSettling({ state: 'unrecognized' })).toBe(true);
    expect(isSettling({ state: 'rename' })).toBe(false);
    expect(isSettling({ state: 'ok' })).toBe(false);
  });
});

describe('canRun and partition', () => {
  const rows = [
    { id: 'a', state: 'rename' },
    { id: 'b', state: 'incomplete' },
    { id: 'c', state: 'ok' },
    { id: 'd', state: 'review' },
  ] as const;

  it('keeps what has something to run, and splits it by what is asked', () => {
    expect(rows.filter(canRun).map(({ id }) => id)).toEqual(['a', 'b']);
    expect(partition(rows)).toEqual({ rename: ['a'], refresh: ['b'] });
  });
});

describe('canNameVersion', () => {
  const movie = {
    kind: 'movie',
    entryId: 'e',
    state: 'ok',
    path: '/films/Dune (2021)/Dune (2021).mkv',
    resolution: null,
  } as const;

  it('is offered for a movie or an episode, whatever its state and its name', () => {
    expect(canNameVersion(movie)).toBe(true);
    expect(canNameVersion({ ...movie, kind: 'series' })).toBe(true);
    expect(canNameVersion({ ...movie, state: 'rename' })).toBe(true);
  });

  it('is not offered when the name already says the size, as the server would find nothing to do', () => {
    const named = {
      ...movie,
      path: '/films/Dune (2021)/Dune (2021) - 2160p.mkv',
      resolution: '2160p',
    };
    expect(canNameVersion(named)).toBe(false);
    // A size elsewhere in the name still has a label to add.
    expect(
      canNameVersion({ ...movie, path: '/films/Alien.1979.1080p.mkv', resolution: '1080p' }),
    ).toBe(true);
  });

  it('is not offered when the server would refuse', () => {
    expect(canNameVersion({ ...movie, entryId: null })).toBe(false);
    expect(canNameVersion({ ...movie, kind: null })).toBe(false);
    expect(canNameVersion({ ...movie, state: 'review' })).toBe(false);
  });

  it('starts from the size the name says when it can be picked, else from none', () => {
    expect(sizeOfItem({ resolution: '1080p' })).toBe('1080p');
    expect(sizeOfItem({ resolution: null })).toBe('');
    expect(sizeOfItem({ resolution: '8k' })).toBe('');
    expect(PICTURE_SIZES[0]).toBe('2160p');
  });
});

describe('tally', () => {
  const op = (type: 'transfer' | 'write-file', status: 'done' | 'skipped' | 'failed') => ({
    type,
    role: null,
    source: null,
    destination: '/x',
    status,
    error: null,
  });

  it('counts moves and written files apart, and what would be left alone', () => {
    const report = {
      items: [
        { entryId: '1', results: [op('transfer', 'done'), op('write-file', 'done')] },
        { entryId: '2', results: [op('write-file', 'skipped'), op('write-file', 'failed')] },
      ],
    };
    expect(tally(report)).toEqual({ transfers: 1, written: 2, skipped: 1, failed: 1 });
  });
});

describe('inChunks', () => {
  it('reads past what one request may ask for, 200 at a time', async () => {
    const all = Array.from({ length: 450 }, (_, n) => n);
    const asked: [number, number][] = [];
    const page = await inChunks(250, (limit, offset) => {
      asked.push([limit, offset]);
      return Promise.resolve({ total: all.length, items: all.slice(offset, offset + limit) });
    });
    expect(asked).toEqual([
      [200, 0],
      [50, 200],
    ]);
    expect(page.items).toEqual(all.slice(0, 250));
    expect(page.total).toBe(450);
  });

  it('stops at the end of the list', async () => {
    const asked: number[] = [];
    const page = await inChunks(400, (limit, offset) => {
      asked.push(offset);
      return Promise.resolve({ total: 3, items: [1, 2, 3].slice(offset, offset + limit) });
    });
    expect(asked).toEqual([0]);
    expect(page.items).toEqual([1, 2, 3]);
  });
});

describe('groupSettling', () => {
  const file = (path: string, over: Partial<LibraryItem> = {}): LibraryItem =>
    ({
      id: path,
      path,
      state: 'review',
      kind: 'series',
      release: '/lib/Foundation',
      cluster: 0,
      releaseFiles: null,
      ...over,
    }) as LibraryItem;

  it('puts the episodes of one release and series together, in order of appearance', () => {
    const groups = groupSettling([
      file('/lib/Foundation/S01E01.mkv'),
      file('/lib/Other/E1.mkv', { release: '/lib/Other' }),
      file('/lib/Foundation/S01E02.mkv'),
      file('/lib/Foundation/Odd.mkv', { cluster: 1 }),
    ]);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1]);
    expect(groups[0]?.name).toBe('/lib/Foundation');
    expect(groups[2]?.detached).toBe(true);
  });

  it('counts the whole release when the list holds only a part of it', () => {
    const [group] = groupSettling([file('/lib/Foundation/S01E01.mkv', { releaseFiles: 30 })]);
    expect(group?.files).toBe(30);
  });

  it('never groups movies, nor files whose release is unknown', () => {
    const groups = groupSettling([
      file('/lib/a.mkv', { kind: 'movie' }),
      file('/lib/b.mkv', { kind: 'movie' }),
      file('/lib/c.mkv', { release: null, cluster: null }),
    ]);
    expect(groups).toHaveLength(3);
  });
});

describe('showStatusKey', () => {
  it('names the statuses TMDB gives a series, and leaves any other as it came', () => {
    expect(showStatusKey('Returning Series')).toBe('web.library.show.status.returning');
    expect(showStatusKey('Ended')).toBe('web.library.show.status.ended');
    expect(showStatusKey('Cancelled')).toBeUndefined();
    expect(showStatusKey('toString')).toBeUndefined();
  });
});

describe('settleKey', () => {
  it('is the same for an arrival read at the click as for the row of the list it came from', () => {
    // What a validation locks is read from the file validated, not looked up in a list that the
    // validation itself empties of it.
    const row = { release: '/d/Pack', cluster: 0, kind: 'series', path: '/d/Pack/a.mkv' } as const;
    const arrival = {
      release: '/d/Pack',
      cluster: 0,
      kind: 'series',
      path: '/d/Pack/b.mkv',
    } as const;
    expect(settleKey(arrival)).toBe(settleKey(row));
    expect(settleKey({ ...arrival, cluster: 1 })).not.toBe(settleKey(row));
    // A movie is validated alone.
    expect(settleKey({ ...row, kind: 'movie' })).toBe('/d/Pack/a.mkv');
  });
});
