<script lang="ts">
  import { ui } from '../lib/state.svelte';

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) dialog.showModal();
    if (!ui.modalEvent && dialog.open) dialog.close();
  });

  function close(): void {
    ui.modalEvent = null;
  }

  function formatDate(d: Date, allDay: boolean): string {
    if (allDay) {
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }
    return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  {#if ui.modalEvent}
    {@const ev = ui.modalEvent}
    <article>
      <header>
        <h2>{ev.title}</h2>
        <button onclick={close} aria-label="Close">✕</button>
      </header>
      <p><time datetime={ev.start.toISOString()}>{formatDate(ev.start, ev.allDay)}</time></p>
      {#if ev.location}<p><strong>Location:</strong> {ev.location}</p>{/if}
      {#if ev.description}<p class="desc">{ev.description}</p>{/if}
      {#if ev.url}<p><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: 2px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    padding: 0;
    max-width: 600px;
    width: 90vw;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.3);
  }
  article {
    padding: 1em;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1em;
    border-bottom: 1px solid var(--ink);
    padding-bottom: 0.5em;
    margin-bottom: 0.5em;
  }
  h2 {
    margin: 0;
    font-size: 1.2em;
  }
  .desc {
    white-space: pre-wrap;
  }
</style>
