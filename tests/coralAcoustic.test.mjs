// Coral chapter 3: acoustic events, after the official example examples/classify_audio, as the page simulates it.
// Facts come from classify_audio.cc, libs/tensorflow/audio_models.h/.cc, classification.cc and the YAMNet class map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACOUSTIC, YAMNET, CLASSES, ALERT_CLASSES, SOUNDS, BACKGROUNDS, BENCH_FACTS, DEFAULT_RULES, synth, logMel, classify, topResults,
  windowSamples, benchScenes, runBench, sweep, AlertRules, Monitor, formatResults, cloneRules,
} from '../src/books/coral/acoustic.js';

const scenes = benchScenes(); // shared, so each scene's scores are computed once

test('facts from the source: window, features, threshold, models, timing', () => {
  assert.equal(ACOUSTIC.example, 'examples/classify_audio');
  assert.equal(ACOUSTIC.sampleRate, 16000);
  assert.equal(ACOUSTIC.windowMs, 975);
  assert.equal(ACOUSTIC.windowSamples, (16000 * 975) / 1000);
  assert.deepEqual([ACOUSTIC.frames, ACOUSTIC.bands, ACOUSTIC.frameMs, ACOUSTIC.hopMs, ACOUSTIC.lowHz, ACOUSTIC.highHz], [96, 64, 25, 10, 125, 7500]);
  assert.equal(ACOUSTIC.threshold, 0.3);
  assert.equal(ACOUSTIC.topK, 5);
  assert.equal(ACOUSTIC.tpuModel, '/models/yamnet_spectra_in_edgetpu.tflite');
  assert.equal(ACOUSTIC.cpuModel, '/models/yamnet_spectra_in.tflite');
  assert.equal(ACOUSTIC.core, 'Cortex-M7');
  assert.equal(ACOUSTIC.cpuOps.length, 9);
  assert.deepEqual([ACOUSTIC.dmaBuffers, ACOUSTIC.dmaBufferMs, ACOUSTIC.dropFirstMs], [2, 50, 150]);
});

test('YAMNet class ids match the official class map', () => {
  const expect = { Speech: 0, Clapping: 58, Applause: 62, Music: 132, Knock: 353, 'Smoke detector, smoke alarm': 393, Alarm: 382, 'Fire alarm': 394, Glass: 435, Shatter: 437, Breaking: 464, Silence: 494 };
  for (const [name, id] of Object.entries(expect)) assert.equal(YAMNET[name], id, name);
  for (const c of CLASSES) for (const n of c.yamnet) assert.ok(n in YAMNET, `${c.id}: ${n}`);
  assert.deepEqual(ALERT_CLASSES, ['clap', 'knock', 'glass', 'alarm']);
});

test('features: 96 frames of 64 bands, finite, louder sounds give more energy', () => {
  const quiet = logMel(windowSamples(0, { bg: 'quiet', events: [] }));
  const loud = logMel(windowSamples(0, { bg: 'quiet', events: [{ kind: 'clap', at: 200, level: 1, distance: 1 }] }));
  assert.equal(quiet.length, 96);
  assert.ok(quiet.every((r) => r.length === 64 && r.every(Number.isFinite)));
  const sum = (f) => f.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
  assert.ok(sum(loud) > sum(quiet));
});

test('the synthesised sounds are deterministic and have the stated length', () => {
  for (const k of Object.keys(SOUNDS)) {
    const a = synth(k, { seed: 3 }), b = synth(k, { seed: 3 });
    assert.equal(a.length, Math.round((SOUNDS[k].ms / 1000) * 16000), k);
    assert.deepEqual(a, b, k);
  }
});

test('near and quiet, each target sound scores its own class best among the alert classes', () => {
  for (const k of Object.keys(SOUNDS).filter((s) => SOUNDS[s].target)) {
    const at = 100, events = [{ kind: k, at, level: 1, distance: 1, seed: 5 }];
    const { scores } = classify(logMel(windowSamples(0, { bg: 'quiet', events })));
    const best = ALERT_CLASSES.slice().sort((a, b) => scores[b] - scores[a])[0];
    assert.equal(best, SOUNDS[k].target, `${k}: ${JSON.stringify(scores)}`);
  }
  const { scores } = classify(logMel(windowSamples(0, { bg: 'quiet', events: [] })));
  assert.deepEqual(topResults(scores).map((r) => r.id), ['silence']);
});

test('topResults and the console format follow GetClassificationResults / FormatClassificationOutput', () => {
  const r = topResults({ a: 0.9, b: 0.31, c: 0.3, d: 0.29, e: 0.5, f: 0.6, g: 0.7 });
  assert.deepEqual(r.map((x) => x.id), ['a', 'g', 'f', 'e', 'b']);
  assert.deepEqual(formatResults([]), ['No results']);
  assert.deepEqual(formatResults([{ id: 'glass', score: 0.5 }]), ['Results:', `${YAMNET.Shatter}: 0.500000`]);
});

test('the bench numbers the chapter quotes are what the bench gives', () => {
  assert.equal(scenes.length, BENCH_FACTS.scenes);
  const b = runBench(DEFAULT_RULES, scenes);
  assert.equal(b.events, BENCH_FACTS.events);
  assert.deepEqual({ tp: b.tp, fp: b.fp, fn: b.fn }, BENCH_FACTS.defaults);
  const dishes = b.rows.filter((r) => r.kind === 'dishes');
  assert.equal(dishes.length, BENCH_FACTS.dishesCases);
  const glass = dishes.filter((r) => r.alerts.includes('glass'));
  assert.equal(glass.length, BENCH_FACTS.dishesGlass);
  assert.deepEqual(glass.map((r) => `${r.bg} ${r.distance}`).sort(), ['fan 1', 'tv 1']);
  const sw = Object.fromEntries(sweep([0.2, 0.7], DEFAULT_RULES, scenes).map((s) => [s.threshold, s]));
  assert.deepEqual({ fp: sw[0.2].fp, fn: sw[0.2].fn }, BENCH_FACTS.at02);
  assert.deepEqual({ fp: sw[0.7].fp, fn: sw[0.7].fn }, BENCH_FACTS.at07);
});

test('threshold trade-off: raising it never adds false alarms, and never finds more', () => {
  const sw = sweep([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], DEFAULT_RULES, scenes);
  for (let i = 1; i < sw.length; i++) {
    assert.ok(sw[i].fp <= sw[i - 1].fp, `fp at ${sw[i].threshold}`);
    assert.ok(sw[i].tp <= sw[i - 1].tp, `tp at ${sw[i].threshold}`);
  }
  assert.ok(sw.every((s) => s.fp > 0 || s.fn > 0), 'no threshold gives both zero');
});

test('alert rules: own threshold, k of n persistence, cooldown, switch off', () => {
  const r = cloneRules(DEFAULT_RULES);
  const z = { clap: 0, knock: 0, glass: 0, alarm: 0 };
  // persistence: the alarm needs 2 of the last 3 windows
  let ar = new AlertRules(r);
  assert.deepEqual(ar.step({ ...z, alarm: 0.9 }, 1000), []);
  assert.deepEqual(ar.step({ ...z, alarm: 0.9 }, 2000).map((a) => a.id), ['alarm']);
  // cooldown: a second knock within 2 s is held back, after it passes
  ar = new AlertRules(r);
  assert.equal(ar.step({ ...z, knock: 0.8 }, 1000).length, 1);
  assert.equal(ar.step({ ...z, knock: 0.8 }, 2500).length, 0);
  assert.equal(ar.step({ ...z, knock: 0.8 }, 3100).length, 1);
  // threshold per class
  ar = new AlertRules({ ...r, glass: { ...r.glass, threshold: 0.9 } });
  assert.equal(ar.step({ ...z, glass: 0.85 }, 1000).length, 0);
  // switched off
  ar = new AlertRules({ ...r, clap: { ...r.clap, enabled: false } });
  assert.equal(ar.step({ ...z, clap: 1 }, 1000).length, 0);
});

/** Plays one sound at a time and lets the monitor run until it has judged it. */
function monitorRun(opts, kind, playAt, { distance = 1, total = 9000 } = {}) {
  const m = new Monitor(opts);
  while (m.t < playAt) m.step(10);
  const ev = m.play(kind, { distance });
  while (m.t < playAt + total) m.step(16);
  return { m, ev };
}

test('the board loop: first window after 150 ms dropped + 975 ms; Edge TPU build waits 975 ms after computing', () => {
  const m = new Monitor({ procMs: 250 });
  while (m.t < 6000) m.step(5);
  assert.equal(m.reads[0].end, 150 + 975);
  assert.equal(m.reads[1].end - m.reads[0].end, 250 + 975);
  assert.equal(m.gapMs, 250);
  const c = new Monitor({ procMs: 250, build: 'cpu' });
  while (c.t < 3000) c.step(5);
  assert.equal(c.reads[1].end - c.reads[0].end, 250);
  assert.equal(c.gapMs, 0);
  assert.equal(new Monitor({ procMs: 250, noPause: true }).periodMs, 250);
  assert.equal(m.console[0], 'YamNet Example!');
  assert.ok(m.console.includes('Results:'));
});

test('a short sound heard while the Edge TPU build computes is in no window; without the wait it is found', () => {
  // procMs 600: the first window ends at 1125, the next starts at 1725; the claps play 1125..1645
  const a = monitorRun({ procMs: 600 }, 'clap', 1095);
  assert.equal(a.ev.state, 'missed');
  assert.equal(a.m.stats.fn, 1);
  assert.match(a.m.log.at(-1).reason, /no single window/);
  for (const opts of [{ procMs: 600, noPause: true }, { procMs: 600, build: 'cpu' }]) {
    const b = monitorRun(opts, 'clap', 1095);
    assert.equal(b.ev.state, 'found', JSON.stringify(opts));
    assert.equal(b.m.stats.tp, 1);
  }
});

test('the monitor: alerts light the User LED for 2 s and are logged; look-alikes in a quiet room stay quiet', () => {
  const m0 = new Monitor({ procMs: 250 });
  while (m0.t < 3000) m0.step(10);
  m0.play('knock');
  while (!m0.log.length) m0.step(10);
  assert.ok(m0.userLed, 'User LED on right after the alert');
  const at = m0.t;
  while (m0.t < at + 1990) m0.step(10);
  assert.ok(m0.userLed, 'still on just before 2 s');
  m0.step(20);
  assert.ok(!m0.userLed, 'off after 2 s');
  const { m, ev } = monitorRun({ procMs: 250 }, 'knock', 3000);
  assert.equal(ev.state, 'found');
  const alert = m.log.find((e) => e.type === 'alert');
  assert.equal(alert.verdict, 'correct');
  assert.ok(m.console.some((l) => l.startsWith('[extension] ALERT knock')));
  for (const k of ['slam', 'speech', 'music', 'beeps']) {
    const r = monitorRun({ procMs: 250 }, k, 3000);
    assert.deepEqual(r.m.stats, { tp: 0, fp: 0, fn: 0 }, k);
  }
  const far = monitorRun({ procMs: 250, bg: 'fan' }, 'clap', 3000, { distance: 4 });
  assert.equal(far.ev.state, 'missed', 'a clap at 4 m with the fan running is missed');
  assert.match(far.m.log.at(-1).reason, /below the threshold/);
});

test('the chapter shows the official commands and code lines, and labels the extension', () => {
  const src = readFileSync(new URL('../src/books/coral/chapter3.js', import.meta.url), 'utf8');
  for (const s of [
    'git clone --recurse-submodules -j8 https://github.com/google-coral/coralmicro',
    'cd coralmicro && bash setup.sh',
    "build: 'bash build.sh'",
    'python3 scripts/flashtool.py -e classify_audio',
    '# set(YAMNET_CPU true)',
    'constexpr float kThreshold = 0.3;',
    'constexpr int kTopK = 5;',
    'constexpr char kModelName[] = "/models/yamnet_spectra_in_edgetpu.tflite";',
    'tensorflow::GetClassificationResults(interpreter, kThreshold, kTopK);',
    '// Delay 975 ms to rate limit the TPU version.',
    'LedSet(Led::kStatus, true);',
    'NOT part of coralmicro',
    'not a security system',
  ]) assert.ok(src.includes(s), s);
  // the official code block never switches the User LED: only the extension does
  const main = src.slice(src.indexOf('const CODE_MAIN'), src.indexOf('const CODE_EXT'));
  assert.ok(!/Led::kUser/.test(main), 'no User LED in the official code');
  const ext = src.slice(src.indexOf('const CODE_EXT'), src.indexOf('const CMD'));
  assert.ok(/LedSet\(Led::kUser/.test(ext));
  // the page names the source's comment and the right project name
  assert.ok(src.includes('-e yamnet') && src.includes('<code>classify_audio</code>'));
});

test('backgrounds and sounds the page offers', () => {
  assert.deepEqual(Object.keys(BACKGROUNDS), ['quiet', 'fan', 'tv']);
  assert.equal(Object.values(SOUNDS).filter((s) => s.target).length, 4);
  assert.equal(Object.values(SOUNDS).filter((s) => !s.target).length, 5);
});
