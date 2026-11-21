/**
 * Compares again, in the background, the arrivals waiting for a library whose rows just changed.
 * A scan ends, a transfer or an undo patches the snapshot: each says so (`touch`), and the burst is
 * read once, a library at a time, never beside itself.
 */
export interface ReevaluationDeps {
  readonly run: (
    libraryId: string,
    progress: (checked: number) => void,
  ) => Promise<{ changed: number; present: number }>;
  /** Something changed, or a run starts or ends: clients read their lists again. */
  readonly announce: (changed: boolean) => void;
  readonly onError?: (error: unknown) => void;
}

export interface ReevaluationState {
  readonly libraryId: string;
  readonly checked: number;
}

export class Reevaluation {
  private readonly dirty = new Set<string>();
  private loop: Promise<void> | undefined;
  private current: ReevaluationState | undefined;
  private last: { libraryId: string; present: number; seq: number } | undefined;
  private runs = 0;

  constructor(private readonly deps: ReevaluationDeps) {}

  touch(libraryId: string): void {
    this.dirty.add(libraryId);
    this.loop ??= this.drain().finally(() => {
      this.loop = undefined;
    });
  }

  async idle(): Promise<void> {
    while (this.loop) {
      await this.loop;
    }
  }

  /** The run in progress, for the activity panel. */
  running(): ReevaluationState | undefined {
    return this.current;
  }

  /** What the last run found, read once by the panel to tell how many files it set aside. */
  take(): { libraryId: string; present: number; seq: number } | undefined {
    const found = this.last;
    this.last = undefined;
    return found;
  }

  private async drain(): Promise<void> {
    // Lets the rest of a batch's patches land before looking.
    await new Promise((resolve) => setImmediate(resolve));
    while (this.dirty.size > 0) {
      const [libraryId] = this.dirty;
      if (libraryId === undefined) {
        return;
      }
      this.dirty.delete(libraryId);
      this.current = { libraryId, checked: 0 };
      this.deps.announce(false);
      try {
        const { changed, present } = await this.deps.run(libraryId, (checked) => {
          this.current = { libraryId, checked };
        });
        this.runs += 1;
        // A burst of changes makes several runs: what each set aside adds up until it is read.
        this.last = { libraryId, present: present + (this.last?.present ?? 0), seq: this.runs };
        this.current = undefined;
        this.deps.announce(changed > 0);
      } catch (error) {
        this.current = undefined;
        this.deps.onError?.(error);
        this.deps.announce(false);
      }
    }
  }
}
