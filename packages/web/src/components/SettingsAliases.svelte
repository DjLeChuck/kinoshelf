<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';

  interface Alias {
    readonly id: number;
    readonly kind: 'movie' | 'series';
    readonly title: string;
    readonly year?: number;
    readonly work: { readonly title: string; readonly year?: number };
  }

  let aliases = $state<readonly Alias[] | undefined>(undefined);
  let busy = $state(false);
  let failure = $state<unknown>(undefined);

  const label = (work: Alias['work']): string =>
    work.year === undefined ? work.title : `${work.title} (${work.year})`;

  async function load(): Promise<void> {
    try {
      aliases = await api.get<Alias[]>('/api/aliases');
    } catch (error) {
      failure = error;
    }
  }

  async function forget(alias: Alias): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      await api.delete(`/api/aliases/${alias.id}`);
      aliases = aliases?.filter((other) => other.id !== alias.id);
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  void load();
</script>

<section class="card" aria-labelledby="aliases-title">
  <h2 id="aliases-title">{t('web.settings.aliases.title')}</h2>
  <p class="muted">{t('web.settings.aliases.hint')}</p>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}

  {#if aliases === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if aliases.length === 0}
    <p class="muted">{t('web.settings.aliases.empty')}</p>
  {:else}
    <ul>
      {#each aliases as alias (alias.id)}
        <li>
          <span class="mono">{alias.title}{alias.year === undefined ? '' : ` (${alias.year})`}</span
          >
          <span aria-hidden="true">→</span>
          <span>{label(alias.work)}</span>
          <button
            type="button"
            class="btn"
            disabled={busy}
            aria-label={t('web.settings.aliases.forget.label', { title: alias.title })}
            onclick={() => void forget(alias)}
          >
            {t('web.settings.aliases.forget')}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  li .btn {
    margin-left: auto;
  }
</style>
