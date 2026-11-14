import { dirname, join } from 'node:path';
import {
  removeOrphanFolders,
  tidyForeignFiles,
  type Config,
  type Journal,
  type LibraryConfig,
  type TidiedFolder,
  type TidiedForeignFile,
} from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import type { EventBus } from './events.js';
import type { JobStore } from './jobs.js';
import type { LibrarySnapshot } from './library-items.js';
import { failureOf, type MatchFailure } from './matches.js';
import type { ProgressTracker } from './progress.js';
import { errorSchema } from './schemas.js';

export interface MaintenanceDeps {
  readonly config: () => Config;
  readonly jobs: JobStore;
  readonly journal: Journal;
  readonly snapshot: LibrarySnapshot;
  readonly events: EventBus;
  readonly progress: ProgressTracker;
  /** Where what a tidy-up takes out is kept, so that undo can bring it back. */
  readonly configDir: string;
}

const errorInfo = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string' },
    params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
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
    'error',
  ],
  properties: {
    library: { type: 'string' },
    dryRun: { type: 'boolean' },
    status: { enum: ['running', 'done', 'failed'] },
    phase: {
      enum: ['reading', 'folders', 'files'],
      description: '`reading` while the library is being read: no total is known yet.',
    },
    done: { type: 'integer' },
    total: { type: 'integer' },
    current: { type: ['string', 'null'] },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: ['string', 'null'], format: 'date-time' },
    folders: partSchema(folderSchema),
    files: partSchema(fileSchema),
    error: { anyOf: [errorInfo, { type: 'null' }] },
  },
} as const;

export interface TidyTask {
  library: string;
  dryRun: boolean;
  status: 'running' | 'done' | 'failed';
  phase: 'reading' | 'folders' | 'files';
  done: number;
  total: number;
  current: string | null;
  startedAt: string;
  endedAt: string | null;
  folders: { batch: string | null; items: readonly TidiedFolder[] } | null;
  files: { batch: string | null; items: readonly TidiedForeignFile[] } | null;
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
  const tasks = new Map<string, TidyTask>();

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
    what: { folders: boolean; files: boolean; nfo: boolean },
  ): Promise<void> => {
    const source = { id: library.id, type: library.type, source: library.source };
    const options = { journal: deps.journal, backupDir, dryRun: task.dryRun };
    const progress =
      (phase: 'folders' | 'files') => (done: number, total: number, current: string) => {
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
    Body: { library: string; folders?: boolean; files?: boolean; nfo?: boolean; dryRun?: boolean };
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
          'folders out, `files` handles the metadata, `nfo` adding the `<video>.nfo` files. Nothing is ' +
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
        nfo = false,
        dryRun = false,
      } = request.body;
      if (!folders && !files) {
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
        error: null,
      };
      tasks.set(library.id, task);
      deps.progress.announce();
      void run(task, library, { folders, files, nfo })
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
          deps.progress.announce();
          // A batch was made, even by a task that failed afterwards: the History lists it.
          if (task.folders?.batch != null || task.files?.batch != null) {
            deps.events.emit('history');
          }
        });
      return reply.code(202).send(task);
    },
  );
}
