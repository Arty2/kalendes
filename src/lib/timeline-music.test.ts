import { describe, it, expect } from 'vitest';
import {
  pentatonicSemitone,
  laneToFrequency,
  voiceStep,
  activeLanesAt,
  crossings,
  uniqueVoices,
  sweepDurationMs,
  countdownToneIndex,
  COUNTDOWN_HZ,
  type Crossing,
  type LaneSpan,
} from './timeline-music';

describe('COUNTDOWN_HZ', () => {
  it('is a three-step ascending chime (ding, dung, dong)', () => {
    expect(COUNTDOWN_HZ).toHaveLength(3);
    expect(COUNTDOWN_HZ[0]! < COUNTDOWN_HZ[1]!).toBe(true);
    expect(COUNTDOWN_HZ[1]! < COUNTDOWN_HZ[2]!).toBe(true);
  });
});

describe('pentatonicSemitone', () => {
  it('steps through the major pentatonic then wraps an octave', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(pentatonicSemitone)).toEqual([0, 2, 4, 7, 9, 12, 14]);
  });

  it('clamps negative lanes to the root', () => {
    expect(pentatonicSemitone(-3)).toBe(0);
  });
});

describe('laneToFrequency', () => {
  it('maps lane 0 to the base pitch', () => {
    expect(laneToFrequency(0)).toBeCloseTo(261.626, 2);
  });

  it('jumps an octave once the scale wraps', () => {
    expect(laneToFrequency(5)).toBeCloseTo(laneToFrequency(0) * 2, 2);
  });
});

describe('voiceStep', () => {
  it('is the base step for the first row, first lane', () => {
    expect(voiceStep(0, 0)).toBe(0);
  });

  it('gives later rows higher steps so rows sound distinct', () => {
    expect(voiceStep(2, 0)).toBeGreaterThan(voiceStep(0, 0));
    expect(laneToFrequency(voiceStep(2, 0))).toBeGreaterThan(laneToFrequency(voiceStep(0, 0)));
  });

  it('steps up within a row by its collision sub-lane', () => {
    expect(voiceStep(1, 1)).toBeGreaterThan(voiceStep(1, 0));
  });

  it('clamps negatives to the root', () => {
    expect(voiceStep(-2, -3)).toBe(0);
  });
});

describe('countdownToneIndex', () => {
  it('ascends through the chime when enabling', () => {
    expect([1, 2, 3].map((b) => countdownToneIndex(b, true, 3))).toEqual([0, 1, 2]);
  });

  it('reverses the chime when disabling', () => {
    expect([1, 2, 3].map((b) => countdownToneIndex(b, false, 3))).toEqual([2, 1, 0]);
  });

  it('clamps the beat into range', () => {
    expect(countdownToneIndex(0, true, 3)).toBe(0);
    expect(countdownToneIndex(9, true, 3)).toBe(2);
  });
});

describe('activeLanesAt', () => {
  const spans: LaneSpan[] = [
    { key: 'a', startMs: 100, endMs: 200, lane: 0 },
    { key: 'b', startMs: 150, endMs: 300, lane: 1 },
    { key: 'c', startMs: 0, endMs: 1000, lane: 2 },
  ];

  it('returns events under the playhead with their voice', () => {
    expect(activeLanesAt(160, spans)).toEqual(new Map([['a', 0], ['b', 1], ['c', 2]]));
  });

  it('sounds all-day events too', () => {
    expect(activeLanesAt(500, spans)).toEqual(new Map([['c', 2]]));
  });

  it('is half-open: active at start, inactive at end', () => {
    expect(activeLanesAt(100, spans)).toEqual(new Map([['a', 0], ['c', 2]]));
    expect(activeLanesAt(200, spans)).toEqual(new Map([['b', 1], ['c', 2]]));
  });
});

describe('crossings', () => {
  it('reports entered and exited spans with the right lane source', () => {
    const prev = new Map([['a', 0], ['b', 1]]);
    const next = new Map([['b', 1], ['c', 2]]);
    expect(crossings(prev, next)).toEqual({
      entered: [{ key: 'c', lane: 2 }],
      exited: [{ key: 'a', lane: 0 }],
    });
  });

  it('reports nothing when the active set is unchanged', () => {
    const set = new Map([['a', 0]]);
    expect(crossings(set, new Map(set))).toEqual({ entered: [], exited: [] });
  });
});

describe('uniqueVoices', () => {
  const cs = (lanes: number[]): Crossing[] => lanes.map((lane, i) => ({ key: 'k' + i, lane }));

  it('collapses repeated voices to one, in first-seen order', () => {
    expect(uniqueVoices(cs([2, 2, 0, 2, 0, 5]))).toEqual([2, 0, 5]);
  });

  it('caps the number of distinct voices', () => {
    expect(uniqueVoices(cs([0, 1, 2, 3, 4, 5, 6, 7]), 3)).toEqual([0, 1, 2]);
  });

  it('is empty for no crossings', () => {
    expect(uniqueVoices([])).toEqual([]);
  });
});

describe('sweepDurationMs', () => {
  it('scales with the distance left to cover', () => {
    expect(sweepDurationMs(1000, 100, 4000)).toBeCloseTo(40000, 5);
  });

  it('holds a constant pace per viewport', () => {
    expect(sweepDurationMs(200, 100, 4000)).toBeCloseTo(8000, 5);
  });

  it('floors to a minimum so a near-the-end start still animates', () => {
    expect(sweepDurationMs(5, 100, 4000, 600)).toBe(600);
  });

  it('returns the minimum when the viewport is unmeasured', () => {
    expect(sweepDurationMs(1000, 0, 4000, 600)).toBe(600);
  });
});
