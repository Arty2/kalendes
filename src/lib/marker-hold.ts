// Hold-to-expand arming for the temporary marker's start line, shared by the
// horizontal timeline and the 1W grid (both drive the identical gesture).
//
// The old rule cancelled the hold on the first 4px of pointer movement, which is
// a touch assumption. A trackpad drifts several px from finger pressure alone,
// and a mouse user's instinct is press-then-drag well inside the hold window --
// so on desktop the hold never landed and the start line could only ever MOVE
// the marker, never grow a duration out of it.
//
// So the hold is measured against the DAY under the pointer, with a pixel slop:
// it restarts only once the pointer has both entered a different day AND left a
// small radius around wherever the current hold began. The slop matters because
// the start line sits exactly ON a day boundary -- without it, a 1px wobble
// flips days and restarts the hold on every single move, which is precisely the
// drift case this is meant to survive. Restarting rather than cancelling keeps
// the gesture reachable mid-drag: press, slide to the day you want, pause, pull.

import { createLongPress } from './haptics';

// Roughly a fingertip's worth of wobble, and well under a deliberate drag.
export const HOLD_SLOP_PX = 10;

export type DayHold = {
  // Begin (or restart) the hold at `day` / viewport `x`. `onArm` fires if the
  // pointer rests there for the hold duration.
  start(day: number, x: number, onArm: () => void): void;
  // Feed every pointer move. Wobble, or travel within the same day, keeps the
  // pending hold running; a real move to another day restarts it against that
  // day, so the deadline is always measured from the last deliberate change.
  move(day: number, x: number): void;
  cancel(): void;
  // True once for the release that ended an armed hold, then resets -- callers
  // swallow that release so arming never counts as half of a double-tap.
  didArm(): boolean;
};

export function createDayHold(ms?: number, slopPx = HOLD_SLOP_PX): DayHold {
  const press = createLongPress(ms);
  let holdDay: number | null = null;
  let holdX = 0;
  let onArm: (() => void) | null = null;
  let armed = false;

  function arm(day: number, x: number, cb: () => void): void {
    holdDay = day;
    holdX = x;
    onArm = cb;
    press.start(() => {
      armed = true;
      cb();
    });
  }

  return {
    start(day, x, cb) {
      armed = false;
      arm(day, x, cb);
    },
    move(day, x) {
      // Once armed the gesture has changed mode: further movement resizes, and
      // must not re-arm (nor re-fire the haptic).
      if (armed || onArm == null) return;
      if (day === holdDay || Math.abs(x - holdX) < slopPx) return;
      arm(day, x, onArm);
    },
    cancel() {
      press.cancel();
      holdDay = null;
      onArm = null;
    },
    didArm() {
      // Drain BOTH flags on every call -- createLongPress only self-resets when
      // it is actually read, so short-circuiting on `armed` would leave its
      // `fired` latched and report the same arm a second time.
      const fired = press.didFire();
      const v = armed || fired;
      armed = false;
      return v;
    },
  };
}
