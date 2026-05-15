<script lang="ts">
  import { config, getDisplayByFeed, pushLog, ui, effectiveFeedTz } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { startOfDay, addDays, isoWeekNumber } from '../lib/time';
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
    const draggedUp = e.clientY < dragStartY - 30;
    if (startedCollapsed && draggedUp) {
      height = maxHeight();
      lastExpandedHeight = height;
      ui.statusExpanded = true;
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
      const cat = config.feeds.find(f => f.id === ef.feedId)?.category ?? 'none';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(ef);
    }
    return CATEGORY_ORDER
      .filter(c => map.has(c))
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
    const windowEnd = addDays(base, 15);
    const byFeed = getDisplayByFeed();

    const todayItems: EventWithFeed[] = [];
    const futureItems: EventWithFeed[] = [];

    for (const feed of config.feeds) {
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
      ? formatDateLong(base, config.locale)
      : 'Today';

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
    let datePart: string;
    if (ev.start.getUTCMonth() === last.getUTCMonth()) {
      datePart = `${sd}–${ed} ${sm}`;
    } else {
      datePart = `${sd} ${sm}–${ed} ${em}`;
    }
    return `${datePart} (${days}d)`;
  }

  // Copy as tab-separated list
  let copyDone = $state(false);

  async function copyEventList(): Promise<void> {
    if (!eventGroups) return;
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
    for (const week of eventGroups.weeks) {
      for (const cat of week.categories) addItems(cat.items, cat.label);
    }

    try {
      await navigator.clipboard.writeText(rows.join('\n'));
      copyDone = true;
      setTimeout(() => { copyDone = false; }, 2000);
      pushLog('Copied events list');
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
      <div class="tray-scroll">
        {#if eventGroups.todayCategories.length === 0 && eventGroups.weeks.length === 0}
          <p class="empty">No upcoming events in the next two weeks.</p>
        {:else}
          {#if eventGroups.todayCategories.length > 0}
            <div class="week-group">
              <h3 class="week-label">{eventGroups.todayLabel}</h3>
              {#each eventGroups.todayCategories as catGroup (catGroup.category)}
                <div class="cat-group">
                  <span class="cat-label">{catGroup.label}</span>
                  <ul>
                    {#each catGroup.items as ef (ef.event.uid)}
                      <li class="event-row">
                        <span class="event-time">{eventTimeLabel(ef.event)}</span>
                        <span class="event-title">{ef.event.displayTitle}</span>
                        <span class="event-cal">{ef.feedName}</span>
                        {#if ef.event.displayLocation || ef.inferredCity}
                          <span class="event-location">{ef.event.displayLocation || ef.inferredCity}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          {/if}

          {#each eventGroups.weeks as week}
            <div class="week-group">
              <h3 class="week-label">{week.label}</h3>
              {#each week.categories as catGroup (catGroup.category)}
                <div class="cat-group">
                  <span class="cat-label">{catGroup.label}</span>
                  <ul>
                    {#each catGroup.items as ef (ef.event.uid)}
                      <li class="event-row">
                        <span class="event-time">{eventTimeLabel(ef.event)}</span>
                        <span class="event-title">{ef.event.displayTitle}</span>
                        <span class="event-cal">{ef.feedName}</span>
                        {#if ef.event.displayLocation || ef.inferredCity}
                          <span class="event-location">{ef.event.displayLocation || ef.inferredCity}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
      <button
        type="button"
        class="copy-btn"
        onclick={copyEventList}
        title="Copy as tab-separated list for Excel"
      >{copyDone ? 'Copied!' : 'Copy'}</button>
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
    position: relative;
  }
  .copy-btn {
    position: absolute;
    bottom: 0.6em;
    right: 0.6em;
    z-index: 1;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    padding: 0.2em 0.6em;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
  }
  .copy-btn:hover {
    background: var(--ink);
    color: var(--paper);
  }
  .tray-scroll {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0.4em 0.6em 2.5em;
    user-select: text;
    -webkit-user-select: text;
  }
  .week-group {
    margin-bottom: 0.8em;
  }
  .week-label {
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
  .cat-label {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin-bottom: 0.15em;
  }
  .cat-group ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .event-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5em;
    align-items: baseline;
    font-size: 12px;
    font-family: var(--mono);
    padding: 1px 0;
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
  .event-cal {
    font-size: 10px;
    color: var(--ink-muted);
    white-space: nowrap;
    text-align: right;
  }
  .event-location {
    grid-column: 2;
    font-size: 10px;
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .empty {
    margin: 0;
    color: var(--ink-muted);
    font-size: 12px;
    font-family: var(--mono);
  }
</style>
