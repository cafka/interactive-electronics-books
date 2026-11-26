// Coral chapter 2 in the browser: the cascade runs on the real page (person in, pose, person out, back to the M4).
// Usage: node cdp-cascade.mjs <outDir> <device: desktop | w390 | phone-land> <port>
// Needs `npm start` (http://127.0.0.1:5173, or BASE_URL) and Chrome (CHROME to override the path).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [OUT, DEV = 'desktop', PORTS = '9470'] = process.argv.slice(2);
const PORT = Number(PORTS);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
mkdirSync(OUT, { recursive: true });
const DEVS = { desktop: [1400, 900, false], w390: [390, 844, true], 'phone-land': [844, 390, true] };
const [W, H, MOBILE] = DEVS[DEV];
const chrome = spawn(process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile-cascade-' + DEV)}`, '--window-size=1400,1100', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const say = (s) => { report.push(s); console.log(s); writeFileSync(join(OUT, `cascade-${DEV}.txt`), report.join('\n')); };
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
  say(`=== coral ch2 on ${DEV} ${W}x${H}`);
  await send('Page.navigate', { url: `${BASE}/?book=coral&open=1&lesson=2` });
  if ((await waitUntil(`typeof book3d === 'object' && book3d.runtimes.length > 1 && book3d.current === 1 && book3d.layout().measured`, 240000)) < 0) throw new Error('chapter 2 did not build');
  await evalJs('book3d.snapRig(); 1');
  await frames(2);
  const title = await evalJs(`document.querySelector('#lessonTitle').textContent`);
  ok(title === 'Wake up the AI: Intelligent pose detection', `chapter title "${title}"`);
  const L = await J('book3d.layout()');
  ok(L.content.l >= L.area.l - 2 && L.content.r <= L.area.r + 2 && L.content.t >= L.area.t - 2 && L.content.b <= L.area.b + 2, 'entry: the whole open book inside the free area');
  await waitUntil(`${RT}.inspect().running === true`, 60000);
  let s = await st();
  ok(s.running && s.core === 'm4' && s.statusLed && !s.userLed && !s.tpuLed && s.camLed, `power on: M4 searching, Status LED on, User LED off, Edge TPU LED off (${s.core})`);
  ok(s.log.includes('Multicore Model Cascade!') && s.log.includes('M4 Started, detecting person...'), 'console: start messages of both cores');
  ok(s.client === 'black', `host client: black window before any frame (${s.client})`);
  await shot(`C2-${DEV}-1-start.png`);
  // faster simulated time: software WebGL draws about one frame a second
  await evalJs(`${RT}.debugSpeed(12); 1`);
  await evalJs(`${RT}.debugSetU(1); 1`);
  const hand = await waitUntil(`${RT}.inspect().core === 'm7'`, 120000);
  s = await st();
  ok(hand >= 0 && s.userLed && s.tpuLed && s.handoffs.toM7 >= 1, `person in the frame: the M4 hands over, the M7 runs, User LED and Edge TPU LED on (${s.core})`);
  ok(s.log.join('|').includes('Person detected, let M7 take over.|M4 stopped|M7 Main Task: started'), 'console: the hand-over messages in the order of the source');
  await waitUntil(`${RT}.inspect().clientPoints > 0`, 120000);
  s = await st();
  ok(s.poseReported && s.keypointsFound >= 13 && s.client === 'image' && s.clientPoints >= 13, `pose: ${s.keypointsFound} of 17 keypoints found, host client draws ${s.clientPoints} points on the frame`);
  await evalJs(`${RT}.debugSpeed(1); 1`);
  await frames(3);
  await shot(`C2-${DEV}-2-pose.png`);
  // change the pose: arms up, the keypoints follow
  await evalJs(`${RT}.debugPose('up'); 1`);
  const before = await J(`${RT}.debugMeasure()`);
  await evalJs(`${RT}.debugSpeed(12); 1`);
  await sleep(4000);
  s = await st();
  ok(s.pose === 'up' && s.core === 'm7' && s.poseReported, `pose "arms up": the M7 keeps reporting a pose (${s.keypointsFound} keypoints)`);
  ok(before.inFrame.filter(Boolean).length >= 13, `stand-in check with arms up: ${before.inFrame.filter(Boolean).length} keypoints inside the frame`);
  await evalJs(`${RT}.debugSpeed(1); 1`);
  await frames(3);
  await shot(`C2-${DEV}-3-arms-up.png`);
  await evalJs(`${RT}.debugPose('knee'); ${RT}.debugSpeed(12); 1`);
  await sleep(3000);
  await evalJs(`${RT}.debugSpeed(1); 1`);
  await frames(3);
  await shot(`C2-${DEV}-4-knee.png`);
  // out of the frame: back to the M4 after 5 s without a pose; the M4 turns the User LED off
  await evalJs(`${RT}.debugSpeed(12); ${RT}.debugSetU(0); 1`);
  const back = await waitUntil(`${RT}.inspect().core === 'm4'`, 180000);
  s = await st();
  ok(back >= 0 && s.handoffs.toM4 >= 1 && s.log.includes('No poses detected for 5 seconds'), `person out: "No poses detected for 5 seconds", back to the M4 (${s.core})`);
  await waitUntil(`${RT}.inspect().userLed === false`, 60000);
  await waitUntil(`${RT}.inspect().client === 'waiting'`, 60000);
  s = await st();
  ok(!s.userLed && !s.tpuLed && s.client === 'waiting', `then: User LED off (first "no person" of the M4), Edge TPU LED off, client shows "Waiting for Person Detection" (${s.client})`);
  await evalJs(`${RT}.debugSpeed(1); 1`);
  await frames(3);
  await shot(`C2-${DEV}-5-back-to-m4.png`);
  // the notebook: code tab and how tab mounted, no horizontal overflow on phones
  const nb = await J(`(() => { const p = document.querySelector('#panel'); return { code: !!document.querySelector('#codeM4 .ln') && !!document.querySelector('#codeM7 .ln'), cmds: document.querySelectorAll('#tabCode pre.cmd').length, how: document.querySelectorAll('#tabHow .steps li').length, kp: document.querySelectorAll('#tabHow .kp-names span').length }; })()`);
  ok(nb.code && nb.cmds >= 10 && nb.how === 6 && nb.kp === 17, `notebook: both code listings, ${nb.cmds} command blocks, ${nb.how} steps, ${nb.kp} keypoint names`);
  // the guide PDF builds for chapter 2
  const g = await J(`(() => { const g = book3d.guide(); const m = [...g.html.matchAll(/<h2><span class="n">\\d+<\\/span>([^<]+)<\\/h2>/g)].map((x) => x[1]); return { name: g.fileName, sections: m }; })()`);
  ok(/Chapter-2_Wake-up-the-AI-Intelligent-pose-detection$/.test(g.name) && g.sections.includes('Materials') && g.sections.includes('Step-by-step instructions') && g.sections.includes('Source code') && g.sections.includes('Troubleshooting') && g.sections.includes('References'), `guide "${g.name}": ${(g.sections || []).join(' · ')}`);
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
