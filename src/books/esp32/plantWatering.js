/*
 * Chapter 2 logic: smart plant watering.
 * Pure JavaScript with injected time and I/O (no DOM, no THREE, no timers), so it runs in the page and in Node tests.
 *
 * It is a line-by-line port of arduino/plant_watering/plant_watering.ino: the same states, the same filter, the same
 * lock-out rules and the same unsigned millis() arithmetic (every time value is kept as a uint32 with `>>> 0`).
 * The constants are read from the .ino itself (parseSettings), so the demo and the code shown to the reader cannot
 * disagree. The only deliberate addition is setThresholds(): the web page lets you try other moisture thresholds,
 * while on the real board you change the two constants in the sketch.
 */

/** Wiring of this chapter: GPIO numbers and the header each pin is on. */
export const PINS = {
  sensor: { gpio: 34, header: 'J2', label: 'Soil sensor AOUT (ADC1)' },
  pump: { gpio: 25, header: 'J2', label: 'MOSFET gate (pump)' },
  led: { gpio: 26, header: 'J2', label: 'Status LED' },
  button: { gpio: 27, header: 'J2', label: 'Lock-clear button' },
  v3: { header: 'J2', label: '3V3 (sensor supply)' },
  gnd: { header: 'J2', label: 'GND' },
  v5: { header: 'J2', label: '5V (pump supply)' },
};

export const DEFAULT_SETTINGS = {
  sensorPin: 34, pumpPin: 25, ledPin: 26, buttonPin: 27,
  rawDry: 2800, rawWet: 1300, rawValidMin: 200, rawValidMax: 3900,
  dryOn: 35, wetOff: 60, minRise: 2,
  sampleMs: 100, pulseMs: 3000, soakMs: 60000, maxWaterTotalMs: 24000, sensorFaultMs: 2000, debounceMs: 30, reportMs: 2000,
  filterN: 16,
  ledIdlePeriod: 2000, ledIdleOn: 100, ledSoakPeriod: 1000, ledSoakOn: 500, ledCodeSlot: 300, ledCodeOn: 150, ledCodePause: 1200,
};
const NAMES = {
  sensorPin: 'SENSOR_PIN', pumpPin: 'PUMP_PIN', ledPin: 'LED_PIN', buttonPin: 'BUTTON_PIN',
  rawDry: 'RAW_DRY', rawWet: 'RAW_WET', rawValidMin: 'RAW_VALID_MIN', rawValidMax: 'RAW_VALID_MAX',
  dryOn: 'DRY_ON_PERCENT', wetOff: 'WET_OFF_PERCENT', minRise: 'MIN_RISE_PERCENT',
  sampleMs: 'SAMPLE_MS', pulseMs: 'PULSE_MS', soakMs: 'SOAK_MS', maxWaterTotalMs: 'MAX_WATER_TOTAL_MS',
  sensorFaultMs: 'SENSOR_FAULT_MS', debounceMs: 'DEBOUNCE_MS', reportMs: 'REPORT_MS',
  filterN: 'FILTER_N',
  ledIdlePeriod: 'LED_IDLE_PERIOD_MS', ledIdleOn: 'LED_IDLE_ON_MS', ledSoakPeriod: 'LED_SOAK_PERIOD_MS', ledSoakOn: 'LED_SOAK_ON_MS',
  ledCodeSlot: 'LED_CODE_SLOT_MS', ledCodeOn: 'LED_CODE_ON_MS', ledCodePause: 'LED_CODE_PAUSE_MS',
};

/** Reads the constants of the sketch. Returns { settings, missing } (missing names fall back to the defaults). */
export function parseSettings(source) {
  const settings = { ...DEFAULT_SETTINGS };
  const missing = [];
  for (const [key, name] of Object.entries(NAMES)) {
    const m = source.match(new RegExp(`^\\s*(?:static\\s+)?const\\s+\\w+\\s+${name}\\s*=\\s*(\\d+)(?:UL|ul|U|L)?\\s*;`, 'm'));
    if (m) settings[key] = Number(m[1]);
    else missing.push(name);
  }
  return { settings, missing };
}

/** Lock reasons. The number is also the number of LED blinks in the locked pattern. */
export const LOCK = { NONE: 0, SENSOR: 1, NO_RESPONSE: 2, TIMEOUT: 3 };
export const LOCK_TEXT = {
  [LOCK.NONE]: 'none',
  [LOCK.SENSOR]: 'sensor reading not valid (cable? short?)',
  [LOCK.NO_RESPONSE]: 'soil did not get wetter (tank empty? hose blocked?)',
  [LOCK.TIMEOUT]: 'maximum pump time used',
};
export const LOCK_NAME = { [LOCK.NONE]: 'NONE', [LOCK.SENSOR]: 'SENSOR', [LOCK.NO_RESPONSE]: 'NO RESPONSE', [LOCK.TIMEOUT]: 'TIMEOUT' };

const u32 = (x) => x >>> 0;
const PRESSED = 0; // INPUT_PULLUP: a pressed button reads LOW
const RELEASED = 1;

/** Raw reading -> percent, exactly like the sketch (integer arithmetic). A higher raw reading means drier soil. */
export function moisturePercent(raw, s) {
  const span = s.rawDry - s.rawWet;
  const p = Math.trunc(((s.rawDry - raw) * 100) / span);
  return Math.min(100, Math.max(0, p));
}
/** Inverse, for the simulation: the raw reading a sensor gives at a physical moisture percent. */
export function rawFromPercent(pct, s) {
  return Math.round(s.rawDry - (pct / 100) * (s.rawDry - s.rawWet));
}

export class PlantWatering {
  /**
   * @param settings from parseSettings
   * @param io { readAdc(): number 0..4095, readButton(): 0|1, loadLock(): number, saveLock(n), onEvent(ev) (optional) }
   */
  constructor(settings, io) {
    this.s = { ...settings };
    this.io = io;
    this.running = false;
    this.state = 'STOPPED'; // 'IDLE' | 'WATERING' | 'SOAKING' | 'LOCKED' | 'STOPPED'
    this.out = { pump: false, led: false };
    this.lockReason = LOCK.NONE;
    this.stateSinceMs = 0;
    this.pumpTotalMs = 0;
    this.percentBeforePulse = 0;
    this.resetInputs(0);
  }

  resetInputs(now) {
    this.samples = new Array(this.s.filterN).fill(0);
    this.sampleIndex = 0;
    this.sampleCount = 0;
    this.sampleSum = 0;
    this.lastSampleMs = now;
    this.lastRaw = 0;
    this.badSamples = 0;
    this.lastButtonReading = RELEASED;
    this.buttonStable = RELEASED;
    this.buttonChangedMs = now;
    this.clearRequested = false;
    this.stats = { samples: 0, rejected: 0, pulses: 0 };
  }

  emit(ev) {
    this.io.onEvent?.(ev);
  }

  /** The two thresholds the page lets you change (on the board they are constants in the sketch). */
  setThresholds(dryOn, wetOff) {
    const d = Math.min(95, Math.max(5, Math.round(dryOn)));
    const w = Math.min(100, Math.max(d + 5, Math.round(wetOff)));
    this.s.dryOn = d;
    this.s.wetOff = w;
  }

  /* ---- sensor and filter ---- */
  addSample(raw) {
    this.sampleSum -= this.samples[this.sampleIndex];
    this.samples[this.sampleIndex] = raw;
    this.sampleSum += raw;
    this.sampleIndex = (this.sampleIndex + 1) % this.s.filterN;
    if (this.sampleCount < this.s.filterN) this.sampleCount++;
  }
  filterReady() {
    return this.sampleCount >= this.s.filterN;
  }
  filteredRaw() {
    return Math.floor(this.sampleSum / this.s.filterN);
  }
  currentPercent() {
    return moisturePercent(this.filteredRaw(), this.s);
  }
  sensorFault() {
    return this.badSamples >= Math.floor(this.s.sensorFaultMs / this.s.sampleMs);
  }
  sampleSensor(now) {
    if (u32(now - this.lastSampleMs) < this.s.sampleMs) return;
    this.lastSampleMs = now;
    const raw = this.io.readAdc();
    this.lastRaw = raw;
    if (raw < this.s.rawValidMin || raw > this.s.rawValidMax) {
      if (this.badSamples < 255) this.badSamples++;
      this.stats.rejected++;
    } else {
      this.badSamples = 0;
      this.addSample(raw);
      this.stats.samples++;
    }
    this.emit({ type: 'sample', raw, now });
  }

  /* ---- button ---- */
  updateButton(now) {
    const raw = this.io.readButton();
    if (raw !== this.lastButtonReading) {
      this.lastButtonReading = raw;
      this.buttonChangedMs = now;
    }
    if (raw !== this.buttonStable && u32(now - this.buttonChangedMs) >= this.s.debounceMs) {
      this.buttonStable = raw;
      if (this.buttonStable === PRESSED) {
        this.clearRequested = true;
        this.emit({ type: 'button', now });
      }
    }
  }

  /* ---- state ---- */
  enterState(next, now) {
    const from = this.state;
    this.state = next;
    this.stateSinceMs = now;
    this.out.pump = next === 'WATERING';
    if (next === 'WATERING') this.stats.pulses++;
    this.emit({ type: 'state', from, to: next, now });
  }
  lockOut(why, now) {
    this.lockReason = why;
    this.io.saveLock(why);
    this.emit({ type: 'lock', reason: why, now });
    this.enterState('LOCKED', now);
  }
  startPulse(now) {
    this.percentBeforePulse = this.currentPercent();
    this.enterState('WATERING', now);
  }

  ledShouldBeOn(now) {
    const s = this.s;
    const t = u32(now - this.stateSinceMs);
    switch (this.state) {
      case 'IDLE':
        return t % s.ledIdlePeriod < s.ledIdleOn;
      case 'WATERING':
        return true;
      case 'SOAKING':
        return t % s.ledSoakPeriod < s.ledSoakOn;
      case 'LOCKED': {
        const blinks = this.lockReason;
        const cycle = blinks * s.ledCodeSlot + s.ledCodePause;
        const p = t % cycle;
        return p < blinks * s.ledCodeSlot && p % s.ledCodeSlot < s.ledCodeOn;
      }
      default:
        return false;
    }
  }

  /** setup(): the pump is off first; a lock saved before the reset is still in force. */
  setup(nowMs) {
    const now = u32(nowMs);
    this.running = true;
    this.out = { pump: false, led: false };
    this.pumpTotalMs = 0;
    this.percentBeforePulse = 0;
    this.resetInputs(now);
    this.lockReason = this.io.loadLock();
    // state is still 'STOPPED' here, so the first 'state' event says where the program came from
    if (this.lockReason !== LOCK.NONE) this.enterState('LOCKED', now);
    else this.enterState('IDLE', now);
  }

  /** One pass of loop(). */
  loop(nowMs) {
    if (!this.running) return;
    const now = u32(nowMs);
    this.sampleSensor(now);
    this.updateButton(now);

    if (this.state !== 'LOCKED' && this.sensorFault()) this.lockOut(LOCK.SENSOR, now);

    switch (this.state) {
      case 'IDLE':
        if (this.filterReady() && this.currentPercent() < this.s.dryOn) {
          this.pumpTotalMs = 0;
          this.startPulse(now);
        }
        break;
      case 'WATERING':
        if (u32(now - this.stateSinceMs) >= this.s.pulseMs) {
          this.pumpTotalMs += this.s.pulseMs;
          this.enterState('SOAKING', now);
        }
        break;
      case 'SOAKING':
        if (u32(now - this.stateSinceMs) >= this.s.soakMs) {
          const p = this.currentPercent();
          this.emit({ type: 'check', percent: p, before: this.percentBeforePulse, now });
          if (p >= this.s.wetOff) this.enterState('IDLE', now);
          else if (p < this.percentBeforePulse + this.s.minRise) this.lockOut(LOCK.NO_RESPONSE, now);
          else if (this.pumpTotalMs + this.s.pulseMs > this.s.maxWaterTotalMs) this.lockOut(LOCK.TIMEOUT, now);
          else this.startPulse(now);
        }
        break;
      case 'LOCKED':
        if (this.clearRequested) {
          if (this.filterReady() && !this.sensorFault()) {
            this.lockReason = LOCK.NONE;
            this.io.saveLock(LOCK.NONE);
            this.emit({ type: 'cleared', now });
            this.enterState('IDLE', now);
          } else {
            this.emit({ type: 'clear-refused', now });
          }
        }
        break;
      default:
    }
    this.clearRequested = false;
    this.out.led = this.ledShouldBeOn(now);
  }

  /** Stop (the page's Stop button or a page turn): pump and LED off, nothing runs. The saved lock is kept. */
  stop() {
    this.running = false;
    this.out = { pump: false, led: false };
    this.state = 'STOPPED';
  }

  /** Milliseconds left in the current pulse or soak (0 in other states). */
  remainingMs(nowMs) {
    const t = u32(u32(nowMs) - this.stateSinceMs);
    if (this.state === 'WATERING') return Math.max(0, this.s.pulseMs - t);
    if (this.state === 'SOAKING') return Math.max(0, this.s.soakMs - t);
    return 0;
  }
}
