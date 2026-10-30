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
    'libraryId',
    'status',
    'apply',
    'createdAt',
    'startedAt',
    'finishedAt',
    'error',
    'execution',
    'summary',
    'settings',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    path: { type: 'string' },
    /** The library this job scans, or a release of its watched folder. */
    libraryId: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
    apply: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    error: { ...errorInfo, nullable: true },
    /** The latest transfer of this job (an `apply` job queues its own). */
    execution: { ...executionSchema, nullable: true },
    summary: { ...summarySchema, nullable: true },
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

export const aliasSchema = {
  type: 'object',
  required: ['id', 'kind', 'title', 'work', 'createdAt'],
  properties: {
    id: { type: 'integer' },
    kind: { type: 'string', enum: ['movie', 'series'] },
    /** The title as files spell it. */
    title: { type: 'string' },
    /** Only for a film: the same title names several, told apart by year. */
    year: { type: 'integer' },
    work: {
      type: 'object',
      required: ['id', 'title'],
      properties: {
        id: candidateProperties.id,
        title: { type: 'string' },
        year: { type: 'integer' },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
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
          mode: { type: 'string' },
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

export const batchSummarySchema = {
  type: 'object',
  required: batchRequired,
  properties: batchProperties,
} as const;

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

export const paging = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
} as const;

export const classificationValues = CLASSIFICATIONS;

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
// `anyOf`, not `oneOf`: Ajv coerces types, and `oneOf` tries every branch, so a `null` reached the
// string one and became `""` (a library edited back to the default destination was refused).
const destination = {
  anyOf: [
    { type: 'null' },
    { type: 'string', minLength: 1 },
    {
      type: 'object',
      required: ['movies', 'series'],
      additionalProperties: false,
      properties: {
        movies: { type: 'string', minLength: 1 },
        series: { type: 'string', minLength: 1 },
      },
    },
  ],
} as const;

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
        required: ['id', 'target', 'format', 'on', 'headerNames'],
        properties: {
          id: { type: 'string', description: 'Names this webhook in a `PATCH`.' },
          target: {
            type: 'string',
            description: 'The origin only: the rest of a URL is a secret.',
          },
          format: { type: 'string', enum: webhookFormats },
          on: { type: 'array', items: { type: 'string', enum: webhookEvents } },
          headerNames: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    watch: {
      type: 'object',
      nullable: true,
      required: ['folders', 'settleSeconds', 'pollSeconds', 'apply'],
      properties: {
        folders: { type: 'array', items: { type: 'string' } },
        settleSeconds: { type: 'integer', nullable: true },
        pollSeconds: { type: 'integer', nullable: true },
        apply: { type: 'boolean' },
      },
    },
    processing: {
      type: 'object',
      required: ['profile', 'mode', 'threshold', 'destination'],
      properties: {
        profile: { type: 'string', nullable: true },
        mode: { type: 'string', enum: ['copy', 'hardlink', 'move'], nullable: true },
        threshold: { type: 'number', nullable: true },
        destination,
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
        url: { type: 'string', format: 'uri' },
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
        url: { type: 'string', format: 'uri' },
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
          url: { type: 'string', format: 'uri' },
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
        destination,
      },
    },
  },
} as const;

/** The entry as `match` returns it, with what remembering its title did to the other files. */
export const matchResultSchema = {
  ...entrySchema,
  required: [...entrySchema.required, 'rematched'],
  properties: {
    ...entrySchema.properties,
    /** Other files, waiting under the same title, that were matched and left the queue. */
    rematched: { type: 'integer' },
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

const scanTabs = ['rename', 'ambiguous', 'unrecognized', 'compliant', 'conflict'] as const;
export const scanTabValues = scanTabs;

/** Files per tab of a scan: handled files leave their tab (`renamed` counts the transferred). */
export const scanCountsSchema = {
  type: 'object',
  required: [...scanTabs, 'renamed'],
  properties: Object.fromEntries([...scanTabs, 'renamed'].map((tab) => [tab, { type: 'integer' }])),
} as const;

export const scanFilesSchema = {
  type: 'object',
  required: ['tab', 'total', 'counts', 'files'],
  properties: {
    tab: { type: 'string', enum: scanTabs },
    total: { type: 'integer', description: 'Files in this tab, for paging.' },
    counts: scanCountsSchema,
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'path',
          'classification',
          'resolution',
          'destination',
          'score',
          'title',
          'reason',
          'candidates',
          'conflicts',
          'extras',
          'error',
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Also what `entries` of an execution takes.',
          },
          path: { type: 'string' },
          classification: { type: 'string', enum: CLASSIFICATIONS },
          resolution: entrySchema.properties.resolution,
          /** Where the video goes (`rename`); its own path once `compliant`; null otherwise. */
          destination: { type: 'string', nullable: true },
          /** Score of the best candidate (0-100), null when there is none. */
          score: { type: 'number', nullable: true },
          /** What the file name says, for a row without a candidate. */
          title: { type: 'string', nullable: true },
          reason: entrySchema.properties.reason,
          candidates: entrySchema.properties.candidates,
          conflicts: entrySchema.properties.conflicts,
          /** The NFO and images the plan writes beside the video, none when the profile has none. */
          extras: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'destination'],
              properties: {
                type: { type: 'string', enum: ['nfo', 'image'] },
                destination: { type: 'string' },
              },
            },
          },
          error: entrySchema.properties.error,
        },
      },
    },
  },
} as const;

const libraryDestinationSchema = {
  oneOf: [
    { type: 'string', minLength: 1 },
    {
      type: 'object',
      required: ['movies', 'series'],
      additionalProperties: false,
      properties: {
        movies: { type: 'string', minLength: 1 },
        series: { type: 'string', minLength: 1 },
      },
    },
  ],
} as const;

const libraryModes = ['copy', 'hardlink', 'move'] as const;

export const librarySchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'source',
    'destination',
    'profile',
    'mode',
    'threshold',
    'watch',
    'lastScan',
    'queued',
    'scanning',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    source: { type: 'string' },
    /** Unset: follows the global destination. */
    destination,
    /** Unset (null): follows the global profile, mode and threshold. */
    profile: { type: 'string', nullable: true },
    mode: { type: 'string', enum: [...libraryModes, null], nullable: true },
    threshold: { type: 'number', nullable: true },
    watch: { type: 'boolean' },
    lastScan: {
      type: 'object',
      nullable: true,
      required: ['jobId', 'status', 'finishedAt', 'counts'],
      properties: {
        jobId: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
        finishedAt: { type: 'string', format: 'date-time', nullable: true },
        counts: scanCountsSchema,
      },
    },
    /** Jobs of this library queued or running (scans, releases of its watched folder). */
    queued: { type: 'integer' },
    /** A scan of the whole source is queued or running. */
    scanning: { type: 'boolean' },
  },
} as const;

const libraryFields = {
  name: { type: 'string', minLength: 1 },
  source: { type: 'string', pattern: '^/' },
  destination: libraryDestinationSchema,
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
    destination,
    profile: nullable(libraryFields.profile),
    mode: nullable(libraryFields.mode),
    threshold: nullable(libraryFields.threshold),
    watch: libraryFields.watch,
  },
} as const;
