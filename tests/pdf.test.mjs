// The PDF writer behind "Download experiment guide": the file structure is valid (header, objects, cross-reference
// table, trailer), text is encoded for the standard fonts, and lines are broken to the width asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PdfDoc, toWinAnsi, textWidth, wrapRuns, platformDeflate } from '../src/pdf.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/** Checks the structure a PDF reader relies on and returns the objects by number. */
function parsePdf(bytes) {
  const s = latin1(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'), 'header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'end marker');
  const sx = /startxref\n(\d+)\n%%EOF\s*$/.exec(s);
  assert.ok(sx, 'startxref');
  const xrefAt = Number(sx[1]);
  assert.equal(s.slice(xrefAt, xrefAt + 4), 'xref', 'startxref points at the xref table');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(xrefAt));
  const count = Number(head[1]);
  const rows = s.slice(xrefAt + head[0].length).split('\n').slice(0, count);
  assert.equal(rows[0], '0000000000 65535 f ');
  const objs = {};
  for (let n = 1; n < count; n++) {
    const off = Number(rows[n].slice(0, 10));
    assert.equal(s.slice(off, off + `${n} 0 obj`.length), `${n} 0 obj`, `xref entry ${n} points at object ${n}`);
    objs[n] = s.slice(off, s.indexOf('endobj', off));
  }
  const trailer = s.slice(s.indexOf('trailer', xrefAt));
  assert.match(trailer, new RegExp(`/Size ${count} `));
  return { s, objs, count };
}

test('WinAnsi: Latin-1 and typographic characters kept, others spelt in ASCII', () => {
  assert.equal(toWinAnsi('µ ° ± é'), 'µ ° ± é');
  assert.equal(toWinAnsi('– — “ok” • …'), '\x96 \x97 \x93ok\x94 \x95 \x85');
  assert.equal(toWinAnsi('330 Ω → LED ≥ 2 V'), '330 Ohm -> LED >= 2 V');
  assert.equal(toWinAnsi(toWinAnsi('a – b')), toWinAnsi('a – b'), 'converting twice changes nothing');
  assert.equal(toWinAnsi('tab\there'), 'tab    here');
});

test('text widths follow the font metrics', () => {
  assert.equal(textWidth('iiii', 'F4', 10), 24, 'Courier: 0.6 em per character');
  assert.ok(Math.abs(textWidth('Hello', 'F1', 10) - 22.78) < 0.01, 'Helvetica');
  assert.ok(textWidth('Hello', 'F2', 10) > textWidth('Hello', 'F1', 10), 'bold is wider');
});

test('lines are broken at spaces, within the width, and a long word is split', () => {
  const runs = [{ text: 'The LED lights when GPIO17 is HIGH and goes dark when it is LOW again.', font: 'F1', size: 10, color: '#000' }];
  const lines = wrapRuns(runs, 120);
  assert.ok(lines.length > 2);
  for (const l of lines) for (const p of l) assert.ok(p.x + p.w <= 120.01, `"${p.text}" fits`);
  assert.equal(lines.map((l) => l.map((p) => p.text).join(' ')).join(' '), runs[0].text);
  const url = wrapRuns([{ text: 'https://github.com/google-coral/coralmicro/tree/main/examples/tflm_person_detection_m7', font: 'F1', size: 9, color: '#000' }], 150);
  assert.ok(url.length > 1 && url.every((l) => l.every((p) => p.x + p.w <= 150.01)));
  const styled = wrapRuns([{ text: 'Run ', font: 'F1', size: 10 }, { text: 'led.on()', font: 'F4', size: 9.2 }, { br: true }, { text: 'next line', font: 'F1', size: 10 }], 400);
  assert.equal(styled.length, 2);
  assert.equal(styled[0][1].font, 'F4');
});

test('a document with text, shapes, a picture and a link is a valid PDF', async () => {
  const pdf = new PdfDoc({ title: 'Guide · test', author: 'Inside the Circuit' });
  pdf.addPage();
  pdf.rect(40, 40, 200, 60, { fill: '#17213f', radius: 8 });
  pdf.text(50, 70, 'Light an LED (330 Ω)', { font: 'F2', size: 16, color: '#ffffff' });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // structure only: a reader decodes it, this test does not
  pdf.image(pdf.addJpeg(jpeg, 4, 3), 40, 120, 200, 150);
  pdf.link(40, 300, 100, 12, 'https://www.raspberrypi.com/documentation/');
  pdf.addPage();
  pdf.text(40, 60, 'Page two (with a backslash \\ and parentheses)', { font: 'F4', size: 9 });
  const bytes = await pdf.output();
  const { s, objs } = parsePdf(bytes);
  assert.match(objs[2], /\/Type \/Pages \/Count 2 /);
  assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
  assert.match(s, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  // parentheses and backslashes inside a string are escaped
  assert.match(s, /\(Light an LED \\\(330 Ohm\\\)\) Tj/);
  assert.match(s, /\(Page two \\\(with a backslash \\\\ and parentheses\\\)\) Tj/);
  assert.match(s, /\/Subtype \/Image \/Width 4 \/Height 3 .*\/Filter \/DCTDecode \/Length 4 /);
  assert.match(s, /\/URI \(https:\/\/www\.raspberrypi\.com\/documentation\/\)/);
  assert.match(s, /\/Title \(Guide \xb7 test\)/);
});

test('page contents may be compressed (FlateDecode) and decompress to the same drawing', async () => {
  const deflate = platformDeflate();
  assert.ok(deflate, 'CompressionStream is available in Node 18+');
  const pdf = new PdfDoc();
  pdf.addPage();
  for (let i = 0; i < 40; i++) pdf.text(40, 40 + i * 12, `Line ${i} of the guide`, { size: 10 });
  const bytes = await pdf.output({ deflate });
  const { s } = parsePdf(bytes);
  const m = /<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(s);
  assert.ok(m, 'a compressed content stream');
  const start = m.index + m[0].length;
  const data = Buffer.from(bytes.slice(start, start + Number(m[1])));
  const text = inflateSync(data).toString('latin1');
  assert.match(text, /\(Line 39 of the guide\) Tj/);
});
