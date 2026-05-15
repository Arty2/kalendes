<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, config, events, pushLog } from '../lib/state.svelte';
  import { formatRange, formatTime } from '../lib/format';
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
  let returnEvent: typeof ui.modalEvent = null;

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      showRaw = false;
      showFilters = false;
    }
    if (!ui.modalEvent && dialog.open) dialog.close();
  });

  $effect(() => {
    if (!ui.settingsOpen && returnEvent) {
      const ev = returnEvent;
      returnEvent = null;
      ui.modalEvent = ev;
    }
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
    returnEvent = ui.modalEvent;
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

  function formatEventDateInfo(ev: NonNullable<typeof ui.modalEvent>): {
    date: string;
    time: string;
    duration: string;
  } {
    const date = formatRange(ev.start, ev.end, config.dateFormat, config.locale, ev.allDay);
    if (ev.allDay) {
      const days = Math.round((ev.end.getTime() - ev.start.getTime()) / 86_400_000);
      return { date, time: '', duration: days > 1 ? `${days} days` : '' };
    }
    const time =
      formatTime(ev.start, config.timeFormat, config.timezone) +
      ' – ' +
      formatTime(ev.end, config.timeFormat, config.timezone);
    const totalMins = Math.round((ev.end.getTime() - ev.start.getTime()) / 60_000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    let duration = '';
    if (h > 0 && m > 0) duration = `${h}h ${m}m`;
    else if (h > 0) duration = `${h}h`;
    else if (m > 0) duration = `${m}m`;
    return { date, time, duration };
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linkifyText(text: string): string {
    const URL_RE = /https?:\/\/[^\s<>"]+/g;
    let result = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(text)) !== null) {
      result += escapeHtml(text.slice(last, m.index));
      const url = m[0].replace(/[.,;:!?)\]'"]+$/, '');
      result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener nofollow">${escapeHtml(url)}</a>`;
      last = m.index + url.length;
    }
    result += escapeHtml(text.slice(last));
    return result;
  }

  async function copyText(text: string, kind: 'data' | 'details'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      pushLog(kind === 'data' ? 'Copied raw event data' : 'Copied event details');
    } catch {
      pushLog('Copy failed', 'error');
    }
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
        <h2 class="modal-title">{ev.displayTitle}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      {#if showRaw && raw}
        <div class="raw-block">
          <pre><code>{raw}</code></pre>
        </div>
      {:else if showFilters}
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
      {:else}
        {@const info = formatEventDateInfo(ev)}
        <p><time datetime={ev.start.toISOString()}>{info.date}{#if info.duration} · {info.duration}{/if}</time></p>
        {#if info.time}<p class="event-time">{info.time}</p>{/if}
        {#if ev.displayLocation}<p>{ev.displayLocation}</p>{/if}
        {#if ev.displayDescription}<p class="desc">{@html linkifyText(ev.displayDescription)}</p>{/if}
        {#if ev.url}<p><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
      {/if}
      {#if !showRaw && !showFilters}
        {@const ics = buildIcsDownload(ev)}
        <div class="modal-add-row">
          <a href={buildOutlookAddUrl(ev)} target="_blank" rel="noopener noreferrer">Outlook</a>
          <span class="add-dot" aria-hidden="true">·</span>
          <a href={buildGoogleAddUrl(ev)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
          <span class="add-dot" aria-hidden="true">·</span>
          <a href={ics.dataUrl} download={ics.filename}>iCal</a>
        </div>
      {/if}
      <footer class="modal-footer">
        <div class="source-slot">
          <button
            type="button"
            class="locate-filters"
            aria-pressed={showFilters}
            disabled={matchedRules.length === 0}
            title={matchedRules.length === 0 ? 'No filters apply to this event' : (showFilters ? 'Hide matching filters' : 'Show matching filters')}
            aria-label={showFilters ? 'Hide matching filters' : 'Show matching filters'}
            onclick={() => (showFilters = !showFilters)}
          >FIND &amp; REPLACE</button>
          {#if showFilters && !showRaw}
            <span class="filter-count" data-mono>{matchedRules.length} filter{matchedRules.length === 1 ? '' : 's'}</span>
          {/if}
        </div>
        <div class="copy-slot">
          {#if raw}
            <button
              type="button"
              class="raw-toggle"
              aria-pressed={showRaw}
              onclick={() => (showRaw = !showRaw)}
              title={showRaw ? 'Hide raw iCal' : 'View raw iCal'}
              aria-label={showRaw ? 'Hide raw iCal' : 'View raw iCal'}
            >{'{ }'}</button>
          {/if}
          <button
            type="button"
            class="action-btn"
            onclick={() => void copyText(showRaw && raw ? raw : buildDetails(ev), showRaw && raw ? 'data' : 'details')}
          >COPY</button>
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
    align-items: center;
    gap: 0.5em;
    border-bottom: 1px solid var(--ink-faint);
    padding-bottom: 0.5em;
    margin-bottom: 0.5em;
  }
  .modal-title {
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
    gap: 0.4em;
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
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin-top: 0.5em;
    flex-wrap: wrap;
  }
  .modal-add-row a {
    color: var(--ink);
    text-decoration: none;
    font-size: 13px;
  }
  .modal-add-row a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .add-dot {
    color: var(--ink-muted);
    user-select: none;
  }
  .raw-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
  }
  .raw-toggle[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .event-time {
    font-family: var(--mono);
    font-size: 0.9em;
    color: var(--ink-muted);
    margin: 0.05em 0 0.15em;
  }
  .locate-filters {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 11px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .locate-filters[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .locate-filters:disabled {
    border-color: var(--ink-faint);
    color: var(--ink-muted);
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
    border-color: var(--ink);
    border-style: dashed;
    border-width: 1.5px;
  }
  .style-swatch[data-style='inverted-strike'] {
    background: var(--ink);
    border-color: var(--ink);
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
    background: var(--paper);
    opacity: 0.4;
  }
  .style-swatch[data-style='highlight'] {
    background: var(--paper);
    border-color: var(--ink);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .style-swatch[data-style='hidden'] {
    background: var(--paper);
    opacity: 0.25;
    filter: grayscale(1);
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
