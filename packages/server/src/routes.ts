import type { Candidate, MovieCandidate, SeriesCandidate } from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import type { Entry, EntryStore } from './entries.js';
import type { ExecutionStore } from './executions.js';
import type { Job, JobStore } from './jobs.js';
import type { JobRunner } from './runner.js';
import {
  candidateSchema,
  classificationValues,
  entrySchema,
  errorSchema,
  executionReportSchema,
  executionSchema,
  jobSchema,
  matchBodySchema,
  notificationTestSchema,
  paging,
  undoSchema,
} from './schemas.js';
import type { Notifier } from './notify/notifier.js';
import type { Service } from './service.js';

export interface RouteContext {
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly executions: ExecutionStore;
  readonly service: Service;
  readonly runner: JobRunner;
  readonly notifier: Notifier;
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

function presentEntry(entry: Entry): unknown {
  const main = entry.item?.operations.find((op) => op.type === 'transfer' && op.role === 'main');
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
    destination: main?.destination ?? null,
    conflicts: (entry.item?.conflicts ?? []).map((conflict) => ({
      reason: conflict.reason,
      path: conflict.path,
      detail: conflict.detail ?? null,
    })),
    error: entry.error,
    batchId: entry.batchId,
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

/** Thin HTTP layer: validate, call the store or the service, shape the answer. */
export function registerRoutes(api: FastifyInstance, ctx: RouteContext): void {
  const { jobs, entries, executions, service, runner, notifier } = ctx;
  const presentJob = (job: Job): unknown => {
    const latest = executions.latestOf(job.id);
    return {
      ...job,
      summary: job.status === 'done' ? entries.summary(job.id) : null,
      execution: latest ?? null,
    };
  };
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

  api.get<{ Querystring: Paging }>(
    '/api/queue',
    {
      schema: {
        summary: 'Files waiting for a human decision',
        description:
          'Ambiguous, unrecognized and conflicting files, and files whose transfer failed.',
        querystring: { type: 'object', properties: paging },
        response: { 200: { type: 'array', items: entrySchema }, 401: errorSchema },
      },
    },
    (request) =>
      entries
        .queue({ limit: request.query.limit ?? 50, offset: request.query.offset ?? 0 })
        .map(presentEntry),
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

  api.post<{ Params: { id: string }; Body: CandidateBody }>(
    '/api/queue/:id/match',
    {
      schema: {
        summary: 'Validate a match',
        description:
          'Plans the file with a candidate returned by `GET /api/search`; it overrides the score. ' +
          'The file ends up `to-rename`, or in `conflict` if its target cannot be used.',
        params: idParams,
        body: matchBodySchema,
        response: { 200: entrySchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) =>
      presentEntry(await service.match(request.params.id, toCandidate(request.body))),
  );

  api.post<{ Params: { id: string } }>(
    '/api/queue/:id/ignore',
    {
      schema: {
        summary: 'Set a file aside',
        params: idParams,
        response: { 200: entrySchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request) => presentEntry(service.ignore(request.params.id)),
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
          'until it is `done` or `failed`. One at a time per job: another request while one is ' +
          'queued or running is refused (409 `job.busy`). A destination that exists is never ' +
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
    (request) => service.undo(request.params.id, { dryRun: request.body?.dryRun ?? false }),
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
