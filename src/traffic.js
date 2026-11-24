/*
 * Chapter 4 logic: the traffic light with a pedestrian button.
 * Pure JavaScript with an injected clock (no DOM, no THREE, no timers), so it runs in the page and in Node tests.
 *
 * It models python/traffic_light.py: the same states, the same rules and the same timing constants. The constants
 * are read from the Python file (parseSettings), so the demo and the code shown to the reader cannot disagree.
 */

/** Wiring of this chapter. BCM = the GPIO number Python uses; pin = the physical position on the 40-pin header. */
export const PINS = {
  red: { bcm: 17, pin: 11, label: 'Red LED' },
  yellow: { bcm: 27, pin: 13, label: 'Yellow LED' },
  green: { bcm: 22, pin: 15, label: 'Green LED' },
  button: { bcm: 23, pin: 16, label: 'Push button' },
  gnd: [6, 14], // pin 6: LED return (through the breadboard rail). pin 14: button return
};

/** Official BCM to physical-pin mapping for the pins this chapter uses (used by the tests). */
export const BCM_TO_PIN = { 17: 11, 22: 15, 23: 16, 27: 13 };

export const DEFAULT_SETTINGS = { minGreen: 4, yellow: 2, crossing: 5, poll: 0.05 };

const NAMES = { minGreen: 'MIN_GREEN_SECONDS', yellow: 'YELLOW_SECONDS', crossing: 'CROSSING_SECONDS', poll: 'POLL_SECONDS' };

/** Reads the timing constants from the Python source. Returns { settings, missing } (missing names fall back). */
export function parseSettings(source) {
  const settings = { ...DEFAULT_SETTINGS };
  const missing = [];
  for (const [key, name] of Object.entries(NAMES)) {
    const m = source.match(new RegExp(`^${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)`, 'm'));
    if (m) settings[key] = Number(m[1]);
    else missing.push(name);
  }
  return { settings, missing };
}

export const STATES = ['GREEN', 'YELLOW', 'RED'];

export class TrafficMachine {
  constructor(settings = DEFAULT_SETTINGS) {
    this.settings = { ...settings };
    this.running = false;
    this.state = 'STOPPED';
    this.since = 0;
    this.request = false;
    this.stats = this.freshStats();
  }

  freshStats() {
    return { registered: 0, repeated: 0, ignored: 0, ignoredStopped: 0, served: 0, lastCrossing: null };
  }

  /** The program starts: green on, timers from this instant, nothing pending. */
  start(t) {
    this.running = true;
    this.request = false;
    this.stats = this.freshStats();
    this._enter('GREEN', t);
    return { type: 'start', to: 'GREEN', t };
  }

  /** Ctrl+C / Stop: every LED off, the pending request is forgotten. */
  stop() {
    this.running = false;
    this.state = 'STOPPED';
    this.request = false;
  }

  _enter(state, t) {
    this.state = state;
    this.since = t;
  }

  /** The button went LOW (when_pressed). Mirrors request_crossing() in the Python file. */
  press(t) {
    if (!this.running) {
      this.stats.ignoredStopped++;
      return { type: 'press', result: 'ignored-stopped', t };
    }
    if (this.state !== 'GREEN') {
      this.stats.ignored++;
      return { type: 'press', result: 'ignored-crossing', t };
    }
    if (this.request) {
      this.stats.repeated++;
      return { type: 'press', result: 'already-pending', t }; // "request = True" runs again; nothing changes
    }
    this.request = true;
    this.stats.registered++;
    return { type: 'press', result: 'registered', t };
  }

  /** One pass of the Python main loop. Returns the transition that happened, or null. */
  tick(t) {
    if (!this.running) return null;
    const elapsed = t - this.since;
    const s = this.settings;
    if (this.state === 'GREEN' && this.request && elapsed >= s.minGreen) {
      this._enter('YELLOW', t);
      return { type: 'transition', from: 'GREEN', to: 'YELLOW', t };
    }
    if (this.state === 'YELLOW' && elapsed >= s.yellow) {
      this._enter('RED', t);
      return { type: 'transition', from: 'YELLOW', to: 'RED', t };
    }
    if (this.state === 'RED' && elapsed >= s.crossing) {
      this.request = false; // the crossing was served
      this.stats.served++;
      this.stats.lastCrossing = elapsed;
      this._enter('GREEN', t);
      return { type: 'transition', from: 'RED', to: 'GREEN', t, served: true };
    }
    return null;
  }

  elapsed(t) {
    return this.running ? Math.max(0, t - this.since) : 0;
  }

  /**
   * What the "time left" display shows: { kind, left }.
   * kind: 'min-green' (green minimum still running), 'waiting' (green, minimum done, no request),
   *       'now' (green, minimum done, request pending: the change happens on the next pass), 'yellow', 'cross', 'stopped'.
   */
  timer(t) {
    const s = this.settings, e = this.elapsed(t);
    if (!this.running) return { kind: 'stopped', left: null };
    if (this.state === 'GREEN') {
      if (e < s.minGreen) return { kind: 'min-green', left: s.minGreen - e };
      return this.request ? { kind: 'now', left: 0 } : { kind: 'waiting', left: null };
    }
    if (this.state === 'YELLOW') return { kind: 'yellow', left: Math.max(0, s.yellow - e) };
    return { kind: 'cross', left: Math.max(0, s.crossing - e) };
  }

  /** Which GPIO outputs are HIGH. */
  get lights() {
    return { red: this.state === 'RED', yellow: this.state === 'YELLOW', green: this.state === 'GREEN' };
  }
}
