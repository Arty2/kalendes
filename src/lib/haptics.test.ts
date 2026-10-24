// @vitest-environment happy-dom
import { config } from './state.svelte';
import { createLongPress, shakeRoll, tap, trayCollapse } from './haptics';

// jsdom provides no Web Audio and the repo has no AudioContext mock, so this is
// a local one. It records every oscillator with the frequency and start time it
// was scheduled at — which is exactly what "two bells 140ms apart" means.
type Scheduled = { type: string; freq: number; start: number; stop: number };

let scheduled: Scheduled[] = [];
let contexts = 0;

// An AudioParam needs the ramp methods, not just `value`: clickAt ramps the
// frequency, so a bare { value } here fails every cue that uses the click path.
function param(initial = 0): AudioParam {
  return {
    value: initial,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
  } as unknown as AudioParam;
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = { kind: 'destination' };
  constructor() { contexts++; }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain() { return { gain: param(), connect() {} }; }
  createOscillator() {
    const node = {
      type: '',
      frequency: param(),
      detune: param(),
      connect() {},
      start(t: number) {
        node._rec = { type: node.type, freq: node.frequency.value, start: t, stop: -1 };
        scheduled.push(node._rec);
      },
      stop(t: number) { if (node._rec) node._rec.stop = t; },
      _rec: null as Scheduled | null,
    };
    return node;
  }
}

// Group the scheduled oscillators into strikes by shared start time. The bell's
// lowest partial is the 0.5x sub-octave, so its fundamental is twice that.
function strikes(): { at: number; fundamental: number; partials: number; stop: number }[] {
  const byStart = new Map<number, Scheduled[]>();
  for (const s of scheduled) {
    const list = byStart.get(s.start) ?? [];
    list.push(s);
    byStart.set(s.start, list);
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, list]) => ({
      at,
      fundamental: Math.min(...list.map((s) => s.freq)) * 2,
      partials: list.length,
      stop: Math.max(...list.map((s) => s.stop)),
    }));
}

let vibrations: (number | number[])[] = [];

beforeEach(() => {
  scheduled = [];
  vibrations = [];
  contexts = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    writable: true,
    value: (p: number | number[]) => { vibrations.push(p); return true; },
  });
  // 'both' exercises the vibration and the sound in one call.
  config.haptics = 'both';
});

afterEach(() => {
  config.haptics = 'auto';
});

// A vibrate array alternates on/off/on/off, so the on-pulses are the even indices.
const onPulses = (p: number | number[]): number[] =>
  (Array.isArray(p) ? p : [p]).filter((_, i) => i % 2 === 0);

describe('shakeRoll', () => {
  it('vibrates twice, not once', () => {
    shakeRoll();
    expect(vibrations).toHaveLength(1);
    const pulses = onPulses(vibrations[0]!);
    expect(pulses).toHaveLength(2);
    expect(pulses.every((ms) => ms > 0)).toBe(true);
  });

  it('rings two bells rather than one percussive tap', () => {
    shakeRoll();
    const rung = strikes();
    expect(rung).toHaveLength(2);
    // Four sine partials per strike is the bell timbre; the tap is a two-node
    // sine+triangle thump, so this tells them apart.
    expect(rung.every((s) => s.partials === 4)).toBe(true);
    expect(scheduled.every((s) => s.type === 'sine')).toBe(true);
  });

  it('rings a rising fifth, C5 then G5', () => {
    shakeRoll();
    const [first, second] = strikes();
    expect(first!.fundamental).toBeCloseTo(523.25, 1);
    expect(second!.fundamental).toBeCloseTo(783.99, 1);
  });

  it('spaces the dings so they read as ding-ding, not one chord', () => {
    shakeRoll();
    const [first, second] = strikes();
    expect((second!.at - first!.at) * 1000).toBeCloseTo(140, 0);
  });

  it('lets the first ding still be ringing when the second lands', () => {
    shakeRoll();
    const [first, second] = strikes();
    expect(first!.stop).toBeGreaterThan(second!.at);
  });

  // clickCtx is module state, so it may already exist from an earlier test. What
  // matters is that the bell rings through the same one the tap uses rather than
  // opening its own — the music context is the one it must not touch.
  it('rings through the same context the tap uses, not a second one', () => {
    tap();
    const afterTap = contexts;
    shakeRoll();
    expect(contexts).toBe(afterTap);
  });
});

describe('the haptics setting gates the bell like every other cue', () => {
  it('off produces neither vibration nor sound', () => {
    config.haptics = 'off';
    shakeRoll();
    expect(vibrations).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it('vibration only skips the bells', () => {
    config.haptics = 'vibration';
    shakeRoll();
    expect(vibrations).toHaveLength(1);
    expect(scheduled).toHaveLength(0);
  });

  it('sound only skips the vibration', () => {
    config.haptics = 'sound';
    shakeRoll();
    expect(vibrations).toHaveLength(0);
    expect(strikes()).toHaveLength(2);
  });
});

describe('the other cues still use the percussive tap', () => {
  it('tap plays one two-layer thump, not a bell', () => {
    tap();
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((s) => s.type).sort()).toEqual(['sine', 'triangle']);
  });

  it('trayCollapse vibrates twice but clicks once', () => {
    trayCollapse();
    expect(onPulses(vibrations[0]!)).toHaveLength(2);
    expect(scheduled).toHaveLength(2); // one thump = sine body + triangle knock
  });
});

describe('createLongPress', () => {
  it('survives drift within the slop and cancels past it', () => {
    vi.useFakeTimers();
    try {
      const press = createLongPress(500);
      const fire = vi.fn();
      press.start(fire, { clientX: 100, clientY: 100 });
      press.cancelIfMoved({ clientX: 103, clientY: 102 }, 10);
      vi.advanceTimersByTime(500);
      expect(fire).toHaveBeenCalledTimes(1);
      press.start(fire, { clientX: 100, clientY: 100 });
      press.cancelIfMoved({ clientX: 115, clientY: 100 }, 10);
      vi.advanceTimersByTime(500);
      expect(fire).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
