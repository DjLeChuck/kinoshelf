/** Codes raised by the CLI itself, next to the core's own; both are translated here. */
export const CLI_ERROR_CODES = [
  'config.destination-required',
  'config.invalid-value',
  'config.tmdb-key-missing',
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
