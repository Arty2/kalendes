import { config } from './state.svelte';

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

// A tiny dedicated AudioContext for the tap sound, kept separate from the music
// Easter egg so UI taps never pick up its echo or get suspended with it. Created
// lazily on first use — which is always inside a user gesture, so browsers let
// it start.
let clickCtx: AudioContext | null = null;

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

// Play the vibration rhythm as sound instead: one short, soft click per "on"
// pulse (even indices of a pattern array), at the pattern's cumulative offsets.
// So tap → one click, trayCollapse [12,40,12] / loading [40,120,40,120] → the
// same cadence in clicks. A standalone tap is treated as a single on-pulse.
function playTick(pattern: number | number[]): void {
  const Ctor = audioCtor();
  if (!Ctor) return;
  if (!clickCtx) clickCtx = new Ctor();
  if (clickCtx.state !== 'running') void clickCtx.resume();
  const pulses = Array.isArray(pattern) ? pattern : [pattern];
  // Small lookahead so the first blip isn't scheduled at the exact currentTime:
  // on Chrome for Android resume() lags the gesture, and a zero-offset note lands
  // while the context is still suspended and gets dropped (no sound). 0.02s is
  // imperceptible but lands safely after the context starts running.
  const start = clickCtx.currentTime + 0.02;
  let offsetMs = 0;
  for (let i = 0; i < pulses.length; i++) {
    if (i % 2 === 0) clickAt(clickCtx, start + offsetMs / 1000);
    offsetMs += pulses[i]!;
  }
}

// One percussive thump, like a fingertip tap rather than an electronic beep. Two
// layers: a low pitch-dropping sine "body" (~180→80 Hz) that gives the thump, and
// a very short higher-frequency attack "knock" (~600→300 Hz, ~25 ms) layered on
// top. The knock is what makes the tap audible on phone speakers — they can't
// reproduce the low body — yet it's brief enough to read as a percussive attack,
// not a sustained beep. Both ramp to true zero before stopping (no end click).
function clickAt(ctx: AudioContext, at: number): void {
  // Low body — the thump.
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(180, at);
  body.frequency.exponentialRampToValueAtTime(80, at + 0.08);
  const bodyEnv = ctx.createGain();
  bodyEnv.gain.setValueAtTime(0, at);
  bodyEnv.gain.linearRampToValueAtTime(0.55, at + 0.005);
  bodyEnv.gain.exponentialRampToValueAtTime(0.0008, at + 0.14);
  bodyEnv.gain.linearRampToValueAtTime(0, at + 0.16);
  body.connect(bodyEnv);
  bodyEnv.connect(ctx.destination);
  body.start(at);
  body.stop(at + 0.17);

  // Short attack knock — carries audibility on small speakers.
  const knock = ctx.createOscillator();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime(600, at);
  knock.frequency.exponentialRampToValueAtTime(300, at + 0.02);
  const knockEnv = ctx.createGain();
  knockEnv.gain.setValueAtTime(0, at);
  knockEnv.gain.linearRampToValueAtTime(0.35, at + 0.002);
  knockEnv.gain.exponentialRampToValueAtTime(0.0008, at + 0.022);
  knockEnv.gain.linearRampToValueAtTime(0, at + 0.025);
  knock.connect(knockEnv);
  knockEnv.connect(ctx.destination);
  knock.start(at);
  knock.stop(at + 0.03);
}

// Feedback for a tap/hold. The Haptics setting decides whether that's a
// vibration, a tap sound, or both-or-neither: 'auto' uses vibration where the
// device supports it (else the sound, for Safari/Firefox), 'sound' always plays
// the sound, 'vibration' vibrates only, 'off' does nothing.
// soundPattern lets the click cadence differ from the vibration rhythm — e.g.
// the tray collapse vibrates "tap-tap" but should only click once.
function buzz(pattern: number | number[], soundPattern: number | number[] = pattern): void {
  const mode = config.haptics;
  if (mode === 'off') return;
  const vibrates = mode === 'vibration' || mode === 'both' || (mode === 'auto' && canVibrate());
  const sounds = mode === 'sound' || mode === 'both' || (mode === 'auto' && !canVibrate());
  if (vibrates && canVibrate()) navigator.vibrate(pattern);
  if (sounds) playTick(soundPattern);
}

// 5ms is below what many phones (notably Firefox on Android) actually render,
// so taps felt dead there — bump to a perceptible minimum.
export function tap(): void {
  buzz(10);
}

export function longPress(): void {
  buzz(80);
}

// Two firm pulses ("buzz-buzz") to flag a blocked action — e.g. a Save refused
// because the event's end falls before its start. Honours the Haptics setting
// like every other cue (vibration, sound, or neither).
export function errorBuzz(): void {
  buzz([40, 80, 40]);
}

// One pulse per bell of the timeline-music arming/disarming countdown, so each
// "clue" beat is felt as well as heard. Goes through buzz() so it honours the
// Haptics setting (and substitutes a tap sound where vibration is unsupported).
export function countdownBeat(): void {
  buzz(35);
}

// Tray expand = one longer pulse ("taaaap"); collapse = two short ("tap tap").
export function trayExpand(): void {
  buzz(45);
}

export function trayCollapse(): void {
  // Vibrates "tap-tap" but sounds as a single click.
  buzz([12, 40, 12], 12);
}

// Settings panel open: a firm single pulse, same strength as the tray opening.
export function panelOpen(): void {
  buzz(45);
}

// Calendars refreshing: a vibrate-pause-vibrate-pause pattern while loading.
export function loading(): void {
  buzz([40, 120, 40, 120]);
}

export function createLongPress(ms = 500): {
  start(callback: () => void): void;
  cancel(): void;
  didFire(): boolean;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  return {
    start(callback: () => void) {
      fired = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        longPress();
        callback();
      }, ms);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    didFire() {
      const v = fired;
      fired = false;
      return v;
    },
  };
}
