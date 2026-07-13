<script lang="ts">
  import { ui, config } from '../lib/state.svelte';
  import { formatEventDateInfo, linkifyText } from '../lib/event-display';

  // Non-interactive preview popover shown on mouse hover of an event pill. A
  // single instance is mounted at the app root (next to EventModal); it mirrors
  // the pointed-at event via ui.hoverEvent and anchors to ui.hoverAnchor. All
  // content is gated on {#if ui.hoverEvent} so it never flashes empty/stale.
  const GAP = 8;

  let cardW = $state(0);
  let cardH = $state(0);

  const info = $derived(
    ui.hoverEvent
      ? formatEventDateInfo(
          ui.hoverEvent,
          config.dateFormat,
          config.locale,
          config.timeFormat,
          config.timezone,
        )
      : null,
  );

  // Prefer placing the card just below the pill; flip above if it would run off
  // the viewport bottom. Clamp horizontally to stay on-screen. Uses the measured
  // card size so the clamp is accurate once rendered.
  const pos = $derived.by(() => {
    const a = ui.hoverAnchor;
    if (!a || typeof window === 'undefined') return { left: 0, top: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a.left;
    if (cardW > 0) left = Math.max(GAP, Math.min(left, vw - cardW - GAP));
    let top = a.bottom + GAP;
    if (cardH > 0 && top + cardH + GAP > vh) {
      const above = a.top - GAP - cardH;
      top = above >= GAP ? above : Math.max(GAP, vh - cardH - GAP);
    }
    return { left, top };
  });
</script>

{#if ui.hoverEvent}
  {@const ev = ui.hoverEvent}
  <div
    class="hover-card"
    style="left: {pos.left}px; top: {pos.top}px;"
    bind:clientWidth={cardW}
    bind:clientHeight={cardH}
    aria-hidden="true"
  >
    <p class="hc-title">
      {ev.displayTitle}{#if (ev.dupCount ?? 1) > 1}<span class="hc-dup" data-mono> ×{ev.dupCount}</span>{/if}
    </p>
    {#if info}
      <p class="hc-date"><time datetime={ev.start.toISOString()}>{info.date}</time>{#if info.weekday && !info.multiDay}<span class="hc-dim">{' · '}</span><span class="hc-weekday">{info.weekday}</span>{/if}{#if ev.allDay && info.duration}{' · '}{info.duration}{/if}</p>
      {#if info.multiDay && info.weekday}<p class="hc-date"><span class="hc-weekday">{info.weekday}</span></p>{/if}
      {#if info.time}
        <p class="hc-time" data-mono>{info.time}{#if info.duration}{' · '}{info.duration}{/if}</p>
      {/if}
    {/if}
    {#if ev.displayLocation}<p class="hc-loc">{ev.displayLocation}</p>{/if}
    {#if ev.displayDescription}<p class="hc-desc">{@html linkifyText(ev.displayDescription)}</p>{/if}
  </div>
{/if}

<style>
  .hover-card {
    position: fixed;
    z-index: 50;
    max-width: min(340px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: 0.5em 0.7em;
    border: var(--border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
    /* Non-interactive: it must never eat pointer events or steal hover. */
    pointer-events: none;
    /* Fade in so a quick skim doesn't strobe. */
    animation: hc-fade 90ms ease-out;
  }
  @keyframes hc-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hover-card { animation: none; }
  }
  .hc-title {
    margin: 0 0 0.15em;
    font-size: var(--fs-13);
    font-weight: 700;
    line-height: 1.25;
  }
  .hc-dup {
    color: var(--ink-muted);
    font-weight: 400;
  }
  .hc-date {
    margin: 0.05em 0;
    font-size: var(--fs-12);
  }
  .hc-date time {
    font-family: var(--mono);
  }
  /* Weekday sits outside <time>, so it stays non-mono and muted — matches the
     modal's .event-weekday treatment. */
  .hc-weekday {
    color: var(--ink-muted);
  }
  /* The date · weekday divider, muted like the modal's .event-dim. */
  .hc-dim {
    color: var(--ink-muted);
  }
  .hc-time {
    margin: 0.05em 0;
    font-size: var(--fs-11);
    color: var(--ink-muted);
  }
  .hc-loc {
    margin: 0.05em 0;
    font-size: var(--fs-12);
    color: var(--ink-muted);
  }
  .hc-desc {
    margin: 0.35em 0 0;
    font-size: var(--fs-11);
    line-height: 1.35;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    /* Clamp long descriptions — this is a peek, not the full modal. */
    max-height: 7.5em;
    overflow: hidden;
  }
  .hc-desc :global(a) {
    color: var(--accent);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>
