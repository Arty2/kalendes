<script lang="ts">
  import IconButton from './IconButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import Icon from './Icon.svelte';
  import LocalBadge from './LocalBadge.svelte';
  import RulesEditor from './RulesEditor.svelte';
  import {
    config,
    ui,
    zoom,
    events,
    effectiveFeedTz,
    pushLog,
    createImportedLane,
    removeLocalLane,
    seedTestData,
    clearDraftLane,
  } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import {
    exportConfig,
    importConfig,
    defaultConfig,
    saveConfig,
    loadSettingsSections,
    saveSettingsSections,
    REFRESH_INTERVAL_OPTIONS,
  } from '../lib/storage';
  import { feedIdFor } from '../lib/ics';
  import { normalizeFeedUrl } from '../lib/feed-url';
  import { parseIcs } from '../lib/ics-core';
  import { rangeForToday } from '../lib/layout';
  import {
    isIcsText,
    calNameFromIcs,
    eventsToIcs,
    exportLaneFilename,
  } from '../lib/scratchpad';
  import { makeRule } from '../lib/rules';
  import {
    formatTimezoneLabel,
    formatUtcOffset,
    formatTzOption,
    formatAutoLabel,
    offsetMinutes,
    resolveLocalTz,
    TZ_PINNED,
    TZ_REST,
  } from '../lib/format';
  import { buildShareUrl, SHARE_URL_LIMIT, tryNativeShare } from '../lib/share';
  import { longPress, panelOpen, canVibrate } from '../lib/haptics';
  import { categoryIcon, travelIcon } from '../lib/icons';
  import {
    CALENDAR_COLORS,
    type Block,
    type CalendarColor,
    type CalendarFeed,
    type DateFormat,
    type FeedCategory,
    type FindReplaceRule,
    type FontSize,
    type Haptics,
    type Locale,
    type MatchPosition,
    type Motion,
    type Palette,
    type Scheme,
    type Spacing,
    type StyleVariant,
    type TimeFormat,
    type Travel,
    type TraySide,
  } from '../lib/types';

  type Props = { onClose: () => void; onRefresh: () => Promise<void> };
  const { onClose, onRefresh }: Props = $props();

  // The panel only mounts when opened — fire a firm pulse, like the tray.
  $effect(() => {
    panelOpen();
  });

  // Each section's <details> open state survives close/reopen (and reloads):
  // restored on mount, persisted on every toggle.
  const sections = $state(loadSettingsSections());
  $effect(() => {
    saveSettingsSections({ ...sections });
  });

  const ADD_NEW_ID = '__add-new__';
  let panelEl: HTMLElement | undefined = $state();
  let dismissing = $state(false);
  let swipeStartX: number | null = null;
  let swipeStartY: number | null = null;
  let editingFeedId: string | null = $state(null);
  let editingRuleId: string | null = $state(null);

  // Tracks the inline feed Delete confirm button so Cancel/Save can be gated
  // while a deletion is armed in its cooldown.
  let deleteFeedState: 'idle' | 'confirm' | 'done' | 'undo' = $state('idle');

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
  let formBlock: Block = $state('none');
  let formTimezone = $state('');
  let formHidden = $state(false);
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
  let shareFlashed = $state(false);
  let shareFlashTimer: ReturnType<typeof setTimeout> | null = null;
  function flashShareCopied(): void {
    shareFlashed = true;
    if (shareFlashTimer) clearTimeout(shareFlashTimer);
    shareFlashTimer = setTimeout(() => { shareFlashed = false; }, 3000);
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
    formBlock = 'none';
    formTimezone = '';
    formHidden = false;
    formError = null;
  }

  let draftRule: FindReplaceRule | null = $state(null);

  function addRule(): void {
    if (draftRule) return;
    const rule = makeRule();
    draftRule = rule;
    editingRuleId = rule.id;
  }

  function commitDraftRule(updates: { find: string; replace: string; style: StyleVariant; category: FeedCategory; color: CalendarColor | undefined; block: Block | undefined; position: MatchPosition; disabled: boolean }): void {
    if (!draftRule) return;
    const next: FindReplaceRule = { ...draftRule, ...updates };
    if (next.position === 'any') delete next.position;
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
    formBlock = feed.block ?? 'none';
    formTimezone = feed.timezone ?? '';
    formHidden = !!feed.hidden;
    formError = null;
    scrollEditingFeedIntoView(feed.id);
  }

  function startAdd(): void {
    editingFeedId = ADD_NEW_ID;
    formUrl = '';
    formName = '';
    formCategory = 'none';
    formTravel = 'none';
    formBlock = 'none';
    formTimezone = '';
    formHidden = false;
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
      if (formBlock !== 'none') target.block = formBlock;
      else delete target.block;
      if (formHidden) target.hidden = true;
      else delete target.hidden;
      if (formTimezone) target.timezone = formTimezone;
      else delete target.timezone;
      if (!isScratchpad(target) && target.source.kind === 'user' && formUrl.trim()) {
        target.source = { kind: 'user', url: normalizeFeedUrl(formUrl) };
      }
      void onRefresh();
      clearForm();
      return;
    }
    if (!formUrl.trim()) {
      formError = 'A URL is required.';
      return;
    }
    const source = { kind: 'user' as const, url: normalizeFeedUrl(formUrl) };
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
      ...(formBlock !== 'none' ? { block: formBlock } : {}),
      ...(formTimezone ? { timezone: formTimezone } : {}),
      ...(formHidden ? { hidden: true } : {}),
    };
    config.feeds.push(feed);
    clearForm();
    void onRefresh();
  }

  function commitRemoveFeed(id: string): void {
    // Local lanes (Draft + imported .ics) keep their events in the scratchpad
    // store; purge it so a deleted lane does not resurrect on reload.
    if (id.startsWith('scratchpad:')) removeLocalLane(id);
    config.feeds = config.feeds.filter((f) => f.id !== id);
    if (editingFeedId === id) clearForm();
  }

  function isScratchpad(feed: CalendarFeed): boolean {
    return feed.source.kind === 'scratchpad';
  }

  // The built-in Draft lane is permanent; imported .ics lanes and URL feeds can
  // be deleted.
  function isDeletableFeed(feed: CalendarFeed): boolean {
    if (feed.source.kind === 'scratchpad') return (feed.source.id ?? 'default') !== 'default';
    return feed.source.kind === 'user';
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
    config.scheme = next.scheme;
    config.palette = next.palette;
    config.motion = next.motion;
    config.haptics = next.haptics;
    config.fontSize = next.fontSize;
    config.locale = next.locale;
    config.dateFormat = next.dateFormat;
    config.rules = next.rules;
    config.cardShowDescription = next.cardShowDescription;
    config.cardShowLocation = next.cardShowLocation;
    config.timezone = next.timezone;
    config.timeFormat = next.timeFormat;
    config.weekStart = next.weekStart;
    config.timezone2 = next.timezone2;
    config.pastMonths = next.pastMonths;
    config.futureMonths = next.futureMonths;
    config.morningLimit = next.morningLimit;
    config.eveningLimit = next.eveningLimit;
    config.trayFilter = next.trayFilter;
  }

  // Parse an .ics payload and add it as a new local lane. Returns true on success.
  function importIcsAsLane(text: string, fallbackName: string): boolean {
    // Expand events over the same window the timeline shows, so recurring events
    // are captured exactly as a URL feed would be.
    const { start, end } = rangeForToday(new Date(), {
      pastMonths: config.pastMonths,
      futureMonths: config.futureMonths,
    });
    const parsed = parseIcs(text, 'scratchpad:imported', start, end);
    if (parsed.length === 0) {
      importError = 'No events found in the calendar file';
      return false;
    }
    createImportedLane(calNameFromIcs(text) ?? fallbackName, parsed);
    return true;
  }

  function exportLaneIcs(feed: CalendarFeed): void {
    const evs = events.byFeed[feed.id] ?? [];
    const ics = eventsToIcs(evs, feed.name);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportLaneFilename(feed.name);
    a.click();
    URL.revokeObjectURL(url);
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
      if (isIcsText(text)) {
        if (typeof window !== 'undefined' && !window.confirm(
          'Add the calendar from the clipboard as a new local lane?',
        )) return;
        if (importIcsAsLane(text, 'Imported ' + new Date().toISOString().slice(0, 10))) {
          void onRefresh();
          flashImport();
        }
        return;
      }
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

  // buildShareUrl is async (compression), so mirror it into state from an
  // effect. It reads config/zoom synchronously before its first await, which
  // is what registers them as dependencies; the sequence guard drops stale
  // resolutions if edits outpace encoding.
  let shareUrl = $state('');
  let shareUrlSeq = 0;
  $effect(() => {
    const seq = ++shareUrlSeq;
    void buildShareUrl(config, zoom.value).then((url) => {
      if (seq === shareUrlSeq) shareUrl = url;
    });
  });
  const shareDisabled = $derived(shareUrl.length > SHARE_URL_LIMIT);
  const shareLabel = $derived(
    shareDisabled
      ? `Too long to share (${shareUrl.length} chars)`
      : 'Copy share link',
  );

  async function shareLink(): Promise<void> {
    if (shareDisabled || !shareUrl) return;
    importError = null;
    // Prefer the native share sheet; tryNativeShare handles the browsers where a
    // prior share leaves the sheet stuck until reload (returns 'stuck' so we copy
    // and hint a refresh instead of silently doing nothing).
    const result = await tryNativeShare(shareUrl);
    // 'dismissed' means the user opened and closed the share sheet on purpose —
    // don't fall back to the clipboard (writeText throws "Document is not focused"
    // before focus returns after the sheet closes).
    if (result === 'shared' || result === 'dismissed') return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      flashShareCopied();
    } catch {
      pushLog('Copy failed', 'error');
    }
  }

  function triggerImport(): void {
    fileInput?.click();
  }

  const LONGPRESS_MS = 500;
  const SEED_PRESS_MS = 3000;
  let exportPressTimer: ReturnType<typeof setTimeout> | null = null;
  let exportLongFired = false;
  let importPressTimer: ReturnType<typeof setTimeout> | null = null;
  let importLongFired = false;
  let resetPressTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Developer/test shortcut: hold Reset for 3s to reset to defaults and seed
  // sample local-lane data (Draft + an imported test lane).
  function startResetPress(): void {
    if (resetPressTimer) clearTimeout(resetPressTimer);
    resetPressTimer = setTimeout(() => {
      resetPressTimer = null;
      longPress();
      resetAndSeed();
    }, SEED_PRESS_MS);
  }

  function cancelResetPress(): void {
    if (resetPressTimer) {
      clearTimeout(resetPressTimer);
      resetPressTimer = null;
    }
  }

  async function handleImport(e: Event): Promise<void> {
    importError = null;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (isIcsText(text)) {
        if (typeof window === 'undefined' || window.confirm(
          `Add the calendar '${file.name}' as a new local lane?`,
        )) {
          const fallback = file.name.replace(/\.(ics|ical|txt)$/i, '');
          if (importIcsAsLane(text, fallback)) {
            void onRefresh();
            flashImport();
          }
        }
        input.value = '';
        return;
      }
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

  function resetToDefaults(): void {
    const d = defaultConfig();
    applyImported(d);
    config.kioskPin = d.kioskPin;
    clearForm();
  }

  // Persist the reset synchronously (the autosave is debounced), drop any
  // view/marker URL state, and reload so the app comes up fresh on today.
  function persistAndReload(): void {
    saveConfig($state.snapshot(config) as typeof config);
    if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname);
    if (typeof location !== 'undefined') location.reload();
  }

  // Fired by ConfirmButton on the confirming (second) tap.
  function resetAndClear(): void {
    resetToDefaults();
    // A reset returns the Draft lane to empty too — it should carry no events by
    // default; only the long-press dev reset seeds sample data.
    clearDraftLane();
    persistAndReload();
  }

  // Developer/test: reset to defaults and seed sample local-lane data.
  function resetAndSeed(): void {
    if (typeof window !== 'undefined' && !window.confirm(
      'Developer: reset everything and seed test data (Draft + imported lane)? '
        + 'This replaces your current calendars, rules, and settings.',
    )) {
      return;
    }
    resetToDefaults();
    seedTestData();
    persistAndReload();
  }

  const schemeOptions: { id: Scheme; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const paletteOptions: { id: Palette; label: string }[] = [
    { id: 'pepper', label: 'Pepper' },
    { id: 'juniper', label: 'Juniper' },
    { id: 'bergamot', label: 'Bergamot' },
    { id: 'rose', label: 'Rose' },
    { id: 'cinnamon', label: 'Cinnamon' },
    { id: 'sage', label: 'Sage' },
  ];
  const spacingOptions: { id: Spacing; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'condensed', label: 'Condensed' },
    { id: 'relaxed', label: 'Relaxed' },
  ];
  const traySideOptions: { id: TraySide; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'bottom', label: 'Bottom' },
    { id: 'left', label: 'Left' },
  ];
  const motionOptions: { id: Motion; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'reduced', label: 'Disabled' },
    { id: 'full', label: 'Enabled' },
  ];
  const hapticsOptions: { id: Haptics; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'sound', label: 'Sound Only' },
    { id: 'vibration', label: 'Vibration Only' },
    { id: 'both', label: 'Sound & Vibration' },
    { id: 'off', label: 'Disabled' },
  ];
  const DEFAULT_FONT_SIZE: FontSize = 14;
  const fontSizeOptions: { id: FontSize; label: string }[] = [
    { id: 10, label: '10px' },
    { id: 12, label: '12px' },
    { id: 14, label: '14px' },
    { id: 16, label: '16px' },
    { id: 18, label: '18px' },
    { id: 20, label: '20px' },
  ];
  function stepFont(dir: 1 | -1): void {
    const i = fontSizeOptions.findIndex((f) => f.id === config.fontSize);
    const next = fontSizeOptions[Math.min(fontSizeOptions.length - 1, Math.max(0, i + dir))];
    if (next) config.fontSize = next.id;
  }
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
  const timeFormatOptions: { id: TimeFormat; label: string }[] = [
    { id: '24h', label: '24-hour' },
    { id: '12h', label: '12-hour (AM/PM)' },
  ];
  // Label for a feed's style-preview swatch, from the same options the edit
  // form's Style select shows.
  function feedStyleLabel(s: StyleVariant | undefined): string {
    const id = !s || s === 'none' ? '' : s;
    return calendarStyleOptions.find((o) => o.id === id)?.label ?? 'Default';
  }
  const calendarStyleOptions: { id: StyleVariant | ''; label: string }[] = [
    { id: '', label: 'Default' },
    { id: 'outline', label: 'Outline' },
    { id: 'bold', label: 'Bold' },
    { id: 'inverted', label: 'Solid' },
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
  const blockOptions: { id: Block; label: string }[] = [
    { id: 'none', label: 'N/A' },
    { id: 'global', label: 'Global' },
    { id: 'local', label: 'Local' },
    { id: 'off', label: 'No block' },
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

  // Whether the primary zone is currently on its daylight (Summer) or standard
  // offset — drives the "Auto (Summer)" hint on the Daylight-saving selector.
  // null for zones that don't observe DST, so Auto stays unqualified there.
  const autoDstLabel = $derived.by(() => {
    const tz = config.timezone === 'local' ? resolveLocalTz() : config.timezone;
    const now = new Date();
    const auto = offsetMinutes(tz, now, 'auto');
    const summer = offsetMinutes(tz, now, 'on');
    const standard = offsetMinutes(tz, now, 'off');
    if (auto == null || summer == null || standard == null || summer === standard) return 'Auto';
    return auto === summer ? 'Auto (Summer)' : 'Auto (Standard)';
  });

  // What "Auto" currently resolves to on this device for the Look & Feel
  // selectors, mirroring the resolution App.svelte applies to the DOM. Like
  // autoDstLabel these read matchMedia without a reactive dependency, so they
  // reflect the state when the panel mounts.
  const hasMatchMedia = typeof matchMedia !== 'undefined';
  const autoSchemeLabel = $derived(
    hasMatchMedia && matchMedia('(prefers-color-scheme: dark)').matches
      ? 'Auto (Dark)'
      : 'Auto (Light)',
  );
  const autoSpacingLabel = $derived(
    hasMatchMedia &&
      (matchMedia('(orientation: portrait) and (max-width: 640px)').matches ||
        matchMedia('(orientation: landscape) and (max-width: 900px)').matches)
      ? 'Auto (Condensed)'
      : 'Auto (Relaxed)',
  );
  // Tray resolves to the left panel on desktop (neither phone query matches) and
  // the bottom bar on mobile — same breakpoints as spacing.
  const autoTrayLabel = $derived(
    hasMatchMedia &&
      !(matchMedia('(orientation: portrait) and (max-width: 640px)').matches ||
        matchMedia('(orientation: landscape) and (max-width: 900px)').matches)
      ? 'Auto (Left)'
      : 'Auto (Bottom)',
  );
  const autoMotionLabel = $derived(
    hasMatchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'Auto (Disabled)'
      : 'Auto (Enabled)',
  );
  const autoHapticsLabel = $derived(canVibrate() ? 'Auto (Vibration)' : 'Auto (Sound)');

  function feedTzLabel(feed: CalendarFeed): string {
    const tz = effectiveFeedTz(feed.id);
    if (!tz) return '';
    const offset = formatUtcOffset(tz, new Date(), config.dst);
    return offset || '';
  }

  const categoryIconName = categoryIcon;

  function categoryLabelText(c: FeedCategory): string {
    if (c === 'events') return 'Events';
    if (c === 'holidays') return 'Holidays';
    if (c === 'observances') return 'Observances';
    if (c === 'guests') return 'Guests';
    if (c === 'announcements') return 'Announcements';
    return '';
  }

  const travelIconName = travelIcon;

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
    <details class="group" bind:open={sections.look}>
      <summary><h3><Icon name="chevron-down" size={16} />Look &amp; Feel</h3></summary>
      <div class="group-body">
      <div class="field">
        <label for="palette-select">Flavor</label>
        <select id="palette-select" bind:value={config.palette}>
          {#each paletteOptions as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="scheme-select">Scheme</label>
        <select id="scheme-select" bind:value={config.scheme}>
          {#each schemeOptions as s (s.id)}
            <option value={s.id}>{s.id === 'auto' ? autoSchemeLabel : s.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="spacing-select">Spacing</label>
        <select id="spacing-select" bind:value={config.spacing}>
          {#each spacingOptions as s (s.id)}
            <option value={s.id}>{s.id === 'auto' ? autoSpacingLabel : s.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="tray-side-select">Tray</label>
        <select id="tray-side-select" bind:value={config.traySide}>
          {#each traySideOptions as t (t.id)}
            <option value={t.id}>{t.id === 'auto' ? autoTrayLabel : t.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <span class="field-label">Font Size</span>
        <div class="segmented font-stepper" role="group" aria-label="Font size">
          <button
            type="button"
            class="segmented-btn"
            onclick={() => stepFont(-1)}
            disabled={config.fontSize <= fontSizeOptions[0].id}
            aria-label="Decrease font size"
          >−</button>
          <button
            type="button"
            class="segmented-value"
            data-default={config.fontSize === DEFAULT_FONT_SIZE ? 'true' : null}
            onclick={() => (config.fontSize = DEFAULT_FONT_SIZE)}
            title="Reset to default"
            aria-label="Reset font size to default"
            aria-live="polite"
          >{config.fontSize}px</button>
          <button
            type="button"
            class="segmented-btn"
            onclick={() => stepFont(1)}
            disabled={config.fontSize >= fontSizeOptions[fontSizeOptions.length - 1].id}
            aria-label="Increase font size"
          >+</button>
        </div>
      </div>
      <div class="field">
        <span class="field-label">Border</span>
        <div class="segmented" role="radiogroup" aria-label="Border">
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={config.borderWeight === 'thin'}
            onclick={() => (config.borderWeight = 'thin')}
          >Thin</button>
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={config.borderWeight === 'bold'}
            onclick={() => (config.borderWeight = 'bold')}
          >Bold</button>
        </div>
      </div>
      <div class="field">
        <label for="motion-select">Motion</label>
        <select id="motion-select" bind:value={config.motion}>
          {#each motionOptions as m (m.id)}
            <option value={m.id}>{m.id === 'auto' ? autoMotionLabel : m.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="haptics-select">Haptics</label>
        <select id="haptics-select" bind:value={config.haptics}>
          {#each hapticsOptions as b (b.id)}
            <option value={b.id}>{b.id === 'auto' ? autoHapticsLabel : b.label}</option>
          {/each}
        </select>
      </div>
      </div>
    </details>

    <details class="group" bind:open={sections.time}>
      <summary><h3><Icon name="chevron-down" size={16} />Time &amp; Date</h3></summary>
      <div class="group-body">
      <div class="field">
        <label for="locale-select">Language</label>
        <select id="locale-select" bind:value={config.locale}>
          {#each localeOptions as l (l.id)}
            <option value={l.id}>{l.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="format-select">Date Format</label>
        <select id="format-select" bind:value={config.dateFormat}>
          {#each formatOptions as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="time-fmt-select">Time Format</label>
        <select id="time-fmt-select" bind:value={config.timeFormat}>
          {#each timeFormatOptions as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="tz-select">1st Time Zone</label>
        <select id="tz-select" bind:value={config.timezone}>
          <option value="local">{formatAutoLabel(resolveLocalTz(), config.dst)}</option>
          {#each TZ_PINNED as tz (tz)}
            <option value={tz}>{formatTimezoneLabel(tz, config.dst)}</option>
          {/each}
          <hr />
          {#each TZ_REST as tz (tz)}
            <option value={tz}>{formatTimezoneLabel(tz, config.dst)}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="tz2-select">2nd Time Zone</label>
        <select id="tz2-select" bind:value={config.timezone2}>
          {#each TZ_PINNED as tz (tz)}
            <option value={tz}>{formatTimezoneLabel(tz, config.dst)}</option>
          {/each}
          <hr />
          {#each TZ_REST as tz (tz)}
            <option value={tz}>{formatTimezoneLabel(tz, config.dst)}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="dst-select">DST</label>
        <select id="dst-select" bind:value={config.dst}>
          <option value="auto">{autoDstLabel}</option>
          <option value="on">On (Summer)</option>
          <option value="off">Off (Standard)</option>
        </select>
      </div>
      <div class="field">
        <label for="past-months">Past Months</label>
        <input
          id="past-months"
          type="number"
          min="0"
          max="120"
          bind:value={config.pastMonths}
        />
      </div>
      <div class="field">
        <label for="future-months">Future Months</label>
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
      </div>
    </details>

    <details class="group" bind:open={sections.filters}>
      <summary class="section-head">
        <h3><Icon name="chevron-down" size={16} />Event Filters</h3>
        <button
          type="button"
          class="add-btn"
          onclick={(e) => { e.stopPropagation(); sections.filters = true; addRule(); }}
        >
          <Icon name="plus" size={14} />
          <span>Add</span>
        </button>
      </summary>
      <RulesEditor
        editingRuleId={editingRuleId}
        onEditingChange={(id) => (editingRuleId = id)}
        draftRule={draftRule}
        onCommitDraft={commitDraftRule}
        onDiscardDraft={discardDraftRule}
      />
    </details>

    <details class="group" bind:open={sections.calendars}>
      <summary class="section-head">
        <h3><Icon name="chevron-down" size={16} />Calendars</h3>
        <button
          type="button"
          class="add-btn"
          aria-pressed={addingNew}
          disabled={!online.value && !addingNew}
          title={!online.value ? 'Offline — cannot validate new calendar' : undefined}
          onclick={(e) => {
            e.stopPropagation();
            if (addingNew) clearForm();
            else {
              sections.calendars = true;
              startAdd();
            }
          }}
        >
          <Icon name="plus" size={14} />
          <span>Add</span>
        </button>
      </summary>
      <ul class="feeds" bind:this={listContainer}>
        {#if addingNew}
          <li data-feed-card={ADD_NEW_ID} data-active="true">
            <div class="feed-row">
              {#if travelIconName(formTravel)}
                <span class="kind-mark" title={travelLabelText(formTravel)}>
                  <Icon name={travelIconName(formTravel)!} size={14} />
                </span>
              {/if}
              {#if categoryIconName(formCategory)}
                <span class="kind-mark" title={categoryLabelText(formCategory)}>
                  <Icon name={categoryIconName(formCategory)!} size={14} />
                </span>
              {/if}
              <span class="feed-name-text new-label">NEW CALENDAR</span>
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
                <label for="new-form-block">Block</label>
                <select id="new-form-block" bind:value={formBlock}>
                  {#each blockOptions as b (b.id)}
                    <option value={b.id}>{b.label}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="new-form-tz">Time zone</label>
                <select id="new-form-tz" bind:value={formTimezone}>
                  <option value="">Auto</option>
                  {#each TZ_PINNED as tz (tz)}
                    <option value={tz}>{formatTzOption(tz, config.dst)}</option>
                  {/each}
                  <hr />
                  {#each TZ_REST as tz (tz)}
                    <option value={tz}>{formatTzOption(tz, config.dst)}</option>
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
          <!-- While this feed's edit form is open, the header charms preview
               the form's (unsaved) Type / Travel so icon changes show live.
               Style / Color apply to the feed immediately (setFeedStyle /
               setFeedColor), so the swatch is always live. -->
          {@const previewTravel = editingFeedId === feed.id ? formTravel : feed.travel}
          {@const previewCategory = editingFeedId === feed.id ? formCategory : feed.category}
          <li
            data-feed-card={feed.id}
            data-active={editingFeedId === feed.id ? 'true' : null}
          >
            <div class="feed-row" data-local={isScratchpad(feed) ? 'true' : null}>
              <span
                class="style-swatch"
                data-style={feed.style ?? 'none'}
                data-cal-color={feed.color ?? null}
                title={feedStyleLabel(feed.style)}
              >K</span>
              {#if isScratchpad(feed)}
                <IconButton
                  icon="arrow-bar-down"
                  label="Download this lane as an .ics file"
                  variant="default"
                  size={16}
                  onclick={() => exportLaneIcs(feed)}
                />
              {/if}
              {#if travelIconName(previewTravel)}
                <span class="kind-mark" title={travelLabelText(previewTravel)}>
                  <Icon name={travelIconName(previewTravel)!} size={14} />
                </span>
              {/if}
              {#if categoryIconName(previewCategory)}
                <span class="kind-mark" title={categoryLabelText(previewCategory)}>
                  <Icon name={categoryIconName(previewCategory)!} size={14} />
                </span>
              {/if}
              <button
                type="button"
                class="feed-name-btn"
                data-disabled={feed.hidden ? 'true' : null}
                onclick={() => (editingFeedId === feed.id ? clearForm() : startEdit(feed))}
                ondblclick={() => toggleHidden(feed)}
                aria-label={'Edit ' + feed.name + ' (double-tap to enable/disable)'}
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
              <span class="feed-link-mark">
                {#if isScratchpad(feed)}<LocalBadge />{:else}<LocalBadge linked />{/if}
              </span>
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
                  <label for="form-block-{feed.id}">Block</label>
                  <select id="form-block-{feed.id}" bind:value={formBlock}>
                    {#each blockOptions as b (b.id)}
                      <option value={b.id}>{b.label}</option>
                    {/each}
                  </select>
                </div>
                <div class="field">
                  <label for="form-tz-{feed.id}">Time zone</label>
                  <select id="form-tz-{feed.id}" bind:value={formTimezone}>
                    <option value=""
                      >{formatAutoLabel(events.tzByFeed[feed.id] ?? null, config.dst)}</option>
                    {#each TZ_PINNED as tz (tz)}
                      <option value={tz}>{formatTzOption(tz, config.dst)}</option>
                    {/each}
                    <hr />
                    {#each TZ_REST as tz (tz)}
                      <option value={tz}>{formatTzOption(tz, config.dst)}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-actions feed-form-actions">
                  <div class="action-group">
                    <ConfirmButton
                      bind:state={deleteFeedState}
                      label="Delete"
                      variant="delete"
                      height={26}
                      hpad="0.6em"
                      grow
                      disabled={!isDeletableFeed(feed)}
                      disabledTitle="This calendar can’t be deleted"
                      doneTitle="Tap to undo deletion"
                      onCommit={() => commitRemoveFeed(feed.id)}
                    />
                    <button
                      type="button"
                      class="disable-btn"
                      data-state={formHidden ? 'enable' : 'disable'}
                      onclick={() => {
                        if (editingFeed) { toggleHidden(editingFeed); formHidden = !!editingFeed.hidden; }
                        else formHidden = !formHidden;
                      }}
                    ><span class="act-stack"><span class="act-sizer" aria-hidden="true">Disable</span><span>{formHidden ? 'Enable' : 'Disable'}</span></span></button>
                  </div>
                  <div class="action-group">
                    <button
                      type="button"
                      onclick={clearForm}
                      disabled={deleteFeedState === 'done' || deleteFeedState === 'undo'}
                    >Cancel</button>
                    <button
                      type="submit"
                      class="primary"
                      disabled={deleteFeedState === 'done' || deleteFeedState === 'undo'}
                    >Save</button>
                  </div>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    </details>

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
        ><span class="flash-swap"><span class:flash-swap-off={shareFlashed}>Share</span><span class:flash-swap-off={!shareFlashed}>Copy&nbsp;✓</span></span></button>
        <ConfirmButton
          label="Reset"
          variant="delete"
          stages={2}
          height={32}
          hpad="12px"
          block
          fontSize="var(--fs-13)"
          idleTitle="Reset to default (long-press to seed test data)"
          confirmTitle="Tap again to reset to default"
          onConfirm={resetAndClear}
          onpointerdown={startResetPress}
          onpointerup={cancelResetPress}
          onpointercancel={cancelResetPress}
          onpointerleave={cancelResetPress}
        />
        <input
          bind:this={fileInput}
          type="file"
          accept="application/json,text/calendar,.ics,.ical"
          onchange={handleImport}
          hidden
        />
      </div>
      {#if importError}<p class="error">Import failed: {importError}</p>{/if}
    </section>

    <footer class="settings-footer">
      <div>
        v{__APP_VERSION__} ·
        <a href={__APP_HOMEPAGE__} target="_blank" rel="noopener noreferrer">heracl.es/kalendes</a>
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
    border-left: var(--border-w) solid var(--ink);
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
    overscroll-behavior: contain;
    padding: 1em 1em 2em;
    display: flex;
    flex-direction: column;
    gap: 1.25em;
    box-sizing: border-box;
  }
  .settings-footer {
    margin-top: auto;
    padding: 4px;
    font-size: var(--fs-11);
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
    flex-wrap: wrap;
    gap: 0.4em;
    margin-top: 0.4em;
  }
  .form-actions .action-group {
    display: flex;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    gap: 0.4em;
  }
  .form-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 0;
    min-width: 0;
    height: 26px;
    padding: 0 0.6em;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: var(--fs-12);
    text-transform: uppercase;
    cursor: pointer;
  }
  /* Save shares its action group equally with Cancel, so the two match width. */
  .form-actions button.primary {
    flex: 1 1 0;
  }
  /* Reserve the wider word so Enable/Disable never changes size; current label
     is centered over the hidden sizer. */
  .form-actions .act-stack {
    display: inline-grid;
  }
  .form-actions .act-stack > * {
    grid-area: 1 / 1;
    text-align: center;
  }
  .form-actions .act-sizer {
    visibility: hidden;
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
    border-bottom: var(--border-w) solid var(--ink);
    height: var(--toolbar-h);
    padding: 0 1em;
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
    color: var(--ink);
    font-weight: 600;
    user-select: none;
  }
  section {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  details.group {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  /* Fields live in their own flex container so the gap falls between them.
     A <details>'s open content is wrapped by Chrome in an anonymous box, so a
     gap on details.group itself would only space the summary from that box, not
     the fields within it (Firefox has no such box — hence the inconsistency). */
  .group-body {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  details.group > summary {
    cursor: pointer;
    list-style: none;
    align-items: center;
    gap: 0.4em;
  }
  details.group > summary::-webkit-details-marker {
    display: none;
  }
  details.group > summary h3 {
    margin: 0;
    display: flex;
    align-items: center;
  }
  /* Disclosure marker: the thin chevron icon, pointing right when closed and
     rotating about its own center to point down when open. An icon instead of
     a unicode glyph, so it centers exactly against the header text via the
     flex row. The app-wide reduced-motion rule neutralizes the transition. */
  details.group > summary h3 :global(.icon) {
    margin-right: 0.3em;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: transform 0.15s ease;
  }
  details.group[open] > summary h3 :global(.icon) {
    transform: rotate(0deg);
  }
  .field {
    display: grid;
    /* Label column in em so it grows with the font setting (a fixed px column
       clips longer labels at 18/20px). Kept narrow so the controls get the
       width — labels are short. */
    grid-template-columns: 7em 1fr;
    align-items: center;
    gap: 0.6em;
  }
  /* In a calendar's edit form, line the label/control split up with the
     4-button action row below (Delete · Disable · Cancel · Save, each flex
     1fr with three 0.4em gaps): the label spans one button (Delete) and the
     control spans the other three plus their gaps. */
  .feed-edit .field {
    grid-template-columns: calc((100% - 1.2em) / 4) 1fr;
    column-gap: 0.4em;
  }
  .feed-edit .field label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field label,
  .field .field-label {
    font-size: var(--fs-13);
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
    /* Height in em so the box grows with the font setting — a fixed 32px clips
       the (root-sized) input text at 18/20px. The global 0.3em/0.5em padding
       already scales, so the text keeps its breathing room at every size. */
    min-height: 2.25em;
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
    /* Breathing room when a card is scrolled into view (start-aligned), so its
       top border doesn't sit flush against the header — matches the panel
       body's own 1em padding. */
    scroll-margin-top: 1em;
  }
  .feeds li + li {
    border-top: var(--border-w) solid var(--ink);
  }
  .feeds li[data-active='true'] + li,
  .feeds li[data-active='true'] {
    border-top-color: transparent;
  }
  .feeds li[data-active='true'] {
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
  /* Local calendars lead with the download button — drop the left inset so it
     sits flush to the panel edge. While editing, restore it so the open card's
     contents align with the rest of the form. */
  .feed-row[data-local='true'] {
    padding-left: 0;
  }
  .feeds li[data-active='true'] .feed-row[data-local='true'] {
    padding-left: 8px;
  }
  .feed-name-btn {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: baseline;
    gap: 0.4em;
    overflow: hidden;
    font-size: var(--fs-13);
    text-align: left;
    background: transparent;
    border: var(--border-w) solid transparent;
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
    font-size: var(--fs-11);
    color: var(--ink-muted);
    flex-shrink: 0;
  }
  .feed-edit {
    padding: 8px 8px 10px 8px;
    border-top: var(--border-w) dashed var(--ink);
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .new-label {
    font-size: var(--fs-13);
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
    font-size: var(--fs-12);
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
  /* Link/unlink indicator gets its own slot just before the up/down controls so
     it lines up in a column across rows (rather than being clipped inside the
     overflow-hidden name button). */
  .feed-link-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .warn-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: var(--border-w) solid var(--accent);
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
    font-size: var(--fs-12);
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
  .segmented-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .segmented-value {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 0.9em;
    border: var(--btn-border-w) solid var(--ink);
    border-left-width: 0;
    border-right-width: 0;
    border-radius: 0;
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
  }
  /* Font stepper: keep the value cell fully bordered so it stays crisp even
     when the adjacent −/+ are disabled (faded); drop their touching borders. */
  .font-stepper .segmented-value {
    border-left-width: var(--btn-border-w);
    border-right-width: var(--btn-border-w);
  }
  .font-stepper .segmented-btn:first-of-type {
    border-right-width: 0;
  }
  .font-stepper .segmented-btn:last-of-type {
    border-left-width: 0;
  }
  .font-stepper .segmented-value[data-default='true'] {
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
    font-size: var(--fs-13);
  }
  .error {
    margin: 0;
    color: var(--accent);
    font-size: var(--fs-12);
  }
  @media (max-width: 640px) {
    .panel {
      width: 100vw;
    }
  }
</style>
