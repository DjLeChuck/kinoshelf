import { dirname, join } from 'node:path';
import {
  removeOrphanFolders,
  tidyForeignFiles,
  tidySubtitles,
  type Config,
  type Database,
  type Journal,
  type LeftBehind,
  type LibraryConfig,
  type TidiedFolder,
  type TidiedForeignFile,
  type TidiedSubtitle,
} from '@kinoshelf/core';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { imdbRatingsOf } from './imdb-ratings.js';
import type { ImdbNfoTasks } from './imdb-nfo.js';
import type { EventBus } from './events.js';
import type { JobStore } from './jobs.js';
import type { LibrarySnapshot } from './library-items.js';
import type { DatabaseTasks } from './database-tasks.js';
import type { ReplacedFiles } from './replaced-files.js';
import { countRoutineJobs, forgetRoutineJobs } from './purge.js';
import type { TmdbUsage } from './tmdb-usage.js';
import { failureOf, type MatchFailure } from './matches.js';
import type { ProgressTracker } from './progress.js';
import { errorSchema } from './schemas.js';

export interface MaintenanceDeps {
  readonly config: () => Config;
  readonly jobs: JobStore;
  readonly journal: Journal;
  readonly database: Database;
  readonly tmdbUsage: TmdbUsage;
  readonly imdbNfoTasks: ImdbNfoTasks;
  readonly databaseTasks: DatabaseTasks;
  readonly replaced: ReplacedFiles;
  readonly log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  readonly backupKeep: () => number;
  readonly snapshot: LibrarySnapshot;
  readonly events: EventBus;
  readonly progress: ProgressTracker;
  /** The tidy-ups, one per library (the latest), in memory: the activity panel reads them too. */
  readonly tidyTasks: Map<string, TidyTask>;
  /** Where what a tidy-up takes out is kept, so that undo can bring it back. */
  readonly configDir: string;
}

const backupFileSchema = {
  type: 'object',
  required: ['name', 'bytes', 'at'],
  properties: {
    name: { type: 'string' },
    bytes: { type: 'integer' },
    at: { type: 'string', format: 'date-time' },
  },
} as const;

const errorInfo = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string' },
    params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
  },
} as const;

const databaseTaskSchema = {
  type: 'object',
  required: ['kind', 'status', 'done', 'total', 'startedAt', 'endedAt', 'backup', 'size', 'error'],
  properties: {
    kind: { enum: ['backup', 'vacuum'] },
    status: { enum: ['running', 'done', 'failed'] },
    done: { type: 'integer', description: 'Pages copied by a backup.' },
    total: { type: 'integer' },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: ['string', 'null'], format: 'date-time' },
    backup: {
      type: ['object', 'null'],
      required: ['file', 'removed'],
      properties: {
        file: backupFileSchema,
        removed: { type: 'integer', description: 'Older backups the rotation removed.' },
      },
    },
    size: {
      type: ['object', 'null'],
      required: ['before', 'after'],
      properties: { before: { type: 'integer' }, after: { type: 'integer' } },
    },
    error: { anyOf: [errorInfo, { type: 'null' }] },
  },
} as const;

const replacedTaskSchema = {
  type: 'object',
  required: ['status', 'done', 'total', 'startedAt', 'endedAt', 'all', 'freed', 'error'],
  properties: {
    status: { enum: ['running', 'done', 'failed'] },
    done: { type: 'integer' },
    total: { type: 'integer' },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: ['string', 'null'], format: 'date-time' },
    all: { type: 'boolean', description: 'The retention was ignored.' },
    freed: {
      type: ['object', 'null'],
      required: ['files', 'bytes', 'batches', 'failed'],
      properties: {
        files: { type: 'integer' },
        bytes: { type: 'integer' },
        batches: { type: 'integer', description: 'Batches that can no longer restore a file.' },
        failed: { type: 'integer', description: 'Files that could not be deleted.' },
      },
    },
    error: { anyOf: [errorInfo, { type: 'null' }] },
  },
} as const;

const imdbNfoTaskSchema = {
  type: 'object',
  required: ['status', 'done', 'total', 'startedAt', 'endedAt', 'result', 'error'],
  properties: {
    status: { type: 'string', enum: ['running', 'done', 'failed'] },
    done: { type: 'integer' },
    total: { type: 'integer' },
    startedAt: { type: 'string' },
    endedAt: { type: 'string', nullable: true },
    result: {
      type: 'object',
      nullable: true,
      required: ['works', 'rewritten', 'already', 'noRating', 'kept', 'missing', 'batchId'],
      properties: {
        works: { type: 'integer' },
        rewritten: { type: 'integer' },
        already: { type: 'integer' },
        noRating: { type: 'integer' },
        kept: { type: 'integer' },
        missing: { type: 'integer' },
        batchId: { type: 'string', nullable: true },
      },
    },
    error: { anyOf: [errorInfo, { type: 'null' }] },
  },
} as const;

const replacedFiguresSchema = {
  type: 'object',
  required: ['files', 'bytes', 'due', 'days'],
  properties: {
    files: { type: 'integer' },
    bytes: { type: 'integer' },
    due: {
      type: 'object',
      required: ['files', 'bytes', 'batches'],
      description: 'What emptying would delete now, with the retention in force.',
      properties: {
        files: { type: 'integer' },
        bytes: { type: 'integer' },
        batches: {
          type: 'integer',
          description: 'Batches of the History that could no longer restore all they set aside.',
        },
      },
    },
    days: { type: 'integer', description: 'The retention in force (0: every file).' },
  },
} as const;

const folderSchema = {
  type: 'object',
  required: ['path', 'status', 'files'],
  properties: {
    path: { type: 'string' },
    twin: {
      type: 'string',
      description: 'The sibling folder holding the video this one duplicates.',
    },
    approximate: {
      type: 'boolean',
      description: 'The twin was found by title and year, not by name: worth a look.',
    },
    empty: { type: 'boolean', description: 'Holds no file at all: it goes without a twin.' },
    status: { enum: ['would-remove', 'removed', 'skipped', 'failed'] },
    reason: { enum: ['other-files', 'no-twin', 'changed'] },
    files: { type: 'integer' },
    moved: { type: 'integer' },
    error: errorInfo,
  },
} as const;

const fileSchema = {
  type: 'object',
  required: ['path', 'kind', 'counterpart', 'status'],
  properties: {
    path: { type: 'string' },
    kind: { enum: ['nfo', 'poster', 'fanart', 'logo'] },
    counterpart: { type: 'string', description: 'The name Kinoshelf writes for the same thing.' },
    action: { enum: ['rename', 'remove'] },
    status: { enum: ['would-do', 'done', 'skipped', 'failed'] },
    reason: {
      enum: ['ours', 'format', 'no-counterpart', 'versions', 'nfo-not-requested', 'changed'],
    },
    error: errorInfo,
  },
} as const;

const subtitleSchema = {
  type: 'object',
  required: ['path', 'destination', 'status'],
  properties: {
    path: { type: 'string' },
    destination: {
      type: 'string',
      description: 'Beside the video: `<video>.<language>[.forced][.sdh].<ext>`.',
    },
    status: { enum: ['would-do', 'done', 'skipped', 'failed'] },
    reason: { enum: ['destination-exists', 'changed'] },
    error: errorInfo,
  },
} as const;

const leftBehindSchema = {
  type: 'object',
  required: ['path', 'reason'],
  properties: {
    path: { type: 'string' },
    reason: { enum: ['language-unknown', 'language-taken'] },
  },
} as const;

const partSchema = (items: object) =>
  ({
    type: ['object', 'null'],
    required: ['batch', 'items'],
    properties: {
      batch: {
        type: ['string', 'null'],
        description: 'The batch of the History to undo, `null` when nothing was moved.',
      },
      items: { type: 'array', items },
    },
  }) as const;

const taskSchema = {
  type: 'object',
  required: [
    'library',
    'dryRun',
    'status',
    'phase',
    'done',
    'total',
    'current',
    'startedAt',
    'endedAt',
    'folders',
    'files',
    'subtitles',
    'error',
  ],
  properties: {
    library: { type: 'string' },
    dryRun: { type: 'boolean' },
    status: { enum: ['running', 'done', 'failed'] },
    phase: {
      enum: ['reading', 'folders', 'files', 'subtitles'],
      description: '`reading` while the library is being read: no total is known yet.',
    },
    done: { type: 'integer' },
    total: { type: 'integer' },
    current: { type: ['string', 'null'] },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: ['string', 'null'], format: 'date-time' },
    folders: partSchema(folderSchema),
    files: partSchema(fileSchema),
    subtitles: {
      type: ['object', 'null'],
      required: ['batch', 'items', 'left'],
      properties: {
        batch: {
          type: ['string', 'null'],
          description: 'The batch of the History to undo, `null` when nothing was moved.',
        },
        items: { type: 'array', items: subtitleSchema },
        left: {
          type: 'array',
          description: 'What stays in its `Subs` folder, with the reason.',
          items: leftBehindSchema,
        },
      },
    },
    error: { anyOf: [errorInfo, { type: 'null' }] },
  },
} as const;

export interface TidyTask {
  library: string;
  dryRun: boolean;
  status: 'running' | 'done' | 'failed';
  phase: 'reading' | 'folders' | 'files' | 'subtitles';
  done: number;
  total: number;
  current: string | null;
  startedAt: string;
  endedAt: string | null;
  folders: { batch: string | null; items: readonly TidiedFolder[] } | null;
  files: { batch: string | null; items: readonly TidiedForeignFile[] } | null;
  subtitles: {
    batch: string | null;
    items: readonly TidiedSubtitle[];
    left: readonly LeftBehind[];
  } | null;
  error: MatchFailure | null;
}

type Typed = LibraryConfig & { readonly type: 'movie' | 'series' };

const isTyped = (library: LibraryConfig): library is Typed => library.type !== undefined;

/**
 * Tidying a library organized in place: what `kinoshelf tidy` does, for the Maintenance tab.
 * **Never in the request**: reading a big library on a network share and moving hundreds of
 * folders take minutes, so a request only starts a task and answers 202 with its state. The task
 * lives in memory (one per library, the latest kept), announces itself through the `progress`
 * event and, when it moved something, `history`; the batches it made are in the History and are
 * undone from there. A report (`dryRun`) is a task too, since it reads the same tree.
 */
export function registerMaintenanceRoutes(api: FastifyInstance, deps: MaintenanceDeps): void {
  const backupDir = join(deps.configDir, 'replaced');
  const tasks = deps.tidyTasks;

  const typedLibrary = (id: string): Typed => {
    const all = deps.config().libraries ?? [];
    const found = all.find((library) => library.id === id);
    if (!found) {
      throw new ApiError(404, 'library.not-found');
    }
    if (!isTyped(found)) {
      throw new ApiError(409, 'library.not-typed');
    }
    return found;
  };

  const run = async (
    task: TidyTask,
    library: Typed,
    what: { folders: boolean; files: boolean; subtitles: boolean; nfo: boolean },
  ): Promise<void> => {
    const source = { id: library.id, type: library.type, source: library.source };
    const options = { journal: deps.journal, backupDir, dryRun: task.dryRun };
    const progress =
      (phase: 'folders' | 'files' | 'subtitles') =>
      (done: number, total: number, current: string) => {
        Object.assign(task, { phase, done, total, current: current || null });
        deps.progress.announce();
      };
    const reading = (): void => {
      Object.assign(task, { phase: 'reading', done: 0, total: 0, current: null });
      deps.progress.announce();
    };

    if (what.folders) {
      reading();
      const result = await removeOrphanFolders(source, {
        ...options,
        onProgress: progress('folders'),
      });
      task.folders = { batch: result.batchId, items: result.folders };
    }
    if (what.subtitles) {
      reading();
      const result = await tidySubtitles(source, {
        journal: deps.journal,
        dryRun: task.dryRun,
        onProgress: progress('subtitles'),
      });
      task.subtitles = { batch: result.batchId, items: result.files, left: result.left };
    }
    if (what.files && library.type === 'movie') {
      reading();
      const result = await tidyForeignFiles(source, {
        ...options,
        includeNfo: what.nfo,
        onProgress: progress('files'),
      });
      task.files = { batch: result.batchId, items: result.files };
      // An image renamed to the name Kinoshelf writes is now there for the list.
      for (const file of result.files) {
        if (file.status === 'done' && file.action === 'rename') {
          deps.snapshot.written(join(dirname(file.path), file.counterpart));
        }
      }
    }
  };

  api.get(
    '/api/maintenance',
    {
      schema: {
        summary: 'What the maintenance actions would act on',
        description:
          'The figures the Maintenance tab shows on its cards: the analyses the History hides ' +
          '(`hiddenAnalyses`) and the TMDB answers kept in the cache.',
        response: {
          200: {
            type: 'object',
            required: [
              'hiddenAnalyses',
              'tmdbCache',
              'databaseBytes',
              'backups',
              'backupKeep',
              'databaseTasks',
              'replaced',
              'replacedTask',
              'imdbRatings',
              'imdbNfoTask',
            ],
            properties: {
              hiddenAnalyses: { type: 'integer' },
              databaseBytes: { type: 'integer', description: 'The size of the database file.' },
              backups: { type: 'array', items: backupFileSchema, description: 'Newest first.' },
              backupKeep: { type: 'integer', description: 'How many backups are kept.' },
              replaced: replacedFiguresSchema,
              imdbNfoTask: { anyOf: [imdbNfoTaskSchema, { type: 'null' }] },
              imdbRatings: {
                type: 'object',
                description:
                  "IMDb's ratings file, as the database holds it: shown whether the setting is on or not.",
                required: ['enabled', 'entries', 'fetchedAt', 'task'],
                properties: {
                  enabled: { type: 'boolean' },
                  entries: { type: 'integer', description: 'Ratings held.' },
                  fetchedAt: { type: 'string', nullable: true },
                  task: {
                    anyOf: [
                      {
                        type: 'object',
                        required: ['status', 'done', 'startedAt', 'endedAt', 'error'],
                        properties: {
                          status: { type: 'string', enum: ['running', 'done', 'failed'] },
                          done: { type: 'integer' },
                          startedAt: { type: 'string' },
                          endedAt: { type: 'string', nullable: true },
                          error: { anyOf: [errorInfo, { type: 'null' }] },
                        },
                      },
                      { type: 'null' },
                    ],
                  },
                },
              },
              replacedTask: { anyOf: [replacedTaskSchema, { type: 'null' }] },
              databaseTasks: {
                type: 'array',
                description: 'The latest backup and the latest compaction, since the start.',
                items: databaseTaskSchema,
              },
              tmdbCache: {
                type: 'object',
                required: ['entries', 'bytes'],
                properties: { entries: { type: 'integer' }, bytes: { type: 'integer' } },
              },
            },
          },
          401: errorSchema,
        },
      },
    },
    async () => ({
      hiddenAnalyses: countRoutineJobs(deps.database),
      tmdbCache: deps.tmdbUsage.cacheStats(),
      databaseBytes:
        Number(deps.database.pragma('page_count', { simple: true })) *
        Number(deps.database.pragma('page_size', { simple: true })),
      backups: await deps.databaseTasks.backups(),
      backupKeep: deps.backupKeep(),
      databaseTasks: deps.databaseTasks.tasks(),
      replaced: await deps.replaced.figures(),
      replacedTask: deps.replaced.task(),
      imdbNfoTask: deps.imdbNfoTasks.task() ?? null,
      imdbRatings: {
        enabled: deps.config().imdbRatings ?? false,
        ...imdbRatingsOf(deps.database).figures(),
      },
    }),
  );

  api.post(
    '/api/maintenance/imdb-nfo',
    {
      schema: {
        summary: 'Add IMDb’s rating to the NFO already written',
        description:
          'Starts a task and answers 202 at once; `GET /api/maintenance` tells how it goes. ' +
          'Adds IMDb’s rating to the NFO of every library that writes them, in the files as they are ' +
          '(no request to TMDB), on the ' +
          'terms of a collection change: only an NFO Kinoshelf wrote and nobody edited since, the ' +
          'old one set aside in `replaced/`, one batch the history can undo. 409 `imdb.not-enabled` ' +
          'or `imdb.not-downloaded` until the setting is on and the file is there, ' +
          '`maintenance.imdb-nfo-busy` while a scan, a transfer, a tidy-up or an undo runs.',
        response: { 202: imdbNfoTaskSchema, 401: errorSchema, 409: errorSchema },
      },
    },
    (_request, reply) => reply.code(202).send(deps.imdbNfoTasks.start()),
  );

  api.delete(
    '/api/maintenance/imdb-ratings',
    {
      schema: {
        summary: "Forget IMDb's ratings file",
        description:
          'Drops the ratings downloaded from IMDb (a disposable table: nothing else reads it). The ' +
          'NFO already written keep their rating. While `processing.imdbRatings` is on, the file ' +
          'is downloaded again at the next check. 409 `maintenance.imdb-busy` while it downloads.',
        response: {
          200: {
            type: 'object',
            required: ['removed'],
            properties: { removed: { type: 'integer' } },
          },
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    () => {
      const ratings = imdbRatingsOf(deps.database);
      if (ratings.downloading) {
        throw new ApiError(409, 'maintenance.imdb-busy');
      }
      const removed = ratings.clear();
      deps.log.info({ removed }, 'Forgot the IMDb ratings');
      return { removed };
    },
  );

  api.post(
    '/api/maintenance/backup',
    {
      schema: {
        summary: 'Back up the database',
        description:
          'Starts a task and answers 202 at once; `GET /api/maintenance` tells how it goes (follow ' +
          'the `progress` event). Copies the database, journal included, to ' +
          '`<config>/backups/kinoshelf-YYYYMMDD-HHMM.sqlite` without stopping the server, then ' +
          'removes the oldest copies beyond `retention.backupKeep`. Nothing else is touched. 409 ' +
          '`maintenance.database-task-running` while a backup or a compaction runs.',
        response: { 202: databaseTaskSchema, 401: errorSchema, 409: errorSchema },
      },
    },
    (_request, reply) => reply.code(202).send(deps.databaseTasks.startBackup()),
  );

  api.post<{ Body: { all?: boolean } }>(
    '/api/maintenance/empty-replaced',
    {
      schema: {
        summary: 'Delete the files set aside, for good',
        description:
          'Starts a task and answers 202 at once; `GET /api/maintenance` tells how it goes. ' +
          'Deletes the files of `<config>/replaced/` set aside longer ago than ' +
          '`retention.replacedRetentionDays`, or all of them with `all`. **Irreversible**: the ' +
          'journal keeps its entries, and undoing a batch whose file is gone skips that file ' +
          '(`undo.backup-missing`). Videos are never in there. 409 `maintenance.replaced-busy` ' +
          'while a scan, a transfer, a tidy-up, an undo or another emptying runs.',
        body: {
          type: 'object',
          properties: { all: { type: 'boolean', default: false } },
          additionalProperties: false,
        },
        response: {
          202: replacedTaskSchema,
          400: errorSchema,
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request, reply) => {
      // A tidy-up writes into that folder, and "all" would take what it has just put there.
      if ([...tasks.values()].some(({ status }) => status === 'running')) {
        throw new ApiError(409, 'maintenance.replaced-busy');
      }
      return reply.code(202).send(deps.replaced.start({ all: request.body.all ?? false }));
    },
  );

  api.post(
    '/api/maintenance/vacuum',
    {
      schema: {
        summary: 'Compact the database',
        description:
          'Starts a task and answers 202 at once; `GET /api/maintenance` tells how it goes. ' +
          'Runs `VACUUM`: the file shrinks, no data changes. It holds the server for its ' +
          'duration, so 409 `maintenance.busy` while a scan or a transfer runs, and 409 ' +
          '`maintenance.database-task-running` while a backup or a compaction runs.',
        response: { 202: databaseTaskSchema, 401: errorSchema, 409: errorSchema },
      },
    },
    (_request, reply) => reply.code(202).send(deps.databaseTasks.startVacuum()),
  );

  api.post(
    '/api/maintenance/purge-hidden',
    {
      schema: {
        summary: 'Forget the analyses the History hides',
        description:
          'Forgets at once the analyses that finished and moved nothing, without waiting for the ' +
          'daily purge. Files, batches and the journal are not touched, nor are the analyses whose ' +
          'files still wait in Arrivals or that a library list reads. Short: answers 200.',
        response: {
          200: {
            type: 'object',
            required: ['removed'],
            properties: { removed: { type: 'integer' } },
          },
          401: errorSchema,
        },
      },
    },
    () => {
      const { jobs } = forgetRoutineJobs(deps.database);
      if (jobs > 0) {
        deps.events.emit('history');
      }
      deps.log.info({ removed: jobs }, 'Forgot the hidden analyses');
      return { removed: jobs };
    },
  );

  api.get(
    '/api/maintenance/tidy',
    {
      schema: {
        summary: 'The tidy-ups, running or last done',
        description:
          'One task per library (the latest, kept in memory until the server restarts), with how ' +
          'far it has got while it runs and its result once it ends. Follow the `progress` event.',
        response: {
          200: {
            type: 'object',
            required: ['tasks'],
            properties: { tasks: { type: 'array', items: taskSchema } },
          },
          401: errorSchema,
        },
      },
    },
    () => ({ tasks: [...tasks.values()] }),
  );

  api.post<{
    Body: {
      library: string;
      folders?: boolean;
      files?: boolean;
      subtitles?: boolean;
      nfo?: boolean;
      dryRun?: boolean;
    };
  }>(
    '/api/maintenance/tidy',
    {
      schema: {
        summary: 'Start tidying a library',
        description:
          'Starts a task and answers 202 at once, `GET /api/maintenance/tidy` tells how it goes. ' +
          '`dryRun` only reports what it would do (the folders holding no video, taken out once a ' +
          'sibling with a video is the same work; in a movie library the metadata named after the video, ' +
          'renamed to Kinoshelf’s names or set aside when those exist). Otherwise `folders` takes the ' +
          'folders out, `files` handles the metadata, `nfo` adding the `<video>.nfo` files, `subtitles` ' +
          '(off by default) brings the subtitles of a `Subs` folder next to their video, named by ' +
          'language (what stays, and why, is in `subtitles.left`). Nothing is ' +
          'deleted: every file is kept in the config folder, and each action is a batch of the History ' +
          'that `POST /api/batches/{id}/undo` reverts. 409 `library.scan-in-progress` while a scan of ' +
          'the library is queued or running, 409 `maintenance.in-progress` while a tidy-up of it runs.',
        body: {
          type: 'object',
          required: ['library'],
          properties: {
            library: { type: 'string' },
            folders: { type: 'boolean', default: true },
            files: { type: 'boolean', default: true },
            subtitles: { type: 'boolean', default: false },
            nfo: { type: 'boolean', default: false },
            dryRun: { type: 'boolean', default: false },
          },
          additionalProperties: false,
        },
        response: {
          202: taskSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request, reply) => {
      const {
        library: id,
        folders = true,
        files = true,
        subtitles = false,
        nfo = false,
        dryRun = false,
      } = request.body;
      if (!folders && !files && !subtitles) {
        throw new ApiError(400, 'request.invalid');
      }
      const library = typedLibrary(id);
      if (deps.jobs.scanPending(library.id, library.source)) {
        throw new ApiError(409, 'library.scan-in-progress');
      }
      if (tasks.get(library.id)?.status === 'running') {
        throw new ApiError(409, 'maintenance.in-progress');
      }
      const task: TidyTask = {
        library: library.id,
        dryRun,
        status: 'running',
        phase: 'reading',
        done: 0,
        total: 0,
        current: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        folders: null,
        files: null,
        subtitles: null,
        error: null,
      };
      tasks.set(library.id, task);
      deps.progress.announce();
      void run(task, library, { folders, files, subtitles, nfo })
        .then(() => {
          task.status = 'done';
        })
        .catch((error: unknown) => {
          task.status = 'failed';
          task.error = failureOf(error);
        })
        .finally(() => {
          task.endedAt = new Date().toISOString();
          task.current = null;
          if (!task.dryRun) {
            deps.log.info(
              {
                library: library.id,
                status: task.status,
                folders: task.folders?.batch ?? null,
                files: task.files?.batch ?? null,
                subtitles: task.subtitles?.batch ?? null,
              },
              'Tidied a library',
            );
          }
          deps.progress.announce();
          // A batch was made, even by a task that failed afterwards: the History lists it.
          if (
            task.folders?.batch != null ||
            task.files?.batch != null ||
            task.subtitles?.batch != null
          ) {
            deps.events.emit('history');
          }
        });
      return reply.code(202).send(task);
    },
  );
}
