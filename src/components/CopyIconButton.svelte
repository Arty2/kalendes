<script lang="ts">
  // Icon-only copy button (event modal + tray): the copy glyph swaps to a
  // checkmark while `copied` is set, instead of a text label flashing.
  import Icon from './Icon.svelte';

  type Props = {
    copied: boolean;
    label: string;
    onclick: () => void;
    el?: HTMLButtonElement | null;
    disabled?: boolean;
  };
  let { copied, label, onclick, el = $bindable(null), disabled = false }: Props = $props();
</script>

<button
  type="button"
  class="copy-icon-btn"
  bind:this={el}
  {onclick}
  {disabled}
  title={copied ? 'Copied' : label}
  aria-label={copied ? 'Copied' : label}
  data-copied={copied ? 'true' : null}
>
  <Icon name={copied ? 'check' : 'copy'} size={16} />
</button>

<style>
  /* Same square as the add-to-calendar trigger beside it. */
  .copy-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
  }
  .copy-icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
</style>
