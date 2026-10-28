import { TmdbProvider } from '@kinoshelf/provider-tmdb';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadBaseline, loadEntries, type CorpusEntry } from '../src/entries.js';
import { loadRecordings, replayFetch } from '../src/replay.js';
import { runCorpus, summarize, type EntryResult } from '../src/run.js';

let entries: CorpusEntry[];
let results: EntryResult[];
let missing: string[];

beforeAll(async () => {
  entries = await loadEntries();
  const replay = replayFetch(await loadRecordings());
  missing = replay.missing;
  const provider = new TmdbProvider({
    apiKey: 'replay',
    fetch: replay.fetch,
    language: 'en-US',
    sleep: () => Promise.resolve(),
  });
  results = await runCorpus(provider, entries);
});

const describeResult = ({ entry, actual, candidates }: EntryResult): string =>
  `${entry.path} → ${actual.status}${actual.tmdb === undefined ? '' : ` tmdb ${actual.tmdb}`}` +
  (candidates.length > 0 ? ` [${candidates.map((c) => `${c.title} ${c.score}`).join(', ')}]` : '');

describe('matching corpus', () => {
  it('is large and varied enough to mean something', () => {
    expect(entries.length).toBeGreaterThanOrEqual(20);
    expect(new Set(entries.map((e) => e.path)).size).toBe(entries.length);
    const kinds = new Set(
      entries.map((e) => (e.expect.status === 'matched' ? e.expect.kind : 'review')),
    );
    expect(kinds).toEqual(new Set(['movie', 'series', 'review']));
  });

  it('only needs requests that were recorded (otherwise run `pnpm corpus:record`)', () => {
    expect(missing, `unrecorded requests: ${[...new Set(missing)].join(' | ')}`).toEqual([]);
  });

  // The failure that matters: a file renamed wrongly, or renamed when a human should decide.
  it('never matches automatically to the wrong work, nor what needs review', () => {
    const wrong = results.filter((r) => r.verdict === 'wrong-match').map(describeResult);
    expect(wrong).toEqual([]);
  });

  // A ratchet: the rate may only go up. Lowering `data/baseline.json` needs a reason in the PR.
  it('keeps the share of files handled as expected at or above the baseline', async () => {
    const { rate, passed, total } = summarize(results);
    const { minPassRate } = await loadBaseline();
    const failing = results.filter((r) => r.verdict !== 'pass').map(describeResult);

    expect(
      rate,
      `${passed}/${total} handled as expected, baseline ${minPassRate}. Failing:\n${failing.join('\n')}`,
    ).toBeGreaterThanOrEqual(minPassRate);
  });
});
