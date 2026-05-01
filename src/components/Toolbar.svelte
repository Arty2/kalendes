<script lang="ts">
  import { zoom, search, ui } from '../lib/state.svelte';
  import type { Zoom } from '../lib/types';

  type Props = { onRefresh: () => Promise<void> };
  const { onRefresh }: Props = $props();

  const zooms: { id: Zoom; label: string }[] = [
    { id: 'month', label: 'Month' },
    { id: 'quarter', label: 'Quarter' },
    { id: 'half-year', label: '6-Month' },
    { id: 'year', label: 'Year' },
  ];

  function setZoom(z: Zoom): void {
    zoom.value = z;
  }
</script>

<header>
  <strong>Calendar Timeline</strong>
  <nav>
    {#each zooms as z (z.id)}
      <button aria-pressed={zoom.value === z.id} onclick={() => setZoom(z.id)}>{z.label}</button>
    {/each}
  </nav>
  <search>
    <input
      type="search"
      placeholder="Search…"
      bind:value={search.query}
      aria-label="Search events"
    />
  </search>
  <button onclick={() => onRefresh()} disabled={ui.loading}>
    {ui.loading ? 'Loading…' : 'Refresh'}
  </button>
  <button aria-pressed={ui.settingsOpen} onclick={() => (ui.settingsOpen = !ui.settingsOpen)}>
    Settings
  </button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 0.75em;
    padding: 0.5em 1em;
    border-bottom: 1px solid var(--ink);
    background: var(--paper);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  nav {
    display: flex;
    gap: 0.25em;
  }
  search {
    flex: 1;
    display: flex;
  }
  search input {
    width: 100%;
  }
</style>
