// Totals per device and book from layout-<device>-<port>.txt files of one run. Usage: node summarize.mjs <dir> <firstPort>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [DIR, FIRST] = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => /^layout-.*-(\d+)\.txt$/.test(f) && Number(/-(\d+)\.txt$/.exec(f)[1]) >= Number(FIRST));
const out = [];
let P = 0, F = 0;
for (const f of files.sort()) {
  const lines = readFileSync(join(DIR, f), 'utf8').split('\n');
  let book = '';
  const per = {};
  for (const l of lines) {
    const m = /^=== (\S+ ch\d+) /.exec(l);
    if (m) { book = m[1]; per[book] = { pass: 0, fail: [], skip: [] }; continue; }
    if (!book) continue;
    if (l.startsWith('PASS')) per[book].pass++;
    if (l.startsWith('FAIL')) per[book].fail.push(l.slice(5, 170));
    if (l.startsWith('SKIP')) per[book].skip.push(l.slice(5, 120));
  }
  const done = lines.some((l) => l.startsWith('DONE'));
  out.push(`## ${f.replace(/^layout-|\.txt$/g, '')}${done ? '' : ' (NOT FINISHED)'}`);
  for (const [b, r] of Object.entries(per)) {
    P += r.pass;
    F += r.fail.length;
    out.push(`- ${b}: ${r.pass} pass, ${r.fail.length} fail${r.skip.length ? `, skipped: ${r.skip.join('; ')}` : ''}`);
    for (const x of r.fail) out.push(`  - FAIL ${x}`);
  }
}
out.unshift(`total: ${P} pass, ${F} fail`);
writeFileSync(join(DIR, `summary-${FIRST}.md`), out.join('\n'));
