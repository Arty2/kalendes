<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, config, zoom } from '../lib/state.svelte';
  import { stripShareParam } from '../lib/share';

  type Props = { onRefresh: () => Promise<void> };
  const { onRefresh }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  const importing = $derived(ui.shareImport);
  const feedCount = $derived(importing?.feeds.length ?? 0);
  const ruleCount = $derived(importing?.rules.length ?? 0);

  $effect(() => {
    if (!dialog) return;
    if (importing && !dialog.open) dialog.showModal();
    if (!importing && dialog.open) dialog.close();
  });

  function close(): void {
    ui.shareImport = null;
    stripShareParam();
  }

  function existingUrl(url: string): boolean {
    return config.feeds.some((f) => f.source.kind === 'user' && f.source.url === url);
  }

  function nextOrder(): number {
    return config.feeds.reduce((m, f) => Math.max(m, f.order), -1) + 1;
  }

  function applyView(): void {
    const v = importing?.view;
    if (!v) return;
    if (v.zoom) zoom.value = v.zoom;
    if (v.locale) config.locale = v.locale;
    if (v.dateFormat) config.dateFormat = v.dateFormat;
    if (v.theme) config.theme = v.theme;
  }

  function applyMerge(): void {
    if (!importing) return;
    let order = nextOrder();
    for (const feed of importing.feeds) {
      if (feed.source.kind !== 'user') continue;
      if (existingUrl(feed.source.url)) continue;
      config.feeds.push({ ...feed, order: order++ });
    }
    const existingRuleIds = new Set(config.rules.map((r) => r.id));
    for (const rule of importing.rules) {
      if (existingRuleIds.has(rule.id)) continue;
      config.rules.push(rule);
    }
    applyView();
    if (importing.kioskPin) config.kioskPin = importing.kioskPin;
    close();
    void onRefresh();
  }

  function applyReplace(): void {
    if (!importing) return;
    config.feeds = importing.feeds.map((f, i) => ({ ...f, order: i }));
    config.rules = [...importing.rules];
    applyView();
    if (importing.kioskPin) config.kioskPin = importing.kioskPin;
    close();
    void onRefresh();
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  {#if importing}
    <article>
      <header>
        <h2>Import shared setup</h2>
        <IconButton icon="close" label="Cancel" variant="ghost" onclick={close} />
      </header>
      <p>
        Imported share contains <strong>{feedCount}</strong>
        calendar{feedCount === 1 ? '' : 's'} and <strong>{ruleCount}</strong>
        rule{ruleCount === 1 ? '' : 's'}.
      </p>
      <div class="actions">
        <button type="button" class="primary" onclick={applyReplace}>Replace yours</button>
        <button type="button" onclick={applyMerge}>Merge</button>
        <button type="button" onclick={close}>Cancel</button>
      </div>
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: var(--border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    padding: 0;
    width: min(440px, calc(100vw - 1rem));
    box-sizing: border-box;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  article {
    padding: 1em;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: var(--border-w) solid var(--ink-faint);
    padding-bottom: 0.5em;
    margin-bottom: 0.75em;
  }
  h2 {
    margin: 0;
    font-size: 1.05em;
  }
  p {
    margin: 0 0 1em 0;
    font-size: var(--fs-13);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    justify-content: flex-end;
  }
  .actions button {
    height: 32px;
    padding: 0 12px;
    border: var(--border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-13);
  }
  .actions .primary {
    background: var(--ink);
    color: var(--paper);
  }
</style>
