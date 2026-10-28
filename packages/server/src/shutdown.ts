export interface ShutdownDeps {
  /** Stops accepting work and waits for the task in progress. */
  close(): Promise<void>;
  /** A task (an analysis or a transfer) is running: closing will wait for it. */
  busy(): boolean;
  log(message: string): void;
  /** Leaves at once, without waiting. */
  forceExit(): void;
}

/**
 * The handler for SIGINT and SIGTERM. A first signal closes gracefully, which waits for the
 * running task: a copy can last minutes, and Docker kills the container after 10 s by default
 * (`stop_grace_period` raises it). Saying so, and letting a second signal leave at once, keeps a
 * manual stop readable. What was interrupted is resumed at the next start.
 */
export function createShutdown(deps: ShutdownDeps): () => void {
  let closing = false;
  return () => {
    if (closing) {
      deps.log('Second signal: exiting now. The running task will be resumed at the next start.');
      deps.forceExit();
      return;
    }
    closing = true;
    deps.log(
      deps.busy()
        ? 'Stopping: waiting for the running task to finish. Send the signal again to exit at once; it will be resumed at the next start.'
        : 'Stopping.',
    );
    void deps.close();
  };
}
