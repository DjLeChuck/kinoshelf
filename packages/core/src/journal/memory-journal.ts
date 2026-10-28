import type { Journal, JournalBatch, JournalEntry } from '../types/journal.js';

/** Journal kept in memory: for tests and throw-away runs. */
export class MemoryJournal implements Journal {
  private readonly entries: { entry: JournalEntry; undone: boolean }[] = [];

  record(entry: JournalEntry): void {
    this.entries.push({ entry, undone: false });
  }

  lastBatchId(): string | null {
    return this.entries.findLast((e) => !e.undone)?.entry.batchId ?? null;
  }

  isUndone(batchId: string): boolean {
    const batch = this.entries.filter((e) => e.entry.batchId === batchId);
    return batch.length > 0 && batch.every((e) => e.undone);
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

  batches(): readonly JournalBatch[] {
    const byBatch = new Map<string, { entry: JournalEntry; undone: boolean; index: number }[]>();
    this.entries.forEach((stored, index) => {
      const { batchId } = stored.entry;
      byBatch.set(batchId, [...(byBatch.get(batchId) ?? []), { ...stored, index }]);
    });
    // Most recent first, by the latest operation of each batch (as the SQLite journal does).
    const latest = (stored: { index: number }[]): number => stored[stored.length - 1]?.index ?? 0;
    return [...byBatch.entries()]
      .sort(([, a], [, b]) => latest(b) - latest(a))
      .map(([batchId, stored]) => ({
        batchId,
        at: stored[0]?.entry.at ?? '',
        operations: stored.length,
        modes: [...new Set(stored.map((s) => s.entry.mode))],
        undone: stored.every((s) => s.undone),
      }));
  }
}
