<script lang="ts">
  import Icon from './Icon.svelte';

  type State = 'idle' | 'confirm' | 'done' | 'undo';
  type Props = {
    label: string;
    variant?: 'delete' | 'neutral';
    /** 3 = idle→confirm→done(cooldown)→undo; 2 = idle→confirm→commit (no undo). */
    stages?: 2 | 3;
    cooldownMs?: number;
    disabled?: boolean;
    /** Icon px; tuned to read at the button's 1px stroke weight for --fs-12 text. */
    size?: number;
    /** Fixed button height (px) to match neighbouring buttons; default natural. */
    height?: number;
    /** Horizontal padding (CSS length) to match neighbours; default 0.7em. */
    hpad?: string;
    /** flex:1 1 0 so it shares width equally with sibling buttons (form actions). */
    grow?: boolean;
    /** width:100% to fill a grid/block container (config actions). */
    block?: boolean;
    /** Font-size override (CSS length) to match neighbours; default --fs-12. */
    fontSize?: string;
    /** 3-stage: fired when the cooldown elapses untouched — do the mutation here. */
    onCommit?: () => void;
    /** 3-stage: fired on a tap during the cooldown (commit was deferred, so usually a no-op). */
    onUndo?: () => void;
    /** 3-stage: fired when entering the done state — latch any volatile target here. */
    onArm?: () => void;
    /** 2-stage: fired on the confirming tap (commits immediately). */
    onConfirm?: () => void;
    confirmIcon?: string;
    doneIcon?: string;
    undoIcon?: string;
    idleTitle?: string;
    confirmTitle?: string;
    doneTitle?: string;
    disabledTitle?: string;
    /** Bindable so callers can gate sibling controls on the 'done' cooldown. */
    state?: State;
    onpointerdown?: (e: PointerEvent) => void;
    onpointerup?: (e: PointerEvent) => void;
    onpointercancel?: (e: PointerEvent) => void;
    onpointerleave?: (e: PointerEvent) => void;
  };
  let {
    label,
    variant = 'delete',
    stages = 3,
    cooldownMs = 3000,
    disabled = false,
    size = 13,
    height,
    hpad,
    grow = false,
    block = false,
    fontSize,
    onCommit,
    onUndo,
    onArm,
    onConfirm,
    confirmIcon = 'help',
    doneIcon = 'check',
    undoIcon = 'undo',
    idleTitle,
    confirmTitle,
    doneTitle,
    disabledTitle,
    state = $bindable('idle'),
    onpointerdown,
    onpointerup,
    onpointercancel,
    onpointerleave,
  }: Props = $props();

  // The undo flash is brief — long enough to register the ↺, then back to idle.
  const UNDO_FLASH_MS = 800;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Drop any pending action and return to idle WITHOUT committing. */
  export function reset(): void {
    clearTimer();
    state = 'idle';
  }

  function onClick(): void {
    if (disabled) return;
    if (stages === 2) {
      if (state === 'confirm') {
        clearTimer();
        state = 'idle';
        onConfirm?.();
        return;
      }
      state = 'confirm';
      clearTimer();
      timer = setTimeout(() => {
        state = 'idle';
        timer = null;
      }, cooldownMs);
      return;
    }
    // 3-stage
    if (state === 'done') {
      // Tap during the cooldown undoes the (still-deferred) action.
      clearTimer();
      state = 'undo';
      onUndo?.();
      timer = setTimeout(() => {
        state = 'idle';
        timer = null;
      }, UNDO_FLASH_MS);
      return;
    }
    if (state === 'confirm') {
      clearTimer();
      state = 'done';
      onArm?.();
      timer = setTimeout(() => {
        state = 'idle';
        timer = null;
        onCommit?.();
      }, cooldownMs);
      return;
    }
    // idle (or mid-undo flash) → arm the confirm
    clearTimer();
    state = 'confirm';
    timer = setTimeout(() => {
      state = 'idle';
      timer = null;
    }, cooldownMs);
  }

  $effect(() => () => clearTimer());

  const iconName = $derived(
    state === 'confirm'
      ? confirmIcon
      : state === 'done'
        ? doneIcon
        : state === 'undo'
          ? undoIcon
          : null,
  );
  const currentTitle = $derived(
    disabled
      ? disabledTitle
      : state === 'confirm'
        ? confirmTitle
        : state === 'done'
          ? doneTitle
          : idleTitle,
  );
  const styleAttr = $derived(
    [
      height != null ? `height:${height}px;padding-top:0;padding-bottom:0` : '',
      hpad ? `padding-left:${hpad};padding-right:${hpad}` : '',
      grow ? 'flex:1 1 0;min-width:0' : '',
      block ? 'width:100%' : '',
      fontSize ? `font-size:${fontSize}` : '',
    ]
      .filter(Boolean)
      .join(';'),
  );
  const statusPhrase = $derived(
    state === 'confirm'
      ? `${label} — tap again to confirm`
      : state === 'done'
        ? `${label} — tap to undo within ${Math.round(cooldownMs / 1000)} seconds`
        : state === 'undo'
          ? `${label} undone`
          : label,
  );
</script>

<button
  type="button"
  class="confirm-btn"
  data-variant={variant}
  data-state={state}
  {disabled}
  title={currentTitle}
  style={styleAttr}
  onclick={onClick}
  {onpointerdown}
  {onpointerup}
  {onpointercancel}
  {onpointerleave}
>
  <span class="cb-stack">
    <span class="cb-sizer" aria-hidden="true">{label}&nbsp;<span class="cb-icon-box" style="width: {size}px; height: {size}px"></span></span>
    <span class="cb-current" aria-hidden="true">{label}{#if iconName}&nbsp;<Icon name={iconName} {size} />{/if}</span>
  </span>
  <span class="cb-sr">{statusPhrase}</span>
</button>

<style>
  .confirm-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--btn-border-w) solid var(--ink);
    border-radius: var(--btn-radius);
    background: var(--paper);
    color: var(--ink);
    padding: 0.3em 0.7em;
    font: inherit;
    font-size: var(--fs-12);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  /* Inline-grid overlay: the hidden sizer reserves label + nbsp + icon in every
     state, so the button width stays constant and the visible label+icon group
     stays centered with no unused padding. */
  .cb-stack {
    display: inline-grid;
  }
  .cb-stack > * {
    grid-area: 1 / 1;
  }
  .cb-sizer {
    visibility: hidden;
  }
  .cb-current,
  .cb-sizer {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .cb-icon-box {
    display: inline-block;
  }
  /* Screen-reader-only state announcement (icons are aria-hidden). */
  .cb-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .confirm-btn[data-variant='delete'][data-state='idle'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .confirm-btn[data-variant='delete'][data-state='idle']:not(:disabled):hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .confirm-btn[data-variant='delete'][data-state='confirm'] {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
  .confirm-btn[data-variant='neutral'][data-state='idle'] {
    border-color: var(--ink);
    color: var(--ink);
  }
  .confirm-btn[data-variant='neutral'][data-state='idle']:not(:disabled):hover {
    background: var(--paper-2);
  }
  .confirm-btn[data-variant='neutral'][data-state='confirm'] {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  /* Done/undo cooldown looks the same for both variants: ink outline on paper. */
  .confirm-btn[data-state='done'],
  .confirm-btn[data-state='undo'] {
    background: var(--paper);
    color: var(--ink);
    border-color: var(--ink);
  }
  .confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
</style>
