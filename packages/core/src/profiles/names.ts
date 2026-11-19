/**
 * The names a library may write its own way: the work's folder, the video's file name and the
 * season's folder. What goes beside the video (NFO, images) keeps the names every player reads.
 */
export type CustomNames = {
  readonly [
    Field in 'movieFolder' | 'movieFile' | 'seriesFolder' | 'seasonFolder' | 'episodeFile'
  ]?: string | undefined;
};

export const CUSTOM_NAME_FIELDS = [
  'movieFolder',
  'movieFile',
  'seriesFolder',
  'seasonFolder',
  'episodeFile',
] as const satisfies readonly (keyof CustomNames)[];

/**
 * A type's names go together: whoever writes one writes them all, so a library is never half its
 * owner's and half ours. A customised type is also left as written: Kinoshelf adds nothing to it.
 */
export const NAME_KINDS = {
  movie: ['movieFolder', 'movieFile'],
  series: ['seriesFolder', 'seasonFolder', 'episodeFile'],
} as const satisfies Record<'movie' | 'series', readonly (keyof CustomNames)[]>;

/** Whether the names set for a kind are any: it is then entirely the owner's. */
export const customizes = (
  names: CustomNames | undefined,
  kind: keyof typeof NAME_KINDS,
): boolean => NAME_KINDS[kind].some((field) => names?.[field] !== undefined);
