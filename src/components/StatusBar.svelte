<script lang="ts">
  import { ui } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import Icon from './Icon.svelte';
  import { tap } from '../lib/haptics';

  const COLLAPSED_HEIGHT = 28;
  const MAX_HEIGHT_VH = 60;

  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartHeight = 0;
  let pointerMoved = false;
  let height = $state(COLLAPSED_HEIGHT);
  let lastExpandedHeight = COLLAPSED_HEIGHT;

  const latestEntry = $derived(ui.log[0] ?? null);
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

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
</script>

<aside class="status-bar" style="height: {height}px;" data-expanded={expanded ? 'true' : null}>
  <button
    type="button"
    class="handle"
    aria-label={expanded ? 'Collapse log' : 'Expand log'}
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
      {#if latestEntry}
        <span class="latest" data-kind={latestEntry.kind}>{latestEntry.message}</span>
      {/if}
    </span>
    <span class="toggle" aria-hidden="true">
      <Icon name={expanded ? 'arrow-down' : 'arrow-up'} size={14} />
    </span>
  </button>
  {#if expanded}
    <div class="log" role="log" aria-label="Activity log">
      {#if ui.log.length === 0}
        <p class="empty">No activity yet.</p>
      {:else}
        <ol>
          {#each ui.log as entry (entry.id)}
            <li data-kind={entry.kind}>
              <time datetime={new Date(entry.ts).toISOString()}>{formatTime(entry.ts)}</time>
              <span class="msg">{entry.message}</span>
            </li>
          {/each}
        </ol>
      {/if}
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
    border-top: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 -1px 0 var(--ink-faint);
    user-select: none;
    -webkit-user-select: none;
    transition: height 120ms ease-out;
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
  .latest {
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .latest.muted {
    color: var(--ink-muted);
  }
  .latest[data-kind='warn'] {
    color: var(--ink);
  }
  .latest[data-kind='error'] {
    color: var(--ink);
    text-decoration: underline;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    color: var(--ink-muted);
  }
  .log {
    flex: 1 1 auto;
    overflow-y: auto;
    border-top: 1px solid var(--ink-faint);
    padding: 0.4em 0.6em 0.6em;
  }
  .log ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25em;
  }
  .log li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.6em;
    align-items: baseline;
    font-size: 12px;
    padding: 2px 0;
    border-bottom: 1px dashed var(--ink-faint);
  }
  .log li:last-child {
    border-bottom: 0;
  }
  .log li[data-kind='warn'] .msg {
    font-weight: 600;
  }
  .log li[data-kind='error'] .msg {
    text-decoration: underline;
  }
  .log time {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .log .msg {
    font-family: var(--mono);
    word-break: break-word;
  }
  .empty {
    margin: 0;
    color: var(--ink-muted);
    font-size: 12px;
  }
</style>
