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
  import { categoryIcon } from '../lib/icons';
  import { SCRATCHPAD_FEED_ID } from '../lib/types';
  import type { CalendarColor, FeedCategory, FindReplaceRule, StyleVariant } from '../lib/types';

  type Props = { onRefresh: () => Promise<void> };
  const { onRefresh }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  const importing = $derived(ui.shareImport);
  // Both the shared user (URL) feeds and local (Draft/imported) lanes are
  // calendars; carry the bits the preview shows (icon, style/colour, linked vs
  // local). Local lanes don't carry a style/colour in the share payload.
  type CalRow = {
    name: string;
    category: FeedCategory;
    color?: CalendarColor;
    style?: StyleVariant;
    local: boolean;
  };
  const calendars = $derived.by<CalRow[]>(() => {
    if (!importing) return [];
    const out: CalRow[] = [];
    for (const f of importing.feeds) {
      out.push({ name: f.name, category: f.category, color: f.color, style: f.style, local: false });
    }
    for (const l of importing.localFeeds) {
      out.push({ name: l.name, category: l.category ?? 'none', local: true });
    }
    return out;
  });
  const feedCount = $derived(calendars.length);
  const ruleCount = $derived(importing?.rules.length ?? 0);

  function filterLabel(rule: FindReplaceRule): string {
    const find = rule.find.trim();
    const replace = rule.replace.trim();
    if (find && replace && find !== replace) return `${find} → ${replace}`;
    return find || replace || '(filter)';
  }

  // A fresh recipient (only the default feeds, empty Draft) imports directly with
  // no merge prompt — the shared setup simply takes over.
  function canAutoImport(): boolean {
    return (
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
      if (!dialog.open) dialog.showModal();
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
        travel: lf.travel,
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
      <p>
        <strong>{feedCount}</strong> calendar{feedCount === 1 ? '' : 's'} and
        <strong>{ruleCount}</strong> filter{ruleCount === 1 ? '' : 's'}
        {feedCount + ruleCount === 1 ? 'is' : 'are'} ready to be imported:
      </p>
      {#if feedCount > 0 || ruleCount > 0}
        <div class="groups">
          {#if feedCount > 0}
            <h3 class="group-head">Calendars</h3>
            <ul class="group-list">
              {#each calendars as c (c.name)}
                {@const icon = categoryIcon(c.category)}
                <li class="row">
                  <span
                    class="style-swatch"
                    data-style={c.style ?? 'none'}
                    data-cal-color={c.color ?? null}
                    title={c.style ?? 'default'}
                  >K</span>
                  {#if icon}<span class="mark"><Icon name={icon} size={14} /></span>{/if}
                  <span class="row-name">{c.name}</span>
                  {#if c.local}<LocalBadge size={12} />{:else}<LocalBadge linked size={12} />{/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if ruleCount > 0}
            <h3 class="group-head">Filters</h3>
            <ul class="group-list">
              {#each importing.rules as rule (rule.id)}
                <li class="row">
                  <span
                    class="style-swatch"
                    data-style={rule.style ?? 'none'}
                    data-cal-color={rule.color ?? null}
                    title={rule.style ?? 'default'}
                  >K</span>
                  <span class="row-name">{filterLabel(rule)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={applyReplace}>Replace Yours</button>
        <button type="button" onclick={applyMerge}>Merge</button>
        <button type="button" onclick={close}>Cancel</button>
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
    margin-bottom: 0.75em;
  }
  h2 {
    margin: 0;
    font-size: 1.05em;
  }
  p {
    margin: 0 0 0.75em 0;
    font-size: var(--fs-13);
  }
  .groups {
    margin: 0 0 1em 0;
    max-height: 40vh;
    overflow-y: auto;
  }
  /* Section heading per kind, mirroring the settings-panel section heads. */
  .group-head {
    margin: 0.5em 0 0.25em;
    font-size: var(--fs-11);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-muted);
  }
  .group-head:first-child {
    margin-top: 0;
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
    flex: 1 1 auto;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
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
