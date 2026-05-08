<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { config } from '../lib/state.svelte';
  import type { FindReplaceRule, StyleVariant } from '../lib/types';

  type Props = {
    editingRuleId: string | null;
    onEditingChange: (id: string | null) => void;
  };
  const { editingRuleId, onEditingChange }: Props = $props();

  const styleOptions: { id: StyleVariant; label: string }[] = [
    { id: 'none', label: 'No style' },
    { id: 'inverted-dashed', label: 'Inverted, dashed' },
    { id: 'inverted-strike', label: 'Inverted, strike' },
    { id: 'muted', label: 'Muted' },
    { id: 'highlight', label: 'Highlight' },
    { id: 'hidden', label: 'Hidden' },
  ];

  let snapshot: FindReplaceRule | null = $state(null);
  let formFind = $state('');
  let formReplace = $state('');
  let formStyle = $state<StyleVariant>('none');
  let listContainer: HTMLUListElement | undefined = $state();
  let lastEditingId: string | null = null;

  $effect(() => {
    if (editingRuleId === lastEditingId) return;
    lastEditingId = editingRuleId;
    if (editingRuleId === null) {
      snapshot = null;
      return;
    }
    const rule = config.rules.find((r) => r.id === editingRuleId);
    if (!rule) {
      snapshot = null;
      return;
    }
    snapshot = { ...rule };
    formFind = rule.find;
    formReplace = rule.replace;
    formStyle = rule.style;
    queueMicrotask(() => {
      listContainer
        ?.querySelector<HTMLElement>(`[data-rule-card="${rule.id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });

  function styleLabel(id: StyleVariant): string {
    return styleOptions.find((o) => o.id === id)?.label ?? id;
  }

  function startEdit(rule: FindReplaceRule): void {
    onEditingChange(rule.id);
  }

  function cancelEdit(): void {
    if (snapshot) {
      const idx = config.rules.findIndex((r) => r.id === snapshot!.id);
      if (idx >= 0) {
        const restored = { ...snapshot };
        config.rules = [
          ...config.rules.slice(0, idx),
          restored,
          ...config.rules.slice(idx + 1),
        ];
      }
    }
    snapshot = null;
    onEditingChange(null);
  }

  function saveEdit(): void {
    if (!editingRuleId) return;
    const idx = config.rules.findIndex((r) => r.id === editingRuleId);
    if (idx < 0) {
      onEditingChange(null);
      snapshot = null;
      return;
    }
    const next = {
      ...config.rules[idx]!,
      find: formFind,
      replace: formReplace,
      style: formStyle,
    };
    config.rules = [
      ...config.rules.slice(0, idx),
      next,
      ...config.rules.slice(idx + 1),
    ];
    snapshot = null;
    onEditingChange(null);
  }

  function remove(id: string): void {
    config.rules = config.rules.filter((r) => r.id !== id);
    if (editingRuleId === id) {
      snapshot = null;
      onEditingChange(null);
    }
  }

  function moveRule(id: string, dir: -1 | 1): void {
    const idx = config.rules.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= config.rules.length) return;
    const copy = [...config.rules];
    const [moved] = copy.splice(idx, 1);
    copy.splice(next, 0, moved!);
    config.rules = copy;
  }

  function previewText(rule: FindReplaceRule): string {
    const find = rule.find.trim() || '(empty)';
    const replace = rule.replace.trim() || '(empty)';
    return `${find} → ${replace}`;
  }
</script>

<div class="rules">
  {#if config.rules.length === 0}
    <p class="empty">
      Rules rename strings inside event titles, descriptions, and locations — and can apply a style to events that match. Rules below override per-calendar styles.
    </p>
  {/if}
  <ul class="rule-list" bind:this={listContainer}>
    {#each config.rules as rule (rule.id)}
      <li data-rule-card={rule.id} data-active={editingRuleId === rule.id ? 'true' : null}>
        <div class="rule-row">
          <button
            type="button"
            class="rule-name-btn"
            aria-label={'Edit rule ' + previewText(rule)}
            aria-expanded={editingRuleId === rule.id}
            onclick={() => (editingRuleId === rule.id ? cancelEdit() : startEdit(rule))}
          >
            <span class="rule-preview">{previewText(rule)}</span>
            {#if rule.style !== 'none'}
              <span class="rule-style" data-mono>{styleLabel(rule.style)}</span>
            {/if}
          </button>
          <IconButton icon="arrow-up" label="Move up" variant="ghost" size={16} onclick={() => moveRule(rule.id, -1)} />
          <IconButton icon="arrow-down" label="Move down" variant="ghost" size={16} onclick={() => moveRule(rule.id, 1)} />
          <IconButton icon="trash" label="Delete rule" variant="ghost" size={16} onclick={() => remove(rule.id)} />
        </div>
        {#if editingRuleId === rule.id}
          <form
            class="rule-edit"
            onsubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <div class="field">
              <label for="rule-find-{rule.id}">Find</label>
              <input id="rule-find-{rule.id}" type="text" bind:value={formFind} placeholder="Find text" />
            </div>
            <div class="field">
              <label for="rule-replace-{rule.id}">Replace</label>
              <input id="rule-replace-{rule.id}" type="text" bind:value={formReplace} placeholder="Replacement text" />
            </div>
            <div class="field">
              <label for="rule-style-{rule.id}">Style</label>
              <select id="rule-style-{rule.id}" bind:value={formStyle}>
                {#each styleOptions as o (o.id)}
                  <option value={o.id}>{o.label}</option>
                {/each}
              </select>
            </div>
            <div class="form-actions">
              <button type="button" onclick={cancelEdit}>Cancel</button>
              <button type="submit" class="primary">Save</button>
            </div>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .rules {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  .empty {
    margin: 0;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .rule-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--ink-faint);
    background: var(--paper);
  }
  .rule-list:empty {
    display: none;
  }
  .rule-list li {
    border-bottom: 1px solid var(--ink-faint);
  }
  .rule-list li:last-child {
    border-bottom: 0;
  }
  .rule-list li[data-active='true'] {
    background: var(--paper-2);
  }
  .rule-row {
    display: flex;
    align-items: center;
    gap: 0.25em;
    padding: 0.25em 0.4em;
    min-height: 36px;
  }
  .rule-name-btn {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.6em;
    min-width: 0;
    padding: 0 0.4em;
    height: 32px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }
  .rule-name-btn:hover {
    background: var(--paper-2);
  }
  .rule-preview {
    font-family: var(--mono);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .rule-style {
    font-family: var(--mono);
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid var(--ink-faint);
    color: var(--ink-muted);
    flex-shrink: 0;
  }
  .rule-edit {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0.5em 0.6em 0.7em;
    border-top: 1px solid var(--ink-faint);
  }
  .field {
    display: grid;
    grid-template-columns: 6em 1fr;
    gap: 0.5em;
    align-items: center;
  }
  .field label {
    font-size: 12px;
    color: var(--ink-muted);
  }
  .field input,
  .field select {
    height: 32px;
    width: 100%;
    box-sizing: border-box;
  }
  @media (max-width: 480px) {
    .field {
      grid-template-columns: 1fr;
    }
  }
</style>
