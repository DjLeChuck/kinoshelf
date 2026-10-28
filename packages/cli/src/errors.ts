/** Codes raised by the CLI itself, next to the core's own; both are translated here. */
export const CLI_ERROR_CODES = [
  'cleanup.no-folder',
  'config.invalid-value',
  'undo.batch-already-undone',
  'undo.batch-not-found',
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = 'CliError';
  }
}
