/*
 * Coral chapter 1 logic: a didactic stand-in for the person detection demo of the Dev Board Micro.
 * Pure JavaScript (no DOM, no THREE) so it runs in the page and in Node tests.
 *
 * What is real (from the official documentation and the coralmicro example tflm_person_detection_m7):
 *   - the camera streams frames all the time and the green Camera LED is on while it captures;
 *   - each frame is reduced to a 96 x 96 grayscale image (CameraFormat::kY8) and given to a 300 kB TensorFlow Lite
 *     Micro model that runs on the Cortex-M7 (it does not use the Edge TPU);
 *   - the model gives two scores, person and no person; the program sets the User LED to
 *     (person_score > no_person_score).
 * What is simulated: the model. This file does not run a neural network. It measures how much of the figure is
 * inside the camera's frame (with the same pinhole geometry as the camera image on the page) and how well lit it
 * is, and turns that into the two scores. The timing of the cycle is also chosen for the page, not measured.
 */

/** Verified facts used by the page and the tests (sources in SOURCES). */
export const CORAL = {
  board: 'Coral Dev Board Micro',
  mcu: 'NXP i.MX RT1176',
  cores: { m7: 'Arm Cortex-M7 @ 800 MHz', m4: 'Arm Cortex-M4 @ 400 MHz' },
  camera: { sensor: 'Himax HM01B0', px: 324, diagonalFovDeg: 110, fNumber: 2.0, focus: 'fixed' },
  model: { inputW: 96, inputH: 96, channels: 1, sizeKb: 300, core: 'Cortex-M7', usesEdgeTpu: false },
  leds: {
    camera: { color: 'green', role: 'on while the camera captures images' },
    user: { color: 'green', role: 'programmable, off by default; the demo turns it on when a person is detected' },
    tpu: { color: 'white', role: 'on while the Edge TPU is powered' },
    status: { color: 'orange', role: 'board status' },
  },
  boardMm: { w: 30, h: 65 },
};
export const SOURCES = [
  ['Get started with the Dev Board Micro (Boot up for the first time)', 'https://coral.ai/docs/dev-board-micro/get-started/'],
  ['Dev Board Micro datasheet v1.0 (tables 1 and 5, section 4.4)', 'https://coral.ai/docs/dev-board-micro/datasheet/'],
  ['Dev Board Micro product page', 'https://coral.ai/products/dev-board-micro/'],
  ['coralmicro example tflm_person_detection_m7', 'https://github.com/google-coral/coralmicro/tree/main/examples/tflm_person_detection_m7'],
  ['3D model: google-coral/mechanicals, dev_board_micro/Dev Board Micro.step (Apache-2.0)', 'https://github.com/google-coral/mechanicals/tree/master/dev_board_micro'],
];

const DEG = Math.PI / 180;
/** Horizontal and vertical field of view from the diagonal one (square sensor by default). */
export function fovFromDiagonal(diagDeg, aspect = 1) {
  const t = Math.tan((diagDeg * DEG) / 2);
  const ty = t / Math.sqrt(1 + aspect * aspect), tx = ty * aspect;
  return { hDeg: (2 * Math.atan(tx)) / DEG, vDeg: (2 * Math.atan(ty)) / DEG };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A pinhole camera, the same model as a THREE.PerspectiveCamera with aspect 1 looking along `forward` with `up`.
 * project(p) -> { x, y, depth }: x, y in -1..1 inside the frame (y up), depth > 0 in front of the lens.
 */
export function makePinhole(position, forward, up = [0, 1, 0], vFovDeg = fovFromDiagonal(CORAL.camera.diagonalFovDeg).vDeg) {
  const f = norm(forward);
  const r = norm(cross(f, up));
  const u = cross(r, f);
  const k = 1 / Math.tan((vFovDeg * DEG) / 2);
  return {
    position, forward: f, right: r, up: u, vFovDeg,
    /** p: [x, y, z] or an object with x, y, z (such as a THREE.Vector3). */
    project(p) {
      const d = sub(Array.isArray(p) ? p : [p.x, p.y, p.z], position);
      const depth = dot(d, f);
      if (depth <= 1e-6) return { x: Infinity, y: Infinity, depth };
      return { x: (dot(d, r) / depth) * k, y: (dot(d, u) / depth) * k, depth };
    },
  };
}

/**
 * Sample points of the figure (local frame: feet at y = 0, facing +z), with weights: the head and the torso count
 * more than the legs, because a person-detection model mostly relies on them. Heights for a figure of height 1.
 */
export const BODY_SAMPLES = (() => {
  const pts = [];
  const add = (x, y, z, w) => pts.push({ p: [x, y, z], w });
  for (const [x, y] of [[0, 0.93], [-0.05, 0.9], [0.05, 0.9], [0, 0.97], [0, 0.86]]) add(x, y, 0, 1.6); // head
  for (const y of [0.78, 0.7, 0.62, 0.54]) for (const x of [-0.09, 0, 0.09]) add(x, y, 0, 1.0); // torso
  for (const y of [0.74, 0.62, 0.5]) for (const x of [-0.17, 0.17]) add(x, y, 0, 0.5); // arms
  for (const y of [0.42, 0.28, 0.14, 0.03]) for (const x of [-0.06, 0.06]) add(x, y, 0, 0.35); // legs
  return pts;
})();
export const BODY_WEIGHT = BODY_SAMPLES.reduce((s, q) => s + q.w, 0);

/** Weighted share (0..1) of the samples that land inside the frame. worldOf(localPoint) -> world point. */
export function visibleShare(cam, worldOf, samples = BODY_SAMPLES) {
  let w = 0;
  for (const s of samples) {
    const q = cam.project(worldOf(s.p));
    if (q.depth > 0 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1) w += s.w;
  }
  return w / samples.reduce((a, s) => a + s.w, 0);
}

/**
 * The simulated model output. evidence = visible share x a light factor (a dark frame has little contrast).
 * Scores follow the int8 range of the real example and are symmetric: person = -no_person.
 */
export const DETECTOR = { evidenceLow: 0.35, evidenceHigh: 0.8, lightLow: 0.06, lightFull: 0.36 };
export function lightFactor(light) {
  return Math.min(1, Math.max(0, (light - DETECTOR.lightLow) / (DETECTOR.lightFull - DETECTOR.lightLow)));
}
export function detectorScores(share, light = 1) {
  const evidence = share * lightFactor(light);
  const p = Math.min(1, Math.max(0, (evidence - DETECTOR.evidenceLow) / (DETECTOR.evidenceHigh - DETECTOR.evidenceLow)));
  const person = Math.round(-100 + 200 * p);
  return { evidence, person, noPerson: -person };
}
/** The one line of the real example that decides the LED. */
export const personDetected = (s) => s.person > s.noPerson;

/**
 * One inference cycle, repeated while the camera streams: capture -> resize -> infer -> decide (sets the LED).
 * Durations are chosen so the stages can be followed on the page (simulated timing, not measured).
 */
export const CYCLE = [
  { id: 'capture', ms: 120 },
  { id: 'resize', ms: 60 },
  { id: 'infer', ms: 260 },
  { id: 'decide', ms: 60 },
];
export const CYCLE_MS = CYCLE.reduce((s, c) => s + c.ms, 0);

export class PresenceSim {
  /** measure() -> { share, light } is read at the moment of capture (the frame the model will see). */
  constructor(measure) {
    this.measure = measure;
    this.reset();
  }
  reset() {
    this.powered = true;
    this.t = 0; // ms in the current cycle
    this.stage = 0;
    this.frame = null; // what was captured in this cycle
    this.scores = { evidence: 0, person: -100, noPerson: 100 };
    this.userLed = false; // off by default
    this.cycles = 0;
    this.events = [];
    this.capture();
  }
  /** The camera LED shows camera activity: on while the camera streams, whatever is in the image. */
  get cameraLed() {
    return this.powered;
  }
  get stageId() {
    return CYCLE[this.stage].id;
  }
  capture() {
    this.frame = { ...this.measure() };
  }
  step(dtMs) {
    if (!this.powered) return;
    this.t += dtMs;
    while (this.t >= CYCLE[this.stage].ms) {
      this.t -= CYCLE[this.stage].ms;
      const done = CYCLE[this.stage].id;
      if (done === 'infer') this.scores = detectorScores(this.frame.share, this.frame.light);
      if (done === 'decide') {
        const on = personDetected(this.scores);
        if (on !== this.userLed) this.events.push({ type: 'led', on, cycle: this.cycles, scores: { ...this.scores } });
        this.userLed = on;
        this.cycles++;
      }
      this.stage = (this.stage + 1) % CYCLE.length;
      if (CYCLE[this.stage].id === 'capture') this.capture();
    }
  }
  /** Fraction of the current stage done (for the animation of the pipeline). */
  stageProgress() {
    return Math.min(1, this.t / CYCLE[this.stage].ms);
  }
}
