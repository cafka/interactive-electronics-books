// Layout, labels, tabs and PDF download checks, one device per run (sequential, one Chrome).
// Usage: node cdp-layout.mjs <outDir> <device> <port> [books comma] [pdf]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
const [OUT, DEV, PORTS, BOOKS, PDF] = process.argv.slice(2);
const PORT = Number(PORTS || 9400);
mkdirSync(OUT, { recursive: true });
const DEVS = {
  w320: [320, 568, true], w360: [360, 740, true], w390: [390, 844, true], w430: [430, 932, true],
  'phone-land': [844, 390, true], 'tablet-portrait': [768, 1024, true], 'tablet-land': [1024, 768, true], desktop: [1400, 900, false],
};
const [W, H, MOBILE] = DEVS[DEV];
const CHAPTERS = [['raspberry-pi', 1], ['esp32', 2], ['coral', 1], ['coral', 2], ['coral', 3]].filter(([b]) => !BOOKS || BOOKS === 'all' || BOOKS.split(',').includes(b));
const DL = join(OUT, 'downloads-' + DEV);
const chrome = spawn((process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile-layout-' + DEV)}`, '--window-size=1400,1100', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const say = (s) => { report.push(s); console.log(s); writeFileSync(join(OUT, `layout-${DEV}-${PORTS}.txt`), report.join('\n')); };
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
  if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 300));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
};
ws.onclose = () => say('WEBSOCKET CLOSED');
const keepAlive = setInterval(() => {}, 1000);
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id;
  const t = setTimeout(() => { pending.delete(n); r({ result: { exceptionDetails: { exception: { description: `timeout: ${method}` } } } }); }, 180000);
  pending.set(n, (x) => { clearTimeout(t); r(x); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300) : r.result?.result?.value; };
const J = async (e) => { const v = await evalJs(`JSON.stringify(${e})`); try { return JSON.parse(v); } catch { return { ERR: v }; } };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64')); };
const frames = (n) => evalJs(`new Promise((r) => { let k = 0; const f = () => (++k >= ${n} ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
const waitUntil = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await evalJs(expr)) === true) return Date.now() - t0; await sleep(400); } return -1; };
let passes = 0, fails = 0;
const ok = (c, m) => { c ? passes++ : fails++; say(`${c ? 'PASS' : 'FAIL'} ${m}`); };
// explicit timestamps: on software WebGL a frame takes about a second, and a tap must stay a tap
async function tap(x, y) {
  const t0 = Date.now() / 1000;
  if (MOBILE) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.08 });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, timestamp: t0 - 0.05 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, timestamp: t0 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, timestamp: t0 + 0.08 });
  }
  await frames(2);
}
async function dragFrom(x, y, dx) {
  const t0 = Date.now() / 1000;
  if (MOBILE) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
    for (let k = 1; k <= 4; k++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * k) / 4, y }], timestamp: t0 + k * 0.05 });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.3 });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, timestamp: t0 });
    for (let k = 1; k <= 4; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (dx * k) / 4, y, button: 'left', buttons: 1, timestamp: t0 + k * 0.05 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left', clickCount: 1, timestamp: t0 + 0.3 });
  }
  await frames(2);
}
async function clickSel(sel) {
  const r = await J(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width) return null; return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) return false;
  await tap(r.x, r.y);
  return true;
}
const labelsOnScreen = () => J(`[...document.querySelectorAll('#labels .label:not(.hidden)')].filter((l) => !l.classList.contains('collapsed')).map((l) => l.querySelector('b').textContent)`);
// visible controls: overlaps between them, with the book, size for touch, inside the screen
const CHROME = `(() => {
  const sels = ['#libraryBtn', '#camLabels', '#camPlay', '#camViews', '#camSelect', '#leftBar', '#viewTabs', '#cornerNext', '#cornerPrev', '#closeBookBtn', '#readBtn', '#leftPageBtn', '#expandBtn', '#guideBtn', '#prevBtn', '#nextBtn'];
  const vis = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return null; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05) return null; let p = e; while (p) { if (p.hidden) return null; p = p.parentElement; } return b; };
  const items = sels.map((s) => [s, vis(document.querySelector(s))]).filter(([, b]) => b);
  const inPanel = (s) => !!document.querySelector(s)?.closest('#panel');
  const panelShown = getComputedStyle(document.querySelector('#panel')).visibility !== 'hidden';
  const live = items.filter(([s]) => !inPanel(s) || panelShown);
  const ov = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const [sa, a] = live[i], [sb, b] = live[j];
    if (sa === '#camViews' && sb === '#camSelect') continue;
    if ((sa === '#leftBar') !== (sb === '#leftBar') && (document.querySelector('#leftBar').contains(document.querySelector(sa)) || document.querySelector('#leftBar').contains(document.querySelector(sb)))) continue;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) ov.push(sa + '/' + sb);
  }
  // fixed controls over the notebook (when it is on screen beside the book)
  const pr = document.querySelector('#panel').getBoundingClientRect();
  const overPanel = !document.body.classList.contains('nb-expanded') && panelShown ? live.filter(([s, b]) => !inPanel(s) && b.left < pr.right - 1 && pr.left < b.right - 1 && b.top < pr.bottom - 1 && pr.top < b.bottom - 1).map(([s]) => s) : [];
  const off = live.filter(([, b]) => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1).map(([s]) => s);
  // touch size of every visible button
  const btns = [...document.querySelectorAll('button, select, a[href], [role=tab]')].map((e) => [e, vis(e)]).filter(([e, b]) => b && (!e.closest('#panel') || panelShown) && !e.closest('#library'));
  const small = btns.filter(([e, b]) => b.height < 43.5 || b.width < 43.5).map(([e, b]) => (e.id || e.className || e.tagName).toString().slice(0, 24) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
  // horizontal scroll: the page, and the notebook when it is shown
  const panel = document.querySelector('#panel');
  const wide = [];
  if (panelShown) for (const e of panel.querySelectorAll('*')) { const b = e.getBoundingClientRect(); if (b.width && b.right > Math.min(innerWidth, pr.right) + 1.5) { let p = e.parentElement, inScroll = false; while (p && p !== panel) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { inScroll = true; break; } p = p.parentElement; } if (!inScroll) wide.push((e.id || e.className || e.tagName).toString().slice(0, 30)); } }
  const scrollers = panelShown ? [...panel.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowX; return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 2; }).map((e) => (e.className || e.tagName).toString().slice(0, 30)) : [];
  return { overlaps: ov, overPanel, offScreen: off, small: [...new Set(small)].slice(0, 12), smallCount: small.length, pageHScroll: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1, panelHScroll: panelShown && panel.scrollWidth > panel.clientWidth + 2, wide: [...new Set(wide)].slice(0, 8), innerHScroll: [...new Set(scrollers)].slice(0, 8) };
})()`;
const MEASURE = `(() => {
  const L = book3d.layout(), a = L.area, c = L.content;
  return { W: innerWidth, H: innerHeight, mode: L.tabbed ? (L.rail ? 'tabbed-rail' : 'tabbed') : L.sheet ? 'sheet' : L.compactSide ? 'compact-side' : 'side', tab: book3d.tab, view: book3d.viewName, camCompact: L.camCompact,
    inside: c.l >= a.l - 2 && c.r <= a.r + 2 && c.t >= a.t - 2 && c.b <= a.b + 2, useW: +((c.r - c.l) / (a.r - a.l)).toFixed(2), useH: +((c.b - c.t) / (a.b - a.t)).toFixed(2),
    offX: Math.round((c.l + c.r) / 2 - (a.l + a.r) / 2), offY: Math.round((c.t + c.b) / 2 - (a.t + a.b) / 2) };
})()`;
function checkPdf(file) {
  const b = readFileSync(file), s = b.toString('latin1');
  const out = { size: b.length, header: s.startsWith('%PDF-1.4'), eof: s.trimEnd().endsWith('%%EOF') };
  const sx = /startxref\n(\d+)\n%%EOF\s*$/.exec(s);
  out.xrefOk = !!sx && s.slice(+sx[1], +sx[1] + 4) === 'xref';
  if (out.xrefOk) {
    const head = /^xref\n0 (\d+)\n/.exec(s.slice(+sx[1]));
    const rows = s.slice(+sx[1] + head[0].length).split('\n');
    let bad = 0;
    for (let n = 1; n < +head[1]; n++) { const off = +rows[n].slice(0, 10); if (s.slice(off, off + `${n} 0 obj`.length) !== `${n} 0 obj`) bad++; }
    out.objects = +head[1] - 1;
    out.badOffsets = bad;
  }
  out.pages = +(/\/Type \/Pages \/Count (\d+)/.exec(s) || [0, 0])[1];
  out.images = (s.match(/\/Subtype \/Image/g) || []).length;
  // the text of every page (compressed streams)
  let text = '';
  const re = /<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  let m;
  while ((m = re.exec(s))) { const st = m.index + m[0].length; try { text += inflateSync(b.subarray(st, st + +m[1])).toString('latin1') + '\n'; } catch { out.inflateError = true; } }
  const shown = [...text.matchAll(/\((.*?)\) Tj/g)].map((x) => x[1]).join(' ');
  out.textChars = shown.length;
  out.has = ['Objective', 'Source code', 'How it works', 'Page 1 of'].filter((w) => shown.includes(w));
  out.codeFont = /\/F4 [\d.]+ Tf/.test(text);
  return out;
}
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE, screenOrientation: { type: W > H ? 'landscapePrimary' : 'portraitPrimary', angle: W > H ? 90 : 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE, maxTouchPoints: MOBILE ? 5 : 1 });
  if (MOBILE) await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  if (PDF) {
    if (existsSync(DL)) rmSync(DL, { recursive: true, force: true });
    mkdirSync(DL, { recursive: true });
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  }
  for (const [bk, ch] of CHAPTERS) {
    errors.length = 0;
    const t0 = Date.now();
    say(`=== ${bk} ch${ch} on ${DEV} ${W}x${H}`);
    await send('Page.navigate', { url: `${process.env.BASE_URL || 'http://127.0.0.1:5173'}/?book=${bk}&open=1&lesson=${ch}` });
    if ((await waitUntil(`typeof book3d === 'object' && book3d.runtimes.length > 0 && book3d.layout().measured`, 240000)) < 0) { say('FAIL the chapter did not finish building'); continue; }
    await evalJs('book3d.snapRig(); 1');
    await frames(2);
    let m = await J(MEASURE);
    say('entry ' + JSON.stringify(m));
    const tabbedExpected = W < 600 || H < 500;
    ok((m.mode.startsWith('tabbed')) === tabbedExpected, `layout "${m.mode}" for ${W}x${H} (tabs ${tabbedExpected ? 'expected' : 'not expected'})`);
    ok(m.view === 'book' && m.inside && Math.max(m.useW, m.useH) > 0.9 && Math.abs(m.offX) <= 4 && Math.abs(m.offY) <= 4, `entry: whole open book, centred (${m.offX}, ${m.offY}), filling the free area (${m.useW} x ${m.useH}), not cut`);
    if (tabbedExpected) ok(m.tab === 'experiment', `entry tab: ${m.tab}`);
    let c = await J(CHROME);
    ok(!c.overlaps.length && !c.offScreen.length && !c.overPanel.length, `controls: no overlap (${c.overlaps.join(', ') || 'none'}), none over the notebook (${c.overPanel.join(', ') || 'none'}), none cut by the screen edge (${c.offScreen.join(', ') || 'none'})`);
    const overBook = await J(`(() => { const c = book3d.layout().content; return ['#libraryBtn', '#camLabels', '#camPlay', '#camViews', '#camSelect', '#viewTabs', '#cornerNext', '#cornerPrev'].filter((s) => { const e = document.querySelector(s); if (!e) return false; let p = e; while (p) { if (p.hidden) return false; p = p.parentElement; } const b = e.getBoundingClientRect(); if (!b.width || getComputedStyle(e).display === 'none') return false; return b.left < c.r - 2 && c.l < b.right - 2 && b.top < c.b - 2 && c.t < b.bottom - 2; }); })()`);
    ok(!overBook.length, `no control over the book and its project: ${overBook.join(', ') || 'none'}`);
    ok(!c.pageHScroll && !c.panelHScroll && !c.wide.length, `no horizontal scroll: page ${c.pageHScroll}, notebook ${c.panelHScroll}, wider than the screen: ${c.wide.join(', ') || 'none'}; inner scrollers: ${c.innerHScroll.join(', ') || 'none'}`);
    if (MOBILE) ok(c.smallCount === 0, `touch targets >= 44 px: ${c.smallCount ? c.small.join(', ') : 'all'}`);
    else say(`info desktop controls under 44 px (mouse): ${c.smallCount}`);
    await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-1-entry.png`);
    // labels: none at first; a hover (mouse) or tap shows one; empty space or moving away hides it; a drag shows none
    let L = await labelsOnScreen();
    ok(L.length === 0 && (await evalJs('book3d.labelsShown')) === false, `no labels at first (${L.length})`);
    const anchors = await J(`book3d.runtimes[book3d.current].labels.map((l) => ({ t: l.title, p: book3d.project(l.at.x, l.at.y, l.at.z) }))`);
    const a = (await J('book3d.layout()')).area;
    // a tap on an anchor picks the nearest anchor, so parts a dozen pixels apart can still be tested on a phone
    const inA = anchors.filter((q) => q.p[0] > a.l + 14 && q.p[0] < a.r - 14 && q.p[1] > a.t + 14 && q.p[1] < a.b - 14 && anchors.every((z) => z === q || Math.hypot(z.p[0] - q.p[0], z.p[1] - q.p[1]) > 20));
    let empty = null;
    const free = await J(`(() => { const out = []; const a = book3d.layout().area; for (let y = a.t + 20; y < a.b - 20; y += 16) for (let x = a.l + 20; x < a.r - 20; x += 16) if (document.elementFromPoint(x, y)?.id === 'scene') out.push([x, y]); return out; })()`);
    for (const [gx, gy] of free) if (!empty && anchors.every((q) => Math.hypot(q.p[0] - gx, q.p[1] - gy) > 90)) empty = [gx, gy];
    if (inA.length >= 2 && empty) {
      const [p1, p2] = inA;
      if (!MOBILE) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p1.p[0] + 6, y: p1.p[1] + 4 });
        await frames(2);
        L = await labelsOnScreen();
        ok(L.length === 1 && L[0] === p1.t, `hover near "${p1.t}": only its label (${JSON.stringify(L)})`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty[0], y: empty[1] });
        await frames(2);
        L = await labelsOnScreen();
        ok(L.length === 0, `moving away hides it (${JSON.stringify(L)})`);
      }
      await tap(p1.p[0], p1.p[1]);
      if (!MOBILE) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty[0], y: empty[1] }); await frames(2); }
      L = await labelsOnScreen();
      ok(L.length === 1 && L[0] === p1.t, `${MOBILE ? 'tap' : 'click'} on "${p1.t}": only its label (${JSON.stringify(L)})`);
      const lr = await J(`(() => { const t = [...document.querySelectorAll('#labels .label:not(.hidden):not(.collapsed) .tag')][0]; if (!t) return null; const b = t.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; })()`);
      ok(!!lr && lr.l >= 0 && lr.r <= W && lr.t >= 0 && lr.b <= H, `its label is fully on screen (${JSON.stringify(lr)})`);
      await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-2-one-label.png`);
      await tap(p2.p[0], p2.p[1]);
      if (!MOBILE) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty[0], y: empty[1] }); await frames(2); }
      L = await labelsOnScreen();
      ok(L.length === 1 && L[0] === p2.t, `then on "${p2.t}": it replaces the first (${JSON.stringify(L)})`);
      await tap(empty[0], empty[1]);
      L = await labelsOnScreen();
      ok(L.length === 0, `on empty space: hidden (${JSON.stringify(L)})`);
      // rotating the camera starting on a part shows nothing
      await dragFrom(p1.p[0], p1.p[1], 80);
      if (!MOBILE) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty[0], y: empty[1] }); await frames(2); }
      L = await labelsOnScreen();
      ok(L.length === 0 && (await evalJs('book3d.selectedLabel')) === null, `a drag that starts on a part rotates the camera and shows no label (${JSON.stringify(L)})`);
      ok((await evalJs('book3d.current')) === ch - 1 && (await evalJs('book3d.turning')) === false, 'no page was turned by these taps');
      await evalJs(`book3d.setView('book'); book3d.snapRig(); 1`);
      await frames(2);
    } else say(`SKIP labels: ${inA.length} well separated parts on screen, empty point ${!!empty}`);
    const rt = 'book3d.runtimes[book3d.current]';
    const has = (await evalJs(`typeof ${rt}.inspect === 'function'`)) === true;
    const simNow = () => J(`${has} ? ${rt}.inspect() : null`);
    if (tabbedExpected) {
      const before = await simNow();
      // Book tab: the page, flat and centred
      await clickSel('.view-tab[data-tab=book]');
      await frames(3);
      await evalJs('book3d.snapRig(); 1');
      await frames(2);
      const page = await J(`(() => { const p = [[-11,0,-7],[0,0,-7],[-11,0,7],[0,0,7]].map((q) => book3d.project(...q)); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); const i = book3d.layout().insets; const fw = innerWidth - i.l - i.r, fh = innerHeight - i.t - i.b; return { tab: book3d.tab, left: book3d.leftView, l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys), fw, fh, cx: (Math.min(...xs) + Math.max(...xs)) / 2 - (i.l + fw / 2), cy: (Math.min(...ys) + Math.max(...ys)) / 2 - (i.t + fh / 2), i }; })()`);
      const pw = page.r - page.l, ph = page.b - page.t;
      if (W > H) ok(page.tab === 'book' && page.left && Math.abs(page.cx) < 6 && pw / page.fw > 0.9 && Math.abs(page.t - (page.i.t + 6)) < 14, `Book tab (landscape): the page fits the width (${Math.round(pw)} of ${page.fw} px), centred across (${Math.round(page.cx)}), its top at the top (${Math.round(page.t)}), ${Math.round(ph)} px tall to scroll by dragging`);
      else ok(page.tab === 'book' && page.left && Math.abs(page.cx) < 6 && Math.abs(page.cy) < 6 && page.l >= page.i.l - 1 && page.r <= innerW(page) && Math.max(pw / page.fw, ph / page.fh) > 0.9, `Book tab: the page flat, centred (${Math.round(page.cx)}, ${Math.round(page.cy)}), ${Math.round(pw)} x ${Math.round(ph)} px in ${page.fw} x ${page.fh}`);
      c = await J(CHROME);
      ok(!c.overlaps.length && !c.offScreen.length && (c.smallCount === 0), `Book tab controls: overlaps ${c.overlaps.join(', ') || 'none'}, cut ${c.offScreen.join(', ') || 'none'}, small ${c.small.join(', ') || 'none'}`);
      await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-3-tab-book.png`);
      // Notebook tab: everything, scrolling, nothing wider than the screen
      await clickSel('.view-tab[data-tab=notebook]');
      await frames(2);
      const nb = await J(`(() => { const p = document.querySelector('#panel'); const r = p.getBoundingClientRect(); const t = document.querySelector('#tabSim p, #tabSim li'); return { tab: book3d.tab, top: r.top, bottom: r.bottom, left: r.left, right: r.right, scrolls: p.scrollHeight > p.clientHeight + 4, font: t ? parseFloat(getComputedStyle(t).fontSize) : 0, pager: getComputedStyle(document.querySelector('.pager')).display, guide: !!document.querySelector('#guideBtn').getBoundingClientRect().width }; })()`);
      c = await J(CHROME);
      ok(nb.tab === 'notebook' && nb.scrolls && nb.font >= 14 && nb.pager !== 'none' && nb.guide && !c.panelHScroll && !c.wide.length && !c.overlaps.length && c.smallCount === 0, `Notebook tab: ${Math.round(nb.right - nb.left)} x ${Math.round(nb.bottom - nb.top)} px, scrolls ${nb.scrolls}, text ${nb.font}px, pager ${nb.pager}, guide button ${nb.guide}, horizontal overflow ${c.panelHScroll} ${c.wide.join(', ')}, overlaps ${c.overlaps.join(', ') || 'none'}, small ${c.small.join(', ') || 'none'}`);
      await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-4-tab-notebook.png`);
      for (const tab of ['code', 'how']) {
        await clickSel(`.tab-btn[data-tab=${tab}]`);
        await frames(1);
        c = await J(CHROME);
        ok(!c.panelHScroll && !c.wide.length, `Notebook tab "${tab}": nothing wider than the screen (${c.wide.join(', ') || 'ok'}; inner scrollers ${c.innerHScroll.join(', ') || 'none'})`);
        await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-5-notebook-${tab}.png`);
      }
      await clickSel('.tab-btn[data-tab=sim]');
      // back to the experiment: same chapter, simulation kept
      await clickSel('.view-tab[data-tab=experiment]');
      await frames(2);
      await evalJs('book3d.snapRig(); 1');
      await frames(1);
      const after = await simNow();
      m = await J(MEASURE);
      const simOk = !has || (after.running === before.running && (after.state ?? after.u ?? null) === (before.state ?? before.u ?? null));
      ok(m.tab === 'experiment' && (await evalJs('book3d.current')) === ch - 1 && simOk, `Experiment tab again: chapter kept, simulation kept (${has ? JSON.stringify({ running: after.running, state: after.state, u: after.u }) : 'no inspect'})`);
      await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-6-tab-experiment.png`);
    }
    // the guide: a real file is downloaded and is a valid PDF
    if (PDF) {
      if (tabbedExpected) await clickSel('.view-tab[data-tab=notebook]');
      // every book's guide stays in the folder (they have different names), so they can all be opened afterwards
      const before = new Set(readdirSync(DL));
      const okClick = await clickSel('#guideBtn');
      const t1 = Date.now();
      let file = null;
      while (Date.now() - t1 < 240000 && !file) { await sleep(1000); file = readdirSync(DL).find((f) => f.endsWith('.pdf') && !before.has(f)); }
      const lg = await J('book3d.lastGuide');
      const toast = await J(`(() => { const t = document.querySelector('#toast'); return { shown: !t.hidden, text: t.textContent.trim().slice(0, 140) }; })()`);
      if (file) {
        await sleep(1500);
        const p = checkPdf(join(DL, file));
        say('pdf ' + JSON.stringify({ file, ...p }));
        ok(okClick && p.header && p.eof && p.xrefOk && p.badOffsets === 0 && p.pages >= 2 && p.images >= 1 && p.has.includes('Objective') && p.has.includes('Page 1 of') && p.codeFont && toast.shown, `guide PDF downloaded "${file}" (${Math.round(p.size / 1024)} kB, ${p.pages} pages, ${p.images} pictures, sections found: ${p.has.join(', ')}), notice shown: "${toast.text}"`);
      } else ok(false, `guide PDF: no file in ${Math.round((Date.now() - t1) / 1000)} s (lastGuide ${JSON.stringify(lg)}, notice ${JSON.stringify(toast)})`);
      await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-7-guide-notice.png`);
      if (tabbedExpected) await clickSel('.view-tab[data-tab=experiment]');
    }
    // orientation / size change keeps the chapter and frames the book again
    if (tabbedExpected || DEV.startsWith('tablet')) {
      await send('Emulation.setDeviceMetricsOverride', { width: H, height: W, deviceScaleFactor: 1, mobile: MOBILE, screenOrientation: { type: H > W ? 'landscapePrimary' : 'portraitPrimary', angle: H > W ? 90 : 0 } });
      await frames(3);
      await evalJs('book3d.snapRig(); 1');
      await frames(2);
      m = await J(MEASURE);
      c = await J(CHROME);
      ok(m.inside && Math.max(m.useW, m.useH) > 0.9 && Math.abs(m.offX) <= 4 && Math.abs(m.offY) <= 4 && !c.overlaps.length && !c.offScreen.length && !c.pageHScroll && (await evalJs('book3d.current')) === ch - 1, `rotated to ${H}x${W} (${m.mode}): book framed again (${m.useW} x ${m.useH}, ${m.offX}, ${m.offY}), overlaps ${c.overlaps.join(', ') || 'none'}, cut ${c.offScreen.join(', ') || 'none'}`);
      await shot(`L-${bk}${ch > 1 ? ch : ''}-${DEV}-8-rotated.png`);
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE, screenOrientation: { type: W > H ? 'landscapePrimary' : 'portraitPrimary', angle: W > H ? 90 : 0 } });
      await frames(2);
    }
    say(`errors: ${errors.length ? errors.join(' | ') : 'none'} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
} catch (e) {
  say('SCRIPT ERROR ' + (e.stack || e));
} finally {
  say(`DONE pass ${passes} fail ${fails}`);
  clearInterval(keepAlive);
  try { ws.close(); } catch {}
  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}
function innerW(p) { return p.i.l + p.fw + 1; }
