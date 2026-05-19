<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, addScratchpadEvent } from '../lib/state.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let dismissing = $state(false);
  let swipeStartY: number | null = null;

  let title = $state('');
  let startDate = $state('');
  let startTime = $state('');
  let endDate = $state('');
  let endTime = $state('');
  let allDay = $state(false);
  let location = $state('');
  let description = $state('');
  let formError: string | null = $state(null);

  function pad(n: number): string {
    return n < 10 ? '0' + n : String(n);
  }

  function dateInputValue(d: Date): string {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function timeInputValue(d: Date): string {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function nextHalfHour(d: Date): Date {
    const next = new Date(d);
    next.setSeconds(0, 0);
    const m = next.getMinutes();
    next.setMinutes(m < 30 ? 30 : 60);
    return next;
  }

  function prefill(): void {
    const base = ui.tempMarkerMs != null ? new Date(ui.tempMarkerMs) : new Date();
    let start: Date;
    if (ui.tempMarkerMs != null) {
      start = new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 9, 0, 0, 0);
    } else {
      start = nextHalfHour(base);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    startDate = dateInputValue(start);
    startTime = timeInputValue(start);
    endDate = dateInputValue(end);
    endTime = timeInputValue(end);
    title = '';
    location = '';
    description = '';
    allDay = false;
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

  function parseLocal(date: string, time: string): Date | null {
    if (!date) return null;
    const [y, m, d] = date.split('-').map((s) => parseInt(s, 10));
    if (!y || !m || !d) return null;
    if (allDay) return new Date(y, m - 1, d, 0, 0, 0, 0);
    const [hh, mm] = (time || '00:00').split(':').map((s) => parseInt(s, 10));
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  }

  function save(e: Event): void {
    e.preventDefault();
    formError = null;
    const start = parseLocal(startDate, startTime);
    if (!start) {
      formError = 'Start date is required.';
      return;
    }
    let end = parseLocal(endDate || startDate, endTime);
    if (!end) end = new Date(start.getTime() + (allDay ? 86_400_000 : 60 * 60 * 1000));
    if (allDay) {
      const endDay = new Date(end);
      endDay.setHours(0, 0, 0, 0);
      if (endDay.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + 86_400_000);
      } else {
        end = new Date(endDay.getTime() + 86_400_000);
      }
    } else if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    const cleanTitle = title.trim() || 'Untitled';
    addScratchpadEvent({
      title: cleanTitle,
      start,
      end,
      allDay,
      location: location.trim(),
      description: description.trim(),
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
    <header>
      <h2 class="modal-title">New event</h2>
      <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
    </header>
    <form onsubmit={save}>
      <div class="field">
        <label for="add-title">Title</label>
        <input id="add-title" type="text" bind:value={title} data-add-title placeholder="What's happening?" />
      </div>
      <div class="field">
        <label for="add-allday">All-day</label>
        <input id="add-allday" type="checkbox" bind:checked={allDay} />
      </div>
      <div class="field">
        <label for="add-start-date">Start</label>
        <div class="date-time">
          <input id="add-start-date" type="date" bind:value={startDate} required />
          {#if !allDay}
            <input type="time" bind:value={startTime} />
          {/if}
        </div>
      </div>
      <div class="field">
        <label for="add-end-date">End</label>
        <div class="date-time">
          <input id="add-end-date" type="date" bind:value={endDate} />
          {#if !allDay}
            <input type="time" bind:value={endTime} />
          {/if}
        </div>
      </div>
      <div class="field">
        <label for="add-location">Location</label>
        <input id="add-location" type="text" bind:value={location} placeholder="Optional" />
      </div>
      <div class="field">
        <label for="add-description">Notes</label>
        <textarea id="add-description" bind:value={description} rows="3" placeholder="Optional"></textarea>
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
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5em;
    padding-bottom: 0.5em;
    margin-bottom: 0.5em;
  }
  .modal-title {
    flex: 1 1 auto;
    margin: 0;
    font-size: 1.15em;
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
    font-size: 13px;
    color: var(--ink);
    user-select: none;
  }
  .field input[type='text'],
  .field input[type='date'],
  .field input[type='time'],
  .field textarea {
    width: 100%;
    box-sizing: border-box;
  }
  .field input[type='checkbox'] {
    justify-self: start;
    width: 18px;
    height: 18px;
  }
  .date-time {
    display: flex;
    gap: 0.4em;
  }
  .date-time input[type='date'] {
    flex: 1 1 auto;
  }
  .date-time input[type='time'] {
    flex: 0 0 auto;
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
