<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui } from '../lib/state.svelte';
  import { KEYBOARD_SHORTCUTS } from '../lib/keyboard';

  function close(): void {
    ui.shortcutsOpen = false;
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }
</script>

{#if ui.shortcutsOpen}
  <div
    class="backdrop"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <IconButton icon="close" label="Close shortcuts" variant="ghost" onclick={close} />
      </header>
      <dl class="shortcuts">
        {#each KEYBOARD_SHORTCUTS as s}
          <div class="row">
            <dt>
              {#each s.keys as key, i}
                {#if i > 0 && s.keys[i - 1] === 'Ctrl/⌘'}<span class="sep">+</span>{/if}
                {#if key === '…'}<span class="ellipsis">…</span>{:else}<kbd data-mono>{key}</kbd>{/if}
              {/each}
            </dt>
            <dd>{s.label}</dd>
          </div>
        {/each}
      </dl>
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
    margin: 0 0 0.75em 0;
  }
  h2 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
  .shortcuts {
    margin: 0;
    display: grid;
    gap: 0.5em;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(7em, auto) 1fr;
    gap: 0.75em;
    align-items: baseline;
  }
  dt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25em;
    margin: 0;
    justify-content: flex-end;
    text-align: right;
  }
  dd {
    margin: 0;
    font-size: var(--fs-13);
  }
  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6em;
    padding: 0.1em 0.4em;
    font-size: var(--fs-12);
    line-height: 1.4;
    color: var(--ink-color);
    background: var(--paper-2);
    border: var(--border-w) solid var(--ink-color);
    border-radius: 3px;
  }
  .sep,
  .ellipsis {
    color: var(--ink-muted);
    font-size: var(--fs-12);
  }
</style>
