<script lang="ts">
  import { config } from '../lib/state.svelte';
  import { exportConfig, importConfig, defaultConfig } from '../lib/storage';
  import { feedIdFor } from '../lib/ics';
  import type { CalendarFeed } from '../lib/types';

  type Props = { onClose: () => void; onRefresh: () => Promise<void> };
  const { onClose, onRefresh }: Props = $props();

  let newUrl = $state('');
  let newName = $state('');
  let importError: string | null = $state(null);

  function addFeed(e: Event): void {
    e.preventDefault();
    if (!newUrl.trim()) return;
    const source = { kind: 'user' as const, url: newUrl.trim() };
    const id = feedIdFor(source);
    if (config.feeds.some((f) => f.id === id)) return;
    const feed: CalendarFeed = {
      id,
      source,
      name: newName.trim() || newUrl.trim(),
      collapsed: false,
      order: config.feeds.length,
    };
    config.feeds.push(feed);
    newUrl = '';
    newName = '';
    void onRefresh();
  }

  function removeFeed(id: string): void {
    config.feeds = config.feeds.filter((f) => f.id !== id);
  }

  function moveFeed(id: string, dir: -1 | 1): void {
    const sorted = [...config.feeds].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx]!;
    const b = sorted[swap]!;
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
  }

  function downloadExport(): void {
    const json = exportConfig(config);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calendar-timeline-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: Event): Promise<void> {
    importError = null;
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const next = importConfig(text);
      config.feeds = next.feeds;
      config.refreshIntervalMs = next.refreshIntervalMs;
      void onRefresh();
    } catch (err) {
      importError = (err as Error).message;
    }
  }

  function resetToDefault(): void {
    const d = defaultConfig();
    config.feeds = d.feeds;
    config.refreshIntervalMs = d.refreshIntervalMs;
    void onRefresh();
  }
</script>

<aside class="panel" aria-label="Settings">
  <header>
    <h2>Settings</h2>
    <button onclick={onClose} aria-label="Close">✕</button>
  </header>

  <section>
    <h3>Calendars</h3>
    <ul>
      {#each [...config.feeds].sort((a, b) => a.order - b.order) as feed (feed.id)}
        <li>
          <span>{feed.name}</span>
          <small>{feed.source.kind}</small>
          <button onclick={() => moveFeed(feed.id, -1)} aria-label="Move up">↑</button>
          <button onclick={() => moveFeed(feed.id, 1)} aria-label="Move down">↓</button>
          {#if feed.source.kind === 'user'}
            <button onclick={() => removeFeed(feed.id)} aria-label="Remove">✕</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h3>Add ICS feed</h3>
    <form onsubmit={addFeed}>
      <label>URL <input type="url" bind:value={newUrl} placeholder="https://…" required /></label>
      <label>Name <input type="text" bind:value={newName} placeholder="My calendar" /></label>
      <button type="submit">Add</button>
    </form>
  </section>

  <section>
    <h3>Refresh interval</h3>
    <label>
      <input
        type="number"
        min="1"
        max="1440"
        value={Math.round(config.refreshIntervalMs / 60000)}
        onchange={(e) => (config.refreshIntervalMs = Number((e.currentTarget as HTMLInputElement).value) * 60000)}
      />
      minutes
    </label>
  </section>

  <section>
    <h3>Configuration</h3>
    <button onclick={downloadExport}>Export</button>
    <label>Import <input type="file" accept="application/json" onchange={handleImport} /></label>
    {#if importError}<p>Import failed: {importError}</p>{/if}
    <button onclick={resetToDefault}>Reset to default</button>
  </section>
</aside>

<style>
  .panel {
    position: fixed;
    top: 50px;
    right: 0;
    width: 360px;
    max-width: 100vw;
    height: calc(100vh - 50px);
    background: var(--paper);
    border-left: 2px solid var(--ink);
    overflow-y: auto;
    padding: 1em;
    z-index: 20;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--ink);
    padding-bottom: 0.5em;
    margin-bottom: 0.5em;
  }
  h2 { margin: 0; }
  h3 { margin: 1em 0 0.5em; font-size: 1em; }
  section { margin-bottom: 1em; }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 4px 0;
    border-bottom: 1px solid var(--ink);
  }
  li span { flex: 1; }
  li small { font-size: 10px; opacity: 0.7; }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
