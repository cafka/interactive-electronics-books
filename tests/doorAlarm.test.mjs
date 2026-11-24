import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DoorAlarm, parseSettings, PINS, CLOSED, OPEN_LEVEL } from '../src/books/esp32/doorAlarm.js';

const source = readFileSync(new URL('../arduino/door_alarm/door_alarm.ino', import.meta.url), 'utf8');
const { settings: S, missing } = parseSettings(source);

/** Runs the sketch for `ms` milliseconds of device time, one loop() pass per millisecond. */
function rig(initialLevel, base = 0) {
  const r = { level: initialLevel, t: base, events: [], beeps: [] };
  r.a = new DoorAlarm(S, { read: () => r.level, onEvent: (e) => r.events.push(e) });
  r.a.setup(r.t);
  r.step = (ms) => {
    for (let i = 0; i < ms; i++) {
      r.t = (r.t + 1) >>> 0;
      r.a.loop(r.t);
      r.beeps.push(r.a.out.buzzer);
    }
  };
  return r;
}
const states = (r) => r.events.filter((e) => e.type === 'state').map((e) => e.to);

test('the constants and pins are read from the .ino', () => {
  assert.deepEqual(missing, []);
  assert.equal(S.openLimit, 30000);
  assert.equal(S.debounce, 30);
  assert.equal(S.beepOn, 200);
  assert.equal(S.beepOff, 300);
  assert.equal(S.reedPin, PINS.reed.gpio);
  assert.equal(S.ledPin, PINS.led.gpio);
  assert.equal(S.buzzerPin, PINS.buzzer.gpio);
  assert.match(source, /pinMode\(REED_PIN, INPUT_PULLUP\)/);
  assert.match(source, /DOOR_CLOSED_LEVEL = LOW/);
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bdelay(Microseconds)?\s*\(/, 'the sketch must not block');
});

test('chosen pins are valid for this use on an ESP32-WROOM-32E', () => {
  const flash = [6, 7, 8, 9, 10, 11], inputOnly = [34, 35, 36, 39], strapping = [0, 2, 5, 12, 15];
  for (const g of [S.reedPin, S.ledPin, S.buzzerPin]) {
    assert.ok(!flash.includes(g) && !strapping.includes(g), `GPIO${g} must not be a flash or strapping pin`);
  }
  for (const g of [S.ledPin, S.buzzerPin]) assert.ok(!inputOnly.includes(g), `GPIO${g} is used as an output`);
  assert.equal(new Set([S.reedPin, S.ledPin, S.buzzerPin]).size, 3);
});

test('door closed: outputs off, counter at zero', () => {
  const r = rig(CLOSED);
  r.step(5000);
  assert.equal(r.a.state, 'DOOR_CLOSED');
  assert.deepEqual(r.a.out, { led: false, buzzer: false });
  assert.equal(r.a.elapsedMs(r.t), 0);
});

test('guided test 1: open and close before 30 s, no alarm, counter resets', () => {
  const r = rig(CLOSED);
  r.step(1000);
  r.level = OPEN_LEVEL;
  r.step(10000);
  assert.equal(r.a.state, 'DOOR_OPEN');
  assert.ok(Math.abs(r.a.elapsedMs(r.t) - 10000) <= S.debounce + 2);
  assert.ok(r.a.remainingMs(r.t) > 19000);
  r.level = CLOSED;
  r.step(200);
  assert.equal(r.a.state, 'DOOR_CLOSED');
  assert.equal(r.a.elapsedMs(r.t), 0);
  assert.ok(!states(r).includes('ALARM'));
  assert.ok(!r.beeps.some(Boolean));
});

test('guided test 2: held open, the alarm starts at 30 s with intermittent beeps (200 ms on, 300 ms off)', () => {
  const r = rig(CLOSED);
  r.step(100);
  r.level = OPEN_LEVEL;
  const t0 = r.t;
  r.step(29000);
  assert.equal(r.a.state, 'DOOR_OPEN');
  r.step(1200);
  assert.equal(r.a.state, 'ALARM');
  const alarmAt = r.events.find((e) => e.to === 'ALARM').now;
  const elapsed = alarmAt - t0;
  assert.ok(elapsed >= 30000 && elapsed <= 30000 + S.debounce + 3, `alarm after ${elapsed} ms`);
  r.beeps.length = 0;
  r.step(3000);
  const runs = [];
  let cur = r.beeps[0], n = 0;
  for (const b of r.beeps) {
    if (b === cur) n++;
    else {
      runs.push([cur, n]);
      cur = b;
      n = 1;
    }
  }
  const inner = runs.slice(1, -1); // ignore the partial first and last run
  assert.ok(inner.length >= 4);
  for (const [on, len] of inner) assert.ok(Math.abs(len - (on ? S.beepOn : S.beepOff)) <= 2, `${on ? 'on' : 'off'} run of ${len} ms`);
});

test('LED and buzzer follow the same beeps; both are off while only counting', () => {
  const r = rig(OPEN_LEVEL);
  for (let i = 0; i < 20000; i++) {
    r.step(1);
    assert.deepEqual(r.a.out, { led: false, buzzer: false });
  }
  r.step(11000);
  assert.equal(r.a.state, 'ALARM');
  for (let i = 0; i < 2000; i++) {
    r.step(1);
    assert.equal(r.a.out.led, r.a.out.buzzer);
  }
});

test('guided test 3: closing while it sounds stops everything at once, even during a beep', () => {
  const r = rig(OPEN_LEVEL);
  r.step(S.openLimit + 50);
  assert.equal(r.a.state, 'ALARM');
  while (!r.a.out.buzzer) r.step(1); // wait for a beep to be on
  r.level = CLOSED;
  r.step(S.debounce + 2);
  assert.equal(r.a.state, 'DOOR_CLOSED');
  assert.deepEqual(r.a.out, { led: false, buzzer: false });
  r.step(3000);
  assert.deepEqual(r.a.out, { led: false, buzzer: false });
});

test('guided test 4: reopening starts a new count from zero', () => {
  const r = rig(OPEN_LEVEL);
  r.step(S.openLimit + 2000);
  assert.equal(r.a.state, 'ALARM');
  r.level = CLOSED;
  r.step(500);
  r.level = OPEN_LEVEL;
  r.step(S.debounce + 1);
  assert.equal(r.a.state, 'DOOR_OPEN');
  assert.ok(r.a.elapsedMs(r.t) < 100);
  r.step(29000);
  assert.equal(r.a.state, 'DOOR_OPEN', 'the new count must not inherit the old one');
  r.step(1500);
  assert.equal(r.a.state, 'ALARM');
});

test('program started with the door open: counting starts at program start, no debounce wait', () => {
  const r = rig(OPEN_LEVEL, 123456);
  assert.equal(r.a.state, 'DOOR_OPEN');
  assert.equal(r.a.openedAtMs, 123456);
  r.step(S.openLimit - 5);
  assert.equal(r.a.state, 'DOOR_OPEN');
  r.step(10);
  assert.equal(r.a.state, 'ALARM');
});

test('debounce: a burst of contact bounce counts as one change and cannot start or reset anything by itself', () => {
  const r = rig(CLOSED);
  r.step(100);
  // opening: bounces for 12 ms, then settles open
  const burst = [OPEN_LEVEL, CLOSED, OPEN_LEVEL, CLOSED, OPEN_LEVEL, CLOSED, OPEN_LEVEL];
  for (const lv of burst) {
    r.level = lv;
    r.step(2);
  }
  assert.equal(r.a.state, 'DOOR_CLOSED', 'a short bounce must not be accepted yet');
  r.step(S.debounce + 2);
  assert.equal(r.a.state, 'DOOR_OPEN');
  assert.ok(r.a.stats.rawEdges >= 7);
  assert.equal(r.a.stats.accepted, 1);
  // the same pulses while closed again must not bring the count back to zero without 30 ms of stable closed
  r.step(5000);
  r.level = CLOSED;
  r.step(10);
  r.level = OPEN_LEVEL;
  r.step(10);
  assert.equal(r.a.state, 'DOOR_OPEN', 'a 10 ms closed glitch is ignored');
  assert.ok(r.a.elapsedMs(r.t) > 4900, 'the count was not reset by the glitch');
});

test('millis() wrap-around: the count and the beeps stay correct across 2^32', () => {
  const base = 0xffffffff - 5000; // wraps after 5 s
  const r = rig(OPEN_LEVEL, base);
  r.step(S.openLimit - 20);
  assert.equal(r.a.state, 'DOOR_OPEN', 'not before 30 s, even though millis() wrapped at 5 s');
  r.step(40);
  assert.equal(r.a.state, 'ALARM');
  assert.ok(r.t < base, 'the clock wrapped');
  r.beeps.length = 0;
  r.step(2000);
  assert.ok(r.beeps.some(Boolean) && r.beeps.some((b) => !b));
  // wrap in the middle of the debounce and of a beep
  const r2 = rig(CLOSED, 0xffffffff - 10);
  r2.step(3);
  r2.level = OPEN_LEVEL;
  r2.step(S.debounce + 2);
  assert.equal(r2.a.state, 'DOOR_OPEN');
});

test('stop: outputs off and the program does not run until setup() again', () => {
  const r = rig(OPEN_LEVEL);
  r.step(S.openLimit + 100);
  r.a.stop();
  assert.deepEqual(r.a.out, { led: false, buzzer: false });
  r.step(2000);
  assert.deepEqual(r.a.out, { led: false, buzzer: false });
  assert.equal(r.a.state, 'STOPPED');
  r.a.setup(r.t);
  assert.equal(r.a.state, 'DOOR_OPEN');
  assert.equal(r.a.elapsedMs(r.t), 0);
});
