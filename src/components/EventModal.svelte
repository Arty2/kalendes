<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, config } from '../lib/state.svelte';
  import { formatDateLong } from '../lib/format';

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) dialog.showModal();
    if (!ui.modalEvent && dialog.open) dialog.close();
  });

  function close(): void {
    ui.modalEvent = null;
  }

  function onClick(e: MouseEvent): void {
    if (e.target === dialog) close();
  }

  function formatStart(d: Date, allDay: boolean): string {
    if (allDay) return formatDateLong(d, config.locale);
    return formatDateLong(d, config.locale) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
</script>

<dialog bind:this={dialog} onclose={close} onclick={onClick}>
  {#if ui.modalEvent}
    {@const ev = ui.modalEvent}
    <article>
      <header>
        <h2>{ev.displayTitle}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      <p><time datetime={ev.start.toISOString()}>{formatStart(ev.start, ev.allDay)}</time></p>
      {#if ev.displayLocation}<p><strong>Location:</strong> {ev.displayLocation}</p>{/if}
      {#if ev.displayDescription}<p class="desc">{ev.displayDescription}</p>{/if}
      {#if ev.url}<p><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    padding: 0;
    width: min(600px, calc(100vw - 1rem));
    max-height: calc(100dvh - 2rem);
    overflow: auto;
    box-sizing: border-box;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  article {
    padding: 1em;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1em;
    border-bottom: 1px solid var(--ink-faint);
    padding-bottom: 0.5em;
    margin-bottom: 0.5em;
  }
  h2 {
    margin: 0;
    font-size: 1.15em;
  }
  .desc {
    white-space: pre-wrap;
  }
  time {
    font-family: var(--mono);
  }
</style>
