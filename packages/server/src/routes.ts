import { basename } from 'node:path';
import type { Candidate, MovieCandidate, PlanItem, SeriesCandidate } from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import type { Entry, EntryStore } from './entries.js';
import { resolutionOf, type LibraryItemStore } from './library-items.js';
import type { EventBus } from './events.js';
import type { ExecutionStore } from './executions.js';
import type { History } from './history.js';
import type { Job, JobStore } from './jobs.js';
import type { ProgressTracker } from './progress.js';
import type { JobRunner } from './runner.js';
import {
  activitySchema,
  batchDetailSchema,
  candidateSchema,
  classificationValues,
  arrivalsSchema,
  workDestinationSchema,
  entrySchema,
  matchResultSchema,
  errorSchema,
  executionReportSchema,
  executionSchema,
  jobSchema,
  matchBodySchema,
  notificationTestSchema,
  paging,
  previewSchema,
  undoSchema,
} from './schemas.js';
import type { WorkDestinationStore } from './work-destinations.js';
import type { Notifier } from './notify/notifier.js';
import type { Service } from './service.js';

export interface RouteContext {
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly executions: ExecutionStore;
  readonly workDestinations: WorkDestinationStore;
  readonly items: LibraryItemStore;
  readonly service: Service;
  readonly runner: JobRunner;
  readonly notifier: Notifier;
  readonly events: EventBus;
  readonly history: History;
  readonly progress: ProgressTracker;
}

interface Paging {
  limit?: number;
  offset?: number;
}

interface CandidateBody {
  kind: 'movie' | 'series';
  id: Candidate['id'];
  title: string;
  originalTitle?: string;
  alternativeTitles?: string[];
  year?: number;
  posterPath?: string;
}

/** The planner reads title, year and id; the rest of a candidate is filled in neutrally. */
function toCandidate(body: CandidateBody): Candidate {
  const candidate: MovieCandidate | SeriesCandidate = {
    kind: body.kind,
    id: body.id,
    title: body.title,
    originalTitle: body.originalTitle ?? body.title,
    alternativeTitles: body.alternativeTitles ?? [],
    ...(body.year !== undefined && { year: body.year }),
    ...(body.posterPath !== undefined && { posterPath: body.posterPath }),
  };
  return candidate;
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

function presentEntry(entry: Entry): unknown {
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
    detached: entry.detached,
  };
}

/** One file of an arrival: what it is called, how sure the match is, where it would go. */
function presentArrival(entry: Entry, service: Service, jobs: JobStore): unknown {
  const job = jobs.get(entry.jobId);
  const destination = service.destinationOf(entry);
  const plan = presentPlan(entry.item);
  const kind =
    entry.parsed.kind === 'movie' ? 'movie' : entry.parsed.kind === 'episode' ? 'series' : null;
  return {
    id: entry.id,
    jobId: entry.jobId,
    path: entry.path,
    file: basename(entry.path),
    release: entry.release,
    detached: entry.detached,
    state: entry.classification === 'unrecognized' ? 'unrecognized' : 'review',
    kind,
    resolution: resolutionOf(entry.path),
    createdAt: job?.createdAt ?? null,
    sourceId: job?.libraryId ?? null,
    destination,
    destinationOptions: service.destinationOptions(entry).map(({ id, name }) => ({ id, name })),
    reason: entry.reason,
    candidates: entry.candidates,
    plannedPath: plan.destination,
    conflicts: plan.conflicts,
    error: entry.error,
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

/** A job as the API shows it: its row, a count of its files, its latest transfer, its settings, its progress. */
export function jobPresenter(
  ctx: Pick<RouteContext, 'jobs' | 'entries' | 'executions' | 'progress'>,
): (job: Job) => unknown {
  return (job) => ({
    ...job,
    summary: job.status === 'done' ? ctx.entries.summary(job.id) : null,
    execution: ctx.executions.latestOf(job.id) ?? null,
    settings: ctx.jobs.settings(job.id) ?? null,
    // Only while it runs: in memory, never stored.
    progress: ctx.progress.of(job.id) ?? null,
  });
}

/** Thin HTTP layer: validate, call the store or the service, shape the answer. */
export function registerRoutes(api: FastifyInstance, ctx: RouteContext): void {
  const {
    jobs,
    entries,
    executions,
    workDestinations,
    items,
    service,
    runner,
    notifier,
    events,
    history,
  } = ctx;
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
            path: { type: 'string', pattern: '^/', description: 'Absolute path' },
            apply: { type: 'boolean', default: false },
          },
        },
        response: { 202: jobSchema, 400: errorSchema, 401: errorSchema, 503: errorSchema },
      },
    },
    (request, reply) => {
      const job = jobs.create(request.body.path, request.body.apply ?? false);
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send(presentJob(job));
    },
  );

  api.get<{ Querystring: Pick<Paging, 'limit'> }>(
    '/api/jobs',
    {
      schema: {
        summary: 'List jobs, newest first',
        querystring: { type: 'object', properties: { limit: paging.limit } },
        response: { 200: { type: 'array', items: jobSchema }, 401: errorSchema },
      },
    },
    (request) => jobs.list(request.query.limit ?? 50).map(presentJob),
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

  api.get<{
    Params: { id: string };
    Querystring: Paging & { classification?: (typeof classificationValues)[number] };
  }>(
    '/api/jobs/:id/entries',
    {
      schema: {
        summary: 'The files of a job, page by page',
        params: idParams,
        querystring: {
          type: 'object',
          properties: {
            ...paging,
            classification: { type: 'string', enum: classificationValues },
          },
        },
        response: {
          200: { type: 'array', items: entrySchema },
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    (request, reply) => {
      if (!jobs.get(request.params.id)) {
        return reply.code(404).send({ error: { code: 'job.not-found' } });
      }
      const { classification, limit, offset } = request.query;
      return entries
        .list(request.params.id, {
          ...(classification && { classification }),
          limit: limit ?? 50,
          offset: offset ?? 0,
        })
        .map(presentEntry);
    },
  );

  api.get<{ Querystring: Paging & { state?: 'review' | 'unrecognized' } }>(
    '/api/arrivals',
    {
      schema: {
        summary: 'Files that wait for a destination or a choice',
        description:
          'What the arrival folders (and paths sent by hand) hold that Kinoshelf could not settle ' +
          'alone: `review` (candidates to choose from, a conflict, a failed transfer) and ' +
          '`unrecognized`. Each file says where it would go (`destination`, a remembered work ' +
          'winning over the default) and the libraries it could go to instead. `total` counts ' +
          'every file of the filter, for the badge of the navigation; `limit` and `offset` count releases.',
        querystring: {
          type: 'object',
          properties: { state: { type: 'string', enum: ['review', 'unrecognized'] }, ...paging },
        },
        response: { 200: arrivalsSchema, 401: errorSchema },
      },
    },
    (request) => {
      const { state, limit, offset } = request.query;
      const sources = service.arrivalFolders();
      const page = entries.arrivals({
        arrivalIds: sources.map(({ id }) => id),
        ...(state && { state }),
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      return {
        total: page.total,
        sources: sources.map(({ id, name, source }) => ({ id, name, path: source })),
        items: page.entries.map((entry) => presentArrival(entry, service, jobs)),
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
      return presentArrival(entry, service, jobs);
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
    Body: CandidateBody & { onlyThis?: boolean; libraryId?: string; rememberDestination?: boolean };
  }>(
    '/api/entries/:id/match',
    {
      schema: {
        summary: 'Validate a match',
        description:
          'Plans the file with a candidate returned by `GET /api/search`; it overrides the score. ' +
          'The file ends up `to-rename`, or in `conflict` if its target cannot be used. For ' +
          'a series, the other episodes of the same release follow the choice (not the ones set ' +
          'aside, `detached`, nor with `onlyThis`); `followers` lists them. ' +
          "`libraryId` sends the file to that library (of the work's kind) rather than to the " +
          'default one, for this file only; with `rememberDestination`, every later file of the ' +
          'work goes there alone. Without `libraryId`, a destination remembered for the work wins.',
        params: idParams,
        body: {
          ...matchBodySchema,
          properties: {
            ...matchBodySchema.properties,
            onlyThis: { type: 'boolean', description: 'Do not apply to the rest of the release' },
            libraryId: { type: 'string' },
            rememberDestination: { type: 'boolean', description: 'Defaults to false' },
          },
        },
        response: { 200: matchResultSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const { entry, followers } = await service.match(
        request.params.id,
        toCandidate(request.body),
        {
          ...(request.body.onlyThis !== undefined && { onlyThis: request.body.onlyThis }),
          ...(request.body.libraryId !== undefined && { libraryId: request.body.libraryId }),
          ...(request.body.rememberDestination !== undefined && {
            rememberDestination: request.body.rememberDestination,
          }),
        },
      );
      events.emit('arrivals', 'settings');
      return { ...(presentEntry(entry) as object), followers };
    },
  );

  api.post<{ Params: { id: string }; Body: CandidateBody & { libraryId?: string } }>(
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
          properties: { ...matchBodySchema.properties, libraryId: { type: 'string' } },
        },
        response: { 200: previewSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const item = await service.preview(
        request.params.id,
        toCandidate(request.body),
        request.body.libraryId,
      );
      return presentPlan(item);
    },
  );

  api.post<{ Params: { id: string }; Body?: { onlyThis?: boolean } }>(
    '/api/entries/:id/ignore',
    {
      preValidation: emptyBodyByDefault,
      schema: {
        summary: 'Set a file aside',
        description: 'The rest of its release goes with it, unless `onlyThis`.',
        params: idParams,
        body: { type: 'object', properties: { onlyThis: { type: 'boolean' } } },
        response: { 200: entrySchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request) => {
      const entry = service.ignore(request.params.id, {
        ...(request.body?.onlyThis !== undefined && { onlyThis: request.body.onlyThis }),
      });
      events.emit('arrivals');
      return presentEntry(entry);
    },
  );

  api.post<{ Params: { id: string }; Body?: { dryRun?: boolean; entries?: string[] } }>(
    '/api/plans/:id/execute',
    {
      preValidation: emptyBodyByDefault,
      schema: {
        summary: 'Execute the plan of a job',
        description:
          'The plan of a job is the set of its matched files not transferred yet; its id is the ' +
          "job's. With `dryRun`, every precondition is checked, nothing is written and the report " +
          'comes back at once (200). Otherwise the transfer is queued (202): poll the execution ' +
          'until it is `done` or `failed`. Transfers run one at a time: a request made while another ' +
          'is queued or running waits its turn. A destination that exists is never ' +
          'overwritten, and hardlink never falls back to copy.',
        params: idParams,
        body: {
          ...dryRunBody,
          properties: {
            ...dryRunBody.properties,
            entries: { type: 'array', items: { type: 'string' }, description: 'Only these files' },
          },
        },
        response: {
          200: executionReportSchema,
          202: executionSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const entryIds = request.body?.entries;
      if (request.body?.dryRun) {
        return service.dryRun(request.params.id, entryIds);
      }
      const execution = service.enqueue(request.params.id, entryIds);
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send(execution);
    },
  );

  api.get<{ Params: { id: string } }>(
    '/api/executions/:id',
    {
      schema: {
        summary: 'A queued transfer and how it went',
        description: 'What became of each file is on the file: see `GET /api/jobs/{id}/entries`.',
        params: idParams,
        response: { 200: executionSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    (request, reply) => {
      const execution = executions.get(request.params.id);
      return execution ?? reply.code(404).send({ error: { code: 'execution.not-found' } });
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
        limit: request.query.limit ?? 50,
        offset: request.query.offset ?? 0,
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

  api.get(
    '/api/work-destinations',
    {
      schema: {
        summary: 'The works Kinoshelf sends to a library alone',
        description:
          'What "Remember for this work" taught: a work tied to the library its files go to. ' +
          'A library that no longer exists is listed as such (`library` is null): its works go ' +
          'back to the default destination.',
        response: { 200: { type: 'array', items: workDestinationSchema }, 401: errorSchema },
      },
    },
    () =>
      workDestinations.list().map((stored) => {
        const work = items.workTitle(stored.kind, stored.tmdbId);
        return {
          ...stored,
          title: work?.title ?? null,
          year: work?.year ?? null,
          library: service.libraryName(stored.libraryId) ?? null,
        };
      }),
  );

  api.delete<{ Params: { kind: 'movie' | 'series'; tmdbId: number } }>(
    '/api/work-destinations/:kind/:tmdbId',
    {
      schema: {
        summary: 'Forget where a work goes',
        description: 'Its next files follow the default destination again.',
        params: {
          type: 'object',
          required: ['kind', 'tmdbId'],
          properties: {
            kind: { type: 'string', enum: ['movie', 'series'] },
            tmdbId: { type: 'integer' },
          },
        },
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    (request, reply) => {
      if (!workDestinations.remove(request.params.kind, request.params.tmdbId)) {
        return reply.code(404).send({ error: { code: 'work-destination.not-found' } });
      }
      events.emit('settings');
      return reply.code(204).send();
    },
  );

  api.post<{ Params: { id: string }; Body?: { dryRun?: boolean } }>(
    '/api/batches/:id/undo',
    {
      preValidation: emptyBodyByDefault,
      schema: {
        summary: 'Undo a batch',
        description:
          'Any batch not undone yet can be, not only the last (a move goes back where it came ' +
          'from). Each file is checked as it is now: whatever a later batch moved on or took ' +
          'the place of is skipped and reported, never forced.',
        params: idParams,
        body: dryRunBody,
        response: { 200: undoSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const dryRun = request.body?.dryRun ?? false;
      const report = await service.undo(request.params.id, { dryRun });
      if (!dryRun) {
        events.emit('history', 'arrivals');
      }
      return report;
    },
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
