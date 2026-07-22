<script lang="ts">
  import { flip } from 'svelte/animate';
  import IconButton from './IconButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import Icon from './Icon.svelte';
  import { config } from '../lib/state.svelte';
  import { createDragReorder, reorderFlipDuration } from '../lib/drag-reorder.svelte';
  import { CALENDAR_COLORS } from '../lib/types';
  import type { Block, CalendarColor, FeedCategory, FindReplaceRule, MatchPosition, StyleVariant } from '../lib/types';

  type RuleUpdates = {
    find: string;
    replace: string;
    style: StyleVariant;
    category: FeedCategory;
    color: CalendarColor | undefined;
    block: Block | undefined;
    position: MatchPosition;
    disabled: boolean;
  };

  type Props = {
    editingRuleId: string | null;
    onEditingChange: (id: string | null) => void;
    draftRule?: FindReplaceRule | null;
    onCommitDraft?: (updates: RuleUpdates) => void;
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
    { id: 'outline', label: 'Outline' },
    { id: 'bold', label: 'Bold' },
    { id: 'inverted', label: 'Solid' },
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

  const blockOptions: { id: Block; label: string }[] = [
    { id: 'none', label: 'N/A' },
    { id: 'global', label: 'Global' },
    { id: 'local', label: 'Local' },
    { id: 'off', label: 'No block' },
  ];

  const positionOptions: { id: MatchPosition; label: string }[] = [
    { id: 'start', label: 'Start' },
    { id: 'any', label: 'Any' },
    { id: 'end', label: 'End' },
  ];

  // Tracks the inline Delete confirm button so Cancel/Save can be gated
  // while a deletion is armed in its cooldown.
  let deleteState: 'idle' | 'confirm' | 'done' | 'undo' = $state('idle');

  let snapshot: FindReplaceRule | null = $state(null);
  let formFind = $state('');
  let formReplace = $state('');
  let formStyle = $state<StyleVariant>('none');
  let formCategory = $state<FeedCategory>('none');
  let formColor = $state<CalendarColor | ''>('');
  let formBlock = $state<Block>('none');
  let formPosition = $state<MatchPosition>('any');
  let formDisabled = $state(false);
  let listContainer: HTMLUListElement | undefined = $state();
  // 'Any' needs something to find; Start/End accept an empty Find (insert text).
  const saveDisabled = $derived(formPosition === 'any' && formFind === '');
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
    formCategory = rule.category ?? 'none';
    formColor = rule.color ?? '';
    formBlock = rule.block ?? 'none';
    formPosition = rule.position ?? 'any';
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

  // Direct enable/disable toggle (row eye + double-tap shortcut), applied
  // immediately.
  function toggleRuleDisabled(rule: FindReplaceRule): void {
    const idx = config.rules.findIndex((r) => r.id === rule.id);
    if (idx < 0) return;
    const cur = config.rules[idx]!;
    const next = { ...cur, disabled: !cur.disabled };
    config.rules = [...config.rules.slice(0, idx), next, ...config.rules.slice(idx + 1)];
    // If this rule's edit form is open, keep the snapshot (cancel-revert) and the
    // form flag aligned so the live toggle isn't undone on Save/Cancel.
    if (snapshot && snapshot.id === rule.id) snapshot = { ...snapshot, disabled: next.disabled };
    if (editingRuleId === rule.id) formDisabled = next.disabled;
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
    if (saveDisabled) return;
    if (isEditingDraft) {
      onCommitDraft?.({ find: formFind, replace: formReplace, style: formStyle, category: formCategory, color: formColor || undefined, block: formBlock !== 'none' ? formBlock : undefined, position: formPosition, disabled: formDisabled });
      snapshot = null;
      return;
    }
    const idx = config.rules.findIndex((r) => r.id === editingRuleId);
    if (idx < 0) {
      onEditingChange(null);
      snapshot = null;
      return;
    }
    const next: FindReplaceRule = {
      ...config.rules[idx]!,
      find: formFind,
      replace: formReplace,
      style: formStyle,
      category: formCategory,
      color: formColor || undefined,
      block: formBlock !== 'none' ? formBlock : undefined,
      position: formPosition !== 'any' ? formPosition : undefined,
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

  function commitRemoveRule(id: string): void {
    config.rules = config.rules.filter((r) => r.id !== id);
    if (editingRuleId === id) {
      snapshot = null;
      onEditingChange(null);
    }
  }

  // Ctrl/⌘+S saves the open filter form, mirroring the Save button — skipped
  // when Save is disabled (empty 'Any' find, or the delete-confirm cooldown).
  $effect(() => {
    if (editingRuleId === null || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (saveDisabled || deleteState === 'done' || deleteState === 'undo') return;
        saveEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Drag-reorder: rebuild config.rules to match the dragged id order (array
  // position IS the apply order — rules run top-to-bottom).
  function applyRuleOrder(orderedIds: string[]): void {
    const byId = new Map(config.rules.map((r) => [r.id, r]));
    config.rules = orderedIds.map((id) => byId.get(id)).filter((r): r is FindReplaceRule => !!r);
  }

  let ruleRowEls: Record<string, HTMLLIElement> = {};
  const ruleDnd = createDragReorder({
    getOrderedIds: () => config.rules.map((r) => r.id),
    getRowEl: (id) => ruleRowEls[id],
    onReorder: applyRuleOrder,
  });

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
            <span
              class="style-swatch"
              data-style={formStyle}
              data-cal-color={formColor || null}
              aria-label={styleLabel(formStyle)}
              title={styleLabel(formStyle)}
            >K</span>
            <span class="rule-preview">NEW FILTER</span>
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
            <span class="field-label" id="rule-pos-{draftRule.id}-label">Position</span>
            <div class="segmented" role="radiogroup" aria-labelledby="rule-pos-{draftRule.id}-label">
              {#each positionOptions as p (p.id)}
                <button type="button" class="segmented-btn" role="radio" aria-checked={formPosition === p.id} onclick={() => (formPosition = p.id)}>{p.label}</button>
              {/each}
            </div>
          </div>
          <div class="field">
            <label for="rule-cat-{draftRule.id}">Type</label>
            <select id="rule-cat-{draftRule.id}" bind:value={formCategory}>
              {#each categoryOptions as o (o.id)}
                <option value={o.id}>{o.label}</option>
              {/each}
            </select>
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
            <label for="rule-color-{draftRule.id}">Color</label>
            <select id="rule-color-{draftRule.id}" class="color-select" data-color={formColor || null} bind:value={formColor}>
              <option value="">No color</option>
              {#each CALENDAR_COLORS as c (c)}
                <option value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label for="rule-block-{draftRule.id}">Block</label>
            <select id="rule-block-{draftRule.id}" bind:value={formBlock}>
              {#each blockOptions as b (b.id)}
                <option value={b.id}>{b.label}</option>
              {/each}
            </select>
          </div>
          <div class="form-actions">
            <button type="button" onclick={cancelEdit}>Cancel</button>
            <button type="submit" class="primary" disabled={saveDisabled}>Save</button>
          </div>
        </form>
      </li>
    {/if}
    {#each config.rules as rule (rule.id)}
      <!-- While this rule's edit form is open, the swatch previews the form's
           (unsaved) style and colour so changes show live in the header. -->
      {@const swatchStyle = editingRuleId === rule.id ? formStyle : rule.style}
      {@const swatchColor = (editingRuleId === rule.id ? formColor : rule.color) || null}
      <li
        bind:this={ruleRowEls[rule.id]}
        data-rule-card={rule.id}
        data-active={editingRuleId === rule.id ? 'true' : null}
        data-dragging={ruleDnd.draggingId === rule.id ? 'true' : null}
        animate:flip={{ duration: reorderFlipDuration() }}
      >
        <div class="rule-row">
          <IconButton
            icon={rule.disabled ? 'eye-off' : 'eye'}
            label={(rule.disabled ? 'Enable' : 'Disable') + ' rule'}
            variant="ghost"
            size={16}
            onclick={() => toggleRuleDisabled(rule)}
          />
          <button
            type="button"
            class="rule-name-btn"
            data-disabled={rule.disabled ? 'true' : null}
            aria-label={'Edit rule ' + previewText(rule) + ' (double-tap to enable/disable)'}
            aria-expanded={editingRuleId === rule.id}
            onclick={() => (editingRuleId === rule.id ? cancelEdit() : startEdit(rule))}
            ondblclick={() => toggleRuleDisabled(rule)}
          >
            <span
              class="style-swatch"
              data-style={swatchStyle}
              data-cal-color={swatchColor}
              aria-label={styleLabel(swatchStyle)}
              title={styleLabel(swatchStyle)}
            >K</span>
            <span class="rule-preview">{previewText(rule)}</span>
          </button>
          <button
            type="button"
            class="drag-handle"
            aria-label={'Drag to reorder rule ' + previewText(rule)}
            title="Drag to reorder"
            onpointerdown={(e) => ruleDnd.startDrag(e, rule.id)}
          >
            <Icon name="grip" size={16} />
          </button>
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
              <span class="field-label" id="rule-pos-{rule.id}-label">Position</span>
              <div class="segmented" role="radiogroup" aria-labelledby="rule-pos-{rule.id}-label">
                {#each positionOptions as p (p.id)}
                  <button type="button" class="segmented-btn" role="radio" aria-checked={formPosition === p.id} onclick={() => (formPosition = p.id)}>{p.label}</button>
                {/each}
              </div>
            </div>
            <div class="field">
              <label for="rule-cat-{rule.id}">Type</label>
              <select id="rule-cat-{rule.id}" bind:value={formCategory}>
                {#each categoryOptions as o (o.id)}
                  <option value={o.id}>{o.label}</option>
                {/each}
              </select>
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
              <label for="rule-color-{rule.id}">Color</label>
              <select id="rule-color-{rule.id}" class="color-select" data-color={formColor || null} bind:value={formColor}>
                <option value="">No color</option>
                {#each CALENDAR_COLORS as c (c)}
                  <option value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label for="rule-block-{rule.id}">Block</label>
              <select id="rule-block-{rule.id}" bind:value={formBlock}>
                {#each blockOptions as b (b.id)}
                  <option value={b.id}>{b.label}</option>
                {/each}
              </select>
            </div>
            <div class="form-actions rule-form-actions">
              <div class="action-group">
                <ConfirmButton
                  bind:state={deleteState}
                  label="Delete"
                  variant="delete"
                  height={26}
                  hpad="0.6em"
                  grow
                  doneTitle="Tap to undo deletion"
                  onCommit={() => commitRemoveRule(rule.id)}
                />
              </div>
              <div class="action-group">
                <button
                  type="button"
                  onclick={cancelEdit}
                  disabled={deleteState === 'done' || deleteState === 'undo'}
                >Cancel</button>
                <button
                  type="submit"
                  class="primary"
                  disabled={saveDisabled || deleteState === 'done' || deleteState === 'undo'}
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
    background: var(--paper-color);
  }
  .rule-list:empty {
    display: none;
  }
  .rule-list li {
    /* Breathing room when a card is scrolled into view (start-aligned), so its
       top border doesn't sit flush against the header — matches the settings
       panel body's 1em padding. */
    scroll-margin-top: 1em;
  }
  .rule-list li + li {
    border-top: var(--border-w) solid var(--ink-color);
  }
  .rule-list li[data-active='true'] + li,
  .rule-list li[data-active='true'] {
    border-top-color: transparent;
  }
  .rule-list li[data-active='true'] {
    outline: 2px solid var(--ink-color);
    outline-offset: -2px;
  }
  .rule-list li[data-active='true'] .rule-name-btn .rule-preview {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* The row being dragged lifts above its neighbours (which slide via flip),
     marked by a dashed outline rather than a drop shadow. */
  .rule-list li[data-dragging='true'] {
    position: relative;
    z-index: 2;
    background: var(--paper-color);
    outline: 1px dashed var(--ink-color);
    outline-offset: -1px;
  }
  /* Drag handle — a grip the whole row is reordered by (pointer-based, so it
     works on touch). touch-action:none keeps a touch-drag from scrolling. */
  .drag-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    cursor: grab;
    touch-action: none;
    flex-shrink: 0;
  }
  .drag-handle:active {
    cursor: grabbing;
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
  /* Match the calendar feed-name button: underline on hover (no fill);
     focus-visible underline is handled above. */
  .rule-name-btn:hover .rule-preview {
    text-decoration: underline;
    text-underline-offset: 2px;
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
  /* .style-swatch (the "K" style/colour preview) is shared in global.css. */
  .rule-edit {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0.5em 0.6em 0.7em;
    border-top: var(--border-w) dashed var(--ink-color);
  }
  /* Match the Calendars settings baseline (SettingsPanel .field). */
  /* Line the label/control split up with the 4-button action row below (Delete
     · Disable · Cancel · Save, each flex 1fr with three 0.4em gaps): the label
     spans one button (Delete) and the control spans the other three plus gaps.
     Matches SettingsPanel's calendar edit form. */
  .field {
    display: grid;
    grid-template-columns: calc((100% - 1.2em) / 4) 1fr;
    column-gap: 0.4em;
    align-items: center;
  }
  .field label,
  .field .field-label {
    font-size: var(--fs-13);
    color: var(--ink-color);
    user-select: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Three-way Start/Any/End toggle — mirrors SettingsPanel's segmented control. */
  .segmented {
    display: flex;
    width: 100%;
  }
  .segmented-btn {
    flex: 1 1 0;
    min-width: 0;
    height: 32px;
    padding: 0 0.9em;
    border: var(--btn-border-w) solid var(--ink-color);
    border-radius: 0;
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
  }
  .segmented-btn + .segmented-btn {
    border-left-width: 0;
  }
  .segmented-btn:first-of-type {
    border-top-left-radius: var(--btn-radius);
    border-bottom-left-radius: var(--btn-radius);
  }
  .segmented-btn:last-of-type {
    border-top-right-radius: var(--btn-radius);
    border-bottom-right-radius: var(--btn-radius);
  }
  .segmented-btn[aria-checked='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .field input,
  .field select {
    /* Height in em so the box grows with the font setting — a fixed 32px clips
       the (root-sized) input text at 18/20px (matches SettingsPanel). */
    min-height: 2.25em;
    width: 100%;
    box-sizing: border-box;
  }
  /* Color preview swatch on the select, mirroring SettingsPanel's .color-select. */
  .color-select[data-color='peach'] { background: var(--cal-peach-bg); }
  .color-select[data-color='amber'] { background: var(--cal-amber-bg); }
  .color-select[data-color='mint'] { background: var(--cal-mint-bg); }
  .color-select[data-color='teal'] { background: var(--cal-teal-bg); }
  .color-select[data-color='sky'] { background: var(--cal-sky-bg); }
  .color-select[data-color='lavender'] { background: var(--cal-lavender-bg); }
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
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    font-size: var(--fs-12);
    text-transform: uppercase;
    cursor: pointer;
  }
  /* Save shares its action group equally with Cancel, so the two match width. */
  .form-actions button.primary {
    flex: 1 1 0;
  }
</style>
