#!/usr/bin/env node
import { TmdbProvider } from '@kinoshelf/provider-tmdb';
import { loadBaseline, loadEntries } from './entries.js';
import { loadRecordings, replayFetch } from './replay.js';
import { runCorpus, summarize } from './run.js';

/** Prints every entry with its verdict and score, to calibrate the matching weights. */
const recordings = await loadRecordings();
const { fetch, missing } = replayFetch(recordings);
const provider = new TmdbProvider({
  apiKey: 'replay',
  fetch,
  language: 'en-US',
  sleep: () => Promise.resolve(),
});

const results = await runCorpus(provider, await loadEntries());
for (const { entry, verdict, actual, candidates } of results) {
  const mark = verdict === 'pass' ? 'ok ' : verdict === 'wrong-match' ? 'BAD' : 'miss';
  const got =
    actual.status === 'matched'
      ? `matched ${actual.title ?? ''} (${actual.year ?? '?'}) tmdb ${actual.tmdb ?? '?'} score ${actual.score ?? '?'}`
      : actual.status;
  console.log(`${mark}  ${entry.path}\n      → ${got}`);
  if (verdict !== 'pass' || actual.status !== 'matched') {
    for (const c of candidates) {
      console.log(`      · ${c.title} (${c.year ?? '?'}) tmdb ${c.tmdb} score ${c.score}`);
    }
  }
}

const summary = summarize(results);
const baseline = await loadBaseline();
console.log(
  `\n${summary.passed}/${summary.total} as expected (${(summary.rate * 100).toFixed(1)}%), ` +
    `${summary.wrongMatches} wrong automatic match(es), ${summary.missed} missed. ` +
    `Baseline ${(baseline.minPassRate * 100).toFixed(1)}%.`,
);
if (missing.length > 0) {
  console.log(`\n${missing.length} request(s) not recorded; run: pnpm corpus:record`);
  process.exitCode = 1;
}
