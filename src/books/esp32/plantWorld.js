/*
 * Chapter 2 physical model: what the sketch cannot see. Soil, tank, pump, hose and the sensor's electrical faults.
 * Pure JavaScript (no DOM, no THREE). The numbers are teaching values for a small pot, not measurements of any
 * product: the chapter tells the reader to measure the real pump flow and the real sensor readings.
 *
 * Two layers of soil water, in percent of the soil's capacity:
 *   surface  water that the pump just added and that has not spread yet
 *   bulk     the water around the sensor blade (this is what the sensor measures)
 * The surface water moves into the bulk with a time constant `tau`, so the sensor answers a few tens of seconds
 * after the pump: that delay is why the program soaks and measures again instead of pumping until it sees "wet".
 */
import { rawFromPercent } from './plantWatering.js';

export const WORLD_DEFAULTS = {
  mlPerPercent: 2.5, // 250 ml of water takes this pot from dry to full
  flowMlPerS: 10, // pump flow with the tube attached, at 100 % strength
  tau: 18, // seconds for surface water to reach the sensor depth
  evapPerS: 0.03, // percentage points lost per second (evaporation and the plant drinking)
  tankMax: 500, // ml
  noiseQuiet: 8, // ADC counts, one standard deviation
  noiseLoud: 45,
  spikeChance: 0.03, // chance per reading of a spike when the sensor is noisy
};

/** Strength of the "weak pump" fault of the page. Weak enough to need more pulses than the time limit allows. */
export const WEAK_PUMP = 0.45;

/** Small seeded random generator (mulberry32): the same seed gives the same noise, so tests are repeatable. */
export function makeRng(seed = 12345) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PlantWorld {
  constructor(opts = {}, seed = 12345) {
    this.p = { ...WORLD_DEFAULTS, ...opts };
    this.rng = makeRng(seed);
    this.bulk = 30; // percent, what the sensor sees
    this.surface = 0; // percent-points still on their way down
    this.tankMl = 400;
    this.spillMl = 0; // water that did not fit in the pot
    this.pumpStrength = 1; // 0..1
    this.hoseBlocked = false;
    this.sensor = 'ok'; // 'ok' | 'disconnected' | 'short'
    this.pulldown = true; // the 100 kohm resistor from AOUT to GND is fitted
    this.noisy = false;
    this.floatLevel = 1800; // what a floating, unconnected ADC pin drifts around
    this.pumpedMl = 0; // total water delivered since the start
    this.dryRunS = 0; // seconds the pump ran with no water to move
    this.stallS = 0; // seconds the pump ran against a blocked hose
    this.flowing = false; // water is leaving the hose right now
  }

  gauss() {
    const u = Math.max(1e-9, this.rng()), v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Advance the world by dt seconds with the pump pin in the given state. */
  step(dt, pumpOn) {
    const p = this.p;
    let ml = 0;
    this.flowing = false;
    if (pumpOn) {
      if (this.tankMl <= 0) this.dryRunS += dt;
      else if (this.hoseBlocked) this.stallS += dt;
      else {
        ml = Math.min(this.tankMl, p.flowMlPerS * this.pumpStrength * dt);
        this.tankMl -= ml;
        this.pumpedMl += ml;
        this.flowing = ml > 0 && this.pumpStrength > 0;
      }
    }
    this.surface += ml / p.mlPerPercent;
    const move = this.surface * (1 - Math.exp(-dt / p.tau));
    this.surface -= move;
    this.bulk += move - p.evapPerS * dt;
    if (this.bulk > 100) {
      this.spillMl += (this.bulk - 100) * p.mlPerPercent;
      this.bulk = 100;
    }
    if (this.bulk < 0) this.bulk = 0;
  }

  /** The ADC value the ESP32 would read on the sensor pin right now. `s` carries rawDry and rawWet. */
  readAdc(s) {
    const p = this.p;
    let v;
    if (this.sensor === 'short') v = 4095;
    else if (this.sensor === 'disconnected') {
      if (this.pulldown) v = 2 + Math.abs(this.gauss()) * 2; // the 100 kohm resistor holds the pin at about 0 V
      else {
        // no resistor: a floating pin picks up noise and drifts through plausible values
        this.floatLevel = Math.min(3400, Math.max(500, this.floatLevel + (this.rng() - 0.5) * 24));
        v = this.floatLevel + this.gauss() * 20;
      }
    } else {
      v = rawFromPercent(this.bulk, s) + this.gauss() * (this.noisy ? p.noiseLoud : p.noiseQuiet);
      if (this.noisy && this.rng() < p.spikeChance) v += (this.rng() < 0.5 ? -1 : 1) * (400 + this.rng() * 500);
    }
    return Math.round(Math.min(4095, Math.max(0, v)));
  }

  /** What the sensor sees, with the conversion the page uses to show the soil colour. */
  get wetness() {
    return Math.min(100, this.bulk + this.surface * 0.35);
  }
}
