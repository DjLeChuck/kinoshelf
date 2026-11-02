<script lang="ts">
  /** A disclosure arrow that turns a quarter when its node opens; decorative, the button carries `aria-expanded`. */
  let { open }: { open: boolean } = $props();
</script>

<svg class="chevron" class:open width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
  <path
    d="M4 2l4 4-4 4"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>

<style>
  .chevron {
    flex: none;
    margin-right: 8px;
    color: var(--muted);
    vertical-align: -1px;
    transition: transform 0.15s ease;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
