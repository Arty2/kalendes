<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { config } from '../lib/state.svelte';
  import type { FindReplaceRule, StyleVariant } from '../lib/types';

  type Props = {
    editingRuleId: string | null;
    onEditingChange: (id: string | null) => void;
    draftRule?: FindReplaceRule | null;
    onCommitDraft?: (updates: { find: string; replace: string; style: StyleVariant }) => void;
    onDiscardDraft?: () => void;
  };
  const {
    editingRuleId,
    onEditingChange,
    draftRule = null,
    onCommitDraft,
    onDiscardDraft,
  }: Props = $props();

  const isEditingDraft = $derived(!!draftRule && editingRuleId === draftRule.id);

  const styleOptions: { id: StyleVariant; label: string }[] = [
    { id: 'none', label: 'No style' },
    { id: 'inverted-dashed', label: 'Inverted, dashed' },
    { id: 'inverted-strike', label: 'Inverted, strike' },
    { id: 'muted', label: '*Muted' },
    { id: 'highlight', label: 'Highlight' },
    { id: 'hidden', label: '*Hidden' },
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
    const rule =
      draftRule && draftRule.id === editingRuleId
        ? draftRule
        : config.rules.find((r) => r.id === editingRuleId);
    if (!rule) {
      snapshot = null;
      return;
    }
    snapshot = draftRule && draftRule.id === editingRuleId ? null : { ...rule };
    formFind = rule.find;
    formReplace = rule.replace;
    formStyle = rule.style;
    queueMicrotask(() => {
      listContainer
        ?.querySelector<HTMLElement>(`[data-rule-card="${rule.id}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  });

  function styleLabel(id: StyleVariant): string {
    return styleOptions.find((o) => o.id === id)?.label ?? id;
  }

  function startEdit(rule: FindReplaceRule): void {
    onEditingChange(rule.id);
  }

  function cancelEdit(): void {
    if (isEditingDraft) {
      onDiscardDraft?.();
      snapshot = null;
      return;
    }
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
    if (isEditingDraft) {
      onCommitDraft?.({ find: formFind, replace: formReplace, style: formStyle });
      snapshot = null;
      return;
    }
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
    if (typeof window !== 'undefined' && !window.confirm('Delete this rule? This cannot be undone.')) return;
    config.rules = config.rules.filter((r) => r.id !== id);
    if (editingRuleId === id) {
      snapshot = null;
      onEditingChange(null);
    }
  }

  function moveRule(id: string, dir: -1 | 1): void {
    const idx = config.rules.findIndex((r) => r.id === id);
    if (idx < 0 || config.rules.length < 2) return;
    const next = (idx + dir + config.rules.length) % config.rules.length;
    if (next === idx) return;
    const copy = [...config.rules];
    const [moved] = copy.splice(idx, 1);
    copy.splice(next, 0, moved!);
    config.rules = copy;
  }

  function previewText(rule: FindReplaceRule): string {
    const find = rule.find.trim() || '(empty)';
    const replace = rule.replace.trim() || '(empty)';
    return `${find} > ${replace}`;
  }
</script>

<div class="rules">
  {#if config.rules.length === 0}
    <p class="empty">
      Rules rename strings inside event titles, descriptions, and locations — and can apply a style to events that match. Rules below override per-calendar styles.
    </p>
  {/if}
  <ul class="rule-list" bind:this={listContainer}>
    {#if draftRule && isEditingDraft}
      <li data-rule-card={draftRule.id} data-active="true" data-draft="true">
        <div class="rule-row">
          <button
            type="button"
            class="rule-name-btn"
            aria-expanded="true"
            onclick={cancelEdit}
          >
            <span class="rule-preview">New rule</span>
          </button>
        </div>
        <form
          class="rule-edit"
          onsubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <div class="field">
            <label for="rule-find-{draftRule.id}">Find</label>
            <input id="rule-find-{draftRule.id}" type="text" bind:value={formFind} placeholder="Find text" />
          </div>
          <div class="field">
            <label for="rule-replace-{draftRule.id}">Replace</label>
            <input id="rule-replace-{draftRule.id}" type="text" bind:value={formReplace} placeholder="Replacement text" />
          </div>
          <div class="field">
            <label for="rule-style-{draftRule.id}">Style</label>
            <select id="rule-style-{draftRule.id}" bind:value={formStyle}>
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
      </li>
    {/if}
    {#each config.rules as rule, ri (rule.id)}
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
              <span
                class="style-swatch"
                data-style={rule.style}
                aria-label={styleLabel(rule.style)}
                title={styleLabel(rule.style)}
              ></span>
            {/if}
          </button>
          <IconButton
            icon={ri === 0 ? 'arrow-bar-down' : 'arrow-up'}
            label={ri === 0 ? 'Wrap to end' : 'Move up'}
            variant="ghost"
            size={16}
            onclick={() => moveRule(rule.id, -1)}
          />
          <IconButton
            icon={ri === config.rules.length - 1 ? 'arrow-bar-up' : 'arrow-down'}
            label={ri === config.rules.length - 1 ? 'Wrap to start' : 'Move down'}
            variant="ghost"
            size={16}
            onclick={() => moveRule(rule.id, 1)}
          />
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
            <div class="form-actions rule-form-actions">
              <button type="button" class="delete-btn" onclick={() => remove(rule.id)}>
                Delete
              </button>
              <span class="action-spacer"></span>
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
    outline: 2px solid var(--ink);
    outline-offset: -2px;
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
  .style-swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    border: 1px solid var(--ink);
    background: var(--paper);
    box-sizing: border-box;
    position: relative;
  }
  .style-swatch[data-style='inverted-dashed'] {
    background: var(--ink);
    border-color: var(--ink);
    border-style: dashed;
    border-width: 1.5px;
  }
  .style-swatch[data-style='inverted-strike'] {
    background: var(--ink);
    border-color: var(--ink);
  }
  .style-swatch[data-style='inverted-strike']::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 1px;
    right: 1px;
    height: 1px;
    background: var(--paper);
    transform: translateY(-50%);
  }
  .style-swatch[data-style='muted'] {
    background: var(--paper);
    opacity: 0.4;
  }
  .style-swatch[data-style='highlight'] {
    background: var(--paper);
    border-color: var(--ink);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .style-swatch[data-style='hidden'] {
    background: var(--paper);
    opacity: 0.25;
    filter: grayscale(1);
  }
  .style-swatch[data-style='hidden']::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 1px;
    right: 1px;
    height: 1px;
    background: var(--ink);
    transform: translateY(-50%);
  }
  .rule-edit {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0.5em 0.6em 0.7em;
    border-top: 1px dashed var(--ink-faint);
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
    user-select: none;
  }
  .field input,
  .field select {
    height: 32px;
    width: 100%;
    box-sizing: border-box;
  }
  .rule-form-actions {
    align-items: center;
    margin-top: 0.4em;
  }
  .rule-form-actions .action-spacer {
    flex: 1;
  }
  .delete-btn {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--accent);
    background: var(--paper);
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .delete-btn:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  @media (max-width: 480px) {
    .field {
      grid-template-columns: 1fr;
    }
  }
</style>
