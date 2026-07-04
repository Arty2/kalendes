<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import CalendarDownloadMenu from './CalendarDownloadMenu.svelte';
  import { ui, config, events, pushLog, deleteScratchpadEvent, isKiosk, effectiveFeedTz } from '../lib/state.svelte';
  import { formatRange, formatTime, formatTzDiff, isDaylight, dayLimitMinutes } from '../lib/format';
  import { clock } from '../lib/clock.svelte';
  import { makeRule, matchingRulesFor } from '../lib/rules';
  import { formatEventDateInfo, linkifyText } from '../lib/event-display';
  import { extractRawVevent, wrapVeventInCalendar } from '../lib/ics-core';
  import { fetchFeedText } from '../lib/ics';
  import { travelIcon } from '../lib/icons';
  import { buildIcs } from '../lib/calendar-links';
  import { isLocalFeedId, type FindReplaceRule, type StyleVariant } from '../lib/types';

  let dialog: HTMLDialogElement | undefined = $state();
  let showSource = $state(false);
  let returnEvent: typeof ui.modalEvent = null;
  let returnShowSource = false;
  let swipeStartY: number | null = null;
  let dismissing = $state(false);
  let deleteBtn: ConfirmButton | undefined = $state();
  // Latch the event so the deferred delete still targets the right uid
  // if ui.modalEvent shifts while the done cooldown is up.
  let pendingDeleteUid: string | null = null;

  const isScratch = $derived(ui.modalEvent ? isLocalFeedId(ui.modalEvent.feedId) : false);
  // Kiosk mode: the modal is view-only — every mutate/export action is disabled.
  const locked = $derived(isKiosk());

  // The calendar the event belongs to, plus a live clock in that feed's timezone
  // (same indicator the feed row headers show).
  const feed = $derived(
    ui.modalEvent ? config.feeds.find((f) => f.id === ui.modalEvent!.feedId) ?? null : null,
  );
  const feedTz = $derived(
    ui.modalEvent ? effectiveFeedTz(ui.modalEvent.feedId) ?? (isScratch ? config.timezone : null) : null,
  );
  const feedClockTime = $derived(feedTz ? formatTime(new Date(clock.now), config.timeFormat, feedTz) : '');
  const feedTzLabel = $derived(feedTz ? formatTzDiff(feedTz, config.timezone, new Date(clock.now), config.dst) : '');
  const feedIsDay = $derived(
    feedTz
      ? isDaylight(
          feedTz,
          new Date(clock.now),
          dayLimitMinutes(config.morningLimit, 8 * 60),
          dayLimitMinutes(config.eveningLimit, 20 * 60),
        )
      : true,
  );

  // The raw text backing the source view is session-only, so it's missing
  // after a reload whose refresh revalidated with 304. Refetch it in the
  // background when an event of that feed is opened; on failure (e.g.
  // offline) the source view simply stays hidden, as it always did before
  // the first successful fetch.
  $effect(() => {
    const ev = ui.modalEvent;
    if (!ev || events.rawTextByFeed[ev.feedId] !== undefined) return;
    const source = config.feeds.find((f) => f.id === ev.feedId)?.source;
    if (!source || source.kind === 'scratchpad') return;
    void fetchFeedText(source)
      .then((text) => {
        events.rawTextByFeed[ev.feedId] = text;
      })
      .catch(() => {});
  });

  function openFeedSettings(feedId: string): void {
    returnEvent = ui.modalEvent;
    ui.settingsScrollToFeedId = feedId;
    ui.settingsAutoEditFeedId = feedId;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  function armDelete(): void {
    pendingDeleteUid = ui.modalEvent?.uid ?? null;
  }

  function commitDelete(): void {
    const uid = pendingDeleteUid;
    pendingDeleteUid = null;
    if (uid) deleteScratchpadEvent(uid);
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      showSource = false;
      swipeStartY = null;
      dismissing = false;
      deleteBtn?.reset();
    }
    if (!ui.modalEvent && dialog.open) {
      deleteBtn?.reset();
      dialog.close();
    }
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
    ui.modalEvent ? matchingRulesFor(ui.modalEvent, config.rules) : ([] as FindReplaceRule[]),
  );

  function styleLabel(s: StyleVariant): string {
    switch (s) {
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
    const uid = ui.modalEvent?.uid;
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
    ui.modalEvent
      ? formatEventDateInfo(
          ui.modalEvent,
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

  function highlightFinds(
    text: string,
    rules: FindReplaceRule[],
  ): { text: string; hit: boolean }[] {
    const finds = rules.map((r) => r.find).filter((f) => f.length > 0);
    if (finds.length === 0) return [{ text, hit: false }];
    const out: { text: string; hit: boolean }[] = [];
    let i = 0;
    while (i < text.length) {
      let nextIdx = -1;
      let nextLen = 0;
      for (const f of finds) {
        const idx = text.indexOf(f, i);
        if (idx === -1) continue;
        if (nextIdx === -1 || idx < nextIdx || (idx === nextIdx && f.length > nextLen)) {
          nextIdx = idx;
          nextLen = f.length;
        }
      }
      if (nextIdx === -1) {
        out.push({ text: text.slice(i), hit: false });
        break;
      }
      if (nextIdx > i) out.push({ text: text.slice(i, nextIdx), hit: false });
      out.push({ text: text.slice(nextIdx, nextIdx + nextLen), hit: true });
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
    {@const ev = ui.modalEvent}
    {@const rawVevent = events.rawTextByFeed[ev.feedId] ? extractRawVevent(events.rawTextByFeed[ev.feedId]!, ev.uid) : null}
    {@const raw = rawVevent ? wrapVeventInCalendar(rawVevent) : (isScratch ? buildIcs(ev) : null)}
    <article class:locked>
      <header>
        <h2 class="modal-title">{ev.displayTitle}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      {#if showSource}
        {#if feed}
          <div class="cal-row">
            <button
              type="button"
              class="cal-link"
              onclick={() => openFeedSettings(feed.id)}
              title="Open this calendar's settings"
            >
              {#if feed.color}<span class="cal-swatch" data-cal-color={feed.color}></span>{/if}
              <span class="cal-name">{feed.name}</span>
            </button>
            {#if feedTz}
              <span class="cal-tz" data-mono>
                <Icon name={feedIsDay ? 'sun' : 'moon'} size={12} />
                <span>{feedClockTime}</span>
                {#if feedTzLabel}<span class="cal-tz-offset">({feedTzLabel})</span>{/if}
              </span>
            {/if}
          </div>
        {/if}
        {#if raw}
          <div class="raw-block">
            <pre><code>{#each highlightFinds(raw, matchedRules) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</code></pre>
          </div>
        {/if}
        {#if matchedRules.length > 0}
          <ul class="filter-list">
            {#each matchedRules as rule (rule.id)}
              <li>
                <button type="button" class="filter-row" onclick={() => openRuleInSettings(rule)}>
                  <span class="filter-preview" data-mono>{rule.find} &gt; {rule.replace || '(empty)'}</span>
                  <span
                    class="style-swatch"
                    data-style={rule.style}
                    aria-label={styleLabel(rule.style)}
                    title={styleLabel(rule.style)}
                  >α</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        {@const info = dateInfo ?? { date: '', time: '', duration: '' }}
        <p class="event-info"><time datetime={ev.start.toISOString()}>{info.date}{#if ev.allDay && info.duration}{' · '}{info.duration}{/if}</time></p>
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
              <ConfirmButton
                bind:this={deleteBtn}
                label="Delete"
                variant="delete"
                height={28}
                hpad="12px"
                doneTitle="Tap to undo deletion"
                onArm={armDelete}
                onCommit={commitDelete}
              />
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
            {#if raw}
              <button
                type="button"
                class="raw-toggle"
                aria-pressed={showSource}
                onclick={() => (showSource = !showSource)}
                title={showSource ? 'Hide raw iCal' : 'View raw iCal'}
                aria-label={showSource ? 'Hide raw iCal' : 'View raw iCal'}
              >{'{ }'}</button>
            {/if}
            <button
              type="button"
              class="action-btn"
              onclick={() => void copyText(showSource && raw ? raw : buildDetails(ev), showSource && raw ? 'data' : 'details')}
            >COPY</button>
          </div>
        </footer>
      {/if}
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: var(--border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    padding: 0;
    width: min(600px, calc(100vw - 1rem));
    max-height: calc(100dvh - 2rem);
    overflow: auto;
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
  .cal-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    margin: 0.35em 0 0.15em;
  }
  .cal-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .cal-link:hover .cal-name,
  .cal-link:focus-visible .cal-name {
    text-decoration: underline;
  }
  .cal-name {
    font-size: var(--fs-12);
  }
  .cal-swatch {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border-radius: 2px;
    border: var(--border-w) solid var(--ink);
    box-sizing: border-box;
  }
  .cal-swatch[data-cal-color='peach'] { background: var(--cal-peach-bg); border-color: var(--cal-peach-border); }
  .cal-swatch[data-cal-color='amber'] { background: var(--cal-amber-bg); border-color: var(--cal-amber-border); }
  .cal-swatch[data-cal-color='mint'] { background: var(--cal-mint-bg); border-color: var(--cal-mint-border); }
  .cal-swatch[data-cal-color='teal'] { background: var(--cal-teal-bg); border-color: var(--cal-teal-border); }
  .cal-swatch[data-cal-color='sky'] { background: var(--cal-sky-bg); border-color: var(--cal-sky-border); }
  .cal-swatch[data-cal-color='lavender'] { background: var(--cal-lavender-bg); border-color: var(--cal-lavender-border); }
  .cal-tz {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: var(--fs-11);
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .cal-tz :global(.icon) {
    color: var(--accent);
    filter: var(--clock-halo);
  }
  .cal-tz-offset {
    color: var(--ink-muted);
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
  /* Mini event-label preview: an "α" styled like a pill of the given style. */
  .style-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 16px;
    flex-shrink: 0;
    border: var(--border-w) solid var(--ink);
    background: transparent;
    color: var(--ink);
    box-sizing: border-box;
    font-size: var(--fs-11);
    font-weight: 400;
    line-height: 1;
  }
  .style-swatch[data-style='bold'] {
    border-width: calc(var(--border-w) + 1px);
    font-weight: 700;
  }
  .style-swatch[data-style='inverted'] {
    background: var(--ink);
    color: var(--paper);
    font-weight: 700;
  }
  .style-swatch[data-style='dashed'] {
    border-style: dashed;
  }
  .style-swatch[data-style='muted'] {
    opacity: 0.4;
  }
  .style-swatch[data-style='striked'] {
    text-decoration: line-through;
  }
  .style-swatch[data-style='hidden'] {
    opacity: 0.25;
    filter: grayscale(1);
    text-decoration: line-through;
  }
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
    max-height: 60dvh;
    font-family: var(--mono);
    font-size: var(--fs-11);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .raw-block mark {
    background: var(--ink);
    color: var(--paper);
  }
</style>
