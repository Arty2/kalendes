<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, events } from '../lib/state.svelte';
  import { clock } from '../lib/clock.svelte';
  import { formatUpdatedAgo } from '../lib/format';

  // For a feed's error: when it last loaded, and whether the row still shows
  // those older events or nothing at all.
  const staleness = $derived.by(() => {
    const feedId = ui.errorModal?.feedId;
    if (!feedId) return null;
    const ago = formatUpdatedAgo(events.lastSuccessAt[feedId], clock.now);
    const cached = events.byFeed[feedId]?.length ?? 0;
    return cached > 0 ? `${ago} · showing ${cached} cached events` : ago;
  });

  function close(): void {
    ui.errorModal = null;
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }
</script>

{#if ui.errorModal}
  <div
    class="backdrop"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
  >
    <div class="dialog" role="alertdialog" aria-labelledby="err-title">
      <header>
        <h2 id="err-title">Failed to load {ui.errorModal.feedName}</h2>
        <IconButton icon="close" label="Close error" variant="ghost" onclick={close} />
      </header>
      {#if staleness}<p class="staleness" data-mono>{staleness}</p>{/if}
      <pre>{ui.errorModal.message}</pre>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .dialog {
    background: var(--paper-color);
    color: var(--ink-color);
    border: var(--border-w) solid var(--ink-color);
    width: min(560px, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    overflow: auto;
    padding: 1em;
    box-sizing: border-box;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5em;
    margin: 0 0 0.5em 0;
  }
  h2 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
  .staleness {
    margin: 0 0 0.5em 0;
    font-size: var(--fs-12);
    color: var(--ink-muted);
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--mono);
    font-size: var(--fs-12);
    color: var(--ink-color);
    background: var(--paper-2);
    padding: 0.5em;
    border: var(--border-w) solid var(--ink-color);
  }
</style>
