import Database from 'better-sqlite3';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryJournal, SqliteJournal, type Journal, type JournalEntry } from '../src/index.js';
import { cleanup, makeDir } from './workspace.js';

afterEach(cleanup);

const entry = (id: string, batchId: string, extra: Partial<JournalEntry> = {}): JournalEntry => ({
  id,
  batchId,
  source: `/src/${id}.mkv`,
  destination: `/lib/${id}.mkv`,
  mode: 'copy',
  at: '2026-10-28T12:00:00.000Z',
  createdDirectories: [],
  ...extra,
});

function behavesLikeAJournal(name: string, make: () => Journal | Promise<Journal>) {
  describe(name, () => {
    it('is empty at first', async () => {
      const journal = await make();
      expect(journal.lastBatchId()).toBeNull();
      expect(journal.entriesOf('nope')).toEqual([]);
    });

    it('returns the entries of a batch in the order they were recorded, fields intact', async () => {
      const journal = await make();
      const first = entry('a', 'b1', { mode: 'move', createdDirectories: ['/lib/x', '/lib/x/y'] });
      journal.record(first);
      journal.record(entry('b', 'b2'));
      journal.record(entry('c', 'b1', { mode: 'hardlink' }));

      expect(journal.entriesOf('b1').map((e) => e.id)).toEqual(['a', 'c']);
      expect(journal.entriesOf('b1')[0]).toEqual(first);
    });

    it('lists batches, the most recent first, with their size, modes and state', async () => {
      const journal = await make();
      expect(journal.batches()).toEqual([]);
      journal.record(entry('a', 'b1', { at: '2026-10-28T09:00:00.000Z' }));
      journal.record(entry('b', 'b2', { mode: 'move', at: '2026-10-28T10:00:00.000Z' }));
      journal.record(entry('c', 'b1', { mode: 'hardlink', at: '2026-10-28T09:05:00.000Z' }));
      journal.record(entry('d', 'b1', { mode: 'hardlink', at: '2026-10-28T09:06:00.000Z' }));
      journal.markUndone('b2');

      expect(journal.batches()).toEqual([
        {
          batchId: 'b1',
          at: '2026-10-28T09:00:00.000Z',
          operations: 3,
          modes: ['copy', 'hardlink'],
          undone: false,
        },
        {
          batchId: 'b2',
          at: '2026-10-28T10:00:00.000Z',
          operations: 1,
          modes: ['move'],
          undone: true,
        },
      ]);
    });

    it('reports the batch of the most recent entry as the last one', async () => {
      const journal = await make();
      journal.record(entry('a', 'b1'));
      journal.record(entry('b', 'b2'));
      expect(journal.lastBatchId()).toBe('b2');
    });

    it('falls back to the previous batch once the last is undone', async () => {
      const journal = await make();
      journal.record(entry('a', 'b1'));
      journal.record(entry('b', 'b2'));
      journal.markUndone('b2');
      expect(journal.lastBatchId()).toBe('b1');
      journal.markUndone('b1');
      expect(journal.lastBatchId()).toBeNull();
      expect(journal.entriesOf('b2')).toHaveLength(1); // history is kept
    });

    it('tells an undone batch from a pending or unknown one', async () => {
      const journal = await make();
      journal.record(entry('a', 'b1'));
      journal.record(entry('b', 'b1'));
      journal.record(entry('c', 'b2'));
      expect(journal.isUndone('b1')).toBe(false);
      journal.markUndone('b1');
      expect(journal.isUndone('b1')).toBe(true);
      expect(journal.isUndone('b2')).toBe(false);
      expect(journal.isUndone('ghost')).toBe(false);
      expect(journal.lastBatchId()).toBe('b2');
    });

    it('ignores an unknown batch when marking undone', async () => {
      const journal = await make();
      journal.record(entry('a', 'b1'));
      journal.markUndone('ghost');
      expect(journal.lastBatchId()).toBe('b1');
    });
  });
}

behavesLikeAJournal('MemoryJournal', () => new MemoryJournal());
behavesLikeAJournal('SqliteJournal', () => new SqliteJournal(new Database(':memory:')));

describe('SqliteJournal storage', () => {
  it('survives reopening the database file', async () => {
    const file = join(await makeDir(), 'kinoshelf.sqlite');
    const first = new Database(file);
    new SqliteJournal(first).record(entry('a', 'b1', { createdDirectories: ['/lib/x'] }));
    first.close();

    const reopened = new Database(file);
    const journal = new SqliteJournal(reopened);
    expect(journal.lastBatchId()).toBe('b1');
    expect(journal.entriesOf('b1')[0]?.createdDirectories).toEqual(['/lib/x']);
    reopened.close();
  });

  it('applies each migration once and keeps its data across openings', () => {
    const sqlite = new Database(':memory:');
    new SqliteJournal(sqlite).record(entry('a', 'b1'));
    new SqliteJournal(sqlite); // opening again must not fail nor wipe anything

    const applied = sqlite.prepare('SELECT name FROM schema_migrations').all();
    expect(applied).toEqual([{ name: 'core:001-journal' }]);
    expect(new SqliteJournal(sqlite).lastBatchId()).toBe('b1');
  });

  it('shares a database with other tables and other modules migrations', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE tmdb_http_cache (key TEXT)');
    sqlite.pragma('user_version = 7');
    const journal = new SqliteJournal(sqlite);
    journal.record(entry('a', 'b1'));
    expect(journal.lastBatchId()).toBe('b1');
    expect(sqlite.pragma('user_version', { simple: true })).toBe(7);
  });

  it('refuses a duplicate entry id', () => {
    const journal = new SqliteJournal(new Database(':memory:'));
    journal.record(entry('a', 'b1'));
    expect(() => {
      journal.record(entry('a', 'b2'));
    }).toThrow();
  });
});
