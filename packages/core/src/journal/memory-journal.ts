import type { Journal, JournalEntry } from '../types/journal.js';

/** Journal kept in memory: for tests and throw-away runs. */
export class MemoryJournal implements Journal {
  private readonly entries: { entry: JournalEntry; undone: boolean }[] = [];

  record(entry: JournalEntry): void {
    this.entries.push({ entry, undone: false });
  }

  lastBatchId(): string | null {
    return this.entries.findLast((e) => !e.undone)?.entry.batchId ?? null;
  }

  entriesOf(batchId: string): readonly JournalEntry[] {
    return this.entries.filter((e) => e.entry.batchId === batchId).map((e) => e.entry);
  }

  markUndone(batchId: string): void {
    for (const stored of this.entries) {
      if (stored.entry.batchId === batchId) {
        stored.undone = true;
      }
    }
  }
}
