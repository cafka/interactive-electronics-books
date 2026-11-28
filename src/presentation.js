/*
 * Presentation timing of the simulations, shared by every book: how fast the page shows what happens, so a reader can
 * follow it. These are not hardware times. The times a board really uses (timers in the official source, thresholds,
 * debounce, intervals) stay in each chapter's logic and are not scaled by these values.
 * Pure data (no DOM, no THREE), so the chapter logic and the Node tests can read it.
 */
export const PRESENTATION = {
  /** Processing stages of the simulated boards (capture, inference, decision, hand-over...) are shown this many times slower than their base page times. */
  stageScale: 1.6,
  /** Walking speed of a figure, in fractions of its path per second. */
  walkSpeed: 0.22,
  /** Time a figure takes to move from one pose to the next (ease in and out), in seconds. */
  poseTransitionS: 1.1,
  /** "Keep changing pose": time each pose is held, in seconds. */
  poseHoldS: 3.6,
  /** Serial console: minimum time between two lines appearing, in milliseconds (a burst is caught up faster). */
  consoleLineMs: 220,
};

/** A page time in milliseconds, scaled for presentation. */
export const presentMs = (ms) => Math.round(ms * PRESENTATION.stageScale);

/** Smooth start and stop for transitions (0..1 -> 0..1). */
export const easeInOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
