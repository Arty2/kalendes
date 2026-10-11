<script lang="ts">
  import Icon from './Icon.svelte';
  import {
    buildGoogleAddUrl,
    buildOutlookAddUrl,
    buildOutlookLiveAddUrl,
    buildIcsDownload,
    buildIcsBundleDownload,
  } from '../lib/calendar-links';
  import type { ParsedEvent } from '../lib/types';

  type Props = { events: ParsedEvent[]; disabled?: boolean };
  const { events, disabled = false }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let menu: HTMLDivElement | undefined = $state();

  const single = $derived(events.length === 1);
  const one = $derived(events[0]);

  function close(): void {
    open = false;
  }

  function downloadIcs(): void {
    if (single && one) {
      const { dataUrl, filename } = buildIcsDownload(one);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    } else if (events.length > 0) {
      const { blob, filename } = buildIcsBundleDownload(events);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
    close();
  }

  // The menu is position: fixed at coordinates measured from the trigger, so a
  // scrolling ancestor (the event card's article is overflow: auto) can't clip
  // it. It opens above the trigger, or below when there's no room, and stays
  // inside the viewport. A transformed ancestor would become the containing
  // block for a fixed element, so the origin is measured rather than assumed.
  const GAP_PX = 4;
  const EDGE_PX = 8;
  function place(): void {
    if (!root || !menu) return;
    menu.style.top = '0px';
    menu.style.left = '0px';
    const origin = menu.getBoundingClientRect();
    const t = root.getBoundingClientRect();
    const above = t.top - GAP_PX - origin.height;
    const top =
      above >= EDGE_PX
        ? above
        : Math.max(EDGE_PX, Math.min(t.bottom + GAP_PX, window.innerHeight - origin.height - EDGE_PX));
    const left = Math.max(EDGE_PX, Math.min(t.left, window.innerWidth - origin.width - EDGE_PX));
    menu.style.top = `${Math.round(top - origin.top)}px`;
    menu.style.left = `${Math.round(left - origin.left)}px`;
  }

  $effect(() => {
    if (!open || !menu) return;
    place();
    // Follow the trigger when the card (or anything around it) scrolls.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="cal-dl" bind:this={root}>
  <button
    type="button"
    class="cal-dl-trigger"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Add to calendar"
    title="Add to calendar"
    {disabled}
    onclick={() => (open = !open)}
  >
    <Icon name="arrow-bar-down" size={16} />
  </button>
  {#if open}
    <div class="cal-dl-menu" role="menu" bind:this={menu}>
      {#if single && one}
        <a role="menuitem" class="cal-dl-item" href={buildGoogleAddUrl(one)} target="_blank" rel="noopener noreferrer" onclick={close}>Google</a>
        <a role="menuitem" class="cal-dl-item" href={buildOutlookLiveAddUrl(one)} target="_blank" rel="noopener noreferrer" onclick={close}>Outlook 365</a>
        <a role="menuitem" class="cal-dl-item" href={buildOutlookAddUrl(one)} target="_blank" rel="noopener noreferrer" onclick={close}>Outlook 365 (Work)</a>
      {:else}
        <span role="menuitem" class="cal-dl-item" aria-disabled="true">Google</span>
        <span role="menuitem" class="cal-dl-item" aria-disabled="true">Outlook 365</span>
        <span role="menuitem" class="cal-dl-item" aria-disabled="true">Outlook 365 (Work)</span>
      {/if}
      <button type="button" role="menuitem" class="cal-dl-item" onclick={downloadIcs}>iCal</button>
    </div>
  {/if}
</div>

<style>
  .cal-dl {
    position: relative;
    display: inline-flex;
  }
  .cal-dl-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
  }
  /* Open state keeps the inverted fill; hover is just the accent tint (global button:hover). */
  .cal-dl-trigger[aria-expanded='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .cal-dl-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
  /* Placed by place() — fixed, so overflow on any ancestor can't clip it. */
  .cal-dl-menu {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 12em;
    background: var(--paper-color);
    border: var(--btn-border-w) solid var(--ink-color);
  }
  .cal-dl-item {
    display: block;
    padding: 0.5em 0.75em;
    background: var(--paper-color);
    color: var(--ink-color);
    font-size: var(--fs-13);
    text-align: left;
    text-decoration: none;
    border: 0;
    cursor: pointer;
    white-space: nowrap;
  }
  .cal-dl-item + .cal-dl-item {
    border-top: var(--border-w) dashed var(--ink-color);
  }
  /* Menu items are <a>; tint the text with the accent on hover (button action, not a link),
     overriding the global a:hover link colour. No fill. */
  .cal-dl-item:hover {
    color: var(--accent-color);
  }
  .cal-dl-item[aria-disabled='true'] {
    color: var(--ink-muted);
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }
</style>
