// Coral chapter 2: the cascade of the official app apps/multicore_model_cascade, as the page simulates it.
// The expected values are the ones in the app's source (multicore_model_cascade_cm4.cc / _cm7.cc / .py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CASCADE, KEYPOINTS, EDGES, CascadeSim, standInPose, drawnEdges, M4_STAGES, M7_STAGES, HANDOFF_MS } from '../src/books/coral/cascade.js';

// a person: all 17 keypoints inside the frame; nobody: all outside
const inFrame = () => KEYPOINTS.map((_, i) => ({ x: -0.3 + (i % 5) * 0.12, y: 0.6 - i * 0.07, depth: 4 }));
const outFrame = () => KEYPOINTS.map(() => ({ x: 1.8, y: 0, depth: 4 }));
function world() {
  const w = { person: false, light: 1, keypoints: null };
  w.measure = () => ({ share: w.person ? 1 : 0, light: w.light, keypoints: w.keypoints || (w.person ? inFrame() : outFrame()) });
  return w;
}
const run = (sim, ms) => sim.step(ms);
const texts = (sim) => sim.log.map((l) => l.text);

test('facts from the source: models, sizes, thresholds, timers, port', () => {
  assert.equal(CASCADE.repoPath, 'apps/multicore_model_cascade');
  assert.equal(CASCADE.m4.model, '/models/person_detect_model.tflite');
  assert.deepEqual([CASCADE.m4.input.w, CASCADE.m4.input.h], [96, 96]);
  assert.equal(CASCADE.m7.model, '/models/posenet_mobilenet_v1_075_324_324_16_quant_decoder_edgetpu.tflite');
  assert.deepEqual([CASCADE.m7.input.w, CASCADE.m7.input.h], [324, 324]);
  assert.equal(CASCADE.m7.poseThreshold, 0.4);
  assert.equal(CASCADE.m7.inactiveMs, 5000);
  assert.equal(CASCADE.m7.checkMs, 1000);
  assert.equal(CASCADE.m7.port, 27000);
  assert.equal(CASCADE.m7.logInterval, 15);
  assert.equal(CASCADE.m7.jpegQuality, 75);
  assert.equal(CASCADE.client.keypointThreshold, 0.2);
  assert.equal(CASCADE.client.requirements, 'Pillow>=9.0.0');
  assert.equal(CASCADE.client.defaultHost, '10.10.10.1');
});

test('17 keypoints in the order of posenet.h and the 19 edges of the client', () => {
  assert.equal(KEYPOINTS.length, 17);
  assert.equal(KEYPOINTS[0], 'NOSE');
  assert.equal(KEYPOINTS[5], 'LEFT_SHOULDER');
  assert.equal(KEYPOINTS[16], 'RIGHT_ANKLE');
  assert.equal(EDGES.length, 19);
  const keys = new Set(EDGES.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  assert.equal(keys.size, 19, 'no edge twice');
  assert.ok(EDGES.every(([a, b]) => a >= 0 && a < 17 && b >= 0 && b < 17 && a !== b));
  // every keypoint is joined to at least one other
  for (let i = 0; i < 17; i++) assert.ok(EDGES.some(([a, b]) => a === i || b === i), KEYPOINTS[i]);
});

test('the stand-in pose: reported only with the nose and both shoulders in the frame, and light', () => {
  const kp = inFrame();
  assert.equal(standInPose(kp, 1).reported, true);
  assert.equal(standInPose(kp, 1).count, 17);
  assert.equal(standInPose(kp, 0.05).reported, false, 'dark room');
  const noHead = kp.map((q, i) => (i === 0 ? { x: 2, y: 0, depth: 4 } : q));
  assert.equal(standInPose(noHead, 1).reported, false);
  const legsOut = kp.map((q, i) => (i >= 13 ? { x: 0, y: -1.5, depth: 4 } : q));
  const r = standInPose(legsOut, 1);
  assert.equal(r.reported, true);
  assert.equal(r.count, 13);
  assert.ok(drawnEdges(r.found).every(([a, b]) => a < 13 && b < 13), 'no line to a missing keypoint');
  assert.equal(standInPose(outFrame(), 1).found.filter(Boolean).length, 0);
});

test('power on: both cores start as the source says; the M4 searches with the Status LED on', () => {
  const w = world();
  const sim = new CascadeSim(w.measure);
  assert.deepEqual(texts(sim), ['Multicore Model Cascade!', 'INFO: Waiting for clients on 27000...', 'Posenet task started', 'M4 Started, detecting person...']);
  assert.equal(sim.core, 'm4');
  assert.equal(sim.statusLed, true);
  assert.equal(sim.userLed, false);
  assert.equal(sim.cameraOn, true);
  assert.equal(sim.tpuActive, false);
  run(sim, 5000);
  assert.equal(sim.core, 'm4', 'nobody: the M4 keeps searching');
  assert.equal(sim.handoffs.toM7, 0);
  assert.ok(texts(sim).some((t) => /^person_score: -100 no_person_score: 100$/.test(t)));
});

test('a person: the M4 sets the User LED, disables the camera and hands over; the M7 starts', () => {
  const w = world();
  const sim = new CascadeSim(w.measure);
  // stage times are presentation times (src/presentation.js): wait in M4 cycles, not in fixed milliseconds
  const m4Cycle = M4_STAGES.reduce((s, x) => s + x.ms, 0);
  run(sim, 1.5 * m4Cycle);
  w.person = true;
  // at most one cycle until the next frame, one cycle to decide, then the hand-over
  run(sim, 2 * m4Cycle + HANDOFF_MS + 100);
  const t = texts(sim);
  const i = t.indexOf('Person detected, let M7 take over.');
  assert.ok(i > 0);
  assert.deepEqual(t.slice(i, i + 3), ['Person detected, let M7 take over.', 'M4 stopped', 'M7 Main Task: started']);
  assert.match(t[i - 1], /^person_score: (\d+) no_person_score: -\d+$/);
  assert.equal(sim.core, 'm7');
  assert.equal(sim.userLed, true);
  assert.equal(sim.tpuActive, true);
  assert.equal(sim.lowPower, false);
  assert.equal(sim.cameraOn, true);
});

test('while the M7 works the User LED keeps its last value, and poses keep the M7 awake', () => {
  const w = world();
  w.person = true;
  const sim = new CascadeSim(w.measure);
  run(sim, 1500);
  assert.equal(sim.core, 'm7');
  run(sim, 20000);
  assert.equal(sim.core, 'm7', 'a pose at least every 5 s');
  assert.equal(sim.userLed, true);
  assert.equal(sim.handoffs.toM4, 0);
  assert.ok(sim.events.filter((e) => e.type === 'pose').length > 10);
  assert.ok(sim.events.filter((e) => e.type === 'frame').length > 10);
  assert.ok(texts(sim).includes('Poses: 1'));
});

test('no pose for 5 s: back to the M4 within the next 1 s check; the M4 then switches the User LED off', () => {
  const w = world();
  w.person = true;
  const sim = new CascadeSim(w.measure);
  run(sim, 3000);
  assert.equal(sim.core, 'm7');
  w.person = false;
  const lastPose = () => [...sim.events].reverse().find((e) => e.type === 'pose').t;
  let leftAt = null;
  for (let k = 0; k < 9000 && sim.core === 'm7'; k += 20) {
    run(sim, 20);
    if (sim.core !== 'm7') leftAt = sim.timeMs;
  }
  assert.ok(leftAt, 'the M7 handed back');
  const gap = leftAt - lastPose();
  assert.ok(gap > 5000 && gap <= 6000 + 20, `handed back ${gap} ms after the last pose`);
  const t = texts(sim);
  const i = t.indexOf('No poses detected for 5 seconds');
  assert.deepEqual(t.slice(i, i + 2), ['No poses detected for 5 seconds', 'M7 Main Task: stopped']);
  assert.equal(sim.lowPower, true);
  assert.equal(sim.tpuActive, false);
  assert.equal(sim.userLed, true, 'still on: the M4 has not seen a frame yet');
  run(sim, 1500);
  assert.equal(sim.core, 'm4');
  assert.ok(texts(sim).lastIndexOf('M4 Started, detecting person...') > i);
  assert.equal(sim.userLed, false, 'the M4\'s first "no person" turns it off');
});

test('the "Poses: N" line: when the number changes, and every 15 inferences', () => {
  const w = world();
  w.person = true;
  const sim = new CascadeSim(w.measure);
  run(sim, 1500);
  const start = sim.log.length;
  const inf0 = sim.m7Inferences;
  run(sim, 40 * M7_STAGES.reduce((s, x) => s + x.ms, 0));
  const lines = sim.log.slice(start).filter((l) => l.text.startsWith('Poses:'));
  const n = sim.m7Inferences - inf0;
  assert.ok(lines.length >= Math.floor(n / 15) && lines.length <= Math.floor(n / 15) + 2, `${lines.length} lines for ${n} inferences`);
});

test('a person who stands but whose head is out of the frame keeps the M4 searching? no: the M4 only needs "person"', () => {
  // the M4 decides with its own model; PoseNet then may find no pose, and the M7 hands back after 5 s
  const w = world();
  w.person = true;
  w.keypoints = KEYPOINTS.map((_, i) => (i < 7 ? { x: 0, y: 1.6, depth: 4 } : { x: 0, y: -0.2, depth: 4 }));
  const sim = new CascadeSim(w.measure);
  run(sim, 1500);
  assert.equal(sim.core, 'm7');
  run(sim, 7500);
  assert.ok(sim.handoffs.toM4 >= 1, 'no pose without the head: back to the M4');
  run(sim, 1500);
  assert.ok(sim.handoffs.toM7 >= 2, 'and the M4, which still sees a person, hands over again');
});

test('stage lists follow the source order', () => {
  assert.deepEqual(M4_STAGES.map((s) => s.id), ['m4capture', 'm4infer', 'm4decide']);
  assert.deepEqual(M7_STAGES.map((s) => s.id), ['m7capture', 'm7jpeg', 'tpu', 'decode', 'send']);
});

test('the chapter shows the official commands and code lines, not invented ones', () => {
  const src = readFileSync(new URL('../src/books/coral/chapter2.js', import.meta.url), 'utf8');
  for (const s of [
    'git clone --recurse-submodules -j8 https://github.com/google-coral/coralmicro',
    'cd coralmicro && bash setup.sh',
    'bash build.sh',
    'python3 scripts/flashtool.py -a multicore_model_cascade',
    'python3 -m pip install -r apps/multicore_model_cascade/requirements.txt',
    'python3 apps/multicore_model_cascade/multicore_model_cascade.py',
    'LedSet(Led::kUser, person_detected);',
    'LedSet(Led::kStatus, true);',
    'IpcM4::GetSingleton()->SendMessage(msg);',
    'EdgeTpuManager::GetSingleton()->OpenDevice(PerformanceMode::kMax);',
    'if (network_task.PosenetInactiveForMs(5000)) {',
    'auto poses = tensorflow::GetPosenetOutput(interpreter_.get(), kThreshold);',
  ]) assert.ok(src.includes(s), s);
  assert.ok(!src.includes('examples/multicore_model_cascade'), 'the app is in apps/, not examples/');
  assert.ok(!/LedSet\(Led::kTpu/.test(src.replace(/no LedSet\(Led::kTpu\)|there is no <code>LedSet\(Led::kTpu\)/g, '')), 'the page does not claim code that switches the TPU LED');
});
