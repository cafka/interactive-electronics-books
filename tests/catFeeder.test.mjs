import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forward, inverse, withinLimits, planMove, sampleMove, holdingTorques, ARM, reachOf } from '../src/books/esp32/armKinematics.js';
import { CatFeeder, parseFeederSettings, armOf, waypoints, FAULT } from '../src/books/esp32/catFeeder.js';
import { FeederWorld } from '../src/books/esp32/feederWorld.js';

const source = readFileSync(new URL('../arduino/cat_feeder/cat_feeder.ino', import.meta.url), 'utf8');
const { settings: S, missing } = parseFeederSettings(source);
const arm = armOf(S);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

/** The program against the physical model: one loop() per ms, the world every 10 ms. */
function rig({ seed = 3, prefs = null, world = {} } = {}) {
  const w = new FeederWorld(S, world, seed);
  const r = { t: 0, w, prefs: prefs ?? { cycle: 0, delivered: 0, offset: w.trueOffset + w.trueCal * w.p.dishG, cal: w.trueCal, calibrated: true }, events: [], button: 1, maxSpeed: [0, 0, 0, 0] };
  const io = {
    readScale: () => w.readScale(), readBeam: () => w.readBeam(), readLid: () => w.readLid(), readEstop: () => w.readEstop(),
    readButton: () => r.button, readCurrentMa: () => w.currentMa(),
    setServo: (ch, d) => w.setServo(ch, d), servoOff: (ch) => w.servoOff(ch), setOutputs: (on) => w.setOutputs(on),
    loadPrefs: () => ({ ...r.prefs }), savePrefs: (p) => (r.prefs = { ...p }), onEvent: (e) => r.events.push(e),
  };
  r.make = () => new CatFeeder(S, io);
  r.f = r.make();
  r.f.setup(r.t);
  r.total0 = w.totalG;
  r.warm = () => {
    // the load cell needs a few readings after power-up before the program trusts it (as on the board)
    for (let i = 0; i < 1000; i++) {
      r.t++;
      r.f.loop(r.t);
      if (r.t % 10 === 0) w.step(0.01);
    }
  };
  r.warm();
  r.step = (ms) => {
    for (let i = 0; i < ms; i++) {
      r.t++;
      r.f.loop(r.t);
      if (r.t % 10 === 0) w.step(0.01);
      if (r.t % 100 === 0) {
        // average joint speed over 100 ms: the program sends a new position every 20 ms (one servo frame) and the
        // servo reaches it within a few ms, so a 10 ms window would see twice the average speed
        const j = w.joints();
        if (r.lastJ) j.forEach((v, k) => (r.maxSpeed[k] = Math.max(r.maxSpeed[k], Math.abs(v - r.lastJ[k]) / 0.1)));
        r.lastJ = j;
      }
    }
  };
  r.until = (fn, max) => {
    for (let i = 0; i < max; i += 10) {
      if (fn()) return true;
      r.step(10);
    }
    return fn();
  };
  r.reboot = () => {
    r.f.powerOff();
    w.setOutputs(false);
    r.f = r.make();
    r.f.setup(r.t);
    r.warm();
  };
  r.feed = (override = true) => {
    r.f.feed(override);
    r.step(5);
  };
  return r;
}
const states = (r) => r.events.filter((e) => e.type === 'state').map((e) => e.to);

/* ------------------------------------------------------------------ sketch and constants */
test('every constant is read from the .ino and the geometry matches the kinematics module', () => {
  assert.deepEqual(missing, []);
  assert.equal(S.h0, ARM.h0);
  assert.equal(S.l1, ARM.l1);
  assert.equal(S.l2, ARM.l2);
  assert.equal(S.l3, ARM.l3);
  assert.deepEqual(arm.limits, ARM.limits);
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bdelay(Microseconds)?\s*\(/, 'the loop must not block');
  for (const lib of ['Adafruit_PWMServoDriver.h', 'HX711.h', 'Adafruit_INA219.h', 'Preferences.h', 'Wire.h']) assert.match(source, new RegExp(`#include <${lib.replace('.', '\\.')}>`));
  assert.match(code, /digitalWrite\(OE_PIN, HIGH\)/, 'outputs disabled at start');
});

test('pins are valid on an ESP32-WROOM-32E and do not clash', () => {
  const pins = [S.sdaPin, S.sclPin, S.hxDtPin, S.hxSckPin, S.beamPin, S.lidPin, S.estopPin, S.buttonPin, S.oePin, S.ledPin];
  assert.equal(new Set(pins).size, pins.length);
  for (const g of pins) assert.ok(![6, 7, 8, 9, 10, 11, 0, 2, 5, 12, 15].includes(g), `GPIO${g}: flash or strapping pin`);
  for (const g of [S.hxSckPin, S.oePin, S.ledPin]) assert.ok(![34, 35, 36, 39].includes(g), `GPIO${g} is an output`);
  assert.deepEqual([S.sdaPin, S.sclPin], [21, 22], 'default I2C pins of the Arduino core');
  assert.equal(new Set([S.chBase, S.chShoulder, S.chElbow, S.chWrist, S.chDoor]).size, 5);
});

/* ------------------------------------------------------------------ kinematics */
test('forward kinematics: the worked example of the book', () => {
  const f = forward([0, 45, -90, 45], arm);
  near(f.elbow.x, 120 * Math.cos(Math.PI / 4), 1e-9);
  near(f.elbow.z, 90 + 120 * Math.sin(Math.PI / 4), 1e-9);
  near(f.wrist.x, 2 * 120 * Math.cos(Math.PI / 4), 1e-9, 'wrist x = 169.7');
  near(f.wrist.z, 90, 1e-9, 'wrist back at shoulder height');
  near(f.spoon.x, 169.706 + 70, 1e-3);
  near(f.phi, 0, 1e-9);
  const turned = forward([90, 45, -90, 45], arm);
  near(turned.spoon.x, 0, 1e-9);
  near(turned.spoon.y, 239.706, 1e-3);
});

test('inverse kinematics: worked example (r 200, z 60, level spoon) and round trips', () => {
  const r = inverse({ x: 200, y: 0, z: 60, phi: 0 }, arm);
  assert.ok(r.ok);
  near(r.q[2], -112.454, 0.001, 'elbow');
  near(r.q[1], 43.232, 0.001, 'shoulder');
  near(r.q[3], 69.222, 0.001, 'wrist');
  for (let k = 0; k < 400; k++) {
    const q = [-80 + (k * 37) % 160, 15 + (k * 53) % 140, -145 + (k * 71) % 140, -85 + (k * 29) % 170];
    const f = forward(q, arm);
    const back = inverse({ x: f.spoon.x, y: f.spoon.y, z: f.spoon.z, phi: f.phi }, arm);
    if (!back.ok) continue; // the other elbow solution may be the only one inside the limits
    const g = forward(back.q, arm);
    near(Math.hypot(g.spoon.x - f.spoon.x, g.spoon.y - f.spoon.y, g.spoon.z - f.spoon.z), 0, 1e-6, 'position');
    near(g.phi, f.phi, 1e-6, 'pitch');
  }
});

test('impossible targets are detected with a reason', () => {
  const far = inverse({ x: 400, y: 0, z: 90, phi: 0 }, arm);
  assert.equal(far.ok, false);
  assert.equal(far.reason, 'out-of-reach');
  const lim = inverse({ x: 60, y: 0, z: 20, phi: 60 }, arm);
  assert.equal(lim.ok, false);
  assert.ok(['joint-limit', 'too-close'].includes(lim.reason));
  const behind = inverse({ x: -150, y: -20, z: 120, phi: 0 }, arm);
  assert.equal(behind.ok, false, 'behind the base: the base would have to turn past 90 degrees');
  assert.equal(behind.reason, 'joint-limit');
  assert.equal(reachOf(arm).max, 240);
});

test('every waypoint of the cycle is reachable inside the joint limits', () => {
  const wp = waypoints(S);
  const pts = [wp.aboveHopper, wp.dip, wp.scoop, wp.abovePlate, wp.dump, wp.aboveDump, wp.pourAt(S.carryPhi), wp.pourAt(S.pourPhiMin)];
  for (const p of pts) {
    const r = inverse(p, arm);
    assert.ok(r.ok, `${JSON.stringify(p)}: ${r.reason}`);
    assert.ok(withinLimits(r.q, arm));
  }
  assert.ok(withinLimits([S.homeQ0, S.homeQ1, S.homeQ2, S.homeQ3], arm));
  for (let phi = S.carryPhi; phi >= S.pourPhiMin; phi -= S.pourStepDeg) assert.ok(inverse(wp.pourAt(phi), arm).ok, `pour at ${phi}`);
});

test('coordinated moves: all joints finish together and never exceed the speed limit', () => {
  const m = planMove([0, 110, -135, 40], [-65, 75, -98, 33], 60);
  let prev = m.from, worst = 0;
  for (let t = 0.01; t <= m.duration + 1e-9; t += 0.01) {
    const q = sampleMove(m, t);
    worst = Math.max(worst, ...q.map((v, i) => Math.abs(v - prev[i]) / 0.01));
    prev = q;
  }
  assert.ok(worst <= 60.5, `peak ${worst.toFixed(1)} deg/s`);
  assert.deepEqual(sampleMove(m, m.duration), m.to);
});

test('static torque: the servos chosen carry the arm with margin', () => {
  const masses = { upper: 0.04, elbowServo: 0.055, fore: 0.03, wristServo: 0.014, spoon: 0.01 };
  const tau = holdingTorques([0, 0, 0, 0], masses, 0.015, arm); // arm fully stretched, horizontal: the worst case
  const kgcm = (t) => (t / 9.81) * 100;
  near(kgcm(tau[1]), 2.55, 0.05, 'shoulder holding torque kg*cm');
  assert.ok(kgcm(tau[1]) * 3 < 9.4, 'MG996R (about 9.4 kg*cm at 4.8 V) has more than 3x margin');
  assert.ok(kgcm(tau[3]) * 3 < 1.8, 'MG90S wrist (about 1.8 kg*cm) has more than 3x margin');
});

/* ------------------------------------------------------------------ the feeding cycle */
test('a full automatic cycle: sequence, ration within tolerance, mass conserved, parked with outputs off', () => {
  const r = rig();
  r.f.setRation(20);
  r.feed();
  assert.ok(r.until(() => r.f.state === 'IDLE' && r.f.lastResult, 240000), `ended in ${r.f.state} ${r.f.phase} ${r.f.fault}`);
  const res = r.f.lastResult;
  assert.equal(res.ok, true, JSON.stringify(res));
  near(res.delivered, 20, S.rationTolG + 0.6, 'program-measured ration');
  near(r.w.plateG, 20, S.rationTolG + 1, 'food really on the plate');
  near(r.w.totalG, r.total0, 1e-6, 'mass conserved');
  near(r.w.spoonG, 0, 0.05, 'spoon emptied back into the hopper before parking');
  assert.equal(r.w.outputsOn, false, 'outputs disabled while the plate is reachable');
  assert.ok(r.w.door.pos <= S.doorOpenDeg + 0.6, 'door open again');
  const seq = states(r);
  for (const st of ['DOOR_CLOSING', 'TARE', 'CYCLE', 'DOOR_OPENING', 'IDLE']) assert.ok(seq.includes(st), `missing ${st}`);
  const phases = r.events.filter((e) => e.type === 'phase').map((e) => e.phase);
  for (const ph of ['TO_HOPPER', 'DIP', 'SCOOP', 'LIFT', 'TO_PLATE', 'POUR', 'WEIGH', 'TO_DUMP', 'DUMP', 'HOME']) assert.ok(phases.includes(ph), `missing phase ${ph}`);
  assert.equal(r.prefs.cycle, 0);
  for (const v of r.maxSpeed) assert.ok(v <= S.speedMaxDps * 1.02, `servo speed ${v.toFixed(1)} deg/s`);
});

test('the door is closed for every arm move of a cycle (the cat cannot reach the arm)', () => {
  const r = rig();
  r.f.setRation(15);
  r.feed();
  let bad = 0;
  for (let i = 0; i < 240000 && !(r.f.state === 'IDLE' && r.f.lastResult); i += 10) {
    r.step(10);
    const moving = r.w.servo.some((sv) => Math.abs(sv.speed) > 0.5);
    if (moving && r.w.door.pos < S.doorClosedDeg - 0.6) bad++;
  }
  assert.equal(bad, 0);
});

test('the ration is configurable and limited by the sketch constants', () => {
  const r = rig();
  assert.equal(r.f.setRation(1), S.rationMinG);
  assert.equal(r.f.setRation(500), S.rationMaxG);
  assert.equal(r.f.setRation(33), 33);
  r.f.setRation(33);
  r.feed();
  assert.ok(r.until(() => r.f.state === 'IDLE' && r.f.lastResult, 300000));
  near(r.f.lastResult.delivered, 33, S.rationTolG + 0.6);
  near(r.w.totalG, r.total0, 1e-6);
});

test('cooldown: a second ration right after the first is refused unless the tutor overrides', () => {
  const r = rig();
  r.f.setRation(10);
  r.feed(true);
  r.until(() => r.f.state === 'IDLE' && r.f.lastResult, 240000);
  r.w.plateG = 0; // Pancho ate it
  const before = r.events.length;
  r.feed(false);
  r.step(200);
  const refused = r.events.slice(before).find((e) => e.type === 'refused');
  assert.ok(refused && refused.blockers.includes('cooldown'));
  assert.equal(r.f.state, 'IDLE');
});

test('a plate that still holds food blocks a new ration', () => {
  const r = rig();
  r.w.plateG = 30;
  r.step(1000);
  r.feed(true);
  r.step(200);
  const ev = r.events.find((e) => e.type === 'refused');
  assert.ok(ev && ev.blockers.includes('plateNotFull'));
});

test('power cut in the middle of a cycle: no second ration after the restart, a fault until the tutor resets', () => {
  const r = rig();
  r.f.setRation(20);
  r.feed();
  r.until(() => r.f.phase === 'TO_PLATE', 120000);
  r.w.power = false;
  r.step(3000);
  r.w.power = true;
  r.reboot();
  assert.equal(r.f.state, 'FAULT');
  assert.equal(r.f.fault, FAULT.INTERRUPTED);
  const plate = r.w.plateG;
  r.step(120000);
  near(r.w.plateG, plate, 1e-9, 'nothing was added by itself');
  r.f.feed(true);
  r.step(500);
  assert.equal(r.f.state, 'FAULT', 'feeding is refused while the fault is active');
});

test('reset after a fault: the arm goes home slowly, empties the spoon, parks; no feeding by itself', () => {
  const r = rig();
  r.f.setRation(20);
  r.feed();
  r.until(() => r.f.phase === 'LIFT', 120000);
  r.w.lidOpen = true;
  r.step(50);
  assert.equal(r.f.fault, FAULT.LID);
  assert.equal(r.w.servo.every((sv) => sv.cmd == null), true, 'arm servos stopped driving');
  r.step(2000);
  assert.equal(r.w.servo.every((sv) => sv.cmd == null), true, 'and they stay without pulses during the fault');
  assert.notEqual(r.w.door.cmd, null, 'while the door servo keeps holding the door closed');
  r.f.reset();
  r.step(100);
  assert.equal(r.f.state, 'FAULT', 'refused while the lid is open');
  r.w.lidOpen = false;
  r.f.reset();
  assert.ok(r.until(() => r.f.state === 'IDLE', 120000), r.f.state + ' ' + r.f.phase);
  near(r.w.spoonG, 0, 0.05);
  near(r.w.totalG, r.total0, 1e-6);
  const plate = r.w.plateG;
  r.step(60000);
  near(r.w.plateG, plate, 1e-9, 'no automatic new ration');
});

test('cat at the window during a cycle: immediate stop, door stays closed, manual recovery', () => {
  const r = rig();
  r.feed();
  r.until(() => r.f.phase === 'TO_PLATE', 120000);
  r.w.cat = true;
  r.step(30);
  assert.equal(r.f.fault, FAULT.PRESENCE);
  const pose = r.w.joints();
  r.step(5000);
  assert.deepEqual(r.w.joints(), pose, 'the arm does not move');
  assert.ok(r.w.door.pos >= S.doorClosedDeg - 0.6, 'door still closed: Pancho cannot reach the arm');
  r.f.reset();
  r.step(100);
  assert.equal(r.f.state, 'FAULT', 'no recovery while he is there');
  r.w.cat = false;
  r.f.reset();
  assert.ok(r.until(() => r.f.state === 'IDLE', 120000));
});

test('cat at the window while the door closes: the door opens again (never closes on a paw)', () => {
  const r = rig();
  r.feed();
  r.until(() => r.w.door.pos > S.doorOpenDeg + 20, 20000);
  r.w.cat = true;
  r.step(40);
  assert.equal(r.f.fault, FAULT.PRESENCE);
  r.step(4000);
  assert.ok(r.w.door.pos <= S.doorOpenDeg + 0.6, 'door back open');
});

test('jam: a stuck servo raises the current; the program stops within the jam time', () => {
  const r = rig();
  r.feed();
  r.until(() => r.f.phase === 'LIFT', 120000);
  r.w.servo[1].jam = true;
  // the current rises once the command has moved away from the stuck position; the program then has JAM_MS
  let overSince = null;
  for (let i = 0; i < 5000 && r.f.state !== 'FAULT'; i++) {
    r.step(1);
    if (overSince == null && r.w.currentMa() > S.jamMa) overSince = r.t;
  }
  assert.equal(r.f.fault, FAULT.JAM);
  assert.ok(overSince != null);
  assert.ok(r.t - overSince <= S.jamMs + 20, `${r.t - overSince} ms after the current passed ${S.jamMa} mA`);
  assert.equal(r.w.currentMa() < S.jamMa, true, 'servos no longer driven');
});

test('scale disconnected or stuck: a cycle stops; a new one is refused', () => {
  for (const mode of ['disconnected', 'stuck']) {
    const r = rig();
    r.feed();
    r.until(() => r.f.phase === 'TO_PLATE', 120000);
    r.w.scaleMode = mode;
    assert.ok(r.until(() => r.f.state === 'FAULT', 5000), mode);
    assert.equal(r.f.fault, FAULT.SCALE, mode);
    const q = rig();
    q.w.scaleMode = mode;
    q.step(3000);
    q.feed(true);
    q.step(200);
    assert.ok(q.events.some((e) => e.type === 'refused' && e.blockers.includes('scale')), mode);
  }
});

test('empty hopper: two empty scoops, then a fault; nothing invented', () => {
  const r = rig();
  r.w.hopperG = 0;
  r.total0 = r.w.totalG;
  r.feed();
  assert.ok(r.until(() => r.f.state === 'FAULT', 300000));
  assert.equal(r.f.fault, FAULT.HOPPER_EMPTY);
  near(r.w.plateG, 0, 1e-9);
  near(r.w.totalG, r.total0, 1e-9);
});

test('almost empty hopper: the corrections are limited and the shortfall is reported', () => {
  const r = rig();
  r.w.hopperG = 8;
  r.total0 = r.w.totalG;
  r.f.setRation(30);
  r.feed();
  assert.ok(r.until(() => r.f.state === 'FAULT' || (r.f.state === 'IDLE' && r.f.lastResult), 400000));
  assert.ok(r.f.lastResult.delivered < 30 - S.rationTolG);
  assert.ok((r.f.scoops ?? 0) <= S.maxScoops);
  near(r.w.totalG, r.total0, 1e-9);
});

test('emergency stop: servo power is cut by the switch; the program sees it and needs a reset', () => {
  const r = rig();
  r.feed();
  r.until(() => r.f.phase === 'DIP', 120000);
  r.w.estopPressed = true;
  r.step(30);
  assert.equal(r.f.fault, FAULT.ESTOP);
  assert.equal(r.w.currentMa(), 0);
  r.w.estopPressed = false;
  r.step(5000);
  assert.equal(r.f.state, 'FAULT', 'releasing the button does not restart anything');
});

test('stop and pause from the tutor', () => {
  const r = rig();
  r.feed();
  r.until(() => r.f.phase === 'LIFT', 120000);
  r.f.pause(true);
  const q = r.w.joints();
  r.step(3000);
  assert.deepEqual(r.w.joints().map((v) => +v.toFixed(6)), q.map((v) => +v.toFixed(6)), 'paused: holding');
  r.f.pause(false);
  r.step(500);
  assert.notDeepEqual(r.w.joints(), q, 'continues after pause');
  r.f.stop();
  r.step(20);
  assert.equal(r.f.fault, FAULT.STOPPED);
});

test('manual mode: joint targets are clamped to the limits, impossible points are rejected', () => {
  const r = rig();
  r.f.enterManual();
  assert.ok(r.until(() => r.f.phase === 'READY', 10000));
  const ok = r.f.manualJoints([200, 5, 20, -200]);
  assert.deepEqual(ok.q, [S.q0Max, S.q1Min, S.q2Max, S.q3Min]);
  r.step(20000);
  const bad = r.f.manualPoint({ x: 500, y: 0, z: 100, phi: 0 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'out-of-reach');
  const good = r.f.manualPoint({ x: 200, y: 0, z: 60, phi: 0 });
  assert.ok(good.ok);
  r.step(20000);
  const f = r.w.pose();
  near(f.spoon.x, 200, 0.5);
  near(f.spoon.z, 60, 0.5);
  r.f.leaveManual();
  assert.ok(r.until(() => r.f.state === 'IDLE', 60000));
});

test('load cell: tare and calibration with a known weight give the right grams', () => {
  const r = rig({ prefs: { cycle: 0, delivered: 0, offset: 0, cal: 1 } });
  r.step(2000);
  assert.ok(r.f.tare(), 'tare with the empty dish');
  r.step(1000);
  near(r.f.weightG, 0, 0.6 * 420, 'raw counts near zero after tare');
  r.w.knownMassG = 100;
  r.step(1000);
  assert.ok(r.f.calibrate(100));
  r.step(1000);
  near(r.f.weightG, 100, 0.5);
  r.w.knownMassG = 0;
  r.w.plateG = 37;
  r.step(1000);
  near(r.f.weightG, 37, 0.5);
});

test('mass is conserved in every scenario, and food is never created', () => {
  for (const seed of [1, 2, 5, 9]) {
    const r = rig({ seed });
    r.f.setRation(12 + seed * 3);
    r.feed();
    r.step(20000 + seed * 9000);
    if (seed % 2) r.w.cat = true;
    r.step(3000);
    r.w.cat = false;
    r.f.reset();
    r.step(150000);
    near(r.w.totalG, r.total0, 1e-6, `seed ${seed}`);
    assert.ok(r.w.hopperG >= 0 && r.w.spoonG >= 0 && r.w.plateG >= 0 && r.w.floorG >= 0);
  }
});
