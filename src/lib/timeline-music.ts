// Timeline music Easter egg: a tiny Web Audio synth plus pure helpers that turn
// the calendar into a "chart for music". As a playhead crosses into a timed
// event a bell rings; as it leaves, a whistle answers. Pitch is derived from
// the event's collision sub-lane, stepped through a major-pentatonic scale so
// stacked lanes always sound consonant.

// Major pentatonic, in semitones above the root.
const PENTATONIC = [0, 2, 4, 7, 9];

// Middle C — low enough that octave-wrapped deep lanes stay musical.
const BASE_HZ = 261.626;

export function pentatonicSemitone(lane: number): number {
  const n = Math.max(0, Math.floor(lane));
  const octave = Math.floor(n / PENTATONIC.length);
  const degree = n % PENTATONIC.length;
  return PENTATONIC[degree]! + 12 * octave;
}

export function laneToFrequency(lane: number, base = BASE_HZ): number {
  return base * Math.pow(2, pentatonicSemitone(lane) / 12);
}

export type LaneSpan = {
  key: string;
  startMs: number;
  endMs: number;
  lane: number;
  allDay: boolean;
};

// Which timed events the playhead sits inside at instant `ms`, keyed by span
// with its lane. All-day events never sound. Half-open [start, end) so an event
// stops being active exactly at its end.
export function activeLanesAt(ms: number, spans: LaneSpan[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of spans) {
    if (s.allDay) continue;
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

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

// Build the graph and resume it. Must be called from a user gesture (browsers
// won't start audio otherwise), so the 5s-hold pointerdown is where this fires.
export function primeTimelineAudio(): void {
  const Ctor = audioCtor();
  if (!Ctor) return;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.14;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function suspendTimelineAudio(): void {
  if (ctx && ctx.state === 'running') void ctx.suspend();
}

// Inharmonic partials give the strike a bell-like, slightly metallic ring.
const BELL_PARTIALS = [
  { mult: 1, gain: 1 },
  { mult: 2.76, gain: 0.45 },
  { mult: 5.4, gain: 0.2 },
];

export function playBell(freq: number): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const dur = 1.1;
  const env = ctx.createGain();
  env.connect(master);
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(1, now + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
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
  if (!ctx || !master || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const dur = 0.55;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  // A short upward glide reads as a whistle rather than a plain beep.
  osc.frequency.setValueAtTime(freq * 0.92, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.6, now + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}
