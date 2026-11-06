import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  errnoCode,
  libraryProfile,
  KinoshelfError,
  libraryId,
  loadProfile,
  type MovieDetails,
  type PlanItem,
  type SeriesDetails,
  type Config,
  type ConfigEdit,
  type LibraryConfig,
} from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { isSystemPath } from './system-paths.js';
import { isInside } from './notify/paths.js';
import type { SeriesFilesStore } from './series-files.js';
import { compare, missingOf, type Completeness, type EpisodeReport } from './completeness.js';
import type { Execution } from './executions.js';
import type { ProbeQueue } from './probe.js';
import type { ExecutionReport } from './service.js';
import type { EntryStore } from './entries.js';
import type { EventBus } from './events.js';
import type { JobStore } from './jobs.js';
import {
  ITEM_FILTERS,
  itemId,
  profileWrites,
  resolutionOf,
  type ItemFilter,
  type LibraryItem,
  type LibraryItemStore,
} from './library-items.js';
import type { ProgressTracker } from './progress.js';
import type { JobRunner } from './runner.js';
import {
  errorSchema,
  jobSchema,
  libraryCreateSchema,
  libraryItemSchema,
  libraryPatchSchema,
  librarySchema,
  paging,
  selectionReportSchema,
  selectionRunSchema,
  sizeSchema,
  progressSchema,
  transferProgressSchema,
  seasonSchema,
  showSchema,
  type Paging,
  MAX_SELECTION,
} from './schemas.js';
import type { ConfigStore } from './settings.js';

export interface LibraryContext {
  readonly config: ConfigStore;
  readonly jobs: JobStore;
  readonly entries: EntryStore;
  readonly items: LibraryItemStore;
  readonly probes: ProbeQueue;
  /** The missing episodes of a show, counted on opening it (and in the background otherwise). */
  readonly completeness: Completeness;
  readonly seriesFiles: SeriesFilesStore;
  /** Plans and queues the transfers of a scan's files (see `POST /api/plans/{id}/execute`). */
  readonly batch: {
    readonly dryRun: (
      jobId: string,
      entryIds: readonly string[],
      overrides?: ReadonlyMap<string, PlanItem>,
    ) => Promise<ExecutionReport>;
    readonly enqueue: (jobId: string, entryIds: readonly string[]) => Execution;
    /** Plans the version names of movies (see `Service.planVersions`). */
    readonly planVersions: (
      jobId: string,
      entryIds: readonly string[],
      screenSize?: string,
    ) => Promise<{ ready: Map<string, PlanItem>; refused: Map<string, PlanItem> }>;
    readonly commitVersions: (ready: ReadonlyMap<string, PlanItem>) => void;
  };
  /** The provider's details of a work, for the page of one item. */
  readonly details: (
    kind: 'movie' | 'series',
    tmdbId: number,
  ) => Promise<MovieDetails | SeriesDetails | null>;
  readonly events: EventBus;
  readonly runner: JobRunner;
  readonly progress: ProgressTracker;
  /** Shapes a job like `GET /api/jobs/{id}`. */
  readonly presentJob: (job: ReturnType<JobStore['create']>) => unknown;
}

type Kind = 'movie' | 'series';
type Into = { movie: string; series: string };
type Mode = 'copy' | 'hardlink' | 'move';

interface CreateBody {
  name: string;
  source: string;
  type?: Kind;
  into?: Into;
  profile?: string;
  mode?: Mode;
  threshold?: number;
  watch?: boolean;
}

/** `null` removes an optional field. */
interface PatchBody {
  name?: string;
  source?: string;
  type?: Kind;
  into?: Into | null;
  profile?: string | null;
  mode?: Mode | null;
  threshold?: number | null;
  watch?: boolean;
}

/** A path the library names must be a folder that exists now, not a typo found at the first scan. */
async function requireFolder(path: string): Promise<void> {
  if (isSystemPath(path)) {
    throw new ApiError(422, 'fs.system-folder', { path });
  }
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new ApiError(422, 'fs.not-a-directory', { path });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const code = errnoCode(error);
    throw code === 'EACCES'
      ? new ApiError(422, 'fs.unreadable', { path })
      : new ApiError(422, 'fs.not-found', { path });
  }
}

async function validate(body: PatchBody): Promise<void> {
  if (body.source) {
    await requireFolder(body.source);
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

/** The folder a file came in and which series of it: only the list of items fills it in. */
interface ReleaseOf {
  readonly release: string | null;
  readonly cluster: number;
  readonly files: number;
}

const presentItem = (item: LibraryItem, release?: ReleaseOf): unknown => ({
  id: itemId(item.path),
  path: item.path,
  state: item.state,
  kind: item.kind,
  title: item.title,
  year: item.year,
  tmdbId: item.tmdbId,
  season: item.season,
  episode: item.episode,
  episodeEnd: item.episodeEnd,
  resolution: resolutionOf(item.path),
  nfo: item.nfo,
  poster: item.poster,
  fanart: item.fanart,
  entryId: item.entryId,
  release: release?.release ?? null,
  cluster: release ? release.cluster : null,
  releaseFiles: release ? release.files : null,
});

/** The year of an ISO date, if there is one. */
const yearOf = (date: string | undefined): number | null =>
  date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;

const find = (config: Config, id: string): LibraryConfig => {
  const library = config.libraries?.find((candidate) => candidate.id === id);
  if (!library) {
    throw new ApiError(404, 'library.not-found');
  }
  return library;
};

/** `config.yaml` is the only home of libraries: every route edits it through the store. */
export function registerLibraryRoutes(api: FastifyInstance, ctx: LibraryContext): void {
  const { config: store, jobs, entries, items, probes, events, runner } = ctx;

  const present = (library: LibraryConfig): unknown => {
    const last = jobs.lastScan(library.id, library.source);
    return {
      id: library.id,
      name: library.name,
      source: library.source,
      type: library.type ?? null,
      into: library.into ?? null,
      profile: library.profile ?? null,
      mode: library.mode ?? null,
      threshold: library.threshold ?? null,
      watch: library.watch ?? false,
      lastScan: last ? { jobId: last.id, status: last.status } : null,
      scanning: jobs.scanPending(library.id, library.source),
    };
  };
  const write = async (makeLibraries: (current: Config) => LibraryConfig[]): Promise<Config> => {
    // The config checks the whole set (exactly one of `type` / `into`, `into` naming libraries of
    // the right type) before writing anything: its refusal is the request's.
    const next = await store
      .update((current): ConfigEdit[] => [{ path: ['libraries'], value: makeLibraries(current) }])
      .catch((error: unknown) => {
        throw error instanceof KinoshelfError && error.info.code === 'config.invalid'
          ? new ApiError(422, 'library.invalid', {
              detail: String(error.info.params?.detail ?? ''),
            })
          : error;
      });
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
          'A library is a source folder (what a scan reads). With a `type` it is organized in place ' +
          'and is also a destination; with `into` (the ids of a movie and a series library) it is ' +
          'an arrival folder, with its own mode. `profile` goes with `type`, `mode` with `into`; ' +
          'a field that is `null` follows the global setting. ' +
          '`lastScan` is the latest scan of the whole source, queued, running, failed or done ' +
          '(its job in `GET /api/jobs/{id}`); what the library holds is `GET /api/libraries/{id}/items`.',
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
          'The id is made from the name. The source must be an existing ' +
          'folder (422 `fs.not-found`, `fs.not-a-directory`, `fs.unreadable`), the profile a known ' +
          'one (422 `profile.unknown`), exactly one of `type` and `into` is given and `into` names libraries of the right type (422 `library.invalid`), and no other library may have the same source (409 ' +
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
          ...(body.type !== undefined && { type: body.type }),
          ...(body.into !== undefined && { into: body.into }),
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
          'Only what is sent changes; `null` removes `profile`, `mode`, `threshold` or `into`; ' +
          'the type never changes. The id never changes. ' +
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
      const previous = find(store.config, id);
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
      if (request.body.source !== undefined && request.body.source !== previous.source) {
        // What the old folder held is not what the new one holds: the next scan tells.
        items.forget(id);
        ctx.completeness.forget(id);
      }
      return present(updated as LibraryConfig);
    },
  );

  api.delete<{ Params: { id: string } }>(
    '/api/libraries/:id',
    {
      schema: {
        summary: 'Remove a library',
        description:
          'Forgets the library and what its scans saw: its files stay where they are, and the jobs ' +
          'it started keep their history. 409 `library.in-use` while an arrival folder sends its ' +
          'files to it.',
        params: idParams,
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      find(store.config, id);
      await write((current) => {
        find(current, id);
        const user = (current.libraries ?? []).find(
          ({ into }) => into?.movie === id || into?.series === id,
        );
        if (user) {
          throw new ApiError(409, 'library.in-use', { name: user.name });
        }
        return (current.libraries ?? []).filter((library) => library.id !== id);
      });
      // A library made again under the same name gets the same id: it starts empty.
      items.forget(id);
      ctx.completeness.forget(id);
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
          '`GET /api/libraries/{id}/items` and run chosen items with `POST /api/libraries/{id}/execute`. ' +
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

  api.post<{ Params: { id: string }; Body: { path: string } }>(
    '/api/libraries/:id/rescan',
    {
      schema: {
        summary: 'Scan one folder of a library again',
        description:
          'Queues an analysis of a movie’s folder, a show’s or a season’s (or a file), read as it ' +
          'would be inside a scan of the whole source. When it ends, the rows under that path ' +
          'replace the library’s; the others stay. The library must hold a type. 422 ' +
          '`library.outside` for a path that is not strictly inside the source, `fs.not-found` for ' +
          'one that is gone; 409 `library.scan-in-progress` while a scan of this library is queued ' +
          'or running.',
        params: idParams,
        body: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
        response: {
          202: jobSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const library = find(store.config, request.params.id);
      if (library.type === undefined) {
        throw new ApiError(409, 'library.not-typed');
      }
      const path = resolve(request.body.path);
      if (path === library.source || !isInside(path, library.source)) {
        throw new ApiError(422, 'library.outside');
      }
      await stat(path).catch(() => {
        throw new ApiError(422, 'fs.not-found', { path });
      });
      if (jobs.scanPending(library.id, library.source)) {
        throw new ApiError(409, 'library.scan-in-progress');
      }
      const job = jobs.create(path, false, library.id, true);
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send(ctx.presentJob(job));
    },
  );

  api.get<{
    Params: { id: string };
    Querystring: Paging & { state?: ItemFilter; q?: string };
  }>(
    '/api/libraries/:id/items',
    {
      schema: {
        summary: 'What a library holds, as its last scan saw it',
        description:
          'Read from the snapshot a scan leaves, never from the disk: listing costs nothing, and ' +
          'transfers and undos keep it in step. `state` filters (`missing-nfo` and ' +
          '`missing-artwork` look at the files, so one without either shows under both); `q` ' +
          'matches the title or the file name. `counts` do not depend on the filters. ' +
          '`scannedAt` is `null` until a scan of the source has ended; `scan` is the one queued ' +
          'or running. `writes` says which columns the profile gives a page.',
        params: idParams,
        querystring: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ITEM_FILTERS },
            q: { type: 'string', minLength: 1 },
            ...paging,
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['library', 'scannedAt', 'scan', 'counts', 'total', 'items'],
            properties: {
              library: {
                type: 'object',
                required: ['writes'],
                properties: {
                  writes: {
                    type: 'object',
                    required: ['nfo', 'artwork'],
                    properties: { nfo: { type: 'boolean' }, artwork: { type: 'boolean' } },
                  },
                },
              },
              scannedAt: { type: 'string', format: 'date-time', nullable: true },
              scan: {
                type: 'object',
                nullable: true,
                required: ['jobId', 'status', 'progress', 'transfer'],
                properties: {
                  jobId: { type: 'string', format: 'uuid' },
                  status: { type: 'string', enum: ['queued', 'running'] },
                  /** Where the analysis is; null while it waits its turn. */
                  progress: progressSchema,
                  /** The transfer this scan waits behind, if any. */
                  transfer: transferProgressSchema,
                },
              },
              counts: {
                type: 'object',
                required: ['all', ...ITEM_FILTERS, 'missing-episodes', 'missing-show-files'],
                description:
                  'A movie library counts files. A series library counts shows, except `review` and ' +
                  '`unrecognized`: those files belong to no show, so they stay counted as files.',
                properties: Object.fromEntries(
                  ['all', ...ITEM_FILTERS, 'missing-episodes', 'missing-show-files'].map((key) => [
                    key,
                    { type: 'integer' },
                  ]),
                ),
              },
              total: { type: 'integer', description: 'Items matching the filters, for paging.' },
              items: { type: 'array', items: libraryItemSchema },
            },
          },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          422: errorSchema,
        },
      },
    },
    async (request) => {
      const library = find(store.config, request.params.id);
      if (library.type === undefined) {
        // An arrival folder holds what waits to go elsewhere: that is `GET /api/arrivals`.
        throw new ApiError(409, 'library.not-typed');
      }
      const profile = await loadProfile(libraryProfile(library, store.config));
      const { state, q, limit, offset } = request.query;
      const page = items.page(library.id, {
        ...(state && { filter: state }),
        ...(q && { query: q }),
        limit,
        offset,
      });
      const releases = ctx.entries.releasesOf(
        page.items.flatMap((item) => (item.entryId === null ? [] : [item.entryId])),
      );
      const last = jobs.lastScan(library.id, library.source);
      const running = last?.status === 'queued' || last?.status === 'running' ? last : undefined;
      return {
        library: { writes: profileWrites(profile, library.type) },
        // A scan that found nothing leaves no row, yet it did end.
        scannedAt:
          items.scannedAt(library.id) ?? (last?.status === 'done' ? last.finishedAt : null),
        scan: running
          ? {
              jobId: running.id,
              status: running.status,
              progress: ctx.progress.of(running.id) ?? null,
              transfer:
                running.status === 'queued' ? (ctx.progress.runningTransfer() ?? null) : null,
            }
          : null,
        counts: items.counts(library.id, library.type === 'series'),
        total: page.total,
        items: page.items.map((item) =>
          presentItem(item, item.entryId === null ? undefined : releases.get(item.entryId)),
        ),
      };
    },
  );

  api.get<{ Params: { id: string; itemId: string } }>(
    '/api/libraries/:id/items/:itemId',
    {
      schema: {
        summary: 'The page of one item of a library',
        description:
          'The item as the list gives it, plus what the provider knows of the work (summary, ' +
          'runtime in minutes, genres, `posterPath` and `backdropPath` for `GET /api/images`) and ' +
          'what `ffprobe` reads of the file (`file`: codec, audio, size in bytes). Both are ' +
          'best effort: with no TMDB answer or no `ffprobe`, the fields are empty and the page ' +
          'still works. The file is read now unless the snapshot already has it up to date.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' }, itemId: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            required: [
              ...libraryItemSchema.required,
              'overview',
              'runtime',
              'genres',
              'posterPath',
              'backdropPath',
              'file',
            ],
            properties: {
              ...libraryItemSchema.properties,
              overview: { type: 'string', nullable: true },
              runtime: { type: 'integer', nullable: true },
              genres: { type: 'array', items: { type: 'string' } },
              posterPath: { type: 'string', nullable: true },
              backdropPath: { type: 'string', nullable: true },
              file: {
                type: 'object',
                nullable: true,
                required: ['video', 'audio', 'size'],
                properties: {
                  video: { type: 'string', nullable: true },
                  audio: { type: 'string', nullable: true },
                  size: { type: 'integer' },
                },
              },
            },
          },
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) => {
      const library = find(store.config, request.params.id);
      const [item] = items.byItemIds(library.id, [request.params.itemId]);
      if (!item) {
        throw new ApiError(404, 'library.item-not-found');
      }
      const [details, probe] = await Promise.all([
        item.kind !== null && item.tmdbId !== null
          ? ctx.details(item.kind, item.tmdbId).catch(() => null)
          : null,
        probes.now(library.id, item.path),
      ]);
      const file = (probe ?? undefined) && {
        video: probe?.video ?? null,
        audio: probe?.audio ?? null,
        size: probe?.size ?? 0,
      };
      return {
        ...(presentItem(item) as object),
        overview: details?.overview ?? null,
        runtime: details?.kind === 'movie' ? (details.runtime ?? null) : null,
        genres: details?.genres ?? [],
        posterPath: details?.posterPath ?? null,
        backdropPath: details?.backdropPath ?? null,
        file: file ?? null,
      };
    },
  );

  const seriesLibrary = (id: string): LibraryConfig => {
    const library = find(store.config, id);
    if (library.type === undefined) {
      throw new ApiError(409, 'library.not-typed');
    }
    if (library.type !== 'series') {
      throw new ApiError(409, 'library.not-series');
    }
    return library;
  };

  api.get<{
    Params: { id: string };
    Querystring: Paging & {
      q?: string;
      missing?: boolean;
      incomplete?: boolean;
      state?: ItemFilter;
    };
  }>(
    '/api/libraries/:id/shows',
    {
      schema: {
        summary: 'The shows of a series library',
        description:
          'One row per work (files nobody identified are not shows: they are in `GET ' +
          '/api/libraries/{id}/items`, filtered by state). `missing` is the number of aired ' +
          'episodes no file holds, as last counted: `null` until it was (it is counted on ' +
          'opening a show, and in the background when no job runs), never by this request. ' +
          '`missing=true` keeps the shows that lack some; `incomplete=true` those lacking a file the profile ' +
          'writes for the show or a season (`tvshow.nfo`, an image: see `nfo`, `poster`, `fanart`); ' +
          '`state` keeps the shows holding a file of that state, as `GET /api/libraries/{id}/items` filters. 409 `library.not-series` for a movie library.',
        params: idParams,
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 1 },
            missing: { type: 'boolean' },
            incomplete: { type: 'boolean' },
            state: { type: 'string', enum: [...ITEM_FILTERS] },
            ...paging,
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['total', 'items'],
            properties: {
              total: { type: 'integer' },
              items: { type: 'array', items: showSchema },
            },
          },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request) => {
      const library = seriesLibrary(request.params.id);
      const { q, missing, incomplete, state, limit, offset } = request.query;
      return items.shows(library.id, {
        ...(q && { query: q }),
        ...(missing && { missing }),
        ...(incomplete && { incomplete }),
        ...(state && { state }),
        limit,
        offset,
      });
    },
  );

  const presentEpisode = (episode: EpisodeReport): unknown => ({
    season: episode.season,
    episode: episode.episode,
    title: episode.title,
    airDate: episode.airDate,
    state: episode.state,
    item: episode.item && presentItem(episode.item),
  });

  api.get<{ Params: { id: string; tmdbId: number } }>(
    '/api/libraries/:id/shows/:tmdbId',
    {
      schema: {
        summary: 'A show, season by season, with the episodes it lacks',
        description:
          'What the library holds of the show against what the provider lists (cached, one request ' +
          'per season at most). An episode is `present` (`item` is its file; a multi-episode file ' +
          'serves each of its episodes), `missing` (aired, no file), `unaired` (not out, or no ' +
          'date: never counted), or `extra` (a file the provider does not know). Season 0 ' +
          '(specials) lists what is there and is never missing. Counting here refreshes the ' +
          'number `GET /api/libraries/{id}/shows` gives. When the provider cannot be asked, ' +
          '`determined` is `false` and the seasons list only the files.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' }, tmdbId: { type: 'integer' } },
        },
        response: {
          200: {
            type: 'object',
            required: [
              'tmdbId',
              'title',
              'year',
              'overview',
              'genres',
              'posterPath',
              'backdropPath',
              'status',
              'determined',
              'missing',
              'seasons',
            ],
            properties: {
              tmdbId: { type: 'integer' },
              title: { type: 'string', nullable: true },
              year: { type: 'integer', nullable: true },
              overview: { type: 'string', nullable: true },
              genres: { type: 'array', items: { type: 'string' } },
              posterPath: { type: 'string', nullable: true },
              backdropPath: { type: 'string', nullable: true },
              status: { type: 'string', nullable: true, description: 'The provider’s wording.' },
              determined: { type: 'boolean' },
              missing: { type: 'integer', nullable: true },
              seasons: { type: 'array', items: seasonSchema },
            },
          },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const library = seriesLibrary(request.params.id);
      const { tmdbId } = request.params;
      const files = items.ofShow(library.id, tmdbId);
      if (files.length === 0) {
        throw new ApiError(404, 'library.item-not-found');
      }
      const counted = await ctx.completeness.report(library.id, tmdbId).catch(() => null);
      const details = counted?.details;
      const seasons =
        counted?.seasons ??
        // Without the provider only the files can be told: grouped by season, none missing.
        compare(files, [], [], '0000-00-00');
      // The list of shows follows what this page just counted.
      return {
        tmdbId,
        title: details?.title ?? files[0]?.title ?? null,
        year: yearOf(details?.firstAirDate) ?? files[0]?.year ?? null,
        overview: details?.overview ?? null,
        genres: details?.genres ?? [],
        posterPath: details?.posterPath ?? null,
        backdropPath: details?.backdropPath ?? null,
        status: details?.status ?? null,
        determined: counted !== null,
        missing: counted ? missingOf(counted.seasons) : null,
        seasons: seasons.map((season) => ({
          season: season.season,
          name: season.name,
          posterPath: season.posterPath ?? null,
          poster: ctx.seriesFiles.get(library.id, tmdbId, season.season)?.poster ?? null,
          missing: season.missing,
          episodes: season.episodes.map(presentEpisode),
        })),
      };
    },
  );

  api.post<{
    Params: { id: string };
    Body: { items: string[]; dryRun?: boolean; version?: boolean; screenSize?: string };
  }>(
    '/api/libraries/:id/execute',
    {
      schema: {
        summary: 'Rename or complete a selection of the items of a library',
        description:
          'Runs what the last scan planned for the chosen items (`id` of `GET /api/libraries/{id}/items`): ' +
          'the videos to rename, and the NFO and images missing beside the ones already in place. ' +
          'It writes only what is planned and never overwrites a file. One plan per scan job the ' +
          'items come from, under one batch. With `dryRun` every precondition is checked and nothing ' +
          'is written (200, the report of `POST /api/plans/{id}/execute`, entries being the items’ ' +
          '`entryId`); otherwise the transfers are queued (202) and the batch appears in the history. ' +
          'Items with nothing to do (done, never scanned, unknown) are listed in `skipped`; 409 ' +
          '`library.nothing-to-do` when none is left. With `version`, the movies chosen are renamed ' +
          'to say their version (`Title (2021) - 2160p`) even when they are already named as the ' +
          'profile wants; the size comes from the file name, and a movie whose name gives none is ' +
          'skipped (409 `library.version-unavailable` when that is all of them). `screenSize` ' +
          '(`1080p`, `2160p`…) names the size when the file name gives none, or corrects it.',
        params: idParams,
        body: {
          type: 'object',
          required: ['items'],
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_SELECTION,
              items: { type: 'string', maxLength: 64 },
            },
            dryRun: { type: 'boolean' },
            version: { type: 'boolean' },
            screenSize: sizeSchema,
          },
        },
        response: {
          200: selectionReportSchema,
          202: selectionRunSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const library = find(store.config, request.params.id);
      if (library.type === undefined) {
        throw new ApiError(409, 'library.not-typed');
      }
      const rows = items.byItemIds(library.id, request.body.items);
      const skipped = new Set(request.body.items);
      if (request.body.version) {
        // The files that can take a version: movies and episodes nobody settled, whatever the scan made of them.
        const eligible = new Map<string, Set<string>>();
        const byJob = new Map<string, string[]>();
        for (const row of rows) {
          const { scanJobId, entryId } = row;
          if (scanJobId === null || entryId === null) {
            continue;
          }
          if (!eligible.has(scanJobId)) {
            eligible.set(scanJobId, entries.versionableIds(scanJobId));
          }
          if (eligible.get(scanJobId)?.has(entryId)) {
            byJob.set(scanJobId, [...(byJob.get(scanJobId) ?? []), entryId]);
          }
        }
        const ready = new Map<string, Map<string, PlanItem>>();
        let refused = 0;
        const named = new Set<string>();
        for (const [jobId, entryIds] of byJob) {
          const planned = await ctx.batch.planVersions(jobId, entryIds, request.body.screenSize);
          refused += planned.refused.size;
          if (planned.ready.size > 0) {
            ready.set(jobId, planned.ready);
          }
          for (const entryId of planned.ready.keys()) {
            named.add(entryId);
          }
        }
        if (ready.size === 0) {
          throw new ApiError(
            409,
            refused > 0 ? 'library.version-unavailable' : 'library.nothing-to-do',
          );
        }
        for (const row of rows) {
          if (row.entryId !== null && named.has(row.entryId)) {
            skipped.delete(itemId(row.path));
          }
        }
        if (request.body.dryRun) {
          const reports = await Promise.all(
            [...ready].map(([jobId, plans]) => ctx.batch.dryRun(jobId, [...plans.keys()], plans)),
          );
          return {
            batchId: reports[0]?.batchId ?? '',
            dryRun: true,
            items: reports.flatMap((report) => report.items),
            skipped: [...skipped],
          };
        }
        const executions = [...ready].map(([jobId, plans]) => {
          ctx.batch.commitVersions(plans);
          return ctx.batch.enqueue(jobId, [...plans.keys()]);
        });
        events.emit('jobs');
        runner.kick();
        return reply.code(202).send({ executions, skipped: [...skipped] });
      }
      // What the scan planned, by the job that scanned it: its entries are what can still run.
      const byJob = new Map<string, string[]>();
      const runnable = new Map<string, Set<string>>();
      for (const row of rows) {
        const { scanJobId, entryId } = row;
        if (scanJobId === null || entryId === null) {
          continue;
        }
        if (!runnable.has(scanJobId)) {
          runnable.set(scanJobId, entries.executableIds(scanJobId));
        }
        if (runnable.get(scanJobId)?.has(entryId)) {
          const ids = byJob.get(scanJobId) ?? [];
          ids.push(entryId);
          byJob.set(scanJobId, ids);
          skipped.delete(itemId(row.path));
        }
      }
      if (byJob.size === 0) {
        throw new ApiError(409, 'library.nothing-to-do');
      }
      if (request.body.dryRun) {
        const reports = await Promise.all(
          [...byJob].map(([jobId, entryIds]) => ctx.batch.dryRun(jobId, entryIds)),
        );
        return {
          batchId: reports[0]?.batchId ?? '',
          dryRun: true,
          items: reports.flatMap((report) => report.items),
          skipped: [...skipped],
        };
      }
      const executions = [...byJob].map(([jobId, entryIds]) => ctx.batch.enqueue(jobId, entryIds));
      events.emit('jobs');
      runner.kick();
      return reply.code(202).send({ executions, skipped: [...skipped] });
    },
  );
}
