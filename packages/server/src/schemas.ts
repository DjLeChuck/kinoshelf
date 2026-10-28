/** JSON Schemas of the API: they validate requests, shape responses and feed the OpenAPI file. */

const CLASSIFICATIONS = [
  'compliant',
  'to-rename',
  'conflict',
  'ambiguous',
  'unrecognized',
] as const;

const errorInfo = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string' },
    params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
  },
} as const;

export const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: errorInfo },
} as const;

export const healthSchema = {
  type: 'object',
  required: ['status', 'version'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    version: { type: 'string' },
  },
} as const;

export const summarySchema = {
  type: 'object',
  required: CLASSIFICATIONS,
  properties: Object.fromEntries(CLASSIFICATIONS.map((name) => [name, { type: 'integer' }])),
} as const;

/** A queued transfer: poll it until `done` or `failed`; the files show what became of each. */
export const executionSchema = {
  type: 'object',
  required: [
    'id',
    'jobId',
    'status',
    'createdAt',
    'startedAt',
    'finishedAt',
    'batchId',
    'summary',
    'error',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    jobId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    /** The batch to undo. A resumed execution keeps it: it spans what ran before the crash too. */
    batchId: { type: 'string', nullable: true },
    summary: {
      type: 'object',
      nullable: true,
      required: ['done', 'failed'],
      properties: { done: { type: 'integer' }, failed: { type: 'integer' } },
    },
    error: { ...errorInfo, nullable: true },
  },
} as const;

export const jobSchema = {
  type: 'object',
  required: [
    'id',
    'path',
    'status',
    'apply',
    'createdAt',
    'startedAt',
    'finishedAt',
    'error',
    'execution',
    'summary',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    path: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
    apply: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    error: { ...errorInfo, nullable: true },
    /** The latest transfer of this job (an `apply` job queues its own). */
    execution: { ...executionSchema, nullable: true },
    summary: { ...summarySchema, nullable: true },
  },
} as const;

const candidateProperties = {
  kind: { type: 'string', enum: ['movie', 'series'] },
  id: {
    type: 'object',
    required: ['provider', 'id'],
    properties: { provider: { type: 'string', enum: ['tmdb'] }, id: { type: 'integer' } },
  },
  title: { type: 'string' },
  originalTitle: { type: 'string' },
  year: { type: 'integer' },
  posterPath: { type: 'string' },
} as const;

/** What `GET /api/search` returns and `POST /api/queue/{id}/match` takes back. */
export const candidateSchema = {
  type: 'object',
  required: ['kind', 'id', 'title', 'originalTitle'],
  properties: {
    ...candidateProperties,
    alternativeTitles: { type: 'array', items: { type: 'string' } },
    overview: { type: 'string' },
    popularity: { type: 'number' },
    countries: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** The body of a manual match: only what the planner needs is required. */
export const matchBodySchema = {
  type: 'object',
  required: ['kind', 'id', 'title'],
  properties: candidateSchema.properties,
} as const;

export const entrySchema = {
  type: 'object',
  required: [
    'id',
    'jobId',
    'path',
    'classification',
    'resolution',
    'parsed',
    'reason',
    'candidates',
    'destination',
    'conflicts',
    'error',
    'batchId',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    jobId: { type: 'string', format: 'uuid' },
    path: { type: 'string' },
    classification: { type: 'string', enum: CLASSIFICATIONS },
    /** `done`: transferred. `failed`: the transfer did not go through. `ignored`: set aside. */
    resolution: { type: 'string', enum: ['done', 'failed', 'ignored'], nullable: true },
    parsed: {
      type: 'object',
      required: ['kind', 'episodes'],
      properties: {
        kind: { type: 'string' },
        title: { type: 'string' },
        year: { type: 'integer' },
        season: { type: 'integer' },
        episodes: { type: 'array', items: { type: 'integer' } },
      },
    },
    /** Why nothing was found (`no-title`, `no-candidates`), for `unrecognized` files. */
    reason: { type: 'string', nullable: true },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'id', 'title', 'originalTitle', 'score'],
        properties: { ...candidateProperties, score: { type: 'number' } },
      },
    },
    /** Where the video will go, once matched. */
    destination: { type: 'string', nullable: true },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reason', 'path', 'detail'],
        properties: {
          reason: { type: 'string' },
          path: { type: 'string' },
          detail: { ...errorInfo, nullable: true },
        },
      },
    },
    error: { ...errorInfo, nullable: true },
    batchId: { type: 'string', nullable: true },
  },
} as const;

/** What a dry run reports: every operation of the plan, checked and not run. */
export const executionReportSchema = {
  type: 'object',
  required: ['batchId', 'dryRun', 'items'],
  properties: {
    batchId: { type: 'string' },
    dryRun: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['entryId', 'results'],
        properties: {
          entryId: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'role', 'mode', 'source', 'destination', 'status', 'error'],
              properties: {
                type: { type: 'string', enum: ['transfer', 'write-file', 'download'] },
                role: { type: 'string', nullable: true },
                mode: { type: 'string', nullable: true },
                source: { type: 'string', nullable: true },
                destination: { type: 'string' },
                status: { type: 'string', enum: ['done', 'failed', 'skipped'] },
                error: { ...errorInfo, nullable: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const undoSchema = {
  type: 'object',
  required: ['batchId', 'dryRun', 'entries'],
  properties: {
    batchId: { type: 'string' },
    dryRun: { type: 'boolean' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source', 'destination', 'mode', 'status', 'error'],
        properties: {
          source: { type: 'string' },
          destination: { type: 'string' },
          mode: { type: 'string' },
          status: { type: 'string', enum: ['undone', 'skipped', 'failed'] },
          error: { ...errorInfo, nullable: true },
        },
      },
    },
  },
} as const;

export const paging = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
} as const;

export const classificationValues = CLASSIFICATIONS;
