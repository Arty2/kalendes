<script lang="ts">
  import IconButton from './IconButton.svelte';
  import CalendarDownloadMenu from './CalendarDownloadMenu.svelte';
  import { ui, config, events, pushLog, deleteScratchpadEvent } from '../lib/state.svelte';
  import { formatRange, formatTime } from '../lib/format';
  import { makeRule, matchingRulesFor } from '../lib/rules';
  import { SCRATCHPAD_FEED_ID, type FindReplaceRule, type StyleVariant } from '../lib/types';

  let dialog: HTMLDialogElement | undefined = $state();
  let showSource = $state(false);
  let returnEvent: typeof ui.modalEvent = null;
  let returnShowSource = false;
  let swipeStartY: number | null = null;
  let dismissing = $state(false);
  const CONFIRM_WINDOW_MS = 3000;
  let confirmDelete = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let doneDelete = $state(false);
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  // Latch the event so the actual delete still targets the right uid
  // if ui.modalEvent shifts while the done flash is up.
  let pendingDeleteUid: string | null = null;

  const isScratch = $derived(ui.modalEvent?.feedId === SCRATCHPAD_FEED_ID);

  function clearConfirmTimer(): void {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  function clearDoneTimer(): void {
    if (doneTimer) {
      clearTimeout(doneTimer);
      doneTimer = null;
    }
  }

  function cancelPendingDelete(): void {
    clearConfirmTimer();
    clearDoneTimer();
    confirmDelete = false;
    doneDelete = false;
    pendingDeleteUid = null;
  }

  function onDeleteClick(): void {
    const ev = ui.modalEvent;
    if (!ev) return;
    // Tap on Delete ✓ during the done flash cancels the pending delete.
    if (doneDelete) {
      cancelPendingDelete();
      return;
    }
    if (confirmDelete) {
      clearConfirmTimer();
      confirmDelete = false;
      doneDelete = true;
      pendingDeleteUid = ev.uid;
      clearDoneTimer();
      doneTimer = setTimeout(() => {
        const uid = pendingDeleteUid;
        doneDelete = false;
        doneTimer = null;
        pendingDeleteUid = null;
        if (uid) deleteScratchpadEvent(uid);
      }, CONFIRM_WINDOW_MS);
      return;
    }
    confirmDelete = true;
    clearConfirmTimer();
    confirmTimer = setTimeout(() => {
      confirmDelete = false;
      confirmTimer = null;
    }, CONFIRM_WINDOW_MS);
  }

  $effect(() => {
    if (!dialog) return;
    if (ui.modalEvent && !dialog.open) {
      dialog.showModal();
      showSource = false;
      swipeStartY = null;
      dismissing = false;
      cancelPendingDelete();
    }
    if (!ui.modalEvent && dialog.open) {
      cancelPendingDelete();
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
      case 'inverted': return 'Inverted';
      case 'dashed': return 'Dashed';
      case 'muted': return 'Muted';
      case 'striked': return 'Striked';
      case 'hidden': return 'Hidden';
      default: return 'Default';
    }
  }

  function openRuleInSettings(rule: FindReplaceRule): void {
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

  function formatEventDateInfo(ev: NonNullable<typeof ui.modalEvent>): {
    date: string;
    time: string;
    duration: string;
  } {
    const date = formatRange(ev.start, ev.end, config.dateFormat, config.locale);
    if (ev.allDay) {
      const days = Math.round((ev.end.getTime() - ev.start.getTime()) / 86_400_000);
      return { date, time: '', duration: days > 1 ? `${days} days` : '' };
    }
    const time =
      formatTime(ev.start, config.timeFormat, config.timezone) +
      ' — ' +
      formatTime(ev.end, config.timeFormat, config.timezone);
    const totalMins = Math.round((ev.end.getTime() - ev.start.getTime()) / 60_000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    let duration = '';
    if (h > 0 && m > 0) duration = `${h}h ${m}m`;
    else if (h > 0) duration = `${h}h`;
    else if (m > 0) duration = `${m}m`;
    return { date, time, duration };
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linkifyText(text: string): string {
    const URL_RE = /https?:\/\/[^\s<>"]+/g;
    let result = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(text)) !== null) {
      result += escapeHtml(text.slice(last, m.index));
      const url = m[0].replace(/[.,;:!?)\]'"]+$/, '');
      result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener nofollow">${escapeHtml(url)}</a>`;
      last = m.index + url.length;
    }
    result += escapeHtml(text.slice(last));
    return result;
  }

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
    {@const raw = events.rawByUid[ev.uid] ?? null}
    <article>
      <header>
        <h2 class="modal-title">{ev.displayTitle}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={close} />
      </header>
      {#if showSource}
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
        {@const info = formatEventDateInfo(ev)}
        <p><time datetime={ev.start.toISOString()}>{info.date}{#if ev.allDay && info.duration} · {info.duration}{/if}</time></p>
        {#if info.time}<p class="event-time">{info.time}{#if info.duration} · {info.duration}{/if}</p>{/if}
        {#if ev.displayLocation}<p>{ev.displayLocation}</p>{/if}
        {#if ev.displayDescription}<p class="desc">{@html linkifyText(ev.displayDescription)}</p>{/if}
        {#if ev.url}<p><a href={ev.url} target="_blank" rel="noopener">Open source</a></p>{/if}
      {/if}
      <footer class="modal-footer">
        <div class="source-slot">
          {#if isScratch}
            <button
              type="button"
              class="action-btn delete-btn"
              class:confirming={confirmDelete}
              class:done={doneDelete}
              title={doneDelete ? 'Tap to cancel deletion' : undefined}
              onclick={onDeleteClick}
            >{doneDelete ? 'Delete ✓' : confirmDelete ? 'Confirm delete' : 'Delete'}</button>
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
          {#if !showSource}
            <CalendarDownloadMenu events={[ev]} />
          {/if}
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
          {#if isScratch}
            <button type="button" class="action-btn" onclick={editDraft}>EDIT</button>
          {/if}
          <button
            type="button"
            class="action-btn"
            onclick={() => void copyText(showSource && raw ? raw : buildDetails(ev), showSource && raw ? 'data' : 'details')}
          >COPY</button>
        </div>
      </footer>
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    padding: 0;
    width: min(600px, calc(100vw - 1rem));
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
  .delete-btn {
    border-color: var(--accent);
    color: var(--accent);
  }
  .delete-btn:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .delete-btn.confirming {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
  .delete-btn.done {
    background: var(--paper);
    color: var(--ink);
    border-color: var(--ink);
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
  .event-time {
    font-family: var(--mono);
    font-size: 0.9em;
    color: var(--ink-muted);
    margin: 0.05em 0 0.15em;
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
    border-top: 1px solid var(--ink);
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
    border: 1px solid var(--ink);
    background: transparent;
    color: var(--ink);
    box-sizing: border-box;
    font-size: var(--fs-11);
    font-weight: 400;
    line-height: 1;
  }
  .style-swatch[data-style='bold'] {
    border-width: 2px;
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
    border: 1px solid var(--ink);
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
