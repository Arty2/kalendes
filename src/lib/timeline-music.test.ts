import { describe, it, expect } from 'vitest';
import {
  pentatonicSemitone,
  laneToFrequency,
  activeLanesAt,
  crossings,
  type LaneSpan,
} from './timeline-music';

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

describe('activeLanesAt', () => {
  const spans: LaneSpan[] = [
    { key: 'a', startMs: 100, endMs: 200, lane: 0, allDay: false },
    { key: 'b', startMs: 150, endMs: 300, lane: 1, allDay: false },
    { key: 'c', startMs: 0, endMs: 1000, lane: 2, allDay: true },
  ];

  it('returns timed events under the playhead with their lane', () => {
    expect(activeLanesAt(160, spans)).toEqual(new Map([['a', 0], ['b', 1]]));
  });

  it('ignores all-day events', () => {
    expect(activeLanesAt(500, spans).has('c')).toBe(false);
  });

  it('is half-open: active at start, inactive at end', () => {
    expect(activeLanesAt(100, spans)).toEqual(new Map([['a', 0]]));
    expect(activeLanesAt(200, spans)).toEqual(new Map([['b', 1]]));
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
