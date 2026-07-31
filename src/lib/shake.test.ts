import { createShakeDetector, pickRandom } from './shake';

// A DeviceMotionEvent stand-in: only the two acceleration fields are read.
function motion(
  accel: { x: number; y: number; z: number } | null,
  withGravity?: { x: number; y: number; z: number },
): DeviceMotionEvent {
  return {
    acceleration: accel,
    accelerationIncludingGravity: withGravity ?? null,
  } as unknown as DeviceMotionEvent;
}

describe('createShakeDetector', () => {
  // Drive the clock by hand so the tests describe timings, not wall time.
  function harness(opts: Parameters<typeof createShakeDetector>[1] = {}) {
    let t = 0;
    let fired = 0;
    const detector = createShakeDetector(() => { fired++; }, { ...opts, now: () => t });
    return {
      get fired() { return fired; },
      advance(ms: number) { t += ms; },
      // One jolt = a spike sample followed by a calm one, since the detector
      // requires the magnitude to fall back below the threshold to re-arm.
      jolt(magnitude = 25) {
        detector.handle(motion({ x: magnitude, y: 0, z: 0 }));
        detector.handle(motion({ x: 0, y: 0, z: 0 }));
      },
      detector,
    };
  }

  it('ignores a single jolt — that is a phone being set down, not a shake', () => {
    const h = harness();
    h.jolt();
    expect(h.fired).toBe(0);
  });

  it('ignores sustained motion below the threshold', () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      h.detector.handle(motion({ x: 15, y: 0, z: 0 }));
      h.advance(16);
    }
    expect(h.fired).toBe(0);
  });

  it('fires once three jolts land inside the window', () => {
    const h = harness();
    h.jolt();
    h.advance(150);
    h.jolt();
    expect(h.fired).toBe(0);
    h.advance(150);
    h.jolt();
    expect(h.fired).toBe(1);
  });

  it('does not fire when the jolts are spread beyond the window', () => {
    const h = harness();
    h.jolt();
    h.advance(500);
    h.jolt();
    h.advance(500);
    h.jolt();
    expect(h.fired).toBe(0);
  });

  it('does not count one spike twice while it stays above the threshold', () => {
    const h = harness();
    // Six consecutive above-threshold samples with no calm sample between them:
    // one physical jolt spanning several frames.
    for (let i = 0; i < 6; i++) {
      h.detector.handle(motion({ x: 25, y: 0, z: 0 }));
      h.advance(100);
    }
    expect(h.fired).toBe(0);
  });

  it('holds off a second shake until the cooldown elapses', () => {
    const h = harness();
    const shake = (): void => {
      h.jolt(); h.advance(150);
      h.jolt(); h.advance(150);
      h.jolt();
    };
    shake();
    expect(h.fired).toBe(1);

    h.advance(200);
    shake();
    expect(h.fired).toBe(1);

    h.advance(2000);
    shake();
    expect(h.fired).toBe(2);
  });

  it('falls back to accelerationIncludingGravity when acceleration is null', () => {
    const h = harness();
    // Settle the gravity estimate on a device lying flat, then shake it.
    for (let i = 0; i < 30; i++) {
      h.detector.handle(motion(null, { x: 0, y: 0, z: 9.8 }));
      h.advance(16);
    }
    expect(h.fired).toBe(0);

    for (let i = 0; i < 3; i++) {
      h.detector.handle(motion(null, { x: 25, y: 0, z: 9.8 }));
      h.detector.handle(motion(null, { x: 0, y: 0, z: 9.8 }));
      h.advance(150);
    }
    expect(h.fired).toBe(1);
  });

  it('does not read the initial gravity reading as a jolt', () => {
    const h = harness();
    // First sample is a full 1g on one axis — the seed, not a spike.
    h.detector.handle(motion(null, { x: 0, y: 0, z: 9.8 }));
    h.advance(16);
    h.detector.handle(motion(null, { x: 0, y: 0, z: 9.8 }));
    expect(h.fired).toBe(0);
  });

  it('ignores samples carrying no acceleration data at all', () => {
    const h = harness();
    h.detector.handle(motion(null));
    expect(h.fired).toBe(0);
  });

  it('reset() clears progress and the cooldown', () => {
    const h = harness();
    h.jolt();
    h.advance(150);
    h.jolt();
    h.detector.reset();
    h.advance(150);
    h.jolt();
    expect(h.fired).toBe(0);
  });
});

describe('pickRandom', () => {
  const flavors = ['pepper', 'juniper', 'bergamot', 'rose'] as const;

  it('never returns the current value, so a roll always changes something', () => {
    for (const current of flavors) {
      for (let i = 0; i < 50; i++) {
        expect(pickRandom(flavors, current)).not.toBe(current);
      }
    }
  });

  it('can reach every other option', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(pickRandom(flavors, 'pepper'));
    expect([...seen].sort()).toEqual(['bergamot', 'juniper', 'rose']);
  });

  it('draws from the whole list when there is no current value', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(pickRandom(flavors, null));
    expect(seen.size).toBe(flavors.length);
  });

  it('stays in range at the top of the rng interval', () => {
    // Math.random() is [0,1), but guard the boundary rather than trusting it.
    expect(flavors).toContain(pickRandom(flavors, null, () => 0.999999999));
    expect(flavors).toContain(pickRandom(flavors, null, () => 1));
  });

  it('returns the sole option rather than nothing when there is no alternative', () => {
    expect(pickRandom(['pepper'] as const, 'pepper')).toBe('pepper');
  });
});
