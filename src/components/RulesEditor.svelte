<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { config } from '../lib/state.svelte';
  import type { FeedCategory, FindReplaceRule, StyleVariant } from '../lib/types';

  type Props = {
    editingRuleId: string | null;
    onEditingChange: (id: string | null) => void;
    draftRule?: FindReplaceRule | null;
    onCommitDraft?: (updates: { find: string; replace: string; style: StyleVariant; category: FeedCategory; disabled: boolean }) => void;
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
    { id: 'none', label: 'Default' },
    { id: 'bold', label: 'Bold' },
    { id: 'inverted', label: 'Inverted' },
    { id: 'dashed', label: 'Dashed' },
    { id: 'muted', label: 'Muted' },
    { id: 'striked', label: 'Striked' },
    { id: 'hidden', label: 'Hidden' },
  ];

  const categoryOptions: { id: FeedCategory; label: string }[] = [
    { id: 'none', label: 'Auto' },
    { id: 'events', label: 'Events' },
    { id: 'holidays', label: 'Holidays' },
    { id: 'observances', label: 'Observances' },
    { id: 'announcements', label: 'Announcements' },
    { id: 'guests', label: 'Guests' },
  ];

  const CONFIRM_WINDOW_MS = 3000;
  let confirmDeleteId: string | null = $state(null);
  let confirmDeleteTimer: ReturnType<typeof setTimeout> | null = null;
  let doneDeleteId: string | null = $state(null);
  let doneDeleteTimer: ReturnType<typeof setTimeout> | null = null;

  let snapshot: FindReplaceRule | null = $state(null);
  let formFind = $state('');
  let formReplace = $state('');
  let formStyle = $state<StyleVariant>('none');
  let formCategory = $state<FeedCategory>('none');
  let formDisabled = $state(false);
  let listContainer: HTMLUListElement | undefined = $state();
  let lastEditingId: string | null = null;

  $effect(() => {
    if (editingRuleId === lastEditingId) return;
    lastEditingId = editingRuleId;
    if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
    confirmDeleteId = null;
    confirmDeleteTimer = null;
    if (editingRuleId === null && doneDeleteTimer) {
      clearTimeout(doneDeleteTimer);
      doneDeleteTimer = null;
      doneDeleteId = null;
    }
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
    formCategory = rule.category ?? 'none';
    formDisabled = !!rule.disabled;
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

  // Direct enable/disable toggle (double-tap shortcut), applied immediately.
  function toggleRuleDisabled(rule: FindReplaceRule): void {
    const idx = config.rules.findIndex((r) => r.id === rule.id);
    if (idx < 0) return;
    const cur = config.rules[idx]!;
    const next = { ...cur, disabled: !cur.disabled };
    config.rules = [...config.rules.slice(0, idx), next, ...config.rules.slice(idx + 1)];
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
      onCommitDraft?.({ find: formFind, replace: formReplace, style: formStyle, category: formCategory, disabled: formDisabled });
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
      category: formCategory,
      disabled: formDisabled,
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
    // Tap on Delete ✓ during the done flash cancels the pending delete.
    if (doneDeleteId === id) {
      if (doneDeleteTimer) clearTimeout(doneDeleteTimer);
      doneDeleteId = null;
      doneDeleteTimer = null;
      return;
    }
    if (confirmDeleteId !== id) {
      if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
      confirmDeleteId = id;
      confirmDeleteTimer = setTimeout(() => {
        confirmDeleteId = null;
        confirmDeleteTimer = null;
      }, CONFIRM_WINDOW_MS);
      return;
    }
    if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
    confirmDeleteId = null;
    confirmDeleteTimer = null;
    doneDeleteId = id;
    if (doneDeleteTimer) clearTimeout(doneDeleteTimer);
    doneDeleteTimer = setTimeout(() => {
      doneDeleteId = null;
      doneDeleteTimer = null;
      config.rules = config.rules.filter((r) => r.id !== id);
      if (editingRuleId === id) {
        snapshot = null;
        onEditingChange(null);
      }
    }, CONFIRM_WINDOW_MS);
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
            <label for="rule-find-{draftRule.id}">Match</label>
            <input id="rule-find-{draftRule.id}" type="text" bind:value={formFind} placeholder="Match text" />
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
          <div class="field">
            <label for="rule-cat-{draftRule.id}">Type</label>
            <select id="rule-cat-{draftRule.id}" bind:value={formCategory}>
              {#each categoryOptions as o (o.id)}
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
            data-disabled={rule.disabled ? 'true' : null}
            aria-label={'Edit rule ' + previewText(rule) + ' (double-tap to enable/disable)'}
            aria-expanded={editingRuleId === rule.id}
            onclick={() => (editingRuleId === rule.id ? cancelEdit() : startEdit(rule))}
            ondblclick={() => toggleRuleDisabled(rule)}
          >
            <span class="rule-preview">{previewText(rule)}</span>
            <span
              class="style-swatch"
              data-style={rule.style}
              aria-label={styleLabel(rule.style)}
              title={styleLabel(rule.style)}
            >α</span>
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
              <label for="rule-find-{rule.id}">Match</label>
              <input id="rule-find-{rule.id}" type="text" bind:value={formFind} placeholder="Match text" />
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
            <div class="field">
              <label for="rule-cat-{rule.id}">Type</label>
              <select id="rule-cat-{rule.id}" bind:value={formCategory}>
                {#each categoryOptions as o (o.id)}
                  <option value={o.id}>{o.label}</option>
                {/each}
              </select>
            </div>
            <div class="form-actions rule-form-actions">
              <div class="action-group">
                <button
                  type="button"
                  class="disable-btn"
                  data-state={formDisabled ? 'enable' : 'disable'}
                  onclick={() => (formDisabled = !formDisabled)}
                >{formDisabled ? 'Enable' : 'Disable'}</button>
                <button
                  type="button"
                  class="delete-btn"
                  class:confirming={confirmDeleteId === rule.id}
                  class:done={doneDeleteId === rule.id}
                  title={doneDeleteId === rule.id ? 'Tap to cancel deletion' : undefined}
                  onclick={() => remove(rule.id)}
                >{doneDeleteId === rule.id
                  ? 'Delete ✓'
                  : confirmDeleteId === rule.id
                    ? 'Delete ?'
                    : 'Delete'}</button>
              </div>
              <div class="action-group">
                <button
                  type="button"
                  onclick={cancelEdit}
                  disabled={doneDeleteId === rule.id}
                >Cancel</button>
                <button
                  type="submit"
                  class="primary"
                  disabled={doneDeleteId === rule.id}
                >Save</button>
              </div>
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
    font-size: var(--fs-12);
    color: var(--ink-muted);
  }
  .rule-list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--paper);
  }
  .rule-list:empty {
    display: none;
  }
  .rule-list li + li {
    border-top: 1px solid var(--ink);
  }
  .rule-list li[data-active='true'] + li,
  .rule-list li[data-active='true'] {
    border-top-color: transparent;
  }
  .rule-list li[data-active='true'] {
    background: var(--paper-2);
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .rule-list li[data-active='true'] .rule-name-btn .rule-preview {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .rule-name-btn:focus-visible {
    outline: none;
  }
  .rule-name-btn:focus-visible .rule-preview {
    text-decoration: underline;
    text-underline-offset: 2px;
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
    font-size: var(--fs-13);
  }
  .rule-name-btn:hover {
    background: var(--paper-2);
  }
  .rule-preview {
    font-family: var(--sans);
    font-size: var(--fs-12);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .rule-name-btn[data-disabled='true'] .rule-preview {
    text-decoration: line-through;
    text-decoration-color: var(--ink-muted);
    color: var(--ink-muted);
  }
  /* Mini event-label preview: an "α" styled like a pill of the given style,
     with its border reflecting the style. */
  .style-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 16px;
    flex-shrink: 0;
    border: 1px solid var(--ink);
    background: transparent;
    color: var(--ink);
    box-sizing: border-box;
    font-size: var(--fs-11);
    font-weight: 400;
    line-height: 1;
  }
  .style-swatch[data-style='bold'] {
    border-width: 2px;
    font-weight: 700;
  }
  .style-swatch[data-style='inverted'] {
    background: var(--ink);
    color: var(--paper);
    font-weight: 700;
  }
  .style-swatch[data-style='dashed'] {
    border-style: dashed;
  }
  .style-swatch[data-style='muted'] {
    opacity: 0.4;
  }
  .style-swatch[data-style='striked'] {
    text-decoration: line-through;
  }
  .style-swatch[data-style='hidden'] {
    opacity: 0.25;
    filter: grayscale(1);
    text-decoration: line-through;
  }
  .rule-edit {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0.5em 0.6em 0.7em;
    border-top: 1px dashed var(--ink);
  }
  .field {
    display: grid;
    grid-template-columns: 6em 1fr;
    gap: 0.5em;
    align-items: center;
  }
  .field label {
    font-size: var(--fs-12);
    color: var(--ink-muted);
    user-select: none;
  }
  .field input,
  .field select {
    height: 32px;
    width: 100%;
    box-sizing: border-box;
  }
  .form-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4em;
    margin-top: 0.4em;
  }
  .form-actions .action-group {
    display: flex;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    gap: 0.4em;
  }
  .form-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 0;
    min-width: 0;
    height: 26px;
    padding: 0 0.6em;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: var(--fs-12);
    text-transform: uppercase;
    cursor: pointer;
  }
  .form-actions .delete-btn {
    border-color: var(--accent);
    color: var(--accent);
  }
  .form-actions .delete-btn:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .form-actions .delete-btn.confirming {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
  .form-actions .delete-btn.done {
    background: var(--paper);
    color: var(--ink);
    border-color: var(--ink);
  }
  .form-actions .disable-btn[data-state='disable'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .form-actions .disable-btn[data-state='disable']:hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .form-actions .disable-btn[data-state='enable']:hover {
    background: var(--paper-2);
  }
</style>
