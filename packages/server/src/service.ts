import { randomUUID } from 'node:crypto';
import {
  createPlan,
  loadProfile,
  MetadataLoader,
  type LoadedMetadata,
  executePlan,
  undoBatch,
  type Candidate,
  type Classification,
  type ErrorInfo,
  type Journal,
  type LibraryConfig,
  type MetadataProvider,
  type MovieDetails,
  type SeasonInfo,
  type SeriesDetails,
  type Operation,
  type OperationResult,
  type Plan,
  type PlanItem,
  type UndoEntryResult,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import type { EntryStore, Entry, StoredCandidate, StoredError } from './entries.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { Job, JobStore, PlanSettings } from './jobs.js';
import type { LibrarySnapshot } from './library-items.js';
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

export interface MatchResult {
  readonly entry: Entry;
  /** Ids of the other episodes of the release that followed the choice (matched, no conflict). */
  readonly followers: readonly string[];
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
  /** What each library holds, kept in step with what is matched, transferred and undone. */
  readonly snapshot: LibrarySnapshot;
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
    options: { onlyThis?: boolean; libraryId?: string } = {},
  ): Promise<MatchResult> {
    const entry = this.pendingEntry(entryId);
    const asked = options.libraryId;
    const libraryId = this.chosenLibrary(entry, candidate, asked);
    await this.applyChoice(entry, candidate, libraryId);
    // The choice is about the series, so the rest of the release follows; one that cannot (the
    // provider is down, say) stays as it was and can be settled on its own.
    const followers: string[] = [];
    if (candidate.kind === 'series' && !options.onlyThis) {
      for (const mate of this.deps.entries.releaseMates(entry)) {
        try {
          const mateLibrary = this.chosenLibrary(mate, candidate, asked);
          if ((await this.applyChoice(mate, candidate, mateLibrary)) !== 'conflict') {
            followers.push(mate.id);
          }
        } catch {
          // See above.
        }
      }
    }
    return { entry: this.require(entry.id), followers };
  }

  /** Plans one file with the chosen candidate and records it. */
  private async applyChoice(
    entry: Entry,
    candidate: Candidate,
    libraryId: string | null,
  ): Promise<Classification> {
    const item = await this.planWith(entry, candidate, { libraryId });
    const classification = classify(item);
    this.deps.entries.setMatch(entry.id, classification, item, { candidate, score: 100 });
    this.deps.entries.setDestination(entry.id, libraryId);
    await this.deps.snapshot.matched(this.require(entry.id), candidate);
    return classification;
  }

  /** What the provider knows of a work (cached by the provider's own cache); `null` if nothing. */
  async details(
    kind: 'movie' | 'series',
    tmdbId: number,
  ): Promise<MovieDetails | SeriesDetails | null> {
    const provider = this.provider();
    const id = { provider: provider.name, id: tmdbId };
    return kind === 'movie' ? provider.getMovieDetails(id) : provider.getSeriesDetails(id);
  }

  /**
   * A show and all its seasons with their episodes (the provider's cache makes each one a single
   * request); `null` if the provider does not know it.
   */
  async seasons(
    tmdbId: number,
  ): Promise<{ details: SeriesDetails; seasons: readonly SeasonInfo[] } | null> {
    const provider = this.provider();
    const id = { provider: provider.name, id: tmdbId };
    const details = await provider.getSeriesDetails(id);
    if (!details) {
      return null;
    }
    const seasons = await Promise.all(
      details.seasons.map(({ season }) => provider.getSeason(id, season)),
    );
    return { details, seasons: seasons.filter((season) => season !== null) };
  }

  private provider(): MetadataProvider {
    const { config } = this.deps;
    return makeProvider(
      this.deps,
      config.metadataLanguage ?? (config.locale === 'fr' ? 'fr' : 'en-US'),
    );
  }

  /**
   * Plans one file. The NFO and images the profile asks for need the provider's details, fetched
   * here since the planner stays off the network. A failure surfaces like any provider error,
   * unless `lenient`: a preview then still shows where the file goes, without its companions.
   */
  private async planWith(
    entry: Entry,
    candidate: Candidate,
    options: { lenient?: boolean; libraryId?: string | null } = {},
  ): Promise<PlanItem> {
    const settings = this.settingsFor(entry, options.libraryId);
    const profile = await loadProfile(settings.profile);
    const provider = this.provider();
    const loader = new MetadataLoader({ provider, profile });
    let metadata: LoadedMetadata = {};
    try {
      metadata = await loader.forCandidate(candidate, entry.parsed);
    } catch (error) {
      if (!options.lenient) {
        throw error;
      }
    }
    const plan = await createPlan([{ parsed: entry.parsed, candidate, ...metadata }], {
      profile,
      destinationRoot: settings.destinationRoot,
      mode: settings.mode,
      ...(loader.needsMetadata && { imageUrl: provider.imageUrl.bind(provider) }),
    });
    const item = plan.items[0];
    if (!item) {
      throw new Error('the planner returned no item for one input');
    }
    return item;
  }

  /** Where the file would go with this candidate, without recording anything. */
  async preview(entryId: string, candidate: Candidate, libraryId?: string): Promise<PlanItem> {
    const entry = this.pendingEntry(entryId);
    return this.planWith(entry, candidate, {
      lenient: true,
      libraryId: this.chosenLibrary(entry, candidate, libraryId),
    });
  }

  /**
   * Where a file of an arrival goes by default. An
   * arrival is told by its job: one of an arrival folder (its `into`), or sent by hand, which
   * goes to the first library of its kind. `null` for a file of a library organized in place
   * (it stays where it is) or one whose kind is unknown.
   */
  destinationOf(entry: Entry): { libraryId: string | null } {
    const chosen = this.typedLibrary(entry.destinationLibraryId);
    return { libraryId: (chosen ?? this.defaultLibrary(entry))?.id ?? null };
  }

  /** The arrival folders: where files wait for a destination. */
  arrivalFolders(): LibraryConfig[] {
    return (this.deps.config.libraries ?? []).filter(({ into }) => into !== undefined);
  }

  /** The libraries a file could go to: the typed ones of its kind, all of them if it has none. */
  destinationOptions(entry: Entry): LibraryConfig[] {
    const kind = kindOf(entry);
    return (this.deps.config.libraries ?? []).filter(
      ({ type }) => type !== undefined && (kind === null || type === kind),
    );
  }

  /**
   * The analysis of an arrival folder (or of a path sent by hand) used the global profile; once
   * stored, each file already matched with confidence is planned again for the library it goes
   * to (its profile, its root), so the names follow where they end up. Files that are not matched
   * keep waiting: their choice is for a human.
   */
  async planArrivals(job: Job): Promise<void> {
    const library = this.deps.config.libraries?.find(({ id }) => id === job.libraryId);
    if (library?.type !== undefined) {
      return;
    }
    for (const entry of this.deps.entries.executable(job.id)) {
      const kind = kindOf(entry);
      const best = entry.candidates[0];
      const id = entry.item?.externalId.id;
      if (kind === null || id === undefined || best?.id.id !== id) {
        continue;
      }
      const planned = this.defaultLibrary(entry);
      if (!planned || planned.type !== kind) {
        continue;
      }
      // A file that cannot be planned (the provider is down) keeps its plan: the global profile's
      // one is still a good one.
      try {
        const item = await this.planWith(entry, toCandidate(best), { libraryId: planned.id });
        this.deps.entries.setMatch(entry.id, classify(item), item);
      } catch {
        continue;
      }
    }
  }

  private typedLibrary(id: string | null | undefined): LibraryConfig | undefined {
    return id == null
      ? undefined
      : this.deps.config.libraries?.find((library) => library.id === id && library.type);
  }

  /**
   * Where an arrival goes by default. A file of a library organized in place is not an arrival:
   * what its scan planned stands.
   */
  private defaultLibrary(entry: Entry): LibraryConfig | undefined {
    const kind = kindOf(entry);
    const libraries = this.deps.config.libraries ?? [];
    const job = this.deps.jobs.get(entry.jobId);
    const from = libraries.find(({ id }) => id === job?.libraryId);
    if (kind === null || from?.type !== undefined) {
      return undefined;
    }
    const id = from?.into?.[kind];
    return id === undefined
      ? libraries.find(({ type }) => type === kind)
      : libraries.find((library) => library.id === id);
  }

  /** The library a human picks for a candidate, checked against its kind. */
  private chosenLibrary(entry: Entry, candidate: Candidate, asked?: string): string | null {
    if (asked !== undefined) {
      const library = this.deps.config.libraries?.find(({ id }) => id === asked);
      if (!library) {
        throw new ApiError(404, 'library.not-found');
      }
      if (library.type !== candidate.kind) {
        throw new ApiError(422, 'library.wrong-type', { name: library.name });
      }
      return library.id;
    }
    const current = this.typedLibrary(entry.destinationLibraryId);
    const chosen = current?.type === candidate.kind ? current : undefined;
    return chosen?.id ?? null;
  }

  /** Sets a file aside, and with it the rest of its release unless `onlyThis`. */
  ignore(entryId: string, options: { onlyThis?: boolean } = {}): Entry {
    const entry = this.pendingEntry(entryId);
    this.deps.entries.resolve(entry.id, 'ignored');
    if (!options.onlyThis) {
      for (const mate of this.deps.entries.releaseMates(entry)) {
        this.deps.entries.resolve(mate.id, 'ignored');
      }
    }
    return this.require(entryId);
  }

  /** What a transfer of the job would do, checked against the disk, with nothing written. */
  async dryRun(jobId: string, entryIds?: readonly string[]): Promise<ExecutionReport> {
    const groups = await this.prepare(jobId, entryIds);
    const items: ExecutionReport['items'][number][] = [];
    let batchId = '';
    for (const { plan, entryOfItem } of groups) {
      const batch = await executePlan(plan, { journal: this.deps.journal, dryRun: true });
      batchId ||= batch.batchId;
      items.push(
        ...batch.items.map((result) => ({
          entryId: entryOfItem.get(result.itemId)?.id ?? result.itemId,
          results: result.results.map(report),
        })),
      );
    }
    return { batchId, dryRun: true, items };
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
    const groups = await this.prepare(execution.jobId, execution.entryIds ?? undefined);
    // A resumed execution keeps its batch: what it did before the crash and what it does now are
    // one batch in the journal, so one undo reverts them all.
    const batchId = execution.batchId ?? randomUUID();
    if (!execution.batchId) {
      this.deps.executions.setBatch(execution.id, batchId);
    }

    let done = 0;
    let failed = 0;
    const files: OutcomeFile[] = [];
    const settled: { entry: Entry; results: readonly OperationResult[] }[] = [];
    for (const { plan, entryOfItem } of groups) {
      await this.transferGroup(plan, entryOfItem, batchId, (entry, results) => {
        const status = this.settle(entry, results, batchId);
        settled.push({ entry, results });
        if (status === 'done') {
          done++;
        } else {
          failed++;
        }
        const main = results.find(
          (r) => r.operation.type === 'transfer' && r.operation.role === 'main',
        );
        files.push({
          path: entry.path,
          destination: main?.operation.destination ?? null,
          kind: entry.parsed.kind === 'episode' ? 'series' : 'movie',
          status,
          ...(status === 'failed' && { error: main?.error ?? { code: 'main-not-done' } }),
        });
      });
    }
    await this.deps.snapshot.transferred(execution.jobId, settled);
    return { summary: { done, failed }, files };
  }

  private async transferGroup(
    plan: Plan,
    entryOfItem: ReadonlyMap<string, Entry>,
    batchId: string,
    settle: (entry: Entry, results: readonly OperationResult[]) => void,
  ): Promise<void> {
    await executePlan(plan, {
      journal: this.deps.journal,
      batchId,
      onItem: (result) => {
        const entry = entryOfItem.get(result.itemId);
        if (entry) {
          settle(entry, result.results);
        }
      },
    });
  }

  /**
   * The plans of a job: its matched files not transferred yet, optionally only some of them. A
   * plan has one profile and one root, so files bound for different libraries make different
   * plans (executed under one batch). There is always at least one, possibly empty.
   */
  private async prepare(
    jobId: string,
    entryIds?: readonly string[],
  ): Promise<{ plan: Plan; entryOfItem: Map<string, Entry> }[]> {
    const job = this.requireDoneJob(jobId);
    const selected = entryIds && new Set(entryIds);
    const entries = this.deps.entries
      .executable(jobId)
      .filter((entry) => entry.item && (!selected || selected.has(entry.id)));

    const groups = new Map<string, { settings: PlanSettings; entries: Entry[] }>();
    for (const entry of entries) {
      const settings = this.settingsFor(entry);
      const key = JSON.stringify(settings);
      const group = groups.get(key) ?? { settings, entries: [] };
      group.entries.push(entry);
      groups.set(key, group);
    }
    if (groups.size === 0) {
      groups.set('', { settings: this.settingsOf(jobId), entries: [] });
    }
    return Promise.all(
      [...groups.values()].map(async ({ settings, entries: members }, index) => {
        const profile = await loadProfile(settings.profile);
        const plan: Plan = {
          id: index === 0 ? job.id : `${job.id}#${String(index + 1)}`,
          createdAt: new Date().toISOString(),
          profileId: profile.id,
          destinationRoot: settings.destinationRoot,
          mode: settings.mode,
          items: members.flatMap((entry) => (entry.item ? [entry.item] : [])),
        };
        const entryOfItem = new Map(
          members.flatMap((entry) => (entry.item ? [[entry.item.id, entry] as const] : [])),
        );
        return { plan, entryOfItem };
      }),
    );
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
      await this.deps.snapshot.undone(journal.entriesOf(batchId));
      entries.reopenBatch(batchId);
    }
    return {
      batchId: result.batchId,
      dryRun: result.dryRun,
      entries: result.entries.map((e) => ({
        source: e.entry.source,
        destination: e.entry.destination,
        // A generated or downloaded file has no transfer mode: its kind says what it was.
        mode: e.entry.mode ?? e.entry.kind,
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

  /**
   * How a file is planned and transferred: what its job used, except where it goes. A file sent
   * to a library (by hand, or by default for an arrival) takes that
   * library's profile and root; the mode stays the one of its source.
   */
  private settingsFor(entry: Entry, libraryId?: string | null): PlanSettings {
    const base = this.settingsOf(entry.jobId);
    const library =
      this.typedLibrary(libraryId ?? entry.destinationLibraryId) ?? this.defaultLibrary(entry);
    if (!library) {
      return base;
    }
    return {
      profile: library.profile ?? this.deps.config.profile ?? 'plex',
      mode: base.mode,
      destinationRoot: library.source,
    };
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

const kindOf = (entry: Pick<Entry, 'parsed'>): 'movie' | 'series' | null =>
  entry.parsed.kind === 'movie' ? 'movie' : entry.parsed.kind === 'episode' ? 'series' : null;

/** What the planner reads of a candidate the queue kept: title, year and id. */
function toCandidate(stored: StoredCandidate): Candidate {
  return {
    kind: stored.kind,
    id: stored.id,
    title: stored.title,
    originalTitle: stored.originalTitle,
    alternativeTitles: [],
    ...(stored.year !== undefined && { year: stored.year }),
    ...(stored.posterPath !== undefined && { posterPath: stored.posterPath }),
  };
}
