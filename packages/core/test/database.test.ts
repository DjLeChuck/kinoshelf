import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_FILE, openConfigDatabase } from '../src/index.js';
import { cleanup, makeDir } from './workspace.js';

afterEach(cleanup);

describe('openConfigDatabase', () => {
  it('opens the shared file in WAL mode, synced at checkpoints, patient with the other process', async () => {
    const dir = join(await makeDir(), 'config');
    const database = await openConfigDatabase(dir);
    try {
      expect(database.name).toBe(join(dir, DATABASE_FILE));
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
      // 1 is NORMAL (2 would be FULL, the default).
      expect(database.pragma('synchronous', { simple: true })).toBe(1);
      expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      database.close();
    }
  });
});
