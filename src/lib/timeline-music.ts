// Timeline music Easter egg: a tiny Web Audio synth plus pure helpers that turn
// the calendar into a "chart for music". As a playhead crosses into an event a
// bell rings; as it leaves, a whistle answers. Pitch is a "voice" derived from
// the event's row and collision sub-lane (see voiceStep), stepped through a
// major-pentatonic scale so every row sounds distinct yet consonant. The output
// runs through a short convolution room reverb and a limiter for a roomy tail
// and to keep dense passages from clipping.

// Major pentatonic, in semitones above the root.
const PENTATONIC = [0, 2, 4, 7, 9];

// Middle C — low enough that octave-wrapped deep voices stay musical.
const BASE_HZ = 261.626;

// Pentatonic degrees to step up per calendar row, so adjacent rows sound a
// distinct note. The collision sub-lane then steps up from the row's base.
const ROW_STRIDE = 1;

export function pentatonicSemitone(step: number): number {
  const n = Math.max(0, Math.floor(step));
  const octave = Math.floor(n / PENTATONIC.length);
  const degree = n % PENTATONIC.length;
  return PENTATONIC[degree]! + 12 * octave;
}

// A "voice" is the scale step a span sounds at: each row starts ROW_STRIDE
// degrees above the previous, and stacked (overlapping) events step up from
// there via their collision sub-lane.
export function voiceStep(row: number, lane: number): number {
  return Math.max(0, Math.floor(row)) * ROW_STRIDE + Math.max(0, Math.floor(lane));
}

export function laneToFrequency(step: number, base = BASE_HZ): number {
  return base * Math.pow(2, pentatonicSemitone(step) / 12);
}

export type LaneSpan = {
  key: string;
  startMs: number;
  endMs: number;
  // The voice this span sounds at (row + sub-lane, see voiceStep), not the raw
  // collision lane.
  lane: number;
};

// Which events the playhead sits inside at instant `ms`, keyed by span with its
// voice. All-day events sound too (holiday calendars are entirely all-day).
// Half-open [start, end) so an event stops being active exactly at its end.
export function activeLanesAt(ms: number, spans: LaneSpan[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of spans) {
    if (ms >= s.startMs && ms < s.endMs) out.set(s.key, s.lane);
  }
  return out;
}

export type Crossing = { key: string; lane: number };

// Spans newly entered vs. just exited between two active sets. Entered carry
// their lane from `next`; exited from `prev` (they're gone from `next`).
export function crossings(
  prev: Map<string, number>,
  next: Map<string, number>,
): { entered: Crossing[]; exited: Crossing[] } {
  const entered: Crossing[] = [];
  const exited: Crossing[] = [];
  for (const [key, lane] of next) if (!prev.has(key)) entered.push({ key, lane });
  for (const [key, lane] of prev) if (!next.has(key)) exited.push({ key, lane });
  return { entered, exited };
}

// Collapse a batch of crossings to the distinct voices (pitches) they sound,
// in first-seen order, capped at `max`. A dense stretch — many same-row, hence
// same-voice, events entering on one frame — would otherwise stack dozens of
// identical oscillators and overload into static; one bell per distinct pitch
// is all you can hear anyway.
export function uniqueVoices(crossingList: Crossing[], max = 6): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const c of crossingList) {
    if (seen.has(c.lane)) continue;
    seen.add(c.lane);
    out.push(c.lane);
    if (out.length >= max) break;
  }
  return out;
}

// How long a sweep should take to cover `remainingPx`, holding a constant pace
// of `msPerViewport` per screenful so velocity feels the same at any zoom or
// start position. Floored so a near-the-end start still animates briefly.
export function sweepDurationMs(remainingPx: number, viewportPx: number, msPerViewport: number, minMs = 600): number {
  if (viewportPx <= 0) return minMs;
  return Math.max(minMs, (Math.max(0, remainingPx) / viewportPx) * msPerViewport);
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
// The output bus, hoisted so suspend can fade it to silence before freezing the
// context (a hard suspend mid-tail clicks/crackles).
let out: GainNode | null = null;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;

const OUT_LEVEL = 0.22; // output level, leaves headroom under the limiter
const SUSPEND_FADE = 0.08; // fade-to-silence before suspend, to avoid a stop glitch

function cancelPendingSuspend(): void {
  if (suspendTimer) {
    clearTimeout(suspendTimer);
    suspendTimer = null;
  }
}

// A procedurally generated impulse response: exponentially-decaying stereo
// white noise. A short tail with a steepish decay reads as a small/medium room
// rather than discrete echoes — diffuse reverberation, no audio assets needed.
function makeImpulseResponse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(seconds * context.sampleRate));
  const ir = context.createBuffer(2, len, context.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

// Build the graph and resume it. Must be called from a user gesture (browsers
// won't start audio otherwise), so the date-button pointerdown is where this
// fires. Firefox in particular keeps the context suspended until a gesture
// resumes it.
export function primeTimelineAudio(): void {
  // A quick re-enable cancels any suspend still waiting out a bell's tail.
  cancelPendingSuspend();
  const Ctor = audioCtor();
  if (!Ctor) return;
  if (!ctx) {
    ctx = new Ctor();
    // Notes connect here. Graph: master → (dry) out, and master → reverb send →
    // convolver → out for a diffuse room tail. A limiter before destination keeps
    // a dense sweep of overlapping bells from summing past 0 dBFS into clipping.
    master = ctx.createGain();
    master.gain.value = 1;
    out = ctx.createGain();
    out.gain.value = OUT_LEVEL;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.4; // wet level — room ambience, not a cathedral
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx, 1.5, 2.3); // longer, fuller tail
    master.connect(out); // dry
    master.connect(reverbSend); // reverb send
    reverbSend.connect(convolver);
    convolver.connect(out); // wet
    out.connect(limiter);
    limiter.connect(ctx.destination);
  }
  // Restore the output level in case a suspend fade was mid-flight when re-enabled.
  if (out) {
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setValueAtTime(OUT_LEVEL, ctx.currentTime);
  }
  if (ctx.state !== 'running') void ctx.resume();
}

// Suspend the context to release audio when the egg is off. `delayMs` lets a
// final note (e.g. the last beat of the disable countdown) ring out before the
// context freezes — suspend() would otherwise cut it mid-tail.
export function suspendTimelineAudio(delayMs = 0): void {
  cancelPendingSuspend();
  if (!ctx) return;
  // Fade the output to silence, then freeze the context one fade later. The fade
  // means the hard suspend lands on silence instead of cutting a ringing note or
  // the reverb tail into a click/crackle.
  const begin = (): void => {
    if (!ctx || ctx.state !== 'running') return;
    if (out) {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + SUSPEND_FADE);
    }
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      if (ctx && ctx.state === 'running') void ctx.suspend();
    }, SUSPEND_FADE * 1000 + 30);
  };
  if (delayMs <= 0) {
    begin();
    return;
  }
  suspendTimer = setTimeout(() => {
    suspendTimer = null;
    begin();
  }, delayMs);
}

// Inharmonic partials give the strike a bell-like, metallic ring: the sub-octave
// "hum" partial adds bass weight, the upper non-integer partials make it clang.
// The very top partial is intentionally omitted — clustered across many voices in
// a dense sweep it summed into a high-frequency screech.
const BELL_PARTIALS = [
  { mult: 0.5, gain: 0.6 },
  { mult: 1, gain: 1 },
  { mult: 2.76, gain: 0.5 },
  { mult: 5.4, gain: 0.18 },
];

// If the context isn't running yet (Firefox can lag a resume), nudge it and
// schedule anyway — the notes play once it starts. Bailing here is what left
// Firefox silent. A small lookahead keeps scheduling off `currentTime` exactly,
// which Firefox dislikes. Envelopes attack with a linear ramp from a true zero
// (exponential ramps can't start at 0 and clicked/dropped on Firefox).
function ready(): boolean {
  if (!ctx || !master) return false;
  if (ctx.state !== 'running') void ctx.resume();
  return true;
}

export function playBell(freq: number): void {
  if (!ready() || !ctx || !master) return;
  const now = ctx.currentTime + 0.02;
  const dur = 1.8; // long ring so bells sustain and reverberate into each other
  const env = ctx.createGain();
  env.connect(master);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(1, now + 0.003); // sharp attack = metallic ting
  env.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  // Ramp the remainder to true zero before the oscillators stop, so the note ends
  // on silence rather than truncating a non-zero waveform into a click.
  env.gain.linearRampToValueAtTime(0, now + dur + 0.04);
  for (const p of BELL_PARTIALS) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * p.mult;
    const pg = ctx.createGain();
    pg.gain.value = p.gain;
    osc.connect(pg);
    pg.connect(env);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }
}

export function playWhistle(freq: number): void {
  if (!ready() || !ctx || !master) return;
  const now = ctx.currentTime + 0.02;
  const dur = 0.55;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  // A short upward glide reads as a whistle rather than a plain beep.
  osc.frequency.setValueAtTime(freq * 0.92, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.6, now + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  // Settle to true zero before stopping, so the note doesn't end on a click.
  env.gain.linearRampToValueAtTime(0, now + dur + 0.04);
  osc.connect(env);
  env.connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

// Ascending major triad (C5, E5, G5) for the activation countdown: "ding,
// dung, dong" as the hold arms, the third coinciding with auto-start.
export const COUNTDOWN_HZ = [523.25, 659.25, 783.99];

// Which COUNTDOWN_HZ index a beat plays. Enabling ascends (0,1,2); disabling
// descends (2,1,0) so the chime mirrors itself when turning the egg off.
// `beat` is 1-based.
export function countdownToneIndex(beat: number, enabling: boolean, steps = COUNTDOWN_HZ.length): number {
  const b = Math.max(1, Math.min(steps, Math.floor(beat)));
  return enabling ? b - 1 : steps - b;
}

export function playCountdownTone(step: number): void {
  const i = Math.max(0, Math.min(COUNTDOWN_HZ.length - 1, Math.floor(step)));
  playBell(COUNTDOWN_HZ[i]!);
}
