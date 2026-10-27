/**
 * Language-neutral error description. The core never produces user-facing text:
 * the CLI, server and web UI translate `code` with their `fr`/`en` catalogs.
 */
export interface ErrorInfo {
  /** Stable machine-readable code, e.g. `hardlink.cross-device`. */
  readonly code: string;
  /** Values interpolated into the translated message. */
  readonly params?: Readonly<Record<string, string | number>>;
}
