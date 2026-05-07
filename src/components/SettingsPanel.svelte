<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import RulesEditor from './RulesEditor.svelte';
  import { config, ui, zoom, events } from '../lib/state.svelte';
  import { clock } from '../lib/clock.svelte';
  import { exportConfig, importConfig, defaultConfig, REFRESH_INTERVAL_OPTIONS } from '../lib/storage';
  import { feedIdFor } from '../lib/ics';
  import {
    formatTimezoneLabel,
    formatUtcOffset,
    formatCurrentTzLabel,
    isDaylight,
  } from '../lib/format';
  import { buildShareUrl, SHARE_URL_LIMIT } from '../lib/share';
  import {
    CALENDAR_COLORS,
    type CalendarColor,
    type CalendarFeed,
    type DateFormat,
    type Locale,
    type StyleVariant,
    type Theme,
    type Timezone,
    type TimeFormat,
  } from '../lib/types';

  type Props = { onClose: () => void; onRefresh: () => Promise<void> };
  const { onClose, onRefresh }: Props = $props();

  const ADD_NEW_ID = '__add-new__';
  let editingFeedId: string | null = $state(null);
  let formUrl = $state('');
  let formName = $state('');
  let formIsHoliday = $state(false);
  let formError: string | null = $state(null);
  let importError: string | null = $state(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let listContainer: HTMLUListElement | undefined = $state();

  const editingFeed = $derived(
    editingFeedId && editingFeedId !== ADD_NEW_ID
      ? config.feeds.find((f) => f.id === editingFeedId) ?? null
      : null,
  );
  const addingNew = $derived(editingFeedId === ADD_NEW_ID);

  function clearForm(): void {
    editingFeedId = null;
    formUrl = '';
    formName = '';
    formIsHoliday = false;
    formError = null;
  }

  function startEdit(feed: CalendarFeed): void {
    editingFeedId = feed.id;
    formUrl = feed.source.kind === 'user' ? feed.source.url : '';
    formName = feed.name;
    formIsHoliday = feed.kind === 'holidays';
    formError = null;
  }

  function startAdd(): void {
    editingFeedId = ADD_NEW_ID;
    formUrl = '';
    formName = '';
    formIsHoliday = false;
    formError = null;
  }

  $effect(() => {
    const targetId = ui.settingsAutoEditFeedId;
    if (!targetId) return;
    const feed = config.feeds.find((f) => f.id === targetId);
    if (feed) startEdit(feed);
    ui.settingsAutoEditFeedId = null;
  });

  $effect(() => {
    const targetId = ui.settingsScrollToFeedId;
    if (!targetId || !listContainer) return;
    queueMicrotask(() => {
      const item = listContainer?.querySelector<HTMLElement>(
        `[data-feed-card="${CSS.escape(targetId)}"]`,
      );
      if (item) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        item.classList.add('flash');
        setTimeout(() => item.classList.remove('flash'), 1200);
      }
      ui.settingsScrollToFeedId = null;
    });
  });

  function submitForm(e: Event): void {
    e.preventDefault();
    formError = null;
    if (editingFeed) {
      const target = config.feeds.find((f) => f.id === editingFeed.id);
      if (!target) return;
      target.name = formName.trim() || target.name;
      target.kind = formIsHoliday ? 'holidays' : 'events';
      if (target.source.kind === 'user' && formUrl.trim()) {
        target.source = { kind: 'user', url: formUrl.trim() };
      }
      void onRefresh();
      clearForm();
      return;
    }
    if (!formUrl.trim()) {
      formError = 'A URL is required.';
      return;
    }
    const source = { kind: 'user' as const, url: formUrl.trim() };
    const id = feedIdFor(source);
    if (config.feeds.some((f) => f.id === id)) {
      formError = 'A feed with this URL already exists.';
      return;
    }
    const feed: CalendarFeed = {
      id,
      source,
      name: formName.trim() || formUrl.trim(),
      collapsed: false,
      order: config.feeds.length,
      kind: formIsHoliday ? 'holidays' : 'events',
    };
    config.feeds.push(feed);
    clearForm();
    void onRefresh();
  }

  function removeFeed(id: string): void {
    config.feeds = config.feeds.filter((f) => f.id !== id);
    if (editingFeedId === id) clearForm();
  }

  function moveFeed(id: string, dir: -1 | 1): void {
    const sorted = [...config.feeds].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx]!;
    const b = sorted[swap]!;
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
  }

  function setFeedColor(feed: CalendarFeed, color: CalendarColor | null): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (!target) return;
    if (color) target.color = color;
    else delete target.color;
  }

  function setFeedStyle(feed: CalendarFeed, e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as StyleVariant | '';
    const target = config.feeds.find((f) => f.id === feed.id);
    if (!target) return;
    if (value) target.style = value;
    else delete target.style;
  }

  function applyImported(next: ReturnType<typeof importConfig>): void {
    config.feeds = next.feeds;
    config.refreshIntervalMs = next.refreshIntervalMs;
    config.theme = next.theme;
    config.locale = next.locale;
    config.dateFormat = next.dateFormat;
    config.rules = next.rules;
    config.cardShowDescription = next.cardShowDescription;
    config.cardShowLocation = next.cardShowLocation;
    config.timezone = next.timezone;
    config.timeFormat = next.timeFormat;
    config.pastMonths = next.pastMonths;
    config.futureMonths = next.futureMonths;
  }

  function downloadExport(): void {
    const json = exportConfig(config);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calendar-timeline-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyConfig(): Promise<void> {
    importError = null;
    try {
      await navigator.clipboard.writeText(exportConfig(config));
      ui.toast = 'Config copied';
      setTimeout(() => {
        if (ui.toast === 'Config copied') ui.toast = null;
      }, 2000);
    } catch (err) {
      importError = (err as Error).message;
    }
  }

  async function pasteConfig(): Promise<void> {
    importError = null;
    try {
      const text = await navigator.clipboard.readText();
      const next = importConfig(text);
      applyImported(next);
      void onRefresh();
    } catch (err) {
      importError = (err as Error).message;
    }
  }

  const shareUrl = $derived(buildShareUrl(config, zoom.value));
  const shareDisabled = $derived(shareUrl.length > SHARE_URL_LIMIT);
  const shareLabel = $derived(
    shareDisabled
      ? `Too long to share (${shareUrl.length} chars)`
      : 'Copy share link',
  );

  async function shareLink(): Promise<void> {
    if (shareDisabled) return;
    importError = null;
    try {
      await navigator.clipboard.writeText(shareUrl);
      ui.toast = 'Share link copied';
      setTimeout(() => {
        if (ui.toast === 'Share link copied') ui.toast = null;
      }, 2000);
    } catch (err) {
      importError = (err as Error).message;
    }
  }

  function triggerImport(): void {
    fileInput?.click();
  }

  async function handleImport(e: Event): Promise<void> {
    importError = null;
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const next = importConfig(text);
      applyImported(next);
      void onRefresh();
    } catch (err) {
      importError = (err as Error).message;
    }
    (e.currentTarget as HTMLInputElement).value = '';
  }

  function resetAndClear(): void {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Reset & clear all calendars, rules, and settings? This cannot be undone.',
      )
    ) {
      return;
    }
    const d = defaultConfig();
    applyImported(d);
    clearForm();
    void onRefresh();
  }

  const themeOptions: { id: Theme; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const localeOptions: { id: Locale; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'el', label: 'Ελληνικά' },
  ];
  const formatOptions: DateFormat[] = ['YYYY-MM-DD', 'DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'];
  const timezoneOptions: Timezone[] = ['local', 'UTC', 'Europe/Athens', 'America/New_York'];
  const timeFormatOptions: { id: TimeFormat; label: string }[] = [
    { id: '24h', label: '24-hour' },
    { id: '12h', label: '12-hour (AM/PM)' },
  ];
  const calendarStyleOptions: { id: StyleVariant | ''; label: string }[] = [
    { id: '', label: 'Default' },
    { id: 'muted', label: 'Muted' },
    { id: 'highlight', label: 'Highlight' },
    { id: 'inverted-dashed', label: 'Inverted (dashed)' },
    { id: 'inverted-strike', label: 'Inverted (strike)' },
  ];

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function showFeedError(feed: CalendarFeed): void {
    const message = ui.feedErrors[feed.id];
    if (message) ui.errorModal = { feedName: feed.name, message };
  }

  function feedTzLabel(feed: CalendarFeed): string {
    const tz = events.tzByFeed[feed.id];
    if (!tz) return '';
    const offset = formatUtcOffset(tz);
    return offset || '';
  }

  function feedStaleSince(feed: CalendarFeed): string {
    const ts = events.lastSuccessAt[feed.id];
    if (!ts || !ui.feedErrors[feed.id]) return '';
    const d = new Date(ts);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }
</script>

<div
  class="backdrop"
  onclick={onBackdropClick}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
  role="presentation"
>
  <aside class="panel" aria-label="Settings">
    <header class="panel-header">
      <h2>Settings</h2>
      <IconButton icon="close" label="Close settings" variant="ghost" onclick={onClose} />
    </header>

    <div class="panel-body">
    <section>
      <h3>Appearance</h3>
      <div class="field">
        <label for="theme-select">Theme</label>
        <select id="theme-select" bind:value={config.theme}>
          {#each themeOptions as t (t.id)}
            <option value={t.id}>{t.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="locale-select">Language</label>
        <select id="locale-select" bind:value={config.locale}>
          {#each localeOptions as l (l.id)}
            <option value={l.id}>{l.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="format-select">Date format</label>
        <select id="format-select" bind:value={config.dateFormat}>
          {#each formatOptions as f (f)}
            <option value={f}>{f}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="tz-select">Time zone</label>
        <select id="tz-select" bind:value={config.timezone}>
          {#each timezoneOptions as tz (tz)}
            <option value={tz}>{formatTimezoneLabel(tz)}</option>
          {/each}
        </select>
      </div>
      <div class="tz-now" aria-live="polite">
        {#key clock.now}
          <Icon name={isDaylight(config.timezone) ? 'sun' : 'moon'} size={16} />
          <span>{formatCurrentTzLabel(config.timezone)}</span>
        {/key}
      </div>
      <div class="field">
        <label for="time-fmt-select">Time format</label>
        <select id="time-fmt-select" bind:value={config.timeFormat}>
          {#each timeFormatOptions as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </div>
    </section>

    <section>
      <h3>Range</h3>
      <div class="field">
        <label for="past-months">Past months</label>
        <input
          id="past-months"
          type="number"
          min="0"
          max="120"
          bind:value={config.pastMonths}
        />
      </div>
      <div class="field">
        <label for="future-months">Future months</label>
        <input
          id="future-months"
          type="number"
          min="0"
          max="120"
          bind:value={config.futureMonths}
        />
      </div>
    </section>

    <section>
      <h3>Find &amp; replace</h3>
      <p class="hint section-hint">Rules below override per-calendar styles.</p>
      <RulesEditor />
    </section>

    <section>
      <div class="section-head">
        <h3>Calendars</h3>
        <button
          type="button"
          class="add-btn"
          aria-pressed={addingNew}
          onclick={() => (addingNew ? clearForm() : startAdd())}
        >
          <Icon name="plus" size={14} />
          <span>Add Calendar</span>
        </button>
      </div>
      <ul class="feeds" bind:this={listContainer}>
        {#if addingNew}
          <li data-feed-card={ADD_NEW_ID} data-active="true">
            <div class="feed-row">
              <span class="feed-name-text new-label">New calendar</span>
            </div>
            <form class="feed-edit" onsubmit={submitForm}>
              <div class="field">
                <label for="new-form-url">URL</label>
                <input
                  id="new-form-url"
                  type="url"
                  bind:value={formUrl}
                  placeholder="https://…"
                  required
                />
              </div>
              <div class="field">
                <label for="new-form-name">Name</label>
                <input id="new-form-name" type="text" bind:value={formName} placeholder="My calendar" />
              </div>
              <div class="field">
                <label for="new-form-holiday">Holidays Calendar</label>
                <input id="new-form-holiday" type="checkbox" bind:checked={formIsHoliday} />
              </div>
              <div class="form-actions">
                <button type="submit" class="primary">Add</button>
                <button type="button" onclick={clearForm}>Cancel</button>
              </div>
              {#if formError}<p class="error">{formError}</p>{/if}
            </form>
          </li>
        {/if}
        {#each [...config.feeds].sort((a, b) => a.order - b.order) as feed (feed.id)}
          <li
            data-feed-card={feed.id}
            data-active={editingFeedId === feed.id ? 'true' : null}
          >
            <div class="feed-row">
              <button
                type="button"
                class="feed-name-btn"
                onclick={() => (editingFeedId === feed.id ? clearForm() : startEdit(feed))}
                aria-label={'Edit ' + feed.name}
                aria-expanded={editingFeedId === feed.id}
              >
                <span class="feed-name-text">{feed.name}</span>
                {#if feedTzLabel(feed)}
                  <span class="feed-tz" data-mono>({feedTzLabel(feed)})</span>
                {/if}
              </button>
              {#if feed.kind === 'holidays'}
                <span class="kind-mark" title="Holidays Calendar">
                  <Icon name="calendar-strike" size={14} />
                </span>
              {/if}
              {#if ui.feedErrors[feed.id]}
                <button
                  type="button"
                  class="warn-btn"
                  aria-label={'Failed to load ' + feed.name + (feedStaleSince(feed) ? ' — stale since ' + feedStaleSince(feed) : '')}
                  title={feedStaleSince(feed) ? 'Stale since ' + feedStaleSince(feed) : 'Failed to load'}
                  onclick={() => showFeedError(feed)}
                >
                  <Icon name="warning" size={14} />
                </button>
              {/if}
              <IconButton icon="arrow-up" label="Move up" variant="ghost" size={16} onclick={() => moveFeed(feed.id, -1)} />
              <IconButton icon="arrow-down" label="Move down" variant="ghost" size={16} onclick={() => moveFeed(feed.id, 1)} />
              {#if feed.source.kind === 'user'}
                <IconButton icon="trash" label="Remove" variant="ghost" size={16} onclick={() => removeFeed(feed.id)} />
              {/if}
            </div>
            {#if editingFeedId === feed.id}
              <form class="feed-edit" onsubmit={submitForm}>
                <div class="field">
                  <label for="form-url-{feed.id}">URL</label>
                  <input
                    id="form-url-{feed.id}"
                    type="url"
                    bind:value={formUrl}
                    placeholder="https://…"
                    disabled={feed.source.kind !== 'user'}
                  />
                </div>
                <div class="field">
                  <label for="form-name-{feed.id}">Name</label>
                  <input id="form-name-{feed.id}" type="text" bind:value={formName} placeholder="My calendar" />
                </div>
                <div class="field">
                  <label for="form-holiday-{feed.id}">Holidays Calendar</label>
                  <input id="form-holiday-{feed.id}" type="checkbox" bind:checked={formIsHoliday} />
                </div>
                <div class="swatch-row" role="radiogroup" aria-label="Calendar color">
                  <button
                    type="button"
                    class="swatch swatch-none"
                    aria-pressed={!feed.color}
                    aria-label="No color"
                    onclick={() => setFeedColor(feed, null)}
                  ></button>
                  {#each CALENDAR_COLORS as c (c)}
                    <button
                      type="button"
                      class="swatch"
                      data-color={c}
                      aria-pressed={feed.color === c}
                      aria-label={'Color: ' + c}
                      onclick={() => setFeedColor(feed, c)}
                    ></button>
                  {/each}
                </div>
                <div class="field compact">
                  <label for="feed-style-{feed.id}">Style</label>
                  <select
                    id="feed-style-{feed.id}"
                    value={feed.style ?? ''}
                    onchange={(e) => setFeedStyle(feed, e)}
                  >
                    {#each calendarStyleOptions as s (s.id)}
                      <option value={s.id}>{s.label}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-actions">
                  <button type="submit" class="primary">Save</button>
                  <button type="button" onclick={clearForm}>Cancel</button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h3>Refresh interval</h3>
      <div class="segmented" role="radiogroup" aria-label="Refresh interval">
        {#each REFRESH_INTERVAL_OPTIONS as ms (ms)}
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={config.refreshIntervalMs === ms}
            onclick={() => (config.refreshIntervalMs = ms)}
          >{Math.round(ms / 60000)}m</button>
        {/each}
      </div>
    </section>

    <section>
      <h3>Configuration</h3>
      <div class="config-actions">
        <button type="button" onclick={downloadExport}>Export</button>
        <button type="button" onclick={triggerImport}>Import…</button>
        <button type="button" onclick={() => void copyConfig()}>Copy</button>
        <button type="button" onclick={() => void pasteConfig()}>Paste</button>
        <button
          type="button"
          onclick={() => void shareLink()}
          disabled={shareDisabled}
          title={shareLabel}
        >Share</button>
        <button type="button" class="danger" onclick={resetAndClear}>Reset &amp; Clear</button>
        <input
          bind:this={fileInput}
          type="file"
          accept="application/json"
          onchange={handleImport}
          hidden
        />
      </div>
      {#if importError}<p class="error">Import failed: {importError}</p>{/if}
    </section>

    <footer class="settings-footer">
      v{__APP_VERSION__} ·
      <a href={__APP_HOMEPAGE__} target="_blank" rel="noopener noreferrer">heracl.es/calendari</a>
    </footer>
    </div>
  </aside>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    z-index: 20;
    display: flex;
    justify-content: flex-end;
  }
  .panel {
    width: min(360px, 100vw);
    height: 100dvh;
    background: var(--paper);
    border-left: 1px solid var(--ink);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
  }
  .panel-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 1em 1em 2em;
    display: flex;
    flex-direction: column;
    gap: 1.25em;
    box-sizing: border-box;
  }
  .settings-footer {
    margin-top: auto;
    padding: 12px 4px 4px;
    border-top: 1px solid var(--ink);
    font-size: 11px;
    color: var(--ink-muted);
    text-align: center;
  }
  .settings-footer a {
    color: inherit;
  }
  .panel-header {
    flex: 0 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--ink);
    padding: 0.5em 1em;
    margin: 0;
    background: var(--paper);
    z-index: 1;
  }
  h2 {
    margin: 0;
    font-size: 1.1em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h3 {
    margin: 0 0 0.6em 0;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-muted);
    font-weight: 600;
  }
  section {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .field {
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: center;
    gap: 0.6em;
  }
  .field.compact {
    grid-template-columns: 60px 1fr;
  }
  .field label {
    font-size: 13px;
    color: var(--ink);
  }
  .field input,
  .field select {
    height: 32px;
    width: 100%;
    box-sizing: border-box;
  }
  .field input[type='checkbox'] {
    width: auto;
    height: auto;
    justify-self: start;
  }
  .feeds {
    list-style: none;
    padding: 0;
    margin: 0;
    border: 1px solid var(--ink);
    border-radius: 4px;
  }
  .feeds li {
    border-bottom: 1px solid var(--ink);
    transition: background 200ms ease;
  }
  .feeds li:last-child {
    border-bottom: none;
  }
  .feeds li[data-active='true'] {
    background: var(--paper-2);
  }
  .feeds :global(li.flash) {
    background: var(--paper-2);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .feed-row {
    display: flex;
    align-items: center;
    gap: 0.3em;
    padding: 6px 8px;
  }
  .feed-name-btn {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: baseline;
    gap: 0.4em;
    overflow: hidden;
    font-size: 13px;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    color: inherit;
    padding: 4px 6px;
    cursor: pointer;
  }
  .feed-name-btn:hover {
    border-color: var(--ink);
  }
  .feed-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
  }
  .feed-tz {
    font-size: 11px;
    color: var(--ink-muted);
    flex-shrink: 0;
  }
  .feed-edit {
    padding: 8px 8px 10px 8px;
    border-top: 1px dashed var(--ink-faint);
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .new-label {
    font-size: 13px;
    color: var(--ink-muted);
    padding: 4px 6px;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4em;
  }
  .section-head h3 {
    margin: 0;
  }
  .add-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    height: 26px;
    padding: 0 0.6em;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    cursor: pointer;
  }
  .add-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .tz-now {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    margin-left: 130px;
    font-size: 12px;
    color: var(--ink-muted);
    font-family: var(--mono);
  }
  .section-hint {
    margin: 0 0 0.4em 0;
  }
  .swatch-row {
    display: flex;
    gap: 0.4em;
    flex-wrap: wrap;
  }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid var(--ink-faint);
    background: var(--paper-2);
    cursor: pointer;
    padding: 0;
  }
  .swatch[data-color='peach'] { background: var(--cal-peach-bg); border-color: var(--cal-peach-border); }
  .swatch[data-color='amber'] { background: var(--cal-amber-bg); border-color: var(--cal-amber-border); }
  .swatch[data-color='mint'] { background: var(--cal-mint-bg); border-color: var(--cal-mint-border); }
  .swatch[data-color='teal'] { background: var(--cal-teal-bg); border-color: var(--cal-teal-border); }
  .swatch[data-color='sky'] { background: var(--cal-sky-bg); border-color: var(--cal-sky-border); }
  .swatch[data-color='lavender'] { background: var(--cal-lavender-bg); border-color: var(--cal-lavender-border); }
  .swatch-none {
    background: transparent;
    background-image: linear-gradient(45deg, transparent 47%, var(--ink-faint) 47%, var(--ink-faint) 53%, transparent 53%);
  }
  .swatch[aria-pressed='true'] {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--ink-muted);
  }
  .kind-mark {
    color: var(--ink-muted);
    display: inline-flex;
  }
  .warn-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--accent);
    background: var(--paper);
    color: var(--accent);
    cursor: pointer;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .form-actions {
    display: flex;
    gap: 0.4em;
  }
  .primary {
    padding: 6px 12px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
  }
  .segmented {
    display: inline-flex;
  }
  .segmented-btn {
    height: 32px;
    padding: 0 0.9em;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 12px;
    min-width: 48px;
  }
  .segmented-btn + .segmented-btn {
    border-left-width: 0;
  }
  .segmented-btn[aria-checked='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .config-actions {
    display: flex;
    gap: 0.4em;
    flex-wrap: wrap;
  }
  .config-actions button {
    height: 32px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 13px;
  }
  .config-actions .danger {
    color: var(--accent);
    border-color: var(--accent);
  }
  .error {
    margin: 0;
    color: var(--accent);
    font-size: 12px;
  }
  @media (max-width: 640px) {
    .panel {
      width: 100vw;
    }
  }
</style>
