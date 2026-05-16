<script lang="ts">
  import { config, getDisplayByFeed, pushLog, ui, effectiveFeedTz } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { startOfDay, addDays, addMonths, isoWeekNumber } from '../lib/time';
  import { formatDate, formatDateLong, formatMonth, formatTime, durationDays } from '../lib/format';
  import Icon from './Icon.svelte';
  import { tap } from '../lib/haptics';
  import type { DisplayEvent, FeedCategory } from '../lib/types';

  const COLLAPSED_HEIGHT = 28;
  const MAX_HEIGHT_VH = 60;

  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartHeight = 0;
  let pointerMoved = false;
  let height = $state(COLLAPSED_HEIGHT);
  let lastExpandedHeight = COLLAPSED_HEIGHT;

  const expanded = $derived(height > COLLAPSED_HEIGHT + 2);

  function maxHeight(): number {
    if (typeof window === 'undefined') return 400;
    return Math.round(window.innerHeight * (MAX_HEIGHT_VH / 100));
  }

  function startDrag(e: PointerEvent): void {
    dragging = true;
    pointerMoved = false;
    dragStartY = e.clientY;
    dragStartHeight = height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDrag(e: PointerEvent): void {
    if (!dragging) return;
    const delta = dragStartY - e.clientY;
    if (Math.abs(delta) > 3) pointerMoved = true;
    const next = Math.min(maxHeight(), Math.max(COLLAPSED_HEIGHT, dragStartHeight + delta));
    height = next;
  }

  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!pointerMoved) {
      toggleExpand();
      return;
    }
    const startedExpanded = dragStartHeight > COLLAPSED_HEIGHT + 2;
    const startedCollapsed = !startedExpanded;
    const draggedDown = e.clientY > dragStartY;
    const draggedUp = e.clientY < dragStartY - 10;
    if (startedCollapsed && draggedUp) {
      height = maxHeight();
      lastExpandedHeight = height;
      ui.statusExpanded = true;
      return;
    }
    if (startedCollapsed) {
      height = COLLAPSED_HEIGHT;
      ui.statusExpanded = false;
      return;
    }
    if (startedExpanded && draggedDown) {
      height = COLLAPSED_HEIGHT;
      ui.statusExpanded = false;
    } else if (height < COLLAPSED_HEIGHT * 1.5) {
      height = COLLAPSED_HEIGHT;
      ui.statusExpanded = false;
    } else {
      lastExpandedHeight = height;
      ui.statusExpanded = true;
    }
  }

  function toggleExpand(): void {
    tap();
    if (expanded) {
      height = COLLAPSED_HEIGHT;
      ui.statusExpanded = false;
    } else {
      height = Math.max(lastExpandedHeight, 200);
      ui.statusExpanded = true;
    }
  }

  // Base date: temp marker or today
  const baseDate = $derived(
    ui.tempMarkerMs != null ? startOfDay(new Date(ui.tempMarkerMs)) : today.value
  );

  // Next upcoming event for collapsed status (category 'none' feeds only)
  const nextEvent = $derived.by<DisplayEvent | null>(() => {
    const now = Date.now();
    let closest: DisplayEvent | null = null;
    const byFeed = getDisplayByFeed();
    for (const feed of config.feeds) {
      if (feed.category !== 'none') continue;
      for (const ev of (byFeed[feed.id] ?? [])) {
        if (ev.hidden) continue;
        if (ev.start.getTime() >= now) {
          if (!closest || ev.start < closest.start) closest = ev;
        }
      }
    }
    return closest;
  });

  const nextEventLabel = $derived.by<string | null>(() => {
    if (!nextEvent) return null;
    if (nextEvent.allDay) return nextEvent.displayTitle;
    const time = formatTime(nextEvent.start, config.timeFormat, config.timezone);
    return time + ' · ' + nextEvent.displayTitle;
  });

  // Helpers for event groups
  function getWeekStart(d: Date): Date {
    const dow = d.getUTCDay() || 7;
    return addDays(startOfDay(d), 1 - dow);
  }

  function formatWeekLabel(weekStart: Date): string {
    const weekEnd = addDays(weekStart, 6);
    const wn = isoWeekNumber(weekStart);
    const sd = weekStart.getUTCDate();
    const ed = weekEnd.getUTCDate();
    const sy = weekStart.getUTCFullYear();
    const ey = weekEnd.getUTCFullYear();
    const sm = formatMonth(weekStart, config.locale, 'short');
    const em = formatMonth(weekEnd, config.locale, 'short');
    let range: string;
    if (weekStart.getUTCMonth() === weekEnd.getUTCMonth()) {
      range = `${sm} ${sd}–${ed}, ${sy}`;
    } else if (sy === ey) {
      range = `${sm} ${sd}–${em} ${ed}, ${sy}`;
    } else {
      range = `${sm} ${sd} ${sy}–${em} ${ed} ${ey}`;
    }
    return `${range} (W${wn})`;
  }

  type EventWithFeed = { event: DisplayEvent; feedId: string; feedName: string; inferredCity: string | null };

  function cityFromTz(feedId: string): string | null {
    const tz = effectiveFeedTz(feedId);
    if (!tz || tz === 'local' || tz === 'UTC') return null;
    return tz.split('/').pop()?.replace(/_/g, ' ') ?? null;
  }

  const CATEGORY_ORDER: FeedCategory[] = ['none', 'guests', 'announcements', 'holidays', 'observances'];
  const CATEGORY_LABELS: Record<FeedCategory, string> = {
    none: 'Events',
    guests: 'Guests',
    announcements: 'Announcements',
    holidays: 'Holidays',
    observances: 'Observances',
  };

  type CategoryGroup = { category: FeedCategory; label: string; items: EventWithFeed[] };
  type WeekGroup = { label: string; categories: CategoryGroup[] };

  function groupByCategory(items: EventWithFeed[]): CategoryGroup[] {
    const map = new Map<FeedCategory, EventWithFeed[]>();
    for (const ef of items) {
      const feedCat = config.feeds.find(f => f.id === ef.feedId)?.category ?? 'none';
      const cat: FeedCategory = ef.event.ruleCategory ?? feedCat;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(ef);
    }
    return CATEGORY_ORDER
      .filter(c => map.has(c) && config.trayFilter.categories.includes(c))
      .map(c => ({ category: c, label: CATEGORY_LABELS[c], items: map.get(c)! }));
  }

  // Event groups — only computed when tray is open
  const eventGroups = $derived.by<{
    todayLabel: string;
    todayCategories: CategoryGroup[];
    weeks: WeekGroup[];
  } | null>(() => {
    if (!expanded) return null;

    const base = baseDate;
    const todayEnd = addDays(base, 1);
    const windowEnd = addMonths(base, 1);
    const byFeed = getDisplayByFeed();

    const todayItems: EventWithFeed[] = [];
    const futureItems: EventWithFeed[] = [];

    for (const feed of config.feeds) {
      const feedTravel = feed.travel ?? 'none';
      if (feedTravel !== 'none' && !config.trayFilter.travel.includes(feedTravel as 'local' | 'international')) continue;
      for (const ev of (byFeed[feed.id] ?? [])) {
        if (ev.hidden) continue;
        const ef: EventWithFeed = { event: ev, feedId: feed.id, feedName: feed.name, inferredCity: cityFromTz(feed.id) };
        if (ev.start < todayEnd && ev.end > base) {
          todayItems.push(ef);
        } else if (ev.start >= todayEnd && ev.start < windowEnd) {
          futureItems.push(ef);
        }
      }
    }

    todayItems.sort((a, b) => {
      if (a.event.allDay && !b.event.allDay) return -1;
      if (!a.event.allDay && b.event.allDay) return 1;
      return a.event.start.getTime() - b.event.start.getTime();
    });
    futureItems.sort((a, b) => a.event.start.getTime() - b.event.start.getTime());

    const weekMap = new Map<string, EventWithFeed[]>();
    const weekStartList: Date[] = [];
    for (const ef of futureItems) {
      const ws = getWeekStart(ef.event.start);
      const key = ws.toISOString();
      if (!weekMap.has(key)) {
        weekMap.set(key, []);
        weekStartList.push(ws);
      }
      weekMap.get(key)!.push(ef);
    }

    const weeks: WeekGroup[] = weekStartList.map(ws => ({
      label: formatWeekLabel(ws),
      categories: groupByCategory(weekMap.get(ws.toISOString())!),
    }));

    const todayLabel = ui.tempMarkerMs != null
      ? `${formatDateLong(base, config.locale)} (W${isoWeekNumber(base)})`
      : `Today (W${isoWeekNumber(base)})`;

    return { todayLabel, todayCategories: groupByCategory(todayItems), weeks };
  });

  function eventTimeLabel(ev: DisplayEvent): string {
    if (!ev.allDay) {
      return formatTime(ev.start, config.timeFormat, config.timezone)
        + '–'
        + formatTime(ev.end, config.timeFormat, config.timezone);
    }
    const days = durationDays(ev.start, ev.end, true);
    const last = new Date(ev.end.getTime() - 1);
    const sd = ev.start.getUTCDate();
    const ed = last.getUTCDate();
    const sm = formatMonth(ev.start, config.locale, 'short');
    const em = formatMonth(last, config.locale, 'short');
    if (days === 1) return `${sd} ${sm}`;
    if (ev.start.getUTCMonth() === last.getUTCMonth()) return `${sd}-${ed} ${sm}`;
    return `${sd} ${sm}-${ed} ${em}`;
  }

  function openEvent(ef: EventWithFeed): void {
    ui.modalEvent = ef.event;
    window.dispatchEvent(new CustomEvent('cal:scroll-to-date', { detail: { date: ef.event.start } }));
  }

  // Filter panel
  let filterOpen = $state(false);

  const isFilterActive = $derived(
    config.trayFilter.categories.length < 5 ||
    config.trayFilter.travel.length < 2,
  );

  $effect(() => { if (!expanded) filterOpen = false; });

  function toggleCategory(cat: FeedCategory): void {
    const cats = config.trayFilter.categories;
    config.trayFilter = {
      ...config.trayFilter,
      categories: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat],
    };
  }

  function toggleTravel(t: 'local' | 'international'): void {
    const travel = config.trayFilter.travel;
    config.trayFilter = {
      ...config.trayFilter,
      travel: travel.includes(t) ? travel.filter(x => x !== t) : [...travel, t],
    };
  }

  // Raw mode toggle
  let rawMode = $state(false);
  let copyDone = $state(false);

  // TSV text — derived so it updates reactively and can be displayed or copied
  const tsvText = $derived.by<string>(() => {
    if (!eventGroups) return '';
    const rows: string[] = ['Start Date\tEnd Date\tStart Time\tEnd Time\tTitle\tLocation\tCategory'];
    function addItems(items: EventWithFeed[], categoryLabel: string): void {
      for (const ef of items) {
        const ev = ef.event;
        const startDate = formatDate(ev.start, config.dateFormat, config.locale);
        const endRaw = ev.allDay ? new Date(ev.end.getTime() - 1) : ev.end;
        const endDate = formatDate(endRaw, config.dateFormat, config.locale);
        const startTime = ev.allDay ? '' : formatTime(ev.start, config.timeFormat, config.timezone);
        const endTime = ev.allDay ? '' : formatTime(ev.end, config.timeFormat, config.timezone);
        const location = ev.displayLocation || ef.inferredCity || '';
        rows.push([startDate, endDate, startTime, endTime, ev.displayTitle, location, categoryLabel].join('\t'));
      }
    }
    for (const cat of eventGroups.todayCategories) addItems(cat.items, cat.label);
    for (const week of eventGroups.weeks)
      for (const cat of week.categories) addItems(cat.items, cat.label);
    return rows.join('\n');
  });

  async function copyContent(): Promise<void> {
    try {
      if (rawMode) {
        await navigator.clipboard.writeText(tsvText);
        pushLog('Copied events list');
      } else {
        if (!eventGroups) return;
        const lines: string[] = [];
        function esc(s: string): string {
          return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function addSection(label: string, cats: typeof eventGroups.todayCategories): void {
          lines.push(`<b>${esc(label)}</b>`);
          for (const cat of cats) {
            lines.push(`<i>${esc(cat.label)}</i>`);
            lines.push('<ul>');
            for (const ef of cat.items) {
              const time = esc(eventTimeLabel(ef.event));
              const title = esc(ef.event.displayTitle);
              const loc = ef.event.displayLocation || ef.inferredCity || '';
              const locPart = loc ? ` · ${esc(loc)}` : '';
              lines.push(`<li>${time} · ${title}${locPart}</li>`);
            }
            lines.push('</ul>');
          }
        }
        if (eventGroups.todayCategories.length > 0) addSection(eventGroups.todayLabel, eventGroups.todayCategories);
        for (const week of eventGroups.weeks) addSection(week.label, week.categories);
        const html = lines.join('\n');
        if (typeof ClipboardItem !== 'undefined') {
          const blob = new Blob([html], { type: 'text/html' });
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
        } else {
          await navigator.clipboard.writeText(html);
        }
        pushLog('Copied events as HTML');
      }
      copyDone = true;
      setTimeout(() => { copyDone = false; }, 2000);
    } catch {
      pushLog('Copy failed', 'error');
    }
  }
</script>

<aside class="status-bar" style="height: {height}px;" data-expanded={expanded ? 'true' : null}>
  <button
    type="button"
    class="handle"
    aria-label={expanded ? 'Collapse events' : 'Expand events'}
    aria-expanded={expanded}
    onpointerdown={startDrag}
    onpointermove={onDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <span class="status-line">
      <span
        class="status-chip"
        data-online={online.value ? 'true' : null}
        title={online.value ? 'Online' : 'Offline'}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="status-text">{online.value ? 'ONLINE' : 'OFFLINE'}</span>
      </span>
      {#if nextEventLabel && !expanded}
        <span class="next-event">{nextEventLabel}</span>
      {/if}
    </span>
    <span class="toggle" aria-hidden="true">
      <Icon name={expanded ? 'arrow-down' : 'arrow-up'} size={14} />
    </span>
  </button>

  {#if expanded && eventGroups}
    <div class="events-tray" role="region" aria-label="Upcoming events">
      {#if filterOpen}
        <div class="filter-panel">
          <div class="filter-row">
            <span class="filter-row-label">Cat</span>
            {#each CATEGORY_ORDER as cat}
              <button
                type="button"
                class="filter-chip"
                aria-pressed={config.trayFilter.categories.includes(cat)}
                onclick={() => toggleCategory(cat)}
              >{CATEGORY_LABELS[cat]}</button>
            {/each}
          </div>
          <div class="filter-row">
            <span class="filter-row-label">Travel</span>
            {#each (['local', 'international'] as const) as t}
              <button
                type="button"
                class="filter-chip"
                aria-pressed={config.trayFilter.travel.includes(t)}
                onclick={() => toggleTravel(t)}
              >{t === 'local' ? 'Local' : 'International'}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if rawMode}
        <div class="raw-block">
          <pre>{tsvText}</pre>
        </div>
      {:else}
        <div class="tray-scroll">
          {#if eventGroups.todayCategories.length === 0 && eventGroups.weeks.length === 0}
            <p class="empty">No upcoming events in the next month.</p>
          {:else}
            {#if eventGroups.todayCategories.length > 0}
              <div class="week-group">
                <h2 class="week-label">{eventGroups.todayLabel}</h2>
                {#each eventGroups.todayCategories as catGroup (catGroup.category)}
                  <div class="cat-group">
                    <h3 class="cat-label">{catGroup.label}</h3>
                    <div class="event-list">
                      {#each catGroup.items as ef (ef.event.uid)}
                        <button type="button" class="event-row" onclick={() => openEvent(ef)}>
                          <span class="event-time">{eventTimeLabel(ef.event)}</span>
                          <span class="event-title">{ef.event.displayTitle}</span>
                          {#if ef.event.displayLocation || ef.inferredCity}
                            <span class="event-loc">{ef.event.displayLocation || ef.inferredCity}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            {#each eventGroups.weeks as week}
              <div class="week-group">
                <h2 class="week-label">{week.label}</h2>
                {#each week.categories as catGroup (catGroup.category)}
                  <div class="cat-group">
                    <h3 class="cat-label">{catGroup.label}</h3>
                    <div class="event-list">
                      {#each catGroup.items as ef (ef.event.uid)}
                        <button type="button" class="event-row" onclick={() => openEvent(ef)}>
                          <span class="event-time">{eventTimeLabel(ef.event)}</span>
                          <span class="event-title">{ef.event.displayTitle}</span>
                          {#if ef.event.displayLocation || ef.inferredCity}
                            <span class="event-loc">{ef.event.displayLocation || ef.inferredCity}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
      <div class="copy-bar">
        <button
          type="button"
          class="copy-btn"
          aria-pressed={filterOpen}
          data-filter-active={isFilterActive && !filterOpen ? 'true' : null}
          onclick={() => (filterOpen = !filterOpen)}
          title="Filter visible categories and travel"
        >Filter</button>
        <span class="copy-spacer"></span>
        <button
          type="button"
          class="copy-btn"
          aria-pressed={rawMode}
          onclick={() => (rawMode = !rawMode)}
          title="Toggle raw TSV view"
        >{'{ }'}</button>
        <button
          type="button"
          class="copy-btn"
          onclick={() => void copyContent()}
          title={rawMode ? 'Copy as tab-separated list' : 'Copy as rich text'}
        >{copyDone ? '✓' : 'Copy'}</button>
      </div>
    </div>
  {/if}
</aside>

<style>
  .status-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    border-top: 2px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    user-select: none;
    -webkit-user-select: none;
    transition: height 120ms ease-out;
  }
  .status-bar[data-expanded='true'] .handle {
    border-bottom: 1px dashed var(--ink);
  }
  .status-bar[data-expanded='true'] {
    transition: none;
  }
  .handle {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.6em;
    height: 28px;
    flex-shrink: 0;
    padding: 0 0.6em;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: none;
  }
  .status-line {
    display: inline-flex;
    align-items: center;
    gap: 0.6em;
    overflow: hidden;
    font-size: 12px;
    min-width: 0;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-family: var(--mono);
    font-size: 11px;
    flex-shrink: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
  }
  .status-chip[data-online='true'] .dot {
    background: #22c55e;
  }
  .status-text {
    letter-spacing: 0.04em;
  }
  .next-event {
    font-family: var(--mono);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    color: var(--ink-muted);
  }

  /* Tray */
  .events-tray {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .filter-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    padding: 0.4em 0.6em;
    border-bottom: 1px dashed var(--ink-faint);
    background: var(--paper-2);
    user-select: none;
    -webkit-user-select: none;
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.25em;
    flex-wrap: wrap;
  }
  .filter-row-label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
    flex-shrink: 0;
    min-width: 3.5em;
  }
  .filter-chip {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    padding: 0.15em 0.5em;
    border: 1px solid var(--ink-faint);
    background: var(--paper);
    color: var(--ink-muted);
    cursor: pointer;
  }
  .filter-chip[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--paper);
  }
  .copy-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.35em 0.6em;
    border-top: 1px dashed var(--ink-faint);
  }
  .copy-spacer {
    flex: 1 1 auto;
  }
  .copy-btn {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .copy-btn:hover,
  .copy-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .copy-btn[data-filter-active='true'] {
    border-style: dashed;
  }
  .raw-block {
    flex: 1 1 auto;
    overflow: auto;
    padding: 0.4em 0.6em;
    user-select: text;
    -webkit-user-select: text;
  }
  .raw-block pre {
    margin: 0;
    padding: 0.6em 0.8em;
    border: 1px solid var(--ink-faint);
    background: var(--paper-2);
    overflow: auto;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.4;
    white-space: pre;
    word-break: break-all;
  }
  .tray-scroll {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0.4em 0.6em 0.5em;
    user-select: text;
    -webkit-user-select: text;
  }
  .week-group {
    margin-bottom: 0.8em;
  }
  h2.week-label {
    margin: 0 0 0.3em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid var(--ink);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .cat-group {
    margin-bottom: 0.4em;
  }
  h3.cat-label {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: normal;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin: 0 0 0.15em;
  }
  .event-list {
    display: flex;
    flex-direction: column;
  }
  .event-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5em;
    align-items: baseline;
    width: 100%;
    font-size: 12px;
    font-family: var(--mono);
    padding: 1px 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .event-row:focus-visible {
    outline: none;
    text-decoration: underline;
  }
  .event-time {
    color: var(--ink-muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .event-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .event-loc {
    font-size: 10px;
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    text-align: right;
  }
  .empty {
    margin: 0;
    color: var(--ink-muted);
    font-size: 12px;
    font-family: var(--mono);
  }
</style>
