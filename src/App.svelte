<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import Timeline from './components/Timeline.svelte';
  import EventModal from './components/EventModal.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { config, events, ui } from './lib/state.svelte';
  import { saveConfig } from './lib/storage';
  import { fetchAndParseFeed } from './lib/ics';
  import { rangeForToday } from './lib/layout';

  const today = new Date();
  const range = rangeForToday(today);

  async function loadAllFeeds(): Promise<void> {
    ui.loading = true;
    ui.error = null;
    try {
      await Promise.all(
        config.feeds.map(async (feed) => {
          try {
            const parsed = await fetchAndParseFeed(feed.source, range.start, range.end);
            events.byFeed[feed.id] = parsed;
          } catch (err) {
            console.error('Failed to load feed', feed.id, err);
            events.byFeed[feed.id] = [];
          }
        }),
      );
    } finally {
      ui.loading = false;
    }
  }

  $effect(() => {
    void loadAllFeeds();
  });

  $effect(() => {
    saveConfig(config);
  });
</script>

<Toolbar onRefresh={loadAllFeeds} />
<Timeline rangeStart={range.start} rangeEnd={range.end} today={today} />
<EventModal />
{#if ui.settingsOpen}
  <SettingsPanel onClose={() => (ui.settingsOpen = false)} onRefresh={loadAllFeeds} />
{/if}
