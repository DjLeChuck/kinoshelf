import type { Translate } from '@kinoshelf/i18n';

/** What `POST /api/libraries/{id}/imdb-nfo` answers. */
export interface ImdbNfoOutcome {
  readonly rewritten: number;
  readonly already: number;
  readonly noRating: number;
  readonly kept: number;
  readonly missing: number;
  readonly batchId: string | null;
}

/** The one thing worth telling after one work: what changed, else why nothing did. */
export function imdbNfoMessage(outcome: ImdbNfoOutcome, t: Translate): string {
  if (outcome.rewritten > 0) {
    return t('web.imdb-nfo.done', { count: outcome.rewritten });
  }
  if (outcome.kept > 0) {
    return t('web.imdb-nfo.kept');
  }
  if (outcome.already > 0) {
    return t('web.imdb-nfo.already');
  }
  if (outcome.noRating > 0) {
    return t('web.imdb-nfo.no-rating');
  }
  return t('web.imdb-nfo.missing');
}
