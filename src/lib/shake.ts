// Shake-to-randomize gesture detection. Kept free of `config` imports so it can
// be unit-tested as a pure function of DeviceMotionEvent samples + a clock, in
// the style of the other gesture modules (pinch.ts, wheel-zoom.ts).
//
// Browser support is uneven and the feature must degrade silently:
//   - Chrome/Edge (tab or installed web app) and Firefox on Android: works.
//   - Chrome/Edge on desktop: the event only fires when the OS exposes an
//     accelerometer, so 2-in-1s work and clamshells/towers never fire.
//   - iOS/iPadOS Safari 13+ (tab and home-screen web app): works, but only after
//     DeviceMotionEvent.requestPermission() resolves 'granted', and that call
//     must happen inside a real user gesture.
//   - Firefox on desktop and Safari on macOS: never fire at all. Firefox for
//     desktop does not expose orientation/accelerometer data to pages.
// Everywhere in that last group the listener simply attaches and stays quiet.

// iOS-only static that gates access behind a permission prompt.
type MotionPermissionCtor = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};

export function isShakeSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
}

// True on iOS/iPadOS 13+, where motion access needs an explicit grant.
export function needsMotionPermission(): boolean {
  if (!isShakeSupported()) return false;
  const ctor = window.DeviceMotionEvent as unknown as MotionPermissionCtor;
  return typeof ctor.requestPermission === 'function';
}

// Must be called synchronously from a user gesture — a `change` event from a
// <select> does not count as user activation, so this hangs off a pointerdown.
// Resolves true on platforms that don't gate motion at all.
export async function requestMotionPermission(): Promise<boolean> {
  if (!needsMotionPermission()) return isShakeSupported();
  const ctor = window.DeviceMotionEvent as unknown as MotionPermissionCtor;
  try {
    return (await ctor.requestPermission!()) === 'granted';
  } catch {
    // Safari throws rather than resolving 'denied' when called outside a gesture.
    return false;
  }
}

// Pick a random entry that is never the current one, so a roll always changes
// something visible. Falls back to the sole option when there's nothing else.
export function pickRandom<T>(options: readonly T[], current: T | null, rng: () => number = Math.random): T {
  const pool = options.filter((o) => o !== current);
  const from = pool.length > 0 ? pool : options;
  return from[Math.floor(rng() * from.length) % from.length]!;
}

export type ShakeOptions = {
  // High-pass acceleration magnitude (m/s²) that counts as a jolt.
  threshold?: number;
  // How long the jolts making up one shake may be spread over.
  windowMs?: number;
  // Jolts needed inside the window before it counts as a shake. More than one is
  // the point: a single spike is someone setting the phone down on a table.
  requiredJolts?: number;
  // Quiet period after firing, so one continuous shake fires once.
  cooldownMs?: number;
  now?: () => number;
};

export type ShakeDetector = {
  handle(e: DeviceMotionEvent): void;
  reset(): void;
};

const DEFAULTS = {
  threshold: 16,
  windowMs: 800,
  requiredJolts: 3,
  cooldownMs: 1500,
  // Ignore a second jolt this soon after the last — one physical jolt spans
  // several samples at ~60Hz even after the below-threshold re-arm.
  minGapMs: 80,
  // Weight of each new sample in the gravity estimate used by the fallback path.
  gravityAlpha: 0.1,
};

export function createShakeDetector(onShake: () => void, opts: ShakeOptions = {}): ShakeDetector {
  const threshold = opts.threshold ?? DEFAULTS.threshold;
  const windowMs = opts.windowMs ?? DEFAULTS.windowMs;
  const requiredJolts = opts.requiredJolts ?? DEFAULTS.requiredJolts;
  const cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;
  const now = opts.now ?? (() => Date.now());

  let jolts: number[] = [];
  let lastFire = -Infinity;
  // Require the magnitude to fall back below the threshold between jolts, so a
  // single sustained spike can't count several times.
  let armed = true;
  let gravity: [number, number, number] | null = null;

  function linearMagnitude(e: DeviceMotionEvent): number | null {
    const a = e.acceleration;
    if (a && (a.x != null || a.y != null || a.z != null)) {
      return Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    }
    // Some Android builds only populate accelerationIncludingGravity. Track a
    // slow per-axis average as the gravity estimate and subtract it, which also
    // absorbs however the device happens to be tilted.
    const g = e.accelerationIncludingGravity;
    if (!g || (g.x == null && g.y == null && g.z == null)) return null;
    const v: [number, number, number] = [g.x ?? 0, g.y ?? 0, g.z ?? 0];
    if (!gravity) {
      // Seed from the first sample, otherwise the initial ~9.8 reads as a jolt.
      gravity = [...v];
      return 0;
    }
    const alpha = DEFAULTS.gravityAlpha;
    gravity = [
      gravity[0] * (1 - alpha) + v[0] * alpha,
      gravity[1] * (1 - alpha) + v[1] * alpha,
      gravity[2] * (1 - alpha) + v[2] * alpha,
    ];
    return Math.hypot(v[0] - gravity[0], v[1] - gravity[1], v[2] - gravity[2]);
  }

  return {
    handle(e: DeviceMotionEvent): void {
      const magnitude = linearMagnitude(e);
      if (magnitude == null) return;
      if (magnitude < threshold) {
        armed = true;
        return;
      }
      if (!armed) return;
      armed = false;

      const t = now();
      const last = jolts[jolts.length - 1];
      if (last != null && t - last < DEFAULTS.minGapMs) return;

      jolts.push(t);
      jolts = jolts.filter((j) => t - j <= windowMs);
      if (jolts.length < requiredJolts) return;
      if (t - lastFire < cooldownMs) return;

      lastFire = t;
      jolts = [];
      onShake();
    },
    reset(): void {
      jolts = [];
      lastFire = -Infinity;
      armed = true;
      gravity = null;
    },
  };
}
