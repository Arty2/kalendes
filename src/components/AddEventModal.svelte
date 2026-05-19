<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, addScratchpadEvent } from '../lib/state.svelte';
  import { FEED_CATEGORIES, type FeedCategory } from '../lib/types';

  let dialog: HTMLDialogElement | undefined = $state();
  let dismissing = $state(false);
  let swipeStartY: number | null = null;

  let title = $state('');
  let startDate = $state('');
  let startTime = $state('');
  let endDate = $state('');
  let endTime = $state('');
  let allDay = $state(true);
  let location = $state('');
  let description = $state('');
  let category = $state<FeedCategory>('none');
  let formError: string | null = $state(null);

  function pad(n: number): string {
    return n < 10 ? '0' + n : String(n);
  }

  function timeInputValue(d: Date): string {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function isoDateValue(d: Date): string {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function nextHalfHour(d: Date): Date {
    const next = new Date(d);
    next.setSeconds(0, 0);
    const m = next.getMinutes();
    next.setMinutes(m < 30 ? 30 : 60);
    return next;
  }

  function prefill(): void {
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
    formError = null;
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.addEventOpen && !dialog.open) {
      prefill();
      dialog.showModal();
      dismissing = false;
      swipeStartY = null;
      queueMicrotask(() => {
        dialog?.querySelector<HTMLInputElement>('input[data-add-title]')?.focus();
      });
    }
    if (!ui.addEventOpen && dialog.open) dialog.close();
  });

  function close(): void {
    ui.addEventOpen = false;
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
    addScratchpadEvent({
      title: cleanTitle,
      start,
      end,
      allDay,
      location: location.trim(),
      description: description.trim(),
      category,
    });
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
    none: 'Untagged',
    events: 'Events',
    holidays: 'Holidays',
    observances: 'Observances',
    guests: 'Guests',
    announcements: 'Announcements',
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
      <div class="field">
        <span class="field-label">When</span>
        <div class="segmented" role="radiogroup" aria-label="Event kind">
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={allDay}
            onclick={() => (allDay = true)}
          >All Day</button>
          <button
            type="button"
            class="segmented-btn"
            role="radio"
            aria-checked={!allDay}
            onclick={() => (allDay = false)}
          >Appointment</button>
        </div>
      </div>
      <div class="field">
        <label for="add-start-date">Date</label>
        <div class="row-2col">
          <input
            id="add-start-date"
            type="date"
            bind:value={startDate}
            aria-label="Start date"
            required
          />
          <input
            type="date"
            bind:value={endDate}
            aria-label="End date"
          />
        </div>
      </div>
      {#if !allDay}
        <div class="field">
          <label for="add-start-time">Time</label>
          <div class="row-2col">
            <input id="add-start-time" type="time" bind:value={startTime} aria-label="Start time" />
            <input type="time" bind:value={endTime} aria-label="End time" />
          </div>
        </div>
      {/if}
      <div class="field">
        <label for="add-category">Category</label>
        <select id="add-category" bind:value={category}>
          {#each FEED_CATEGORIES as c (c)}
            <option value={c}>{categoryLabels[c]}</option>
          {/each}
        </select>
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
        <button type="button" class="action-btn" onclick={close}>Cancel</button>
        <button type="submit" class="action-btn primary">Save</button>
      </footer>
    </form>
  </article>
</dialog>

<style>
  dialog {
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    padding: 0;
    width: min(520px, calc(100vw - 1rem));
    max-height: calc(100dvh - 2rem);
    overflow: auto;
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
  .field label,
  .field .field-label {
    font-size: 13px;
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
    font-size: 12px;
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
  .action-btn {
    height: 28px;
    padding: 0 12px;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .action-btn.primary {
    background: var(--ink);
    color: var(--paper);
  }
  .error {
    margin: 0;
    color: var(--accent);
    font-size: 12px;
  }
  @media (max-width: 480px) {
    .field {
      grid-template-columns: 1fr;
    }
  }
</style>
