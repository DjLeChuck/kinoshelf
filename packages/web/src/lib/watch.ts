/** `GET /api/watch`: what the watcher is doing. */
export interface WatchStatus {
  readonly enabled: boolean;
}

/** `POST /api/watch/scan`. */
export interface WatchScan {
  readonly submitted: number;
  readonly pending: number;
}
