<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import {
    selection,
    clearSelection,
    events,
    pushLog,
  } from '../lib/state.svelte';
  import { buildIcsBundleDownload } from '../lib/calendar-links';
  import { tap } from '../lib/haptics';
  import type { ParsedEvent } from '../lib/types';

  function gatherSelected(): ParsedEvent[] {
    const out: ParsedEvent[] = [];
    for (const list of Object.values(events.byFeed)) {
      for (const ev of list) {
        if (selection.uids.has(ev.uid)) out.push(ev);
      }
    }
    return out;
  }

  function downloadIcs(): void {
    const evs = gatherSelected();
    if (evs.length === 0) return;
    tap();
    const { blob, filename } = buildIcsBundleDownload(evs);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    pushLog(`Exported ${evs.length} event${evs.length === 1 ? '' : 's'}`);
  }
</script>

<div class="selection-bar" role="region" aria-label="Selection actions">
  <IconButton
    icon="close"
    label="Clear selection"
    onclick={clearSelection}
  />
  <span class="count" aria-live="polite">
    {selection.uids.size} selected
  </span>
  <span class="spacer"></span>
  <button
    type="button"
    class="ical-btn"
    onclick={downloadIcs}
    disabled={selection.uids.size === 0}
    aria-label="Download selected as iCal"
    title="Download selected as iCal"
  >
    <Icon name="arrow-bar-down" size={18} />
    <span>iCal</span>
  </button>
</div>

<style>
  .selection-bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.4em 0.75em;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
  }
  .count {
    font-weight: normal;
    font-size: 13px;
    color: var(--ink);
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .ical-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    height: 32px;
    padding: 0 0.6em;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
    font: inherit;
    font-size: 13px;
    text-transform: none;
  }
  .ical-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
  @media (max-width: 640px) {
    .selection-bar {
      gap: 0.35em;
      padding: 0.35em 0.5em;
    }
    .ical-btn {
      padding: 0 0.45em;
    }
  }
</style>
