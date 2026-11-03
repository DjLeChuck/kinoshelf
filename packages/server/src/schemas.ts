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

const summarySchema = {
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

/** Where a running analysis is; held in memory, so absent once it ends (or before it starts). */
export const progressSchema = {
  type: 'object',
  nullable: true,
  required: ['phase', 'found', 'done', 'total', 'current', 'idleSeconds'],
  properties: {
    phase: { type: 'string', enum: ['discover', 'identify', 'plan'] },
    /** Videos found so far. */
    found: { type: 'integer' },
    /** Files matched, out of `total` (known once the walk of the folder is over). */
    done: { type: 'integer' },
    total: { type: 'integer' },
    /** The last file matched, relative to the folder. */
    current: { type: 'string', nullable: true },
    /** Seconds since anything moved, for a message such as "still running". */
    idleSeconds: { type: 'integer' },
  },
} as const;

export const jobSchema = {
  type: 'object',
  required: [
    'id',
    'path',
    'libraryId',
    'status',
    'apply',
    'startedAt',
    'finishedAt',
    'error',
    'execution',
    'summary',
    'settings',
    'progress',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    path: { type: 'string' },
    /** The library this job scans, or a release of its watched folder. */
    libraryId: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
    apply: { type: 'boolean' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    error: { ...errorInfo, nullable: true },
    /** The latest transfer of this job (an `apply` job queues its own). */
    execution: { ...executionSchema, nullable: true },
    summary: { ...summarySchema, nullable: true },
    progress: progressSchema,
    /** What the plan was built with; only an analysis that finished has it. */
    settings: {
      type: 'object',
      nullable: true,
      required: ['profile', 'mode', 'destinationRoot'],
      properties: {
        profile: { type: 'string' },
        mode: { type: 'string', enum: ['copy', 'hardlink', 'move'] },
        destinationRoot: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              required: ['movie', 'series'],
              properties: { movie: { type: 'string' }, series: { type: 'string' } },
            },
          ],
        },
      },
    },
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

/** What `GET /api/search` returns and `POST /api/entries/{id}/match` takes back. */
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

export const folderListingSchema = {
  type: 'object',
  required: ['path', 'parent', 'entries', 'truncated'],
  properties: {
    path: { type: 'string' },
    parent: { type: 'string', nullable: true },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'kind'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['directory', 'file'] },
        },
      },
    },
    truncated: { type: 'boolean' },
  },
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
    'release',
    'cluster',
    'detached',
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
    release: { type: 'string', nullable: true },
    cluster: { type: 'integer' },
    detached: { type: 'boolean' },
  },
} as const;

/** Where a file would go, and what would stop it. */
export const previewSchema = {
  type: 'object',
  required: ['destination', 'conflicts'],
  properties: {
    destination: entrySchema.properties.destination,
    conflicts: entrySchema.properties.conflicts,
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
          mode: { type: 'string', enum: ['copy', 'hardlink', 'move'] },
          status: { type: 'string', enum: ['undone', 'skipped', 'failed'] },
          error: { ...errorInfo, nullable: true },
        },
      },
    },
  },
} as const;

const batchProperties = {
  /** The batch id for a batch that transferred something; the execution's for one that did not. */
  id: { type: 'string' },
  at: { type: 'string', format: 'date-time' },
  status: {
    type: 'string',
    enum: ['done', 'undone', 'failed'],
    description: '`failed`: nothing was transferred, so there is nothing to undo.',
  },
  operations: { type: 'integer', description: 'Transfers recorded in the journal.' },
  modes: { type: 'array', items: { type: 'string', enum: ['copy', 'hardlink', 'move'] } },
  failed: { type: 'integer', description: 'Files that did not go through.' },
  origin: {
    type: 'object',
    nullable: true,
    required: ['jobId', 'path'],
    properties: { jobId: { type: 'string' }, path: { type: 'string' } },
    description: 'The job that made the batch; absent for a batch made by the CLI.',
  },
  error: { ...errorInfo, nullable: true },
} as const;

const batchRequired = ['id', 'at', 'status', 'operations', 'modes', 'failed', 'origin', 'error'];

export const batchDetailSchema = {
  type: 'object',
  required: [...batchRequired, 'items', 'extras'],
  properties: {
    ...batchProperties,
    /** What was written beside the videos: generated NFO and downloaded images. */
    extras: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'destination'],
        properties: {
          kind: { type: 'string', enum: ['generated', 'downloaded'] },
          destination: { type: 'string' },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source', 'destination', 'mode', 'status', 'error'],
        properties: {
          source: { type: 'string' },
          destination: { type: 'string', nullable: true },
          mode: { type: 'string', enum: ['copy', 'hardlink', 'move'] },
          status: { type: 'string', enum: ['done', 'undone', 'failed'] },
          error: { ...errorInfo, nullable: true },
        },
      },
    },
  },
} as const;

/** A line of the history: a batch, or a job that has none. */
export const activitySchema = {
  type: 'object',
  required: [
    'id',
    'kind',
    'at',
    'status',
    'path',
    'operations',
    'failed',
    'modes',
    'error',
    'routine',
  ],
  properties: {
    id: {
      type: 'string',
      description: '`GET /api/batches/{id}` for a `batch`, `GET /api/jobs/{id}` for a `job`.',
    },
    kind: { type: 'string', enum: ['batch', 'job'] },
    at: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['queued', 'running', 'done', 'undone', 'failed'] },
    path: {
      type: 'string',
      nullable: true,
      description: 'What was submitted; absent for the CLI.',
    },
    operations: { type: 'integer' },
    failed: { type: 'integer' },
    modes: { type: 'array', items: { type: 'string', enum: ['copy', 'hardlink', 'move'] } },
    error: { ...errorInfo, nullable: true },
    routine: {
      type: 'boolean',
      description:
        'A job that finished and moved nothing: only listed with `all`, never deleted by it.',
    },
  },
} as const;

/**
 * The most files or items one request may name: well under SQLite's limit on query parameters,
 * well over what a page offers to pick.
 */
export const MAX_SELECTION = 5000;

/** Where a notification goes: plain web addresses only, never `file:`, `ftp:` or the like. */
const httpUrl = { type: 'string', format: 'uri', pattern: '^https?://' } as const;

export const paging = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
} as const;

/** A page of a list, as a route's handler reads it: validation fills in the defaults above. */
export interface Paging {
  readonly limit: number;
  readonly offset: number;
}

/** One entry per target; a URL is shown without its secret part. */
export const notificationTestSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['target', 'kind', 'ok'],
    properties: {
      target: { type: 'string' },
      kind: { type: 'string', enum: ['webhook', 'plex', 'jellyfin'] },
      ok: { type: 'boolean' },
      status: { type: 'integer' },
      error: { type: 'string' },
    },
  },
} as const;

/** An `enum` must list `null` itself, or Ajv refuses it though the schema says nullable. */
const nullable = <T extends object>(schema: T) => {
  const choices: unknown[] | undefined =
    'enum' in schema && Array.isArray(schema.enum) ? (schema.enum as unknown[]) : undefined;
  return { ...schema, nullable: true, ...(choices && { enum: [...choices, null] }) } as const;
};
const pathMappings = {
  type: 'array',
  items: {
    type: 'object',
    required: ['from', 'to'],
    additionalProperties: false,
    properties: { from: { type: 'string', minLength: 1 }, to: { type: 'string', minLength: 1 } },
  },
} as const;
const webhookFormats = ['generic', 'gotify', 'ntfy', 'discord'] as const;
const webhookEvents = ['transferred', 'failed', 'needs-review'] as const;

/** What `GET /api/settings` returns: secrets are only ever reported as set or not. */
export const settingsSchema = {
  type: 'object',
  required: [
    'tmdb',
    'locale',
    'plex',
    'jellyfin',
    'webhooks',
    'watch',
    'processing',
    'apiKey',
    'profiles',
  ],
  properties: {
    tmdb: {
      type: 'object',
      required: ['configured', 'source', 'language'],
      properties: {
        configured: { type: 'boolean' },
        source: { type: 'string', enum: ['env', 'file'], nullable: true },
        language: { type: 'string', nullable: true },
      },
    },
    locale: { type: 'string', enum: ['en', 'fr'], nullable: true },
    plex: {
      type: 'object',
      nullable: true,
      required: ['url', 'section', 'tokenConfigured', 'paths'],
      properties: {
        url: { type: 'string' },
        section: { type: 'integer', nullable: true },
        tokenConfigured: { type: 'boolean' },
        paths: pathMappings,
      },
    },
    jellyfin: {
      type: 'object',
      nullable: true,
      required: ['url', 'tokenConfigured', 'paths'],
      properties: {
        url: { type: 'string' },
        tokenConfigured: { type: 'boolean' },
        paths: pathMappings,
      },
    },
    webhooks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'target', 'format', 'on'],
        properties: {
          id: { type: 'string', description: 'Names this webhook in a `PATCH`.' },
          target: {
            type: 'string',
            description: 'The origin only: the rest of a URL is a secret.',
          },
          format: { type: 'string', enum: webhookFormats },
          on: { type: 'array', items: { type: 'string', enum: webhookEvents } },
        },
      },
    },
    watch: {
      type: 'object',
      nullable: true,
      required: ['settleSeconds', 'pollSeconds', 'apply'],
      properties: {
        settleSeconds: { type: 'integer', nullable: true },
        pollSeconds: { type: 'integer', nullable: true },
        apply: { type: 'boolean' },
      },
    },
    processing: {
      type: 'object',
      required: ['profile', 'mode', 'threshold'],
      properties: {
        profile: { type: 'string', nullable: true },
        mode: { type: 'string', enum: ['copy', 'hardlink', 'move'], nullable: true },
        threshold: { type: 'number', nullable: true },
      },
    },
    profiles: {
      type: 'array',
      description: 'The profiles shipped with Kinoshelf; `processing.profile` may also be a path.',
      items: {
        type: 'object',
        required: ['id', 'name', 'example'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          example: {
            type: 'object',
            description: 'A movie and an episode path as the profile would write them.',
            required: ['movie', 'series'],
            properties: { movie: { type: 'string' }, series: { type: 'string' } },
          },
        },
      },
    },
    apiKey: {
      type: 'object',
      required: ['source'],
      properties: {
        source: {
          type: 'string',
          enum: ['env', 'database'],
          nullable: true,
          description: 'Where the key comes from. It cannot be read back, only replaced.',
        },
      },
    },
  },
} as const;

/** `null` removes a value, a value sets it, an absent key keeps what is there. */
export const settingsPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tmdb: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apiKey: nullable({ type: 'string', minLength: 1 }),
        language: nullable({ type: 'string', minLength: 2 }),
      },
    },
    locale: nullable({ type: 'string', enum: ['en', 'fr'] }),
    plex: nullable({
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: httpUrl,
        section: nullable({ type: 'integer', minimum: 1 }),
        token: nullable({ type: 'string', minLength: 1 }),
        paths: nullable(pathMappings),
      },
    }),
    jellyfin: nullable({
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: httpUrl,
        token: nullable({ type: 'string', minLength: 1 }),
        paths: nullable(pathMappings),
      },
    }),
    webhooks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          url: httpUrl,
          format: nullable({ type: 'string', enum: webhookFormats }),
          on: nullable({
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: webhookEvents },
          }),
          headers: nullable({ type: 'object', additionalProperties: { type: 'string' } }),
        },
      },
    },
    watch: nullable({
      type: 'object',
      additionalProperties: false,
      properties: {
        settleSeconds: nullable({ type: 'integer', minimum: 0 }),
        pollSeconds: nullable({ type: 'integer', minimum: 0 }),
        apply: nullable({ type: 'boolean' }),
      },
    }),
    processing: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: nullable({ type: 'string', minLength: 1 }),
        mode: nullable({ type: 'string', enum: ['copy', 'hardlink', 'move'] }),
        threshold: nullable({ type: 'number', minimum: 0, maximum: 100 }),
      },
    },
  },
} as const;

/** The entry as `match` returns it, with how many other episodes of its release followed. */
export const matchResultSchema = {
  ...entrySchema,
  required: [...entrySchema.required, 'followers'],
  properties: {
    ...entrySchema.properties,
    /** Other episodes of the release that followed the choice. */
    followers: { type: 'array', items: { type: 'string' } },
  },
} as const;

const onboardingStepId = {
  type: 'string',
  enum: ['tmdb', 'server', 'destination', 'source'],
} as const;

export const onboardingSchema = {
  type: 'object',
  required: ['completed', 'steps'],
  properties: {
    completed: {
      type: 'boolean',
      description: 'The welcome page is over: the user left it, or the install already did work.',
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'state', 'auto'],
        properties: {
          id: onboardingStepId,
          state: { type: 'string', enum: ['todo', 'done', 'skipped'] },
          auto: { type: 'boolean', description: 'Done because the configuration says so.' },
        },
      },
    },
  },
} as const;

export const onboardingPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    step: onboardingStepId,
    state: nullable({ type: 'string', enum: ['done', 'skipped'] }),
    finished: { type: 'boolean', enum: [true] },
  },
  anyOf: [{ required: ['step', 'state'] }, { required: ['finished'] }],
} as const;

export const arrivalsSchema = {
  type: 'object',
  required: ['total', 'sources', 'items'],
  properties: {
    total: {
      type: 'integer',
      description: 'Files of this filter, for the badge. Paging counts releases.',
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'path'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' } },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'jobId',
          'path',
          'file',
          'release',
          'cluster',
          'detached',
          'state',
          'kind',
          'resolution',
          'title',
          'year',
          'sourceId',
          'destination',
          'destinationOptions',
          'reason',
          'candidates',
          'conflicts',
          'error',
        ],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'The entry: `/api/entries/{id}/…`.' },
          jobId: { type: 'string', format: 'uuid' },
          path: { type: 'string' },
          file: { type: 'string', description: 'The name of the file.' },
          release: {
            type: 'string',
            nullable: true,
            description:
              'The folder (or file) it came in. A series of that folder is validated as one: ' +
              'the files sharing `release` and `cluster`.',
          },
          cluster: {
            type: 'integer',
            description: 'Which series of the folder: 0 is the main one, 1 and up are the others.',
          },
          detached: {
            type: 'boolean',
            description: 'Another series than the main one of the folder (`cluster` above 0).',
          },
          state: { type: 'string', enum: ['review', 'unrecognized'] },
          kind: { type: 'string', enum: ['movie', 'series'], nullable: true },
          /** The picture size the name announces (`2160p`), null when it says none. */
          resolution: { type: 'string', nullable: true },
          /** The title and year the parser read, which the manual search starts from. */
          title: { type: 'string', nullable: true },
          year: { type: 'integer', nullable: true },
          /** The arrival folder it came from; null for a path sent by hand. */
          sourceId: { type: 'string', nullable: true },
          destination: {
            type: 'object',
            required: ['libraryId'],
            properties: {
              libraryId: { type: 'string', nullable: true },
            },
          },
          /** The libraries it could go to: its kind's, or all of them when the kind is unknown. */
          destinationOptions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name'],
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
          },
          reason: entrySchema.properties.reason,
          candidates: entrySchema.properties.candidates,
          /** What stops it from going there. */
          conflicts: entrySchema.properties.conflicts,
          error: entrySchema.properties.error,
        },
      },
    },
  },
} as const;

const libraryKinds = ['movie', 'series'] as const;

export const libraryItemSchema = {
  type: 'object',
  required: [
    'id',
    'path',
    'state',
    'kind',
    'title',
    'year',
    'tmdbId',
    'season',
    'episode',
    'episodeEnd',
    'resolution',
    'nfo',
    'poster',
    'fanart',
    'entryId',
  ],
  properties: {
    id: {
      type: 'string',
      description: 'Stable for a path: `GET /api/libraries/{id}/items/{itemId}`.',
    },
    path: { type: 'string' },
    state: { type: 'string', enum: ['review', 'rename', 'unrecognized', 'incomplete', 'ok'] },
    kind: { type: 'string', enum: [...libraryKinds, null], nullable: true },
    title: {
      type: 'string',
      nullable: true,
      description: 'The official title; the file name’s when nothing matched.',
    },
    year: { type: 'integer', nullable: true },
    tmdbId: { type: 'integer', nullable: true },
    season: { type: 'integer', nullable: true, description: 'Series only.' },
    episode: { type: 'integer', nullable: true, description: 'Series only: the first episode.' },
    episodeEnd: {
      type: 'integer',
      nullable: true,
      description: 'The last episode of a file holding several; `null` for a single one.',
    },
    resolution: {
      type: 'string',
      nullable: true,
      description: 'Read in the file name, e.g. `1080p`.',
    },
    nfo: {
      type: 'boolean',
      nullable: true,
      description: '`null`: the profile writes none, or it cannot be told.',
    },
    poster: { type: 'boolean', nullable: true },
    fanart: { type: 'boolean', nullable: true },
    entryId: { type: 'string', nullable: true, description: 'To validate or change the match.' },
  },
} as const;

const presenceDescription = (file: string): string =>
  `${file} is on the disk. \`null\`: the profile does not write it, or no scan or change has looked yet.`;

export const showSchema = {
  type: 'object',
  required: [
    'tmdbId',
    'title',
    'year',
    'seasons',
    'episodes',
    'missing',
    'rename',
    'refresh',
    'nfo',
    'poster',
    'fanart',
  ],
  properties: {
    tmdbId: { type: 'integer' },
    title: { type: 'string', nullable: true },
    year: { type: 'integer', nullable: true },
    seasons: { type: 'integer', description: 'Seasons the library holds files of.' },
    episodes: { type: 'integer', description: 'Episodes the files hold (a range counts each).' },
    missing: {
      type: 'integer',
      nullable: true,
      description: 'Aired episodes no file holds, as last counted; `null` until it was.',
    },
    rename: { type: 'integer', description: 'Episodes whose video is to rename.' },
    refresh: { type: 'integer', description: 'Episodes lacking an NFO or an image of their own.' },
    nfo: { type: 'boolean', nullable: true, description: presenceDescription('`tvshow.nfo`') },
    poster: {
      type: 'boolean',
      nullable: true,
      description: presenceDescription('The show poster'),
    },
    fanart: {
      type: 'boolean',
      nullable: true,
      description: presenceDescription('The show fanart'),
    },
  },
} as const;

export const seasonSchema = {
  type: 'object',
  required: ['season', 'name', 'posterPath', 'poster', 'missing', 'episodes'],
  properties: {
    season: { type: 'integer', description: '0 is the specials.' },
    name: { type: 'string', nullable: true },
    posterPath: { type: 'string', nullable: true },
    poster: {
      type: 'boolean',
      nullable: true,
      description: presenceDescription('The season poster'),
    },
    missing: { type: 'integer', description: 'Always 0 for the specials.' },
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['season', 'episode', 'title', 'airDate', 'state', 'item'],
        properties: {
          season: { type: 'integer' },
          episode: { type: 'integer' },
          title: { type: 'string', nullable: true },
          airDate: { type: 'string', nullable: true },
          state: { type: 'string', enum: ['present', 'missing', 'unaired', 'extra'] },
          item: { ...libraryItemSchema, nullable: true },
        },
      },
    },
  },
} as const;

const libraryModes = ['copy', 'hardlink', 'move'] as const;
const libraryInto = {
  type: 'object',
  required: ['movie', 'series'],
  additionalProperties: false,
  properties: { movie: { type: 'string', minLength: 1 }, series: { type: 'string', minLength: 1 } },
} as const;

export const librarySchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'source',
    'type',
    'into',
    'profile',
    'mode',
    'threshold',
    'watch',
    'lastScan',
    'scanning',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    source: { type: 'string' },
    /** A library organized in place has a type; an arrival folder has `into` instead. */
    type: { type: 'string', enum: [...libraryKinds, null], nullable: true },
    /** Arrival folder: the typed libraries its releases go to by default. */
    into: { ...libraryInto, nullable: true },
    /** Unset (null): follows the global profile, mode and threshold. */
    profile: { type: 'string', nullable: true },
    mode: { type: 'string', enum: [...libraryModes, null], nullable: true },
    threshold: { type: 'number', nullable: true },
    watch: { type: 'boolean' },
    lastScan: {
      type: 'object',
      nullable: true,
      required: ['jobId', 'status'],
      properties: {
        jobId: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
      },
    },
    /** A scan of the whole source is queued or running. */
    scanning: { type: 'boolean' },
  },
} as const;

const libraryFields = {
  name: { type: 'string', minLength: 1 },
  source: { type: 'string', pattern: '^/' },
  type: { type: 'string', enum: libraryKinds },
  into: libraryInto,
  profile: { type: 'string', minLength: 1 },
  mode: { type: 'string', enum: libraryModes },
  threshold: { type: 'number', minimum: 0, maximum: 100 },
  watch: { type: 'boolean' },
} as const;

export const libraryCreateSchema = {
  type: 'object',
  required: ['name', 'source'],
  additionalProperties: false,
  properties: libraryFields,
} as const;

/** `null` removes an optional field (the library follows the global setting again). */
export const libraryPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: libraryFields.name,
    source: libraryFields.source,
    type: libraryFields.type,
    into: nullable(libraryFields.into),
    profile: nullable(libraryFields.profile),
    mode: nullable(libraryFields.mode),
    threshold: nullable(libraryFields.threshold),
    watch: libraryFields.watch,
  },
} as const;

/** A dry run of a selection: the report of `executionReportSchema`, and what could not be planned. */
export const selectionReportSchema = {
  ...executionReportSchema,
  required: [...executionReportSchema.required, 'skipped'],
  properties: {
    ...executionReportSchema.properties,
    skipped: {
      type: 'array',
      items: { type: 'string' },
      description: 'Items of the selection with nothing to do (already done, or not scanned).',
    },
  },
} as const;

export const selectionRunSchema = {
  type: 'object',
  required: ['executions', 'skipped'],
  properties: {
    executions: { type: 'array', items: executionSchema },
    skipped: selectionReportSchema.properties.skipped,
  },
} as const;
