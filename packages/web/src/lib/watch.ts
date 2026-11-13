/** `GET /api/watch`: what the watcher is doing. */
export interface WatchStatus {
  readonly enabled: boolean;
  readonly mode: 'events' | 'poll';
  readonly folders: readonly { path: string; libraryId: string | null; available: boolean }[];
  readonly pending: number;
  readonly lastScanAt: string | null;
  readonly nextScanAt: string | null;
  readonly intervalSeconds: number | null;
}

/** `POST /api/watch/scan`. */
export interface WatchScan {
  readonly submitted: number;
  readonly pending: number;
}
