/*
 * Chapter 1 logic: the open door alarm.
 * Pure JavaScript with injected time (no DOM, no THREE, no timers), so it runs in the page and in Node tests.
 *
 * It is a line-by-line port of arduino/door_alarm/door_alarm.ino: the same states, the same debounce, the same
 * unsigned millis() arithmetic (every time value is kept as a uint32 with `>>> 0`, so a wrap-around of millis()
 * behaves like on the board). The constants are read from the .ino itself (parseSettings), so the demo and the
 * code shown to the reader cannot disagree.
 */

/** Wiring of this chapter: GPIO numbers and the position of each pin on the DevKitC headers. */
export const PINS = {
  reed: { gpio: 27, header: 'J2', label: 'Reed switch (door sensor)' },
  led: { gpio: 26, header: 'J2', label: 'LED' },
  buzzer: { gpio: 25, header: 'J2', label: 'Buzzer driver (2N3904 base)' },
  gnd: { header: 'J2', label: 'GND' },
  v5: { header: 'J2', label: '5V' },
};
export const DEFAULT_SETTINGS = { openLimit: 30000, debounce: 30, beepOn: 200, beepOff: 300, reedPin: 27, ledPin: 26, buzzerPin: 25 };
const NAMES = {
  openLimit: 'OPEN_LIMIT_MS', debounce: 'DEBOUNCE_MS', beepOn: 'BEEP_ON_MS', beepOff: 'BEEP_OFF_MS',
  reedPin: 'REED_PIN', ledPin: 'LED_PIN', buzzerPin: 'BUZZER_PIN',
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

export const CLOSED = 0; // reed pin level LOW: contact closed (door closed)
export const OPEN_LEVEL = 1;
const u32 = (x) => x >>> 0;

export class DoorAlarm {
  /**
   * @param settings from parseSettings
   * @param io { read(): 0|1 (raw level of the reed pin), onEvent(ev) (optional) }
   */
  constructor(settings, io) {
    this.s = settings;
    this.io = io;
    this.running = false;
    this.state = 'STOPPED'; // 'DOOR_CLOSED' | 'DOOR_OPEN' | 'ALARM' | 'STOPPED'
    this.out = { led: false, buzzer: false };
    this.lastReading = 0;
    this.stableLevel = 0;
    this.lastChangeMs = 0;
    this.openedAtMs = 0;
    this.beepChangedMs = 0;
    this.beepOn = false;
    this.stats = { rawEdges: 0, accepted: 0 };
  }

  emit(ev) {
    this.io.onEvent?.(ev);
  }
  setOutputs(on) {
    this.out.led = on;
    this.out.buzzer = on;
  }
  doorIsClosed() {
    return this.stableLevel === CLOSED;
  }

  enterState(next, now) {
    const from = this.state;
    this.state = next;
    if (next === 'DOOR_CLOSED') {
      this.beepOn = false;
      this.setOutputs(false);
    } else if (next === 'DOOR_OPEN') {
      this.openedAtMs = now;
      this.beepOn = false;
      this.setOutputs(false);
    } else {
      this.beepOn = true;
      this.beepChangedMs = now;
      this.setOutputs(true);
    }
    this.emit({ type: 'state', from, to: next, now });
  }

  readDoor(now) {
    const raw = this.io.read();
    if (raw !== this.lastReading) {
      this.lastReading = raw;
      this.lastChangeMs = now;
      this.stats.rawEdges++;
      this.emit({ type: 'raw-edge', level: raw, now });
    }
    if (raw !== this.stableLevel && u32(now - this.lastChangeMs) >= this.s.debounce) {
      this.stableLevel = raw;
      this.stats.accepted++;
      this.emit({ type: 'accepted', level: raw, now });
    }
  }

  /** setup(): the first reading is trusted; if the door is already open the count starts now. */
  setup(nowMs) {
    const now = u32(nowMs);
    this.running = true;
    this.stats = { rawEdges: 0, accepted: 0 };
    this.setOutputs(false);
    this.lastReading = this.io.read();
    this.stableLevel = this.lastReading;
    this.lastChangeMs = now;
    this.state = 'DOOR_CLOSED';
    this.enterState(this.doorIsClosed() ? 'DOOR_CLOSED' : 'DOOR_OPEN', now);
  }

  /** One pass of loop(). */
  loop(nowMs) {
    if (!this.running) return;
    const now = u32(nowMs);
    this.readDoor(now);
    switch (this.state) {
      case 'DOOR_CLOSED':
        if (!this.doorIsClosed()) this.enterState('DOOR_OPEN', now);
        break;
      case 'DOOR_OPEN':
        if (this.doorIsClosed()) this.enterState('DOOR_CLOSED', now);
        else if (u32(now - this.openedAtMs) >= this.s.openLimit) this.enterState('ALARM', now);
        break;
      case 'ALARM':
        if (this.doorIsClosed()) this.enterState('DOOR_CLOSED', now);
        else if (this.beepOn && u32(now - this.beepChangedMs) >= this.s.beepOn) {
          this.beepOn = false;
          this.beepChangedMs = now;
          this.setOutputs(false);
          this.emit({ type: 'beep', on: false, now });
        } else if (!this.beepOn && u32(now - this.beepChangedMs) >= this.s.beepOff) {
          this.beepOn = true;
          this.beepChangedMs = now;
          this.setOutputs(true);
          this.emit({ type: 'beep', on: true, now });
        }
        break;
      default:
    }
  }

  /** Stop: outputs off, nothing runs. The elapsed value is kept for display ("the counter is halted"). */
  stop() {
    this.running = false;
    this.setOutputs(false);
    this.beepOn = false;
    this.state = 'STOPPED';
  }

  /** Milliseconds the door has been open (0 while it is closed). */
  elapsedMs(nowMs) {
    if (this.state === 'DOOR_OPEN' || this.state === 'ALARM') return u32(u32(nowMs) - this.openedAtMs);
    return 0;
  }
  remainingMs(nowMs) {
    if (this.state === 'DOOR_OPEN') return Math.max(0, this.s.openLimit - this.elapsedMs(nowMs));
    return 0;
  }
}
