<script lang="ts">
  import { ui } from '../lib/state.svelte';
  import { LANE_HEIGHT, ROW_PADDING_PX } from '../lib/layout';
  import type { LaneEvent } from '../lib/types';

  type Props = { event: LaneEvent; isMatch: boolean; isCurrent: boolean };
  const { event, isMatch, isCurrent }: Props = $props();

  function open(): void {
    ui.modalEvent = event;
  }
</script>

<article
  data-all-day={event.allDay ? 'true' : null}
  data-match={isMatch ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style="left: {event.leftPx}px; width: {event.widthPx}px; top: {event.lane * LANE_HEIGHT + ROW_PADDING_PX}px;"
>
  <button type="button" onclick={open} aria-label="Open event {event.title}">
    <h3>{event.title}</h3>
    {#if event.descriptionSnippet}
      <p>{event.descriptionSnippet}</p>
    {/if}
  </button>
</article>

<style>
  article {
    position: absolute;
    height: 36px;
    border: 1px solid var(--ink);
    background: var(--paper);
    overflow: hidden;
    box-sizing: border-box;
  }
  article[data-all-day='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  article[aria-current='true'] {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  button {
    width: 100%;
    height: 100%;
    padding: 2px 6px;
    background: transparent;
    color: inherit;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  h3 {
    margin: 0;
    font-size: 12px;
    font-weight: bold;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  p {
    margin: 0;
    font-size: 10px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
