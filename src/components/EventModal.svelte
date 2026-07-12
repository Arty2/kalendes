<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import CalendarDownloadMenu from './CalendarDownloadMenu.svelte';
  import { ui, config, events, pushLog, isKiosk, timelineEventsFor } from '../lib/state.svelte';
  import { formatRange, formatTime } from '../lib/format';
  import { makeRule, matchingRulesFor } from '../lib/rules';
  import { formatEventDateInfo, linkifyText } from '../lib/event-display';
  import { extractRawVevent, wrapVeventInCalendar } from '../lib/ics-core';
  import { fetchFeedText, feedIdFor } from '../lib/ics';
  import { travelIcon } from '../lib/icons';
  import { buildIcs } from '../lib/calendar-links';
  import { isLocalFeedId, type FindReplaceRule, type StyleVariant } from '../lib/types';

  let dialog: HTMLDialogElement | undefined = $state();
  let showSource = $state(false);
  let returnEvent: typeof ui.modalEvent = null;
  let returnShowSource = false;
  let swipeStartY: number | null = null;
  let dismissing = $state(false);

  const isScratch = $derived(ui.modalEvent ? isLocalFeedId(ui.modalEvent.feedId) : false);
  // Kiosk mode: the modal is view-only — every mutate/export action is disabled.
  const locked = $derived(isKiosk());

  // A merged consecutive-day event is shown one real day at a time (with that
  // day's own unaltered times) and paged through with arrows; a normal event is
  // just itself. `shown` is the event the modal actually renders.
  let memberIndex = $state(0);
  const members = $derived(ui.modalEvent?.spanMembers ?? null);
  const shown = $derived.by(() => {
    const m = ui.modalEvent;
    if (!m) return null;
    if (members && members.length > 1) return members[Math.min(memberIndex, members.length - 1)] ?? m;
    return m;
  });
  // When opening, land on today's day if it's within the run, else the first.
  function initialMemberIndex(ev: NonNullable<typeof ui.modalEvent>): number {
    const mem = ev.spanMembers;
    if (!mem || mem.length <= 1) return 0;
    const now = new Date();
    const i = mem.findIndex(
      (m) =>
        m.start.getFullYear() === now.getFullYear() &&
        m.start.getMonth() === now.getMonth() &&
        m.start.getDate() === now.getDate(),
    );
    return i >= 0 ? i : 0;
  }

  // Prev/next paging between events of the same feed — the side arrows step
  // through timelineEventsFor (the visible, start-sorted, day-merged list arrow-
  // key nav and RowHeader already use), so the modal walks events in the same
  // order the timeline shows them. The opened event is one of these entries, so
  // its uid locates the current position.
  //
  // Resolve the config feed via feedForEvent first: a remote event's own feedId
  // is feedIdFor(source) (a URL hash), which differs from the config feed id that
  // keys timelineEventsFor for the seeded holiday feeds — so keying on the raw
  // event feedId would yield an empty list and hide the arrows on those feeds.
  const navList = $derived.by(() => {
    const ev = ui.modalEvent;
    if (!ev) return [];
    return timelineEventsFor(feedForEvent(ev.feedId)?.id ?? ev.feedId);
  });
  const navIndex = $derived(
    ui.modalEvent ? navList.findIndex((e) => e.uid === ui.modalEvent!.uid) : -1,
  );
  const hasPrev = $derived(navIndex > 0);
  const hasNext = $derived(navIndex >= 0 && navIndex < navList.length - 1);

  function stepEvent(dir: -1 | 1): void {
    if (navIndex < 0) return;
    const next = navList[navIndex + dir];
    if (!next) return;
    ui.modalEvent = next;
    // The open $effect (guarded by !dialog.open) won't re-run while paging, so
    // reset the per-event view state it normally seeds on a fresh open.
    memberIndex = initialMemberIndex(next);
    showSource = false;
  }

  // The calendar the event belongs to — named (with a style preview) in the
  // source view, where the chip opens the feed's settings. Parsed events carry
  // feedIdFor(source) (a URL hash for remote feeds), which only equals the
  // config feed's id for scratchpad and user-added feeds — the hardcoded
  // default feeds use readable ids, so match on either.
  function feedForEvent(feedId: string) {
    return (
      config.feeds.find((f) => f.id === feedId || feedIdFor(f.source) === feedId) ?? null
    );
  }
  const feed = $derived(ui.modalEvent ? feedForEvent(ui.modalEvent.feedId) : null);

  // The raw text backing the source view is session-only, so it's missing
  // after a reload whose refresh revalidated with 304. Refetch it in the
  // background when an event of that feed is opened; on failure (e.g.
  // offline) the source view simply stays hidden, as it always did before
  // the first successful fetch.
  $effect(() => {
    const ev = ui.modalEvent;
    if (!ev || events.rawTextByFeed[ev.feedId] !== undefined) return;
    const source = feedForEvent(ev.feedId)?.source;
    if (!source || source.kind === 'scratchpad') return;
    void fetchFeedText(source)
      .then((text) => {
        events.rawTextByFeed[ev.feedId] = text;
      })
      .catch(() => {});
  });

  function openFeedSettings(feedId: string): void {
    if (isKiosk()) return;
    returnEvent = ui.modalEvent;
    returnShowSource = showSource;
    ui.settingsScrollToFeedId = feedId;
    ui.settingsAutoEditFeedId = feedId;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      showSource = false;
      swipeStartY = null;
      dismissing = false;
      memberIndex = initialMemberIndex(ui.modalEvent);
    }
    if (!ui.modalEvent && dialog.open) dialog.close();
  });

  $effect(() => {
    if (!ui.settingsOpen && returnEvent) {
      const ev = returnEvent;
      const wantsSource = returnShowSource;
      returnEvent = null;
      returnShowSource = false;
      ui.modalEvent = ev;
      if (wantsSource) queueMicrotask(() => { showSource = true; });
    }
  });

  function addFilterFromEvent(): void {
    if (isKiosk()) return;
    const sel = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() ?? '' : '';
    const newRule = makeRule({ find: sel });
    config.rules = [...config.rules, newRule];
    returnEvent = ui.modalEvent;
    returnShowSource = showSource;
    ui.settingsAutoEditRuleId = newRule.id;
    ui.settingsScrollToRuleId = newRule.id;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  const matchedRules = $derived(
    shown ? matchingRulesFor(shown, config.rules) : ([] as FindReplaceRule[]),
  );

  function styleLabel(s: StyleVariant): string {
    switch (s) {
      case 'outline': return 'Outline';
      case 'bold': return 'Bold';
      case 'inverted': return 'Solid';
      case 'dashed': return 'Dashed';
      case 'muted': return 'Muted';
      case 'striked': return 'Striked';
      case 'hidden': return 'Hidden';
      default: return 'Default';
    }
  }

  function openRuleInSettings(rule: FindReplaceRule): void {
    if (isKiosk()) return;
    returnEvent = ui.modalEvent;
    ui.settingsAutoEditRuleId = rule.id;
    ui.settingsScrollToRuleId = rule.id;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  function close(): void {
    ui.modalEvent = null;
  }

  // Edit a Draft event: reopen it in the same modal used to create one.
  function editDraft(): void {
    const uid = shown?.uid;
    if (!uid) return;
    ui.modalEvent = null;
    ui.addEventEditUid = uid;
    ui.addEventOpen = true;
  }

  function onDialogPointerDown(e: PointerEvent): void {
    if (dismissing) return;
    swipeStartY = e.clientY;
  }
  function onDialogPointerUp(e: PointerEvent): void {
    if (swipeStartY == null || dismissing) return;
    const dy = swipeStartY - e.clientY;
    swipeStartY = null;
    if (dy > 80) dismissing = true;
  }
  function onDialogPointerCancel(): void {
    swipeStartY = null;
  }
  function onDialogTransitionEnd(e: TransitionEvent): void {
    if (e.target !== dialog) return;
    if (dismissing && e.propertyName === 'transform') close();
  }

  function onClick(e: MouseEvent): void {
    if (e.target === dialog) close();
  }

  const dateInfo = $derived(
    shown
      ? formatEventDateInfo(
          shown,
          config.dateFormat,
          config.locale,
          config.timeFormat,
          config.timezone,
        )
      : null,
  );

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
      formatRange(ev.start, ev.end, config.dateFormat, config.locale),
    );
    if (!ev.allDay) {
      lines.push(
        formatTime(ev.start, config.timeFormat, config.timezone) +
          ' — ' +
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

  // Split the raw text into runs, tagging each matched run with the rule that
  // matched so the <mark> can be styled like that rule's assigned pill style
  // (e.g. an Observances/dashed rule renders a dashed mark, not a plain one).
  function highlightFinds(
    text: string,
    rules: FindReplaceRule[],
  ): { text: string; rule: FindReplaceRule | null }[] {
    const active = rules.filter((r) => r.find.length > 0);
    if (active.length === 0) return [{ text, rule: null }];
    const out: { text: string; rule: FindReplaceRule | null }[] = [];
    let i = 0;
    while (i < text.length) {
      let nextIdx = -1;
      let nextLen = 0;
      let nextRule: FindReplaceRule | null = null;
      for (const r of active) {
        const idx = text.indexOf(r.find, i);
        if (idx === -1) continue;
        if (nextIdx === -1 || idx < nextIdx || (idx === nextIdx && r.find.length > nextLen)) {
          nextIdx = idx;
          nextLen = r.find.length;
          nextRule = r;
        }
      }
      if (nextIdx === -1) {
        out.push({ text: text.slice(i), rule: null });
        break;
      }
      if (nextIdx > i) out.push({ text: text.slice(i, nextIdx), rule: null });
      out.push({ text: text.slice(nextIdx, nextIdx + nextLen), rule: nextRule });
      i = nextIdx + nextLen;
    }
    return out;
  }
</script>

<dialog
  bind:this={dialog}
  class:dismissing
  onclose={close}
  onclick={onClick}
  onpointerdown={onDialogPointerDown}
  onpointerup={onDialogPointerUp}
  onpointercancel={onDialogPointerCancel}
  ontransitionend={onDialogTransitionEnd}
>
  {#if ui.modalEvent}
    {@const ev = shown ?? ui.modalEvent}
    {@const rawVevent = events.rawTextByFeed[ev.feedId] ? extractRawVevent(events.rawTextByFeed[ev.feedId]!, ev.uid) : null}
    {@const raw = rawVevent ? wrapVeventInCalendar(rawVevent) : buildIcs(ev)}
    <article class:locked>
      <header>
        <h2 class="modal-title">{ev.displayTitle}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      {#if showSource}
        <div class="raw-block">
          <pre><code>{#each highlightFinds(raw, matchedRules) as part}{#if part.rule}<mark data-style={part.rule.style} data-cal-color={part.rule.color ?? null}>{part.text}</mark>{:else}{part.text}{/if}{/each}</code></pre>
        </div>
        {#if feed}
          <div class="feed-head">
            <button
              type="button"
              class="filter-row"
              onclick={() => openFeedSettings(feed.id)}
              title="Open this calendar's settings"
            >
              <span
                class="style-swatch"
                data-style={feed.style ?? 'none'}
                data-cal-color={feed.color ?? null}
                aria-label={styleLabel(feed.style ?? 'none')}
                title={styleLabel(feed.style ?? 'none')}
              >K</span>
              <span class="filter-preview">{feed.name}</span>
            </button>
          </div>
        {/if}
        {#if matchedRules.length > 0}
          <ul class="filter-list" class:has-feed={feed}>
            {#each matchedRules as rule (rule.id)}
              <li>
                <button type="button" class="filter-row" onclick={() => openRuleInSettings(rule)}>
                  <span
                    class="style-swatch"
                    data-style={rule.style}
                    data-cal-color={rule.color ?? null}
                    aria-label={styleLabel(rule.style)}
                    title={styleLabel(rule.style)}
                  >K</span>
                  <span class="filter-preview" data-mono>{rule.find} &gt; {rule.replace || '(empty)'}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        {@const info = dateInfo ?? { date: '', time: '', duration: '', weekday: '', multiDay: false }}
        <p class="event-info"><time datetime={ev.start.toISOString()}>{info.date}</time>{#if info.weekday && !info.multiDay}<span class="event-dim">{' · '}</span><span class="event-weekday">{info.weekday}</span>{/if}{#if ev.allDay && info.duration}<span class="event-dim">{' · '}{info.duration}</span>{/if}</p>
        {#if info.multiDay && info.weekday}<p class="event-info"><span class="event-weekday">{info.weekday}</span></p>{/if}
        {#if info.time}<p class="event-time">{info.time}{#if info.duration}{' · '}{info.duration}{/if}</p>{/if}
        {#if ev.displayLocation}
          {@const travelIconName = travelIcon(ev.travel ?? feed?.travel)}
          <p class="event-info event-location">
            {#if travelIconName}<Icon name={travelIconName} size={12} />{/if}{ev.displayLocation}
          </p>
        {/if}
        {#if ev.displayDescription}<p class="desc">{@html linkifyText(ev.displayDescription)}</p>{/if}
        {#if ev.url}<p class="source-link"><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
      {/if}
      {#if !locked}
        <footer class="modal-footer">
          <div class="source-slot">
            {#if isScratch && !showSource}
              <button type="button" class="action-btn" onclick={editDraft}>EDIT</button>
            {/if}
            {#if showSource}
              <button type="button" class="action-btn add-filter-btn" onclick={addFilterFromEvent}
              >+ Filter</button>
              {#if matchedRules.length > 0}
                <button type="button" class="filter-count" data-mono
                  aria-pressed={showSource}
                  title="Hide source view"
                  onclick={() => (showSource = !showSource)}
                >{matchedRules.length}</button>
              {/if}
            {:else if matchedRules.length > 0}
              <button type="button" class="filter-count" data-mono
                aria-pressed={showSource}
                onclick={() => (showSource = !showSource)}
              >{matchedRules.length} filter{matchedRules.length === 1 ? '' : 's'}</button>
            {/if}
          </div>
          <div class="copy-slot">
            <CalendarDownloadMenu events={[ev]} />
            <button
              type="button"
              class="raw-toggle"
              aria-pressed={showSource}
              onclick={() => (showSource = !showSource)}
              title={showSource ? 'Hide raw iCal' : 'View raw iCal'}
              aria-label={showSource ? 'Hide raw iCal' : 'View raw iCal'}
            >{'{ }'}</button>
            <button
              type="button"
              class="action-btn"
              onclick={() => void copyText(showSource ? raw : buildDetails(ev), showSource ? 'data' : 'details')}
            >COPY</button>
          </div>
        </footer>
      {/if}
    </article>
    {#if members && members.length > 1}
      <nav class="member-nav" data-mono aria-label="Switch day">
        <IconButton
          icon="chevron-left"
          label="Previous day"
          variant="ghost"
          size={26}
          onclick={() => (memberIndex = (memberIndex - 1 + members.length) % members.length)}
        />
        <span class="member-pos">{memberIndex + 1}/{members.length}</span>
        <IconButton
          icon="chevron-right"
          label="Next day"
          variant="ghost"
          size={26}
          onclick={() => (memberIndex = (memberIndex + 1) % members.length)}
        />
      </nav>
    {/if}
    {#if navList.length > 1}
      <button
        class="event-nav event-nav-prev"
        aria-label="Previous event"
        disabled={!hasPrev}
        onclick={() => stepEvent(-1)}
      >
        <Icon name="chevron-left" size={28} />
      </button>
      <button
        class="event-nav event-nav-next"
        aria-label="Next event"
        disabled={!hasNext}
        onclick={() => stepEvent(1)}
      >
        <Icon name="chevron-right" size={28} />
      </button>
    {/if}
  {/if}
</dialog>

<style>
  dialog {
    /* Transparent wrapper: the bordered card is the <article>, the day-nav
       floats below it (outside the card border), both centred. */
    border: none;
    background: none;
    color: var(--ink);
    padding: 0;
    /* Extra side margin leaves a gutter wide enough for the prev/next arrows to
       sit fully outside the card border (rather than overlapping it). */
    width: min(600px, calc(100vw - 6rem));
    max-height: calc(100dvh - 2rem);
    overflow: visible;
    overscroll-behavior: contain;
    box-sizing: border-box;
    transition: transform 150ms ease-in, opacity 150ms ease-in;
  }
  dialog.dismissing {
    transform: translateY(-100vh);
    opacity: 0;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    overscroll-behavior: contain;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: background 150ms ease-in, backdrop-filter 150ms ease-in, -webkit-backdrop-filter 150ms ease-in;
  }
  dialog.dismissing::backdrop {
    background: rgba(0, 0, 0, 0);
    backdrop-filter: blur(0);
    -webkit-backdrop-filter: blur(0);
  }
  article {
    padding: 1em;
    position: relative;
    border: var(--border-w) solid var(--ink);
    background: var(--paper);
    box-sizing: border-box;
    overflow: auto;
    overscroll-behavior: contain;
    /* Cap the card so it scrolls and leaves room for the nav below it. */
    max-height: calc(100dvh - 5rem);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5em;
    padding-bottom: 0.35em;
    margin-bottom: 0.25em;
  }
  .modal-title {
    flex: 1 1 auto;
    margin: 0;
    font-size: 1.15em;
  }
  /* Paging between the individual days of a merged consecutive-day event —
     floats below the card, centred, borderless. Ink reads on the darkened
     backdrop in both themes. */
  .member-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75em;
    margin-top: 0.5em;
    color: var(--ink);
  }
  .member-pos {
    min-width: 2.4em;
    text-align: center;
    font-size: var(--fs-12);
  }
  /* Prev/next paging between events: a full-height tap strip down each side, just
     outside the card, with the chevron centred. Positioned against the dialog (the
     transparent, overflow:visible wrapper) — the <article> clips its own overflow,
     so the strips can't live inside it. Ink reads on the darkened backdrop like
     .member-nav does. */
  .event-nav {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    z-index: 1;
  }
  .event-nav-prev {
    right: 100%;
  }
  .event-nav-next {
    left: 100%;
  }
  .event-nav:not(:disabled):hover,
  .event-nav:not(:disabled):active {
    color: var(--accent);
  }
  .event-nav:disabled {
    opacity: 0.28;
    cursor: default;
    /* Let a tap on a faded side fall through to the backdrop (close the modal)
       instead of being a dead zone. */
    pointer-events: none;
  }
  /* Merged-day pager: no fill, just tint the chevron with the accent on active. */
  .member-nav :global(.icon-button:not(:disabled):hover),
  .member-nav :global(.icon-button:not(:disabled):active) {
    background: transparent;
    color: var(--accent);
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
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  .action-btn:hover {
    background: var(--paper-2);
  }
  /* Kiosk mode: read-only — block text selection / copy. */
  .locked,
  .locked * {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .raw-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
  }
  .raw-toggle:hover,
  .raw-toggle[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .event-info {
    margin: 0.1em 0;
  }
  /* Localized weekday beside/under the date — ink and non-mono so the day name
     reads as prominently as the date next to the mono numerals. */
  .event-weekday {
    color: var(--ink);
  }
  /* Separators and the duration are de-emphasized so the date + weekday lead. */
  .event-dim {
    color: var(--ink-muted);
  }
  /* The travel charm sits inline before the location text. */
  .event-location :global(.icon) {
    margin-right: 4px;
    vertical-align: -2px;
    color: var(--ink-muted);
  }
  .event-time {
    font-family: var(--mono);
    font-size: 0.9em;
    color: var(--ink-muted);
    margin: 0.1em 0;
  }
  .filter-count {
    font-size: var(--fs-11);
    color: var(--ink-muted);
  }
  button.filter-count {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-11);
    color: var(--ink-muted);
  }
  .filter-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Thin divider between the feed header and the filters, only when a feed
     precedes the list (feed always renders; filters are optional). */
  .filter-list.has-feed {
    border-top: var(--border-w) solid var(--ink);
  }
  .filter-list li + li {
    border-top: var(--border-w) solid var(--ink);
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
    font-size: var(--fs-12);
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
  /* .style-swatch (the "K" style/colour preview) is shared in global.css. */
  .desc {
    white-space: pre-wrap;
    margin: 0.6em 0 0.1em;
    /* Always wrap long URLs (and any unbroken token) so they can't overflow the
       dialog width. `anywhere` also lets flex/line layout shrink around them. */
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .desc :global(a),
  .source-link a {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .source-link {
    margin: 0.4em 0 0.1em;
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
    border: var(--border-w) solid var(--ink);
    background: var(--paper-2);
    overflow: auto;
    max-height: 34dvh;
    font-family: var(--mono);
    font-size: var(--fs-11);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-all;
  }
  /* Matches are styled to echo the rule's assigned pill style, so the highlight
     reads the way the event will render (dashed for Observances, struck for
     CANCELED, tinted for coloured rules) rather than a uniform block. */
  .raw-block mark {
    background: var(--ink);
    color: var(--paper);
    padding: 0 0.1em;
  }
  .raw-block mark[data-style="outline"],
  .raw-block mark[data-style="dashed"],
  .raw-block mark[data-style="muted"],
  .raw-block mark[data-style="striked"],
  .raw-block mark[data-style="hidden"] {
    background: transparent;
    color: inherit;
    outline: var(--border-w) solid var(--ink);
    outline-offset: -1px;
  }
  .raw-block mark[data-style="bold"] {
    font-weight: 700;
  }
  .raw-block mark[data-style="dashed"],
  .raw-block mark[data-style="hidden"] {
    outline-style: dashed;
  }
  .raw-block mark[data-style="muted"] {
    opacity: 0.5;
  }
  .raw-block mark[data-style="striked"],
  .raw-block mark[data-style="hidden"] {
    text-decoration: line-through;
  }
  /* Calendar-coloured marks tint like the pills/swatches. Last so the colour
     fill + border win over the plain style rules above. */
  .raw-block mark[data-cal-color="peach"] { background: var(--cal-peach-bg); color: var(--ink); outline-color: var(--cal-peach-border); }
  .raw-block mark[data-cal-color="amber"] { background: var(--cal-amber-bg); color: var(--ink); outline-color: var(--cal-amber-border); }
  .raw-block mark[data-cal-color="mint"] { background: var(--cal-mint-bg); color: var(--ink); outline-color: var(--cal-mint-border); }
  .raw-block mark[data-cal-color="teal"] { background: var(--cal-teal-bg); color: var(--ink); outline-color: var(--cal-teal-border); }
  .raw-block mark[data-cal-color="sky"] { background: var(--cal-sky-bg); color: var(--ink); outline-color: var(--cal-sky-border); }
  .raw-block mark[data-cal-color="lavender"] { background: var(--cal-lavender-bg); color: var(--ink); outline-color: var(--cal-lavender-border); }
</style>
