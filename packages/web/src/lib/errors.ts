import { describeError, type Translate } from '@kinoshelf/i18n';
import { ApiError, NETWORK_ERROR } from './api.js';

/** What to show for anything a request can throw. */
export function messageOf(t: Translate, error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === NETWORK_ERROR
      ? t('web.error.network')
      : describeError(t, { code: error.code, params: error.params });
  }
  return describeError(t, { code: 'internal.unexpected' });
}
