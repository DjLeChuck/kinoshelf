import { describe, expect, it, vi } from 'vitest';
import { KinoshelfError } from '@kinoshelf/core';
import type { UndoReport } from '../src/service.js';
import { UndoTasks } from '../src/undo-tasks.js';

const report = (batchId: string): UndoReport => ({ batchId, dryRun: false, entries: [] });
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('UndoTasks', () => {
  it('runs in the background, follows the progress, then keeps the report', async () => {
    const announce = vi.fn();
    const tasks = new UndoTasks(announce);
    let finish: (value: UndoReport) => void = () => undefined;
    let tick: (done: number, total: number, current: string) => void = () => undefined;
    const ended = vi.fn();

    const task = tasks.start(
      'b',
      false,
      (onProgress) => {
        tick = onProgress;
        return new Promise<UndoReport>((resolve) => {
          finish = resolve;
        });
      },
      ended,
    );

    expect(task).toMatchObject({ status: 'running', done: 0, report: null });
    expect(tasks.isRunning('b')).toBe(true);
    tick(5, 20, '/lib/a.mkv');
    expect(tasks.of('b')).toMatchObject({ done: 5, total: 20, current: '/lib/a.mkv' });

    finish(report('b'));
    await settle();

    expect(tasks.isRunning('b')).toBe(false);
    expect(tasks.of('b')).toMatchObject({
      status: 'done',
      report: { batchId: 'b' },
      current: null,
    });
    expect(ended).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalled();
  });

  it('keeps the cause of a failure', async () => {
    const tasks = new UndoTasks(() => undefined);

    tasks.start(
      'b',
      false,
      () => Promise.reject(new KinoshelfError('undo.backup-missing', { path: '/x' })),
      () => undefined,
    );
    await settle();

    expect(tasks.of('b')).toMatchObject({
      status: 'failed',
      error: { code: 'undo.backup-missing' },
      report: null,
    });
  });

  it('forgets the oldest finished tasks, never a running one', async () => {
    const tasks = new UndoTasks(() => undefined);
    tasks.start(
      'running',
      false,
      () => new Promise<UndoReport>(() => undefined),
      () => undefined,
    );
    for (let n = 0; n < 25; n++) {
      tasks.start(
        `b${String(n)}`,
        true,
        () => Promise.resolve(report('x')),
        () => undefined,
      );
      await settle();
    }

    expect(tasks.of('running')).toBeDefined();
    expect(tasks.of('b0')).toBeUndefined();
    expect(tasks.of('b24')).toBeDefined();
  });
});
