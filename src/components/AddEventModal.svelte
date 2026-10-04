<script lang="ts">
  import IconButton from './IconButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import { ui, config, addScratchpadEvent, updateScratchpadEvent, deleteScratchpadEvent, localEventForEdit } from '../lib/state.svelte';
  import { FEED_CATEGORIES, SCRATCHPAD_FEED_ID, type FeedCategory } from '../lib/types';
  import { errorBuzz } from '../lib/haptics';
  import { parseQuickAdd, quickTitle, hasQuickFields, type QuickAdd, type QuickKind } from '../lib/quick-add';
  import { formatDate, resolveLocalTz, zonedParts } from '../lib/format';
  import { zonedWallToInstant } from '../lib/event-drag';
  import { isValidTimezone } from '../lib/recurrence';
  import { dateOrderFor } from '../lib/date-words';

  let dialog: HTMLDialogElement | undefined = $state();
  let dismissing = $state(false);
  let swipeStartY: number | null = null;
  let deleteBtn: ConfirmButton | undefined = $state();
  let saveBtn: HTMLButtonElement | undefined = $state();
  let cancelBtn: HTMLButtonElement | undefined = $state();
  // Latch the edited uid so the deferred delete still targets the right event
  // if the modal is closed or reopened while the undo cooldown is up.
  let pendingDeleteUid: string | null = null;

  let title = $state('');
  let startDate = $state('');
  let startTime = $state('');
  let endDate = $state('');
  let endTime = $state('');
  let allDay = $state(true);
  let location = $state('');
  let description = $state('');
  let category = $state<FeedCategory>('none');
  // A repeating event (from an .ics import) keeps its rule through an edit;
  // the form has no repeat picker of its own yet. `seriesTz` is the zone a
  // timed series repeats in: the edited series' own, else the display zone
  // the form's times are read on (formTz).
  let keptRule = '';
  let seriesTz = $state('UTC');
  // The form reads and writes times on the display zone — the one the grid,
  // the pills and the event card show — so a slot drawn in 1W reads back as
  // drawn, and the event lands where its times say.
  const formTz = $derived(config.timezone === 'local' ? resolveLocalTz() : config.timezone);
  let editingSeries = $state(false);
  // Which local lane a newly created event lands in (Draft by default). Only
  // shown when more than one local calendar exists; edits keep their own lane.
  let targetFeedId = $state(SCRATCHPAD_FEED_ID);
  const localLanes = $derived(config.feeds.filter((f) => f.source.kind === 'scratchpad'));
  let formError: string | null = $state(null);
  // Track the start values before a change so we can preserve the duration
  // when the start moves past the end.
  let prevStartDate = '';
  let prevStartTime = '';

  // Typed quick entry (new events only): the title is read for a date, a time
  // or range and an @location, which fill those fields live; Save drops the
  // words it applied from the title. A field set by hand stops following the
  // title, and the title keeps that field's words. `base` is the form as it
  // opened, restored when a typed word goes away again.
  let base = { startDate: '', endDate: '', startTime: '', endTime: '', allDay: true, location: '' };
  let touched = $state(new Set<QuickKind>());
  function touch(kind: QuickKind): void {
    if (!touched.has(kind)) touched = new Set(touched).add(kind);
  }
  function captureBase(): void {
    base = { startDate, endDate, startTime, endTime, allDay, location };
    touched = new Set();
  }
  const quick = $derived.by<QuickAdd | null>(() => {
    if (ui.addEventEditUid || !title.trim()) return null;
    // Typed dates ("today", "fri") count from today on the form's clock.
    const now = zonedParts(new Date(), formTz);
    const q = parseQuickAdd(title, Date.UTC(now.y, now.m - 1, now.d), dateOrderFor(config.dateFormat));
    return hasQuickFields(q) ? q : null;
  });
  // The kinds the form is taking from the title right now.
  const quickApplied = $derived.by<Set<QuickKind>>(() => {
    const out = new Set<QuickKind>();
    if (!quick) return out;
    if (quick.date != null && !touched.has('date')) out.add('date');
    if (quick.start != null && !touched.has('time')) out.add('time');
    if (quick.location != null && !touched.has('location')) out.add('location');
    return out;
  });
  const quickHint = $derived.by<string | null>(() => {
    if (!quick || quickApplied.size === 0) return null;
    const parts = [quickTitle(quick, quickApplied)];
    if (quickApplied.has('date') && quick.date != null) parts.push(formatDate(new Date(quick.date), config.dateFormat, config.locale));
    if (quickApplied.has('time')) parts.push(hintTime(startTime) + '–' + hintTime(endTime));
    if (quickApplied.has('location') && quick.location) parts.push('@ ' + quick.location);
    return parts.join(' · ');
  });

  // An HH:MM field value in the user's time format, for the preview line.
  function hintTime(value: string): string {
    if (config.timeFormat !== '12h') return value;
    const { hh, mm } = parseTime(value);
    return (hh % 12 || 12) + (mm ? ':' + pad(mm) : '') + (hh < 12 ? 'am' : 'pm');
  }

  function clockValue(h: number, m: number): string {
    return pad(h) + ':' + pad(m);
  }
  // Re-derive the quick fields from the title on every keystroke.
  function onTitleInput(): void {
    const q = quick;
    if (!touched.has('date')) {
      startDate = q?.date != null ? isoFromUtcMs(q.date) : base.startDate;
      endDate = q?.date != null ? startDate : base.endDate;
    }
    if (!touched.has('time')) {
      if (q?.start) {
        allDay = false;
        const sMin = q.start.h * 60 + q.start.m;
        const eMin = q.end ? q.end.h * 60 + q.end.m : sMin + (q.minutes ?? 60);
        startTime = clockValue(q.start.h, q.start.m);
        endTime = clockValue(Math.floor(eMin / 60) % 24, eMin % 60);
        // An end at or past midnight lands on the next day — unless the user
        // set the dates by hand, which stay theirs (the end field then flags
        // an end before the start, as for any hand-made range).
        const sp = parseIsoDate(startDate);
        if (!touched.has('date') && sp) {
          endDate = eMin >= 24 * 60 || eMin <= sMin
            ? isoFromUtcMs(Date.UTC(sp.y, sp.m - 1, sp.d) + 86_400_000)
            : startDate;
        }
      } else {
        // No time typed: the form's own kind and times — all-day by default,
        // timed when it was opened from a 1W slot.
        allDay = base.allDay;
        startTime = base.startTime;
        endTime = base.endTime;
      }
    }
    if (!touched.has('location')) location = q?.location ?? base.location;
    prevStartDate = startDate;
    prevStartTime = startTime;
  }

  // Toggle labels reflect the current span.
  const dayCount = $derived.by(() => {
    const a = parseIsoDate(startDate);
    const b = parseIsoDate(endDate || startDate);
    if (!a || !b) return 1;
    const ad = Date.UTC(a.y, a.m - 1, a.d);
    const bd = Date.UTC(b.y, b.m - 1, b.d);
    const n = Math.round((bd - ad) / 86_400_000) + 1;
    return n < 1 ? 1 : n;
  });
  const hourCount = $derived.by(() => {
    const s = parseTime(startTime);
    const e = parseTime(endTime);
    let mins = e.hh * 60 + e.mm - (s.hh * 60 + s.mm);
    if (mins <= 0) mins += 24 * 60;
    const h = mins / 60;
    return Number.isInteger(h) ? h : Math.round(h * 10) / 10;
  });

  // The end must not fall before the start. Flag the offending end field so we
  // can outline it and block Save, rather than silently clamping in save().
  const endDateError = $derived.by(() => {
    const sp = parseIsoDate(startDate);
    const ep = parseIsoDate(endDate);
    if (!sp || !ep) return false;
    const s = Date.UTC(sp.y, sp.m - 1, sp.d);
    const e = Date.UTC(ep.y, ep.m - 1, ep.d);
    return e < s;
  });
  const endTimeError = $derived.by(() => {
    if (allDay) return false;
    const sp = parseIsoDate(startDate);
    const ep = parseIsoDate(endDate || startDate);
    if (!sp || !ep) return false;
    // Times only decide the order when start and end land on the same day.
    if (Date.UTC(ep.y, ep.m - 1, ep.d) !== Date.UTC(sp.y, sp.m - 1, sp.d)) return false;
    const s = parseTime(startTime);
    const e = parseTime(endTime);
    return e.hh * 60 + e.mm <= s.hh * 60 + s.mm;
  });
  const durationInvalid = $derived(endDateError || endTimeError);

  // Transient shake on the field(s) in error; the dashed outline persists while
  // invalid. Both are neutralized under reduced motion by the global CSS.
  let shakeDate = $state(false);
  let shakeTime = $state(false);
  function flagDurationError(): void {
    errorBuzz();
    if (endDateError) { shakeDate = false; requestAnimationFrame(() => requestAnimationFrame(() => { shakeDate = true; })); }
    if (endTimeError) { shakeTime = false; requestAnimationFrame(() => requestAnimationFrame(() => { shakeTime = true; })); }
  }
  // Fire the buzz + shake when the user commits an end that precedes the start.
  function onEndDateChange(): void {
    touch('date');
    if (durationInvalid) flagDurationError();
  }
  function onEndTimeChange(): void {
    touch('time');
    if (durationInvalid) flagDurationError();
  }

  function isoFromUtcMs(ms: number): string {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  // Keep the end date sensible as the start moves. A single-day event (end matched
  // the previous start) stays single-day — the end follows the start in both
  // directions instead of silently becoming a multi-day span. A multi-day event
  // keeps its own end, only pushed out (preserving the span) if the start passes it.
  function onStartDateChange(): void {
    touch('date');
    const ns = parseIsoDate(startDate);
    const e = parseIsoDate(endDate);
    if (ns && e) {
      const wasSingleDay = prevStartDate !== '' && prevStartDate === endDate;
      if (wasSingleDay) {
        endDate = startDate;
      } else {
        const nsMs = Date.UTC(ns.y, ns.m - 1, ns.d);
        const eMs = Date.UTC(e.y, e.m - 1, e.d);
        if (nsMs > eMs) {
          const os = parseIsoDate(prevStartDate);
          let gap = 0;
          if (os) {
            const osMs = Date.UTC(os.y, os.m - 1, os.d);
            gap = Math.max(0, Math.round((eMs - osMs) / 86_400_000));
          }
          endDate = isoFromUtcMs(nsMs + gap * 86_400_000);
        }
      }
    }
    prevStartDate = startDate;
  }
  // Same idea for the time of a single-day event.
  function onStartTimeChange(): void {
    touch('time');
    if (!endDate || endDate === startDate) {
      const s = parseTime(startTime);
      const e = parseTime(endTime);
      const sMin = s.hh * 60 + s.mm;
      const eMin = e.hh * 60 + e.mm;
      if (sMin > eMin) {
        const ps = parseTime(prevStartTime);
        const gap = prevStartTime ? Math.max(0, eMin - (ps.hh * 60 + ps.mm)) : 0;
        const newEnd = Math.min(24 * 60 - 1, sMin + gap);
        endTime = pad(Math.floor(newEnd / 60)) + ':' + pad(newEnd % 60);
      }
    }
    prevStartTime = startTime;
  }

  function pad(n: number): string {
    return n < 10 ? '0' + n : String(n);
  }

  function timeInputValue(d: Date): string {
    const min = zonedParts(d, formTz).minutes;
    return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  }

  function isoDateValue(d: Date): string {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function localIsoDate(d: Date): string {
    const p = zonedParts(d, formTz);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  // Prefill the form from an existing Draft event when editing.
  function prefillFrom(ev: { title: string; location: string; description: string; category?: FeedCategory; allDay: boolean; start: Date; end: Date; rrule?: string; tzid?: string }): void {
    seriesTz = isValidTimezone(ev.tzid) ? ev.tzid : formTz;
    keptRule = ev.rrule ?? '';
    editingSeries = !!ev.rrule;
    title = ev.title;
    location = ev.location;
    description = ev.description;
    category = ev.category ?? 'none';
    allDay = ev.allDay;
    formError = null;
    if (ev.allDay) {
      startDate = isoDateValue(ev.start);
      const lastMs = Math.max(ev.start.getTime(), ev.end.getTime() - 1);
      endDate = isoDateValue(new Date(lastMs));
      const s = nextHalfHour(new Date());
      startTime = timeInputValue(s);
      endTime = timeInputValue(new Date(s.getTime() + 60 * 60 * 1000));
    } else {
      startDate = localIsoDate(ev.start);
      endDate = localIsoDate(ev.end);
      startTime = timeInputValue(ev.start);
      endTime = timeInputValue(ev.end);
    }
    prevStartDate = startDate;
    prevStartTime = startTime;
  }

  // The next :00 or :30 on the form's clock.
  function nextHalfHour(d: Date): Date {
    const minuteMs = Math.floor(d.getTime() / 60_000) * 60_000;
    const m = zonedParts(d, formTz).minutes % 30;
    return new Date(minuteMs + (30 - m) * 60_000);
  }

  function prefill(): void {
    keptRule = '';
    seriesTz = formTz;
    editingSeries = false;
    // Land in the lane the + button preselected (a feed row), else the Draft
    // lane; the picker can still redirect.
    targetFeedId = ui.addEventFeedId ?? SCRATCHPAD_FEED_ID;
    // Clicking an empty 1W slot prefills a timed event at that exact day + time
    // (a local wall-clock instant), taking precedence over the marker/now default.
    if (ui.addEventPrefillStartMs != null) {
      const start = new Date(ui.addEventPrefillStartMs);
      // A drag down the 1W grid sets the end too; a double-click drafts an hour.
      const end = new Date(
        ui.addEventPrefillEndMs != null && ui.addEventPrefillEndMs > start.getTime()
          ? ui.addEventPrefillEndMs
          : start.getTime() + 60 * 60 * 1000,
      );
      startDate = localIsoDate(start);
      endDate = localIsoDate(end);
      startTime = timeInputValue(start);
      endTime = timeInputValue(end);
      title = '';
      location = '';
      description = '';
      allDay = false;
      category = 'none';
      formError = null;
      prevStartDate = startDate;
      prevStartTime = startTime;
      captureBase();
      return;
    }
    // The marked day, else today on the form's clock.
    const now = zonedParts(new Date(), formTz);
    const dayUtc = ui.tempMarkerMs != null
      ? new Date(ui.tempMarkerMs)
      : new Date(Date.UTC(now.y, now.m - 1, now.d));
    const startTimed = ui.tempMarkerMs != null
      ? zonedWallToInstant(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth() + 1, dayUtc.getUTCDate(), 9 * 60, formTz)
      : nextHalfHour(new Date());
    startDate = isoDateValue(dayUtc);
    endDate = startDate;
    startTime = timeInputValue(startTimed);
    endTime = timeInputValue(new Date(startTimed.getTime() + 60 * 60 * 1000));
    title = '';
    location = '';
    description = '';
    allDay = true;
    category = 'none';
    formError = null;
    prevStartDate = startDate;
    prevStartTime = startTime;
    captureBase();
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.addEventOpen && !dialog.open) {
      // An occurrence of a repeating event opens its series.
      const editing = ui.addEventEditUid ? localEventForEdit(ui.addEventEditUid) : null;
      if (editing) prefillFrom(editing);
      else prefill();
      dialog.showModal();
      dismissing = false;
      swipeStartY = null;
      deleteBtn?.reset();
      // A fresh draft starts in the title field; an edit of an existing event
      // starts on Save (Cancel when Save is disabled), so Enter confirms it.
      queueMicrotask(() => {
        if (editing) {
          if (saveBtn && !saveBtn.disabled) saveBtn.focus();
          else cancelBtn?.focus();
        } else {
          dialog?.querySelector<HTMLInputElement>('input[data-add-title]')?.focus();
        }
      });
    }
    if (!ui.addEventOpen && dialog.open) dialog.close();
  });

  // Ctrl/⌘+S saves the open event, mirroring the Save button (works from any
  // field, since the modifier makes it unambiguous).
  $effect(() => {
    if (!ui.addEventOpen || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        save(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Cancel, Close, Escape and the back gesture: an edit opened from an event
  // card goes back to that card.
  function close(): void {
    const back = ui.addEventReturn;
    ui.addEventReturn = null;
    if (back) ui.modalEvent = back;
    ui.addEventOpen = false;
    ui.addEventEditUid = null;
    ui.addEventPrefillStartMs = null;
    ui.addEventPrefillEndMs = null;
    ui.addEventFeedId = null;
  }

  function armDelete(): void {
    pendingDeleteUid = ui.addEventEditUid;
  }

  function commitDelete(): void {
    const uid = pendingDeleteUid;
    pendingDeleteUid = null;
    if (!uid) return;
    deleteScratchpadEvent(uid);
    if (ui.addEventEditUid === uid) {
      ui.addEventReturn = null;
      close();
    }
  }

  function parseTime(t: string): { hh: number; mm: number } {
    const [hh, mm] = (t || '00:00').split(':').map((s) => parseInt(s, 10));
    return { hh: hh || 0, mm: mm || 0 };
  }

  function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
    if (!s) return null;
    const parts = s.split('-').map((p) => parseInt(p, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts as [number, number, number];
    return { y, m, d };
  }

  function save(e: Event): void {
    e.preventDefault();
    formError = null;
    // Enter can still submit past a disabled button — refuse and re-flag.
    if (durationInvalid) {
      flagDurationError();
      return;
    }
    const sp = parseIsoDate(startDate);
    if (!sp) {
      formError = 'Start date is required.';
      return;
    }
    const ep = parseIsoDate(endDate || startDate) ?? sp;
    let start: Date;
    let end: Date;
    if (allDay) {
      start = new Date(Date.UTC(sp.y, sp.m - 1, sp.d));
      const endDay = new Date(Date.UTC(ep.y, ep.m - 1, ep.d));
      if (endDay.getTime() < start.getTime()) {
        end = new Date(start.getTime() + 86_400_000);
      } else {
        end = new Date(endDay.getTime() + 86_400_000);
      }
    } else {
      const { hh: sh, mm: sm } = parseTime(startTime);
      const { hh: eh, mm: em } = parseTime(endTime);
      start = zonedWallToInstant(sp.y, sp.m, sp.d, sh * 60 + sm, formTz);
      end = zonedWallToInstant(ep.y, ep.m, ep.d, eh * 60 + em, formTz);
      if (end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + 60 * 60 * 1000);
      }
    }
    const typed = quick && quickApplied.size > 0 ? quickTitle(quick, quickApplied) : title;
    const cleanTitle = typed.trim() || 'Untitled';
    const rrule = keptRule || undefined;
    const input = {
      title: cleanTitle,
      start,
      end,
      allDay,
      location: location.trim(),
      description: description.trim(),
      category,
      ...(rrule ? { rrule, tzid: seriesTz } : {}),
    };
    if (ui.addEventEditUid) updateScratchpadEvent(ui.addEventEditUid, input);
    else addScratchpadEvent(input, targetFeedId);
    ui.addEventReturn = null; // the card would show the old event
    close();
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

  const categoryLabels: Record<FeedCategory, string> = {
    none: 'N/A',
    events: 'Events',
    holidays: 'Holidays',
    observances: 'Observances',
    guests: 'Guests',
    announcements: 'Announcements',
    'travel-local': 'Travel (Local)',
    'travel-international': 'Travel (International)',
  };
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
  <article>
    <div class="close-corner">
      <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
    </div>
    <form onsubmit={save}>
      <div class="field">
        <label for="add-title">Title</label>
        <input
          id="add-title"
          type="text"
          bind:value={title}
          oninput={onTitleInput}
          data-add-title
          placeholder={ui.addEventEditUid ? undefined : 'Coffee sun 11-12 @Espresso'}
          aria-describedby={quickHint ? 'add-quick-hint' : undefined}
        />
        {#if quickHint}<p id="add-quick-hint" class="quick-hint" data-mono aria-live="polite">→ {quickHint}</p>{/if}
      </div>
      <div class="field field-bare">
        <div class="segmented" role="radiogroup" aria-label="Event kind">
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={allDay}
            onclick={() => { allDay = true; touch('time'); }}
          >{dayCount} Day{dayCount === 1 ? '' : 's'}</button>
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={!allDay}
            onclick={() => { allDay = false; touch('time'); }}
          >{allDay ? 'All day' : `${hourCount} Hour${hourCount === 1 ? '' : 's'}`}</button>
        </div>
      </div>
      <div class="field">
        <label for="add-start-date">Date</label>
        <div class="row-2col">
          <input
            id="add-start-date"
            type="date"
            bind:value={startDate}
            class:from-title={quickApplied.has('date')}
            onchange={onStartDateChange}
            aria-label="Start date"
            required
          />
          <input
            type="date"
            bind:value={endDate}
            onchange={onEndDateChange}
            class:from-title={quickApplied.has('date') || quickApplied.has('time')}
            aria-label="End date"
            class:error-field={endDateError}
            class:shake={shakeDate}
            onanimationend={() => (shakeDate = false)}
            aria-invalid={endDateError}
          />
        </div>
      </div>
      {#if !allDay}
        <div class="field-pair">
          <div class="field">
            <label for="add-start-time">Start</label>
            <input id="add-start-time" type="time" bind:value={startTime} onchange={onStartTimeChange} class:from-title={quickApplied.has('time')} />
          </div>
          <div class="field">
            <label for="add-end-time">End</label>
            <input
              id="add-end-time"
              type="time"
              bind:value={endTime}
              onchange={onEndTimeChange}
              class:from-title={quickApplied.has('time')}
              class:error-field={endTimeError}
              class:shake={shakeTime}
              onanimationend={() => (shakeTime = false)}
              aria-invalid={endTimeError}
            />
          </div>
        </div>
      {/if}
      {#if editingSeries}
        <p class="repeat-hint">A repeating event: changes apply to every repeat. To skip one day, select it and delete it in the tray.</p>
      {/if}
      <div class="field">
        <label for="add-location">Location</label>
        <input id="add-location" type="text" bind:value={location} oninput={() => touch('location')} class:from-title={quickApplied.has('location')} />
      </div>
      <div class="field">
        <label for="add-description">Description</label>
        <textarea id="add-description" bind:value={description} rows="3"></textarea>
      </div>
      <div class="field-pair">
        <div class="field" class:field-wide={!!ui.addEventEditUid || localLanes.length <= 1}>
          <label for="add-type">Type</label>
          <select id="add-type" bind:value={category}>
            {#each FEED_CATEGORIES as c (c)}
              <option value={c}>{categoryLabels[c]}</option>
            {/each}
          </select>
        </div>
        {#if !ui.addEventEditUid && localLanes.length > 1}
          <div class="field">
            <label for="add-lane">Calendar</label>
            <select id="add-lane" bind:value={targetFeedId}>
              {#each localLanes as lane (lane.id)}
                <option value={lane.id}>{lane.name}</option>
              {/each}
            </select>
          </div>
        {/if}
      </div>
      {#if formError}<p class="error">{formError}</p>{/if}
      <footer class="modal-footer">
        {#if ui.addEventEditUid}
          <span class="delete-slot">
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
          </span>
        {/if}
        <button type="button" class="action-btn" bind:this={cancelBtn} onclick={close}>Cancel</button>
        <button type="submit" class="action-btn primary" bind:this={saveBtn} disabled={durationInvalid}>Save</button>
      </footer>
    </form>
  </article>
</dialog>

<style>
  dialog {
    border: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    padding: 0;
    width: min(520px, calc(100vw - 1rem));
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
  }
  .close-corner {
    position: absolute;
    top: 0.4em;
    right: 0.4em;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
  }
  .field {
    display: grid;
    /* Labels always stack above their control (the former mobile layout). */
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 0.6em;
  }
  .quick-hint,
  .repeat-hint {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  .field label {
    font-size: var(--fs-13);
    color: var(--ink-color);
    user-select: none;
  }
  .field input[type='text'],
  .field input[type='date'],
  .field input[type='time'],
  .field select,
  .field textarea,
  .row-2col input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  /* minmax(0, …): a date/time input's intrinsic width would otherwise push
     its track past half the dialog and overflow it. */
  /* Type alone (no Calendar picker) takes the whole row. */
  .field-pair > .field-wide {
    grid-column: 1 / -1;
  }
  .row-2col {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.4em;
  }
  /* A label-less row (the kind toggle) — the control spans the full width. */
  .field-bare {
    grid-template-columns: 1fr;
  }
  /* Two labelled fields side by side (Start/End); each half stacks
     its label above the control, like the single-field rows. */
  .field-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
    padding: 0 0.6em;
    border: var(--btn-border-w) solid var(--ink-color);
    border-radius: 0;
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
  }
  .segmented-btn + .segmented-btn {
    border-left-width: 0;
  }
  .segmented-btn[aria-checked='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5em;
    margin-top: 0.75em;
    padding-top: 0.5em;
  }
  /* Delete sits alone on the left, away from Cancel/Save. */
  .delete-slot {
    margin-right: auto;
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
  }
  .action-btn.primary {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* End date/time that precedes the start: dashed error outline + a shake. */
  /* A field the title's quick entry is filling: accent text and border, still
     editable (typing in it takes it back from the title). */
  .field input.from-title {
    color: var(--accent-color);
    border-color: var(--accent-color);
  }
  .field input.error-field {
    outline: var(--btn-border-w) dashed var(--accent-color);
    outline-offset: 1px;
  }
  .field input.shake {
    animation: field-shake 0.3s ease;
  }
  @keyframes field-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-3px); }
    40% { transform: translateX(3px); }
    60% { transform: translateX(-2px); }
    80% { transform: translateX(2px); }
  }
  .error {
    margin: 0;
    color: var(--accent-color);
    font-size: var(--fs-12);
  }
</style>
