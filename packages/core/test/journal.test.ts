import Database from 'better-sqlite3';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  MemoryJournal,
  SqliteJournal,
  type Journal,
  type JournalEntry,
  type TransferJournalEntry,
} from '../src/index.js';
import { CORE_MIGRATIONS } from '../src/journal/migrations.js';
import { cleanup, makeDir } from './workspace.js';

afterEach(cleanup);

const entry = (
  id: string,
  batchId: string,
  extra: Partial<TransferJournalEntry> = {},
): TransferJournalEntry => ({
  kind: 'transfer',
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

    it('records generated and downloaded files, counted but with no mode', async () => {
      const journal = await make();
      const generated: JournalEntry = {
        kind: 'generated',
        id: 'g',
        batchId: 'b1',
        source: '',
        destination: '/lib/movie.nfo',
        at: '2026-10-28T12:00:00.000Z',
        createdDirectories: [],
      };
      const downloaded: JournalEntry = {
        ...generated,
        kind: 'downloaded',
        id: 'd',
        source: 'https://image.example/p.jpg',
        destination: '/lib/poster.jpg',
      };
      journal.record(entry('a', 'b1', { mode: 'move' }));
      journal.record(generated);
      journal.record(downloaded);
      journal.record({ ...generated, id: 'g2', batchId: 'only-nfo' });

      expect(journal.entriesOf('b1')).toEqual([
        entry('a', 'b1', { mode: 'move' }),
        generated,
        downloaded,
      ]);
      const [onlyNfo, b1] = [journal.batches()[0], journal.batches()[1]];
      expect(b1).toMatchObject({ batchId: 'b1', operations: 3, modes: ['move'] });
      expect(onlyNfo).toMatchObject({ batchId: 'only-nfo', operations: 1, modes: [] });
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
    expect(applied).toEqual([{ name: 'core:001-journal' }, { name: 'core:002-journal-kind' }]);
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

  it('reads rows written before the kind column as transfers', () => {
    const sqlite = new Database(':memory:');
    // The schema as shipped by core:001, with a row and its migration record.
    applyMigrations(sqlite, CORE_MIGRATIONS.slice(0, 1));
    sqlite
      .prepare(
        `INSERT INTO journal_entries (id, batch_id, source, destination, mode, at, created_directories)
         VALUES ('old', 'b0', '/s/a.mkv', '/l/a.mkv', 'hardlink', '2026-01-01T00:00:00.000Z', '["/l"]')`,
      )
      .run();

    const journal = new SqliteJournal(sqlite);
    expect(journal.entriesOf('b0')).toEqual([
      {
        kind: 'transfer',
        id: 'old',
        batchId: 'b0',
        source: '/s/a.mkv',
        destination: '/l/a.mkv',
        mode: 'hardlink',
        at: '2026-01-01T00:00:00.000Z',
        createdDirectories: ['/l'],
      },
    ]);
    expect(journal.batches()[0]).toMatchObject({ operations: 1, modes: ['hardlink'] });
  });

  it('refuses a duplicate entry id', () => {
    const journal = new SqliteJournal(new Database(':memory:'));
    journal.record(entry('a', 'b1'));
    expect(() => {
      journal.record(entry('a', 'b2'));
    }).toThrow();
  });
});
