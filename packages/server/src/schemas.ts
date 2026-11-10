/** JSON Schemas of the API: they validate requests, shape responses and feed the OpenAPI file. */
import { METADATAS, NAMINGS } from '@kinoshelf/core';
import { HDR_FORMATS } from './probe.js';

const namings = NAMINGS;
const metadatas = METADATAS;

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

/** Files settled out of the files a running transfer goes through; null when it does not run. */
export const transferProgressSchema = {
  type: 'object',
  nullable: true,
  required: ['done', 'total', 'current'],
  properties: {
    done: { type: 'integer' },
    total: { type: 'integer' },
    /** The source of the last file settled. */
    current: { type: 'string', nullable: true },
  },
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
    /** Where a running transfer is; only `GET /api/jobs/{id}` fills it. */
    progress: transferProgressSchema,
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
    phase: { type: 'string', enum: ['discover', 'read', 'identify', 'plan'] },
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
    /** While the job waits its turn: the transfer in front of it, if that is what it waits for. */
    transfer: transferProgressSchema,
    /** What the plan was built with; only an analysis that finished has it. */
    settings: {
      type: 'object',
      nullable: true,
      required: ['profile', 'mode', 'destinationRoot'],
      properties: {
        profile: {
          type: 'object',
          required: ['naming', 'metadata'],
          properties: {
            naming: { type: 'string', enum: [...namings] },
            metadata: { type: 'string', enum: [...metadatas] },
          },
        },
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

/** A picture size as a release names it: `2160p`, `1080p`, `1080i`. */
export const sizeSchema = { type: 'string', pattern: '^[0-9]{3,4}[pi]$' } as const;

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
  required: ['destination', 'conflicts', 'folder'],
  properties: {
    destination: entrySchema.properties.destination,
    conflicts: entrySchema.properties.conflicts,
    folder: {
      type: 'string',
      nullable: true,
      description:
        'The folder of the series when several episodes of a release go along with this one: ' +
        'the destination alone would stand for one of them.',
    },
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
    enum: ['queued', 'running', 'done', 'undone', 'failed'],
    description:
      '`queued`/`running`: its transfer is not over. `failed`: nothing was transferred, so there is nothing to undo.',
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
          kind: { type: 'string', enum: ['generated', 'downloaded', 'replaced'] },
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
    'plexAccount',
    'plex',
    'jellyfin',
    'webhooks',
    'watch',
    'processing',
    'apiKey',
    'namingExamples',
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
    plexAccount: { type: 'string', enum: ['signed-in', 'expired'], nullable: true },
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
      required: [
        'naming',
        'metadata',
        'mode',
        'threshold',
        'detectPictureSize',
        'allowLocalImageUrls',
      ],
      properties: {
        naming: { type: 'string', enum: [...namings, null], nullable: true },
        metadata: { type: 'string', enum: [...metadatas, null], nullable: true },
        mode: { type: 'string', enum: ['copy', 'hardlink', 'move'], nullable: true },
        threshold: { type: 'number', nullable: true },
        detectPictureSize: { type: 'boolean' },
        allowLocalImageUrls: { type: 'boolean' },
      },
    },
    namingExamples: {
      type: 'object',
      description: 'A movie and an episode path as each naming would write them.',
      required: [...namings],
      properties: Object.fromEntries(
        namings.map((naming) => [
          naming,
          {
            type: 'object',
            required: ['movie', 'series'],
            properties: { movie: { type: 'string' }, series: { type: 'string' } },
          },
        ]),
      ),
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
        naming: nullable({ type: 'string', enum: namings }),
        metadata: nullable({ type: 'string', enum: metadatas }),
        mode: nullable({ type: 'string', enum: ['copy', 'hardlink', 'move'] }),
        threshold: nullable({ type: 'number', minimum: 0, maximum: 100 }),
        // On unless turned off: `null` goes back to that default.
        detectPictureSize: nullable({ type: 'boolean' }),
        // Off unless turned on: `null` goes back to that default.
        allowLocalImageUrls: nullable({ type: 'boolean' }),
      },
    },
  },
} as const;

/** The entry as `match` returns it, with how many other episodes of its release followed. */
export const matchStateSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['running', 'done', 'failed'] },
    /** Files whose metadata is loaded, out of `total`: while `running`. */
    done: { type: 'integer' },
    total: { type: 'integer' },
    current: { type: 'string', nullable: true },
    /** Other episodes of the release that followed the choice: when `done`. */
    followers: { type: 'array', items: { type: 'string' } },
    /** The file as the choice left it (`to-rename` or `conflict`): when `done`. */
    entry: entrySchema,
    /** Why it failed, as an error response carries it: when `failed`. */
    error: errorSchema.properties.error,
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
          state: { type: 'string', enum: ['ready', 'review', 'unrecognized'] },
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
    'logo',
    'thumb',
    'unavailable',
    'entryId',
    'release',
    'cluster',
    'releaseFiles',
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
    logo: { type: 'boolean', nullable: true },
    thumb: {
      type: 'boolean',
      nullable: true,
      description: 'An episode’s own image, `<file>.jpg`; `null` for any other file.',
    },
    unavailable: {
      type: 'array',
      items: { type: 'string', enum: ['poster', 'fanart', 'logo'] },
      description:
        'Movie images the profile writes that TMDB has none of (and the disk neither): their flag ' +
        'above reads as there, since nothing is missing, but the list shows them as unavailable.',
    },
    entryId: { type: 'string', nullable: true, description: 'To validate or change the match.' },
    release: {
      type: 'string',
      nullable: true,
      description:
        'The folder the file came in: files sharing it (and its `cluster`) are validated together. ' +
        'Filled by the list of items only.',
    },
    cluster: {
      type: 'integer',
      nullable: true,
      description: 'Which series of the release: 0 the main one, 1 and up the others.',
    },
    releaseFiles: {
      type: 'integer',
      nullable: true,
      description:
        'Files a validation of this one settles: itself and the rest of its series in the release.',
    },
  },
} as const;

/** What `ffprobe` read of a file; `null` while it has not been read (or cannot be). */
export const fileSchema = {
  type: 'object',
  nullable: true,
  required: ['video', 'audio', 'hdr', 'audioLanguages', 'subtitleLanguages', 'size'],
  properties: {
    video: { type: 'string', nullable: true },
    audio: { type: 'string', nullable: true },
    hdr: { type: 'string', enum: [...HDR_FORMATS], nullable: true },
    audioLanguages: { type: 'array', items: { type: 'string' } },
    subtitleLanguages: { type: 'array', items: { type: 'string' } },
    size: { type: 'integer' },
  },
} as const;

/** One file of a work: a version of a movie or of an episode. */
export const versionSchema = {
  type: 'object',
  required: ['id', 'path', 'state', 'resolution', 'nfo', 'entryId', 'file'],
  properties: {
    id: { type: 'string', description: 'What `POST /api/libraries/{id}/execute` takes.' },
    path: { type: 'string' },
    state: libraryItemSchema.properties.state,
    resolution: libraryItemSchema.properties.resolution,
    nfo: {
      type: 'boolean',
      nullable: true,
      description:
        'The NFO of this file is there: `<file>.nfo` for an episode, the shared `movie.nfo` for ' +
        'a movie (the same for every version). `null`: the profile writes none.',
    },
    entryId: libraryItemSchema.properties.entryId,
    file: {
      ...fileSchema,
      description:
        'What the snapshot knows of the file: a list never reads the disk, so `null` until the ' +
        'background probe got to it (the page of the item reads it at once).',
    },
  },
} as const;

/**
 * An entry of a list: a movie is one whatever its versions, the other files their own. The
 * fields are the first file's, but for the state and the files, which are those of all versions
 * (the worst state; a file missing from any one).
 */
export const workSchema = {
  ...libraryItemSchema,
  required: [...libraryItemSchema.required, 'versions'],
  properties: {
    ...libraryItemSchema.properties,
    versions: { type: 'array', items: versionSchema },
  },
} as const;

/** The NFO of some files: how many the profile wants and how many are there. */
export const nfoTallySchema = {
  type: 'object',
  required: ['expected', 'present'],
  properties: { expected: { type: 'integer' }, present: { type: 'integer' } },
} as const;

/** What a version holds of the episodes the versions hold together. */
export const coverageSchema = {
  type: 'array',
  description:
    'Each version of the files, from the largest picture down, with the episodes it holds out of ' +
    'those held (`total`). A file whose name says no size is a version only beside another of ' +
    'its episode (`resolution` `null`).',
  items: {
    type: 'object',
    required: ['resolution', 'covered', 'total'],
    properties: {
      resolution: { type: 'string', nullable: true },
      covered: { type: 'integer' },
      total: { type: 'integer' },
    },
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
    'versions',
    'missing',
    'rename',
    'refresh',
    'nfo',
    'episodesLackingNfo',
    'poster',
    'fanart',
    'logo',
    'unavailable',
  ],
  properties: {
    tmdbId: { type: 'integer' },
    title: { type: 'string', nullable: true },
    year: { type: 'integer', nullable: true },
    seasons: { type: 'integer', description: 'Seasons the library holds files of.' },
    episodes: {
      type: 'integer',
      description: 'Distinct episodes the files hold (a range counts each, a version none twice).',
    },
    versions: coverageSchema,
    episodesLackingNfo: {
      type: 'integer',
      description: 'Episodes with a version whose own NFO is missing.',
    },
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
    logo: {
      type: 'boolean',
      nullable: true,
      description: presenceDescription('The show logo'),
    },
    unavailable: {
      type: 'array',
      items: { type: 'string', enum: ['poster', 'fanart', 'logo'] },
      description:
        'Show images the profile writes that TMDB has none of (and the disk neither): not missing, ' +
        'the list shows them as unavailable.',
    },
  },
} as const;

export const seasonSchema = {
  type: 'object',
  required: ['season', 'name', 'posterPath', 'poster', 'missing', 'versions', 'nfo', 'episodes'],
  properties: {
    season: { type: 'integer', description: '0 is the specials.' },
    versions: {
      ...coverageSchema,
      description:
        'Every version of the show against the episodes of this season: one absent from it holds none.',
    },
    nfo: nfoTallySchema,
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
        required: ['season', 'episode', 'title', 'airDate', 'state', 'versions', 'nfo'],
        properties: {
          season: { type: 'integer' },
          episode: { type: 'integer' },
          title: { type: 'string', nullable: true },
          airDate: { type: 'string', nullable: true },
          state: { type: 'string', enum: ['present', 'missing', 'unaired', 'extra'] },
          versions: {
            type: 'array',
            description: 'The files that hold it, one per version; none when it is missing.',
            items: libraryItemSchema,
          },
          nfo: nfoTallySchema,
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
    'naming',
    'metadata',
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
    /** Unset (null): follows the global naming, metadata, mode and threshold. */
    naming: { type: 'string', enum: [...namings, null], nullable: true },
    metadata: { type: 'string', enum: [...metadatas, null], nullable: true },
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
  naming: { type: 'string', enum: namings },
  metadata: { type: 'string', enum: metadatas },
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
    naming: nullable(libraryFields.naming),
    metadata: nullable(libraryFields.metadata),
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
