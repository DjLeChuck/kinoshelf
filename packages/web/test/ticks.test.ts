import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/lib/library-items.js';
import { Ticks } from '../src/lib/ticks.svelte.js';

interface Row {
  id: string;
}

function make(initial: readonly string[], total: number | undefined = initial.length) {
  const state: { rows: Row[]; total: number | undefined; reads: number; whole: string[] } = {
    rows: initial.map((id) => ({ id })),
    total,
    reads: 0,
    whole: ['a', 'b', 'c', 'd'],
  };
  const ticks = new Ticks<Row, string>({
    rows: () => state.rows,
    key: (row) => row.id,
    total: () => state.total,
    loaded: () => state.rows.length,
    readAll: () => {
      state.reads += 1;
      state.rows = state.whole.map((id) => ({ id }));
      return Promise.resolve();
    },
  });
  return { state, ticks };
}

describe('Ticks', () => {
  it('ticks rows one by one and tells the "select all" box where it stands', () => {
    const { ticks } = make(['a', 'b']);
    expect(ticks.everyPicked).toBe(false);
    ticks.toggle('a', true);
    expect(ticks.somePicked).toBe(true);
    ticks.toggle('b', true);
    expect(ticks.everyPicked).toBe(true);
    expect(ticks.somePicked).toBe(false);
    ticks.toggle('a', false);
    expect(ticks.picked.map((row) => row.id)).toEqual(['b']);
    ticks.all(false);
    expect(ticks.keys.size).toBe(0);
  });

  it('keeps a tick whose row left the screen out of `picked` but in `keys`', () => {
    const { state, ticks } = make(['a', 'b']);
    ticks.all(true);
    state.rows = [{ id: 'b' }];
    expect(ticks.picked.map((row) => row.id)).toEqual(['b']);
    expect([...ticks.keys]).toEqual(['a', 'b']);
  });

  it('offers everything only once the page is ticked whole and the list is longer', () => {
    const { state, ticks } = make(['a', 'b'], 4);
    expect(ticks.canPickEverything).toBe(false);
    ticks.toggle('a', true);
    expect(ticks.canPickEverything).toBe(false);
    ticks.all(true);
    expect(ticks.canPickEverything).toBe(true);
    state.total = 2;
    expect(ticks.canPickEverything).toBe(false);
    state.total = MAX_SELECTION + 1;
    expect(ticks.canPickEverything).toBe(false);
    state.total = undefined;
    expect(ticks.canPickEverything).toBe(false);
  });

  it('reads the whole list, then ticks what it now holds', async () => {
    const { state, ticks } = make(['a', 'b'], 4);
    ticks.all(true);
    await ticks.pickEverything();
    expect(state.reads).toBe(1);
    expect(ticks.picked.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
