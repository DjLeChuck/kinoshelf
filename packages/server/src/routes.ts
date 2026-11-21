import { basename } from 'node:path';
import type { PlanItem } from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { toCandidate, type CandidateBody } from './candidate-body.js';
import { isSystemPath } from './system-paths.js';
import { workKindOf, type ArrivalState, type Entry, type EntryStore } from './entries.js';
import { resolutionOf } from './library-items.js';
import type { EventBus } from './events.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { History } from './history.js';
import type { Job, JobStore } from './jobs.js';
import type { ProgressTracker } from './progress.js';
import type { UndoTasks } from './undo-tasks.js';
import type { JobRunner } from './runner.js';
import {
  activitySchema,
  batchDetailSchema,
  candidateSchema,
  arrivalsSchema,
  entrySchema,
  matchStateSchema,
  errorSchema,
  executionSchema,
  jobSchema,
  matchBodySchema,
  notificationTestSchema,
  paging,
  previewSchema,
  sizeSchema,
  undoStateSchema,
  undoTaskSchema,
  type Paging,
  MAX_SELECTION,
} from './schemas.js';
import type { Notifier } from './notify/notifier.js';
import type { Service, UndoReport } from './service.js';

export interface RouteContext {
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly executions: ExecutionStore;
  readonly service: Service;
  readonly runner: JobRunner;
  readonly notifier: Notifier;
  /** An undo took files back: the media servers are asked to look at the folders again. */
  readonly reverted?: (report: UndoReport) => void;
  readonly events: EventBus;
  readonly history: History;
  readonly progress: ProgressTracker;
  readonly undos: UndoTasks;
}

function presentPlan(item: PlanItem | null) {
  const main = item?.operations.find((op) => op.type === 'transfer' && op.role === 'main');
  return {
    destination: main?.destination ?? null,
    conflicts: (item?.conflicts ?? []).map((conflict) => ({
      reason: conflict.reason,
      path: conflict.path,
      detail: conflict.detail ?? null,
    })),
  };
}

/** A file as `match` and `ignore` answer it. */
export function presentEntry(entry: Entry): unknown {
  const { parsed } = entry;
  return {
    id: entry.id,
    jobId: entry.jobId,
    path: entry.path,
    classification: entry.classification,
    resolution: entry.resolution,
    parsed: {
      kind: parsed.kind,
      ...(parsed.title !== undefined && { title: parsed.title }),
      ...(parsed.year !== undefined && { year: parsed.year }),
      ...(parsed.season !== undefined && { season: parsed.season }),
      episodes: parsed.episodes,
    },
    reason: entry.reason,
    candidates: entry.candidates,
    ...presentPlan(entry.item),
    error: entry.error,
    batchId: entry.batchId,
    release: entry.release,
    cluster: entry.cluster,
    detached: entry.detached,
  };
}

/**
 * What an arriving file waits for: a transfer to start, a choice, a name nobody found, or nothing
 * (already in the library). `states` is what the queue's own filters say; a file they do not list
 * (one still held by a transfer, say) is read from its classification.
 */
function arrivalState(entry: Entry, states: ReadonlyMap<string, ArrivalState>): ArrivalState {
  const listed = states.get(entry.id);
  if (listed !== undefined) {
    return listed;
  }
  return entry.classification === 'unrecognized'
    ? 'unrecognized'
    : entry.classification === 'to-rename' && entry.resolution === null
      ? 'ready'
      : 'review';
}

/** One file of an arrival: what it is called, how sure the match is, where it would go. */
interface UnknownEpisode {
  readonly file: string;
  readonly season: number | null;
  readonly seasonKnown: boolean;
}

const unknownEpisodeOf = (file: Entry): UnknownEpisode | undefined =>
  file.candidates[0]?.episodeUnknown === true
    ? {
        file: basename(file.path),
        season: file.parsed.season ?? null,
        seasonKnown: file.candidates[0].seasonUnknown !== true,
      }
    : undefined;

const byFile = (a: UnknownEpisode, b: UnknownEpisode): number => (a.file < b.file ? -1 : 1);

/**
 * The files of the release TMDB has no season and episode for, said once for the group a
 * validation covers. The group is read and sorted **once per release and series**, whatever the
 * number of files asked for: a release of thousands of files must not cost one read of the whole
 * release for each of them.
 */
function unknownEpisodesOf(entries: ReleaseReader): (entry: Entry) => UnknownEpisode[] {
  const groups = new Map<string, { ids: Set<string>; unknown: UnknownEpisode[] }>();
  return (entry) => {
    const own = unknownEpisodeOf(entry);
    if (entry.release === null || entry.parsed.kind !== 'episode') {
      return own ? [own] : [];
    }
    const key = `${entry.jobId}|${entry.release}|${entry.cluster}`;
    let group = groups.get(key);
    if (!group) {
      const files = entries.releaseGroup(entry);
      group = {
        ids: new Set(files.map(({ id }) => id)),
        unknown: files.flatMap((file) => unknownEpisodeOf(file) ?? []).sort(byFile),
      };
      groups.set(key, group);
    }
    // A file the group leaves out (a failed transfer, say) still counts for itself.
    return own && !group.ids.has(entry.id) ? [own, ...group.unknown].sort(byFile) : group.unknown;
  };
}

/**
 * The episodes of a release the library holds for certain, said on each of its files: a release
 * with some episodes to bring in stays where it is, and the panel tells which ones are there.
 */
function presentEpisodesOf(entries: ReleaseReader): (entry: Entry) => { file: string }[] {
  const groups = new Map<string, { file: string }[]>();
  return (entry) => {
    if (entry.release === null || entry.parsed.kind !== 'episode') {
      return [];
    }
    const key = `${entry.jobId}|${entry.release}|${String(entry.cluster)}`;
    let group = groups.get(key);
    if (!group) {
      group = entries
        .releaseGroup(entry)
        .filter(({ duplicate }) => duplicate !== null && duplicate.forced === null)
        .filter(({ duplicate }) => duplicate?.kind !== 'other-version')
        .map(({ path }) => ({ file: basename(path) }))
        .sort((a, b) => a.file.localeCompare(b.file));
      groups.set(key, group);
    }
    return group;
  };
}

type ReleaseReader = Pick<EntryStore, 'releaseGroup'>;

/** Reads each release once for everything a response says of it (unknown and present episodes). */
function sharedReleases(entries: EntryStore): ReleaseReader {
  const read = new Map<string, Entry[]>();
  return {
    releaseGroup: (entry) => {
      const key = `${entry.jobId}|${entry.release ?? ''}|${String(entry.cluster)}`;
      let group = read.get(key);
      if (!group) {
        group = entries.releaseGroup(entry);
        read.set(key, group);
      }
      return group;
    },
  };
}

function presentArrival(
  entry: Entry,
  service: Service,
  jobOf: (id: string) => Job | undefined,
  unknownEpisodes: (entry: Entry) => UnknownEpisode[],
  presentEpisodes: (entry: Entry) => { file: string }[],
  states: ReadonlyMap<string, ArrivalState>,
): unknown {
  const job = jobOf(entry.jobId);
  const destination = service.destinationOf(entry, job);
  const plan = presentPlan(entry.item);
  const kind = workKindOf(entry);
  return {
    id: entry.id,
    jobId: entry.jobId,
    path: entry.path,
    file: basename(entry.path),
    release: entry.release,
    cluster: entry.cluster,
    detached: entry.detached,
    state: arrivalState(entry, states),
    kind,
    resolution: resolutionOf(entry.path),
    title: entry.parsed.title ?? null,
    year: entry.parsed.year ?? null,
    sourceId: job?.libraryId ?? null,
    destination,
    destinationOptions: service.destinationOptions(entry).map(({ id, name }) => ({ id, name })),
    reason: entry.reason,
    candidates: entry.candidates,
    // The files of the release TMDB has no season and episode for: what keeps the choice under the
    // threshold, said once for the whole group the validation covers.
    unknownEpisodes: unknownEpisodes(entry),
    // Why the best candidate is not a full score, in the words of the web: the country is the one
    // the file named, since a wrong one is the odd cause to find.
    limits: (entry.candidates[0]?.limits ?? []).map((code) => ({
      code,
      value: code === 'country' ? (entry.parsed.country ?? null) : null,
    })),
    conflicts: plan.conflicts,
    error: entry.error,
    duplicate: service.duplicateOf(entry),
    presentEpisodes: presentEpisodes(entry),
  };
}

/** A bare POST (no body, no content type) means "all defaults", not "invalid". */
const emptyBodyByDefault = (
  request: { body?: unknown },
  _reply: unknown,
  done: () => void,
): void => {
  request.body ??= {};
  done();
};

/** A transfer with where it is, while it runs (in memory, like a scan's progress). */
function presentExecution(
  ctx: Pick<RouteContext, 'progress'>,
  execution: Execution | undefined,
): unknown {
  return execution
    ? { ...execution, progress: ctx.progress.transferOf(execution.id) ?? null }
    : null;
}

/** A job as the API shows it: its row, a count of its files, its latest transfer, its settings, its progress. */
export function jobPresenter(
  ctx: Pick<RouteContext, 'jobs' | 'entries' | 'executions' | 'progress'>,
): (job: Job) => unknown {
  return (job) => ({
    ...job,
    summary: job.status === 'done' ? ctx.entries.summary(job.id) : null,
    execution: presentExecution(ctx, ctx.executions.latestOf(job.id)),
    // The transfer going on (whoever's it is) while this job waits behind it.
    transfer: job.status === 'queued' ? (ctx.progress.runningTransfer() ?? null) : null,
    settings: ctx.jobs.settings(job.id) ?? null,
    // Only while it runs: in memory, never stored.
    progress: ctx.progress.of(job.id) ?? null,
  });
}

/** Thin HTTP layer: validate, call the store or the service, shape the answer. */
export function registerRoutes(api: FastifyInstance, ctx: RouteContext): void {
  const { jobs, entries, service, runner, notifier, events, history } = ctx;
  const presentJob = jobPresenter(ctx);
  const idParams = { type: 'object', properties: { id: { type: 'string' } } } as const;
  const dryRunBody = {
    type: 'object',
    additionalProperties: false,
    properties: { dryRun: { type: 'boolean', default: false } },
  } as const;

  api.post<{ Body: { path: string; apply?: boolean } }>(
    '/api/jobs',
    {
      schema: {
        summary: 'Submit a file or a folder to identify',
        description:
          'Queues the analysis (parse, match, plan) of an absolute path; nothing is written to the ' +
          'disk. With `apply`, the files matched with confidence are then transferred in one batch ' +
          'and the others wait in the validation queue: one call replaces a manual run.',
        body: {
          type: 'object',
          required: ['path'],
          additionalProperties: false,
          properties: {
            path: {
              type: 'string',
              pattern: '^/',
              maxLength: 4096,
              description: 'Absolute path; not `/`, `/proc`, `/sys` nor `/dev` (422)',
            },
            apply: { type: 'boolean', default: false },
          },
        },
        response: {
          202: jobSchema,
          400: errorSchema,
          401: errorSchema,
          422: errorSchema,
          503: errorSchema,
        },
      },
    },
    (request, reply) => {
      if (isSystemPath(request.body.path)) {
        throw new ApiError(422, 'fs.system-folder', { path: request.body.path });
      }
      const job = jobs.create(request.body.path, request.body.apply ?? false);
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send(presentJob(job));
    },
  );

  api.get<{ Params: { id: string } }>(
    '/api/jobs/:id',
    {
      schema: {
        summary: 'A job, with a count of its files per classification once it is done',
        params: idParams,
        response: { 200: jobSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    (request, reply) => {
      const job = jobs.get(request.params.id);
      return job ? presentJob(job) : reply.code(404).send({ error: { code: 'job.not-found' } });
    },
  );

  api.post<{ Params: { id: string } }>(
    '/api/jobs/:id/cancel',
    {
      schema: {
        summary: 'Cancel an analysis, queued or running',
        description:
          'A queued job is cancelled at once; a running one stops at its next check and ends as ' +
          '`cancelled` (announced by the `jobs` event). Nothing is stored, so a library keeps the ' +
          'rows its last scan left. 409 `job.not-cancellable` once the job ended.',
        params: idParams,
        response: { 202: jobSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request, reply) => {
      const job = jobs.get(request.params.id);
      if (!job) {
        return reply.code(404).send({ error: { code: 'job.not-found' } });
      }
      if (!runner.cancel(job.id)) {
        throw new ApiError(409, 'job.not-cancellable');
      }
      events.emit('jobs');
      return reply.code(202).send(presentJob(jobs.get(job.id) ?? job));
    },
  );

  api.get<{ Querystring: Paging & { state?: ArrivalState } }>(
    '/api/arrivals',
    {
      schema: {
        summary: 'Files that wait for a destination or a choice',
        description:
          'What the arrival folders (and paths sent by hand) hold that waits for a human: `review` ' +
          '(candidates to choose from, a conflict, a failed transfer, or a work the library holds in ' +
          'another version), `unrecognized`, `present` (already in the destination library: the same ' +
          'file or one of the same size; `duplicate` says which) and `ready` ' +
          '(matched with confidence, but the analysis did not transfer it: `apply` is off; ' +
          '`POST /api/plans/{id}/execute` starts it). Each file says where it would go (`destination`) and the libraries it could go to instead. `total` counts ' +
          'every file of the filter, for the badge of the navigation, and `counts` every state; `limit` ' +
          'and `offset` count releases.',
        querystring: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['ready', 'review', 'unrecognized', 'present'] },
            ...paging,
          },
        },
        response: { 200: arrivalsSchema, 401: errorSchema },
      },
    },
    (request) => {
      const { state, limit, offset } = request.query;
      // The files of a page share a handful of jobs: each is read once.
      const known = new Map<string, Job | undefined>();
      const jobOf = (id: string): Job | undefined => {
        if (!known.has(id)) {
          known.set(id, jobs.get(id));
        }
        return known.get(id);
      };
      const releases = sharedReleases(entries);
      const unknownOf = unknownEpisodesOf(releases);
      const presentOf = presentEpisodesOf(releases);
      const sources = service.arrivalFolders();
      const arrivalIds = sources.map(({ id }) => id);
      const page = entries.arrivals({ arrivalIds, ...(state && { state }), limit, offset });
      const states = entries.statesOf(page.entries.map(({ id }) => id));
      return {
        total: page.total,
        counts: entries.arrivalCounts(arrivalIds),
        sources: sources.map(({ id, name, source }) => ({ id, name, path: source })),
        items: page.entries.map((entry) =>
          presentArrival(entry, service, jobOf, unknownOf, presentOf, states),
        ),
      };
    },
  );

  api.get<{ Params: { id: string } }>(
    '/api/entries/:id',
    {
      schema: {
        summary: 'One file, as `GET /api/arrivals` shows it',
        description:
          'For a file that is not in an arrival folder (a library organized in place, a path sent ' +
          'by hand), whose candidates and destinations are needed to settle it.',
        params: idParams,
        response: {
          200: arrivalsSchema.properties.items.items,
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    (request) => {
      const entry = entries.get(request.params.id);
      if (!entry) {
        throw new ApiError(404, 'queue.entry-not-found');
      }
      const releases = sharedReleases(entries);
      return presentArrival(
        entry,
        service,
        (id) => jobs.get(id),
        unknownEpisodesOf(releases),
        presentEpisodesOf(releases),
        entries.statesOf([entry.id]),
      );
    },
  );

  api.get<{
    Querystring: { query: string; year?: number; kind?: 'movie' | 'series'; language?: string };
  }>(
    '/api/search',
    {
      schema: {
        summary: 'Search TMDB by hand',
        querystring: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1 },
            year: { type: 'integer' },
            kind: { type: 'string', enum: ['movie', 'series'] },
            language: { type: 'string', minLength: 2 },
          },
        },
        response: {
          200: { type: 'array', items: candidateSchema },
          401: errorSchema,
          409: errorSchema,
          502: errorSchema,
        },
      },
    },
    (request) => service.search(request.query),
  );

  api.post<{
    Params: { id: string };
    Body: CandidateBody & { libraryId?: string; screenSize?: string };
  }>(
    '/api/entries/:id/match',
    {
      schema: {
        summary: 'Validate a match',
        description:
          'Starts planning the file with a candidate returned by `GET /api/search`; it overrides ' +
          'the score. The answer is 202 at once: the work takes as long as the release is long, ' +
          'and `GET /api/entries/{id}/match` tells where it is and how it ended (the file ' +
          '`to-rename`, or in `conflict` if its target cannot be used). For ' +
          'a series, the other episodes of the same release follow the choice (the ones of ' +
          'the same `cluster`) and are planned together; `followers` lists them. 409 when the ' +
          'release is already being validated or a transfer holds one of its files. ' +
          "`libraryId` sends the file to that library (of the work's kind) rather than to the " +
          "default one, for this file only. `screenSize` (`2160p`…) names the file's quality " +
          'when its name says none, and wins over what the name says; it is for this file only.',
        params: idParams,
        body: {
          ...matchBodySchema,
          properties: {
            ...matchBodySchema.properties,
            libraryId: { type: 'string' },
            screenSize: sizeSchema,
          },
        },
        response: {
          202: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      service.startMatch(request.params.id, toCandidate(request.body), {
        ...(request.body.libraryId !== undefined && { libraryId: request.body.libraryId }),
        ...(request.body.screenSize !== undefined && { screenSize: request.body.screenSize }),
      });
      return reply.code(202).send({ id: request.params.id });
    },
  );

  api.get<{ Params: { id: string } }>(
    '/api/entries/:id/match',
    {
      schema: {
        summary: 'Where a validation is',
        description:
          'The last validation started for the file: `running` with how many files have their ' +
          'metadata loaded, `done` with the file and its `followers`, or `failed` with the cause. ' +
          "It lives in the server's memory: 404 once the server restarted (the file is simply " +
          'still waiting). The `progress` event says when to read it again.',
        params: idParams,
        response: { 200: matchStateSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    (request) => {
      const { state, entry } = service.matchOf(request.params.id);
      const arrival = entry && entries.statesOf([entry.id]).get(entry.id);
      return {
        ...state,
        ...(entry && { entry: presentEntry(entry) as object }),
        ...(arrival && { arrival }),
      };
    },
  );

  api.post<{
    Params: { id: string };
    Body: CandidateBody & { libraryId?: string; screenSize?: string };
  }>(
    '/api/entries/:id/preview',
    {
      schema: {
        summary: 'Where a file would go with a candidate',
        description:
          'Plans the file like `match` does, and records nothing: the destination, and the ' +
          'conflicts that would send it back to the queue. `libraryId` previews the destination ' +
          'in that library instead of the default one.',
        params: idParams,
        body: {
          ...matchBodySchema,
          properties: {
            ...matchBodySchema.properties,
            libraryId: { type: 'string' },
            screenSize: sizeSchema,
          },
        },
        response: { 200: previewSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const candidate = toCandidate(request.body);
      const item = await service.preview(
        request.params.id,
        candidate,
        request.body.libraryId,
        request.body.screenSize,
      );
      const plan = presentPlan(item);
      return {
        ...plan,
        folder: service.previewFolder(
          request.params.id,
          candidate,
          plan.destination,
          request.body.libraryId,
        ),
      };
    },
  );

  api.post<{ Params: { id: string } }>(
    '/api/entries/:id/ignore',
    {
      schema: {
        summary: 'Set a file aside',
        description: 'The rest of its release goes with it.',
        params: idParams,
        response: { 200: entrySchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request) => {
      const entry = service.ignore(request.params.id);
      events.emit('arrivals');
      return presentEntry(entry);
    },
  );

  api.post<{ Body: { ids?: string[]; state?: ArrivalState } }>(
    '/api/entries/ignore',
    {
      schema: {
        summary: 'Set many files aside at once',
        description:
          'Either `ids` (files, each with the rest of its release) or `state` (every file of that ' +
          'Arrivals state, the ones the page has not loaded included): both or neither is a 422. ' +
          'Files a transfer waiting or running holds are left alone and counted in `held`. One ' +
          'write, one `arrivals` event.',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ids: { type: 'array', items: { type: 'string' }, maxItems: 100000 },
            state: { type: 'string', enum: ['ready', 'review', 'unrecognized', 'present'] },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ignored', 'held'],
            properties: { ignored: { type: 'integer' }, held: { type: 'integer' } },
          },
          401: errorSchema,
          422: errorSchema,
        },
      },
    },
    (request) => {
      const { ids, state } = request.body;
      if ((ids === undefined) === (state === undefined)) {
        throw new ApiError(422, 'request.invalid', { detail: 'send either ids or state' });
      }
      const result = service.ignoreMany(
        ids === undefined ? { state: state ?? 'present' } : { ids },
      );
      if (result.ignored > 0) {
        events.emit('arrivals');
      }
      return result;
    },
  );

  api.post<{ Params: { id: string } }>(
    '/api/entries/:id/ignore-present',
    {
      schema: {
        summary: 'Set aside the files of a release the library already holds',
        description:
          'Only the files of the release (and series) that are already in the destination library: ' +
          'the others stay to be transferred, where `ignore` takes the whole release. Files a transfer ' +
          'holds are left alone and counted in `held`. 409 `queue.not-duplicate` when none is there.',
        params: idParams,
        response: {
          200: {
            type: 'object',
            required: ['ignored', 'held'],
            properties: { ignored: { type: 'integer' }, held: { type: 'integer' } },
          },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request) => {
      const result = service.ignorePresentOf(request.params.id);
      if (result.ignored > 0) {
        events.emit('arrivals');
      }
      return result;
    },
  );

  api.post<{ Params: { id: string } }>(
    '/api/entries/:id/process',
    {
      schema: {
        summary: 'Process a file the library already holds anyway',
        description:
          'The file goes back to `review` with its candidate (`duplicate.forced` is `asked`), the rest ' +
          'of its release with it; validating it adds it like any other version. 409 ' +
          '`queue.not-duplicate` for a file the library does not hold.',
        params: idParams,
        response: { 200: entrySchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request) => {
      const entry = service.processAnyway(request.params.id);
      events.emit('arrivals');
      return presentEntry(entry);
    },
  );

  api.post<{ Params: { id: string }; Body?: { entries?: string[] } }>(
    '/api/plans/:id/execute',
    {
      preValidation: emptyBodyByDefault,
      schema: {
        summary: 'Execute the plan of a job',
        description:
          'The plan of a job is the set of its matched files not transferred yet; its id is the ' +
          "job's. The transfer is queued (202) and its batch shows in the history. Transfers run " +
          'one at a time: a request made while another ' +
          'is queued or running waits its turn, but files another transfer already holds, or whose ' +
          'release is being validated, are left out: 409 `queue.entry-held` when none is left. ' +
          'A destination that exists is never ' +
          'overwritten, and hardlink never falls back to copy.',
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entries: {
              type: 'array',
              maxItems: MAX_SELECTION,
              items: { type: 'string', maxLength: 64 },
              description: 'Only these files',
            },
          },
        },
        response: {
          202: executionSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const entryIds = request.body?.entries;
      const execution = service.enqueue(request.params.id, entryIds);
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send(execution);
    },
  );

  api.get<{ Querystring: Paging & { all?: boolean } }>(
    '/api/history',
    {
      schema: {
        summary: 'Batches and jobs in one list, newest first',
        description:
          'A batch is a line of its own (the CLI makes some too, without a job); a job is one only ' +
          'when it has no batch yet: still waiting, running, or failed. A job that finished and ' +
          'moved nothing is `routine`: left out unless `all` is set, and never deleted by that.',
        querystring: {
          type: 'object',
          properties: { ...paging, all: { type: 'boolean', default: false } },
        },
        response: {
          200: {
            type: 'object',
            required: ['total', 'items'],
            properties: {
              total: { type: 'integer', description: 'Lines of the chosen view, before paging.' },
              items: { type: 'array', items: activitySchema },
            },
          },
          401: errorSchema,
        },
      },
    },
    (request) =>
      history.activity({
        all: request.query.all ?? false,
        limit: request.query.limit,
        offset: request.query.offset,
      }),
  );

  api.get<{ Params: { id: string } }>(
    '/api/batches/:id',
    {
      schema: {
        summary: 'A batch and each of its operations',
        params: idParams,
        response: { 200: batchDetailSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    (request, reply) =>
      history.get(request.params.id) ??
      reply.code(404).send({ error: { code: 'batch.not-found' } }),
  );

  api.post<{ Params: { id: string }; Body?: { dryRun?: boolean } }>(
    '/api/batches/:id/undo',
    {
      preValidation: emptyBodyByDefault,
      schema: {
        summary: 'Start undoing a batch',
        description:
          'Starts a task and answers 202 at once (reverting a big batch on a share takes minutes): ' +
          '`GET /api/batches/{id}/undo` says how far it has got and gives the report. Any batch ' +
          'not undone yet can be, not only the last (a move goes back where it came from). Each ' +
          'file is checked as it is now: whatever a later batch moved on or took the place of is ' +
          'skipped and reported, never forced. `dryRun` only checks. 409 `batch.undo-in-progress` ' +
          'while a task of this batch runs, 409 `batch.already-undone`.',
        params: idParams,
        body: dryRunBody,
        response: { 202: undoTaskSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request, reply) => {
      const dryRun = request.body?.dryRun ?? false;
      const { id } = request.params;
      if (ctx.undos.isRunning(id)) {
        throw new ApiError(409, 'batch.undo-in-progress');
      }
      service.assertUndoable(id);
      const task = ctx.undos.start(
        id,
        dryRun,
        (onProgress) => service.undo(id, { dryRun, onProgress }),
        (ended) => {
          if (!dryRun && ended.report) {
            events.emit('history', 'arrivals');
            ctx.reverted?.(ended.report);
          }
        },
      );
      return reply.code(202).send(task);
    },
  );

  api.get<{ Params: { id: string } }>(
    '/api/batches/:id/undo',
    {
      schema: {
        summary: 'How an undo, or its check, is going',
        description:
          'The latest task of this batch, in memory (a restart forgets it): `undo` is `null` when ' +
          'none was started. The `progress` event says when to read it again.',
        params: idParams,
        response: { 200: undoStateSchema, 401: errorSchema },
      },
    },
    (request) => ({ undo: ctx.undos.of(request.params.id) ?? null }),
  );

  api.post(
    '/api/notifications/test',
    {
      schema: {
        summary: 'Send a test notification to every target',
        description:
          'Reaches each webhook, and checks that Plex and Jellyfin answer and accept their key, ' +
          'whatever the events a webhook listens to. Nothing is refreshed.',
        response: { 200: notificationTestSchema, 401: errorSchema },
      },
    },
    () => notifier.test(),
  );
}
