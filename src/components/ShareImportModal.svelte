<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import LocalBadge from './LocalBadge.svelte';
  import {
    ui, config, zoom, events,
    createImportedLane, addEventsToLane, setFeedHidden,
  } from '../lib/state.svelte';
  import { stripShareParam } from '../lib/share';
  import { isDefaultOnlyFeeds, scratchpadFeed } from '../lib/storage';
  import { swatchHatch } from '../lib/blocking';
  import { filterRulePreview } from '../lib/event-display';
  import { categoryIcon } from '../lib/icons';
  import { SCRATCHPAD_FEED_ID } from '../lib/types';
  import type { Block, CalendarColor, FeedCategory, FindReplaceRule, StyleVariant } from '../lib/types';

  type Props = { onRefresh: () => Promise<void> };
  const { onRefresh }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let cancelBtn: HTMLButtonElement | undefined = $state();

  const importing = $derived(ui.shareImport);
  // Both the shared user (URL) feeds and local (Draft/imported) lanes are
  // calendars; carry the bits the preview shows (icon, style/colour, linked vs
  // local). Local lanes don't carry a style/colour in the share payload.
  type CalRow = {
    name: string;
    category: FeedCategory;
    color?: CalendarColor;
    style?: StyleVariant;
    block?: Block;
    local: boolean;
    // True when this row folds into something the recipient already has (a feed
    // whose URL exists, or the shared Draft) rather than adding a fresh lane.
    merged: boolean;
  };
  const calendars = $derived.by<CalRow[]>(() => {
    if (!importing) return [];
    const out: CalRow[] = [];
    for (const f of importing.feeds) {
      const merged = f.source.kind === 'user' && existingUrl(f.source.url);
      out.push({ name: f.name, category: f.category, color: f.color, style: f.style, block: f.block, local: false, merged });
    }
    for (const l of importing.localFeeds) {
      out.push({ name: l.name, category: l.category ?? 'none', local: true, merged: l.isDraft === true });
    }
    return out;
  });
  const feedCount = $derived(calendars.length);
  const ruleCount = $derived(importing?.rules.length ?? 0);
  // A kiosk PIN is a security-relevant setting; surface it explicitly and never
  // let it slip in through the silent auto-import path (see canAutoImport).
  const hasKioskPin = $derived(!!importing?.kioskPin);
  // Rule ids the recipient already has — such rules merge in (skipped as dupes).
  const existingRuleIds = $derived(new Set(config.rules.map((r) => r.id)));

  function filterLabel(rule: FindReplaceRule): string {
    return filterRulePreview(rule);
  }

  // A fresh recipient (only the default feeds, empty Draft) imports directly with
  // no merge prompt — the shared setup simply takes over. A link that also sets a
  // kiosk PIN is never auto-imported: that setting must be shown and explicitly
  // accepted, so the modal is forced open instead.
  function canAutoImport(): boolean {
    return (
      !hasKioskPin &&
      isDefaultOnlyFeeds(config.feeds) &&
      (events.byFeed[SCRATCHPAD_FEED_ID]?.length ?? 0) === 0
    );
  }

  $effect(() => {
    if (!dialog) return;
    if (importing) {
      if (canAutoImport()) {
        applyReplace();
        return;
      }
      if (!dialog.open) {
        dialog.showModal();
        // Focus Cancel (not the destructive Replace) so a stray Enter is safe.
        queueMicrotask(() => cancelBtn?.focus());
      }
    } else if (dialog.open) {
      dialog.close();
    }
  });

  function close(): void {
    ui.shareImport = null;
    stripShareParam();
  }

  function existingUrl(url: string): boolean {
    return config.feeds.some((f) => f.source.kind === 'user' && f.source.url === url);
  }

  function nextOrder(): number {
    return config.feeds.reduce((m, f) => Math.max(m, f.order), -1) + 1;
  }

  function applyView(): void {
    const v = importing?.view;
    if (!v) return;
    if (v.zoom) zoom.value = v.zoom;
    if (v.locale) config.locale = v.locale;
    if (v.dateFormat) config.dateFormat = v.dateFormat;
    if (v.scheme) config.scheme = v.scheme;
    if (v.palette) config.palette = v.palette;
  }

  // Apply the shared local lanes. The sender's built-in Draft (isDraft) merges
  // into the recipient's own Draft — its events appended, its enabled state
  // restored — so there's never a duplicate "Draft"; every other local lane
  // becomes a fresh scratchpad lane (uuid id).
  function applyLocalFeeds(): void {
    if (!importing) return;
    for (const lf of importing.localFeeds) {
      if (lf.isDraft) {
        addEventsToLane(SCRATCHPAD_FEED_ID, lf.events);
        setFeedHidden(SCRATCHPAD_FEED_ID, !!lf.hidden);
        continue;
      }
      createImportedLane(lf.name, lf.events, {
        category: lf.category,
        timezone: lf.timezone,
        hidden: lf.hidden,
      });
    }
  }

  function applyMerge(): void {
    if (!importing) return;
    let order = nextOrder();
    for (const feed of importing.feeds) {
      if (feed.source.kind !== 'user') continue;
      if (existingUrl(feed.source.url)) continue;
      config.feeds.push({ ...feed, order: order++ });
    }
    const existingRuleIds = new Set(config.rules.map((r) => r.id));
    for (const rule of importing.rules) {
      if (existingRuleIds.has(rule.id)) continue;
      config.rules.push(rule);
    }
    applyLocalFeeds();
    applyView();
    if (importing.kioskPin) config.kioskPin = importing.kioskPin;
    close();
    void onRefresh();
  }

  function applyReplace(): void {
    if (!importing) return;
    // Preserve the recipient's own Draft lane across the wholesale replace — the
    // decoded feeds are all URL feeds, so without this the Draft would vanish
    // until a reload re-injected a fresh (forced-hidden) one.
    const draft =
      config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID) ?? scratchpadFeed(0);
    const replaced = importing.feeds.map((f, i) => ({ ...f, order: i }));
    config.feeds = [...replaced, { ...draft, order: replaced.length }];
    config.rules = [...importing.rules];
    applyLocalFeeds();
    applyView();
    if (importing.kioskPin) config.kioskPin = importing.kioskPin;
    close();
    void onRefresh();
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  {#if importing}
    <article>
      <header>
        <h2>Import</h2>
        <IconButton icon="close" label="Cancel" variant="ghost" onclick={close} />
      </header>
      {#if hasKioskPin}
        <p class="notice"><Icon name="lock" size={14} />This link sets a kiosk PIN.</p>
      {/if}
      {#if feedCount > 0 || ruleCount > 0}
        <div class="groups">
          {#if ruleCount > 0}
            <details class="group" open>
              <summary><h3><Icon name="chevron-down" size={16} />Filters ({ruleCount})</h3></summary>
              <ul class="group-list">
                {#each importing.rules as rule (rule.id)}
                  <li class="row">
                    <span
                      class="style-swatch"
                      data-style={rule.style ?? 'none'}
                      data-cal-color={rule.color ?? null}
                      data-block={swatchHatch(rule.block ?? 'none', rule.style ?? 'none')}
                      title={rule.style ?? 'default'}
                    >K</span>
                    <span class="row-name">{filterLabel(rule)}</span>
                    {#if existingRuleIds.has(rule.id)}<span class="merge-star" title="Merges into an item you already have">*</span>{/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
          {#if feedCount > 0}
            <details class="group" open>
              <summary><h3><Icon name="chevron-down" size={16} />Calendars ({feedCount})</h3></summary>
              <ul class="group-list">
                {#each calendars as c (c.name)}
                  {@const icon = categoryIcon(c.category)}
                  <li class="row">
                    <span
                      class="style-swatch"
                      data-style={c.style ?? 'none'}
                      data-cal-color={c.color ?? null}
                      data-block={swatchHatch(c.block ?? 'none', c.style ?? 'none')}
                      title={c.style ?? 'default'}
                    >K</span>
                    {#if icon}<span class="mark"><Icon name={icon} size={14} /></span>{/if}
                    <span class="row-name">{c.name}</span>
                    {#if c.merged}<span class="merge-star" title="Merges into an item you already have">*</span>{/if}
                    <span class="status">
                      {#if c.local}<LocalBadge size={12} />{:else}<LocalBadge linked size={12} />{/if}
                    </span>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
        </div>
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={applyReplace}>Replace</button>
        <button type="button" onclick={applyMerge}>Merge<span class="merge-star">*</span></button>
        <button type="button" bind:this={cancelBtn} onclick={close}>Cancel</button>
      </div>
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    padding: 0;
    width: min(440px, calc(100vw - 1rem));
    box-sizing: border-box;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  article {
    padding: 1em;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    /* Bleed to the dialog edges so the rule spans full width, like the settings
       panel header. */
    margin: -1em -1em 0.75em;
    padding: 0.5em 1em;
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  h2 {
    margin: 0;
    font-size: 1.05em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin: 0 0 0.75em 0;
    padding: 0.4em 0.5em;
    border: var(--border-w) solid var(--accent-color);
    color: var(--ink-color);
    font-size: var(--fs-13);
  }
  .notice :global(.icon) {
    color: var(--accent-color);
    flex-shrink: 0;
  }
  .groups {
    margin: 0 0 1em 0;
    max-height: 40vh;
    overflow-y: auto;
  }
  .groups details.group + details.group {
    margin-top: 0.5em;
  }
  .groups summary {
    cursor: pointer;
    list-style: none;
  }
  .groups summary::-webkit-details-marker {
    display: none;
  }
  /* Collapsible section heading per kind, mirroring the settings-panel sections. */
  .groups summary h3 {
    display: flex;
    align-items: center;
    margin: 0.25em 0;
    font-size: var(--fs-11);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-muted);
  }
  .groups summary h3 :global(.icon) {
    margin-right: 0.3em;
    transform: rotate(-90deg);
    transition: transform 120ms ease;
  }
  .groups details[open] > summary h3 :global(.icon) {
    transform: rotate(0deg);
  }
  .group-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.2em 0;
    font-size: var(--fs-13);
  }
  .row-name {
    /* Shrink to the name's width (ellipsizing when long) so the merge asterisk
       sits right after the name rather than at the far edge. */
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    color: var(--ink-color);
    flex-shrink: 0;
  }
  /* Right-aligned trailing column: merge asterisk + sync/local badge, so both
     line up in a column across rows. */
  .status {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    flex-shrink: 0;
  }
  .merge-star {
    color: var(--accent-color);
    font-weight: 700;
    line-height: 1;
  }
  /* The Merge button's asterisk gets a gap; the inline row asterisks stay glued
     to the name. */
  .actions .merge-star {
    margin-left: 0.2em;
  }
  .actions {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.5em;
    justify-content: flex-end;
  }
  .actions button {
    height: 32px;
    padding: 0 12px;
    border: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-13);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .actions .primary {
    background: var(--ink-color);
    color: var(--paper-color);
  }
</style>
