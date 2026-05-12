<script lang="ts">
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import { ui, config, events, pushLog } from '../lib/state.svelte';
  import { formatDateLong, formatRange, formatTime } from '../lib/format';
  import { matchingRulesFor } from '../lib/rules';
  import {
    buildGoogleAddUrl,
    buildIcsDownload,
    buildOutlookAddUrl,
  } from '../lib/calendar-links';
  import type { FindReplaceRule, StyleVariant } from '../lib/types';

  let dialog: HTMLDialogElement | undefined = $state();
  let showRaw = $state(false);
  let showFilters = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      showRaw = false;
      showFilters = false;
    }
    if (!ui.modalEvent && dialog.open) dialog.close();
  });

  const matchedRules = $derived(
    ui.modalEvent ? matchingRulesFor(ui.modalEvent, config.rules) : ([] as FindReplaceRule[]),
  );

  function styleLabel(s: StyleVariant): string {
    switch (s) {
      case 'inverted-dashed': return 'Inverted, dashed';
      case 'inverted-strike': return 'Inverted, strike';
      case 'muted': return '*Muted';
      case 'highlight': return 'Highlight';
      case 'hidden': return '*Hidden';
      default: return 'No style';
    }
  }

  function openRuleInSettings(rule: FindReplaceRule): void {
    ui.settingsAutoEditRuleId = rule.id;
    ui.settingsScrollToRuleId = rule.id;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

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
      {#if showFilters}
        <ul class="filter-list">
          {#each matchedRules as rule (rule.id)}
            <li>
              <button type="button" class="filter-row" onclick={() => openRuleInSettings(rule)}>
                <span class="filter-preview" data-mono>{rule.find} &gt; {rule.replace || '(empty)'}</span>
                {#if rule.style !== 'none'}
                  <span
                    class="style-swatch"
                    data-style={rule.style}
                    aria-label={styleLabel(rule.style)}
                    title={styleLabel(rule.style)}
                  ></span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else if showRaw && raw}
        <div class="raw-block">
          <pre><code>{raw}</code></pre>
        </div>
      {:else}
        <p><time datetime={ev.start.toISOString()}>{formatStart(ev.start, ev.allDay)}</time></p>
        {#if ev.displayLocation}<p><strong>Location:</strong> {ev.displayLocation}</p>{/if}
        {#if ev.displayDescription}<p class="desc">{ev.displayDescription}</p>{/if}
        {#if ev.url}<p><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
      {/if}
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
      <footer class="modal-footer">
        <div class="source-slot">
          {#if raw}
            <button
              type="button"
              class="raw-toggle"
              aria-pressed={showRaw}
              disabled={showFilters}
              onclick={() => (showRaw = !showRaw)}
              title={showRaw ? 'Hide raw iCal' : 'View raw iCal'}
              aria-label={showRaw ? 'Hide raw iCal' : 'View raw iCal'}
            >{'{}'}</button>
          {/if}
          <button
            type="button"
            class="locate-filters"
            aria-pressed={showFilters}
            disabled={matchedRules.length === 0}
            title={matchedRules.length === 0 ? 'No filters apply to this event' : (showFilters ? 'Hide matching filters' : 'Show matching filters')}
            aria-label={showFilters ? 'Hide matching filters' : 'Show matching filters'}
            onclick={() => (showFilters = !showFilters)}
          ><Icon name="search-locate" size={16} /></button>
        </div>
        <div class="copy-slot">
          {#if showFilters}
            <span class="filter-count" data-mono>{matchedRules.length} filter{matchedRules.length === 1 ? '' : 's'}</span>
          {:else if showRaw && raw}
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
      </footer>
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
  .source-slot {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
  }
  .locate-filters {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--ink-faint);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
  }
  .locate-filters[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .locate-filters:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .filter-count {
    font-size: 11px;
    color: var(--ink-muted);
  }
  .filter-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--ink-faint);
  }
  .filter-list li + li {
    border-top: 1px solid var(--ink-faint);
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.6em;
    width: 100%;
    padding: 0.4em 0.6em;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
  }
  .filter-row:hover {
    background: var(--paper-2);
  }
  .filter-preview {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .style-swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    border: 1px solid var(--ink);
    background: var(--paper);
    box-sizing: border-box;
    position: relative;
  }
  .style-swatch[data-style='inverted-dashed'] {
    background: var(--ink);
    border-style: dashed;
    border-width: 1.5px;
  }
  .style-swatch[data-style='inverted-strike'] {
    background: var(--ink);
  }
  .style-swatch[data-style='inverted-strike']::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 1px;
    right: 1px;
    height: 1px;
    background: var(--paper);
    transform: translateY(-50%);
  }
  .style-swatch[data-style='muted'] {
    opacity: 0.4;
    background: var(--ink);
  }
  .style-swatch[data-style='highlight'] {
    background: var(--paper);
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .style-swatch[data-style='hidden'] {
    opacity: 0.5;
    filter: grayscale(1);
    background: var(--ink-faint);
  }
  .style-swatch[data-style='hidden']::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 1px;
    right: 1px;
    height: 1px;
    background: var(--ink);
    transform: translateY(-50%);
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
