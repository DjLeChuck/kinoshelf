import { stat } from 'node:fs/promises';
import {
  libraryId,
  loadProfile,
  type Config,
  type ConfigEdit,
  type LibraryConfig,
} from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import type { EntryStore } from './entries.js';
import type { EventBus } from './events.js';
import type { JobStore } from './jobs.js';
import type { JobRunner } from './runner.js';
import {
  errorSchema,
  jobSchema,
  libraryCreateSchema,
  libraryPatchSchema,
  librarySchema,
} from './schemas.js';
import type { ConfigStore } from './settings.js';

export interface LibraryContext {
  readonly config: ConfigStore;
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly events: EventBus;
  readonly runner: JobRunner;
  /** Shapes a job like `GET /api/jobs/{id}`. */
  readonly presentJob: (job: ReturnType<JobStore['create']>) => unknown;
}

type Destination = string | { movies: string; series: string };
type Mode = 'copy' | 'hardlink' | 'move';

interface CreateBody {
  name: string;
  source: string;
  destination?: Destination;
  profile?: string;
  mode?: Mode;
  threshold?: number;
  watch?: boolean;
}

/** `null` removes an optional field. */
interface PatchBody {
  name?: string;
  source?: string;
  destination?: Destination | null;
  profile?: string | null;
  mode?: Mode | null;
  threshold?: number | null;
  watch?: boolean;
}

/** A path the library names must be a folder that exists now, not a typo found at the first scan. */
async function requireFolder(path: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new ApiError(422, 'fs.not-a-directory', { path });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    throw code === 'EACCES'
      ? new ApiError(422, 'fs.unreadable', { path })
      : new ApiError(422, 'fs.not-found', { path });
  }
}

const destinationPaths = (destination: Destination | null | undefined): string[] =>
  destination == null
    ? []
    : typeof destination === 'string'
      ? [destination]
      : [destination.movies, destination.series];

async function validate(body: PatchBody): Promise<void> {
  for (const path of [
    ...(body.source ? [body.source] : []),
    ...destinationPaths(body.destination),
  ]) {
    await requireFolder(path);
  }
  if (typeof body.profile === 'string') {
    // A bundled id or a path to a YAML file: refused with the loader's own typed error.
    await loadProfile(body.profile);
  }
}

function requireSourceFree(
  libraries: readonly LibraryConfig[],
  source: string,
  own?: string,
): void {
  const other = libraries.find((library) => library.source === source && library.id !== own);
  if (other) {
    throw new ApiError(409, 'library.source-taken', { name: other.name });
  }
}

const find = (config: Config, id: string): LibraryConfig => {
  const library = config.libraries?.find((candidate) => candidate.id === id);
  if (!library) {
    throw new ApiError(404, 'library.not-found');
  }
  return library;
};

/** `config.yaml` is the only home of libraries: every route edits it through the store. */
export function registerLibraryRoutes(api: FastifyInstance, ctx: LibraryContext): void {
  const { config: store, jobs, entries, events, runner } = ctx;

  const present = (library: LibraryConfig): unknown => {
    const last = jobs.lastScan(library.id, library.source);
    return {
      id: library.id,
      name: library.name,
      source: library.source,
      destination: library.destination ?? null,
      profile: library.profile ?? null,
      mode: library.mode ?? null,
      threshold: library.threshold ?? null,
      watch: library.watch ?? false,
      lastScan: last
        ? { jobId: last.id, finishedAt: last.finishedAt, counts: entries.tabCounts(last.id) }
        : null,
      queued: jobs.pendingOf(library.id),
      scanning: jobs.scanPending(library.id, library.source),
    };
  };
  const write = async (makeLibraries: (current: Config) => LibraryConfig[]): Promise<Config> => {
    const next = await store.update((current): ConfigEdit[] => [
      { path: ['libraries'], value: makeLibraries(current) },
    ]);
    events.emit('settings');
    return next;
  };
  const idParams = { type: 'object', properties: { id: { type: 'string' } } } as const;

  api.get(
    '/api/libraries',
    {
      schema: {
        summary: 'The libraries, with the state of their last scan',
        description:
          'A library is a source folder (what a scan reads) and where it goes, with its own ' +
          'profile, mode and threshold; a field that is `null` follows the global setting. ' +
          '`lastScan` is the latest finished scan of the whole source, its counts being what is ' +
          'left to do now (see `GET /api/jobs/{id}/files`).',
        response: { 200: { type: 'array', items: librarySchema }, 401: errorSchema },
      },
    },
    () => (store.config.libraries ?? []).map(present),
  );

  api.post<{ Body: CreateBody }>(
    '/api/libraries',
    {
      schema: {
        summary: 'Add a library',
        description:
          'The id is made from the name. The source (and each destination) must be an existing ' +
          'folder (422 `fs.not-found`, `fs.not-a-directory`, `fs.unreadable`), the profile a known ' +
          'one (422 `profile.unknown`), and no other library may have the same source (409 ' +
          '`library.source-taken`).',
        body: libraryCreateSchema,
        response: {
          201: librarySchema,
          400: errorSchema,
          401: errorSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      await validate(body);
      let created: LibraryConfig | undefined;
      await write((current) => {
        const libraries = current.libraries ?? [];
        requireSourceFree(libraries, body.source);
        const id = libraryId(body.name, new Set(libraries.map((library) => library.id)));
        created = {
          id,
          name: body.name,
          source: body.source,
          ...(body.destination !== undefined && { destination: body.destination }),
          ...(body.profile !== undefined && { profile: body.profile }),
          ...(body.mode !== undefined && { mode: body.mode }),
          ...(body.threshold !== undefined && { threshold: body.threshold }),
          ...(body.watch !== undefined && { watch: body.watch }),
        };
        return [...libraries, created];
      });
      return reply.code(201).send(present(created as LibraryConfig));
    },
  );

  api.patch<{ Params: { id: string }; Body: PatchBody }>(
    '/api/libraries/:id',
    {
      schema: {
        summary: 'Change a library',
        description:
          'Only what is sent changes; `null` removes `destination`, `profile`, `mode` or ' +
          '`threshold`, so the library follows the global setting again. The id never changes. ' +
          'Same validation as `POST /api/libraries`. Files already planned keep the settings they ' +
          'were planned with; the next scan uses the new ones.',
        params: idParams,
        body: libraryPatchSchema,
        response: {
          200: librarySchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      find(store.config, id);
      await validate(request.body);
      let updated: LibraryConfig | undefined;
      await write((current) => {
        const existing = find(current, id);
        const libraries = current.libraries ?? [];
        if (request.body.source !== undefined) {
          requireSourceFree(libraries, request.body.source, id);
        }
        const merged: Record<string, unknown> = { ...existing };
        for (const [key, value] of Object.entries(request.body)) {
          if (value === null) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete merged[key];
          } else if (value !== undefined) {
            merged[key] = value;
          }
        }
        updated = merged as unknown as LibraryConfig;
        return libraries.map((library) =>
          library.id === id ? (updated as LibraryConfig) : library,
        );
      });
      return present(updated as LibraryConfig);
    },
  );

  api.delete<{ Params: { id: string } }>(
    '/api/libraries/:id',
    {
      schema: {
        summary: 'Remove a library',
        description:
          'Forgets the library only: its files stay where they are, and the jobs it started keep ' +
          'their history.',
        params: idParams,
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      find(store.config, id);
      await write((current) => {
        find(current, id);
        return (current.libraries ?? []).filter((library) => library.id !== id);
      });
      return reply.code(204).send();
    },
  );

  api.post<{ Params: { id: string } }>(
    '/api/libraries/:id/scan',
    {
      schema: {
        summary: 'Scan a library now',
        description:
          'Queues an analysis of the whole source with the library’s settings; nothing is written ' +
          'to the disk. Poll `GET /api/jobs/{id}` (or follow the `jobs` event), then read ' +
          '`GET /api/jobs/{id}/files` and execute chosen files with `POST /api/plans/{id}/execute`. ' +
          '409 `library.scan-in-progress` while a scan of this library is queued or running.',
        params: idParams,
        response: { 202: jobSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request, reply) => {
      const library = find(store.config, request.params.id);
      if (jobs.scanPending(library.id, library.source)) {
        throw new ApiError(409, 'library.scan-in-progress');
      }
      const job = jobs.create(library.source, false, library.id);
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send(ctx.presentJob(job));
    },
  );
}
