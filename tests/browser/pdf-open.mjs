// Opens each PDF of a folder in Chrome's PDF viewer (headless) and saves a screenshot of its first screens.
// Usage: node pdf-open.mjs <pdfDir> <outDir> <port>
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [DIR, OUT, PORTS] = process.argv.slice(2);
const PORT = Number(PORTS || 9450);
mkdirSync(OUT, { recursive: true });
const chrome = spawn((process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile-pdf')}`, '--window-size=900,1200', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (s) => { log.push(s); writeFileSync(join(OUT, 'pdf-open.txt'), log.join('\n')); };
let ws, id = 0;
const pending = new Map();
for (let i = 0; i < 120 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); } } catch { ws = null; }
  if (!ws) await sleep(250);
}
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.has(n)) { pending.delete(n); r({}); } }, 60000); });
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 1, mobile: false });
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.pdf'))) {
    await send('Page.navigate', { url: pathToFileURL(join(DIR, f)).href });
    await sleep(6000);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(OUT, `view-${f.replace(/\.pdf$/, '')}.png`), Buffer.from(r.result.data, 'base64'));
    const t = await send('Runtime.evaluate', { expression: 'document.contentType + " " + document.title', returnByValue: true });
    say(`${f}: ${t.result?.result?.value}`);
  }
} catch (e) { say('ERROR ' + e); }
say('DONE');
ws.close();
chrome.kill();
setTimeout(() => process.exit(0), 500);
