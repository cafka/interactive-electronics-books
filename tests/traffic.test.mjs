// Run with: npm test   (Node's built-in test runner, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { TrafficMachine, parseSettings, DEFAULT_SETTINGS, PINS, BCM_TO_PIN } from '../src/traffic.js';

const PY = new URL('../python/traffic_light.py', import.meta.url);
const source = readFileSync(PY, 'utf8');
const { settings, missing } = parseSettings(source);

/** Drives the machine like the Python loop: one pass every POLL seconds; presses arrive between two passes. */
function simulate(presses, seconds, cfg = settings) {
  const m = new TrafficMachine(cfg);
  const log = [];
  m.start(0);
  log.push({ t: 0, state: m.state });
  const steps = Math.round(seconds / cfg.poll);
  const queue = [...presses].sort((a, b) => a - b);
  const results = [];
  for (let i = 0; i <= steps; i++) {
    const t = Math.round(i * cfg.poll * 1000) / 1000;
    const ev = m.tick(t);
    if (ev) log.push({ t, state: ev.to });
    while (queue.length && queue[0] <= t + cfg.poll + 1e-9) results.push(m.press(queue.shift()).result);
  }
  return { m, log, results };
}

test('timing constants are read from the Python file (single source)', () => {
  assert.deepEqual(missing, []);
  assert.deepEqual(settings, { minGreen: 4, yellow: 2, crossing: 5, poll: 0.05 });
  assert.deepEqual(DEFAULT_SETTINGS, settings, 'the fallback defaults match the Python file');
});

test('starts on green with nothing pending and stays there without a request', () => {
  const { m, log } = simulate([], 60);
  assert.equal(m.state, 'GREEN');
  assert.equal(log.length, 1);
  assert.deepEqual(m.lights, { red: false, yellow: false, green: true });
});

test('one request: green waits for the minimum, then yellow, red and back to green', () => {
  const { m, log, results } = simulate([1.0], 20);
  assert.deepEqual(results, ['registered']);
  const at = Object.fromEntries(log.map((e, i) => [`${i}:${e.state}`, e.t]));
  assert.deepEqual(log.map((e) => e.state), ['GREEN', 'YELLOW', 'RED', 'GREEN']);
  assert.ok(Math.abs(log[1].t - 4) <= 0.05, `yellow at ${log[1].t}`);
  assert.ok(Math.abs(log[2].t - 6) <= 0.05, `red at ${log[2].t}`);
  assert.ok(Math.abs(log[3].t - 11) <= 0.05, `green again at ${log[3].t}`);
  assert.equal(m.request, false, 'the request is cleared when the crossing is served');
  assert.equal(m.stats.served, 1);
  assert.ok(Math.abs(m.stats.lastCrossing - 5) <= 0.05);
  void at;
});

test('a request after the minimum green is served at once', () => {
  const { log } = simulate([9], 20);
  assert.deepEqual(log.map((e) => e.state), ['GREEN', 'YELLOW', 'RED', 'GREEN']);
  assert.ok(log[1].t >= 9 && log[1].t <= 9.15, `yellow at ${log[1].t}`);
});

test('extra presses never restart a timer or queue another crossing', () => {
  const single = simulate([1.0], 40);
  const mashed = simulate([1.0, 1.4, 1.8, 2.2, 3.9, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 10.9], 40); // all before green returns at 11.0
  assert.deepEqual(mashed.log.map((e) => e.state), single.log.map((e) => e.state));
  mashed.log.forEach((e, i) => assert.ok(Math.abs(e.t - single.log[i].t) <= 0.05, `phase ${i}`));
  assert.equal(mashed.m.stats.served, 1);
  assert.equal(mashed.m.state, 'GREEN');
  const r = mashed.results;
  assert.equal(r[0], 'registered');
  assert.ok(r.includes('already-pending') && r.includes('ignored-crossing'));
});

test('a press during yellow or red is ignored, not stored for later', () => {
  const m = new TrafficMachine(settings);
  m.start(0);
  assert.equal(m.press(0.5).result, 'registered');
  for (let t = 0; t < 7; t += 0.05) m.tick(t);
  assert.equal(m.state, 'RED');
  assert.equal(m.press(7).result, 'ignored-crossing');
  for (let t = 7; t < 12; t += 0.05) m.tick(t);
  assert.equal(m.state, 'GREEN');
  assert.equal(m.request, false);
  for (let t = 12; t < 30; t += 0.05) m.tick(t);
  assert.equal(m.state, 'GREEN', 'no second crossing from the ignored press');
});

test('stop turns everything off and forgets the request; restart begins on green again', () => {
  const m = new TrafficMachine(settings);
  m.start(0);
  m.press(1);
  for (let t = 0; t < 4.5; t += 0.05) m.tick(t);
  assert.equal(m.state, 'YELLOW');
  m.stop();
  assert.equal(m.state, 'STOPPED');
  assert.equal(m.request, false);
  assert.deepEqual(m.lights, { red: false, yellow: false, green: false });
  assert.equal(m.press(5).result, 'ignored-stopped');
  m.start(10);
  assert.equal(m.state, 'GREEN');
  assert.equal(m.request, false);
  assert.equal(m.timer(10).kind, 'min-green');
});

test('the time-left display follows each phase', () => {
  const m = new TrafficMachine(settings);
  m.start(0);
  assert.equal(m.timer(1).kind, 'min-green');
  assert.ok(Math.abs(m.timer(1).left - 3) < 1e-9);
  assert.equal(m.timer(5).kind, 'waiting');
  m.press(5);
  assert.equal(m.timer(5).kind, 'now');
  m.tick(5);
  assert.equal(m.timer(5.5).kind, 'yellow');
  m.tick(7.5);
  assert.equal(m.timer(8).kind, 'cross');
  assert.ok(Math.abs(m.timer(8).left - 4.5) < 1e-9);
});

test('wiring: BCM numbers and physical pins in the Python file match the chapter data', () => {
  for (const key of ['red', 'yellow', 'green', 'button']) {
    const { bcm, pin } = PINS[key];
    assert.equal(BCM_TO_PIN[bcm], pin, `${key}: BCM ${bcm} is physical pin ${BCM_TO_PIN[bcm]}`);
    assert.match(source, new RegExp(`BCM ${bcm} = physical pin ${pin}\\b`), `${key} comment in the .py`);
  }
  assert.match(source, /red = LED\(17\)/);
  assert.match(source, /yellow = LED\(27\)/);
  assert.match(source, /green = LED\(22\)/);
  assert.match(source, /Button\(23, pull_up=True/);
  assert.equal(new Set(Object.values(PINS).filter((p) => p.bcm).map((p) => p.bcm)).size, 4, 'four different GPIO');
});

test('the Python program behaves like the web demo (fake gpiozero + virtual clock)', (t) => {
  const probe = spawnSync('python', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return t.skip('python is not available');
  const scenarios = [
    { name: 'no presses', presses: [], seconds: 30 },
    { name: 'one press', presses: [1.0], seconds: 30 },
    { name: 'mashing during every state', presses: [1.0, 1.5, 2.0, 3.9, 4.5, 5.5, 6.5, 8.5, 10.5, 10.9], seconds: 30 },
    { name: 'press after the minimum green', presses: [9.0], seconds: 30 },
    { name: 'two separate crossings', presses: [1.0, 13.0], seconds: 40 },
  ];
  for (const s of scenarios) {
    const run = spawnSync('python', [new URL('./pycheck.py', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), PY.pathname.replace(/^\/(\w:)/, '$1'), JSON.stringify(s.presses), String(s.seconds)], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${s.name}: ${run.stderr}`);
    const py = JSON.parse(run.stdout);
    const js = simulate(s.presses, s.seconds).log;
    assert.deepEqual(py.map((e) => e.state), js.map((e) => e.state), `${s.name}: sequence of states`);
    py.forEach((e, i) => assert.ok(Math.abs(e.t - js[i].t) <= 0.11, `${s.name}: phase ${i} (${e.state}) python ${e.t} vs demo ${js[i].t}`));
    py.forEach((e) => assert.equal(e.lights.reduce((a, b) => a + b, 0), 1, `${s.name}: exactly one LED on at ${e.t}`));
  }
});
