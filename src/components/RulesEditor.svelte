<script lang="ts">
  import IconButton from './IconButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import { config } from '../lib/state.svelte';
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
            <span
              class="style-swatch"
              data-style={rule.style}
              aria-label={styleLabel(rule.style)}
              title={styleLabel(rule.style)}
            >α</span>
            <span class="rule-preview">{previewText(rule)}</span>
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
                <button
                  type="button"
                  class="disable-btn"
                  data-state={formDisabled ? 'enable' : 'disable'}
                  onclick={() => {
                    toggleRuleDisabled(rule);
                    formDisabled = !formDisabled;
                    if (snapshot) snapshot = { ...snapshot, disabled: formDisabled };
                  }}
                ><span class="act-stack"><span class="act-sizer" aria-hidden="true">Disable</span><span>{formDisabled ? 'Enable' : 'Disable'}</span></span></button>
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
    background: var(--paper);
  }
  .rule-list:empty {
    display: none;
  }
  .rule-list li + li {
    border-top: var(--border-w) solid var(--ink);
  }
  .rule-list li[data-active='true'] + li,
  .rule-list li[data-active='true'] {
    border-top-color: transparent;
  }
  .rule-list li[data-active='true'] {
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
  /* Mini event-label preview: an "α" styled like a pill of the given style,
     with its border reflecting the style. */
  .style-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border: var(--border-w) solid var(--ink);
    background: transparent;
    color: var(--ink);
    box-sizing: border-box;
    font-size: var(--fs-11);
    font-weight: 400;
    line-height: 1;
  }
  .style-swatch[data-style='bold'] {
    border-width: calc(var(--border-w) + 1px);
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
    border-top: var(--border-w) dashed var(--ink);
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
    color: var(--ink);
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
    border: var(--btn-border-w) solid var(--ink);
    border-radius: 0;
    background: var(--paper);
    color: var(--ink);
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
    background: var(--ink);
    color: var(--paper);
  }
  .field input,
  .field select {
    height: 32px;
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
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: var(--fs-12);
    text-transform: uppercase;
    cursor: pointer;
  }
  /* Save shares its action group equally with Cancel, so the two match width. */
  .form-actions button.primary {
    flex: 1 1 0;
  }
  /* Reserve the wider word so Enable/Disable never changes size; current label
     is centered over the hidden sizer. */
  .form-actions .act-stack {
    display: inline-grid;
  }
  .form-actions .act-stack > * {
    grid-area: 1 / 1;
    text-align: center;
  }
  .form-actions .act-sizer {
    visibility: hidden;
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
