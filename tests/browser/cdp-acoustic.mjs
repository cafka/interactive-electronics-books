// Coral chapter 3 in the browser: the acoustic monitor runs on the real page (sounds, alerts, builds, bench, guide).
// Usage: node cdp-acoustic.mjs <outDir> <device: desktop | w390 | phone-land> <port>
// Needs `npm start` (http://127.0.0.1:5173, or BASE_URL) and Chrome (CHROME to override the path).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH_FACTS } from '../../src/books/coral/acoustic.js';
const [OUT, DEV = 'desktop', PORTS = '9480'] = process.argv.slice(2);
const PORT = Number(PORTS);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
mkdirSync(OUT, { recursive: true });
const DEVS = { desktop: [1400, 900, false], w390: [390, 844, true], 'phone-land': [844, 390, true] };
const [W, H, MOBILE] = DEVS[DEV];
const chrome = spawn(process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile-acoustic-' + DEV)}`, '--window-size=1400,1100', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const say = (s) => { report.push(s); console.log(s); writeFileSync(join(OUT, `acoustic-${DEV}.txt`), report.join('\n')); };
let ws, id = 0;
const pending = new Map();
const errors = [];
for (let i = 0; i < 240 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); } } catch { ws = null; }
  if (!ws) await sleep(250);
}
if (!ws) { say('NO CHROME'); process.exit(1); }
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
};
const keepAlive = setInterval(() => {}, 1000);
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id;
  const t = setTimeout(() => { pending.delete(n); r({}); }, 180000);
  pending.set(n, (x) => { clearTimeout(t); r(x); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) : r.result?.result?.value; };
const J = async (e) => { const v = await evalJs(`JSON.stringify(${e})`); try { return JSON.parse(v); } catch { return { ERR: v }; } };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64')); };
const frames = (n) => evalJs(`new Promise((r) => { let k = 0; const f = () => (++k >= ${n} ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const waitUntil = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await evalJs(expr)) === true) return Date.now() - t0; await sleep(500); } return -1; };
let passes = 0, fails = 0;
const ok = (c, m) => { c ? passes++ : fails++; say(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const RT = 'book3d.runtimes[book3d.current]';
const st = () => J(`${RT}.inspect()`);
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE, screenOrientation: { type: W > H ? 'landscapePrimary' : 'portraitPrimary', angle: W > H ? 90 : 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE, maxTouchPoints: MOBILE ? 5 : 1 });
  say(`=== coral ch3 on ${DEV} ${W}x${H}`);
  await send('Page.navigate', { url: `${BASE}/?book=coral&open=1&lesson=3` });
  if ((await waitUntil(`typeof book3d === 'object' && book3d.runtimes.length > 2 && book3d.current === 2 && book3d.layout().measured`, 240000)) < 0) throw new Error('chapter 3 did not build');
  await evalJs('book3d.snapRig(); 1');
  await frames(2);
  const title = await evalJs(`document.querySelector('#lessonTitle').textContent`);
  ok(title === 'Listening for trouble: acoustic events with local AI', `chapter title "${title}"`);
  const L = await J('book3d.layout()');
  ok(L.content.l >= L.area.l - 2 && L.content.r <= L.area.r + 2 && L.content.t >= L.area.t - 2 && L.content.b <= L.area.b + 2, 'entry: the whole open book inside the free area');
  await waitUntil(`${RT}.inspect().running === true`, 60000);
  let s = await st();
  ok(s.running && s.settings.build === 'tpu' && s.periodMs === 250 + 975 && s.gapMs === 250, `power on: Edge TPU build, a window every ${s.periodMs} ms, ${s.gapMs} ms in no window (assumed 250 ms computing)`);
  ok(s.console[0] === 'YamNet Example!', 'console: "YamNet Example!" first');
  await shot(`C3-${DEV}-1-start.png`);
  // faster simulated time: software WebGL draws about one frame a second
  await evalJs(`${RT}.debugSpeed(6); 1`);
  await waitUntil(`${RT}.inspect().reads >= 2`, 120000);
  s = await st();
  ok(s.console.includes('Results:') && s.console.some((l) => /^494: /.test(l)), 'quiet room: the example prints "Results:" and 494 (Silence)');
  await evalJs(`${RT}.debugPlay('knock'); 1`);
  await waitUntil(`${RT}.inspect().stats.tp >= 1 || ${RT}.inspect().stats.fn >= 1`, 120000);
  s = await st();
  ok(s.stats.tp === 1 && s.log.some((e) => e.type === 'alert' && e.cls === 'knock' && e.verdict === 'correct'), `knock near the board: alert, logged as correct (${JSON.stringify(s.stats)})`);
  ok(s.console.some((l) => l.startsWith('[extension] ALERT knock')), 'console: the extension\'s alert line, marked [extension]');
  await evalJs(`${RT}.debugSpeed(1); 1`);
  await frames(3);
  await shot(`C3-${DEV}-2-knock.png`);
  const dom = await J(`(() => { const t = document.querySelector('#tabSim'); return { log: document.querySelectorAll('#eventLog li.ok').length, scores: document.querySelectorAll('#scores .score-row').length, marks: document.querySelectorAll('#scores .bar u').length, printed: document.querySelector('#printed').textContent, spec: document.querySelector('#capSpec').textContent, sounds: document.querySelectorAll('button[data-sound]').length, rules: document.querySelectorAll('#rules .rule-row').length, overflow: t ? t.scrollWidth - t.clientWidth : -1 }; })()`);
  ok(dom.log >= 1 && dom.scores === 7 && dom.marks === 4 && dom.sounds === 9 && dom.rules === 4, `notebook: ${dom.log} correct alert in the log, ${dom.scores} score bars (${dom.marks} with a threshold mark), ${dom.sounds} sounds, ${dom.rules} rule rows`);
  ok(/The example prints/.test(dom.printed) && /Window/.test(dom.spec), `last window shown: "${dom.printed.slice(0, 90)}…"`);
  ok(dom.overflow <= 1, `Simulate tab: no horizontal overflow (${dom.overflow} px)`);
  // a look-alike in a noisy room, then the alarm
  await evalJs(`${RT}.debugApply({ bg: 'tv' }); ${RT}.debugSpeed(6); ${RT}.debugPlay('alarm'); 1`);
  await waitUntil(`${RT}.inspect().stats.tp >= 2 || ${RT}.inspect().stats.fn >= 1`, 120000);
  s = await st();
  ok(s.stats.tp === 2 && s.log.some((e) => e.cls === 'alarm' && e.verdict === 'correct'), `smoke alarm with the TV on: alert after the persistence rule (${JSON.stringify(s.stats)})`);
  // builds: CPU (no wait, windows overlap), and the exercise without the wait
  await evalJs(`${RT}.debugApply({ build: 'cpu', procMs: 400 }); 1`);
  await frames(2);
  s = await st();
  let gapText = await evalJs(`document.querySelector('#gapInfo').textContent`);
  ok(s.periodMs === 400 && s.gapMs === 0 && /overlap/.test(gapText), `CPU build: a window every ${s.periodMs} ms, windows overlap ("${gapText.slice(0, 70)}…")`);
  const tpuOff = await evalJs(`document.querySelector('#coreTpu span').textContent`);
  ok(/not used/.test(tpuOff), `CPU build: Edge TPU "${tpuOff}"`);
  await evalJs(`${RT}.debugApply({ build: 'tpu', noPause: true, procMs: 250 }); 1`);
  await frames(2);
  s = await st();
  ok(s.periodMs === 250 && s.gapMs === 0, `exercise, no 975 ms wait: a window every ${s.periodMs} ms`);
  await evalJs(`${RT}.debugApply({ noPause: false, procMs: 900 }); 1`);
  await frames(2);
  gapText = await evalJs(`document.querySelector('#gapInfo').textContent`);
  ok(/900 ms of audio heard while the board computes is in no window/.test(gapText), `Edge TPU build, 900 ms per window: "${gapText.slice(0, 90)}"`);
  await evalJs(`${RT}.debugApply({ procMs: 250, bg: 'quiet' }); 1`);
  // the bench: one threshold for all, the numbers the chapter quotes
  const t0 = Date.now();
  await evalJs(`${RT}.debugBench('sweep')`);
  const bench = await J(`[...document.querySelectorAll('#benchOut tr')].slice(1).map((r) => [...r.children].map((c) => c.textContent))`);
  const row07 = bench.find((r) => r[0] === '0.7'), row02 = bench.find((r) => r[0] === '0.2');
  ok(bench.length === 7 && row07 && Number(row07[2]) === BENCH_FACTS.at07.fp && Number(row07[3]) === BENCH_FACTS.at07.fn && Number(row02[2]) === BENCH_FACTS.at02.fp, `threshold sweep in the page (${Date.now() - t0} ms): 0.2 → ${row02 && row02.slice(1).join(' / ')}; 0.7 → ${row07 && row07.slice(1).join(' / ')}`);
  await evalJs(`${RT}.debugBench('bench')`);
  const b = await J(`[...document.querySelectorAll('#benchOut td')].map((c) => c.textContent)`);
  ok(b[0] && b[0].startsWith(`${BENCH_FACTS.defaults.tp} of ${BENCH_FACTS.events}`) && Number(b[1]) === BENCH_FACTS.defaults.fp && Number(b[2]) === BENCH_FACTS.defaults.fn, `bench with the default rules: found ${b[0]}, false alarms ${b[1]}, missed ${b[2]}`);
  await evalJs(`document.querySelector('#benchOut').scrollIntoView({ block: 'center' }); 1`);
  await frames(3);
  await shot(`C3-${DEV}-3-bench.png`);
  // part selection and the code highlighting
  await evalJs(`${RT}.debugSelect('mic'); 1`);
  await frames(2);
  const part = await evalJs(`document.querySelector('#partInfo').textContent`);
  ok(/PDM/.test(part), `tap the microphone: "${part.slice(0, 60)}…"`);
  const nb = await J(`(() => ({ main: document.querySelectorAll('#codeMain .ln').length, ext: document.querySelectorAll('#codeExt .ln').length, cmds: document.querySelectorAll('#tabCode pre.cmd').length, how: document.querySelectorAll('#tabHow .steps li').length, flash: [...document.querySelectorAll('#tabCode pre.cmd')].some((p) => p.textContent === 'python3 scripts/flashtool.py -e classify_audio') }))()`);
  ok(nb.main > 60 && nb.ext > 30 && nb.cmds >= 9 && nb.how === 6 && nb.flash, `notebook: official listing ${nb.main} lines, extension ${nb.ext} lines, ${nb.cmds} command blocks (flash with -e classify_audio), ${nb.how} steps`);
  // the guide PDF builds for chapter 3
  const g = await J(`(() => { const g = book3d.guide(); const m = [...g.html.matchAll(/<h2><span class="n">\\d+<\\/span>([^<]+)<\\/h2>/g)].map((x) => x[1]); return { name: g.fileName, sections: m }; })()`);
  const need = ['Materials', 'Wiring diagram', 'Step-by-step instructions', 'Source code', 'Exercises', 'Troubleshooting', 'Warnings and precautions', 'References'];
  ok(/Chapter-3_Listening-for-trouble-acoustic-events-with-local-AI$/.test(g.name) && need.every((n) => (g.sections || []).includes(n)), `guide "${g.name}": ${(g.sections || []).join(' · ')}`);
  await evalJs(`${RT}.debugSpeed(1); 1`);
  await frames(3);
  await shot(`C3-${DEV}-4-end.png`);
  say(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  ok(errors.length === 0, 'no page errors');
} catch (e) {
  say('SCRIPT ERROR ' + (e.stack || e));
  fails++;
} finally {
  say(`DONE pass ${passes} fail ${fails}`);
  clearInterval(keepAlive);
  try { ws.close(); } catch {}
  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}
