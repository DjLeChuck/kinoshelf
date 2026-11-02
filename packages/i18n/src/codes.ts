/**
 * Codes raised by the CLI itself, next to the core's own. The catalogs must translate both, so the
 * list lives with them and the compiler rejects a code without a message.
 */
export const CLI_ERROR_CODES = [
  'cleanup.no-folder',
  'config.invalid-value',
  'config.library-unknown',
  'submit.no-api-key',
  'submit.rejected',
  'submit.unreachable',
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
  'fs.not-a-directory',
  'fs.not-absolute',
  'fs.not-found',
  'fs.unreadable',
  'image.not-found',
  'image.unavailable',
  'internal.unexpected',
  'job.not-done',
  'job.not-found',
  'library.in-use',
  'library.invalid',
  'library.item-not-found',
  'library.not-found',
  'library.not-series',
  'library.nothing-to-do',
  'library.not-typed',
  'library.scan-in-progress',
  'library.source-taken',
  'library.wrong-type',
  'queue.entry-not-found',
  'queue.entry-resolved',
  'request.invalid',
  'request.not-found',
  'request.rejected',
  'settings.api-key-from-env',
  'settings.tmdb-key-from-env',
  'setup.already-done',
  'setup.host-not-allowed',
  'settings.webhook-not-found',
  'settings.webhook-url-required',
  'watch.not-configured',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
