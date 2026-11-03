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

  markUndone(batchId: string, entryIds?: readonly string[]): void {
    for (const stored of this.entries) {
      if (stored.entry.batchId === batchId && (!entryIds || entryIds.includes(stored.entry.id))) {
        stored.undone = true;
      }
    }
  }

  undoneEntryIds(batchId: string): ReadonlySet<string> {
    return new Set(
      this.entries.filter((e) => e.entry.batchId === batchId && e.undone).map((e) => e.entry.id),
    );
  }

  hasBatches(): boolean {
    return this.batches().length > 0;
  }

  countBatches(): number {
    return this.batches().length;
  }

  batches(limit?: number): readonly JournalBatch[] {
    const byBatch = new Map<string, { entry: JournalEntry; undone: boolean; index: number }[]>();
    this.entries.forEach((stored, index) => {
      const { batchId } = stored.entry;
      byBatch.set(batchId, [...(byBatch.get(batchId) ?? []), { ...stored, index }]);
    });
    // Most recent first, by when a batch started, then by its latest operation (as the SQLite
    // journal does).
    const latest = (stored: { index: number }[]): number => stored[stored.length - 1]?.index ?? 0;
    const started = (stored: { entry: JournalEntry }[]): string => stored[0]?.entry.at ?? '';
    return [...byBatch.entries()]
      .sort(([, a], [, b]) => started(b).localeCompare(started(a)) || latest(b) - latest(a))
      .map(([batchId, stored]) => ({
        batchId,
        at: stored[0]?.entry.at ?? '',
        operations: stored.length,
        modes: [
          ...new Set(stored.flatMap((s) => (s.entry.kind === 'transfer' ? [s.entry.mode] : []))),
        ],
        undone: stored.every((s) => s.undone),
      }))
      .slice(0, limit);
  }

  batch(batchId: string): JournalBatch | undefined {
    return this.batches().find((batch) => batch.batchId === batchId);
  }
}
