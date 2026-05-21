<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import RulesEditor from './RulesEditor.svelte';
  import { config, ui, zoom, events, effectiveFeedTz, pushLog } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { exportConfig, importConfig, defaultConfig, REFRESH_INTERVAL_OPTIONS } from '../lib/storage';
  import { feedIdFor } from '../lib/ics';
  import { makeRule } from '../lib/rules';
  import {
    formatTimezoneLabel,
    formatUtcOffset,
    formatTzOption,
    formatCurrentTzLabel,
    TZ_OVERRIDE_OPTIONS,
  } from '../lib/format';
  import { buildShareUrl, SHARE_URL_LIMIT } from '../lib/share';
  import { longPress } from '../lib/haptics';
  import {
    CALENDAR_COLORS,
    type CalendarColor,
    type CalendarFeed,
    type DateFormat,
    type FeedCategory,
    type FindReplaceRule,
    type Locale,
    type StyleVariant,
    type Theme,
    type Timezone,
    type TimeFormat,
    type Travel,
  } from '../lib/types';

  type Props = { onClose: () => void; onRefresh: () => Promise<void> };
  const { onClose, onRefresh }: Props = $props();

  const ADD_NEW_ID = '__add-new__';
  let panelEl: HTMLElement | undefined = $state();
  let dismissing = $state(false);
  let swipeStartX: number | null = null;
  let swipeStartY: number | null = null;
  let editingFeedId: string | null = $state(null);
  let editingRuleId: string | null = $state(null);

  const CONFIRM_WINDOW_MS = 3000;
  let confirmDeleteFeedId: string | null = $state(null);
  let confirmDeleteFeedTimer: ReturnType<typeof setTimeout> | null = null;
  let doneDeleteFeedId: string | null = $state(null);
  let doneDeleteFeedTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmReset = $state(false);
  let confirmResetTimer: ReturnType<typeof setTimeout> | null = null;
  let doneReset = $state(false);
  let doneResetTimer: ReturnType<typeof setTimeout> | null = null;

  function onPanelPointerDown(e: PointerEvent): void {
    if (dismissing) return;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
  }
  function onPanelPointerUp(e: PointerEvent): void {
    if (swipeStartX == null || swipeStartY == null || dismissing) return;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    swipeStartX = null;
    swipeStartY = null;
    if (dx > 80 && Math.abs(dx) > Math.abs(dy)) dismissing = true;
  }
  function onPanelPointerCancel(): void {
    swipeStartX = null;
    swipeStartY = null;
  }
  function onPanelTransitionEnd(e: TransitionEvent): void {
    if (e.target !== panelEl) return;
    if (dismissing && e.propertyName === 'transform') {
      dismissing = false;
      onClose();
    }
  }
  let formUrl = $state('');
  let formName = $state('');
  let formCategory: FeedCategory = $state('none');
  let formTravel: Travel = $state('none');
  let formTimezone = $state('');
  let formError: string | null = $state(null);
  let importError: string | null = $state(null);
  let exportFlashed = $state(false);
  let importFlashed = $state(false);
  let exportFlashTimer: ReturnType<typeof setTimeout> | null = null;
  let importFlashTimer: ReturnType<typeof setTimeout> | null = null;
  function flashExport(): void {
    exportFlashed = true;
    if (exportFlashTimer) clearTimeout(exportFlashTimer);
    exportFlashTimer = setTimeout(() => { exportFlashed = false; }, 2500);
  }
  function flashImport(): void {
    importFlashed = true;
    if (importFlashTimer) clearTimeout(importFlashTimer);
    importFlashTimer = setTimeout(() => { importFlashed = false; }, 2500);
  }
  let fileInput: HTMLInputElement | undefined = $state();
  let listContainer: HTMLUListElement | undefined = $state();

  const editingFeed = $derived(
    editingFeedId && editingFeedId !== ADD_NEW_ID
      ? config.feeds.find((f) => f.id === editingFeedId) ?? null
      : null,
  );
  const addingNew = $derived(editingFeedId === ADD_NEW_ID);
  const sortedFeeds = $derived([...config.feeds].sort((a, b) => a.order - b.order));

  function clearForm(): void {
    editingFeedId = null;
    formUrl = '';
    formName = '';
    formCategory = 'none';
    formTravel = 'none';
    formTimezone = '';
    formError = null;
    if (confirmDeleteFeedTimer) clearTimeout(confirmDeleteFeedTimer);
    confirmDeleteFeedId = null;
    confirmDeleteFeedTimer = null;
  }

  function armConfirmReset(): void {
    confirmReset = true;
    if (confirmResetTimer) clearTimeout(confirmResetTimer);
    confirmResetTimer = setTimeout(() => {
      confirmReset = false;
      confirmResetTimer = null;
    }, CONFIRM_WINDOW_MS);
  }

  // Cancel any pending delete + confirm whenever the user closes
  // / switches the active feed form. The actual deletion timer is
  // also dropped — a Cancel click is an implicit undo.
  $effect(() => {
    if (editingFeedId === null) {
      if (doneDeleteFeedTimer) {
        clearTimeout(doneDeleteFeedTimer);
        doneDeleteFeedTimer = null;
        doneDeleteFeedId = null;
      }
    }
  });

  let draftRule: FindReplaceRule | null = $state(null);

  function addRule(): void {
    if (draftRule) return;
    const rule = makeRule();
    draftRule = rule;
    editingRuleId = rule.id;
  }

  function commitDraftRule(updates: { find: string; replace: string; style: StyleVariant; category: FeedCategory }): void {
    if (!draftRule) return;
    const next: FindReplaceRule = { ...draftRule, ...updates };
    config.rules = [...config.rules, next];
    draftRule = null;
    editingRuleId = null;
  }

  function discardDraftRule(): void {
    draftRule = null;
    editingRuleId = null;
  }

  function startEdit(feed: CalendarFeed): void {
    editingFeedId = feed.id;
    formUrl = feed.source.kind === 'user' ? feed.source.url : '';
    formName = feed.name;
    formCategory = feed.category ?? (feed.kind === 'holidays' ? 'holidays' : 'none');
    formTravel = feed.travel ?? 'none';
    formTimezone = feed.timezone ?? '';
    formError = null;
    scrollEditingFeedIntoView(feed.id);
  }

  function startAdd(): void {
    editingFeedId = ADD_NEW_ID;
    formUrl = '';
    formName = '';
    formCategory = 'none';
    formTravel = 'none';
    formTimezone = '';
    formError = null;
    scrollEditingFeedIntoView(ADD_NEW_ID);
  }

  function scrollEditingFeedIntoView(id: string): void {
    queueMicrotask(() => {
      const item = listContainer?.querySelector<HTMLElement>(
        `[data-feed-card="${CSS.escape(id)}"]`,
      );
      item?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  $effect(() => {
    const targetId = ui.settingsAutoEditFeedId;
    if (!targetId) return;
    const feed = config.feeds.find((f) => f.id === targetId);
    if (feed) startEdit(feed);
    ui.settingsAutoEditFeedId = null;
  });

  $effect(() => {
    const targetId = ui.settingsAutoEditRuleId;
    if (!targetId) return;
    if (config.rules.some((r) => r.id === targetId)) {
      editingRuleId = targetId;
    }
    ui.settingsAutoEditRuleId = null;
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
      const resolved = resolveTypeTravel();
      target.category = resolved.category;
      target.kind = resolved.category === 'holidays' ? 'holidays' : 'events';
      if (resolved.travel && resolved.travel !== 'none') target.travel = resolved.travel;
      else delete target.travel;
      if (!isScratchpad(target)) {
        if (formTimezone) target.timezone = formTimezone;
        else delete target.timezone;
        if (target.source.kind === 'user' && formUrl.trim()) {
          target.source = { kind: 'user', url: formUrl.trim() };
        }
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
    const resolved = resolveTypeTravel();
    const feed: CalendarFeed = {
      id,
      source,
      name: formName.trim() || formUrl.trim(),
      collapsed: false,
      order: config.feeds.length,
      kind: resolved.category === 'holidays' ? 'holidays' : 'events',
      category: resolved.category,
      ...(resolved.travel && resolved.travel !== 'none' ? { travel: resolved.travel } : {}),
      ...(formTimezone ? { timezone: formTimezone } : {}),
    };
    config.feeds.push(feed);
    clearForm();
    void onRefresh();
  }

  function removeFeed(id: string): void {
    // Tap on Delete ✓ while the done flash is up cancels the pending
    // deletion. The mutation hasn't run yet; we just drop the timer.
    if (doneDeleteFeedId === id) {
      if (doneDeleteFeedTimer) clearTimeout(doneDeleteFeedTimer);
      doneDeleteFeedId = null;
      doneDeleteFeedTimer = null;
      return;
    }
    if (confirmDeleteFeedId !== id) {
      if (confirmDeleteFeedTimer) clearTimeout(confirmDeleteFeedTimer);
      confirmDeleteFeedId = id;
      confirmDeleteFeedTimer = setTimeout(() => {
        confirmDeleteFeedId = null;
        confirmDeleteFeedTimer = null;
      }, CONFIRM_WINDOW_MS);
      return;
    }
    if (confirmDeleteFeedTimer) clearTimeout(confirmDeleteFeedTimer);
    confirmDeleteFeedId = null;
    confirmDeleteFeedTimer = null;
    doneDeleteFeedId = id;
    if (doneDeleteFeedTimer) clearTimeout(doneDeleteFeedTimer);
    doneDeleteFeedTimer = setTimeout(() => {
      doneDeleteFeedId = null;
      doneDeleteFeedTimer = null;
      config.feeds = config.feeds.filter((f) => f.id !== id);
      if (editingFeedId === id) clearForm();
    }, CONFIRM_WINDOW_MS);
  }

  function isScratchpad(feed: CalendarFeed): boolean {
    return feed.source.kind === 'scratchpad';
  }

  function toggleHidden(feed: CalendarFeed): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (!target) return;
    if (target.hidden) delete target.hidden;
    else target.hidden = true;
  }

  function moveFeed(id: string, dir: -1 | 1): void {
    const sorted = [...config.feeds].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === id);
    if (idx < 0 || sorted.length < 2) return;
    const swap = (idx + dir + sorted.length) % sorted.length;
    if (swap === idx) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(swap, 0, moved!);
    reordered.forEach((f, i) => {
      const target = config.feeds.find((c) => c.id === f.id);
      if (target) target.order = i;
    });
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
    config.weekStart = next.weekStart;
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
      pushLog('Config copied');
      flashExport();
    } catch (err) {
      importError = (err as Error).message;
    }
  }

  async function pasteConfig(): Promise<void> {
    importError = null;
    try {
      const text = await navigator.clipboard.readText();
      const next = importConfig(text);
      if (typeof window !== 'undefined' && !window.confirm(
        'Replace current calendars, rules, and settings with the clipboard content?',
      )) return;
      applyImported(next);
      void onRefresh();
      flashImport();
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
      pushLog('Share link copied');
    } catch (err) {
      importError = (err as Error).message;
    }
  }

  function triggerImport(): void {
    fileInput?.click();
  }

  const LONGPRESS_MS = 500;
  let exportPressTimer: ReturnType<typeof setTimeout> | null = null;
  let exportLongFired = false;
  let importPressTimer: ReturnType<typeof setTimeout> | null = null;
  let importLongFired = false;

  function startExportPress(): void {
    exportLongFired = false;
    if (exportPressTimer) clearTimeout(exportPressTimer);
    exportPressTimer = setTimeout(() => {
      exportPressTimer = null;
      exportLongFired = true;
      longPress();
      void copyConfig();
    }, LONGPRESS_MS);
  }

  function cancelExportPress(): void {
    if (exportPressTimer) {
      clearTimeout(exportPressTimer);
      exportPressTimer = null;
    }
  }

  function handleExportClick(): void {
    if (exportLongFired) {
      exportLongFired = false;
      return;
    }
    downloadExport();
  }

  function startImportPress(): void {
    importLongFired = false;
    if (importPressTimer) clearTimeout(importPressTimer);
    importPressTimer = setTimeout(() => {
      importPressTimer = null;
      importLongFired = true;
      longPress();
      void pasteConfig();
    }, LONGPRESS_MS);
  }

  function cancelImportPress(): void {
    if (importPressTimer) {
      clearTimeout(importPressTimer);
      importPressTimer = null;
    }
  }

  function handleImportClick(): void {
    if (importLongFired) {
      importLongFired = false;
      return;
    }
    triggerImport();
  }

  async function handleImport(e: Event): Promise<void> {
    importError = null;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const next = importConfig(text);
      if (typeof window === 'undefined' || window.confirm(
        `Replace current calendars, rules, and settings with the file '${file.name}'?`,
      )) {
        applyImported(next);
        void onRefresh();
        flashImport();
      }
    } catch (err) {
      importError = (err as Error).message;
    }
    input.value = '';
  }

  function resetAndClear(): void {
    if (!confirmReset) {
      armConfirmReset();
      return;
    }
    if (confirmResetTimer) clearTimeout(confirmResetTimer);
    confirmReset = false;
    confirmResetTimer = null;
    const d = defaultConfig();
    applyImported(d);
    clearForm();
    void onRefresh();
    doneReset = true;
    if (doneResetTimer) clearTimeout(doneResetTimer);
    doneResetTimer = setTimeout(() => {
      doneReset = false;
      doneResetTimer = null;
    }, CONFIRM_WINDOW_MS);
  }

  const themeOptions: { id: Theme; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const localeOptions: { id: Locale; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'el', label: 'Ελληνικά' },
  ];
  const formatOptions: { id: DateFormat; label: string }[] = [
    { id: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
    { id: 'DD MMM YYYY', label: 'DD MMM YYYY' },
    { id: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
    { id: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' },
  ];
  const timezoneOptions: Timezone[] = ['local', 'UTC', 'Europe/Athens', 'America/New_York'];
  const timeFormatOptions: { id: TimeFormat; label: string }[] = [
    { id: '24h', label: '24-hour' },
    { id: '12h', label: '12-hour (AM/PM)' },
  ];
  const calendarStyleOptions: { id: StyleVariant | ''; label: string }[] = [
    { id: '', label: 'Default' },
    { id: 'bold', label: 'Bold' },
    { id: 'inverted', label: 'Inverted' },
    { id: 'dashed', label: 'Dashed' },
    { id: 'muted', label: 'Muted' },
    { id: 'striked', label: 'Striked' },
    { id: 'hidden', label: 'Hidden' },
  ];
  const categoryOptions: { id: FeedCategory; label: string }[] = [
    { id: 'none', label: 'Auto' },
    { id: 'events', label: 'Events' },
    { id: 'holidays', label: 'Holidays' },
    { id: 'observances', label: 'Observances' },
    { id: 'announcements', label: 'Announcements' },
    { id: 'guests', label: 'Guests' },
  ];
  const travelOptions: { id: Travel; label: string }[] = [
    { id: 'none', label: 'N/A' },
    { id: 'international', label: 'International' },
    { id: 'local', label: 'Local' },
  ];

  // "Auto" type: detect category and travel from the calendar title.
  function detectCategory(name: string): FeedCategory {
    const n = name.toLowerCase();
    if (/holiday|holidays/.test(n)) return 'holidays';
    if (/observ/.test(n)) return 'observances';
    if (/announc|news/.test(n)) return 'announcements';
    if (/guest|birthday|anniversar/.test(n)) return 'guests';
    if (/event|calendar|schedule|agenda/.test(n)) return 'events';
    return 'none';
  }
  function detectTravel(name: string): Travel {
    const n = name.toLowerCase();
    if (/travel|trip|flight|abroad|international/.test(n)) return 'international';
    if (/local|domestic|home/.test(n)) return 'local';
    return 'none';
  }
  // Resolve the chosen type: when "Auto" (none) is selected, infer from the
  // title; otherwise use the explicit type + travel from the form.
  function resolveTypeTravel(): { category: FeedCategory; travel: Travel } {
    if (formCategory !== 'none') return { category: formCategory, travel: formTravel };
    const name = formName.trim() || formUrl.trim();
    return { category: detectCategory(name), travel: detectTravel(name) };
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function showFeedError(feed: CalendarFeed): void {
    const message = ui.feedErrors[feed.id];
    if (message) ui.errorModal = { feedName: feed.name, message };
  }

  function formatTzNowLabel(tz: Timezone): string {
    // Mirror the "{offset} · {city}" format used by formatTimezoneLabel
    // dropdown rows, so the inline reading matches the selector above.
    const parts = formatCurrentTzLabel(tz).split(' · ');
    if (parts.length === 2) return parts[1] + ' · ' + parts[0];
    return formatCurrentTzLabel(tz);
  }

  function feedTzLabel(feed: CalendarFeed): string {
    const tz = effectiveFeedTz(feed.id);
    if (!tz) return '';
    const offset = formatUtcOffset(tz);
    return offset || '';
  }

  function categoryIconName(c: FeedCategory): string | null {
    if (c === 'holidays') return 'category-holiday';
    if (c === 'observances') return 'category-observances';
    if (c === 'guests') return 'category-guests';
    if (c === 'announcements') return 'category-announcements';
    return null;
  }

  function categoryLabelText(c: FeedCategory): string {
    if (c === 'holidays') return 'Holidays';
    if (c === 'observances') return 'Observances';
    if (c === 'guests') return 'Guests';
    if (c === 'announcements') return 'Announcements';
    return '';
  }

  function travelIconName(t: Travel | undefined): string | null {
    if (t === 'international') return 'category-airplane';
    if (t === 'local') return 'category-bus';
    return null;
  }

  function travelLabelText(t: Travel | undefined): string {
    if (t === 'international') return 'Travel (International)';
    if (t === 'local') return 'Travel (Local)';
    return '';
  }
</script>

<div
  class="backdrop"
  class:dismissing
  onclick={onBackdropClick}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
  role="presentation"
>
  <aside
    bind:this={panelEl}
    class="panel"
    class:dismissing
    aria-label="Settings"
    onpointerdown={onPanelPointerDown}
    onpointerup={onPanelPointerUp}
    onpointercancel={onPanelPointerCancel}
    ontransitionend={onPanelTransitionEnd}
  >
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
          {#each formatOptions as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="time-fmt-select">Time format</label>
        <select id="time-fmt-select" bind:value={config.timeFormat}>
          {#each timeFormatOptions as f (f.id)}
            <option value={f.id}>{f.label}</option>
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
      <div class="field">
        <span></span>
        <div class="tz-now" aria-live="polite">
          <span>{formatTzNowLabel('local')}</span>
        </div>
      </div>
    </section>

    <section>
      <h3>Boundaries</h3>
      <div class="field">
        <span class="field-label">Week starts</span>
        <div class="segmented" role="radiogroup" aria-label="Week starts on">
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={config.weekStart === 'monday'}
            onclick={() => (config.weekStart = 'monday')}
          >Mon</button>
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={config.weekStart === 'sunday'}
            onclick={() => (config.weekStart = 'sunday')}
          >Sun</button>
        </div>
      </div>
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
      <div class="field">
        <label for="morning-limit" class="icon-label">
          <Icon name="sun" size={13} />
          <span>Morning</span>
        </label>
        <input
          id="morning-limit"
          type="time"
          bind:value={config.morningLimit}
        />
      </div>
      <div class="field">
        <label for="evening-limit" class="icon-label">
          <Icon name="moon" size={13} />
          <span>Evening</span>
        </label>
        <input
          id="evening-limit"
          type="time"
          bind:value={config.eveningLimit}
        />
      </div>
    </section>

    <section>
      <div class="section-head">
        <h3>Event Filters</h3>
        <button
          type="button"
          class="add-btn"
          onclick={addRule}
        >
          <Icon name="plus" size={14} />
          <span>Add</span>
        </button>
      </div>
      <RulesEditor
        editingRuleId={editingRuleId}
        onEditingChange={(id) => (editingRuleId = id)}
        draftRule={draftRule}
        onCommitDraft={commitDraftRule}
        onDiscardDraft={discardDraftRule}
      />
    </section>

    <section>
      <div class="section-head">
        <h3>Calendars</h3>
        <button
          type="button"
          class="add-btn"
          aria-pressed={addingNew}
          disabled={!online.value && !addingNew}
          title={!online.value ? 'Offline — cannot validate new calendar' : undefined}
          onclick={() => (addingNew ? clearForm() : startAdd())}
        >
          <Icon name="plus" size={14} />
          <span>Add</span>
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
                <label for="new-form-category">Type</label>
                <select id="new-form-category" bind:value={formCategory}>
                  {#each categoryOptions as c (c.id)}
                    <option value={c.id}>{c.label}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="new-form-travel">Travel</label>
                <select id="new-form-travel" bind:value={formTravel}>
                  {#each travelOptions as t (t.id)}
                    <option value={t.id}>{t.label}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="new-form-tz">Time zone</label>
                <select id="new-form-tz" bind:value={formTimezone}>
                  <option value="">Auto</option>
                  {#each TZ_OVERRIDE_OPTIONS as tz (tz)}
                    <option value={tz}>{formatTzOption(tz)}</option>
                  {/each}
                </select>
              </div>
              <div class="form-actions">
                <button type="button" onclick={clearForm}>Cancel</button>
                <button type="submit" class="primary">Add</button>
              </div>
              {#if formError}<p class="error">{formError}</p>{/if}
            </form>
          </li>
        {/if}
        {#each sortedFeeds as feed, fi (feed.id)}
          <li
            data-feed-card={feed.id}
            data-active={editingFeedId === feed.id ? 'true' : null}
          >
            <div class="feed-row">
              {#if isScratchpad(feed)}
                <span class="kind-mark" title="Draft" aria-label="Draft">
                  <Icon name="plus" size={14} />
                </span>
              {/if}
              {#if travelIconName(feed.travel)}
                <span class="kind-mark" title={travelLabelText(feed.travel)}>
                  <Icon name={travelIconName(feed.travel)!} size={14} />
                </span>
              {/if}
              {#if categoryIconName(feed.category)}
                <span class="kind-mark" title={categoryLabelText(feed.category)}>
                  <Icon name={categoryIconName(feed.category)!} size={14} />
                </span>
              {/if}
              <button
                type="button"
                class="feed-name-btn"
                data-disabled={feed.hidden ? 'true' : null}
                onclick={() => (editingFeedId === feed.id ? clearForm() : startEdit(feed))}
                aria-label={'Edit ' + feed.name}
                aria-expanded={editingFeedId === feed.id}
              >
                <span class="feed-name-text">{feed.name}</span>
                {#if feedTzLabel(feed)}
                  <span class="feed-tz" data-mono>({feedTzLabel(feed)})</span>
                {/if}
              </button>
              {#if ui.feedErrors[feed.id]}
                <button
                  type="button"
                  class="warn-btn"
                  aria-label={'Failed to load ' + feed.name}
                  title="Show error"
                  onclick={() => showFeedError(feed)}
                >
                  <Icon name="help" size={14} />
                </button>
              {/if}
              <IconButton
                icon={fi === 0 ? 'arrow-bar-down' : 'arrow-up'}
                label={fi === 0 ? 'Wrap to end' : 'Move up'}
                variant="ghost"
                size={16}
                onclick={() => moveFeed(feed.id, -1)}
              />
              <IconButton
                icon={fi === sortedFeeds.length - 1 ? 'arrow-bar-up' : 'arrow-down'}
                label={fi === sortedFeeds.length - 1 ? 'Wrap to start' : 'Move down'}
                variant="ghost"
                size={16}
                onclick={() => moveFeed(feed.id, 1)}
              />
            </div>
            {#if editingFeedId === feed.id}
              <form class="feed-edit" onsubmit={submitForm}>
                {#if !isScratchpad(feed)}
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
                {/if}
                <div class="field">
                  <label for="form-name-{feed.id}">Name</label>
                  <input id="form-name-{feed.id}" type="text" bind:value={formName} placeholder="My calendar" />
                </div>
                <div class="field">
                  <label for="feed-color-{feed.id}">Color</label>
                  <select
                    id="feed-color-{feed.id}"
                    class="color-select"
                    data-color={feed.color ?? null}
                    value={feed.color ?? ''}
                    onchange={(e) => setFeedColor(feed, ((e.currentTarget as HTMLSelectElement).value || null) as CalendarColor | null)}
                  >
                    <option value="">No color</option>
                    {#each CALENDAR_COLORS as c (c)}
                      <option value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    {/each}
                  </select>
                </div>
                <div class="field">
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
                {#if !isScratchpad(feed)}
                  <div class="field">
                    <label for="form-category-{feed.id}">Type</label>
                    <select id="form-category-{feed.id}" bind:value={formCategory}>
                      {#each categoryOptions as c (c.id)}
                        <option value={c.id}>{c.label}</option>
                      {/each}
                    </select>
                  </div>
                  <div class="field">
                    <label for="form-travel-{feed.id}">Travel</label>
                    <select id="form-travel-{feed.id}" bind:value={formTravel}>
                      {#each travelOptions as t (t.id)}
                        <option value={t.id}>{t.label}</option>
                      {/each}
                    </select>
                  </div>
                {/if}
                {#if !isScratchpad(feed)}
                  <div class="field">
                    <label for="form-tz-{feed.id}">Time zone</label>
                    <select id="form-tz-{feed.id}" bind:value={formTimezone}>
                      <option value=""
                        >Auto{events.tzByFeed[feed.id]
                          ? ' (' + events.tzByFeed[feed.id] + ')'
                          : ''}</option>
                      {#each TZ_OVERRIDE_OPTIONS as tz (tz)}
                        <option value={tz}>{formatTzOption(tz)}</option>
                      {/each}
                    </select>
                  </div>
                {/if}
                <div class="form-actions feed-form-actions">
                  <button
                    type="button"
                    class="disable-btn"
                    data-state={feed.hidden ? 'enable' : 'disable'}
                    onclick={() => toggleHidden(feed)}
                  >{feed.hidden ? 'Enable' : 'Disable'}</button>
                  {#if feed.source.kind === 'user'}
                    <button
                      type="button"
                      class="delete-btn"
                      class:confirming={confirmDeleteFeedId === feed.id}
                      class:done={doneDeleteFeedId === feed.id}
                      title={doneDeleteFeedId === feed.id ? 'Tap to cancel deletion' : undefined}
                      onclick={() => removeFeed(feed.id)}
                    >{doneDeleteFeedId === feed.id
                      ? 'Delete ✓'
                      : confirmDeleteFeedId === feed.id
                        ? 'Confirm delete'
                        : 'Delete'}</button>
                  {/if}
                  <span class="action-spacer"></span>
                  <button
                    type="button"
                    onclick={clearForm}
                    disabled={doneDeleteFeedId === feed.id}
                  >Cancel</button>
                  <button
                    type="submit"
                    class="primary"
                    disabled={doneDeleteFeedId === feed.id}
                  >Save</button>
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
          {@const minutes = Math.round(ms / 60000)}
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={config.refreshIntervalMs === ms}
            onclick={() => (config.refreshIntervalMs = ms)}
          >{minutes >= 60 ? minutes / 60 + 'h' : minutes + 'm'}</button>
        {/each}
      </div>
    </section>

    <section>
      <h3>Configuration</h3>
      <div class="config-actions">
        <button
          type="button"
          title="Export to file (long-press to copy to clipboard)"
          aria-label="Export to file (long-press to copy to clipboard)"
          onclick={handleExportClick}
          onpointerdown={startExportPress}
          onpointerup={cancelExportPress}
          onpointercancel={cancelExportPress}
          onpointerleave={cancelExportPress}
        >{exportFlashed ? 'COPIED' : 'Export'}</button>
        <button
          type="button"
          title="Import from file (long-press to paste from clipboard)"
          aria-label="Import from file (long-press to paste from clipboard)"
          onclick={handleImportClick}
          onpointerdown={startImportPress}
          onpointerup={cancelImportPress}
          onpointercancel={cancelImportPress}
          onpointerleave={cancelImportPress}
        >{importFlashed ? 'PASTED' : 'Import'}</button>
        <button
          type="button"
          onclick={() => void shareLink()}
          disabled={shareDisabled}
          title={shareLabel}
        >Share</button>
        <button
          type="button"
          class="danger"
          class:confirming={confirmReset}
          class:done={doneReset}
          disabled={doneReset}
          onclick={resetAndClear}
        >{doneReset ? 'Reset ✓' : confirmReset ? 'Confirm reset' : 'Reset'}</button>
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
      <div>
        v{__APP_VERSION__} ·
        <a href={__APP_HOMEPAGE__} target="_blank" rel="noopener noreferrer">heracl.es/almanacs</a>
      </div>
      <div class="credit">Dialectic Acheiropoieton of<br />Heracles Papatheodorou and Claude</div>
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
    transition: background 150ms ease-in;
  }
  .backdrop.dismissing {
    background: rgba(0, 0, 0, 0);
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
    transition: transform 150ms ease-in, opacity 150ms ease-in;
  }
  .panel.dismissing {
    transform: translateX(100%);
    opacity: 0;
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
    padding: 4px;
    font-size: 11px;
    color: var(--ink-muted);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    user-select: none;
  }
  .settings-footer::before {
    content: '* * *';
    letter-spacing: 0.4em;
    color: var(--ink-muted);
    padding-bottom: 8px;
  }
  .settings-footer a {
    color: inherit;
  }
  .settings-footer .credit {
    font-style: italic;
  }
  .form-actions {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin-top: 0.4em;
  }
  .form-actions .action-spacer {
    flex: 1;
  }
  .form-actions button {
    display: inline-flex;
    align-items: center;
    height: 26px;
    padding: 0 0.6em;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    cursor: pointer;
  }
  .form-actions .delete-btn {
    border-color: var(--accent);
    color: var(--accent);
  }
  .form-actions .delete-btn:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .form-actions .delete-btn.confirming {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
  .form-actions .delete-btn.done {
    background: var(--paper);
    color: var(--ink);
    border-color: var(--ink);
  }
  .form-actions .disable-btn[data-state='disable'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .form-actions .disable-btn[data-state='disable']:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .form-actions .disable-btn[data-state='enable']:hover {
    background: var(--paper-2);
  }
  .feed-edit input[type='text']:focus,
  .feed-edit input[type='url']:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
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
    user-select: none;
  }
  h3 {
    margin: 0 0 0.6em 0;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-muted);
    font-weight: 600;
    user-select: none;
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
  .field label,
  .field .field-label {
    font-size: 13px;
    color: var(--ink);
    user-select: none;
  }
  .field label.icon-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }
  .field input,
  .field select {
    height: 32px;
    width: 100%;
    box-sizing: border-box;
  }
  .feeds {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .feeds li {
    transition: background 200ms ease;
  }
  .feeds li + li {
    border-top: 1px solid var(--ink);
  }
  .feeds li[data-active='true'] + li,
  .feeds li[data-active='true'] {
    border-top-color: transparent;
  }
  .feeds li[data-active='true'] {
    background: var(--paper-2);
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .feeds li[data-active='true'] .feed-name-btn .feed-name-text {
    text-decoration: underline;
    text-underline-offset: 2px;
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
  .feed-name-btn:hover .feed-name-text,
  .feed-name-btn:focus-visible .feed-name-text {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .feed-name-btn[data-disabled='true'] .feed-name-text {
    text-decoration: line-through;
    text-decoration-color: var(--ink-muted);
    color: var(--ink-muted);
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
    border-top: 1px dashed var(--ink);
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
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    cursor: pointer;
  }
  .add-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
  .tz-now {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-size: 12px;
    color: var(--ink-muted);
    font-family: var(--mono);
  }
  .color-select[data-color='peach'] { background: var(--cal-peach-bg); }
  .color-select[data-color='amber'] { background: var(--cal-amber-bg); }
  .color-select[data-color='mint'] { background: var(--cal-mint-bg); }
  .color-select[data-color='teal'] { background: var(--cal-teal-bg); }
  .color-select[data-color='sky'] { background: var(--cal-sky-bg); }
  .color-select[data-color='lavender'] { background: var(--cal-lavender-bg); }
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
  .segmented {
    display: flex;
    width: 100%;
  }
  .segmented-btn {
    flex: 1 1 0;
    min-width: 0;
    height: 32px;
    padding: 0 0.9em;
    border: var(--btn-border-w) solid var(--ink);
    border-radius: 0;
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 12px;
  }
  .segmented-btn + .segmented-btn {
    border-left-width: 0;
  }
  .segmented-btn:first-of-type {
    border-top-left-radius: var(--btn-radius);
    border-bottom-left-radius: var(--btn-radius);
  }
  .segmented-btn:last-of-type {
    border-top-right-radius: var(--btn-radius);
    border-bottom-right-radius: var(--btn-radius);
  }
  .segmented-btn[aria-checked='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .config-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4em;
  }
  .config-actions button {
    width: 100%;
    height: 32px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 13px;
  }
  .config-actions .danger {
    color: var(--accent);
    border-color: var(--accent);
  }
  .config-actions .danger.confirming {
    background: var(--accent);
    color: var(--paper);
  }
  .config-actions .danger.done {
    background: var(--paper);
    color: var(--ink);
    border-color: var(--ink);
    cursor: default;
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
