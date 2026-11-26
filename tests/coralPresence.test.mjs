import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  CORAL, fovFromDiagonal, makePinhole, BODY_SAMPLES, visibleShare, detectorScores, personDetected, lightFactor, PresenceSim, CYCLE, CYCLE_MS,
} from '../src/books/coral/presence.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const modelDir = new URL('../src/books/coral/model/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('dev_board_micro.json', modelDir), 'utf8'));
const bin = readFileSync(new URL('dev_board_micro.bin', modelDir));

/* ------------------------------------------------------------------ facts */
test('the verified facts the page shows', () => {
  assert.equal(CORAL.camera.sensor, 'Himax HM01B0');
  assert.equal(CORAL.camera.px, 324);
  assert.equal(CORAL.camera.diagonalFovDeg, 110);
  assert.deepEqual([CORAL.model.inputW, CORAL.model.inputH, CORAL.model.channels], [96, 96, 1]);
  assert.equal(CORAL.model.core, 'Cortex-M7');
  assert.equal(CORAL.model.usesEdgeTpu, false);
  assert.equal(CORAL.leds.camera.color, 'green');
  assert.equal(CORAL.leds.user.color, 'green');
});

test('field of view: 110 degrees diagonal on a square sensor is about 90.6 degrees across', () => {
  const f = fovFromDiagonal(110);
  near(f.hDeg, f.vDeg, 1e-9, 'square');
  near(f.hDeg, 90.57, 0.05);
  // back to the diagonal
  const t = Math.tan((f.hDeg * Math.PI) / 360);
  near((2 * Math.atan(Math.SQRT2 * t) * 180) / Math.PI, 110, 1e-9);
});

/* ------------------------------------------------------------------ geometry and detector */
const cam = makePinhole([0, 1, 0], [0, 0, 1]);
const at = (x, z) => (p) => [x + p[0] * 2, p[1] * 2, z + p[2] * 2]; // a figure 2 tall, feet at y = 0

test('pinhole: the axis projects to the centre, the frame edge to 1', () => {
  const c = cam.project([0, 1, 5]);
  near(c.x, 0, 1e-12);
  near(c.y, 0, 1e-12);
  const half = Math.tan((cam.vFovDeg * Math.PI) / 360);
  // same convention as a THREE.PerspectiveCamera: looking along +z with y up, the image's right is world -x
  near(cam.project([-5 * half, 1, 5]).x, 1, 1e-9);
  near(cam.project([0, 1 + 5 * half, 5]).y, 1, 1e-9);
  assert.ok(cam.project([0, 1, -1]).depth < 0, 'behind the lens');
  // the scene passes THREE.Vector3-like points: same result as arrays
  assert.deepEqual(cam.project({ x: 0.3, y: 1.4, z: 4 }), cam.project([0.3, 1.4, 4]));
  const viaObjects = visibleShare(cam, (p) => { const q = at(0, 2.2)(p); return { x: q[0], y: q[1], z: q[2] }; });
  assert.equal(viaObjects, visibleShare(cam, at(0, 2.2)));
});

test('the detector says "person" only when the figure is clearly in the frame', () => {
  const inside = visibleShare(cam, at(0, 2.2));
  const outside = visibleShare(cam, at(4.5, 2.2));
  const half = visibleShare(cam, at(2.25, 2.2)); // its middle on the edge of the frame
  assert.ok(inside > 0.9, `inside ${inside}`);
  assert.equal(outside, 0);
  assert.ok(half > 0.2 && half < 0.7, `half ${half}`);
  assert.ok(personDetected(detectorScores(inside)));
  assert.ok(!personDetected(detectorScores(outside)));
  assert.ok(!personDetected(detectorScores(half)), 'half in the frame is not enough');
});

test('scores follow the example: int8 range, person = -no_person, LED = person > no_person', () => {
  for (const share of [0, 0.2, 0.5, 0.58, 0.6, 0.9, 1]) {
    const s = detectorScores(share);
    assert.ok(s.person >= -128 && s.person <= 127);
    assert.equal(s.noPerson, -s.person);
    assert.equal(personDetected(s), s.person > s.noPerson);
  }
  assert.equal(detectorScores(1).person, 100);
  assert.equal(detectorScores(0).person, -100);
});

test('a dark room hides a person who is fully in the frame', () => {
  assert.equal(lightFactor(1), 1);
  assert.ok(personDetected(detectorScores(0.95, 1)));
  assert.ok(!personDetected(detectorScores(0.95, 0.12)), 'dimmed: the LED stays off with the person there');
});

test('weights: head and torso count more than legs', () => {
  const w = (lo, hi) => BODY_SAMPLES.filter((s) => s.p[1] >= lo && s.p[1] < hi).reduce((a, s) => a + s.w / BODY_SAMPLES.filter((q) => q.p[1] >= lo && q.p[1] < hi).length, 0);
  assert.ok(w(0.85, 1) > w(0, 0.45));
});

/* ------------------------------------------------------------------ the cycle */
function run(sim, ms, step = 10) {
  for (let t = 0; t < ms; t += step) sim.step(step);
}
test('cycle: capture -> resize -> infer -> decide, the User LED changes only at "decide"', () => {
  assert.deepEqual(CYCLE.map((c) => c.id), ['capture', 'resize', 'infer', 'decide']);
  let share = 0;
  const sim = new PresenceSim(() => ({ share, light: 1 }));
  assert.equal(sim.cameraLed, true, 'camera streaming: Camera LED on');
  assert.equal(sim.userLed, false, 'User LED off by default');
  run(sim, CYCLE_MS * 3);
  assert.equal(sim.userLed, false);
  share = 0.95;
  // the frame already captured in this cycle was empty: at most two cycles until the LED shows the person
  run(sim, CYCLE_MS * 2 + 20);
  assert.equal(sim.userLed, true);
  assert.equal(sim.cameraLed, true, 'Camera LED unchanged');
  share = 0;
  run(sim, CYCLE_MS * 2 + 20);
  assert.equal(sim.userLed, false);
  assert.equal(sim.cameraLed, true, 'Camera LED still on with nobody there');
  assert.deepEqual(sim.events.map((e) => e.on), [true, false]);
});

test('the LED decision uses the frame captured at the start of the cycle', () => {
  let share = 0.95;
  const sim = new PresenceSim(() => ({ share, light: 1 }));
  run(sim, 30);
  share = 0; // the person leaves after the capture: this cycle still reports the captured frame
  run(sim, CYCLE_MS - 30);
  assert.equal(sim.userLed, true);
});

/* ------------------------------------------------------------------ the converted official model */
test('the model file is intact and its source is recorded', () => {
  assert.equal(createHash('sha256').update(bin).digest('hex'), meta.sha256);
  assert.match(meta.source, /google-coral\/mechanicals.*Dev Board Micro\.step/);
  assert.match(meta.source, /d4f4e81326b9f30dc31081d6efe4320a59e4b70b/);
  assert.match(meta.license, /Apache-2\.0/);
  assert.ok(existsSync(new URL('LICENSE-coral-mechanicals.txt', modelDir)));
  assert.match(readFileSync(new URL('LICENSE-coral-mechanicals.txt', modelDir), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.equal(bin.length, meta.indicesOffset + meta.indices * 4);
});

function boundsOf(part) {
  const P = new Int16Array(bin.buffer, bin.byteOffset, meta.vertices * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const g of meta.groups.filter((q) => q.part === part)) {
    for (let v = g.vStart; v < g.vStart + g.vCount; v++) for (let a = 0; a < 3; a++) {
      const x = P[v * 3 + a] / meta.scale;
      lo[a] = Math.min(lo[a], x);
      hi[a] = Math.max(hi[a], x);
    }
  }
  return { lo, hi, c: lo.map((x, a) => (x + hi[a]) / 2), s: lo.map((x, a) => hi[a] - x) };
}

test('board: 30 x 65 mm, as in the datasheet', () => {
  const b = boundsOf('pcb');
  near(b.s[0], 30, 0.01);
  near(b.s[1], 65, 0.01);
});

test('camera and LEDs are where the official drawing puts them', () => {
  const cam = boundsOf('camera'), ledCam = boundsOf('ledCam'), ledUser = boundsOf('ledUser'), ledTpu = boundsOf('ledTpu');
  const mcu = boundsOf('mcu'), button = boundsOf('button'), usb = boundsOf('usb');
  // the field-of-view solid of the CAD model is centred on the lens
  near(meta.fov['OP FOV'].center[0], 0, 0.01);
  near(meta.fov['OP FOV'].center[1], 21.5, 0.01);
  assert.ok(usb.c[1] < -30, 'USB-C at the bottom');
  // "the green LED above the camera" (USB facing down): further from the USB than the lens
  assert.ok(ledCam.c[1] > 21.5 && ledCam.c[1] < 27, `camera LED y ${ledCam.c[1]}`);
  near(ledCam.c[0], 0, 0.1, 'camera LED x');
  // "the green LED near the center of the board": right of the user button
  assert.ok(Math.abs(ledUser.c[1]) < 4, `user LED y ${ledUser.c[1]}`);
  assert.ok(ledUser.c[0] > button.c[0], 'user LED right of the button');
  near(ledUser.c[1], button.c[1], 0.3);
  // the Edge TPU LED sits between the camera and the shield
  assert.ok(ledTpu.c[1] < cam.c[1] && ledTpu.c[1] > 15.5);
  // the i.MX RT1176 (BGA 289, 14 x 14 mm) is the large chip near the USB
  near(mcu.s[0], 14, 0.01);
  near(mcu.s[1], 14, 0.01);
  assert.ok(mcu.c[1] < -10);
  // everything chapter 1 points at is on the top face
  for (const b of [ledCam, ledUser, mcu]) assert.ok(b.lo[2] >= -0.05, 'top side');
  assert.ok(cam.hi[2] > 3.5, 'the camera stands out of the top face (its flex goes into the board cut-out)');
});
