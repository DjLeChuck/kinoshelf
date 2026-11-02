/** `GET /api/watch`: what the watcher is doing. */
export interface WatchStatus {
  readonly enabled: boolean;
  readonly mode: 'events' | 'poll';
  readonly folders: readonly {
    readonly path: string;
    readonly libraryId: string | null;
    readonly available: boolean;
  }[];
  readonly pending: number;
  readonly lastScanAt: string | null;
}

/** `POST /api/watch/scan`. */
export interface WatchScan {
  readonly submitted: number;
  readonly pending: number;
  readonly known: number;
}
