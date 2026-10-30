import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const PROFILE = `
id: kodi-test
name: Kodi test
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title} ({year})'
  movieFile: '{title} ({year})'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
nfo: { format: kodi, movie: movie.nfo, episode: '{file}.nfo' }
artwork: []
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`;

const DUNE = { kind: 'movie', id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 };

interface Report {
  items: { results: { type: string; destination: string; status: string }[] }[];
}

/** A queue holding one file the provider cannot read, under a profile that writes an NFO. */
async function setup(options: { detailsFail?: boolean } = {}) {
  const profile = join(await makeDir(), 'kodi.yaml');
  await writeFile(profile, PROFILE);
  const destination = await makeDir();
  const h = await harness({
    config: { destination, profile },
    createProvider: () => ({
      ...fakeProvider,
      ...(options.detailsFail && {
        getMovieDetails: () => Promise.reject(new Error('tmdb is down')),
      }),
    }),
  });
  const source = await makeDir();
  const file = await put(join(source, 'Mystery.Home.Video.mkv'));
  const created = await h.request('POST', '/api/jobs', { path: source });
  const jobId = created.json<{ id: string }>().id;
  await h.app.jobs.idle();
  const [entry] = (await h.request('GET', `/api/jobs/${jobId}/entries`)).json<{ id: string }[]>();
  return { h, destination, jobId, entryId: entry?.id ?? '', file };
}

describe('metadata files in the validation queue', () => {
  it('plans the NFO of a file a human matched', async () => {
    const { h, destination, jobId, entryId } = await setup();
    const matched = await h.request('POST', `/api/queue/${entryId}/match`, DUNE);
    expect(matched.statusCode).toBe(200);

    const dry = await h.request('POST', `/api/plans/${jobId}/execute`, { dryRun: true });
    const results = dry.json<Report>().items.flatMap((item) => item.results);
    expect(results.map((r) => r.type).sort()).toEqual(['transfer', 'write-file']);
    expect(results.find((r) => r.type === 'write-file')?.destination).toBe(
      join(destination, 'Dune (2021)', 'movie.nfo'),
    );
  });

  it('still previews when the details cannot be fetched, but refuses to match', async () => {
    const { destination, h, entryId } = await setup({ detailsFail: true });
    const preview = await h.request('POST', `/api/queue/${entryId}/preview`, DUNE);
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ destination: string }>().destination).toBe(
      join(destination, 'Dune (2021)', 'Dune (2021).mkv'),
    );

    const matched = await h.request('POST', `/api/queue/${entryId}/match`, DUNE);
    expect(matched.statusCode).toBeGreaterThanOrEqual(500);
    // Nothing was recorded: the file is still waiting for a decision.
    const waiting = (await h.request('GET', '/api/queue')).json<{ id: string }[]>();
    expect(waiting.map((e) => e.id)).toEqual([entryId]);
  });
});
