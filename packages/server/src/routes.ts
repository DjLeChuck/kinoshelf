import type { Candidate, MovieCandidate, PlanItem, SeriesCandidate } from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { SCAN_TABS, type Entry, type EntryStore, type ScanTab } from './entries.js';
import type { EventBus } from './events.js';
import type { ExecutionStore } from './executions.js';
import type { History } from './history.js';
import type { Job, JobStore } from './jobs.js';
import type { JobRunner } from './runner.js';
import {
  batchDetailSchema,
  batchSummarySchema,
  candidateSchema,
  classificationValues,
  aliasSchema,
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
  scanFilesSchema,
  undoSchema,
} from './schemas.js';
import type { AliasStore } from './aliases.js';
import type { Notifier } from './notify/notifier.js';
import type { Service } from './service.js';

export interface RouteContext {
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly executions: ExecutionStore;
  readonly aliases: AliasStore;
  readonly service: Service;
  readonly runner: JobRunner;
  readonly notifier: Notifier;
  readonly events: EventBus;
  readonly history: History;
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
  };
}

/** The metadata files a plan writes beside the video: an NFO is generated, an image downloaded. */
interface PlannedExtra {
  readonly type: 'nfo' | 'image';
  readonly destination: string;
}

function plannedExtras(item: PlanItem | null): PlannedExtra[] {
  return (item?.operations ?? []).flatMap((op): PlannedExtra[] => {
    if (op.type === 'write-file') {
      return [{ type: 'nfo', destination: op.destination }];
    }
    return op.type === 'download' ? [{ type: 'image', destination: op.destination }] : [];
  });
}

/** One row of a scan: what the file is called now, where it goes, how sure the match is. */
function presentScanRow(entry: Entry): unknown {
  const plan = presentPlan(entry.item);
  return {
    id: entry.id,
    path: entry.path,
    classification: entry.classification,
    resolution: entry.resolution,
    // An organized file is where it should be.
    destination: entry.classification === 'compliant' ? entry.path : plan.destination,
    score: entry.candidates[0]?.score ?? null,
    title: entry.parsed.title ?? null,
    reason: entry.reason,
    candidates: entry.candidates,
    conflicts: plan.conflicts,
    extras: plannedExtras(entry.item),
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

/** A job as the API shows it: its row, a count of its files, its latest transfer, its settings. */
export function jobPresenter(
  ctx: Pick<RouteContext, 'jobs' | 'entries' | 'executions'>,
): (job: Job) => unknown {
  return (job) => ({
    ...job,
    summary: job.status === 'done' ? ctx.entries.summary(job.id) : null,
    execution: ctx.executions.latestOf(job.id) ?? null,
    settings: ctx.jobs.settings(job.id) ?? null,
  });
}

/** Thin HTTP layer: validate, call the store or the service, shape the answer. */
export function registerRoutes(api: FastifyInstance, ctx: RouteContext): void {
  const { jobs, entries, executions, aliases, service, runner, notifier, events, history } = ctx;
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

  api.get<{ Params: { id: string }; Querystring: Paging & { tab: ScanTab } }>(
    '/api/jobs/:id/files',
    {
      schema: {
        summary: 'The files of a scan, by tab',
        description:
          'The four views of a finished scan (plus `conflict`, a match whose target cannot be ' +
          'used): `rename` (matched with confidence, still to transfer), `ambiguous` (candidates ' +
          'to choose from), `unrecognized`, `compliant` (already named as the profile wants). A ' +
          'file leaves its tab once handled. `counts` gives every tab, for the tab labels. ' +
          'Transfer some of the `rename` files with `POST /api/plans/{id}/execute` and their `id`s ' +
          'in `entries`; ambiguous ones are settled with `POST /api/queue/{id}/match`. 409 ' +
          '`job.not-done` until the analysis finished.',
        params: idParams,
        querystring: {
          type: 'object',
          required: ['tab'],
          properties: { tab: { type: 'string', enum: SCAN_TABS }, ...paging },
        },
        response: { 200: scanFilesSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request, reply) => {
      const job = jobs.get(request.params.id);
      if (!job) {
        return reply.code(404).send({ error: { code: 'job.not-found' } });
      }
      if (job.status !== 'done') {
        return reply
          .code(409)
          .send({ error: { code: 'job.not-done', params: { status: job.status } } });
      }
      const { tab, limit, offset } = request.query;
      const counts = entries.tabCounts(job.id);
      return {
        tab,
        total: counts[tab],
        counts,
        files: entries
          .listTab(job.id, tab, { limit: limit ?? 50, offset: offset ?? 0 })
          .map(presentScanRow),
      };
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

  api.post<{ Params: { id: string }; Body: CandidateBody & { remember?: boolean } }>(
    '/api/queue/:id/match',
    {
      schema: {
        summary: 'Validate a match',
        description:
          'Plans the file with a candidate returned by `GET /api/search`; it overrides the score. ' +
          'The file ends up `to-rename`, or in `conflict` if its target cannot be used. Unless ' +
          '`remember` is false, the title of the file is tied to the candidate: later scans match ' +
          'it alone, and the files waiting in the queue under that title are matched too (an ' +
          'episode the work does not have stays in the queue). `rematched` counts those other files.',
        params: idParams,
        body: {
          ...matchBodySchema,
          properties: {
            ...matchBodySchema.properties,
            remember: { type: 'boolean', description: 'Defaults to true' },
          },
        },
        response: { 200: matchResultSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const { entry, rematched } = await service.match(
        request.params.id,
        toCandidate(request.body),
        { ...(request.body.remember !== undefined && { remember: request.body.remember }) },
      );
      events.emit('queue', 'settings');
      return { ...(presentEntry(entry) as object), rematched };
    },
  );

  api.post<{ Params: { id: string }; Body: CandidateBody }>(
    '/api/queue/:id/preview',
    {
      schema: {
        summary: 'Where a file would go with a candidate',
        description:
          'Plans the file like `match` does, and records nothing: the destination, and the ' +
          'conflicts that would send it back to the queue.',
        params: idParams,
        body: matchBodySchema,
        response: { 200: previewSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const item = await service.preview(request.params.id, toCandidate(request.body));
      return presentPlan(item);
    },
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
    (request) => {
      const entry = service.ignore(request.params.id);
      events.emit('queue');
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

  api.get<{ Querystring: Paging }>(
    '/api/batches',
    {
      schema: {
        summary: 'List executed batches, newest first',
        description:
          'Every batch of the journal, and the executions that moved nothing (`failed`). A batch ' +
          'made by the CLI is listed too, without an origin.',
        querystring: { type: 'object', properties: paging },
        response: { 200: { type: 'array', items: batchSummarySchema }, 401: errorSchema },
      },
    },
    (request) =>
      history.list({ limit: request.query.limit ?? 50, offset: request.query.offset ?? 0 }),
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
    '/api/aliases',
    {
      schema: {
        summary: 'The titles Kinoshelf remembers',
        description:
          'What validations in the queue taught: a title as files spell it, tied to a work. Later ' +
          'scans match such a file alone.',
        response: { 200: { type: 'array', items: aliasSchema }, 401: errorSchema },
      },
    },
    () => aliases.list(),
  );

  api.delete<{ Params: { id: number } }>(
    '/api/aliases/:id',
    {
      schema: {
        summary: 'Forget a title',
        description:
          'Files already matched keep their match; the next scan reads the title afresh.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    (request, reply) => {
      if (!aliases.remove(request.params.id)) {
        return reply.code(404).send({ error: { code: 'alias.not-found' } });
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
        events.emit('history', 'queue');
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
