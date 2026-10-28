<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { ui, config, zoom, clearSelection, pushLog, localLanesForShare } from '../lib/state.svelte';
  import { markerValue } from '../lib/url';
  import { buildShareUrl, SHARE_URL_LIMIT, tryNativeShare } from '../lib/share';
  import { canCheckPins, hashPin, isPinHash, isPinShape, pinLength, PIN_LENGTH, verifyPin } from '../lib/kiosk-pin';

  let dialog: HTMLDialogElement | undefined = $state();
  let digits = $state<string[]>([]);
  // Hashing or checking a PIN (deliberately slow, ~0.3s).
  let busy = $state(false);
  let error = $state('');
  let lockFlash = $state(false);
  let shareFlash = $state(false);
  let lockTimer: ReturnType<typeof setTimeout> | null = null;
  let shareTimer: ReturnType<typeof setTimeout> | null = null;
  let swipeStartY: number | null = null;
  let dismissing = $state(false);
  const inputs: (HTMLInputElement | undefined)[] = [];

  const mode = $derived(ui.kioskPinModal);
  // New PINs are 6 digits; a kiosk locked with an older 4-digit PIN unlocks with 4.
  const length = $derived(mode === 'unlock' ? pinLength(config.kioskPin) : PIN_LENGTH);
  const pin = $derived(digits.join(''));
  const complete = $derived(isPinShape(pin, length));

  // Build the link ahead of the tap, as Settings does: the Share button can then
  // be disabled when the setup is too long for a link, and navigator.share runs
  // straight from the click (Safari drops the user activation it needs across
  // the async compression). Reading config here tracks the PIN too — a complete
  // PIN's hash is written to config.kioskPin as a preview lock, and the link
  // carries that hash, never the PIN.
  let shareUrl = $state('');
  let shareUrlSeq = 0;
  $effect(() => {
    const seq = ++shareUrlSeq;
    if (mode !== 'set' || !complete || !isPinHash(config.kioskPin)) {
      shareUrl = '';
      return;
    }
    const lanes = localLanesForShare();
    const marker = markerValue(ui.tempMarkerMs, ui.tempMarkerEndMs);
    void buildShareUrl(config, zoom.value, undefined, lanes, marker).then((url) => {
      if (seq === shareUrlSeq) shareUrl = url;
    });
  });
  const shareTooLong = $derived(shareUrl.length > SHARE_URL_LIMIT);

  $effect(() => {
    if (!dialog) return;
    if (mode && !dialog.open) {
      digits = Array<string>(length).fill('');
      busy = false;
      error = '';
      lockFlash = false;
      shareFlash = false;
      dismissing = false;
      swipeStartY = null;
      dialog.showModal();
      queueMicrotask(() => inputs[0]?.focus());
    }
    if (!mode && dialog.open) dialog.close();
  });

  // Set mode only opens while the app is unlocked, so reverting here can never
  // bypass an existing lock. Once the last digit lands, setDigit()->doLock()
  // places a "preview" lock; if the PIN then loses a digit, undo it.
  // Strictly gated to 'set' — when the modal is closed `mode` is null and when
  // it's an unlock attempt `mode` is 'unlock'; clearing the PIN in either case
  // would unlock an active lock with no PIN check.
  $effect(() => {
    if (mode !== 'set') return;
    if (!complete && config.kioskPin != null) config.kioskPin = null;
  });

  function setDigit(i: number, raw: string): void {
    const d = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    digits = next;
    if (d && i < length - 1) inputs[i + 1]?.focus();
    // Once the last digit is in, act automatically: lock, or try to unlock.
    if (d && next.every((c) => c !== '')) {
      queueMicrotask(() => {
        if (mode === 'unlock') void doUnlock();
        else void doLock();
      });
    }
  }

  function onInput(i: number, e: Event): void {
    const t = e.currentTarget as HTMLInputElement;
    setDigit(i, t.value);
    t.value = digits[i] ?? '';
  }

  function onKeydown(i: number, e: KeyboardEvent): void {
    if (e.key === 'Backspace') {
      const next = [...digits];
      if (next[i]) {
        next[i] = '';
      } else if (i > 0) {
        inputs[i - 1]?.focus();
        next[i - 1] = '';
      }
      digits = next;
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      inputs[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      inputs[i + 1]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'unlock') void doUnlock();
      else void doLock();
    }
  }

  function cancel(): void {
    ui.kioskPinModal = null;
  }

  // Bottom-left button. In set mode it reads CLOSE once a full PIN is in (the
  // app auto-locks at the last digit) and just dismisses; while the PIN is
  // incomplete it reads CANCEL and also clears any PIN committed this session,
  // returning the app to unlocked. In unlock mode it always just closes.
  function cancelButton(): void {
    if (mode !== 'unlock' && !complete) {
      config.kioskPin = null;
    }
    ui.kioskPinModal = null;
  }

  // Swipe-up to dismiss, matching EventModal.
  function onDialogPointerDown(e: PointerEvent): void {
    if (dismissing) return;
    swipeStartY = e.clientY;
  }
  function onDialogPointerUp(e: PointerEvent): void {
    if (swipeStartY == null || dismissing) return;
    const dy = swipeStartY - e.clientY;
    swipeStartY = null;
    if (dy > 80) dismissing = true;
  }
  function onDialogPointerCancel(): void {
    swipeStartY = null;
  }
  function onDialogTransitionEnd(e: TransitionEvent): void {
    if (e.target !== dialog) return;
    if (dismissing && e.propertyName === 'transform') cancel();
  }

  async function doLock(): Promise<void> {
    if (!complete) {
      error = `Enter a ${length}-digit PIN`;
      return;
    }
    const typed = pin;
    // A lock from an earlier PIN must not outlive the edit: drop it while the
    // new one hashes, or Share would hand out the old PIN's link meanwhile.
    config.kioskPin = null;
    busy = true;
    let hashed: string;
    try {
      hashed = await hashPin(typed);
    } catch {
      error = canCheckPins() ? 'Could not set the PIN' : 'Kiosk mode needs the app opened over https';
      return;
    } finally {
      busy = false;
    }
    // Reopened or turned to unlock meanwhile: that PIN no longer stands. A
    // dialog closed with the PIN complete still locks, as it did at the last
    // digit before PINs were hashed.
    if (mode === 'unlock' || pin !== typed) return;
    config.kioskPin = hashed;
    clearSelection();
    // Stay open so the user can still SHARE the link; flash a checkmark.
    lockFlash = true;
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { lockFlash = false; }, 2000);
  }

  async function share(): Promise<void> {
    if (!complete) {
      error = `Enter a ${length}-digit PIN`;
      return;
    }
    // Built only once the lock (the PIN's hash) is in place.
    const url = shareUrl;
    if (!url) return;
    clearSelection();
    try {
      const result = await tryNativeShare(url);
      // 'dismissed' — user cancelled the share sheet; skip the clipboard fallback
      // (writeText throws "Document is not focused" until focus returns).
      if (result === 'shared' || result === 'dismissed') return;
      await navigator.clipboard.writeText(url);
      pushLog(
        result === 'stuck'
          ? 'Link copied — refresh to open the share sheet again'
          : 'Kiosk link copied',
      );
      shareFlash = true;
      if (shareTimer) clearTimeout(shareTimer);
      shareTimer = setTimeout(() => { shareFlash = false; }, 2000);
    } catch {
      pushLog('Copy failed', 'error');
    }
  }

  async function doUnlock(): Promise<void> {
    if (!complete) {
      error = `Enter your ${length}-digit PIN`;
      return;
    }
    if (busy) return;
    const typed = pin;
    busy = true;
    let ok = false;
    try {
      ok = await verifyPin(typed, config.kioskPin);
    } catch {
      ok = false;
    } finally {
      busy = false;
    }
    if (mode !== 'unlock') return;
    if (ok) {
      config.kioskPin = null;
      ui.kioskPinModal = null;
    } else if (pin === typed) {
      // Not when the dialog was reopened meanwhile: that would wipe new digits.
      error = 'Incorrect PIN';
      digits = Array<string>(length).fill('');
      queueMicrotask(() => inputs[0]?.focus());
    }
  }
</script>

<dialog
  bind:this={dialog}
  class:dismissing
  onclose={cancel}
  onpointerdown={onDialogPointerDown}
  onpointerup={onDialogPointerUp}
  onpointercancel={onDialogPointerCancel}
  ontransitionend={onDialogTransitionEnd}
>
  {#if mode}
    <article>
      <header>
        <h2>{mode === 'unlock' ? 'Unlock Kiosk Mode' : 'Set PIN for Kiosk Mode'}</h2>
        <IconButton icon="close" label="Close" variant="ghost" onclick={cancel} />
      </header>
      <div class="pin-row">
        {#each digits as digit, i (i)}
          <input
            bind:this={inputs[i]}
            class="pin-box"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            maxlength="1"
            aria-label="PIN digit {i + 1}"
            disabled={busy}
            value={digit}
            oninput={(e) => onInput(i, e)}
            onkeydown={(e) => onKeydown(i, e)}
            onfocus={(e) => e.currentTarget.select()}
          />
        {/each}
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions">
        <button type="button" class="cancel" onclick={cancelButton}>{mode !== 'unlock' && complete ? 'Close' : 'Cancel'}</button>
        <span class="actions-right">
          {#if mode === 'unlock'}
            <button type="button" class="primary" disabled={!complete || busy} onclick={() => void doUnlock()}>Unlock</button>
          {:else}
            <button
              type="button"
              disabled={!complete || !shareUrl}
              title={shareTooLong ? `Long link (${shareUrl.length} of ${SHARE_URL_LIMIT} chars) — some apps cut links that long` : 'Share kiosk link'}
              onclick={() => void share()}
            >{shareFlash ? 'Share ✓' : 'Share'}</button>
            <button type="button" class="primary" disabled={!complete || busy} onclick={() => void doLock()}>{lockFlash ? 'Lock ✓' : 'Lock'}</button>
          {/if}
        </span>
      </div>
    </article>
  {/if}
</dialog>

<style>
  dialog {
    border: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    padding: 0;
    width: min(360px, calc(100vw - 1rem));
    box-sizing: border-box;
    transition: transform 150ms ease-in, opacity 150ms ease-in;
  }
  dialog.dismissing {
    transform: translateY(-100vh);
    opacity: 0;
  }
  dialog::backdrop {
    background: var(--backdrop-dim);
    backdrop-filter: blur(2px);
    transition: background 150ms ease-in, backdrop-filter 150ms ease-in;
  }
  dialog.dismissing::backdrop {
    background: rgba(0, 0, 0, 0);
    backdrop-filter: blur(0);
  }
  article {
    padding: 1em;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5em;
    margin-bottom: 0.5em;
  }
  h2 {
    margin: 0;
    font-size: 1.05em;
  }
  .pin-row {
    display: flex;
    gap: 0.4em;
    justify-content: center;
    margin-bottom: 0.75em;
  }
  .pin-box {
    /* Six to a row, shrinking on a narrow phone rather than overflowing. */
    flex: 0 1 44px;
    min-width: 0;
    height: 56px;
    text-align: center;
    font-family: var(--mono);
    font-size: 1.6em;
    border: var(--btn-border-w) solid var(--ink-color);
    border-radius: var(--btn-radius);
    background: var(--paper-color);
    color: var(--ink-color);
    box-sizing: border-box;
  }
  .pin-box:focus {
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
    background: var(--paper-2);
  }
  .error {
    margin: 0 0 0.75em 0;
    font-size: var(--fs-12);
    color: var(--accent-color);
    text-align: center;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
  }
  .actions-right {
    display: inline-flex;
    gap: 0.5em;
  }
  .actions button {
    height: 32px;
    padding: 0 12px;
    border: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .actions .primary {
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
  }
</style>
