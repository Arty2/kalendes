<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui } from '../lib/state.svelte';

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
