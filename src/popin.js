import { clamp01, easeOutBack } from './circuit.js';

/*
 * Pop-in animations shared by the scenes that are built from parts: each piece has a `delay` and a `dur` (seconds
 * after the chapter starts building) and an apply(k) with k in 0..1.
 */

/** Scales a group in (with a small overshoot) while it drops from `lift` units above its final height. */
export const scalePiece = (obj, delay, dur = 0.7, lift = 1.0) => {
  const base = obj.position.y;
  return {
    delay, dur,
    apply(k) {
      const e = easeOutBack(k);
      obj.visible = k > 0;
      obj.scale.setScalar(Math.max(e, 0.0001));
      obj.position.y = base + (1 - Math.min(e, 1)) * lift;
    },
  };
};

/** Draws a Pi-to-breadboard jumper (buildJumper): the tube grows from the Pi pin, the plug pops at the end. */
export const wirePiece = (w, delay, dur = 0.9) => {
  const count = w.tube.geometry.index.count;
  return {
    delay, dur,
    apply(k) {
      w.tube.visible = k > 0;
      w.tube.geometry.setDrawRange(0, Math.floor((count * clamp01(k * 1.05)) / 3) * 3);
      w.housing.visible = k > 0;
      w.housing.scale.setScalar(Math.max(easeOutBack(clamp01(k * 4)), 0.0001));
      w.plug.visible = k > 0.93;
      w.plug.scale.setScalar(Math.max(easeOutBack(clamp01((k - 0.93) * 14)), 0.0001));
    },
  };
};

/** Same for a breadboard-to-breadboard jumper (buildBoardJumper): both ends are plugs. */
export const boardWirePiece = (w, delay, dur = 0.6) => {
  const count = w.tube.geometry.index.count;
  return {
    delay, dur,
    apply(k) {
      w.tube.visible = k > 0;
      w.tube.geometry.setDrawRange(0, Math.floor((count * clamp01(k * 1.05)) / 3) * 3);
      w.plugA.visible = k > 0;
      w.plugA.scale.setScalar(Math.max(easeOutBack(clamp01(k * 4)), 0.0001));
      w.plugB.visible = k > 0.9;
      w.plugB.scale.setScalar(Math.max(easeOutBack(clamp01((k - 0.9) * 10)), 0.0001));
    },
  };
};
