<script lang="ts">
  import Icon from './Icon.svelte';

  type Props = {
    icon: string;
    label: string;
    pressed?: boolean;
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    title?: string;
    variant?: 'default' | 'ghost';
    size?: number;
  };
  const {
    icon,
    label,
    pressed,
    disabled,
    onclick,
    title,
    variant = 'default',
    size = 20,
  }: Props = $props();

  function handleClick(e: MouseEvent): void {
    if (disabled) return;
    onclick?.(e);
  }
</script>

<button
  type="button"
  class="icon-button"
  data-variant={variant}
  aria-label={label}
  aria-pressed={pressed === undefined ? undefined : pressed}
  title={title ?? label}
  {disabled}
  onclick={handleClick}
>
  <Icon name={icon} {size} />
</button>

<style>
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    flex-shrink: 0;
  }
  .icon-button[data-variant='ghost'] {
    border-color: transparent;
    background: transparent;
  }
  /* Hover cue is the accent text/icon tint from the global button:hover rule — no fill. */
  .icon-button[aria-pressed='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .icon-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
  /* Ghost (the feed-row prev/next): no border at all when disabled, and fade
     further so a single-event row's nav recedes. */
  .icon-button[data-variant='ghost']:disabled {
    border-color: transparent;
    opacity: 0.28;
  }
</style>
