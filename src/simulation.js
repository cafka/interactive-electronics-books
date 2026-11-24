/**
 * Models the logic level of GPIO17 and how the "signal front" travels along the circuit path.
 * Path positions are fractions 0..1 (0 = GPIO17 pin, 1 = GND pin).
 *
 * The signal is shown as a region [tail, front]. Turning the pin HIGH moves `front` forward;
 * turning it LOW moves `tail` forward until it catches up. Slow-motion is only a teaching aid:
 * in a real circuit the whole path responds almost instantly.
 */
export const SUPPLY_V = 3.3;
export const LED_VF = 2.0;
export const RESISTOR_OHMS = 330;
export const CURRENT_MA = ((SUPPLY_V - LED_VF) / RESISTOR_OHMS) * 1000; // ~3.9 mA

export class Signal {
  constructor() {
    this.on = false; // logic level of GPIO17
    this.front = 0;
    this.tail = 0;
    this.led = 0; // smoothed LED brightness 0..1
    this.gpio = 0; // smoothed pin glow 0..1
    this.slow = true;
    this.sinceOn = 99;
    this.ledFraction = 0.6; // set by main once the path is known
    this.history = [{ t: performance.now(), v: 0 }];
    this.listeners = new Set();
  }

  get delay() {
    return this.slow ? 0.45 : 0;
  }
  get speed() {
    return this.slow ? 1 / 1.5 : 1 / 0.1; // path fractions per second
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  /** Hard reset (used when leaving a lesson): no animation, everything off. */
  reset() {
    this.on = false;
    this.front = this.tail = this.led = this.gpio = 0;
    this.sinceOn = 99;
    this.history = [{ t: performance.now(), v: 0 }];
  }

  set(value) {
    if (value === this.on) return false;
    this.on = value;
    this.sinceOn = 0;
    this.history.push({ t: performance.now(), v: value ? 1 : 0 });
    if (this.history.length > 400) this.history.splice(0, this.history.length - 400);
    for (const fn of this.listeners) fn(value);
    return true;
  }

  update(dt) {
    const v = this.speed;
    if (this.on) {
      this.sinceOn += dt;
      if (this.sinceOn >= this.delay) this.front = Math.min(1, this.front + v * dt);
      this.tail = Math.max(0, this.tail - v * 4 * dt);
    } else {
      this.tail = Math.min(this.front, this.tail + v * dt);
      if (this.tail >= this.front) {
        this.tail = 0;
        this.front = 0;
      }
    }
    const pathLit = this.tail < this.ledFraction && this.front > this.ledFraction;
    const k = (rate) => 1 - Math.exp(-dt * rate);
    this.led += ((pathLit ? 1 : 0) - this.led) * k(14);
    this.gpio += ((this.on ? 1 : 0) - this.gpio) * k(12);
  }

  /** Index (0..4) of the explanation step to highlight, or -1. */
  activeStep(fr) {
    if (!this.on) return this.tail > 0 && this.tail < this.front ? 2 : -1;
    if (this.sinceOn < this.delay * 0.5) return 0;
    if (this.front < 0.01) return 1;
    if (this.front < fr.wire1End) return 2;
    if (this.front < fr.resOut) return 3;
    return 4;
  }
}

/**
 * A current "wave" along a path, used by lesson 2 for the pull-up (input) current.
 * Same [tail, front] idea as Signal, without the LED-specific parts.
 */
export class Wave {
  constructor() {
    this.on = false;
    this.front = 0;
    this.tail = 0;
  }
  set(on) {
    this.on = on;
  }
  reset() {
    this.on = false;
    this.front = 0;
    this.tail = 0;
  }
  update(dt, speed) {
    if (this.on) {
      this.front = Math.min(1, this.front + speed * dt);
      this.tail = Math.max(0, this.tail - speed * 4 * dt);
    } else {
      this.tail = Math.min(this.front, this.tail + speed * dt);
      if (this.tail >= this.front) this.tail = this.front = 0;
    }
  }
}
