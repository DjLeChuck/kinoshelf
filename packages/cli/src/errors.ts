import type { CliErrorCode } from '@kinoshelf/i18n';

export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = 'CliError';
  }
}
