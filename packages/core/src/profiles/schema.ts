import { z } from 'zod';

const text = z.string().min(1);

export const profileSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: text,
  /** Joins first and last episode of a multi-episode file, e.g. `-e` gives `s02e18-e19`. */
  episodeRangeSeparator: z.string(),
  templates: z.strictObject({
    movieFolder: z.string(),
    movieFile: text,
    seriesFolder: text,
    seasonFolder: text,
    episodeFile: text,
  }),
  nfo: z
    .strictObject({
      format: z.literal('kodi'),
      movie: text,
      episode: text,
      series: text.optional(),
    })
    .nullable()
    .default(null),
  artwork: z
    .array(
      z.strictObject({
        kind: z.enum(['poster', 'fanart', 'season-poster']),
        name: text,
        size: z.enum(['preview', 'standard', 'original']).optional(),
      }),
    )
    .default([]),
  filesystem: z.strictObject({
    forbidden: z.enum(['windows', 'posix']),
    replacement: z.string(),
    maxSegmentBytes: z.number().int().min(16).max(255),
  }),
});

export type ProfileFile = z.infer<typeof profileSchema>;
