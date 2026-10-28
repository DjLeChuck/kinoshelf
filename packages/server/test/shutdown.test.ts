import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/shutdown.js';

function setup(busy: boolean) {
  const log: string[] = [];
  const close = vi.fn(() => Promise.resolve());
  const forceExit = vi.fn();
  const shutdown = createShutdown({ close, busy: () => busy, log: (m) => log.push(m), forceExit });
  return { shutdown, log, close, forceExit };
}

describe('createShutdown', () => {
  it('closes once and says nothing to wait for when idle', () => {
    const { shutdown, log, close, forceExit } = setup(false);
    shutdown();
    expect(log).toEqual(['Stopping.']);
    expect(close).toHaveBeenCalledTimes(1);
    expect(forceExit).not.toHaveBeenCalled();
  });

  it('warns that it waits for the running task, and how to leave at once', () => {
    const { shutdown, log } = setup(true);
    shutdown();
    expect(log[0]).toMatch(/waiting for the running task.*again to exit at once.*resumed/);
  });

  it('leaves at once on a second signal, without closing a second time', () => {
    const { shutdown, log, close, forceExit } = setup(true);
    shutdown();
    shutdown();
    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(log[1]).toMatch(/Second signal/);
  });
});
