<script lang="ts">
  import { config } from '../lib/state.svelte';
  import type { CalendarFeed } from '../lib/types';

  type Props = { feeds: CalendarFeed[]; rowHeights: Record<string, number> };
  const { feeds, rowHeights }: Props = $props();

  function toggle(feed: CalendarFeed): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.collapsed = !target.collapsed;
  }

  function rename(feed: CalendarFeed, newName: string): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.name = newName;
  }
</script>

<div class="labels">
  {#each feeds as feed (feed.id)}
    <aside data-collapsed={feed.collapsed ? 'true' : null} style="height: {rowHeights[feed.id] ?? 40}px">
      <button
        onclick={() => toggle(feed)}
        aria-expanded={!feed.collapsed}
        aria-label={feed.collapsed ? 'Expand' : 'Collapse'}
        title={feed.collapsed ? 'Expand' : 'Collapse'}
      >{feed.collapsed ? '▸' : '▾'}</button>
      <input
        type="text"
        value={feed.name}
        onchange={(e) => rename(feed, (e.currentTarget as HTMLInputElement).value)}
        aria-label="Calendar name"
      />
    </aside>
  {/each}
</div>

<style>
  .labels {
    display: flex;
    flex-direction: column;
  }
  aside {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border-bottom: 1px solid var(--ink);
    overflow: hidden;
  }
  aside button {
    flex-shrink: 0;
    padding: 0 4px;
  }
  aside input {
    flex: 1;
    min-width: 0;
    border: none;
    padding: 2px;
    font-size: 13px;
  }
  aside input:focus {
    outline: 1px solid var(--ink);
  }
</style>
