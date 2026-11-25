/*
 * Chapter 3 physical model: what the sketch cannot see directly. Servos (with a speed limit, a supply current and a
 * jam fault), the access door, the kibble in the hopper, the spoon, the plate and the floor, the HX711 load cell,
 * the IR beam, the service lid, the emergency stop and the supply. Pure JavaScript (no DOM, no THREE).
 *
 * Food is moved only by the spoon's real pose (forward kinematics of the servo positions), never by a timer, and its
 * mass is conserved: hopper + spoon + plate + floor + eaten stays equal to the starting total.
 * The numbers are teaching values for a small hobby arm (MG996R and MG90S class servos, dry kibble), not
 * measurements: the chapter asks the reader to measure the real spoon capacity, servo current and load cell.
 */
import { forward } from './armKinematics.js';
import { armOf, waypoints } from './catFeeder.js';

export const WORLD = {
  spoonCapG: 12, // a level spoon of dry kibble
  fillGps: 25, // grams per second that enter a spoon dragged through kibble
  pourGps: 18, // grams per second that leave a tilted spoon at most
  hopperCapG: 800, hopperFloorZ: 20, hopperHeight: 120, hopperHalf: 55, // hopper footprint: a 110 mm square
  plateRadius: 60, plateTopZ: 30, dishG: 160,
  servoDps: 300, doorServoDps: 300, // what the servos can do (the program asks for much less)
  idleMa: 120, // ESP32 side is separate: this is the servo rail only, outputs enabled and holding
  moveMaPerDps: 6, // extra current while a servo moves, per deg/s
  stallMa: 2400, // one MG996R stalled at 6 V (datasheet class value)
  catEatsGps: 0.6,
  scaleNoiseCounts: 60, // HX711 at 10 samples/s with a 1 kg bar cell: about 0.15 g
};

/** Small seeded random generator (mulberry32). */
export function makeRng(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FeederWorld {
  constructor(settings, opts = {}, seed = 7) {
    this.s = settings;
    this.p = { ...WORLD, ...opts };
    this.rng = makeRng(seed);
    this.arm = armOf(settings);
    this.wp = waypoints(settings);
    const s = settings;
    // servo positions (servo degrees, 0..180) start at the parked pose; null command = no pulse (limp)
    const home = [s.homeQ0, s.homeQ1, s.homeQ2, s.homeQ3];
    const z = [s.q0Zero, s.q1Zero, s.q2Zero, s.q3Zero], d = [s.q0Dir, s.q1Dir, s.q2Dir, s.q3Dir];
    this.servo = home.map((q, j) => ({ pos: z[j] + d[j] * q, cmd: null, jam: false, speed: 0 }));
    this.door = { pos: s.doorOpenDeg, cmd: null, blocked: false, speed: 0 };
    this.outputsOn = false;
    this.power = true; // the 6 V servo supply (and the ESP32's USB) are on
    this.estopPressed = false;
    this.lidOpen = false;
    this.cat = false; // Pancho is at the access window
    this.scaleMode = 'ok'; // 'ok' | 'disconnected' | 'stuck'
    this.hopperG = 600;
    this.spoonG = 0;
    this.plateG = 0; // food on the plate (the dish itself is weighed too)
    this.floorG = 0; // spilled inside the arm chamber
    this.eatenG = 0;
    this.knownMassG = 0; // a calibration weight on the plate (guided experiment)
    this.trueOffset = 84000; // what the HX711 reads with an empty dish... approximately: see dishG
    this.trueCal = 420; // counts per gram of this cell
    this.stuckCounts = null;
    this.fillLuck = 0.8 + 0.2 * this.rng();
    this.lastSpoon = null;
    this.flows = { toPlate: 0, toHopper: 0, toFloor: 0, fromHopper: 0 }; // g/s right now, for the animation
  }

  get totalG() {
    return this.hopperG + this.spoonG + this.plateG + this.floorG + this.eatenG;
  }
  /** Joint angles from the real servo positions. */
  joints() {
    const s = this.s;
    const z = [s.q0Zero, s.q1Zero, s.q2Zero, s.q3Zero], d = [s.q0Dir, s.q1Dir, s.q2Dir, s.q3Dir];
    return this.servo.map((sv, j) => (sv.pos - z[j]) / d[j]);
  }
  pose() {
    return forward(this.joints(), this.arm);
  }
  hopperCentre() {
    return this.wp.aboveHopper;
  }
  plateCentre() {
    return this.wp.abovePlate;
  }
  surfaceZ() {
    return this.p.hopperFloorZ + (this.hopperG / this.p.hopperCapG) * this.p.hopperHeight;
  }
  inHopper(pt) {
    const c = this.hopperCentre();
    return Math.abs(pt.x - c.x) < this.p.hopperHalf && Math.abs(pt.y - c.y) < this.p.hopperHalf;
  }
  overPlate(pt) {
    const c = this.plateCentre();
    return Math.hypot(pt.x - c.x, pt.y - c.y) < this.p.plateRadius;
  }
  /** How much a spoon at pitch phi can hold: full when level or tip up, nothing when tipped 50 deg down. */
  capAt(phi) {
    return this.p.spoonCapG * Math.min(1, Math.max(0, (phi + 50) / 50));
  }

  /* ---------------- what the ESP32 commands ---------------- */
  setServo(ch, deg) {
    const s = this.s;
    if (ch === s.chDoor) this.door.cmd = deg;
    else this.servo[[s.chBase, s.chShoulder, s.chElbow, s.chWrist].indexOf(ch)].cmd = deg;
  }
  servoOff(ch) {
    const s = this.s;
    if (ch === s.chDoor) this.door.cmd = null;
    else this.servo[[s.chBase, s.chShoulder, s.chElbow, s.chWrist].indexOf(ch)].cmd = null;
  }
  setOutputs(on) {
    this.outputsOn = on;
  }
  driven() {
    return this.power && this.outputsOn && !this.estopPressed; // the E-stop switch is in series with the servo supply
  }

  /* ---------------- what the ESP32 reads ---------------- */
  readScale() {
    if (!this.power || this.scaleMode === 'disconnected') return null;
    const g = this.p.dishG + this.plateG + this.knownMassG;
    const counts = Math.round(this.trueOffset + this.trueCal * g + (this.rng() - 0.5) * 2 * this.p.scaleNoiseCounts);
    if (this.scaleMode === 'stuck') {
      this.stuckCounts ??= counts;
      return this.stuckCounts;
    }
    this.stuckCounts = null;
    return counts;
  }
  readBeam() {
    return this.cat ? 0 : 1; // break-beam receiver: LOW when the beam is broken
  }
  readLid() {
    return this.lidOpen ? 1 : 0; // lid switch to GND with INPUT_PULLUP: closed = LOW
  }
  readEstop() {
    return this.estopPressed ? 1 : 0; // a second, normally closed contact of the E-stop to GND: pressed or cut = HIGH
  }
  currentMa() {
    if (!this.driven()) return 0;
    let ma = this.p.idleMa;
    for (const sv of [...this.servo, this.door]) {
      if (sv.cmd == null) continue;
      ma += this.p.moveMaPerDps * Math.abs(sv.speed);
      if (sv.jam && Math.abs(sv.cmd - sv.pos) > 2) ma += this.p.stallMa;
      if (sv === this.door && this.door.blocked && Math.abs(sv.cmd - sv.pos) > 2) ma += 900;
    }
    return ma;
  }

  /* ---------------- physics step ---------------- */
  step(dt) {
    const p = this.p;
    const drive = this.driven();
    // servos move toward their command at their own speed limit (a jammed servo does not move)
    for (const sv of this.servo) {
      const before = sv.pos;
      if (drive && sv.cmd != null && !sv.jam) {
        const step = p.servoDps * dt;
        sv.pos += Math.max(-step, Math.min(step, sv.cmd - sv.pos));
      }
      sv.speed = (sv.pos - before) / dt;
    }
    {
      const sv = this.door, before = sv.pos;
      if (drive && sv.cmd != null && !(sv.blocked && sv.cmd > sv.pos)) {
        const step = p.doorServoDps * dt;
        sv.pos += Math.max(-step, Math.min(step, sv.cmd - sv.pos));
      }
      sv.speed = (sv.pos - before) / dt;
    }

    // food: fill while the bowl moves through the kibble, spill whatever the spoon's pitch cannot hold
    const pose = this.pose();
    const bowl = pose.spoon;
    const moved = this.lastSpoon ? Math.hypot(bowl.x - this.lastSpoon.x, bowl.y - this.lastSpoon.y, bowl.z - this.lastSpoon.z) / dt : 0;
    this.lastSpoon = { ...bowl };
    const cap = this.capAt(pose.phi);
    this.flows = { toPlate: 0, toHopper: 0, toFloor: 0, fromHopper: 0 };
    if (this.inHopper(bowl) && bowl.z < this.surfaceZ() && moved > 5 && this.spoonG < cap * this.fillLuck) {
      const g = Math.min(p.fillGps * dt, cap * this.fillLuck - this.spoonG, this.hopperG);
      this.hopperG -= g;
      this.spoonG += g;
      this.flows.fromHopper = g / dt;
    } else if (!this.inHopper(bowl) || bowl.z >= this.surfaceZ()) {
      if (this.lastFill !== false) this.fillLuck = 0.75 + 0.25 * this.rng(); // each scoop fills a little differently
      this.lastFill = false;
    }
    if (this.inHopper(bowl) && bowl.z < this.surfaceZ()) this.lastFill = true;
    if (this.spoonG > cap + 1e-9) {
      const g = Math.min(this.spoonG - cap, p.pourGps * dt);
      this.spoonG -= g;
      if (this.overPlate(bowl)) {
        this.plateG += g;
        this.flows.toPlate = g / dt;
      } else if (this.inHopper(bowl)) {
        this.hopperG += g;
        this.flows.toHopper = g / dt;
      } else {
        this.floorG += g;
        this.flows.toFloor = g / dt;
      }
    }
    // Pancho eats only when he can reach the plate: door open
    if (this.cat && this.door.pos < this.s.doorOpenDeg + 5 && this.plateG > 0) {
      const g = Math.min(this.plateG, p.catEatsGps * dt);
      this.plateG -= g;
      this.eatenG += g;
    }
  }
}
