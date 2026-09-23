<script lang="ts">
  // Settings → Configuration: import (file / long-press paste), export (file /
  // long-press copy), reset (two-tap; 3s hold opens the demo import) and the
  // share link.
  import ConfirmButton from '../ConfirmButton.svelte';
  import {
    config,
    zoom,
    pushLog,
    createImportedLane,
    openDevImport,
    clearDraftLane,
    localLanesForShare,
  } from '../../lib/state.svelte';
  import { exportConfig, importConfig, defaultConfig, saveConfig } from '../../lib/storage';
  import { parseIcs } from '../../lib/ics-core';
  import { rangeForToday } from '../../lib/layout';
  import { isIcsText, calNameFromIcs } from '../../lib/scratchpad';
  import { buildShareUrl, SHARE_URL_LIMIT, tryNativeShare } from '../../lib/share';
  import { longPress } from '../../lib/haptics';

  // onReset clears the panel's own edit forms when everything is reset.
  type Props = { onRefresh: () => Promise<void>; onReset: () => void };
  const { onRefresh, onReset }: Props = $props();

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
    config.timezone1 = next.timezone1;
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

  function downloadExport(): void {
    const json = exportConfig(config);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.download = `kalendes-config-${stamp}.json`;
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
    // Read local lanes synchronously so editing Draft events refreshes the link.
    const lanes = localLanesForShare();
    void buildShareUrl(config, zoom.value, undefined, lanes).then((url) => {
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

  // Developer/test shortcut: hold Reset for 3s to open the share-import dialog
  // preloaded with demo data (Draft + imported test lane + demo filters), so the
  // Replace / Merge flow can be exercised without a real share link.
  function startResetPress(): void {
    if (resetPressTimer) clearTimeout(resetPressTimer);
    resetPressTimer = setTimeout(() => {
      resetPressTimer = null;
      longPress();
      openDevImport();
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
    onReset();
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
    // default; only the long-press dev import seeds sample data.
    clearDraftLane();
    persistAndReload();
  }
</script>

<div class="config-actions">
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
    title="Export to file (long-press to copy to clipboard)"
    aria-label="Export to file (long-press to copy to clipboard)"
    onclick={handleExportClick}
    onpointerdown={startExportPress}
    onpointerup={cancelExportPress}
    onpointercancel={cancelExportPress}
    onpointerleave={cancelExportPress}
  >{exportFlashed ? 'COPIED' : 'Export'}</button>
  <ConfirmButton
    label="Reset"
    variant="delete"
    stages={2}
    height={32}
    hpad="12px"
    block
    fontSize="var(--fs-13)"
    idleTitle="Reset to default (long-press for demo import)"
    confirmTitle="Tap again to reset to default"
    onConfirm={resetAndClear}
    onpointerdown={startResetPress}
    onpointerup={cancelResetPress}
    onpointercancel={cancelResetPress}
    onpointerleave={cancelResetPress}
  />
  <button
    type="button"
    onclick={() => void shareLink()}
    disabled={shareDisabled}
    title={shareLabel}
  ><span class="flash-swap"><span class:flash-swap-off={shareFlashed}>Share</span><span class:flash-swap-off={!shareFlashed}>Copy&nbsp;✓</span></span></button>
  <input
    bind:this={fileInput}
    type="file"
    accept="application/json,text/calendar,.ics,.ical"
    onchange={handleImport}
    hidden
  />
</div>
{#if importError}<p class="error">Import failed: {importError}</p>{/if}

<style>
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
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-13);
  }
  .error {
    margin: 0;
    color: var(--accent-color);
    font-size: var(--fs-12);
  }
</style>
