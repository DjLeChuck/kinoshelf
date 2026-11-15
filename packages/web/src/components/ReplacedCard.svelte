<script lang="ts">
  import { formatBytes } from '@kinoshelf/i18n';
  import { locale, t } from '../lib/i18n.svelte.js';
  import type { MaintenanceFigures, ReplacedTask } from '../lib/maintenance.js';
  import ActionDialog from './ActionDialog.svelte';
  import Link from './Link.svelte';

  let {
    figures,
    task,
    disabled,
    failure,
    onrun,
  }: {
    figures: MaintenanceFigures['replaced'] | undefined;
    task: ReplacedTask | null | undefined;
    /** Something else is being started. */
    disabled: boolean;
    failure: string | undefined;
    /** Starts emptying; `all` ignores the retention. */
    onrun: (all: boolean) => void;
  } = $props();

  const uid = $props.id();
  let confirming = $state<'due' | 'all' | undefined>(undefined);

  const size = (bytes: number): string => formatBytes(bytes, locale.value);
  const running = $derived(task?.status === 'running');
  const percent = $derived(
    task && task.total > 0 ? Math.round((task.done / task.total) * 100) : null,
  );
  const freed = $derived(task?.status === 'done' ? task.freed : null);
  // What the dialog commits to: the files due under the retention, or every one.
  const scope = $derived(
    figures === undefined
      ? undefined
      : confirming === 'all'
        ? { files: figures.files, bytes: figures.bytes, batches: undefined }
        : figures.due,
  );
</script>

<article class="card" aria-labelledby={`${uid}-title`}>
  <h3 id={`${uid}-title`}>{t('web.maintenance.replaced.title')}</h3>
  <p class="muted">{t('web.maintenance.replaced.text')}</p>
  <p class="state" aria-live="polite">
    {#if freed}
      <b
        >{t('web.maintenance.replaced.done', {
          files: freed.files,
          size: size(freed.bytes),
          failed: freed.failed,
        })}</b
      >
    {:else if figures}
      {t('web.maintenance.replaced.state', {
        files: figures.files,
        size: size(figures.bytes),
      })}{figures.days > 0
        ? t('web.maintenance.replaced.due', {
            due: figures.due.files,
            days: figures.days,
            dueSize: size(figures.due.bytes),
          })
        : ''}
    {/if}
  </p>
  {#if running}
    {#if percent === null}
      <progress aria-label={t('web.maintenance.action.progress')}></progress>
    {:else}
      <progress max="100" value={percent} aria-label={t('web.maintenance.action.progress')}
        >{percent}%</progress
      >
    {/if}
  {/if}
  {#if failure}<p class="alert alert-danger" role="alert">{failure}</p>{/if}
  <div class="foot">
    <button
      type="button"
      class="btn"
      disabled={disabled || running || !figures || figures.due.files === 0}
      onclick={() => {
        confirming = 'due';
      }}
    >
      {running
        ? t('web.maintenance.action.running')
        : t('web.maintenance.replaced.button', { days: figures?.days ?? 30 })}
    </button>
    <button
      type="button"
      class="btn"
      disabled={disabled || running || !figures || figures.files === 0}
      onclick={() => {
        confirming = 'all';
      }}
    >
      {t('web.maintenance.replaced.button.all')}
    </button>
    <Link href="/settings#retention">{t('web.maintenance.backup.settings')}</Link>
  </div>
</article>

{#if confirming && scope}
  <ActionDialog
    title={t('web.maintenance.replaced.confirm.title')}
    does={t('web.maintenance.replaced.does', { count: scope.files, size: size(scope.bytes) })}
    extra={[
      ...(scope.batches === undefined
        ? []
        : [t('web.maintenance.replaced.batches', { count: scope.batches })]),
      t('web.maintenance.replaced.undo'),
    ]}
    keeps={t('web.maintenance.replaced.text')}
    acknowledge={t('web.maintenance.replaced.ack')}
    confirm={t('web.maintenance.replaced.confirm')}
    onclose={() => {
      confirming = undefined;
    }}
    onconfirm={() => {
      onrun(confirming === 'all');
    }}
  />
{/if}

<style>
  article {
    gap: 8px;
  }

  h3 {
    margin: 0;
    font-size: 16px;
  }

  p {
    margin: 0;
  }

  .state {
    min-height: 1.4em;
    font-size: 13.5px;
  }

  progress {
    width: 100%;
    accent-color: var(--accent);
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: auto;
    padding-top: 4px;
  }
</style>
