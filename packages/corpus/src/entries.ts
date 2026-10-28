import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * What the matcher must do with a file: `matched` to this exact work (and, for a series, this
 * season and these episodes), or `review` when a human has to decide. A file that should be
 * reviewed but gets matched is the worst failure, because it would be renamed wrongly.
 */
const expectation = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('matched'),
    tmdb: z.number().int(),
    kind: z.enum(['movie', 'series']),
    season: z.number().int().optional(),
    episodes: z.array(z.number().int()).optional(),
  }),
  z.strictObject({ status: z.literal('review') }),
]);

const entrySchema = z.strictObject({
  /** The path as the parser receives it (relative to the scanned folder's parent). */
  path: z.string().min(1),
  note: z.string().optional(),
  expect: expectation,
});

export type CorpusEntry = z.infer<typeof entrySchema>;

export const DATA_DIR = new URL('../data/', import.meta.url);

export async function loadEntries(): Promise<CorpusEntry[]> {
  const raw: unknown = JSON.parse(await readFile(new URL('corpus.json', DATA_DIR), 'utf8'));
  return z.array(entrySchema).parse(raw);
}

export const baselineSchema = z.strictObject({
  /** Lowest acceptable share of entries handled as expected. Only ever raise it. */
  minPassRate: z.number().min(0).max(1),
});

export async function loadBaseline(): Promise<z.infer<typeof baselineSchema>> {
  const raw: unknown = JSON.parse(await readFile(new URL('baseline.json', DATA_DIR), 'utf8'));
  return baselineSchema.parse(raw);
}
