// Smoke test of the whole library: the catalogue, then every chapter of every book opened by its direct link.
// Per chapter: the title, the 3D scene built, the three notebook tabs filled, the guide, no page errors, no failed
// requests (HTTP >= 400 or network failure), and the chapter links (?book=...&lesson=...) point to real chapters.
// External links found in the notebooks are collected and requested from Node at the end.
// Usage: node cdp-smoke.mjs <outDir> <device: desktop | w390> <port>     (BASE_URL to test a deployed copy)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [OUT, DEV = 'desktop', PORTS = '9530'] = process.argv.slice(2);
const PORT = Number(PORTS);
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
mkdirSync(OUT, { recursive: true });
const DEVS = { desktop: [1400, 900, false], w390: [390, 844, true] };
const [W, H, MOBILE] = DEVS[DEV];
const chrome = spawn(process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile-smoke-' + DEV)}`, '--window-size=1400,1100', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const say = (s) => { report.push(s); console.log(s); writeFileSync(join(OUT, `smoke-${DEV}.txt`), report.join('\n')); };
let ws, id = 0;
const pending = new Map();
let errors = [], failed = [];
const requests = new Map();
for (let i = 0; i < 240 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); } } catch { ws = null; }
  if (!ws) await sleep(250);
}
if (!ws) { say('NO CHROME'); process.exit(1); }
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  const p = msg.params || {};
  if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 300));
  if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error ' + p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (msg.method === 'Network.requestWillBeSent') requests.set(p.requestId, p.request.url);
  if (msg.method === 'Network.responseReceived' && p.response.status >= 400) failed.push(`${p.response.status} ${p.response.url}`);
  if (msg.method === 'Network.loadingFailed' && !p.canceled) failed.push(`${p.errorText} ${requests.get(p.requestId) || p.requestId}`);
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
const waitUntil = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await evalJs(expr)) === true) return Date.now() - t0; await sleep(500); } return -1; };
let passes = 0, fails = 0;
const ok = (c, m) => { c ? passes++ : fails++; say(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const external = new Map(); // url -> first chapter that links it
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE, screenOrientation: { type: W > H ? 'landscapePrimary' : 'portraitPrimary', angle: W > H ? 90 : 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE, maxTouchPoints: MOBILE ? 5 : 1 });
  say(`=== smoke on ${DEV} ${W}x${H}, ${BASE}/`);
  // the catalogue
  await send('Page.navigate', { url: `${BASE}/` });
  const libMs = await waitUntil(`typeof book3d === 'object' && document.querySelectorAll('#libCards .lib-card').length > 0`, 180000);
  const cat = await J(`({ books: book3d.books.map((b) => ({ id: b.id, name: b.name, lessons: b.lessons.map((l) => l.title) })), cards: [...document.querySelectorAll('#libCards .lib-card')].map((c) => ({ book: c.dataset.book, text: c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 140) })), libraryOpen: book3d.libraryOpen })`);
  const BOOKS = cat.books || [];
  ok(libMs >= 0 && cat.libraryOpen && BOOKS.length === cat.cards.length && BOOKS.every((b) => cat.cards.some((c) => c.book === b.id)), `catalogue: ${cat.cards.length} book cards (${(cat.cards || []).map((c) => c.book).join(', ')}) for ${BOOKS.length} registered books`);
  for (const b of BOOKS) say(`   ${b.id} "${b.name}": ${b.lessons.length} chapters`);
  ok(errors.length === 0 && failed.length === 0, `catalogue page: errors ${errors.length ? errors.join(' | ') : 'none'}, failed requests ${failed.length ? failed.join(' | ') : 'none'}`);
  await shot(`S-${DEV}-library.png`);
  for (const b of BOOKS) {
    for (let n = 1; n <= b.lessons.length; n++) {
      errors = [];
      failed = [];
      const url = `${BASE}/?book=${b.id}&open=1&lesson=${n}`;
      const t0 = Date.now();
      await send('Page.navigate', { url });
      const built = await waitUntil(`typeof book3d === 'object' && book3d.bookId === '${b.id}' && book3d.current === ${n - 1} && book3d.runtimes.length === ${b.lessons.length} && book3d.layout().measured`, 300000);
      await evalJs('book3d.snapRig && book3d.snapRig(); 1');
      await sleep(1500);
      const s = await J(`(() => {
        const rt = book3d.runtimes[book3d.current];
        const g = book3d.guide();
        const links = [...document.querySelectorAll('#panel a[href]')].map((a) => a.getAttribute('href'));
        return {
          title: document.querySelector('#lessonTitle').textContent.trim(),
          webgl: !!document.querySelector('#scene').getContext && document.querySelector('#loadError').hidden,
          root: !!rt.root && rt.root.visible,
          tabs: ['#tabSim', '#tabCode', '#tabHow'].map((q) => document.querySelector(q).textContent.trim().length),
          guide: g && g.fileName && g.html.length,
          links,
        };
      })()`);
      const title = b.lessons[n - 1];
      const inner = (s.links || []).filter((h) => h.startsWith('?'));
      const bad = inner.filter((h) => {
        const q = new URLSearchParams(h.slice(1));
        const bk = BOOKS.find((x) => x.id === q.get('book'));
        const ls = Number(q.get('lesson') || 1);
        return !bk || ls < 1 || ls > bk.lessons.length;
      });
      for (const h of (s.links || []).filter((x) => /^https?:/.test(x))) if (!external.has(h)) external.set(h, `${b.id} ${n}`);
      const tag = `${b.id} ${n} "${title}"`;
      ok(built >= 0 && s.title === title, `${tag}: opened by its link and built in ${Math.round((Date.now() - t0) / 1000)} s (title shown "${s.title}")`);
      ok(s.webgl && s.root && (s.tabs || []).every((x) => x > 80) && s.guide > 1000, `${tag}: 3D scene visible, notebook tabs ${JSON.stringify(s.tabs)} characters, guide ${s.guide} characters`);
      ok(bad.length === 0, `${tag}: ${inner.length} chapter links, broken ${bad.length ? bad.join(', ') : 'none'}`);
      ok(errors.length === 0 && failed.length === 0, `${tag}: page errors ${errors.length ? errors.join(' | ') : 'none'}; failed requests ${failed.length ? failed.join(' | ') : 'none'}`);
      await shot(`S-${DEV}-${b.id}-${n}.png`);
    }
  }
  // external links, requested from Node (some sites refuse automated requests: 403 / 429 are reported, not failed)
  if (DEV === 'desktop') {
    say(`--- external links: ${external.size}`);
    let broken = 0;
    for (const [u, where] of external) {
      let st;
      try {
        const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 link check' } });
        st = r.status;
      } catch (e) { st = 'ERR ' + (e.cause?.code || e.message); }
      const isBroken = st === 404 || st === 410 || (typeof st === 'string' && !/TIMEOUT|abort/i.test(st));
      if (isBroken) broken++;
      say(`   ${isBroken ? 'BROKEN' : st === 200 ? 'ok' : 'note'} ${st} ${u} (${where})`);
    }
    ok(broken === 0, `external links: ${external.size} checked, ${broken} broken (404 / 410 / no such host)`);
  }
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
