<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import Link from './Link.svelte';
  import ActionDialog from './ActionDialog.svelte';

  let {
    title,
    text,
    does,
    button,
    figure,
    result,
    busy = false,
    percent,
    failure,
    link,
    disabled = false,
    onrun,
  }: {
    title: string;
    /** What the action leaves alone, as the card says it. */
    text: string;
    /** What it does, said again in the confirmation. */
    does: string;
    button: string;
    /** What the action would act on now. */
    figure: string | undefined;
    /** What the last run did, in this page's lifetime. */
    result: string | undefined;
    busy?: boolean;
    /** How far a running action has got, `null` when it cannot tell, absent when it is not a long one. */
    percent?: number | null;
    /** Why the last run failed. */
    failure?: string | undefined;
    /** Where the setting that shapes this action is. */
    link?: { href: string; label: string };
    disabled?: boolean;
    onrun: () => void;
  } = $props();

  const uid = $props.id();
  let confirming = $state(false);
</script>

<article class="card" aria-labelledby={`${uid}-title`}>
  <h3 id={`${uid}-title`}>{title}</h3>
  <p class="muted">{text}</p>
  <p class="state" aria-live="polite">
    {#if result}<b>{result}</b>{:else if figure}{figure}{/if}
  </p>
  {#if busy && percent !== undefined}
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
      disabled={disabled || busy}
      onclick={() => {
        confirming = true;
      }}
    >
      {busy ? t('web.maintenance.action.running') : button}
    </button>
    {#if link}<Link href={link.href}>{link.label}</Link>{/if}
  </div>
</article>

{#if confirming}
  <ActionDialog
    {title}
    {does}
    keeps={text}
    confirm={button}
    onclose={() => {
      confirming = false;
    }}
    onconfirm={onrun}
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
    gap: 4px 16px;
    margin-top: auto;
    padding-top: 4px;
  }
</style>
