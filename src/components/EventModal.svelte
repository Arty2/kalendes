<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, config, events, pushLog } from '../lib/state.svelte';
  import { formatDateLong, formatRange, formatTime } from '../lib/format';
  import {
    buildGoogleAddUrl,
    buildIcsDownload,
    buildOutlookAddUrl,
  } from '../lib/calendar-links';

  let dialog: HTMLDialogElement | undefined = $state();
  let showRaw = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      showRaw = false;
    }
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
    return (
      formatDateLong(d, config.locale) +
      ' · ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  }

  async function copyText(text: string, kind: 'data' | 'details'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      pushLog(kind === 'data' ? 'Copied raw event data' : 'Copied event details');
    } catch {
      pushLog('Copy failed', 'error');
    }
  }

  function downloadIcs(ev: NonNullable<typeof ui.modalEvent>): void {
    const { dataUrl, filename } = buildIcsDownload(ev);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    pushLog('Downloaded ' + filename);
  }

  function buildDetails(ev: NonNullable<typeof ui.modalEvent>): string {
    const lines: string[] = [ev.displayTitle];
    lines.push(
      formatRange(ev.start, ev.end, config.dateFormat, config.locale, ev.allDay),
    );
    if (!ev.allDay) {
      lines.push(
        formatTime(ev.start, config.timeFormat, config.timezone) +
          ' – ' +
          formatTime(ev.end, config.timeFormat, config.timezone),
      );
    }
    if (ev.displayLocation) lines.push(ev.displayLocation);
    if (ev.displayDescription) {
      lines.push('');
      lines.push(ev.displayDescription);
    }
    if (ev.url) {
      lines.push('');
      lines.push(ev.url);
    }
    return lines.join('\n');
  }
</script>

<dialog bind:this={dialog} onclose={close} onclick={onClick}>
  {#if ui.modalEvent}
    {@const ev = ui.modalEvent}
    {@const raw = events.rawByUid[ev.uid] ?? null}
    <article>
      <header>
        <h2>{ev.displayTitle}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      {#if showRaw && raw}
        <div class="raw-block">
          <pre><code>{raw}</code></pre>
        </div>
      {:else}
        <p><time datetime={ev.start.toISOString()}>{formatStart(ev.start, ev.allDay)}</time></p>
        {#if ev.displayLocation}<p><strong>Location:</strong> {ev.displayLocation}</p>{/if}
        {#if ev.displayDescription}<p class="desc">{ev.displayDescription}</p>{/if}
        {#if ev.url}<p><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
      {/if}
      <footer class="modal-footer">
        <div class="copy-slot">
          {#if showRaw && raw}
            <button type="button" class="action-btn" onclick={() => void copyText(raw, 'data')}>
              Copy data
            </button>
          {:else}
            <button
              type="button"
              class="action-btn"
              onclick={() => void copyText(buildDetails(ev), 'details')}
            >
              Copy details
            </button>
          {/if}
        </div>
        <div class="source-slot">
          {#if raw}
            <button
              type="button"
              class="raw-toggle"
              aria-pressed={showRaw}
              onclick={() => (showRaw = !showRaw)}
              title={showRaw ? 'Hide raw iCal' : 'View raw iCal'}
              aria-label={showRaw ? 'Hide raw iCal' : 'View raw iCal'}
            >{'{}'}</button>
          {/if}
        </div>
      </footer>
      <div class="modal-add-row">
        <a
          class="action-btn"
          href={buildOutlookAddUrl(ev)}
          target="_blank"
          rel="noopener noreferrer"
        >M365</a>
        <a
          class="action-btn"
          href={buildGoogleAddUrl(ev)}
          target="_blank"
          rel="noopener noreferrer"
        >GCal</a>
        <button
          type="button"
          class="action-btn"
          onclick={() => downloadIcs(ev)}
        >iCal</button>
      </div>
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
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    user-select: none;
    -webkit-user-select: none;
  }
  article {
    padding: 1em;
    position: relative;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5em;
    border-bottom: 1px solid var(--ink-faint);
    padding-bottom: 0.5em;
    margin-bottom: 0.5em;
  }
  header h2 {
    flex: 1 1 auto;
    margin: 0;
    font-size: 1.15em;
  }
  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5em;
    margin-top: 0.75em;
    padding-top: 0.5em;
  }
  .copy-slot,
  .source-slot {
    display: inline-flex;
    align-items: center;
  }
  .action-btn {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  .action-btn:hover {
    background: var(--paper-2);
  }
  .modal-add-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4em;
    margin-top: 0.5em;
  }
  .modal-add-row .action-btn {
    width: 100%;
  }
  .raw-toggle {
    font-family: var(--mono);
    font-size: 12px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--ink-faint);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
  }
  .raw-toggle[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .desc {
    white-space: pre-wrap;
  }
  time {
    font-family: var(--mono);
  }
  .raw-block {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  .raw-block pre {
    margin: 0;
    padding: 0.6em 0.8em;
    border: 1px solid var(--ink-faint);
    background: var(--paper-2);
    overflow: auto;
    max-height: 60dvh;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
