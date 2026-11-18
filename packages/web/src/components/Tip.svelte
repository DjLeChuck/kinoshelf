<script lang="ts" module>
  let counter = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    text,
    children,
  }: {
    /** The help text; empty leaves the control as it is, with no tip. */
    text: string | undefined;
    /** The control; it sets the id it is given as its `aria-describedby`, which ties it to the tip. */
    children: Snippet<[string | undefined]>;
  } = $props();

  counter += 1;
  const id = `tip-${counter}`;
  const HOVER_DELAY = 400;
  const LONG_PRESS = 500;
  const TOUCH_LINGER = 4000;
  const GAP = 8;
  const MARGIN = 8;

  let host: HTMLElement | undefined = $state();
  let bubble: HTMLElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opened = false;
  // A long press ends in a click on the button: the one that follows is not an action.
  let swallowClick = false;

  function place(): void {
    if (!host || !bubble) {
      return;
    }
    const anchor = host.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - box.width / 2),
      Math.max(MARGIN, window.innerWidth - box.width - MARGIN),
    );
    const below = anchor.bottom + GAP;
    const top =
      below + box.height + MARGIN > window.innerHeight && anchor.top - GAP - box.height >= MARGIN
        ? anchor.top - GAP - box.height
        : below;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function show(): void {
    clearTimeout(timer);
    if (opened || !bubble || !text) {
      return;
    }
    opened = true;
    bubble.showPopover();
    place();
  }

  function hide(): void {
    clearTimeout(timer);
    if (opened && bubble) {
      opened = false;
      bubble.hidePopover();
    }
  }

  function later(delay: number, action: () => void): void {
    clearTimeout(timer);
    timer = setTimeout(action, delay);
  }

  function onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      later(HOVER_DELAY, show);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      // Pressing is acting: the tip has said what it had to.
      hide();
      return;
    }
    later(LONG_PRESS, () => {
      show();
      swallowClick = true;
      later(TOUCH_LINGER, hide);
    });
  }

  function onPointerEnd(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' && !opened) {
      clearTimeout(timer);
    }
  }

  function onClick(event: MouseEvent): void {
    if (swallowClick) {
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && opened) {
      // Closes the tip and leaves a dialog around it, if any, open.
      event.stopPropagation();
      hide();
    }
  }
</script>

<!-- The wrapper listens because a disabled button sends no event of its own. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  bind:this={host}
  class="tip-host"
  onpointerenter={onPointerEnter}
  onpointerleave={hide}
  onpointerdown={onPointerDown}
  onpointerup={onPointerEnd}
  onpointercancel={onPointerEnd}
  onfocusin={show}
  onfocusout={hide}
  onkeydown={onKeydown}
  oncontextmenu={(event) => {
    if (opened) {
      event.preventDefault();
    }
  }}
  onclickcapture={onClick}
>
  {@render children(text ? id : undefined)}
  {#if text}
    <span bind:this={bubble} {id} class="tip" role="tooltip" popover="manual">{text}</span>
  {/if}
</span>

<style>
  .tip-host {
    display: inline-flex;
  }

  .tip {
    /* In the top layer, so no ancestor clips it; placed in the viewport by `place`. */
    position: fixed;
    inset: auto;
    margin: 0;
    max-width: min(320px, calc(100vw - 16px));
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
    pointer-events: none;
  }
</style>
