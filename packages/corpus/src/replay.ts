import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DATA_DIR } from './entries.js';

const recordingsSchema = z.record(
  z.string(),
  z.strictObject({ status: z.number(), body: z.string() }),
);
export type Recordings = z.infer<typeof recordingsSchema>;

export const RECORDINGS_FILE = new URL('recordings.json', DATA_DIR);

export async function loadRecordings(): Promise<Recordings> {
  return recordingsSchema.parse(JSON.parse(await readFile(RECORDINGS_FILE, 'utf8')));
}

/** The request as a stable key: path and sorted query, never the API key. */
export function requestKey(url: URL): string {
  const query = new URLSearchParams(url.searchParams);
  query.delete('api_key');
  query.sort();
  return `${url.pathname}?${query.toString()}`;
}

/**
 * A `fetch` that answers from recorded TMDB responses. A request that was never recorded is
 * noted in `missing` (and answered with an error): the corpus changed, so it needs recording
 * again with `pnpm corpus:record`.
 */
export function replayFetch(recordings: Recordings): { fetch: typeof fetch; missing: string[] } {
  const missing: string[] = [];
  const replay: typeof fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = requestKey(url);
    const recorded = recordings[key];
    if (!recorded) {
      missing.push(key);
      return Promise.resolve(new Response('not recorded', { status: 500 }));
    }
    return Promise.resolve(new Response(recorded.body, { status: recorded.status }));
  };
  return { fetch: replay, missing };
}
