import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import {
  buildProfile,
  libraryProfile,
  createPlan,
  GuessitParser,
  hasVersionSibling,
  MetadataLoader,
  type LoadedMetadata,
  executePlan,
  madeByUs,
  undoBatch,
  selectItems,
  type Candidate,
  classifyItem,
  type ErrorInfo,
  type ImageSize,
  type ImageCandidate,
  type WorkImages,
  type Journal,
  type LibraryConfig,
  type MetadataProvider,
  type MovieDetails,
  type ParsedMedia,
  type SeasonInfo,
  type SeriesDetails,
  type Operation,
  type TransferOperation,
  type OperationResult,
  type Plan,
  type PlanInput,
  type PlanItem,
  type UndoEntryResult,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import {
  workKindOf as kindOf,
  type EntryStore,
  type Entry,
  type StoredCandidate,
  type StoredError,
} from './entries.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { Job, JobStore, PlanSettings } from './jobs.js';
import type { LibrarySnapshot } from './library-items.js';
import type { MatchState, MatchTracker } from './matches.js';
import type { ExecutionOutcome, OutcomeFile } from './notify/message.js';
import {
  defaultMetadataLanguage,
  makeProvider,
  sizeReaderOf,
  withSizeReader,
  type ProcessorDeps,
} from './processor.js';

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
  /** What each library holds, kept in step with what is matched, transferred and undone. */
  readonly snapshot: LibrarySnapshot;
  /** The validations in flight: one match at a time per release, with their progress. */
  readonly matches: MatchTracker;
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
   * A human picked the candidate: it overrides the score. The files are planned like the others,
   * so a name that cannot be built or a destination already taken still lands in conflict.
   *
   * What is wrong with the request is thrown now (unknown file, already settled, held by a
   * transfer, a release already being matched). The planning itself takes as long as the release
   * is long (one metadata read per episode, and a probe where a name says no size), so it runs on
   * its own: the answer is in `matches`, which the client reads as it moves and when it ends.
   */
  startMatch(
    entryId: string,
    candidate: Candidate,
    options: { libraryId?: string; screenSize?: string } = {},
  ): void {
    const entry = this.pendingEntry(entryId);
    const asked = options.libraryId;
    const libraryId = this.chosenLibrary(entry, candidate, asked);
    // The choice is about the series, so the rest of the release follows.
    const mates = candidate.kind === 'series' ? this.deps.entries.releaseMates(entry) : [];
    this.requireFree(mates);
    const lock = this.lockOf(entry);
    this.deps.matches.begin(entry.id, lock, 1 + mates.length);
    void this.runMatch(entry, mates, candidate, libraryId, asked, options.screenSize)
      .then((followers) => {
        this.deps.matches.finish(entry.id, lock, followers);
      })
      .catch((error: unknown) => {
        this.deps.matches.fail(entry.id, lock, error);
      });
  }

  /**
   * Plans the file and its release mates, one plan for all of them like an analysis does (so two
   * versions of one episode in the release take a label together). A mate that cannot follow (the
   * provider is down for it, say) stays as it was and can be settled on its own; the file itself
   * failing fails the match. A size picked by hand is this file's: its mates have their own.
   */
  private async runMatch(
    entry: Entry,
    mates: readonly Entry[],
    candidate: Candidate,
    libraryId: string | null,
    asked: string | undefined,
    screenSize: string | undefined,
  ): Promise<string[]> {
    const main =
      screenSize === undefined ? entry : { ...entry, parsed: { ...entry.parsed, screenSize } };
    const groups = new Map<string, { libraryId: string | null; files: Entry[] }>();
    const group = (id: string | null): Entry[] => {
      const key = id ?? '';
      const found = groups.get(key) ?? { libraryId: id, files: [] };
      groups.set(key, found);
      return found.files;
    };
    group(libraryId).push(main);
    for (const mate of mates) {
      try {
        group(this.chosenLibrary(mate, candidate, asked)).push(mate);
      } catch {
        // See above.
      }
    }
    const followers: string[] = [];
    let done = 0;
    for (const { libraryId: id, files } of groups.values()) {
      try {
        const planned = await this.planGroup(files, main, candidate, id, (current) => {
          done += 1;
          this.deps.matches.progress(entry.id, done, basename(current));
        });
        for (const { file, item } of planned) {
          const classification = classifyItem(item);
          this.deps.entries.setMatch(
            file.id,
            classification,
            item,
            { candidate, score: 100 },
            { libraryId: id },
          );
          this.deps.snapshot.matched(this.require(file.id), candidate);
          if (file.id !== entry.id && classification !== 'conflict') {
            followers.push(file.id);
          }
        }
      } catch (error) {
        if (files.includes(main)) {
          throw error;
        }
      }
    }
    return followers;
  }

  /** What the last validation of this file did, for the client that started it. */
  matchOf(entryId: string): { state: MatchState; entry: Entry | undefined } {
    const state = this.deps.matches.get(entryId);
    if (!state) {
      throw new ApiError(404, 'queue.match-unknown');
    }
    return { state, entry: state.status === 'done' ? this.require(entryId) : undefined };
  }

  /** The key a release is matched under: its series in its folder, or the file when it stands alone. */
  private lockOf(entry: Entry): string {
    return entry.release !== null && entry.parsed.kind === 'episode'
      ? `${entry.jobId}|${entry.release}|${String(entry.cluster)}`
      : entry.id;
  }

  /**
   * Plans files that share a destination library in one go. `main` must plan (its metadata fails
   * the whole group); another file whose metadata cannot be read is left out.
   */
  private async planGroup(
    files: readonly Entry[],
    main: Entry,
    candidate: Candidate,
    libraryId: string | null,
    onLoaded: (path: string) => void,
  ): Promise<{ file: Entry; item: PlanItem }[]> {
    const settings = this.settingsFor(files[0] ?? main, libraryId);
    const profile = buildProfile(settings.profile);
    const provider = this.provider();
    const loader = new MetadataLoader({ provider, profile });
    const planned: Entry[] = [];
    const inputs: PlanInput[] = [];
    for (const file of files) {
      try {
        const metadata = await loader.forCandidate(candidate, file.parsed);
        inputs.push({ parsed: withQuality(file.parsed), candidate, ...metadata });
        planned.push(file);
      } catch (error) {
        if (file === main) {
          throw error;
        }
      }
      onLoaded(file.path);
    }
    const plan = await createPlan(inputs, {
      profile,
      destinationRoot: settings.destinationRoot,
      mode: settings.mode,
      ...(loader.needsMetadata && { imageUrl: provider.imageUrl.bind(provider) }),
      ...withSizeReader(this.deps),
      madeByUs: (path) => madeByUs(this.deps.journal, path),
    });
    return planned.map((file, index) => {
      const item = plan.items[index];
      if (!item) {
        throw new Error('the planner returned no item for one input');
      }
      return { file, item };
    });
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

  /** The images the provider offers for a work, in the configured language. */
  async listImages(kind: 'movie' | 'series', tmdbId: number): Promise<WorkImages | null> {
    const provider = this.provider();
    return provider.listImages({ provider: provider.name, id: tmdbId }, kind);
  }

  /** The stills the provider offers for an episode, in the configured language. */
  async listStills(
    tmdbId: number,
    season: number,
    episode: number,
  ): Promise<readonly ImageCandidate[] | null> {
    const provider = this.provider();
    return provider.listEpisodeImages({ provider: provider.name, id: tmdbId }, season, episode);
  }

  imageUrl(path: string, size: ImageSize): string {
    return this.provider().imageUrl(path, size);
  }

  private provider(): MetadataProvider {
    const { config } = this.deps;
    return makeProvider(this.deps, config.metadataLanguage ?? defaultMetadataLanguage(this.deps));
  }

  /**
   * Plans one file. The NFO and images the profile asks for need the provider's details, fetched
   * here since the planner stays off the network. A failure surfaces like any provider error,
   * unless `lenient`: a preview then still shows where the file goes, without its companions.
   */
  private async planWith(
    entry: Entry,
    candidate: Candidate,
    options: {
      lenient?: boolean;
      applyVersion?: boolean;
      libraryId?: string | null;
    } = {},
  ): Promise<PlanItem> {
    const settings = this.settingsFor(entry, options.libraryId);
    const profile = buildProfile(settings.profile);
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
    const plan = await createPlan(
      [
        {
          parsed: withQuality(entry.parsed),
          candidate,
          ...metadata,
          ...(options.applyVersion && { applyVersion: true }),
        },
      ],
      {
        profile,
        destinationRoot: settings.destinationRoot,
        mode: settings.mode,
        ...(loader.needsMetadata && { imageUrl: provider.imageUrl.bind(provider) }),
        ...withSizeReader(this.deps),
        madeByUs: (path) => madeByUs(this.deps.journal, path),
      },
    );
    const item = plan.items[0];
    if (!item) {
      throw new Error('the planner returned no item for one input');
    }
    return item;
  }

  /** Where the file would go with this candidate, without recording anything. */
  async preview(
    entryId: string,
    candidate: Candidate,
    libraryId?: string,
    screenSize?: string,
  ): Promise<PlanItem> {
    const found = this.pendingEntry(entryId);
    const entry =
      screenSize === undefined ? found : { ...found, parsed: { ...found.parsed, screenSize } };
    return this.planWith(entry, candidate, {
      lenient: true,
      libraryId: this.chosenLibrary(entry, candidate, libraryId),
    });
  }

  /**
   * The folder a release of episodes goes into, when the preview of one of its files would
   * otherwise stand for all of them: the first folder under the library's root. `null` for a file
   * alone, a movie, or a layout with no folder of the series.
   */
  previewFolder(
    entryId: string,
    candidate: Candidate,
    destination: string | null,
    libraryId?: string,
  ): string | null {
    const entry = this.pendingEntry(entryId);
    if (candidate.kind !== 'series' || destination === null) {
      return null;
    }
    if (this.deps.entries.releaseMates(entry).length === 0) {
      return null;
    }
    // The root the planner used, so the folder is the one the preview's path is in.
    const roots = this.settingsFor(
      entry,
      this.chosenLibrary(entry, candidate, libraryId),
    ).destinationRoot;
    const root = typeof roots === 'string' ? roots : roots.series;
    const [first, ...rest] = relative(root, destination).split('/');
    return first && first !== '..' && rest.length > 0 ? join(root, first) : null;
  }

  /**
   * Where a file of an arrival goes by default. An
   * arrival is told by its job: one of an arrival folder (its `into`), or sent by hand, which
   * goes to the first library of its kind. `null` for a file of a library organized in place
   * (it stays where it is) or one whose kind is unknown.
   */
  destinationOf(entry: Entry, job?: Job): { libraryId: string | null } {
    const chosen = this.typedLibrary(entry.destinationLibraryId);
    return { libraryId: (chosen ?? this.defaultLibrary(entry, job))?.id ?? null };
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
        this.deps.entries.setMatch(entry.id, classifyItem(item), item);
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
  private defaultLibrary(
    entry: Entry,
    job = this.deps.jobs.get(entry.jobId),
  ): LibraryConfig | undefined {
    const kind = kindOf(entry);
    const libraries = this.deps.config.libraries ?? [];
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

  /** Sets a file aside, and with it the rest of its release. */
  ignore(entryId: string): Entry {
    const entry = this.pendingEntry(entryId);
    const mates = this.deps.entries.releaseMates(entry);
    this.requireFree(mates);
    this.deps.entries.resolve(entry.id, 'ignored');
    for (const mate of mates) {
      this.deps.entries.resolve(mate.id, 'ignored');
    }
    return this.require(entryId);
  }

  /** What a transfer of the job would do, checked against the disk, with nothing written. */
  async dryRun(
    jobId: string,
    entryIds?: readonly string[],
    overrides?: ReadonlyMap<string, PlanItem>,
  ): Promise<ExecutionReport> {
    const { groups, held } = await this.prepare(jobId, entryIds, {
      ...(overrides && { overrides }),
    });
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
    // A file whose destination is taken for good is reported as the run would: not done.
    for (const { entry, destination } of held) {
      items.push({
        entryId: entry.id,
        results: [
          {
            type: 'transfer',
            role: 'main',
            mode: null,
            source: entry.path,
            destination,
            status: 'skipped',
            error: { code: 'destination.exists', params: { path: destination } },
          },
        ],
      });
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
    const holding = this.deps.executions.pendingEntries().get(jobId);
    // A transfer of the whole job holds every file of it.
    if (holding === null) {
      throw new ApiError(409, 'queue.entry-held');
    }
    // What a transfer already waiting or running holds, or a validation is rewriting the plan of,
    // is left out: stacking it would do the same work twice, or run a plan that changes under it.
    const free = (entry: Entry): boolean =>
      !holding?.has(entry.id) && !this.deps.matches.locked(this.lockOf(entry));
    if (entryIds === undefined) {
      const executable = this.deps.entries.executable(jobId);
      const kept = executable.filter(free);
      if (kept.length === executable.length) {
        return this.deps.executions.create(jobId);
      }
      if (kept.length === 0) {
        throw new ApiError(409, 'queue.entry-held');
      }
      return this.deps.executions.create(
        jobId,
        kept.map(({ id }) => id),
      );
    }
    if (entryIds.length === 0) {
      throw new ApiError(409, 'library.nothing-to-do');
    }
    const kept = entryIds.filter((id) => {
      const entry = this.deps.entries.get(id);
      return entry === undefined || free(entry);
    });
    if (kept.length === 0) {
      throw new ApiError(409, 'queue.entry-held');
    }
    return this.deps.executions.create(jobId, kept);
  }

  /**
   * The folders an execution reads from and writes to: what a job analysing any of them must not
   * run beside. `undefined` when they cannot be told, which the runner takes as "everything".
   */
  touches(execution: Execution): string[] | undefined {
    try {
      const job = this.deps.jobs.get(execution.jobId);
      if (!job) {
        return undefined;
      }
      const selected = execution.entryIds && new Set(execution.entryIds);
      const roots = this.deps.entries
        .executable(execution.jobId)
        .filter((entry) => !selected || selected.has(entry.id))
        .flatMap((entry) => {
          const root = this.settingsFor(entry).destinationRoot;
          return typeof root === 'string' ? [root] : [root.movie, root.series];
        });
      return [job.path, ...roots];
    } catch {
      return undefined;
    }
  }

  /**
   * Plans, for movies of a library, the name that says their version (`- 2160p`), whether or not
   * they are already named as the profile wants. `ready` is what would be renamed; `refused` is what
   * cannot be (no size in the name, a profile without a naming for versions). A file with nothing
   * to change is in neither.
   */
  async planVersions(
    jobId: string,
    entryIds: readonly string[],
    screenSize?: string,
  ): Promise<{ ready: Map<string, PlanItem>; refused: Map<string, PlanItem> }> {
    this.requireDoneJob(jobId);
    const ready = new Map<string, PlanItem>();
    const refused = new Map<string, PlanItem>();
    for (const id of entryIds) {
      const entry = this.deps.entries.get(id);
      const stored = entry?.candidates.find(({ id: c }) => c.id === entry.item?.externalId.id);
      if (!entry || entry.jobId !== jobId || entry.parsed.kind === 'unknown' || !stored) {
        continue;
      }
      // A size chosen by hand wins over what the name says, which wins over what the file shows.
      const size =
        screenSize ??
        withQuality(entry.parsed).screenSize ??
        (await sizeReaderOf(this.deps)?.(entry.parsed.path));
      const named =
        size === undefined ? entry : { ...entry, parsed: { ...entry.parsed, screenSize: size } };
      const item = await this.planWith(named, toCandidate(stored), {
        applyVersion: true,
      });
      if (item.status === 'ready') {
        ready.set(id, item);
      } else if (item.status === 'conflict') {
        refused.set(id, item);
      }
    }
    return { ready, refused };
  }

  /** Makes the planned version names what the files wait to do, so a transfer can run them. */
  commitVersions(ready: ReadonlyMap<string, PlanItem>): void {
    for (const [id, item] of ready) {
      this.deps.entries.setMatch(id, 'to-rename', item);
    }
  }

  /**
   * Transfers the files of an execution, run by the queue worker. The plan is rebuilt from the
   * stored items and the settings of the job, and the executor re-checks each destination right
   * before writing. Each file is settled as soon as it is transferred, in step with the journal:
   * after a crash the execution only has what is left to do.
   */
  async run(
    execution: Execution,
    onSettled?: (done: number, total: number, path: string) => void,
    onStart?: (total: number) => void,
  ): Promise<ExecutionOutcome> {
    const { groups, held } = await this.prepare(execution.jobId, execution.entryIds ?? undefined, {
      persist: true,
    });
    // A resumed execution keeps its batch: what it did before the crash and what it does now are
    // one batch in the journal, so one undo reverts them all.
    const batchId = execution.batchId ?? randomUUID();
    if (!execution.batchId) {
      this.deps.executions.setBatch(execution.id, batchId);
    }

    const total = groups.reduce((sum, group) => sum + group.entryOfItem.size, 0) + held.length;
    onStart?.(total);
    let done = 0;
    let failed = 0;
    const files: OutcomeFile[] = [];
    // Left waiting in Arrivals with the conflict, not marked failed: nothing was attempted.
    for (const { entry, destination } of held) {
      failed++;
      files.push({
        path: entry.path,
        destination,
        kind: 'movie',
        status: 'failed',
        error: { code: 'destination.exists', params: { path: destination } },
      });
      onSettled?.(done + failed, total, entry.path);
    }
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
        onSettled?.(done + failed, total, entry.path);
      });
    }
    this.deps.snapshot.transferred(execution.jobId, settled);
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
    options: { persist?: boolean; overrides?: ReadonlyMap<string, PlanItem> } = {},
  ): Promise<{
    groups: { plan: Plan; entryOfItem: Map<string, Entry> }[];
    held: { entry: Entry; destination: string }[];
  }> {
    const job = this.requireDoneJob(jobId);
    const { overrides } = options;
    // Versions asked for by hand come with their own plan: the stored one says nothing to do.
    const executable = overrides
      ? [...overrides].map(([id, item]): Entry => ({ ...this.require(id), item }))
      : this.deps.entries.executable(jobId);
    const selected = entryIds && new Set(entryIds);
    // A show's files ride on one episode of the plan: left out, it hands them to a chosen one.
    const items = selected
      ? new Map(
          selectItems(
            executable.flatMap((entry) => (entry.item ? [entry.item] : [])),
            new Set(executable.filter((e) => selected.has(e.id)).flatMap((e) => e.item?.id ?? [])),
          ).map((item) => [item.id, item]),
        )
      : undefined;
    const chosen = executable.flatMap((entry) => {
      if (!entry.item || (selected && !selected.has(entry.id))) {
        return [];
      }
      const item = items?.get(entry.item.id) ?? entry.item;
      return [item === entry.item ? entry : { ...entry, item }];
    });
    const held: { entry: Entry; destination: string }[] = [];
    const entries: Entry[] = [];
    for (const entry of chosen) {
      const fresh = overrides ? entry : await this.refreshed(entry, options.persist === true);
      if ('held' in fresh) {
        held.push({ entry, destination: fresh.held });
      } else {
        entries.push(fresh);
      }
    }

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
    const planned = [...groups.values()].map(({ settings, entries: members }, index) => {
      const profile = buildProfile(settings.profile);
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
    });
    return { groups: planned, held };
  }

  /**
   * A stored plan is as old as the analysis: another transfer may have taken the name since (the
   * same movie in a second quality, from another release). A movie whose destination is now taken
   * is planned again against the disk as it is, which may find it a free name of its quality. If
   * none is left, it is held in Arrivals as a conflict rather than sent to fail. Other works are
   * left as they were: they cannot be told apart by a name.
   */
  private async refreshed(entry: Entry, persist: boolean): Promise<Entry | { held: string }> {
    const main = entry.item?.operations.find(
      (operation): operation is TransferOperation =>
        operation.type === 'transfer' && operation.role === 'main',
    );
    if (!entry.item || !main || entry.parsed.kind === 'unknown') {
      return entry;
    }
    const taken = await lstat(main.destination).then(
      () => true,
      () => false,
    );
    // A name that is free may still have a version of the work beside it now, which a file saying
    // no size should be told apart from (reading it is what `planWith` does when it can).
    const crowded =
      !taken &&
      entry.item.parsed.screenSize === undefined &&
      sizeReaderOf(this.deps) !== undefined &&
      (await hasVersionSibling(
        dirname(main.destination),
        basename(main.destination, extname(main.destination)),
        main.source,
      ));
    if (!taken && !crowded) {
      return entry;
    }
    const stored = entry.candidates.find(({ id }) => id.id === entry.item?.externalId.id);
    if (!stored) {
      return entry;
    }
    let item: PlanItem;
    try {
      // The stored plan's own reading of the name: a size chosen by hand lives only there.
      item = await this.planWith({ ...entry, parsed: entry.item.parsed }, toCandidate(stored));
    } catch {
      // The provider is down: the stored plan stands, and the executor still refuses to overwrite.
      return entry;
    }
    if (persist) {
      this.deps.entries.setMatch(entry.id, classifyItem(item), item);
    }
    return item.status === 'ready' ? { ...entry, item } : { held: main.destination };
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
      // A file the undo kept where it was (the last copy, an original place taken since) stays
      // in the library.
      const kept = new Set(
        result.entries
          .filter(
            ({ status, error }) =>
              status === 'skipped' && error?.code !== 'undo.destination-missing',
          )
          .map(({ entry }) => entry.id),
      );
      this.deps.snapshot.undone(journal.entriesOf(batchId).filter(({ id }) => !kept.has(id)));
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
    if (main?.error?.code === 'destination.exists' && entry.item) {
      // The name was taken between the plan and the write (the executor never overwrites): the
      // file waits as a conflict, with its reason, instead of failing without one.
      this.deps.entries.setMatch(entry.id, 'conflict', {
        ...entry.item,
        status: 'conflict',
        operations: [],
        conflicts: [{ reason: 'destination-exists', path: main.operation.destination }],
      });
      return 'failed';
    }
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
    if (this.deps.matches.locked(this.lockOf(entry))) {
      throw new ApiError(409, 'queue.match-in-progress');
    }
    this.requireFree([entry]);
    return entry;
  }

  /**
   * A transfer waiting or running holds its files: changing their plan, or setting them aside,
   * would change what that transfer does under it.
   */
  private requireFree(entries: readonly Entry[]): void {
    const held = this.deps.executions.pendingEntries();
    for (const { id, jobId } of entries) {
      const holding = held.get(jobId);
      if (holding === null || holding?.has(id)) {
        throw new ApiError(409, 'queue.entry-held');
      }
    }
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
      profile: libraryProfile(library, this.deps.config),
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

const parser = new GuessitParser();

/**
 * A file analyzed before names carried their quality has no size or source in what was stored:
 * they are read again from its name, which says the same today as then. Only what is missing is
 * added, so a size chosen by hand is kept.
 */
function withQuality(parsed: ParsedMedia): ParsedMedia {
  if (parsed.kind === 'unknown' || parsed.screenSize !== undefined) {
    return parsed;
  }
  const { screenSize, source } = parser.parse(parsed.path);
  return screenSize === undefined
    ? parsed
    : {
        ...parsed,
        screenSize,
        ...(source !== undefined && parsed.source === undefined && { source }),
      };
}

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
