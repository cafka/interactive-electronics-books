/*
 * Chapter 3 logic: the robotic cat feeder. A line-by-line port of arduino/cat_feeder/cat_feeder.ino.
 * Pure JavaScript with injected time and I/O (no DOM, no THREE), so it runs in the page and in Node tests.
 * All the constants are read from the sketch (parseFeederSettings), so the page and the board cannot disagree.
 *
 * What the program controls: 4 arm servos and 1 access-door servo through a PCA9685 (I2C), the PCA9685 output
 * enable (OE), and a status LED. What it reads: an HX711 load cell under the plate, an IR break beam at the cat's
 * access window, the service-lid switch, the emergency-stop contact, a push button and an INA219 that measures the
 * servo supply current (used to detect a jam). It never resumes a cycle on its own after a fault or a reset.
 */
import { forward, inverse, planMove, sampleMove } from './armKinematics.js';

export const FEEDER_DEFAULTS = {
  sdaPin: 21, sclPin: 22, hxDtPin: 19, hxSckPin: 18, beamPin: 27, lidPin: 26, estopPin: 25, buttonPin: 13, oePin: 33, ledPin: 4,
  chBase: 0, chShoulder: 1, chElbow: 2, chWrist: 3, chDoor: 4,
  h0: 90, l1: 120, l2: 120, l3: 70,
  q0Min: -90, q0Max: 90, q1Min: 10, q1Max: 160, q2Min: -150, q2Max: 0, q3Min: -95, q3Max: 95,
  q0Zero: 90, q1Zero: 0, q2Zero: 180, q3Zero: 90, q0Dir: 1, q1Dir: 1, q2Dir: 1, q3Dir: 1,
  servoUsMin: 500, servoUsMax: 2500,
  homeQ0: 0, homeQ1: 110, homeQ2: -135, homeQ3: 40,
  doorOpenDeg: 10, doorClosedDeg: 100, doorDps: 45,
  speedMaxDps: 60, speedLoadedDps: 35, speedPourDps: 20, speedManualDps: 20,
  hopperR: 210, hopperAz: -65, hopperTopZ: 170, dipZ: 40, scoopZ: 45, strokeMm: 30,
  plateR: 210, plateAz: 65, plateZ: 150, dumpZ: 140,
  carryPhi: 10, digPhi: -35, pourPhiMin: -70, pourStepDeg: 4, pourStepMs: 250, anticipateG: 1,
  rationDefaultG: 20, rationMinG: 5, rationMaxG: 80, rationTolG: 2, maxScoops: 6, minGainG: 1.5, excessG: 6, plateFullG: 15,
  scaleCal: 420, scaleOffset: 84000, scaleMs: 100, scaleTimeoutMs: 500, scaleMinG: -50, scaleMaxG: 2000, settleMs: 1500, stableG: 1,
  jamMa: 1800, jamMs: 300,
  motionMs: 20, doorTimeoutMs: 4000, debounceMs: 30, longPressMs: 2000, cooldownMs: 1800000,
  beamBrokenLevel: 0, lidClosedLevel: 0, estopOkLevel: 0,
};
const NAMES = {
  sdaPin: 'SDA_PIN', sclPin: 'SCL_PIN', hxDtPin: 'HX_DT_PIN', hxSckPin: 'HX_SCK_PIN', beamPin: 'BEAM_PIN', lidPin: 'LID_PIN', estopPin: 'ESTOP_PIN',
  buttonPin: 'BUTTON_PIN', oePin: 'OE_PIN', ledPin: 'LED_PIN',
  chBase: 'CH_BASE', chShoulder: 'CH_SHOULDER', chElbow: 'CH_ELBOW', chWrist: 'CH_WRIST', chDoor: 'CH_DOOR',
  h0: 'ARM_H0_MM', l1: 'ARM_L1_MM', l2: 'ARM_L2_MM', l3: 'ARM_L3_MM',
  q0Min: 'Q0_MIN', q0Max: 'Q0_MAX', q1Min: 'Q1_MIN', q1Max: 'Q1_MAX', q2Min: 'Q2_MIN', q2Max: 'Q2_MAX', q3Min: 'Q3_MIN', q3Max: 'Q3_MAX',
  q0Zero: 'Q0_ZERO', q1Zero: 'Q1_ZERO', q2Zero: 'Q2_ZERO', q3Zero: 'Q3_ZERO', q0Dir: 'Q0_DIR', q1Dir: 'Q1_DIR', q2Dir: 'Q2_DIR', q3Dir: 'Q3_DIR',
  servoUsMin: 'SERVO_US_MIN', servoUsMax: 'SERVO_US_MAX',
  homeQ0: 'HOME_Q0', homeQ1: 'HOME_Q1', homeQ2: 'HOME_Q2', homeQ3: 'HOME_Q3',
  doorOpenDeg: 'DOOR_OPEN_DEG', doorClosedDeg: 'DOOR_CLOSED_DEG', doorDps: 'DOOR_DPS',
  speedMaxDps: 'SPEED_MAX_DPS', speedLoadedDps: 'SPEED_LOADED_DPS', speedPourDps: 'SPEED_POUR_DPS', speedManualDps: 'SPEED_MANUAL_DPS',
  hopperR: 'HOPPER_R_MM', hopperAz: 'HOPPER_AZ_DEG', hopperTopZ: 'HOPPER_TOP_Z', dipZ: 'DIP_Z', scoopZ: 'SCOOP_Z', strokeMm: 'STROKE_MM',
  plateR: 'PLATE_R_MM', plateAz: 'PLATE_AZ_DEG', plateZ: 'PLATE_Z', dumpZ: 'DUMP_Z',
  carryPhi: 'CARRY_PHI', digPhi: 'DIG_PHI', pourPhiMin: 'POUR_PHI_MIN', pourStepDeg: 'POUR_STEP_DEG', pourStepMs: 'POUR_STEP_MS', anticipateG: 'ANTICIPATE_G',
  rationDefaultG: 'RATION_DEFAULT_G', rationMinG: 'RATION_MIN_G', rationMaxG: 'RATION_MAX_G', rationTolG: 'RATION_TOL_G', maxScoops: 'MAX_SCOOPS',
  minGainG: 'MIN_GAIN_G', excessG: 'EXCESS_G', plateFullG: 'PLATE_FULL_G',
  scaleCal: 'SCALE_CAL', scaleOffset: 'SCALE_OFFSET', scaleMs: 'SCALE_MS', scaleTimeoutMs: 'SCALE_TIMEOUT_MS', scaleMinG: 'SCALE_MIN_G', scaleMaxG: 'SCALE_MAX_G',
  settleMs: 'SETTLE_MS', stableG: 'STABLE_G',
  jamMa: 'JAM_MA', jamMs: 'JAM_MS',
  motionMs: 'MOTION_MS', doorTimeoutMs: 'DOOR_TIMEOUT_MS', debounceMs: 'DEBOUNCE_MS', longPressMs: 'LONG_PRESS_MS', cooldownMs: 'COOLDOWN_MS',
  beamBrokenLevel: 'BEAM_BROKEN_LEVEL', lidClosedLevel: 'LID_CLOSED_LEVEL', estopOkLevel: 'ESTOP_OK_LEVEL',
};

/** Reads the constants of the sketch (integers, decimals, negatives, LOW/HIGH). Returns { settings, missing }. */
export function parseFeederSettings(source) {
  const settings = { ...FEEDER_DEFAULTS };
  const missing = [];
  for (const [key, name] of Object.entries(NAMES)) {
    const m = source.match(new RegExp(`^\\s*(?:static\\s+)?(?:const|constexpr)\\s+[\\w:]+\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?|LOW|HIGH)(?:UL|ul|U|L|f|F)?\\s*;`, 'm'));
    if (m) settings[key] = m[1] === 'LOW' ? 0 : m[1] === 'HIGH' ? 1 : Number(m[1]);
    else missing.push(name);
  }
  return { settings, missing };
}

export const armOf = (s) => ({
  h0: s.h0, l1: s.l1, l2: s.l2, l3: s.l3,
  limits: [[s.q0Min, s.q0Max], [s.q1Min, s.q1Max], [s.q2Min, s.q2Max], [s.q3Min, s.q3Max]],
});
const DEG = Math.PI / 180;
const at = (r, az, z, phi) => ({ x: r * Math.cos(az * DEG), y: r * Math.sin(az * DEG), z, phi });

/** The task-space waypoints of one feeding cycle, from the settings (mm and deg). */
export function waypoints(s) {
  return {
    aboveHopper: at(s.hopperR, s.hopperAz, s.hopperTopZ, s.carryPhi),
    dip: at(s.hopperR + s.strokeMm / 2, s.hopperAz, s.dipZ, s.digPhi), // the bowl goes in tilted down, on the far side
    scoop: at(s.hopperR - s.strokeMm / 2, s.hopperAz, s.scoopZ, s.carryPhi), // drags toward the base while turning up
    abovePlate: at(s.plateR, s.plateAz, s.plateZ, s.carryPhi),
    dump: at(s.hopperR, s.hopperAz, s.dumpZ, s.pourPhiMin), // leftovers go back into the hopper
    aboveDump: at(s.hopperR, s.hopperAz, s.dumpZ, s.carryPhi),
    pourAt: (phi) => at(s.plateR, s.plateAz, s.plateZ, phi),
  };
}

export const FAULT = {
  NONE: 'NONE', ESTOP: 'ESTOP', LID: 'LID_OPEN', PRESENCE: 'PRESENCE', JAM: 'JAM', SCALE: 'SCALE', HOPPER_EMPTY: 'HOPPER_EMPTY',
  INTERRUPTED: 'INTERRUPTED', UNREACHABLE: 'UNREACHABLE', DOOR: 'DOOR', STOPPED: 'STOPPED',
};
export const FAULT_TEXT = {
  ESTOP: 'emergency stop pressed (servo power cut by the switch)',
  LID_OPEN: 'service lid opened',
  PRESENCE: 'the cat is at the access window',
  JAM: 'servo current too high for too long (jam or blocked arm)',
  SCALE: 'load cell reading missing, out of range or not settling',
  HOPPER_EMPTY: 'two scoops in a row added almost nothing (hopper empty or food bridging)',
  INTERRUPTED: 'a cycle was running when the board restarted (power cut or reset)',
  UNREACHABLE: 'a target outside the reachable space or the joint limits',
  DOOR: 'the access door did not close (blocked)',
  STOPPED: 'stopped by the user',
};
/** Faults that are a hardware condition the program sees directly; the rest are inferred. */
export const CHECKS = ['estop', 'lid', 'beam', 'scale', 'calibrated', 'plateNotFull', 'cooldown', 'noFault'];

const u32 = (x) => x >>> 0;

export class CatFeeder {
  /**
   * @param s settings from parseFeederSettings
   * @param io { readScale(): counts|null, readBeam(), readLid(), readEstop(), readButton(): 0|1, readCurrentMa(): number,
   *            setServo(ch, deg), servoOff(ch), setOutputs(on), loadPrefs(): obj, savePrefs(obj), onEvent(ev) }
   */
  constructor(s, io) {
    this.s = { ...s };
    this.io = io;
    this.arm = armOf(this.s);
    this.wp = waypoints(this.s);
    this.running = false;
    this.state = 'OFF';
    this.phase = '';
    this.fault = FAULT.NONE;
    this.ration = this.s.rationDefaultG;
    this.speedPct = 100;
    this.paused = false;
  }

  emit(ev) {
    this.io.onEvent?.(ev);
  }
  home() {
    return [this.s.homeQ0, this.s.homeQ1, this.s.homeQ2, this.s.homeQ3];
  }
  /** Joint angle (deg) -> servo angle (0..180), and back. */
  jointToServo(j, q) {
    const s = this.s;
    const z = [s.q0Zero, s.q1Zero, s.q2Zero, s.q3Zero][j], d = [s.q0Dir, s.q1Dir, s.q2Dir, s.q3Dir][j];
    return Math.min(180, Math.max(0, z + d * q));
  }
  servoToJoint(j, deg) {
    const s = this.s;
    const z = [s.q0Zero, s.q1Zero, s.q2Zero, s.q3Zero][j], d = [s.q0Dir, s.q1Dir, s.q2Dir, s.q3Dir][j];
    return (deg - z) / d;
  }
  /** Servo angle -> pulse width in microseconds (what the PCA9685 is told). */
  pulseUs(deg) {
    return this.s.servoUsMin + ((this.s.servoUsMax - this.s.servoUsMin) * deg) / 180;
  }

  /* ---------------- configuration from the tutor (UI or serial) ---------------- */
  setRation(g) {
    this.ration = Math.min(this.s.rationMaxG, Math.max(this.s.rationMinG, Math.round(g)));
    return this.ration;
  }
  setSpeedPct(p) {
    this.speedPct = Math.min(100, Math.max(20, Math.round(p)));
  }

  /* ---------------- setup ---------------- */
  setup(nowMs) {
    const now = u32(nowMs);
    const s = this.s;
    this.running = true;
    this.io.setOutputs(false); // PCA9685 outputs disabled first (OE high): no servo moves while the board starts
    this.outputsOn = false;
    this.armDriven = false;
    // calibrated stays false until the tutor has done tare + known weight once: no feeding with a guessed scale
    this.prefs = { cycle: 0, delivered: 0, offset: s.scaleOffset, cal: s.scaleCal, calibrated: false, ...this.io.loadPrefs() };
    this.q = this.home(); // the program assumes the arm is parked; the first move is a slow move home
    this.doorCmd = s.doorOpenDeg;
    this.move = null;
    this.moveT = 0;
    this.lastMotion = now;
    this.scaleBuf = [];
    this.weightG = 0;
    this.scaleOk = false;
    this.lastScaleAt = now;
    this.lastScaleRead = now;
    this.lastCounts = null;
    this.sameCounts = 0;
    this.lastRawAt = now;
    this.lastNow = now;
    this.currentMa = 0;
    this.jamSince = null;
    this.btn = { last: this.io.readButton(), stable: this.io.readButton(), changed: now, downAt: null, longFired: false };
    this.requests = []; // 'feed', 'feed-override', 'reset', 'stop'
    this.cooldownUntil = u32(now + s.cooldownMs); // after any start-up the last feeding time is unknown: wait, or override
    this.coolArmed = true;
    this.lastResult = null;
    this.paused = false;
    this.fault = FAULT.NONE;
    this.state = 'OFF';
    if (this.prefs.cycle) {
      // a cycle was in progress when the power went: never resume it, never start a new one by itself
      this.delivered = this.prefs.delivered;
      this.enterFault(FAULT.INTERRUPTED, now);
    } else this.enter('IDLE', now);
  }

  /* ---------------- inputs ---------------- */
  estopOk() {
    return this.io.readEstop() === this.s.estopOkLevel;
  }
  lidClosed() {
    return this.io.readLid() === this.s.lidClosedLevel;
  }
  catPresent() {
    return this.io.readBeam() === this.s.beamBrokenLevel;
  }
  readScale(now) {
    const s = this.s;
    if (u32(now - this.lastScaleRead) < s.scaleMs) return;
    this.lastScaleRead = now;
    const counts = this.io.readScale();
    if (counts == null) {
      if (u32(now - this.lastScaleAt) > s.scaleTimeoutMs) this.scaleOk = false;
      return;
    }
    this.lastRawAt = now;
    // a converter that returns the very same value many times in a row is not measuring (wire, chip or supply)
    this.sameCounts = counts === this.lastCounts ? this.sameCounts + 1 : 0;
    this.lastCounts = counts;
    const g = (counts - this.prefs.offset) / this.prefs.cal;
    const valid = g >= s.scaleMinG && g <= s.scaleMaxG && this.sameCounts < 20;
    if (valid) {
      this.lastScaleAt = now;
      this.scaleBuf.push(g);
      if (this.scaleBuf.length > 4) this.scaleBuf.shift();
      this.weightG = this.scaleBuf.reduce((a, b) => a + b, 0) / this.scaleBuf.length;
    }
    this.scaleOk = valid && u32(now - this.lastScaleAt) <= s.scaleTimeoutMs;
    this.emit({ type: 'scale', g, valid, now });
  }
  readButton(now) {
    const s = this.s, b = this.btn;
    const raw = this.io.readButton();
    if (raw !== b.last) {
      b.last = raw;
      b.changed = now;
    }
    if (raw !== b.stable && u32(now - b.changed) >= s.debounceMs) {
      b.stable = raw;
      if (raw === 0) {
        b.downAt = now;
        b.longFired = false;
      } else if (b.downAt != null) {
        if (!b.longFired) this.requests.push('short');
        b.downAt = null;
      }
    }
    if (b.stable === 0 && b.downAt != null && !b.longFired && u32(now - b.downAt) >= s.longPressMs) {
      b.longFired = true;
      this.requests.push('long');
    }
  }
  readCurrent(now) {
    this.currentMa = this.io.readCurrentMa();
    if (this.currentMa > this.s.jamMa) {
      if (this.jamSince == null) this.jamSince = now;
    } else this.jamSince = null;
  }

  /* ---------------- outputs ---------------- */
  /** Commands the four arm servos from this.q (deg). Called every MOTION_MS while the outputs are enabled. */
  writeArm() {
    const s = this.s;
    if (!this.armDriven) return; // after armOff() the arm gets no pulses until a new start, even if the door is held
    [s.chBase, s.chShoulder, s.chElbow, s.chWrist].forEach((ch, j) => this.io.setServo(ch, this.jointToServo(j, this.q[j])));
  }
  armOff() {
    const s = this.s;
    this.armDriven = false;
    for (const ch of [s.chBase, s.chShoulder, s.chElbow, s.chWrist]) this.io.servoOff(ch); // no pulse: the servo stops driving
  }

  /* ---------------- motion ---------------- */
  /** Plans a coordinated move to a task target {x,y,z,phi} or to joint angles [q0..q3]. False if it cannot be reached. */
  goTo(target, dps) {
    let q = target;
    if (!Array.isArray(target)) {
      const r = inverse(target, this.arm);
      if (!r.ok) {
        this.emit({ type: 'ik-fail', reason: r.reason, target });
        return false;
      }
      q = r.q;
    }
    this.move = planMove(this.q, q, dps * (this.speedPct / 100));
    this.moveT = 0;
    return true;
  }
  moving() {
    return !!this.move && this.moveT < this.move.duration;
  }
  stepMotion(now) {
    const s = this.s;
    if (u32(now - this.lastMotion) < s.motionMs) return;
    const dt = u32(now - this.lastMotion) / 1000;
    this.lastMotion = now;
    if (this.move && !this.paused) {
      this.moveT = Math.min(this.move.duration, this.moveT + dt);
      this.q = sampleMove(this.move, this.moveT);
    }
    // the door moves at a limited speed toward its command (a small servo with a soft edge: low force)
    const step = s.doorDps * dt;
    if (this.doorPos == null) this.doorPos = this.doorCmd;
    if (!this.paused || this.state === 'DOOR_OPENING') this.doorPos += Math.max(-step, Math.min(step, this.doorCmd - this.doorPos));
    if (this.outputsOn) {
      this.writeArm();
      this.io.setServo(s.chDoor, this.doorPos);
    }
  }

  /* ---------------- states ---------------- */
  enter(state, now, phase = '') {
    const from = this.state;
    this.state = state;
    this.phase = phase;
    this.stateAt = now;
    this.emit({ type: 'state', from, to: state, phase, now });
  }
  setPhase(phase, now) {
    this.phase = phase;
    this.phaseAt = now;
    this.emit({ type: 'phase', phase, now });
  }
  outputs(on) {
    this.outputsOn = on;
    if (on) this.armDriven = true; // only a start, manual mode or a reset switch the outputs on
    this.io.setOutputs(on);
  }
  enterFault(code, now) {
    this.fault = code;
    this.move = null;
    this.paused = false;
    // the arm stops driving at once; the door servo keeps holding the door closed, so the cat stays out
    this.armOff();
    if (code === FAULT.ESTOP) this.outputs(false); // the switch has already cut servo power
    this.lastResult = { ok: false, fault: code, delivered: this.delivered ?? 0, target: this.ration };
    this.emit({ type: 'fault', code, now });
    this.enter('FAULT', now);
  }
  saveCycle(active) {
    this.prefs.cycle = active ? 1 : 0;
    this.prefs.delivered = this.delivered ?? 0;
    this.io.savePrefs({ ...this.prefs });
  }

  /** Why a feeding cycle cannot start now (empty list = it can). */
  blockers(now, override) {
    const out = [];
    if (!this.estopOk()) out.push('estop');
    if (!this.lidClosed()) out.push('lid');
    if (this.catPresent()) out.push('beam');
    if (!this.scaleOk) out.push('scale');
    if (!this.prefs.calibrated) out.push('calibrated');
    if (this.scaleOk && this.weightG > this.s.plateFullG) out.push('plateNotFull');
    if (!override && this.cooldownActive(now)) out.push('cooldown');
    if (this.state === 'FAULT') out.push('noFault');
    return out;
  }
  /** Same test as the sketch: (int32_t)(cooldownUntil - now) > 0, correct across the millis() wrap. */
  cooldownActive(now) {
    return ((this.cooldownUntil - u32(now)) | 0) > 0;
  }
  cooldownLeftMs(now) {
    return this.cooldownActive(now) ? (this.cooldownUntil - u32(now)) | 0 : 0;
  }

  /** Commands from the tutor. feed(override) = the button (short press) or a long press to override the cooldown. */
  feed(override = false) {
    this.requests.push(override ? 'feed-override' : 'feed');
  }
  stop() {
    this.requests.push('stop');
  }
  reset() {
    this.requests.push('reset');
  }
  pause(on) {
    if (['CYCLE', 'MANUAL', 'RECOVERING'].includes(this.state)) this.paused = on;
  }
  /** The converter answers and is not frozen. (Grams may still be meaningless: that is what the tare fixes.) */
  rawOk() {
    return this.lastCounts != null && this.sameCounts < 20 && u32(this.lastNow - this.lastRawAt) <= this.s.scaleTimeoutMs;
  }
  tare() {
    // only with nothing moving and an empty dish. It must not need valid grams: before the first calibration the
    // grams are out of range, and asking for them would make the first tare impossible.
    if (this.state !== 'IDLE' || !this.rawOk()) return false;
    this.prefs.offset = this.lastCounts;
    this.scaleBuf = [];
    this.io.savePrefs({ ...this.prefs });
    this.emit({ type: 'tare', offset: this.lastCounts });
    return true;
  }
  calibrate(knownG) {
    if (this.state !== 'IDLE' || !this.rawOk() || !(knownG > 0)) return false;
    const cal = (this.lastCounts - this.prefs.offset) / knownG;
    if (!(cal > 1)) return false;
    this.prefs.cal = cal;
    this.prefs.calibrated = true;
    this.scaleBuf = [];
    this.io.savePrefs({ ...this.prefs });
    this.emit({ type: 'calibrated', cal });
    return true;
  }
  /** Manual mode: joint targets, or a task-space point through the inverse kinematics. */
  manualJoints(q) {
    if (this.state !== 'MANUAL' || this.phase !== 'READY') return { ok: false, reason: 'not-in-manual' };
    const lim = this.arm.limits;
    const t = q.map((v, i) => Math.min(lim[i][1], Math.max(lim[i][0], v)));
    this.goTo(t, this.s.speedManualDps);
    return { ok: true, q: t };
  }
  manualPoint(p) {
    if (this.state !== 'MANUAL' || this.phase !== 'READY') return { ok: false, reason: 'not-in-manual' };
    const r = inverse(p, this.arm);
    if (!r.ok) {
      this.emit({ type: 'ik-fail', reason: r.reason, target: p });
      return r;
    }
    this.goTo(r.q, this.s.speedManualDps);
    return r;
  }
  enterManual() {
    this.requests.push('manual');
  }
  leaveManual() {
    this.requests.push('leave-manual');
  }

  /* ---------------- the loop ---------------- */
  loop(nowMs) {
    if (!this.running) return;
    const now = u32(nowMs);
    const s = this.s;
    this.lastNow = now;
    this.readButton(now);
    this.readScale(now);
    this.readCurrent(now);

    // button: short press = feed, long press = feed now even in the cooldown, or reset after a fault
    const reqs = this.requests.splice(0);
    for (const r of reqs) {
      if (r === 'short') this.requests.push(this.state === 'FAULT' ? 'none' : 'feed');
      if (r === 'long') this.requests.push(this.state === 'FAULT' ? 'reset' : 'feed-override');
    }
    const req = new Set(this.requests.splice(0).concat(reqs.filter((r) => r !== 'short' && r !== 'long')));

    // ---- safety: checked in every state that can move something ----
    const active = ['DOOR_CLOSING', 'TARE', 'CYCLE', 'MANUAL', 'RECOVERING', 'DOOR_OPENING'].includes(this.state);
    if (this.state !== 'FAULT' && this.state !== 'OFF') {
      if (!this.estopOk() && (active || this.state === 'IDLE')) {
        if (active || this.outputsOn) return this.enterFault(FAULT.ESTOP, now);
      }
      if (active) {
        if (!this.lidClosed()) return this.enterFault(FAULT.LID, now);
        if (this.jamSince != null && u32(now - this.jamSince) >= s.jamMs) return this.enterFault(FAULT.JAM, now);
        if (this.catPresent() && this.state !== 'DOOR_OPENING') {
          if (this.state === 'DOOR_CLOSING') {
            // never close the door on a paw: open it again and abandon the start
            this.doorCmd = s.doorOpenDeg;
            this.emit({ type: 'door-reopen', now });
          }
          return this.enterFault(FAULT.PRESENCE, now);
        }
        if (!this.scaleOk && ['TARE', 'CYCLE'].includes(this.state)) return this.enterFault(FAULT.SCALE, now);
      }
      if (req.has('stop') && active) {
        this.saveCycle(this.state === 'CYCLE' || this.state === 'TARE');
        return this.enterFault(FAULT.STOPPED, now);
      }
    }

    switch (this.state) {
      case 'IDLE': {
        if (req.has('feed') || req.has('feed-override')) {
          const b = this.blockers(now, req.has('feed-override'));
          if (b.length) this.emit({ type: 'refused', blockers: b, now });
          else {
            this.delivered = 0;
            this.scoops = 0;
            this.lowGain = 0;
            this.target = this.ration;
            this.outputs(true);
            this.goTo(this.home(), s.speedManualDps); // from wherever the program believes it is: slowly
            this.doorCmd = s.doorClosedDeg;
            this.enter('DOOR_CLOSING', now);
          }
        } else if (req.has('manual')) {
          if (!this.lidClosed() || this.catPresent() || !this.estopOk()) this.emit({ type: 'refused', blockers: this.blockers(now, true), now });
          else {
            this.outputs(true);
            this.doorCmd = s.doorClosedDeg;
            this.enter('MANUAL', now, 'CLOSING_DOOR');
          }
        }
        break;
      }
      case 'DOOR_CLOSING':
        if (Math.abs(this.doorPos - s.doorClosedDeg) < 0.5 && !this.moving()) {
          this.saveCycle(true); // from here on a reset must not lead to a second ration
          this.enter('TARE', now);
          this.scaleBuf = [];
        } else if (u32(now - this.stateAt) > s.doorTimeoutMs + 6000) return this.enterFault(FAULT.DOOR, now);
        break;
      case 'TARE':
        if (u32(now - this.stateAt) >= s.settleMs && this.scaleBuf.length >= 4) {
          this.baseline = this.weightG; // what is already on the plate (leftovers): the ration is counted on top of it
          this.emit({ type: 'baseline', g: this.baseline, now });
          this.enter('CYCLE', now);
          this.startScoop(now);
        }
        break;
      case 'CYCLE':
        this.cycleStep(now);
        break;
      case 'DOOR_OPENING':
        if (Math.abs(this.doorPos - s.doorOpenDeg) < 0.5) {
          this.outputs(false); // parked: outputs off, the arm cannot move while the plate is reachable
          this.armOff();
          this.saveCycle(false);
          this.cooldownUntil = u32(now + s.cooldownMs);
          this.coolArmed = true;
          this.emit({ type: 'done', result: this.lastResult, now });
          this.enter('IDLE', now);
        }
        break;
      case 'MANUAL':
        if (this.phase === 'CLOSING_DOOR') {
          if (Math.abs(this.doorPos - s.doorClosedDeg) < 0.5) {
            this.goTo(this.q, s.speedManualDps);
            this.setPhase('READY', now);
          }
        } else if (this.phase === 'READY' && req.has('leave-manual')) {
          this.goTo(this.home(), s.speedManualDps);
          this.setPhase('HOMING', now);
        } else if (this.phase === 'HOMING' && !this.moving()) {
          this.doorCmd = s.doorOpenDeg;
          this.lastResult = this.lastResult ?? null;
          this.enter('DOOR_OPENING', now);
        }
        break;
      case 'FAULT':
        if (req.has('reset')) {
          // recovery needs the cause gone and the tutor's long press; the arm then goes home slowly
          const blocked = [];
          if (!this.estopOk()) blocked.push('estop');
          if (!this.lidClosed()) blocked.push('lid');
          if (this.catPresent()) blocked.push('beam');
          if (blocked.length) this.emit({ type: 'refused', blockers: blocked, now });
          else {
            this.fault = FAULT.NONE;
            this.outputs(true);
            this.paused = false;
            this.doorCmd = s.doorClosedDeg;
            this.goTo(this.home(), s.speedManualDps);
            this.enter('RECOVERING', now, 'HOMING');
          }
        }
        break;
      case 'RECOVERING':
        if (!this.moving() && Math.abs(this.doorPos - s.doorClosedDeg) < 0.5) {
          this.goTo(this.wp.aboveDump, s.speedManualDps); // empty whatever is left in the spoon back into the hopper
          this.enter('CYCLE', now, 'R_TO_DUMP');
          this.recovering = true;
        }
        break;
      default:
    }
    this.stepMotion(now);
  }

  startScoop(now) {
    this.goTo(this.wp.aboveHopper, this.s.speedMaxDps);
    this.setPhase('TO_HOPPER', now);
  }

  cycleStep(now) {
    const s = this.s, wp = this.wp;
    if (this.moving()) return;
    const go = (target, dps, phase) => {
      if (!this.goTo(target, dps)) return this.enterFault(FAULT.UNREACHABLE, now);
      this.setPhase(phase, now);
    };
    switch (this.phase) {
      case 'TO_HOPPER': return go(wp.dip, s.speedMaxDps, 'DIP');
      case 'DIP': return go(wp.scoop, s.speedPourDps, 'SCOOP');
      case 'SCOOP': return go(wp.aboveHopper, s.speedLoadedDps, 'LIFT');
      case 'LIFT': return go(wp.abovePlate, s.speedLoadedDps, 'TO_PLATE');
      case 'TO_PLATE':
        this.pourPhi = s.carryPhi;
        this.pourAt = now;
        this.setPhase('POUR', now);
        return;
      case 'POUR': {
        // feedback pour: tilt a little, read the scale, stop as soon as the plate holds the ration
        if (u32(now - this.pourAt) < s.pourStepMs) return;
        this.pourAt = now;
        const net = this.weightG - this.baseline;
        if (net >= this.target - s.anticipateG || this.pourPhi <= s.pourPhiMin) return go(wp.abovePlate, s.speedPourDps, 'UNPOUR');
        this.pourPhi = Math.max(s.pourPhiMin, this.pourPhi - s.pourStepDeg);
        if (!this.goTo(wp.pourAt(this.pourPhi), s.speedPourDps)) return this.enterFault(FAULT.UNREACHABLE, now);
        return;
      }
      case 'UNPOUR':
        this.scaleBuf = [];
        this.setPhase('WEIGH', now);
        return;
      case 'WEIGH': {
        if (u32(now - this.phaseAt) < s.settleMs || this.scaleBuf.length < 4) return;
        const spread = Math.max(...this.scaleBuf) - Math.min(...this.scaleBuf);
        if (spread > s.stableG) {
          if (u32(now - this.phaseAt) > s.settleMs * 3) return this.enterFault(FAULT.SCALE, now);
          return;
        }
        const before = this.delivered;
        this.delivered = this.weightG - this.baseline;
        const gain = this.delivered - before;
        this.scoops++;
        this.saveCycle(true);
        this.emit({ type: 'weighed', delivered: this.delivered, gain, scoops: this.scoops, now });
        if (this.delivered >= this.target - s.rationTolG) {
          const excess = this.delivered > this.target + s.excessG;
          if (excess) this.emit({ type: 'excess', delivered: this.delivered, target: this.target, now });
          this.lastResult = { ok: true, delivered: this.delivered, target: this.target, scoops: this.scoops, excess };
          return go(wp.aboveDump, s.speedLoadedDps, 'TO_DUMP');
        }
        if (gain < s.minGainG) this.lowGain++;
        else this.lowGain = 0;
        if (this.lowGain >= 2) {
          return this.enterFault(FAULT.HOPPER_EMPTY, now);
        }
        if (this.scoops >= s.maxScoops) {
          this.lastResult = { ok: false, short: true, delivered: this.delivered, target: this.target, scoops: this.scoops };
          this.emit({ type: 'short', delivered: this.delivered, target: this.target, now });
          return go(wp.aboveDump, s.speedLoadedDps, 'TO_DUMP');
        }
        return this.startScoop(now);
      }
      case 'TO_DUMP':
      case 'R_TO_DUMP':
        return go(wp.dump, s.speedPourDps, this.phase === 'R_TO_DUMP' ? 'R_DUMP' : 'DUMP');
      case 'DUMP':
      case 'R_DUMP':
        return go(wp.aboveDump, s.speedPourDps, this.phase === 'R_DUMP' ? 'R_UNDUMP' : 'UNDUMP');
      case 'UNDUMP':
      case 'R_UNDUMP':
        return go(this.home(), s.speedMaxDps, this.phase === 'R_UNDUMP' ? 'R_HOME' : 'HOME');
      case 'HOME':
      case 'R_HOME':
        if (this.phase === 'R_HOME') {
          this.recovering = false;
          this.lastResult = this.lastResult ?? { ok: false, recovered: true, delivered: this.delivered ?? 0 };
        }
        this.doorCmd = s.doorOpenDeg;
        this.armOff();
        this.enter('DOOR_OPENING', now);
        return;
      default:
    }
  }

  /** Power off / page stop: nothing runs, outputs off. The saved preferences stay (that is the point). */
  powerOff() {
    this.running = false;
    this.outputsOn = false;
    this.state = 'OFF';
  }

  spoonPose() {
    return forward(this.q, this.arm);
  }
}
