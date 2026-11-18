<script lang="ts">
  import { onDestroy } from 'svelte';
  import { describeError, formatBytes } from '@kinoshelf/i18n';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { onTopics } from '../lib/events.svelte.js';
  import { formatDate } from '../lib/history.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import type { DatabaseTask, MaintenanceFigures } from '../lib/maintenance.js';
  import { resource } from '../lib/resource.svelte.js';
  import ActionCard from './ActionCard.svelte';
  import ReplacedCard from './ReplacedCard.svelte';

  // Counts change as scans and jobs end: read them again on those events.
  const figures = resource(
    () => api.get<MaintenanceFigures>('/api/maintenance'),
    ['ready', 'history', 'jobs'],
  );

  let failure = $state<unknown>(undefined);
  let busy = $state<'purge' | 'caches' | 'imdb' | 'backup' | 'vacuum' | undefined>(undefined);
  let results = $state<{ purge?: string; caches?: string; imdb?: string }>({});

  const known = $derived(figures.value);
  const number = (value: number): string => new Intl.NumberFormat(locale.value).format(value);
  const size = (bytes: number): string => formatBytes(bytes, locale.value);
  const taskOf = (kind: DatabaseTask['kind']): DatabaseTask | undefined =>
    known?.databaseTasks.find((task) => task.kind === kind);
  const running = $derived(
    (known?.databaseTasks.some(({ status }) => status === 'running') ?? false) ||
      known?.replacedTask?.status === 'running' ||
      known?.imdbNfoTask?.status === 'running',
  );
  const imdb = $derived(known?.imdbRatings);
  const nfoTask = $derived(known?.imdbNfoTask ?? undefined);
  const nfoRunning = $derived(nfoTask?.status === 'running');
  const nfoReady = $derived((imdb?.enabled ?? false) && (imdb?.entries ?? 0) > 0);
  const nfoFigure = $derived(
    imdb &&
      t(
        !imdb.enabled
          ? 'web.maintenance.imdb-nfo.state.off'
          : imdb.entries === 0
            ? 'web.maintenance.imdb-nfo.state.waiting'
            : 'web.maintenance.imdb-nfo.state.ready',
      ),
  );
  const nfoResult = $derived(
    nfoTask?.status === 'done' && nfoTask.result
      ? t('web.maintenance.imdb-nfo.done', {
          count: nfoTask.result.rewritten,
          already: nfoTask.result.already,
          noRating: nfoTask.result.noRating,
          kept: nfoTask.result.kept,
        })
      : undefined,
  );
  const imdbDownloading = $derived(imdb?.task?.status === 'running');
  const imdbFigure = $derived(
    imdb &&
      (imdbDownloading
        ? t('web.maintenance.imdb.state.downloading', {
            count: imdb.task?.done ?? 0,
            amount: number(imdb.task?.done ?? 0),
          })
        : imdb.fetchedAt === null
          ? t(
              imdb.enabled
                ? 'web.maintenance.imdb.state.waiting'
                : 'web.maintenance.imdb.state.none',
            )
          : t('web.maintenance.imdb.state.held', {
              count: imdb.entries,
              amount: number(imdb.entries),
              date: formatDate(imdb.fetchedAt, locale.value),
              setting: t(
                imdb.enabled
                  ? 'web.maintenance.imdb.setting.on'
                  : 'web.maintenance.imdb.setting.off',
              ),
            })),
  );

  // A backup or a compaction goes on in the server: follow it, also when started from another tab.
  // Between the click and the first answer the task may end, and announce it, before the answer comes.
  let starting = $state(false);
  const stopProgress = onTopics(['progress'], () => {
    if (running || starting || imdbDownloading) {
      void figures.reload();
    }
  });
  onDestroy(stopProgress);

  async function run(action: 'purge' | 'caches' | 'imdb'): Promise<void> {
    busy = action;
    failure = undefined;
    try {
      const { removed } =
        action === 'purge'
          ? await api.post<{ removed: number }>('/api/maintenance/purge-hidden')
          : action === 'imdb'
            ? await api.delete<{ removed: number }>('/api/maintenance/imdb-ratings')
            : await api.delete<{ removed: number }>('/api/tmdb/cache');
      results[action] = t(`web.maintenance.${action}.done`, { count: removed });
      await figures.reload();
    } catch (error) {
      failure = error;
    } finally {
      busy = undefined;
    }
  }

  async function startDatabase(kind: DatabaseTask['kind']): Promise<void> {
    starting = true;
    failure = undefined;
    try {
      await api.post<DatabaseTask>(`/api/maintenance/${kind}`);
      await figures.reload();
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }

  async function addImdbToNfo(): Promise<void> {
    starting = true;
    failure = undefined;
    try {
      await api.post('/api/maintenance/imdb-nfo');
      await figures.reload();
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }

  async function emptyReplaced(all: boolean): Promise<void> {
    starting = true;
    failure = undefined;
    try {
      await api.post('/api/maintenance/empty-replaced', { all });
      await figures.reload();
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }

  const percentOf = (task: DatabaseTask | undefined): number | null =>
    task && task.total > 0 ? Math.round((task.done / task.total) * 100) : null;

  const backup = $derived(taskOf('backup'));
  const vacuum = $derived(taskOf('vacuum'));
  const doneText = (task: DatabaseTask | undefined): string | undefined => {
    if (task?.status !== 'done') {
      return undefined;
    }
    if (task.backup) {
      return t('web.maintenance.backup.done', {
        name: task.backup.file.name,
        size: size(task.backup.file.bytes),
        removed: task.backup.removed,
      });
    }
    return task.size
      ? t('web.maintenance.vacuum.done', {
          before: size(task.size.before),
          after: size(task.size.after),
        })
      : undefined;
  };
  const failureText = (task: DatabaseTask | undefined): string | undefined =>
    task?.status === 'failed' && task.error ? describeError(t, task.error) : undefined;
</script>

<section class="block" aria-labelledby="maintenance-actions">
  <h2 id="maintenance-actions">{t('web.maintenance.actions.title')}</h2>

  {#if failure ?? figures.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure ?? figures.failure)}</p>
  {/if}

  <div class="grid">
    <ActionCard
      title={t('web.maintenance.purge.title')}
      text={t('web.maintenance.purge.text')}
      does={t('web.maintenance.purge.does')}
      button={t('web.maintenance.purge.button')}
      figure={known && t('web.maintenance.purge.state', { count: known.hiddenAnalyses })}
      result={results.purge}
      busy={busy === 'purge'}
      disabled={busy !== undefined || known?.hiddenAnalyses === 0}
      onrun={() => void run('purge')}
    />
    <ActionCard
      title={t('web.maintenance.caches.title')}
      text={t('web.maintenance.caches.text')}
      does={t('web.maintenance.caches.does')}
      button={t('web.maintenance.caches.button')}
      figure={known &&
        t('web.maintenance.caches.state', {
          count: known.tmdbCache.entries,
          size: size(known.tmdbCache.bytes),
        })}
      result={results.caches}
      busy={busy === 'caches'}
      disabled={busy !== undefined || known?.tmdbCache.entries === 0}
      onrun={() => void run('caches')}
    />
    <ActionCard
      title={t('web.maintenance.imdb.title')}
      text={t('web.maintenance.imdb.text')}
      does={t('web.maintenance.imdb.does')}
      button={t('web.maintenance.imdb.button')}
      figure={imdbFigure}
      result={results.imdb}
      failure={imdb?.task?.status === 'failed' && imdb.task.error
        ? describeError(t, imdb.task.error)
        : undefined}
      busy={busy === 'imdb' || imdbDownloading}
      disabled={busy !== undefined || imdbDownloading || imdb?.entries === 0}
      link={{ href: '/settings#processing', label: t('web.maintenance.imdb.settings') }}
      onrun={() => void run('imdb')}
    />
    <ActionCard
      title={t('web.maintenance.imdb-nfo.title')}
      text={t('web.maintenance.imdb-nfo.text')}
      does={t('web.maintenance.imdb-nfo.does')}
      button={t('web.maintenance.imdb-nfo.button')}
      figure={nfoFigure}
      result={nfoResult}
      failure={nfoTask?.status === 'failed' && nfoTask.error
        ? describeError(t, nfoTask.error)
        : undefined}
      busy={nfoRunning}
      percent={nfoTask && nfoTask.total > 0 && nfoRunning
        ? Math.round((nfoTask.done / nfoTask.total) * 100)
        : null}
      disabled={!nfoReady || running || starting || busy !== undefined}
      link={nfoTask?.result?.batchId
        ? { href: `/history/${nfoTask.result.batchId}`, label: t('web.imdb-nfo.history') }
        : { href: '/settings#processing', label: t('web.maintenance.imdb.settings') }}
      onrun={() => void addImdbToNfo()}
    />
    <ActionCard
      title={t('web.maintenance.vacuum.title')}
      text={t('web.maintenance.vacuum.text')}
      does={t('web.maintenance.vacuum.does')}
      button={t('web.maintenance.vacuum.button')}
      figure={known && t('web.maintenance.vacuum.state', { size: size(known.databaseBytes) })}
      result={doneText(vacuum)}
      failure={failureText(vacuum)}
      busy={vacuum?.status === 'running'}
      percent={null}
      disabled={running || starting}
      onrun={() => void startDatabase('vacuum')}
    />
    <ActionCard
      title={t('web.maintenance.backup.title')}
      text={t('web.maintenance.backup.text')}
      does={t('web.maintenance.backup.does')}
      button={t('web.maintenance.backup.button')}
      figure={known &&
        t('web.maintenance.backup.state', { count: known.backups.length, keep: known.backupKeep }) +
          (known.backups[0]
            ? t('web.maintenance.backup.last', {
                date: formatDate(known.backups[0].at, locale.value),
                size: size(known.backups[0].bytes),
              })
            : '')}
      result={doneText(backup)}
      failure={failureText(backup)}
      busy={backup?.status === 'running'}
      percent={percentOf(backup)}
      disabled={running || starting}
      link={{ href: '/settings#retention', label: t('web.maintenance.backup.settings') }}
      onrun={() => void startDatabase('backup')}
    />
    <ReplacedCard
      figures={known?.replaced}
      task={known?.replacedTask}
      disabled={starting || busy !== undefined}
      failure={known?.replacedTask?.status === 'failed' && known.replacedTask.error
        ? describeError(t, known.replacedTask.error)
        : undefined}
      onrun={(all: boolean) => void emptyReplaced(all)}
    />
  </div>
</section>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  /* Three columns as in the mock-up, two on a tablet, one on a phone. */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  @media (max-width: 960px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 600px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
