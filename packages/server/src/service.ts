import { randomUUID } from 'node:crypto';
import {
  aliasKey,
  createPlan,
  loadProfile,
  Matcher,
  executePlan,
  undoBatch,
  type Candidate,
  type Classification,
  type ErrorInfo,
  type Journal,
  type MetadataProvider,
  type Operation,
  type OperationResult,
  type Plan,
  type PlanItem,
  type TitleAlias,
  type UndoEntryResult,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import type { AliasStore } from './aliases.js';
import type { EntryStore, Entry, StoredError } from './entries.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { Job, JobStore, PlanSettings } from './jobs.js';
import type { ExecutionOutcome, OutcomeFile } from './notify/message.js';
import { makeProvider, type ProcessorDeps } from './processor.js';

export interface OperationReport {
  readonly type: Operation['type'];
  readonly role: string | null;
  readonly mode: string | null;
  readonly source: string | null;
  readonly destination: string;
  readonly status: OperationResult['status'];
  readonly error: ErrorInfo | null;
}

export interface ExecutionReport {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly items: readonly {
    readonly entryId: string;
    readonly results: readonly OperationReport[];
  }[];
}

export interface UndoReport {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly entries: readonly {
    readonly source: string;
    readonly destination: string;
    readonly mode: string;
    readonly status: UndoEntryResult['status'];
    readonly error: ErrorInfo | null;
  }[];
}

export interface SearchQuery {
  readonly query: string;
  readonly year?: number;
  readonly kind?: 'movie' | 'series';
  readonly language?: string;
}

export interface ServiceDeps extends ProcessorDeps {
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly executions: ExecutionStore;
  readonly journal: Journal;
  readonly aliases: AliasStore;
}

const report = (result: OperationResult): OperationReport => ({
  type: result.operation.type,
  role: result.operation.type === 'transfer' ? result.operation.role : null,
  mode: result.operation.type === 'transfer' ? result.operation.mode : null,
  source: result.operation.type === 'transfer' ? result.operation.source : null,
  destination: result.operation.destination,
  status: result.status,
  error: result.error ?? null,
});

/**
 * What the HTTP routes do beyond reading the stores: match by hand, transfer, undo, search.
 * Each step goes through the core (planner, executor, journal), so the rules that keep the
 * disk safe (no overwrite, no hardlink fallback) are the core's, not re-implemented here.
 */
export class Service {
  constructor(private readonly deps: ServiceDeps) {}

  async search(query: SearchQuery): Promise<Candidate[]> {
    const provider: MetadataProvider = query.language
      ? makeProvider(this.deps, query.language)
      : this.provider();
    const search = { title: query.query, ...(query.year !== undefined && { year: query.year }) };
    const [movies, series] = await Promise.all([
      query.kind === 'series' ? [] : provider.searchMovies(search),
      query.kind === 'movie' ? [] : provider.searchSeries(search),
    ]);
    return [...movies, ...series];
  }

  /**
   * A human picked the candidate: it overrides the score. The file is planned like the others,
   * so a name that cannot be built or a destination already taken still lands in conflict.
   */
  async match(
    entryId: string,
    candidate: Candidate,
    options: { remember?: boolean } = {},
  ): Promise<Entry> {
    const entry = this.pendingEntry(entryId);
    const item = await this.planWith(entry, candidate);
    this.deps.entries.setMatch(entry.id, classify(item), item);
    if (options.remember ?? true) {
      await this.remember(entry, candidate);
    }
    return this.require(entry.id);
  }

  /**
   * Ties the title of the file to the work the human chose, so the next scan decides alone, and
   * lets the files already waiting under that title follow. Skipped when the choice says nothing
   * about the title: a file read as an episode but matched with a film would never look it up.
   */
  private async remember(entry: Entry, candidate: Candidate): Promise<void> {
    const { parsed } = entry;
    const kind =
      parsed.kind === 'episode' ? 'series' : parsed.kind === 'movie' ? 'movie' : undefined;
    if (!parsed.title || kind !== candidate.kind || parsed.knownIds?.length) {
      return;
    }
    const alias: TitleAlias = {
      kind,
      title: parsed.title,
      ...(parsed.year !== undefined && { year: parsed.year }),
      id: candidate.id,
    };
    this.deps.aliases.remember(alias, {
      title: candidate.title,
      ...(candidate.year !== undefined && { year: candidate.year }),
    });
    await this.rematch(aliasKey(alias), entry.id);
  }

  /**
   * Gives the undecided files with this alias's title another go, now that it is known. They go
   * through the matcher like any file, so an episode the work does not have stays in the queue.
   * One that fails (the provider is down, say) is left as it was: the alias is already saved.
   */
  private async rematch(key: string, exceptId: string): Promise<void> {
    const { config, entries, aliases } = this.deps;
    const same = entries.undecided().filter(
      (other) =>
        other.id !== exceptId &&
        other.parsed.title !== undefined &&
        aliasKey({
          kind: other.parsed.kind === 'episode' ? 'series' : 'movie',
          title: other.parsed.title,
          ...(other.parsed.year !== undefined && { year: other.parsed.year }),
        }) === key &&
        other.parsed.kind !== 'unknown',
    );
    if (same.length === 0) {
      return;
    }
    const matcher = new Matcher(
      this.provider(),
      config.threshold !== undefined ? { threshold: config.threshold } : {},
      aliases,
    );
    for (const other of same) {
      try {
        const outcome = await matcher.match(other.parsed);
        if (outcome.status !== 'matched') {
          continue;
        }
        const item = await this.planWith(other, outcome.best.candidate);
        entries.setMatch(other.id, classify(item), item);
      } catch {
        // See above: not worth failing the validation that taught the alias.
      }
    }
  }

  private provider(): MetadataProvider {
    const { config } = this.deps;
    return makeProvider(
      this.deps,
      config.metadataLanguage ?? (config.locale === 'fr' ? 'fr' : 'en-US'),
    );
  }

  private async planWith(entry: Entry, candidate: Candidate): Promise<PlanItem> {
    const settings = this.settingsOf(entry.jobId);
    const plan = await createPlan([{ parsed: entry.parsed, candidate }], {
      profile: await loadProfile(settings.profile),
      destinationRoot: settings.destinationRoot,
      mode: settings.mode,
    });
    const item = plan.items[0];
    if (!item) {
      throw new Error('the planner returned no item for one input');
    }
    return item;
  }

  /** Where the file would go with this candidate, without recording anything. */
  async preview(entryId: string, candidate: Candidate): Promise<PlanItem> {
    const entry = this.pendingEntry(entryId);
    return this.planWith(entry, candidate);
  }

  ignore(entryId: string): Entry {
    this.deps.entries.resolve(this.pendingEntry(entryId).id, 'ignored');
    return this.require(entryId);
  }

  /** What a transfer of the job would do, checked against the disk, with nothing written. */
  async dryRun(jobId: string, entryIds?: readonly string[]): Promise<ExecutionReport> {
    const { plan, entryOfItem } = await this.prepare(jobId, entryIds);
    const batch = await executePlan(plan, { journal: this.deps.journal, dryRun: true });
    return {
      batchId: batch.batchId,
      dryRun: true,
      items: batch.items.map((result) => ({
        entryId: entryOfItem.get(result.itemId)?.id ?? result.itemId,
        results: result.results.map(report),
      })),
    };
  }

  /**
   * Queues the transfer: a copy can last minutes, longer than a request should. Transfers of one
   * job wait their turn rather than being refused: a file validated while another copy runs must
   * not be left matched and never transferred.
   */
  enqueue(jobId: string, entryIds?: readonly string[]): Execution {
    this.requireDoneJob(jobId);
    return this.deps.executions.create(jobId, entryIds);
  }

  /**
   * Transfers the files of an execution, run by the queue worker. The plan is rebuilt from the
   * stored items and the settings of the job, and the executor re-checks each destination right
   * before writing. Each file is settled as soon as it is transferred, in step with the journal:
   * after a crash the execution only has what is left to do.
   */
  async run(execution: Execution): Promise<ExecutionOutcome> {
    const { plan, entryOfItem } = await this.prepare(
      execution.jobId,
      execution.entryIds ?? undefined,
    );
    // A resumed execution keeps its batch: what it did before the crash and what it does now are
    // one batch in the journal, so one undo reverts them all.
    const batchId = execution.batchId ?? randomUUID();
    if (!execution.batchId) {
      this.deps.executions.setBatch(execution.id, batchId);
    }

    let done = 0;
    let failed = 0;
    const files: OutcomeFile[] = [];
    await executePlan(plan, {
      journal: this.deps.journal,
      batchId,
      onItem: (result) => {
        const entry = entryOfItem.get(result.itemId);
        if (!entry) {
          return;
        }
        const status = this.settle(entry, result.results, batchId);
        if (status === 'done') {
          done++;
        } else {
          failed++;
        }
        const main = result.results.find(
          (r) => r.operation.type === 'transfer' && r.operation.role === 'main',
        );
        files.push({
          path: entry.path,
          destination: main?.operation.destination ?? null,
          kind: entry.parsed.kind === 'episode' ? 'series' : 'movie',
          status,
          ...(status === 'failed' && { error: main?.error ?? { code: 'main-not-done' } }),
        });
      },
    });
    return { summary: { done, failed }, files };
  }

  /** The plan of a job: its matched files not transferred yet, optionally only some of them. */
  private async prepare(
    jobId: string,
    entryIds?: readonly string[],
  ): Promise<{ plan: Plan; entryOfItem: Map<string, Entry> }> {
    const job = this.requireDoneJob(jobId);
    const selected = entryIds && new Set(entryIds);
    const entries = this.deps.entries
      .executable(jobId)
      .filter((entry) => !selected || selected.has(entry.id));

    const settings = this.settingsOf(jobId);
    const profile = await loadProfile(settings.profile);
    const plan: Plan = {
      id: job.id,
      createdAt: new Date().toISOString(),
      profileId: profile.id,
      destinationRoot: settings.destinationRoot,
      mode: settings.mode,
      items: entries.flatMap((entry) => (entry.item ? [entry.item] : [])),
    };
    const entryOfItem = new Map(entries.flatMap((e) => (e.item ? [[e.item.id, e] as const] : [])));
    return { plan, entryOfItem };
  }

  private requireDoneJob(jobId: string): Job {
    const job = this.deps.jobs.get(jobId);
    if (!job) {
      throw new ApiError(404, 'job.not-found');
    }
    if (job.status !== 'done') {
      throw new ApiError(409, 'job.not-done', { status: job.status });
    }
    return job;
  }

  /**
   * Any batch that was not undone yet can be, not only the last: each entry is checked against
   * the disk as it is, so a later batch is never damaged (see `undoBatch`).
   */
  async undo(batchId: string, options: { dryRun: boolean }): Promise<UndoReport> {
    const { journal, entries } = this.deps;
    if (journal.entriesOf(batchId).length === 0) {
      throw new ApiError(404, 'batch.not-found');
    }
    if (journal.isUndone(batchId)) {
      throw new ApiError(409, 'batch.already-undone');
    }
    const result = await undoBatch(journal, batchId, { dryRun: options.dryRun });
    if (!result) {
      throw new ApiError(404, 'batch.not-found');
    }
    // Marked undone only when nothing failed: otherwise the files stay as they were.
    if (!options.dryRun && journal.isUndone(batchId)) {
      entries.reopenBatch(batchId);
    }
    return {
      batchId: result.batchId,
      dryRun: result.dryRun,
      entries: result.entries.map((e) => ({
        source: e.entry.source,
        destination: e.entry.destination,
        mode: e.entry.mode,
        status: e.status,
        error: e.error ?? null,
      })),
    };
  }

  /** `done` when the video itself went through; anything else needs a human again. */
  private settle(
    entry: Entry,
    results: readonly OperationResult[],
    batchId: string,
  ): 'done' | 'failed' {
    const main = results.find(
      (r) => r.operation.type === 'transfer' && r.operation.role === 'main',
    );
    if (main?.status === 'done') {
      this.deps.entries.resolve(entry.id, 'done', { batchId });
      return 'done';
    }
    const error: StoredError = main?.error ?? { code: 'main-not-done' };
    this.deps.entries.resolve(entry.id, 'failed', { error });
    return 'failed';
  }

  private pendingEntry(id: string): Entry {
    const entry = this.deps.entries.get(id);
    if (!entry) {
      throw new ApiError(404, 'queue.entry-not-found');
    }
    if (entry.resolution === 'done' || entry.resolution === 'ignored') {
      throw new ApiError(409, 'queue.entry-resolved', { resolution: entry.resolution });
    }
    return entry;
  }

  private require(id: string): Entry {
    const entry = this.deps.entries.get(id);
    if (!entry) {
      throw new ApiError(404, 'queue.entry-not-found');
    }
    return entry;
  }

  private settingsOf(jobId: string): PlanSettings {
    const settings = this.deps.jobs.settings(jobId);
    if (!settings) {
      throw new ApiError(409, 'job.not-done');
    }
    return settings;
  }
}

function classify(item: PlanItem): Classification {
  return item.status === 'ready'
    ? 'to-rename'
    : item.status === 'in-place'
      ? 'compliant'
      : 'conflict';
}
