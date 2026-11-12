import { existsSync } from 'node:fs';
import { join } from 'node:path';
import swagger from '@fastify/swagger';
import { KinoshelfError, SqliteJournal, type ImageFetcher, type Journal } from '@kinoshelf/core';
import type { Database } from '@kinoshelf/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteHttpCache } from '@kinoshelf/provider-tmdb';
import { ApiError } from './api-error.js';
import { hasApiKey, isValidApiKey } from './auth.js';
import { serverCommand } from './command.js';
import { MatchTracker } from './matches.js';
import { ProgressTracker } from './progress.js';
import { sharesFolder } from './system-paths.js';
import { EntryStore } from './entries.js';
import { EventBus, registerEventRoutes } from './events.js';
import { ExecutionStore } from './executions.js';
import { History } from './history.js';
import { registerImageRoutes } from './images.js';
import { JobStore } from './jobs.js';
import { createTranslator, detectLocale } from '@kinoshelf/i18n';
import type { DeliveryOptions } from './notify/delivery.js';
import { Notifier } from './notify/notifier.js';
import { revertedFolders } from './notify/paths.js';
import { createProcessor, type ProcessorDeps } from './processor.js';
import { forgetReplacedScans, purgeHistory, type LibraryScan } from './purge.js';
import { registerFsRoutes } from './fs-routes.js';
import { Artwork } from './artwork.js';
import { registerArtworkRoutes } from './artwork-routes.js';
import { registerLibraryRoutes } from './library-routes.js';
import { jobPresenter, registerRoutes } from './routes.js';
import { Completeness, CompletenessStore } from './completeness.js';
import { SeriesFiles, SeriesFilesStore } from './series-files.js';
import { ffprobe, ProbeQueue, type Prober } from './probe.js';
import { LibraryItemStore, LibrarySnapshot } from './library-items.js';
import { JobRunner, type ExecutionRunner, type JobProcessor } from './runner.js';
import { healthSchema } from './schemas.js';
import { Service } from './service.js';
import { isValidSession } from './sessions.js';
import { OnboardingStore } from './onboarding.js';
import { registerOnboardingRoutes } from './onboarding-routes.js';
import { PlexTv, type PlexTvOptions } from './notify/plex-auth.js';
import { registerPlexRoutes } from './plex-routes.js';
import { PlexSession } from './plex-session.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { ConfigStore } from './settings.js';
import { registerWatchRoutes } from './watch-routes.js';
import { FolderWatcher, watcherSettings } from './watcher.js';
import { registerWeb } from './web.js';
import { allowedHosts } from './local-host.js';
import { AttemptLimiter } from './attempts.js';
import { registerSessionRoutes, sameOrigin, sessionToken } from './session-routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The queue worker; tests await `jobs.idle()` instead of sleeping. */
    jobs: JobRunner;
    /** Tells the targets of `notify`; tests await `notifier.idle()` for what is in flight. */
    notifier: Notifier;
    /** Reads the videos' codecs in the background; tests await `probes.idle()`. */
    probes: ProbeQueue;
    /** Counts the missing episodes of the shows in the background; tests await `completeness.idle()`. */
    completeness: Completeness;
    /** Looks for the NFO and images of the shows in the background; tests await `seriesFiles.idle()`. */
    seriesFiles: SeriesFiles;
    /** The folder watcher; tests await `watcher.idle()`. */
    watcher: FolderWatcher;
  }
}

export interface AppOptions extends Omit<ProcessorDeps, 'database'> {
  readonly version: string;
  /** Already migrated (see `database.ts`). */
  readonly database: Database;
  readonly logger?: boolean;
  /** Replaces the real pipeline, for tests. */
  readonly processor?: JobProcessor;
  /** Wraps the real transfer, for tests that must hold one open (a gate before it runs). */
  readonly executeWith?: (run: ExecutionRunner) => ExecutionRunner;
  /**
   * Days after which a finished job, all its files settled, is forgotten. Checked at start and
   * every day. Unset or 0 keeps everything.
   */
  readonly retentionDays?: number;
  /** How notifications are delivered (retries, timeout); tests make them instant. */
  readonly delivery?: DeliveryOptions;
  /** Replaces plex.tv's network and clock, for tests (the address is `KINOSHELF_PLEX_TV_URL`). */
  readonly plexTv?: PlexTvOptions;
  /** The built web UI to serve, if any (see `findWebRoot`). */
  readonly webRoot?: string;
  /** Replaces the network for poster downloads, for tests. */
  readonly fetch?: typeof fetch;
  /** Replaces the download of the provider's images when one is replaced, for tests. */
  readonly fetchImage?: ImageFetcher;
  /** Replaces `ffprobe`, for tests. */
  readonly prober?: Prober;
  /** Wraps or replaces the journal, for tests. */
  readonly journal?: (database: Database) => Journal;
}

/** The core's typed errors are the client's to fix or an upstream's fault, not a server bug. */
function statusOf(error: KinoshelfError): number {
  const { code } = error.info;
  return code.startsWith('tmdb.') ? 502 : code.startsWith('config.') ? 409 : 422;
}

/**
 * `KINOSHELF_TRUST_PROXY`: which reverse proxy may say what the browser asked for
 * (`X-Forwarded-For`, `-Proto`, `-Host`). Unset, nobody: the headers are ignored, since anyone
 * could send them. `true` trusts any, anything else is a comma-separated list of addresses or
 * ranges (`127.0.0.1,10.0.0.0/8`).
 */
export function trustProxyOf(value: string | undefined): boolean | string {
  const setting = value?.trim() ?? '';
  if (setting === '' || setting === 'false') {
    return false;
  }
  if (setting === 'true') {
    return true;
  }
  return setting;
}

/**
 * Builds the HTTP layer without listening, so tests can drive it with `inject`. Routes stay thin:
 * the logic lives in the core. Responses carry codes and parameters, never translated text.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // An ISO date rather than pino's epoch milliseconds, which nobody reads in `docker logs`.
    logger: options.logger ? { timestamp: () => `,"time":"${new Date().toISOString()}"` } : false,
    trustProxy: trustProxyOf(options.env.KINOSHELF_TRUST_PROXY),
    // Fastify strips unknown fields by default; a client sending `dryRun` must hear it is not
    // supported rather than believe it was honored.
    ajv: { customOptions: { removeAdditional: false } },
  });
  // Every answer is what its type says: a JSON error never gets sniffed into a page.
  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('x-content-type-options', 'nosniff');
    done(null, payload);
  });
  const events = new EventBus();
  // Where each analysis is, told to the clients at most twice a second (see `ProgressTracker`).
  // A topic of its own: `jobs` makes every list reload, which a scan must not do twice a second.
  const progress = new ProgressTracker(() => {
    events.emit('progress');
  });
  const entries = new EntryStore(options.database);
  const executions = new ExecutionStore(options.database);
  const jobs = new JobStore(options.database, entries, executions);
  const journal = options.journal?.(options.database) ?? new SqliteJournal(options.database);
  const items = new LibraryItemStore(options.database);
  const typedScans = (): LibraryScan[] =>
    (options.config.libraries ?? []).flatMap((library) =>
      library.type ? [{ libraryId: library.id, source: library.source }] : [],
    );
  const snapshot = new LibrarySnapshot({
    config: () => options.config,
    jobs,
    entries,
    store: items,
    changed: (libraryId) => {
      completeness.touch(libraryId);
      seriesFiles.touch(libraryId);
    },
  });
  const matches = new MatchTracker((ended) => {
    events.emit(...(ended ? (['progress', 'arrivals'] as const) : (['progress'] as const)));
  });
  const service = new Service({
    ...options,
    matches,
    jobs,
    entries,
    executions,
    journal,
    snapshot,
  });
  const history = new History(journal, executions, jobs);
  const plexTvUrl = (options.env.KINOSHELF_PLEX_TV_URL ?? '').trim();
  const plexSession = new PlexSession(
    options.database,
    new PlexTv({ ...(plexTvUrl !== '' && { clientsUrl: plexTvUrl }), ...options.plexTv }),
    options.plexTv?.now,
  );
  const notifier = new Notifier({
    plexSession,
    config: options.config,
    translate: createTranslator(detectLocale(undefined, options.config.locale, options.env)),
    log: {
      info: (message) => {
        app.log.info(message);
      },
      warn: (message) => {
        app.log.warn(message);
      },
      error: (error) => {
        app.log.error(error);
      },
    },
    ...(options.delivery && { delivery: options.delivery }),
  });
  const configStore = new ConfigStore(options.configDir, options.config, (config) => {
    watcher.configure(watcherSettings(config));
    notifier.configure(
      config,
      createTranslator(detectLocale(undefined, config.locale, options.env)),
    );
  });
  // Reads the videos' codecs once nothing else needs the disk; `runner` is only used when it runs.
  const probes = new ProbeQueue({
    store: items,
    prober: options.prober ?? ffprobe,
    busy: () => runner.busy,
    onError: (error) => {
      app.log.warn(error, 'Could not read a video with ffprobe');
    },
  });
  // Counts the episodes each show lacks, with the same patience: after the jobs, never during.
  const completeness = new Completeness({
    items,
    store: new CompletenessStore(options.database),
    fetch: (tmdbId) => service.seasons(tmdbId),
    busy: () => runner.busy,
    onError: (error) => {
      app.log.warn(error, 'Could not count the missing episodes of a show');
    },
  });
  const seriesFilesStore = new SeriesFilesStore(options.database);
  // Looks for the files of a show and of a season once a library's rows change.
  const seriesFiles = new SeriesFiles({
    config: () => options.config,
    items,
    store: seriesFilesStore,
    onError: (error) => {
      app.log.warn(error, 'Could not look for the files of a show');
    },
    refreshed: () => {
      events.emit('history');
    },
  });
  const transfer: ExecutionRunner = async (execution) => {
    try {
      return await service.run(
        execution,
        (done, _total, path) => {
          progress.transferred(execution.id, done, path);
        },
        (total) => {
          progress.startTransfer(execution.id, total);
        },
      );
    } finally {
      progress.finishTransfer(execution.id);
    }
  };
  const runner = new JobRunner(
    jobs,
    executions,
    options.processor ??
      createProcessor({
        ...options,
        progress,
        onUnreadable: (path, error) => {
          app.log.warn(error, `Left out a folder that cannot be read: ${path}`);
        },
      }),
    options.executeWith ? options.executeWith(transfer) : transfer,
    {
      // A scan runs beside a transfer only when they share no folder (see `JobRunner`).
      overlaps: (job, execution) => {
        const touched = service.touches(execution);
        return !touched || touched.some((root) => sharesFolder(root, job.path));
      },
      scanned: async (job) => {
        // Before the snapshot and the notification: a file is planned for the library it goes to.
        await service.planArrivals(job);
        snapshot.scanned(job);
        if (options.retentionDays) {
          forgetReplacedScans(options.database, typedScans());
        }
        if (job.libraryId) {
          probes.refresh(job.libraryId);
        }
      },
      idle: () => {
        probes.kick();
        completeness.kick();
      },
      jobDone: (job) => {
        notifier.jobDone(job, entries.summary(job.id));
      },
      jobFailed: (job, error) => {
        notifier.jobFailed(job, error);
      },
      executionDone: (job, execution, outcome) => {
        notifier.executionFinished(job, execution, outcome);
      },
      executionFailed: (job, execution, error) => {
        notifier.executionFailed(job, execution, error);
      },
      changed: (...topics) => {
        events.emit(...topics);
      },
    },
    (error) => {
      app.log.error(error);
    },
  );
  // The same queue as `POST /api/jobs`, fed by a folder instead of a client.
  const watcher = new FolderWatcher({
    database: options.database,
    submit: (path, apply, libraryId) => {
      jobs.create(path, apply, libraryId);
      events.emit('jobs');
      runner.kick();
    },
    log: {
      warn: (message) => {
        app.log.warn(message);
      },
    },
  });
  app.decorate('jobs', runner);
  app.decorate('probes', probes);
  app.decorate('completeness', completeness);
  app.decorate('seriesFiles', seriesFiles);
  app.decorate('watcher', watcher);
  app.decorate('notifier', notifier);

  let purgeTimer: NodeJS.Timeout | undefined;
  let closeStreams = (): void => undefined;
  const purge = (): void => {
    const purged = purgeHistory(options.database, {
      olderThanDays: options.retentionDays ?? 0,
      scans: typedScans(),
    });
    if (purged.jobs > 0) {
      app.log.info(purged, 'Forgot the history of finished jobs');
    }
    // Disposable, unlike the history: expired answers go whatever the retention.
    const expired = new SqliteHttpCache(options.database).prune(Date.now());
    if (expired > 0) {
      app.log.info({ expired }, 'Forgot the expired TMDB answers');
    }
  };
  app.addHook('onReady', () => {
    runner.start();
    const typed = (options.config.libraries ?? []).flatMap((library) =>
      library.type ? [library.id] : [],
    );
    probes.rebuild(typed);
    completeness.rebuild(typed);
    typed.forEach((id) => {
      seriesFiles.touch(id);
    });
    watcher.configure(watcherSettings(options.config));
    purge();
    // Not kept alive by the timer: the process leaves when the server closes.
    purgeTimer = setInterval(purge, 86_400_000).unref();
  });
  // `preClose` runs before the server waits for its connections: an event stream never ends alone.
  app.addHook('preClose', () => {
    closeStreams();
  });
  app.addHook('onClose', async () => {
    clearInterval(purgeTimer);
    progress.close();
    watcher.stop();
    await watcher.idle();
    await runner.stop();
    await seriesFiles.idle();
    await probes.stop();
    await completeness.stop();
    await notifier.idle();
  });

  app.setErrorHandler(
    (error: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
      if (error instanceof ApiError) {
        return reply
          .code(error.status)
          .send({ error: { code: error.code, ...(error.params && { params: error.params }) } });
      }
      if (error instanceof KinoshelfError) {
        return reply.code(statusOf(error)).send({ error: error.info });
      }
      if (error.validation) {
        return reply
          .code(400)
          .send({ error: { code: 'request.invalid', params: { detail: error.message } } });
      }
      if (error.statusCode && error.statusCode < 500) {
        return reply
          .code(error.statusCode)
          .send({ error: { code: 'request.rejected', params: { detail: error.message } } });
      }
      app.log.error(error);
      return reply.code(500).send({ error: { code: 'internal.unexpected' } });
    },
  );

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Kinoshelf',
        description: 'Identify, rename and enrich a video library already on disk.',
        version: options.version,
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            description:
              'Set with KINOSHELF_API_KEY, or create one with `kinoshelf-server api-key create`.',
          },
          session: {
            type: 'apiKey',
            in: 'cookie',
            name: 'kinoshelf_session',
            description: 'Opened by the web UI with `POST /api/session`.',
          },
        },
      },
      security: [{ apiKey: [] }, { session: [] }],
    },
  });

  // Public on purpose: Docker's HEALTHCHECK and monitors call it without a key.
  app.get('/health', { schema: { security: [], response: { 200: healthSchema } } }, () => ({
    status: 'ok' as const,
    version: options.version,
  }));

  // Wrong keys, per address, whether typed on the sign-in page or sent as a Bearer token.
  const attempts = new AttemptLimiter();
  registerSessionRoutes(app, options.database, allowedHosts(options.env), attempts);

  await app.register((api, _options, done) => {
    api.addHook('onRequest', (request, reply, done) => {
      // Checked per request so `api-key create` takes effect without a restart.
      if (!hasApiKey(options.database)) {
        void reply
          .code(503)
          .send({ error: { code: 'auth.not-configured', params: { command: serverCommand() } } });
        return;
      }
      const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
      if (match?.[1]) {
        const wait = attempts.waitFor(request.ip);
        if (wait > 0) {
          void reply
            .code(429)
            .header('retry-after', String(wait))
            .send({ error: { code: 'auth.too-many-attempts', params: { seconds: wait } } });
          return;
        }
        if (isValidApiKey(options.database, match[1])) {
          attempts.succeeded(request.ip);
          done();
          return;
        }
        attempts.failed(request.ip);
        request.log.warn({ ip: request.ip }, 'Refused a request with a wrong API key');
      }
      // A browser session is only honored with the cookie's own safeguards: a write must come
      // from the UI's origin.
      const token = sessionToken(request);
      const safe = request.method === 'GET' || request.method === 'HEAD';
      if (
        token !== undefined &&
        isValidSession(options.database, token) &&
        (safe || sameOrigin(request))
      ) {
        done();
        return;
      }
      void reply
        .code(401)
        .header('www-authenticate', 'Bearer')
        .send({ error: { code: 'auth.unauthorized' } });
    });

    // Behind the key like the rest of /api: the contract is in the public repository anyway, but
    // a stranger has no reason to be told what this server answers.
    api.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());
    closeStreams = registerEventRoutes(api, events);
    registerSettingsRoutes(api, {
      store: configStore,
      database: options.database,
      env: options.env,
      events,
      service,
      plexSession,
    });
    registerPlexRoutes(api, { session: plexSession, store: configStore, events });
    registerOnboardingRoutes(api, {
      store: new OnboardingStore(options.database),
      config: configStore,
      env: options.env,
      events,
      hasWork: () => jobs.list(1).length > 0 || history.hasBatch(),
    });
    registerFsRoutes(api);
    const artwork = new Artwork({
      config: () => options.config,
      journal,
      items,
      snapshot,
      backupDir: join(options.configDir, 'replaced'),
      listImages: (kind, id) => service.listImages(kind, id),
      listStills: (id, season, episode) => service.listStills(id, season, episode),
      imageUrl: (path, size) => service.imageUrl(path, size),
      touched: (libraryId) => {
        seriesFiles.touch(libraryId);
      },
      changed: (folder) => {
        notifier.foldersChanged([folder]);
      },
      ...(options.fetchImage && { fetchImage: options.fetchImage }),
    });
    registerLibraryRoutes(api, {
      config: configStore,
      artwork,
      jobs,
      entries,
      items,
      executions,
      probes,
      completeness,
      seriesFiles: seriesFilesStore,
      batch: {
        planVersions: (jobId, entryIds, screenSize) =>
          service.planVersions(jobId, entryIds, screenSize),
        commitVersions: (ready) => {
          service.commitVersions(ready);
        },
        dryRun: (jobId, entryIds, overrides) => service.dryRun(jobId, entryIds, overrides),
        enqueue: (jobId, entryIds) => service.enqueue(jobId, entryIds),
      },
      details: (kind, id) => service.details(kind, id),
      events,
      runner,
      presentJob: jobPresenter({ jobs, entries, executions, progress }),
      progress,
    });
    registerArtworkRoutes(api, {
      config: () => options.config,
      artwork,
      items,
      events,
    });
    registerWatchRoutes(api, watcher);
    registerImageRoutes(api, {
      cacheDir: join(options.configDir, 'images'),
      ...((options.env.KINOSHELF_TMDB_IMAGES_URL ?? '') !== '' && {
        baseUrl: (options.env.KINOSHELF_TMDB_IMAGES_URL ?? '').replace(/\/+$/, ''),
      }),
      ...(options.fetch && { fetch: options.fetch }),
    });
    registerRoutes(api, {
      jobs,
      entries,
      executions,
      service,
      runner,
      notifier,
      reverted: (report) => {
        notifier.foldersChanged(
          revertedFolders(report.entries, configStore.config.libraries ?? [], existsSync),
        );
      },
      events,
      history,
      progress,
    });
    done();
  });

  if (options.webRoot) {
    await registerWeb(app, options.webRoot);
  }

  await app.ready();
  return app;
}
