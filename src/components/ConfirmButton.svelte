<script lang="ts">
  import Icon from './Icon.svelte';

  type State = 'idle' | 'confirm' | 'done' | 'undo';
  type Props = {
    label: string;
    variant?: 'delete' | 'neutral';
    /** 3 = idle→confirm→done→undo(cooldown→commit); 2 = idle→confirm→commit (no undo). */
    stages?: 2 | 3;
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
    confirmIcon = 'question',
    doneIcon = 'check',
    idleTitle,
    confirmTitle,
    doneTitle,
    disabledTitle,
    state: phase = $bindable('idle'),
    onpointerdown,
    onpointerup,
    onpointercancel,
    onpointerleave,
  }: Props = $props();

  // Timing of the post-confirm sequence for a 3-stage (delete) button:
  // ✓ holds for DONE_HOLD_MS, then a live "UNDO n" countdown ticks UNDO_SECONDS
  // down to 1 (one tick a second) before committing — total ≈ 4s.
  const CONFIRM_WINDOW_MS = 3000; // ? auto-reverts to idle if left untouched
  const DONE_HOLD_MS = 1000; // ✓ visible before the undo countdown opens
  const UNDO_SECONDS = 3; // "UNDO 3 → 2 → 1" countdown; commit after it elapses
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  // Seconds left in the undo window; shown next to the "UNDO" label so the
  // closing affordance is visible without relying on a (motion-gated) animation.
  let undoCount = $state(0);

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  /** Drop any pending action and return to idle WITHOUT committing. */
  export function reset(): void {
    clearTimer();
    phase = 'idle';
  }

  function onClick(): void {
    if (disabled) return;
    if (stages === 2) {
      if (phase === 'confirm') {
        clearTimer();
        phase = 'idle';
        onConfirm?.();
        return;
      }
      phase = 'confirm';
      clearTimer();
      timer = setTimeout(() => {
        phase = 'idle';
        timer = null;
      }, CONFIRM_WINDOW_MS);
      return;
    }
    // 3-stage
    if (phase === 'done' || phase === 'undo') {
      // A click anytime in the post-confirm window undoes the (deferred) action.
      clearTimer();
      onUndo?.();
      phase = 'idle';
      return;
    }
    if (phase === 'confirm') {
      // Confirmed: hold ✓ for a beat, then run the "UNDO n" countdown, and
      // commit only when it reaches zero untouched.
      clearTimer();
      phase = 'done';
      onArm?.();
      timer = setTimeout(() => {
        timer = null;
        phase = 'undo';
        undoCount = UNDO_SECONDS;
        interval = setInterval(() => {
          undoCount -= 1;
          if (undoCount <= 0) {
            clearTimer();
            phase = 'idle';
            onCommit?.();
          }
        }, 1000);
      }, DONE_HOLD_MS);
      return;
    }
    // idle → arm the confirm
    clearTimer();
    phase = 'confirm';
    timer = setTimeout(() => {
      phase = 'idle';
      timer = null;
    }, CONFIRM_WINDOW_MS);
  }

  $effect(() => () => clearTimer());

  const iconName = $derived(
    phase === 'confirm' ? confirmIcon : phase === 'done' ? doneIcon : null,
  );
  // In the undo window the label switches to "Undo" and the countdown number
  // takes the icon slot (so width stays reserved by the original label).
  const currentLabel = $derived(phase === 'undo' ? 'Undo' : label);
  const currentTitle = $derived(
    disabled
      ? disabledTitle
      : phase === 'confirm'
        ? confirmTitle
        : phase === 'done' || phase === 'undo'
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
    phase === 'confirm'
      ? `${label} — tap again to confirm`
      : phase === 'done' || phase === 'undo'
        ? `${label} confirmed — tap to undo`
        : label,
  );
</script>

<button
  type="button"
  class="confirm-btn"
  data-variant={variant}
  data-state={phase}
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
    <span class="cb-current" aria-hidden="true">{currentLabel}{#if phase === 'undo'}&nbsp;<span class="cb-count" style="width: {size}px; height: {size}px">{undoCount}</span>{:else if iconName}&nbsp;<Icon name={iconName} {size} />{/if}</span>
  </span>
  <span class="cb-sr">{statusPhrase}</span>
</button>

<style>
  .confirm-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--btn-border-w) solid var(--ink-color);
    border-radius: var(--btn-radius);
    background: var(--paper-color);
    color: var(--ink-color);
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
  /* The undo countdown sits in the icon slot. Its number ticks once a second,
     so the closing window is visible without a (motion-gated) animation. */
  .cb-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    font-variant-numeric: tabular-nums;
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
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  /* No hover fill — idle delete already reads in accent; the confirm state below carries the fill. */
  .confirm-btn[data-variant='delete'][data-state='confirm'] {
    background: var(--accent-color);
    color: var(--paper-color);
    border-color: var(--accent-color);
  }
  .confirm-btn[data-variant='neutral'][data-state='idle'] {
    border-color: var(--ink-color);
    color: var(--ink-color);
  }
  /* Hover cue is the accent text tint from the global button:hover rule — no fill. */
  .confirm-btn[data-variant='neutral'][data-state='confirm'] {
    background: var(--ink-color);
    color: var(--paper-color);
    border-color: var(--ink-color);
  }
  /* Done/undo cooldown looks the same for both variants: ink outline on paper. */
  .confirm-btn[data-state='done'],
  .confirm-btn[data-state='undo'] {
    background: var(--paper-color);
    color: var(--ink-color);
    border-color: var(--ink-color);
  }
  .confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
</style>
