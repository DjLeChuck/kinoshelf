import type { ErrorCode } from './error-codes.js';
import type { ErrorInfo } from './types/errors.js';

/** Error carrying a language-neutral {@link ErrorInfo}; messages are translated at the edges. */
export class KinoshelfError extends Error {
  readonly info: ErrorInfo;

  constructor(code: ErrorCode, params?: ErrorInfo['params']) {
    super(code);
    this.name = 'KinoshelfError';
    this.info = params ? { code, params } : { code };
  }
}

/** Stops a long task the caller asked to cancel: throws `task.cancelled` once `signal` is aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new KinoshelfError('task.cancelled');
  }
}

/** The system error code of a failed file or process call (`ENOENT`, `EACCES`…), if it has one. */
export function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
