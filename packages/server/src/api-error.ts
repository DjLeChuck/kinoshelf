import type { ApiErrorCode } from '@kinoshelf/i18n';

/** A failure the client caused or can fix; the HTTP layer turns it into `{ error: { code } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Each has an `error.<code>` message: the web translates it. */
    readonly code: ApiErrorCode,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
