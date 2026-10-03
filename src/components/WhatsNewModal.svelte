<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui } from '../lib/state.svelte';
  import { CHANGELOG, markWhatsNewSeen } from '../lib/changelog';

  // Opening it, by hand or after an update, marks the latest release read.
  $effect(() => {
    if (ui.whatsNewOpen) markWhatsNewSeen();
  });

  function close(): void {
    ui.whatsNewOpen = false;
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }
</script>

{#if ui.whatsNewOpen}
  <div
    class="backdrop"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <header>
        <h2 id="whats-new-title">What's new</h2>
        <IconButton icon="close" label="Close what's new" variant="ghost" onclick={close} />
      </header>
      <div class="releases">
        {#each CHANGELOG as release (release.version)}
          <section>
            <h3 data-mono>v{release.version} <span class="date">{release.date}</span></h3>
            <ul>
              {#each release.items as runs}
                <li>
                  {#each runs as run}{#if run.code}<code data-mono>{run.text}</code>{:else}{run.text}{/if}{/each}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
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
    padding: 1em;
    box-sizing: border-box;
    /* Header (title + close) stays put; only the release list scrolls. */
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  header {
    flex: 0 0 auto;
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
  .releases {
    overflow: auto;
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    gap: 1em;
  }
  h3 {
    margin: 0 0 0.4em 0;
    font-size: var(--fs-12);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .date {
    color: var(--ink-muted);
    font-weight: normal;
  }
  ul {
    margin: 0;
    padding-left: 1.2em;
    display: grid;
    gap: 0.35em;
    font-size: var(--fs-13);
  }
  code {
    font-size: 0.92em;
    padding: 0 0.2em;
    background: var(--paper-2);
  }
</style>
