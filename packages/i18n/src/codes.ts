/**
 * Codes raised by the CLI itself, next to the core's own. The catalogs must translate both, so the
 * list lives with them and the compiler rejects a code without a message.
 */
export const CLI_ERROR_CODES = [
  'cleanup.no-folder',
  'config.invalid-value',
  'undo.batch-already-undone',
  'undo.batch-not-found',
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

/** Codes the server binary raises on its own when it cannot start. */
export const SERVER_ERROR_CODES = ['server.port-denied', 'server.port-in-use'] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

/** Codes the REST API answers with, which the web UI turns into text. */
export const API_ERROR_CODES = [
  'auth.not-configured',
  'auth.unauthorized',
  'batch.already-undone',
  'batch.not-found',
  'execution.not-found',
  'image.not-found',
  'image.unavailable',
  'internal.unexpected',
  'job.not-done',
  'job.not-found',
  'queue.entry-not-found',
  'queue.entry-resolved',
  'request.invalid',
  'request.not-found',
  'request.rejected',
  'settings.api-key-from-env',
  'settings.webhook-not-found',
  'settings.webhook-url-required',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
