<script lang="ts">
  import IconButton from './IconButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import { ui, events, addScratchpadEvent, updateScratchpadEvent, deleteScratchpadEvent } from '../lib/state.svelte';
  import { FEED_CATEGORIES, TRAVEL_OPTIONS, type FeedCategory, type Travel } from '../lib/types';
  import { errorBuzz } from '../lib/haptics';

  let dialog: HTMLDialogElement | undefined = $state();
  let dismissing = $state(false);
  let swipeStartY: number | null = null;
  let deleteBtn: ConfirmButton | undefined = $state();
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
  let travel = $state<Travel>('none');
  let formError: string | null = $state(null);
  // Track the start values before a change so we can preserve the duration
  // when the start moves past the end.
  let prevStartDate = '';
  let prevStartTime = '';

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
    if (durationInvalid) flagDurationError();
  }
  function onEndTimeChange(): void {
    if (durationInvalid) flagDurationError();
  }

  function isoFromUtcMs(ms: number): string {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  // When the start date passes the end date, push the end date out — keeping a
  // single day if it was a single day, else preserving the day span.
  function onStartDateChange(): void {
    const ns = parseIsoDate(startDate);
    const e = parseIsoDate(endDate);
    if (ns && e) {
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
    prevStartDate = startDate;
  }
  // Same idea for the time of a single-day event.
  function onStartTimeChange(): void {
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
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function isoDateValue(d: Date): string {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function localIsoDate(d: Date): string {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Prefill the form from an existing Draft event when editing.
  function prefillFrom(ev: { title: string; location: string; description: string; category?: FeedCategory; travel?: Travel; allDay: boolean; start: Date; end: Date }): void {
    title = ev.title;
    location = ev.location;
    description = ev.description;
    category = ev.category ?? 'none';
    travel = ev.travel ?? 'none';
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

  function nextHalfHour(d: Date): Date {
    const next = new Date(d);
    next.setSeconds(0, 0);
    const m = next.getMinutes();
    next.setMinutes(m < 30 ? 30 : 60);
    return next;
  }

  function prefill(): void {
    // Clicking an empty 1W slot prefills a timed event at that exact day + time
    // (a local wall-clock instant), taking precedence over the marker/now default.
    if (ui.addEventPrefillStartMs != null) {
      const start = new Date(ui.addEventPrefillStartMs);
      startDate = localIsoDate(start);
      endDate = startDate;
      startTime = timeInputValue(start);
      endTime = timeInputValue(new Date(start.getTime() + 60 * 60 * 1000));
      title = '';
      location = '';
      description = '';
      allDay = false;
      category = 'none';
      travel = 'none';
      formError = null;
      prevStartDate = startDate;
      prevStartTime = startTime;
      return;
    }
    const baseDay = ui.tempMarkerMs != null ? new Date(ui.tempMarkerMs) : new Date();
    const dayUtc = ui.tempMarkerMs != null
      ? new Date(Date.UTC(baseDay.getUTCFullYear(), baseDay.getUTCMonth(), baseDay.getUTCDate()))
      : new Date(Date.UTC(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate()));
    const startTimed = ui.tempMarkerMs != null
      ? new Date(baseDay.getUTCFullYear(), baseDay.getUTCMonth(), baseDay.getUTCDate(), 9, 0, 0, 0)
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
    travel = 'none';
    formError = null;
    prevStartDate = startDate;
    prevStartTime = startTime;
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.addEventOpen && !dialog.open) {
      const editing = ui.addEventEditUid
        ? Object.values(events.byFeed)
            .flat()
            .find((e) => e.uid === ui.addEventEditUid)
        : null;
      if (editing) prefillFrom(editing);
      else prefill();
      dialog.showModal();
      dismissing = false;
      swipeStartY = null;
      deleteBtn?.reset();
      queueMicrotask(() => {
        dialog?.querySelector<HTMLInputElement>('input[data-add-title]')?.focus();
      });
    }
    if (!ui.addEventOpen && dialog.open) dialog.close();
  });

  function close(): void {
    ui.addEventOpen = false;
    ui.addEventEditUid = null;
    ui.addEventPrefillStartMs = null;
  }

  function armDelete(): void {
    pendingDeleteUid = ui.addEventEditUid;
  }

  function commitDelete(): void {
    const uid = pendingDeleteUid;
    pendingDeleteUid = null;
    if (!uid) return;
    deleteScratchpadEvent(uid);
    if (ui.addEventEditUid === uid) close();
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
      start = new Date(sp.y, sp.m - 1, sp.d, sh, sm, 0, 0);
      end = new Date(ep.y, ep.m - 1, ep.d, eh, em, 0, 0);
      if (end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + 60 * 60 * 1000);
      }
    }
    const cleanTitle = title.trim() || 'Untitled';
    const input = {
      title: cleanTitle,
      start,
      end,
      allDay,
      location: location.trim(),
      description: description.trim(),
      category,
      travel,
    };
    if (ui.addEventEditUid) updateScratchpadEvent(ui.addEventEditUid, input);
    else addScratchpadEvent(input);
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
    none: 'Auto',
    events: 'Events',
    holidays: 'Holidays',
    observances: 'Observances',
    guests: 'Guests',
    announcements: 'Announcements',
  };
  // Same labels the calendar settings use for the feed-level travel tag.
  const travelLabels: Record<Travel, string> = {
    none: 'N/A',
    international: 'International',
    local: 'Local',
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
        <input id="add-title" type="text" bind:value={title} data-add-title />
      </div>
      <div class="field field-bare">
        <div class="segmented" role="radiogroup" aria-label="Event kind">
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={allDay}
            onclick={() => (allDay = true)}
          >{dayCount} Day{dayCount === 1 ? '' : 's'}</button>
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={!allDay}
            onclick={() => (allDay = false)}
          >{hourCount} Hour{hourCount === 1 ? '' : 's'}</button>
        </div>
      </div>
      <div class="field">
        <label for="add-start-date">Date</label>
        <div class="row-2col">
          <input
            id="add-start-date"
            type="date"
            bind:value={startDate}
            onchange={onStartDateChange}
            aria-label="Start date"
            required
          />
          <input
            type="date"
            bind:value={endDate}
            onchange={onEndDateChange}
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
            <input id="add-start-time" type="time" bind:value={startTime} onchange={onStartTimeChange} />
          </div>
          <div class="field">
            <label for="add-end-time">End</label>
            <input
              id="add-end-time"
              type="time"
              bind:value={endTime}
              onchange={onEndTimeChange}
              class:error-field={endTimeError}
              class:shake={shakeTime}
              onanimationend={() => (shakeTime = false)}
              aria-invalid={endTimeError}
            />
          </div>
        </div>
      {/if}
      <div class="field-pair">
        <div class="field">
          <label for="add-type">Type</label>
          <select id="add-type" bind:value={category}>
            {#each FEED_CATEGORIES as c (c)}
              <option value={c}>{categoryLabels[c]}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="add-travel">Travel</label>
          <select id="add-travel" bind:value={travel}>
            {#each TRAVEL_OPTIONS as t (t)}
              <option value={t}>{travelLabels[t]}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="add-location">Location</label>
        <input id="add-location" type="text" bind:value={location} />
      </div>
      <div class="field">
        <label for="add-description">Description</label>
        <textarea id="add-description" bind:value={description} rows="3"></textarea>
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
        <button type="button" class="action-btn" onclick={close}>Cancel</button>
        <button type="submit" class="action-btn primary" disabled={durationInvalid}>Save</button>
      </footer>
    </form>
  </article>
</dialog>

<style>
  dialog {
    border: var(--border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
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
    grid-template-columns: 90px 1fr;
    align-items: center;
    gap: 0.6em;
  }
  .field label {
    font-size: var(--fs-13);
    color: var(--ink);
    user-select: none;
  }
  .field input[type='text'],
  .field input[type='date'],
  .field input[type='time'],
  .field select,
  .field textarea {
    width: 100%;
    box-sizing: border-box;
  }
  .row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4em;
  }
  /* A label-less row (the kind toggle) — the control spans the full width. */
  .field-bare {
    grid-template-columns: 1fr;
  }
  /* Two labelled fields side by side (Start/End, Type/Travel). The left field
     keeps the shared 90px label column so its control lines up with the
     single-field rows; the right label sizes to its text. */
  .field-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6em;
  }
  .field-pair .field:last-child {
    grid-template-columns: auto 1fr;
  }
  @media (max-width: 480px) {
    /* Match the single-field stacking: both halves put the label above the
       control, so e.g. Travel stacks exactly like Type next to it. */
    .field-pair .field:last-child {
      grid-template-columns: 1fr;
    }
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
  .segmented-btn[aria-checked='true'] {
    background: var(--ink);
    color: var(--paper);
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
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .action-btn.primary {
    background: var(--ink);
    color: var(--paper);
  }
  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* End date/time that precedes the start: dashed error outline + a shake. */
  .field input.error-field {
    outline: var(--btn-border-w) dashed var(--accent);
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
    color: var(--accent);
    font-size: var(--fs-12);
  }
  @media (max-width: 480px) {
    .field {
      grid-template-columns: 1fr;
    }
  }
</style>
