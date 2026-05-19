<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { selection, clearSelection, ui } from '../lib/state.svelte';
  import { tap } from '../lib/haptics';

  function viewInTray(): void {
    if (selection.uids.size === 0) return;
    tap();
    if (typeof window === 'undefined') return;
    if (!ui.statusExpanded) {
      window.dispatchEvent(new CustomEvent('cal:toggle-status'));
    }
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
    class="tray-btn"
    onclick={viewInTray}
    disabled={selection.uids.size === 0}
    aria-pressed={ui.statusExpanded}
    aria-label="View selected events in tray"
    title="View selected events in tray"
  >
    <span>VIEW IN TRAY</span>
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
  .tray-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    height: 32px;
    padding: 0 0.8em;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
    font: inherit;
    font-size: 12px;
    letter-spacing: 0.04em;
  }
  .tray-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .tray-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
  @media (max-width: 640px) {
    .selection-bar {
      gap: 0.35em;
      padding: 0.35em 0.5em;
    }
    .tray-btn {
      padding: 0 0.6em;
    }
  }
</style>
