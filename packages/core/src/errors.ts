import type { ErrorInfo } from './types/errors.js';

/** Error carrying a language-neutral {@link ErrorInfo}; messages are translated at the edges. */
export class KinoshelfError extends Error {
  readonly info: ErrorInfo;

  constructor(code: string, params?: ErrorInfo['params']) {
    super(code);
    this.name = 'KinoshelfError';
    this.info = params ? { code, params } : { code };
  }
}
