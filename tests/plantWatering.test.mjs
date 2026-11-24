import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlantWatering, parseSettings, PINS, LOCK, moisturePercent, rawFromPercent } from '../src/books/esp32/plantWatering.js';
import { PlantWorld } from '../src/books/esp32/plantWorld.js';
import { electricalCheck, PARTS, CONNECTIONS, FAULTS, NETS, PIN_TABLE } from '../src/books/esp32/plantParts.js';

const source = readFileSync(new URL('../arduino/plant_watering/plant_watering.ino', import.meta.url), 'utf8');
const { settings: S, missing } = parseSettings(source);

/**
 * Runs the sketch against the physical model. One loop() pass per millisecond; the world advances every 10 ms.
 * `storage` is the flash memory that survives a "reboot" (a new PlantWatering with the same storage).
 */
function rig({ soil = 30, seed = 7, base = 0, storage = { lock: 0 }, world = {}, evap = 0, tank = 400 } = {}) {
  const w = new PlantWorld({ evapPerS: evap, ...world }, seed);
  w.bulk = soil;
  w.tankMl = tank;
  const r = { t: base, w, storage, button: 1, events: [], pumpMs: 0, violations: 0, longestRunMs: 0, run: 0, tick: 0 };
  const make = () => new PlantWatering(S, {
    readAdc: () => w.readAdc(S),
    readButton: () => r.button,
    loadLock: () => storage.lock,
    saveLock: (n) => (storage.lock = n),
    onEvent: (e) => r.events.push(e),
  });
  r.make = make;
  r.a = make();
  r.a.setup(r.t);
  r.step = (ms) => {
    for (let i = 0; i < ms; i++) {
      r.t = (r.t + 1) >>> 0;
      r.a.loop(r.t);
      if (r.a.out.pump) {
        r.pumpMs++;
        r.run++;
        r.longestRunMs = Math.max(r.longestRunMs, r.run);
        if (r.a.state !== 'WATERING') r.violations++; // the pump may be on only while WATERING
      } else r.run = 0;
      if (++r.tick % 10 === 0) w.step(0.01, r.a.out.pump);
    }
  };
  r.until = (fn, maxMs) => {
    for (let i = 0; i < maxMs; i++) {
      if (fn()) return true;
      r.step(1);
    }
    return fn();
  };
  r.reboot = () => {
    r.a = make();
    r.a.setup(r.t);
  };
  r.press = (ms) => {
    r.button = 0;
    r.step(ms);
    r.button = 1;
    r.step(100);
  };
  return r;
}
const states = (r) => r.events.filter((e) => e.type === 'state').map((e) => e.to);

test('the constants and pins are read from the .ino', () => {
  assert.deepEqual(missing, []);
  assert.equal(S.sensorPin, PINS.sensor.gpio);
  assert.equal(S.pumpPin, PINS.pump.gpio);
  assert.equal(S.ledPin, PINS.led.gpio);
  assert.equal(S.buttonPin, PINS.button.gpio);
  assert.equal(S.pulseMs, 3000);
  assert.equal(S.soakMs, 60000);
  assert.equal(S.maxWaterTotalMs, 24000);
  assert.equal(S.filterN, 16);
  assert.ok(S.rawDry > S.rawWet, 'a drier sensor reads higher');
  assert.ok(S.rawValidMin < S.rawWet && S.rawValidMax > S.rawDry, 'the valid window must contain the whole calibrated range');
  assert.ok(S.dryOn < S.wetOff, 'hysteresis needs two different thresholds');
});

test('the sketch is non-blocking and the pump pin is written in one place only', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bdelay(Microseconds)?\s*\(/, 'the sketch must not block');
  assert.equal((code.match(/digitalWrite\(PUMP_PIN/g) || []).length, 2, 'setup() (off) and enterState() only');
  assert.match(code, /digitalWrite\(PUMP_PIN, next == WATERING \? HIGH : LOW\)/);
  assert.match(code, /pinMode\(BUTTON_PIN, INPUT_PULLUP\)/);
  assert.match(code, /analogSetPinAttenuation\(SENSOR_PIN, ADC_11db\)/);
  assert.match(code, /prefs\.putUChar\("lock"/);
  assert.match(code, /#include <Preferences\.h>/);
});

test('chosen pins are valid for this use on an ESP32-WROOM-32E', () => {
  const flash = [6, 7, 8, 9, 10, 11], inputOnly = [34, 35, 36, 39], strapping = [0, 2, 5, 12, 15];
  const adc1 = [32, 33, 34, 35, 36, 39];
  for (const g of [S.sensorPin, S.pumpPin, S.ledPin, S.buttonPin]) assert.ok(!flash.includes(g) && !strapping.includes(g), `GPIO${g} must not be a flash or strapping pin`);
  assert.ok(adc1.includes(S.sensorPin), 'the sensor needs an ADC1 pin: ADC2 cannot be used while Wi-Fi is on');
  for (const g of [S.pumpPin, S.ledPin]) assert.ok(!inputOnly.includes(g), `GPIO${g} is used as an output`);
  assert.equal(new Set([S.sensorPin, S.pumpPin, S.ledPin, S.buttonPin]).size, 4);
  for (const p of PIN_TABLE.filter((x) => x.gpio)) assert.ok([S.sensorPin, S.pumpPin, S.ledPin, S.buttonPin].includes(p.gpio));
});

test('percent conversion: calibration points, clamping, and the inverse', () => {
  assert.equal(moisturePercent(S.rawDry, S), 0);
  assert.equal(moisturePercent(S.rawWet, S), 100);
  assert.equal(moisturePercent(S.rawDry + 400, S), 0);
  assert.equal(moisturePercent(S.rawWet - 400, S), 100);
  assert.equal(moisturePercent((S.rawDry + S.rawWet) / 2, S), 50);
  for (const p of [0, 10, 33, 60, 100]) assert.ok(Math.abs(moisturePercent(rawFromPercent(p, S), S) - p) <= 1);
});

test('start: the pump is off, the filter must fill before any decision', () => {
  const r = rig({ soil: 10 });
  assert.equal(r.a.state, 'IDLE');
  assert.equal(r.a.out.pump, false);
  r.step(S.filterN * S.sampleMs - 200);
  assert.equal(r.a.state, 'IDLE', 'no decision with a half-empty filter');
  r.step(600);
  assert.equal(r.a.state, 'WATERING');
});

test('normal episode: pulses, soaks, measures, stops at the wet threshold with no spill', () => {
  const r = rig({ soil: 30 });
  r.step(300000);
  assert.equal(r.a.state, 'IDLE');
  assert.equal(r.a.lockReason, LOCK.NONE);
  assert.ok(r.w.bulk >= S.wetOff && r.w.bulk < 80, `final moisture ${r.w.bulk.toFixed(1)}`);
  assert.equal(r.pumpMs, 3 * S.pulseMs, 'three pulses of 3 s');
  assert.equal(r.w.spillMl, 0);
  assert.equal(r.violations, 0);
  assert.equal(r.longestRunMs, S.pulseMs, 'the pump never runs longer than one pulse');
  const seq = states(r);
  assert.deepEqual(seq.slice(0, 7), ['IDLE', 'WATERING', 'SOAKING', 'WATERING', 'SOAKING', 'WATERING', 'SOAKING']);
  assert.equal(seq.at(-1), 'IDLE');
});

test('soak time: the program does not decide before the water has had time to reach the sensor', () => {
  const r = rig({ soil: 30 });
  r.until(() => r.a.state === 'SOAKING', 10000);
  const t0 = r.t;
  r.until(() => r.a.state !== 'SOAKING', S.soakMs + 1000);
  assert.ok(r.t - t0 >= S.soakMs && r.t - t0 <= S.soakMs + 2);
});

test('hysteresis: between the thresholds nothing starts; below the dry threshold watering starts', () => {
  for (const soil of [60, 50, 45, S.dryOn + 2]) {
    const r = rig({ soil });
    r.step(120000);
    assert.equal(r.a.state, 'IDLE', `${soil}% must not start`);
    assert.equal(r.pumpMs, 0);
  }
  const r = rig({ soil: S.dryOn - 4 });
  assert.ok(r.until(() => r.a.state === 'WATERING', 5000), 'watering starts as soon as the filter is full');
});

test('thresholds can be changed (page sliders) and the program follows them', () => {
  const r = rig({ soil: 50 });
  r.a.setThresholds(55, 80);
  assert.ok(r.until(() => r.a.state === 'WATERING', 5000), '50% is dry for a 55% threshold');
  const r2 = rig({ soil: 40 });
  r2.a.setThresholds(10, 20);
  r2.step(5000);
  assert.equal(r2.a.state, 'IDLE');
  r2.a.setThresholds(90, 20);
  assert.ok(r2.a.s.wetOff > r2.a.s.dryOn, 'the thresholds are kept apart');
});

test('filter: noise and spikes do not start the pump, a real dry soil still does', () => {
  const r = rig({ soil: 45, world: {}, seed: 3 });
  r.w.noisy = true;
  r.step(600000); // ten minutes of loud noise and spikes around 45%
  assert.equal(r.pumpMs, 0, 'the average stays near 45% and above the dry threshold');
  const q = rig({ soil: 20, seed: 3 });
  q.w.noisy = true;
  assert.ok(q.until(() => q.a.state === 'WATERING', 5000));
});

test('invalid readings never enter the average', () => {
  const r = rig({ soil: 50 });
  r.step(3000);
  const before = r.a.filteredRaw();
  r.w.sensor = 'short';
  r.step(1000); // 10 invalid readings: below the 2 s limit
  assert.equal(r.a.filteredRaw(), before, 'the average is untouched');
  assert.equal(r.a.state, 'IDLE');
  r.w.sensor = 'ok';
  r.step(300);
  assert.equal(r.a.badSamples, 0, 'a valid reading resets the fault counter');
});

test('fault: sensor disconnected (with the pull-down) is locked within 2 s, code 1, and saved', () => {
  const r = rig({ soil: 50 });
  r.step(5000);
  r.w.sensor = 'disconnected';
  const t0 = r.t;
  assert.ok(r.until(() => r.a.state === 'LOCKED', 4000));
  assert.ok(r.t - t0 >= S.sensorFaultMs - S.sampleMs && r.t - t0 <= S.sensorFaultMs + 2 * S.sampleMs, `locked after ${r.t - t0} ms`);
  assert.equal(r.a.lockReason, LOCK.SENSOR);
  assert.equal(r.storage.lock, LOCK.SENSOR);
  assert.equal(r.pumpMs, 0);
});

test('fault: sensor short to 3.3 V is locked as a sensor fault', () => {
  const r = rig({ soil: 50 });
  r.step(5000);
  r.w.sensor = 'short';
  assert.ok(r.until(() => r.a.state === 'LOCKED', 4000));
  assert.equal(r.a.lockReason, LOCK.SENSOR);
});

test('fault: sensor lost in the middle of a pulse switches the pump off at once', () => {
  const r = rig({ soil: 20 });
  assert.ok(r.until(() => r.a.state === 'WATERING', 5000));
  r.step(500);
  r.w.sensor = 'disconnected';
  r.until(() => r.a.state === 'LOCKED', 5000);
  assert.equal(r.a.out.pump, false);
  assert.ok(r.pumpMs < S.pulseMs, 'the pulse was cut short by the lock');
  r.step(10000);
  assert.equal(r.violations, 0);
});

test('limit of the hardware: a floating AOUT without the pull-down can look like a valid reading', () => {
  const r = rig({ soil: 50 });
  r.w.pulldown = false;
  r.step(5000);
  r.w.sensor = 'disconnected';
  r.step(30000);
  assert.notEqual(r.a.lockReason, LOCK.SENSOR, 'a floating pin is not detected as a sensor fault');
  assert.equal(r.a.badSamples, 0, 'every floating reading looked valid');
  assert.equal(r.a.state, 'IDLE', 'it just believes the drifting value');
});

test('the second line of defence: a floating "dry" reading is stopped by the no-response check', () => {
  const r = rig({ soil: 50 });
  r.w.pulldown = false;
  r.w.floatLevel = 3350; // reads as 0 % moisture
  r.step(5000);
  r.w.sensor = 'disconnected';
  assert.ok(r.until(() => r.a.state === 'LOCKED', 90000));
  assert.equal(r.a.lockReason, LOCK.NO_RESPONSE);
  assert.equal(r.pumpMs, S.pulseMs, 'only one pulse was spent');
});

test('fault: empty tank is only noticed through the soil: one dry pulse, then locked, code 2', () => {
  const r = rig({ soil: 20, tank: 0 });
  assert.ok(r.until(() => r.a.state === 'LOCKED', 90000));
  assert.equal(r.a.lockReason, LOCK.NO_RESPONSE);
  assert.equal(r.storage.lock, LOCK.NO_RESPONSE);
  assert.equal(r.pumpMs, S.pulseMs, 'the pump ran one pulse with no water');
  assert.ok(r.w.dryRunS >= 2.9 && r.w.dryRunS <= 3.1);
  assert.ok(r.t < S.pulseMs + S.soakMs + 4000);
  assert.equal(r.violations, 0);
});

test('fault: blocked hose locks the same way, with water left in the tank', () => {
  const r = rig({ soil: 20 });
  r.w.hoseBlocked = true;
  assert.ok(r.until(() => r.a.state === 'LOCKED', 90000));
  assert.equal(r.a.lockReason, LOCK.NO_RESPONSE);
  assert.equal(r.w.tankMl, 400);
  assert.ok(r.w.stallS > 2.9);
});

test('fault: maximum pump time exceeded (weak pump), code 3, at exactly the limit', () => {
  const r = rig({ soil: 30, world: {} });
  r.w.pumpStrength = 0.3;
  assert.ok(r.until(() => r.a.state === 'LOCKED', 900000));
  assert.equal(r.a.lockReason, LOCK.TIMEOUT);
  assert.equal(r.pumpMs, S.maxWaterTotalMs, 'never above the limit');
  assert.ok(r.w.bulk < S.wetOff);
  assert.equal(r.longestRunMs, S.pulseMs);
  assert.equal(r.storage.lock, LOCK.TIMEOUT);
});

test('a lock survives a reset or a power cut: the pump stays off after reboot', () => {
  const r = rig({ soil: 20, tank: 0 });
  r.until(() => r.a.state === 'LOCKED', 90000);
  const used = r.pumpMs;
  r.reboot();
  assert.equal(r.a.state, 'LOCKED');
  assert.equal(r.a.lockReason, LOCK.NO_RESPONSE);
  r.step(120000);
  assert.equal(r.pumpMs, used, 'no new pump time after the reboot');
  assert.equal(r.violations, 0);
});

test('clearing the lock: only the button, only with a valid sensor, and the bounce does not count', () => {
  const r = rig({ soil: 20, tank: 0 });
  r.until(() => r.a.state === 'LOCKED', 90000);
  r.w.tankMl = 400; // the person fills the tank
  r.press(S.debounceMs - 15); // a glitch shorter than the debounce time
  assert.equal(r.a.state, 'LOCKED', 'a short glitch is ignored');
  r.w.sensor = 'disconnected';
  r.step(3000);
  r.press(120);
  assert.equal(r.a.state, 'LOCKED', 'refused while the sensor is not valid');
  assert.ok(r.events.some((e) => e.type === 'clear-refused'));
  r.w.sensor = 'ok';
  r.step(200);
  r.press(120);
  assert.equal(r.a.state, 'WATERING', 'cleared: the soil is still dry, so a new episode starts');
  assert.equal(r.storage.lock, LOCK.NONE);
  assert.equal(r.a.lockReason, LOCK.NONE);
});

test('a button press outside LOCKED does nothing', () => {
  const r = rig({ soil: 60 });
  r.step(3000);
  r.press(150);
  assert.equal(r.a.state, 'IDLE');
  assert.equal(r.a.clearRequested, false);
});

test('boot with a saved lock and a valid sensor waits for the button, not for time', () => {
  const r = rig({ soil: 20, storage: { lock: LOCK.TIMEOUT } });
  assert.equal(r.a.state, 'LOCKED');
  r.step(600000);
  assert.equal(r.a.state, 'LOCKED');
  assert.equal(r.pumpMs, 0);
});

test('the pump is never on outside WATERING, whatever happens', () => {
  const r = rig({ soil: 25, seed: 11, world: {} });
  r.w.noisy = true;
  for (let k = 0; k < 40; k++) {
    r.step(7000 + ((k * 3113) % 20000));
    if (k % 5 === 1) r.w.sensor = r.w.sensor === 'ok' ? 'disconnected' : 'ok';
    if (k % 7 === 3) r.button = r.button ? 0 : 1;
    if (k % 9 === 4) r.w.tankMl = r.w.tankMl ? 0 : 300;
    if (k % 11 === 6) r.reboot();
  }
  assert.equal(r.violations, 0);
  assert.ok(r.longestRunMs <= S.pulseMs);
});

test('millis() wrap-around: an episode and a lock behave the same across 2^32', () => {
  const a = rig({ soil: 30, base: 0 });
  a.step(300000);
  const b = rig({ soil: 30, base: 0xffffffff - 20000 });
  b.step(300000);
  assert.ok(b.t < 0xffffffff - 20000, 'the clock wrapped');
  assert.equal(b.a.state, a.a.state);
  assert.equal(b.pumpMs, a.pumpMs);
  assert.deepEqual(states(b), states(a));
  const c = rig({ soil: 20, tank: 0, base: 0xffffffff - 30000 });
  assert.ok(c.until(() => c.a.state === 'LOCKED', 90000));
  assert.equal(c.a.lockReason, LOCK.NO_RESPONSE);
});

test('LED patterns: idle flash, solid while watering, slow blink while soaking, N blinks when locked', () => {
  const r = rig({ soil: 60 });
  const level = [];
  for (let i = 0; i < 2000; i++) {
    r.step(1);
    level.push(r.a.out.led);
  }
  const idleOn = level.filter(Boolean).length;
  assert.ok(Math.abs(idleOn - S.ledIdleOn) <= 2, `idle: ${idleOn} ms on per ${S.ledIdlePeriod} ms`);
  const w = rig({ soil: 20 });
  w.until(() => w.a.state === 'WATERING', 5000);
  for (let i = 0; i < S.pulseMs - 5; i++) {
    w.step(1);
    assert.equal(w.a.out.led, true);
  }
  for (const [reason, n] of [[LOCK.SENSOR, 1], [LOCK.NO_RESPONSE, 2], [LOCK.TIMEOUT, 3]]) {
    const q = rig({ soil: 60, storage: { lock: reason } });
    const cycle = n * S.ledCodeSlot + S.ledCodePause;
    let edges = 0, prev = false, on = 0;
    for (let i = 0; i < cycle; i++) {
      q.step(1);
      if (q.a.out.led && !prev) edges++;
      if (q.a.out.led) on++;
      prev = q.a.out.led;
    }
    assert.ok(edges === n || edges === n - 1 || edges === n + 1, `code ${n}: ${edges} blinks`);
    assert.ok(Math.abs(on - n * S.ledCodeOn) <= S.ledCodeOn, `code ${n}: ${on} ms on`);
  }
});

test('stop: pump and LED off and the program does not run until setup() again', () => {
  const r = rig({ soil: 20 });
  r.until(() => r.a.state === 'WATERING', 5000);
  r.a.stop();
  assert.deepEqual(r.a.out, { pump: false, led: false });
  r.step(5000);
  assert.deepEqual(r.a.out, { pump: false, led: false });
  assert.equal(r.a.state, 'STOPPED');
});

test('electrical check of the parts (paper check, not a bench measurement)', () => {
  const e = electricalCheck();
  assert.ok(e.gateV > 3.2 && e.gateV < 3.3, `gate voltage ${e.gateV}`);
  assert.ok(e.gateMargin > 1, 'the gate is well above the worst-case threshold of the MOSFET');
  assert.ok(e.ledA > 0.003 && e.ledA < 0.012, `LED current ${e.ledA}`);
  assert.ok(e.pumpDrop < 0.05 && e.pumpHeat < 0.05, 'a logic-level MOSFET barely warms up at the stall current');
  assert.equal(e.usbEnough, true, 'normal running fits a USB port');
  assert.equal(e.usbEnoughStall, false, 'a stalled pump does not fit a 500 mA port: the book asks for a 2 A charger');
  assert.equal(e.chargerEnough, true);
  assert.equal(e.diodeOk, true);
  assert.ok(e.gateAvgA < 0.001);
});

test('parts, connections and faults tables are complete and consistent', () => {
  assert.ok(PARTS.length >= 15);
  for (const p of PARTS) assert.ok(p.name && p.qty && p.spec && p.alt, `part ${p.name} is incomplete`);
  const text = PARTS.map((p) => p.name + p.spec).join(' ');
  for (const w of ['IRLZ44N', '1N5819', '470', 'ESP32', 'capacitive', 'pump']) assert.match(text, new RegExp(w, 'i'));
  assert.match(PARTS.find((p) => /MOSFET/.test(p.name)).alt, /IRF520/, 'the common IRF520 trap is explained');
  assert.ok(CONNECTIONS.length >= 15);
  const nets = new Set(CONNECTIONS.map((c) => c.net));
  assert.equal(nets.size, CONNECTIONS.length, 'every connection row has its own id');
  for (const k of ['GND', 'V5', 'V3', 'AOUT', 'GATE', 'DRAIN']) assert.ok(NETS[k].length >= 2, `${k} joins at least two things`);
  assert.ok(!NETS.V5.some((x) => NETS.GND.includes(x)) && !NETS.V3.some((x) => NETS.V5.includes(x)), 'no part is on two supply nets');
  assert.ok(FAULTS.some((f) => f.seen === true) && FAULTS.some((f) => f.seen === false) && FAULTS.some((f) => f.seen === 'indirectly'));
});
