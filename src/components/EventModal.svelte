<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import LocalBadge from './LocalBadge.svelte';
  import CalendarDownloadMenu from './CalendarDownloadMenu.svelte';
  import CopyIconButton from './CopyIconButton.svelte';
  import { swatchHatch } from '../lib/blocking';
  import { ui, config, events, pushLog, isKiosk, timelineEventsFor, effectiveFeedTz } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
  import { addDays } from '../lib/time';
  import { longPress } from '../lib/haptics';
  import { formatRange, formatTime, zonedDateProxy } from '../lib/format';
  import { makeRule, matchingRulesFor } from '../lib/rules';
  import { formatEventDateInfo, formatEventOwnZone, filterRulePreview, linkifyText, safeHref, titleGlyphs } from '../lib/event-display';
  import { fetchFeedText, feedIdFor } from '../lib/ics';
  import { categoryIcon } from '../lib/icons';
  import { buildIcs } from '../lib/calendar-links';
  import { isInField } from '../lib/keyboard';
  import { isLocalFeedId, type DisplayEvent, type FindReplaceRule, type StyleVariant } from '../lib/types';

  let dialog: HTMLDialogElement | undefined = $state();
  let returnEvent: typeof ui.modalEvent = null;
  // The member (day / copy) an edit was opened on, restored when the editor's
  // Cancel brings the same card back.
  let editReturn: { ev: DisplayEvent; index: number } | null = null;
  let returnShowSource = false;
  let swipeStartY: number | null = null;
  let swipeStartX: number | null = null;
  let dismissing = $state(false);
  // Fallback close for the swipe-dismiss: `close()` normally fires from the
  // transform `transitionend`, but Chrome doesn't reliably dispatch it for the
  // ~0ms transition reduced motion forces — so the modal would hang. This timer
  // guarantees the close; the transitionend still wins the fast path when motion
  // is on (it clears the timer via close()).
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  // Kiosk mode: the modal is view-only — every mutate/export action is disabled.
  const locked = $derived(isKiosk());

  // A merged consecutive-day event is shown one real day at a time (with that
  // day's own unaltered times) and paged through with arrows; a normal event is
  // just itself. `shown` is the event the modal actually renders.
  let memberIndex = $state(0);
  // A merged consecutive-day run pages through its per-day members (spanMembers);
  // an exact-duplicate group (the same event on several feeds) pages through its
  // combined copies (dupMembers). Only one is ever set.
  const memberKind = $derived<'day' | 'copy' | null>(
    ui.modalEvent?.spanMembers ? 'day' : ui.modalEvent?.dupMembers ? 'copy' : null,
  );
  const members = $derived(ui.modalEvent?.spanMembers ?? ui.modalEvent?.dupMembers ?? null);
  const shown = $derived.by(() => {
    const m = ui.modalEvent;
    if (!m) return null;
    if (members && members.length > 1) return members[Math.min(memberIndex, members.length - 1)] ?? m;
    return m;
  });
  // When opening, land on today's day if it's within a consecutive-day run, else
  // the first member (duplicate copies all share a date, so start at the rep).
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

  // Follow the shown member so paging duplicate copies (each a different feed)
  // re-resolves the calendar-scoped chrome for that copy.
  const isScratch = $derived(shown ? isLocalFeedId(shown.feedId) : false);

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

  // Open `next` and reset the per-event view state the open $effect normally
  // seeds — it's guarded by !dialog.open, so it won't re-run while paging.
  function goToEvent(next: DisplayEvent | undefined): void {
    if (!next) return;
    ui.modalEvent = next;
    memberIndex = initialMemberIndex(next);
    ui.modalShowSource = false;
  }

  // Single-step wraps around the ends, matching the feed-lane header.
  function stepEvent(dir: -1 | 1): void {
    if (navIndex < 0 || navList.length === 0) return;
    const nextIdx = (navIndex + dir + navList.length) % navList.length;
    goToEvent(navList[nextIdx]);
  }

  // Long-press jump to the first/last event, matching the feed-lane header.
  function jumpToEndEvent(dir: -1 | 1): void {
    if (navList.length === 0) return;
    goToEvent(navList[dir === 1 ? navList.length - 1 : 0]);
  }

  // Keyboard paging while the modal is open. Left/right first steps the local
  // merged-day pager (spanMembers), spilling over to the overall event nav once
  // it hits an end; up/down go straight to the overall prev/next, skipping the
  // per-day pager.
  function modalArrow(dir: -1 | 1): void {
    if (members && members.length > 1) {
      const atBound = dir === 1 ? memberIndex >= members.length - 1 : memberIndex <= 0;
      if (!atBound) {
        memberIndex += dir;
        return;
      }
    }
    if (navList.length > 1) stepEvent(dir);
  }
  function modalStepEvent(dir: -1 | 1): void {
    if (navList.length > 1) stepEvent(dir);
  }

  let copyBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if (!ui.modalEvent || isInField(e.target)) return;
      switch (e.key) {
        case 'ArrowLeft': modalArrow(-1); break;
        case 'ArrowRight': modalArrow(1); break;
        case 'ArrowUp': modalStepEvent(-1); break;
        case 'ArrowDown': modalStepEvent(1); break;
        // Space toggles the raw iCal view (matching the footer's raw button).
        // Skipped in kiosk, where the toggle is hidden and the modal is view-only.
        case ' ':
          if (locked) return;
          ui.modalShowSource = !ui.modalShowSource;
          break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Press/long-press wiring ported from RowHeader: a plain click steps one
  // event (wrapping); a 500ms hold jumps to the first/last with a haptic and a
  // brief glyph flash. navLongFired suppresses the click that follows the hold.
  const NAV_LONGPRESS_MS = 500;
  const NAV_FLASH_MS = 400;
  let navFlash: 'prev' | 'next' | null = $state(null);
  let navPressTimer: ReturnType<typeof setTimeout> | null = null;
  let navLongFired = false;

  function startNavPress(direction: -1 | 1): void {
    if (navList.length <= 1) return;
    navLongFired = false;
    if (navPressTimer) clearTimeout(navPressTimer);
    navPressTimer = setTimeout(() => {
      navPressTimer = null;
      navLongFired = true;
      longPress();
      jumpToEndEvent(direction);
      navFlash = direction === 1 ? 'next' : 'prev';
      setTimeout(() => {
        if (navFlash === (direction === 1 ? 'next' : 'prev')) navFlash = null;
      }, NAV_FLASH_MS);
    }, NAV_LONGPRESS_MS);
  }

  function cancelNavPress(): void {
    if (navPressTimer) {
      clearTimeout(navPressTimer);
      navPressTimer = null;
    }
  }

  function handleNavClick(direction: -1 | 1): void {
    if (navList.length <= 1) return;
    if (navLongFired) {
      navLongFired = false;
      return;
    }
    stepEvent(direction);
  }

  // Boundary hint: when the focused event is at an end, the next tap wraps —
  // signal it with the fast-forward / rewind glyphs (prev wraps forward to the
  // last event, next wraps back to the first), same as the jump-to-end flash.
  const prevWraps = $derived(navIndex <= 0);
  const nextWraps = $derived(navIndex >= 0 && navIndex >= navList.length - 1);
  // The prev/next glyphs as inline paths (same shapes as src/icons/*.svg), so
  // each arrow can be drawn twice: a page-colour copy stroked 1px wider behind
  // the ink one — a true vector outline (a filter outline on the masked icon
  // came out jagged on the diagonals).
  const NAV_ARROW_PATHS: Record<string, string[]> = {
    'chevron-left': ['M20 24L10 16 20 8z'],
    'chevron-right': ['M12 8l10 8-10 8z'],
    rewind: ['M28 8v16L16 16z', 'M14 8v16L2 16z'],
    'fast-forward': ['M4 8v16l12-8z', 'M18 8v16l12-8z'],
  };
  const prevIcon = $derived(
    navFlash === 'prev' ? 'rewind' : prevWraps ? 'fast-forward' : 'chevron-left',
  );
  const nextIcon = $derived(
    navFlash === 'next' ? 'fast-forward' : nextWraps ? 'rewind' : 'chevron-right',
  );

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
  // Resolve from the shown copy so paging duplicate members updates the feed
  // chip / style swatch / source to the copy you're looking at.
  const feed = $derived(shown ? feedForEvent(shown.feedId) : null);

  // The source view's VEVENT is cut out of the feed text (a scan of the whole
  // feed), so it's only built while the view is open. ics-core brings ical.js,
  // which the parse worker already ships; load the main-thread copy on demand.
  let icsCore = $state<typeof import('../lib/ics-core') | null>(null);
  $effect(() => {
    if (!ui.modalShowSource || icsCore) return;
    void import('../lib/ics-core').then((m) => (icsCore = m));
  });
  const rawSource = $derived.by(() => {
    const ev = shown ?? ui.modalEvent;
    if (!ui.modalShowSource || !ev) return '';
    const text = events.rawTextByFeed[ev.feedId];
    if (!text) return buildIcs(ev);
    if (!icsCore) return '';
    const vevent = icsCore.extractRawVevent(text, ev.uid);
    return vevent ? icsCore.wrapVeventInCalendar(vevent) : buildIcs(ev);
  });

  // The raw text backing the source view is session-only, so it's missing
  // after a reload whose refresh revalidated with 304. Refetch it in the
  // background when an event of that feed is opened; on failure (e.g.
  // offline) the source view simply stays hidden, as it always did before
  // the first successful fetch.
  $effect(() => {
    // Key off the shown copy so paging to another feed's duplicate fetches that
    // feed's text, matching the source view (which reads rawTextByFeed[ev]).
    const ev = shown;
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
    returnShowSource = ui.modalShowSource;
    ui.settingsScrollToFeedId = feedId;
    ui.settingsAutoEditFeedId = feedId;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first button (Close), making Enter dismiss the
      // card — hand focus to COPY instead so Enter copies. In kiosk the footer
      // (and COPY) doesn't render; park focus on the dialog itself then.
      (copyBtn ?? dialog).focus();
      ui.modalShowSource = false;
      swipeStartY = null;
      swipeStartX = null;
      dismissing = false;
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      // Back from editing one day / copy of a merged or duplicate event: open
      // on that member again rather than the default one.
      const back = editReturn;
      editReturn = null;
      memberIndex = back && back.ev === ui.modalEvent ? back.index : initialMemberIndex(ui.modalEvent);
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
      if (wantsSource) queueMicrotask(() => { ui.modalShowSource = true; });
    }
  });

  function addFilterFromEvent(): void {
    if (isKiosk()) return;
    const sel = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() ?? '' : '';
    const newRule = makeRule({ find: sel });
    config.rules = [...config.rules, newRule];
    returnEvent = ui.modalEvent;
    returnShowSource = ui.modalShowSource;
    ui.settingsAutoEditRuleId = newRule.id;
    ui.settingsScrollToRuleId = newRule.id;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  const matchedRules = $derived(
    shown ? matchingRulesFor(shown, config.rules) : ([] as FindReplaceRule[]),
  );
  const rulesApply = $derived(
    matchedRules.length === 1 ? '1 rule applies' : `${matchedRules.length} rules apply`,
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
    returnShowSource = ui.modalShowSource;
    ui.settingsAutoEditRuleId = rule.id;
    ui.settingsScrollToRuleId = rule.id;
    ui.settingsOpen = true;
    ui.modalEvent = null;
  }

  // The dialog's cancel. Escape never gets here (the app's key handler takes
  // it, stepping out of the raw view first, then closing the card, and
  // cancels the keydown), so this is the back gesture on a phone: same step.
  function onCancel(e: Event): void {
    e.preventDefault();
    if (ui.modalShowSource) ui.modalShowSource = false;
    else close();
  }

  function close(): void {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    ui.modalEvent = null;
  }

  // Edit a Draft event: reopen it in the same modal used to create one.
  function editDraft(): void {
    const uid = shown?.uid;
    if (!uid) return;
    ui.addEventReturn = ui.modalEvent;
    editReturn = ui.modalEvent ? { ev: ui.modalEvent, index: memberIndex } : null;
    ui.modalEvent = null;
    ui.addEventEditUid = uid;
    ui.addEventOpen = true;
  }

  // Horizontal swipe distance that pages to the prev/next event. Touch/pen only:
  // on desktop a horizontal mouse drag is a text selection (and the arrows +
  // keyboard already cover navigation there).
  const SWIPE_NAV_PX = 60;

  function onDialogPointerDown(e: PointerEvent): void {
    if (dismissing) return;
    swipeStartY = e.clientY;
    swipeStartX = e.clientX;
  }
  function onDialogPointerUp(e: PointerEvent): void {
    if (swipeStartY == null || swipeStartX == null || dismissing) return;
    const dyUp = swipeStartY - e.clientY;
    const dx = e.clientX - swipeStartX;
    swipeStartY = null;
    swipeStartX = null;
    // Horizontal-dominant swipe navigates; left = next, right = prev (matching
    // ArrowRight = next). Mouse is excluded so drag-to-select still works.
    if (
      e.pointerType !== 'mouse' &&
      Math.abs(dx) > Math.abs(dyUp) &&
      Math.abs(dx) > SWIPE_NAV_PX &&
      navList.length > 1
    ) {
      stepEvent(dx < 0 ? 1 : -1);
      return;
    }
    if (dyUp > 80) startDismiss();
  }
  function onDialogPointerCancel(): void {
    swipeStartY = null;
    swipeStartX = null;
  }
  // Trigger the exit animation and arm the fallback close (see dismissTimer).
  function startDismiss(): void {
    dismissing = true;
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      close();
    }, 200);
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

  // The event's zone and times there, on a line of their own under the local
  // times, when its calendar's zone differs from the display zone
  // ("20:00 — 21:00 JST · Tokyo, JP"; just the zone for an all-day event).
  const ownZoneTime = $derived(
    shown
      ? formatEventOwnZone(shown, shown.tzid ?? effectiveFeedTz(shown.feedId), config.timezone, config.timeFormat)
      : '',
  );

  // Recency of the shown day, mirroring the timeline's day-granular past logic
  // (Row.svelte's isPastEvent): an event running through "now" is never past,
  // otherwise past once it ends before the start of today. "today" covers any
  // event overlapping the current calendar day (an event later today counts).
  const dateState = $derived.by<'past' | 'today' | 'future'>(() => {
    if (!shown) return 'future';
    const startMs = shown.start.getTime();
    const endMs = shown.end.getTime();
    const running = startMs <= clock.now && clock.now < endMs;
    const todayStart = today.value.getTime();
    const tomorrowStart = addDays(today.value, 1).getTime();
    if (!running && endMs < todayStart) return 'past';
    if (running || (startMs < tomorrowStart && endMs >= todayStart)) return 'today';
    return 'future';
  });

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; }, 2000);
    } catch {
      pushLog('Copy failed', 'error');
    }
  }

  function buildDetails(ev: NonNullable<typeof ui.modalEvent>): string {
    const lines: string[] = [ev.displayTitle];
    lines.push(
      formatRange(
        ev.allDay ? ev.start : zonedDateProxy(ev.start, config.timezone),
        ev.allDay ? ev.end : zonedDateProxy(ev.end, config.timezone),
        config.dateFormat,
        config.locale,
      ),
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
  tabindex="-1"
  class:dismissing
  oncancel={onCancel}
  onclose={close}
  onclick={onClick}
  onpointerdown={onDialogPointerDown}
  onpointerup={onDialogPointerUp}
  onpointercancel={onDialogPointerCancel}
  ontransitionend={onDialogTransitionEnd}
>
  {#if ui.modalEvent}
    {@const ev = shown ?? ui.modalEvent}
    {#if dateState === 'today'}<p class="today-tag" aria-hidden="true">{config.locale === 'el' ? 'ΣΗΜΕΡΑ' : 'TODAY'}</p>{/if}
    <article class:locked data-today={dateState === 'today' ? 'true' : null} data-filter={matchedRules.length > 0 ? 'true' : null}>
      <header>
        <h2 class="modal-title">{titleGlyphs(ev.displayTitle)}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      {#if ui.modalShowSource}
        <div class="raw-block">
          <pre><code>{#each highlightFinds(rawSource, matchedRules) as part}{#if part.rule}<mark data-style={part.rule.style} data-cal-color={part.rule.color ?? null}>{part.text}</mark>{:else}{part.text}{/if}{/each}</code></pre>
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
                data-block={swatchHatch(feed.block ?? 'none', feed.style)}
                aria-label={styleLabel(feed.style ?? 'none')}
                title={styleLabel(feed.style ?? 'none')}
              >K</span>
              <span class="filter-preview">{feed.name}</span>
              <span class="feed-badge">
                <LocalBadge linked={feed.source.kind !== 'scratchpad'} />
              </span>
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
                    data-block={swatchHatch(rule.block ?? 'none', rule.style)}
                    aria-label={styleLabel(rule.style)}
                    title={styleLabel(rule.style)}
                  >K</span>
                  <span class="filter-preview">{filterRulePreview(rule)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        {@const info = dateInfo ?? { date: '', time: '', duration: '', weekday: '', multiDay: false }}
        <p class="event-info" data-when={dateState}><time datetime={ev.start.toISOString()}>{info.date}</time>{#if info.weekday && !info.multiDay}<span class="event-dim">{' · '}</span><span class="event-weekday">{info.weekday}</span>{/if}{#if ev.allDay && info.duration}<span class="event-dim">{' · '}{info.duration}</span>{/if}</p>
        {#if info.multiDay && info.weekday}<p class="event-info" data-when={dateState}><span class="event-weekday">{info.weekday}</span></p>{/if}
        {#if info.time}<p class="event-time">{info.time}{#if info.duration}{' · '}{info.duration}{/if}</p>{/if}
        {#if ownZoneTime}<p class="event-time event-own-zone">{ownZoneTime}</p>{/if}
        {#if ev.cancelled}<p class="event-status" data-mono>CANCELLED</p>{/if}
        {#if ev.displayLocation}
          {@const evCategory = ev.category ?? feed?.category}
          {@const travelIconName =
            evCategory === 'travel-local' || evCategory === 'travel-international'
              ? categoryIcon(evCategory)
              : null}
          <p class="event-info event-location">
            {#if travelIconName}<Icon name={travelIconName} size={12} />{/if}{ev.displayLocation}
          </p>
        {/if}
        {#if ev.displayDescription}<p class="desc">{@html linkifyText(ev.displayDescription)}</p>{/if}
        {#if ev.url}{@const sourceHref = safeHref(ev.url)}{#if sourceHref}<p class="source-link"><a href={sourceHref} target="_blank" rel="noopener noreferrer nofollow">Open source</a></p>{/if}{/if}
      {/if}
      {#if !locked}
        <footer class="modal-footer">
          <!-- Raw, edit (and + Rule while raw is open) on the left; download
               and copy on the right. The raw button carries the number of
               rules applying to the event in place of its #. -->
          <div class="source-slot">
            <button
              type="button"
              class="raw-toggle"
              data-filter={matchedRules.length > 0 ? 'true' : null}
              aria-pressed={ui.modalShowSource}
              onclick={() => (ui.modalShowSource = !ui.modalShowSource)}
              title={(ui.modalShowSource ? 'Hide raw iCal' : 'View raw iCal') + (matchedRules.length ? ` · ${rulesApply}` : '')}
              aria-label={(ui.modalShowSource ? 'Hide raw iCal' : 'View raw iCal') + (matchedRules.length ? `, ${rulesApply}` : '')}
            >
              {#if matchedRules.length > 0}
                <svg class="raw-count" viewBox="0 0 32 32" width="16" height="16" aria-hidden="true">
                  <path d="M28,13V8a2.0023,2.0023,0,0,0-2-2H23V8h3v5a3.9756,3.9756,0,0,0,1.3823,3A3.9756,3.9756,0,0,0,26,19v5H23v2h3a2.0023,2.0023,0,0,0,2-2V19a2.0023,2.0023,0,0,1,2-2V15A2.0023,2.0023,0,0,1,28,13Z" />
                  <path d="M6,13V8H9V6H6A2.0023,2.0023,0,0,0,4,8v5a2.0023,2.0023,0,0,1-2,2v2a2.0023,2.0023,0,0,1,2,2v5a2.0023,2.0023,0,0,0,2,2H9V24H6V19a3.9756,3.9756,0,0,0-1.3823-3A3.9756,3.9756,0,0,0,6,13Z" />
                  <text x="16" y="16" text-anchor="middle" dominant-baseline="central" font-size={matchedRules.length > 9 ? 12 : 17}>{matchedRules.length}</text>
                </svg>
              {:else}
                <Icon name="parameter" size={16} />
              {/if}
            </button>
            {#if isScratch && !ui.modalShowSource}
              <button type="button" class="action-btn" onclick={editDraft}>EDIT</button>
            {/if}
            {#if ui.modalShowSource}
              <button type="button" class="action-btn add-filter-btn" onclick={addFilterFromEvent}
              >+ Rule</button>
            {/if}
          </div>
          <div class="copy-slot">
            {#if !ui.modalShowSource}
              <CalendarDownloadMenu events={[ev]} />
            {/if}
            <CopyIconButton
              bind:el={copyBtn}
              {copied}
              label={ui.modalShowSource ? 'Copy raw iCal' : 'Copy event details'}
              onclick={() => void copyText(ui.modalShowSource ? rawSource : buildDetails(ev))}
            />
          </div>
        </footer>
      {/if}
    </article>
    {#snippet navArrow(name: string, size = 28)}
      <svg class="nav-arrow" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        {#each NAV_ARROW_PATHS[name] ?? [] as d (d)}<path class="nav-arrow-back" {d} />{/each}
        {#each NAV_ARROW_PATHS[name] ?? [] as d (d)}<path {d} />{/each}
      </svg>
    {/snippet}
    {#if members && members.length > 1}
      <!-- Outlined like the side arrows (and the counter with them), so all of
           it reads on the darkened backdrop. -->
      <nav class="member-nav" data-mono aria-label={memberKind === 'copy' ? 'Switch copy' : 'Switch day'}>
        <button
          type="button"
          class="member-btn"
          aria-label={memberKind === 'copy' ? 'Previous copy' : 'Previous day'}
          title={memberKind === 'copy' ? 'Previous copy' : 'Previous day'}
          onclick={() => (memberIndex = (memberIndex - 1 + members.length) % members.length)}
        >{@render navArrow('chevron-left', 22)}</button>
        <span class="member-pos">{memberIndex + 1}/{members.length}</span>
        <button
          type="button"
          class="member-btn"
          aria-label={memberKind === 'copy' ? 'Next copy' : 'Next day'}
          title={memberKind === 'copy' ? 'Next copy' : 'Next day'}
          onclick={() => (memberIndex = (memberIndex + 1) % members.length)}
        >{@render navArrow('chevron-right', 22)}</button>
      </nav>
    {/if}
    {#if navList.length > 1}
      <button
        class="event-nav event-nav-prev"
        aria-label="Previous event (long-press for earliest)"
        onpointerdown={() => startNavPress(-1)}
        onpointerup={cancelNavPress}
        onpointercancel={cancelNavPress}
        onpointerleave={cancelNavPress}
        onclick={() => handleNavClick(-1)}
      >
        {@render navArrow(prevIcon)}
      </button>
      <button
        class="event-nav event-nav-next"
        aria-label="Next event (long-press for latest)"
        onpointerdown={() => startNavPress(1)}
        onpointerup={cancelNavPress}
        onpointercancel={cancelNavPress}
        onpointerleave={cancelNavPress}
        onclick={() => handleNavClick(1)}
      >
        {@render navArrow(nextIcon)}
      </button>
    {/if}
  {/if}
</dialog>

<style>
  dialog {
    /* Prev/next arrows sit in the side gutters, outside the card border: each
       gutter is just the arrow plus a small gap to the card and to the screen
       edge, so the card itself gets the rest of the width. */
    --nav-w: 28px;
    --nav-gap: 4px;
    --nav-edge: 6px;
    /* Transparent wrapper: the bordered card is the <article>, the day-nav
       floats below it (outside the card border), both centred. */
    border: none;
    background: none;
    color: var(--ink-color);
    padding: 0;
    /* Capped so description lines stay readable on very wide screens. */
    width: min(900px, calc(100vw - 2 * (var(--nav-w) + var(--nav-gap) + var(--nav-edge))));
    max-height: calc(100dvh - 2rem);
    overflow: visible;
    overscroll-behavior: contain;
    box-sizing: border-box;
    /* Reserve horizontal drags for the prev/next swipe (so Chrome delivers them
       as pointer events instead of claiming them for scroll); vertical still
       scrolls the card and drives the swipe-up dismiss. */
    touch-action: pan-y;
    transition: transform 150ms ease-in, opacity 150ms ease-in;
  }
  dialog.dismissing {
    transform: translateY(-100vh);
    opacity: 0;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
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
    border: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    box-sizing: border-box;
    overflow: auto;
    overscroll-behavior: contain;
    /* Cap the card so it scrolls and leaves room for the nav below it. */
    max-height: calc(100dvh - 5rem);
  }
  /* A today event is flagged with a heavier accent card border and an accent title. */
  /* A today event: a page-colour outline round the card's border, for
     contrast against the backdrop, and TODAY over its top edge. */
  article[data-today='true'] {
    outline: 1px solid var(--paper-color);
  }
  /* Filters matched: the pills' rounded bottom-left corner (global.css), at
     three times the radius — the card is far larger than a pill, so the pill's
     radius would barely read here. The RAW button keeps the pill's. */
  article[data-filter='true'] {
    border-bottom-left-radius: calc(var(--filter-radius) * 3) !important;
  }
  .today-tag {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin: 0 0 0.3em;
    font-family: var(--mono);
    font-size: var(--fs-12);
    letter-spacing: 0.08em;
    color: var(--on-backdrop-color);
    filter: var(--backdrop-halo);
    pointer-events: none;
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
    font-family: var(--title-font);
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
    color: var(--ink-color);
  }
  .member-pos {
    color: var(--on-backdrop-color);
    min-width: 2.4em;
    text-align: center;
    font-size: var(--fs-12);
    filter: var(--backdrop-halo);
  }
  .member-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-color);
    cursor: pointer;
  }
  .member-btn:hover,
  .member-btn:active {
    color: var(--accent-color);
  }
  .member-btn:focus-visible {
    color: var(--link-color);
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
    width: var(--nav-w);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-color);
    cursor: pointer;
    z-index: 1;
  }
  /* The arrow in the current colour over a page-colour copy of itself, grown
     1px on every side by a round-joined stroke (2px wide, centred on the edge)
     — a smooth outline that keeps the ink arrow legible over the backdrop. */
  .nav-arrow {
    overflow: visible;
  }
  .nav-arrow path {
    fill: currentColor;
  }
  .nav-arrow path.nav-arrow-back {
    fill: var(--paper-color);
    stroke: var(--paper-color);
    stroke-width: 2px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .event-nav-prev {
    right: calc(100% + var(--nav-gap));
  }
  .event-nav-next {
    left: calc(100% + var(--nav-gap));
  }
  .event-nav:not(:disabled):hover,
  .event-nav:not(:disabled):active {
    color: var(--accent-color);
  }
  .event-nav:disabled {
    opacity: 0.28;
    cursor: default;
    /* Let a tap on a faded side fall through to the backdrop (close the modal)
       instead of being a dead zone. */
    pointer-events: none;
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
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  /* Hover cue is the accent text/icon tint from the global button:hover rule — no fill. */
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
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
  }
  /* The rule count drawn between the braces, in the button's colour. */
  .raw-count path,
  .raw-count text {
    fill: currentColor;
  }
  .raw-count text {
    font-family: var(--mono);
    font-weight: 700;
  }
  /* Rules apply: the same rounded bottom-left corner as the event's pill. */
  .raw-toggle[data-filter='true'] {
    border-bottom-left-radius: var(--filter-radius);
  }
  /* Persistent "showing source" state keeps the inverted fill; hover is just the accent tint. */
  .raw-toggle[aria-pressed='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .event-info {
    margin: 0.1em 0;
  }
  /* Past dates fade to the same subdued ink as the time line (the weekday hard-
     codes full ink below, so override it here too). Today and future dates keep
     the default full-strength ink — a today event is signalled by the card's
     outline and TODAY tag instead. */
  .event-info[data-when='past'],
  .event-info[data-when='past'] .event-weekday {
    color: var(--ink-muted);
  }
  /* Localized weekday beside/under the date — ink and non-mono so the day name
     reads as prominently as the date next to the mono numerals. */
  .event-weekday {
    color: var(--ink-color);
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
  .event-status {
    font-family: var(--mono);
    font-size: 0.8em;
    letter-spacing: 0.04em;
    color: var(--ink-muted);
    margin: 0.1em 0;
  }
  .event-time {
    font-family: var(--mono);
    font-size: 0.9em;
    color: var(--ink-muted);
    margin: 0.1em 0;
  }
  /* The event's own-zone line reads as a second clock, a step quieter. */
  .event-own-zone {
    color: var(--ink-faint);
  }
  .filter-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Thin divider between the feed header and the filters, only when a feed
     precedes the list (feed always renders; filters are optional). */
  .filter-list.has-feed {
    border-top: var(--border-w) solid var(--ink-color);
  }
  .filter-list li + li {
    border-top: var(--border-w) solid var(--ink-color);
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.6em;
    width: 100%;
    /* No left padding: the K swatch's own margin (its hatch ring) is the only
       left inset, so it sits flush with the raw block's left edge. */
    padding: 0.4em 0.6em 0.4em 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-size: var(--fs-12);
  }
  /* Hover cue is the accent text tint from the global button:hover rule — no fill. */
  .filter-preview {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Local/synced badge pinned to the right of the feed chip (the growing
     .filter-preview above pushes it there). */
  .feed-badge {
    flex: none;
    display: inline-flex;
    align-items: center;
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
    border: var(--border-w) solid var(--ink-color);
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
    background: var(--ink-color);
    color: var(--paper-color);
    padding: 0 0.1em;
  }
  .raw-block mark[data-style="outline"],
  .raw-block mark[data-style="dashed"],
  .raw-block mark[data-style="muted"],
  .raw-block mark[data-style="striked"],
  .raw-block mark[data-style="hidden"] {
    background: transparent;
    color: inherit;
    outline: var(--border-w) solid var(--ink-color);
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
  .raw-block mark[data-cal-color="peach"] { background: var(--cal-peach-bg); color: var(--ink-color); outline-color: var(--cal-peach-border); }
  .raw-block mark[data-cal-color="amber"] { background: var(--cal-amber-bg); color: var(--ink-color); outline-color: var(--cal-amber-border); }
  .raw-block mark[data-cal-color="mint"] { background: var(--cal-mint-bg); color: var(--ink-color); outline-color: var(--cal-mint-border); }
  .raw-block mark[data-cal-color="teal"] { background: var(--cal-teal-bg); color: var(--ink-color); outline-color: var(--cal-teal-border); }
  .raw-block mark[data-cal-color="sky"] { background: var(--cal-sky-bg); color: var(--ink-color); outline-color: var(--cal-sky-border); }
  .raw-block mark[data-cal-color="lavender"] { background: var(--cal-lavender-bg); color: var(--ink-color); outline-color: var(--cal-lavender-border); }
</style>
