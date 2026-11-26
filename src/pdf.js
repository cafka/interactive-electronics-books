/*
 * A small PDF 1.4 writer: A4 pages, the standard fonts (Helvetica, Helvetica-Bold, Helvetica-Oblique, Courier,
 * Courier-Bold, nothing embedded), filled and stroked rectangles, JPEG images and web links.
 * No DOM and no dependency, so it runs in the browser and in Node (tests/pdf.test.mjs).
 * Text is written in WinAnsiEncoding: characters outside it are replaced by a close ASCII spelling (→ "->", Ω "Ohm").
 */

/* ------------------------------------------------------------------ text encoding and metrics */
// WinAnsi (cp1252) bytes 0x80..0x9f
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
// characters the standard fonts do not have, spelt with ones they have
const SPELL = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇄': '<->', '↑': '^', '↓': 'v', '≥': '>=', '≤': '<=', '≠': '!=',
  '≈': '~', '∼': '~', 'Ω': 'Ohm', 'Δ': 'Delta ', 'π': 'pi', 'α': 'alpha', 'β': 'beta', 'θ': 'theta', 'λ': 'lambda',
  'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'ω': 'omega', '√': 'sqrt', '∞': 'inf', '−': '-', '‑': '-', '‐': '-', '⁄': '/',
  '✓': 'OK', '✔': 'OK', '✗': 'x', '✕': 'x', '✘': 'x', '▶': '>', '►': '>', '◀': '<', '❚': '|', '■': '#', '□': '[ ]',
  '●': '*', '○': 'o', '◆': '*', '★': '*', '⚠': '!', '\u2009': ' ', '\u200a': ' ', '\u202f': ' ', '\u2007': ' ',
  '\u2002': ' ', '\u2003': ' ', '\u200b': '', '\u2060': '', '\ufeff': '', '′': "'", '″': '"', '∘': 'o', '·': '\u00b7',
};
/** A string in WinAnsi code points (0..255), one per character. */
export function toWinAnsi(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 9) out += '    ';
    else if (c === 10 || c === 13) out += ' ';
    else if (c < 32) continue;
    // 0x80..0x9f are already WinAnsi bytes (never real text): converting twice changes nothing
    else if (c <= 0xff) out += ch;
    else if (CP1252[c]) out += String.fromCharCode(CP1252[c]);
    else if (SPELL[ch] !== undefined) out += toWinAnsi(SPELL[ch]);
    else {
      // accents on letters outside Latin-1: keep the base letter
      const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      out += base && base !== ch && [...base].every((b) => b.codePointAt(0) < 256) ? base : c > 0xffff ? '' : '?';
    }
  }
  return out;
}
// Adobe AFM widths (1/1000 em) for the printable ASCII range 32..126
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// a few common characters above 127 (WinAnsi code -> width); others use the width of "n"
const HIGH = { 0x95: 350, 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x85: 1000, 0xb7: 278, 0xb0: 400, 0xa0: 278, 0xd7: 584, 0xb1: 584, 0xb2: 333, 0xb3: 333, 0xb5: 556, 0xa9: 737, 0xae: 737, 0x99: 1000 };
export const FONTS = {
  F1: { base: 'Helvetica', widths: HELV },
  F2: { base: 'Helvetica-Bold', widths: HELV_B },
  F3: { base: 'Helvetica-Oblique', widths: HELV },
  F4: { base: 'Courier', mono: true },
  F5: { base: 'Courier-Bold', mono: true },
};
/** Width in points of a WinAnsi string set in a font at a size. */
export function textWidth(winAnsi, font, size) {
  const f = FONTS[font];
  if (f.mono) return winAnsi.length * 0.6 * size;
  let w = 0;
  for (let i = 0; i < winAnsi.length; i++) {
    const c = winAnsi.charCodeAt(i);
    w += c >= 32 && c <= 126 ? f.widths[c - 32] : HIGH[c] ?? (font === 'F2' ? 611 : 556);
  }
  return (w * size) / 1000;
}
const pdfString = (winAnsi) => `(${winAnsi.replace(/[\\()]/g, (m) => `\\${m}`)})`;
const num = (x) => (Math.round(x * 100) / 100).toString();
/** "#rrggbb" -> "r g b" in 0..1. */
const rgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
};

/* ------------------------------------------------------------------ document */
export const A4 = { w: 595.28, h: 841.89 };

export class PdfDoc {
  constructor({ title = '', author = '', subject = '', creator = '' } = {}) {
    this.info = { title, author, subject, creator };
    this.pages = [];
    this.images = []; // { bytes, w, h }
    this.page = null;
  }
  addPage() {
    this.page = { ops: [], links: [], images: new Set() };
    this.pages.push(this.page);
    return this.page;
  }
  /* Coordinates are from the top-left corner of the page, in points, y down (converted when written). */
  text(x, y, str, { font = 'F1', size = 10, color = '#2b2740' } = {}) {
    const s = toWinAnsi(str);
    if (!s) return 0;
    this.page.ops.push(`BT /${font} ${num(size)} Tf ${rgb(color)} rg ${num(x)} ${num(A4.h - y)} Td ${pdfString(s)} Tj ET`);
    return textWidth(s, font, size);
  }
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.8, radius = 0 } = {}) {
    const op = fill && stroke ? 'B' : fill ? 'f' : 'S';
    const parts = ['q'];
    if (fill) parts.push(`${rgb(fill)} rg`);
    if (stroke) parts.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    const X = x, Y = A4.h - y - h;
    if (radius > 0) {
      const r = Math.min(radius, w / 2, h / 2), k = 0.5523 * r;
      parts.push(`${num(X + r)} ${num(Y)} m ${num(X + w - r)} ${num(Y)} l ${num(X + w - r + k)} ${num(Y)} ${num(X + w)} ${num(Y + r - k)} ${num(X + w)} ${num(Y + r)} c`
        + ` ${num(X + w)} ${num(Y + h - r)} l ${num(X + w)} ${num(Y + h - r + k)} ${num(X + w - r + k)} ${num(Y + h)} ${num(X + w - r)} ${num(Y + h)} c`
        + ` ${num(X + r)} ${num(Y + h)} l ${num(X + r - k)} ${num(Y + h)} ${num(X)} ${num(Y + h - r + k)} ${num(X)} ${num(Y + h - r)} c`
        + ` ${num(X)} ${num(Y + r)} l ${num(X)} ${num(Y + r - k)} ${num(X + r - k)} ${num(Y)} ${num(X + r)} ${num(Y)} c h ${op}`);
    } else parts.push(`${num(X)} ${num(Y)} ${num(w)} ${num(h)} re ${op}`);
    parts.push('Q');
    this.page.ops.push(parts.join(' '));
  }
  line(x1, y1, x2, y2, { color = '#2b2740', lineWidth = 0.8 } = {}) {
    this.page.ops.push(`q ${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(A4.h - y1)} m ${num(x2)} ${num(A4.h - y2)} l S Q`);
  }
  /** Registers a JPEG (its file bytes and pixel size) and returns its index. */
  addJpeg(bytes, w, h) {
    this.images.push({ bytes, w, h });
    return this.images.length - 1;
  }
  image(index, x, y, w, h) {
    this.page.images.add(index);
    this.page.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(A4.h - y - h)} cm /Im${index} Do Q`);
  }
  link(x, y, w, h, uri) {
    this.page.links.push({ x, y, w, h, uri });
  }

  /** The file. `deflate(bytes)` (optional, async) compresses the page contents. */
  async output({ deflate = null } = {}) {
    const enc = (s) => {
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
      return b;
    };
    const chunks = [];
    let length = 0;
    const offsets = [];
    const push = (b) => {
      chunks.push(b);
      length += b.length;
    };
    const obj = (n, body) => {
      offsets[n] = length;
      push(enc(`${n} 0 obj\n`));
      for (const b of Array.isArray(body) ? body : [body]) push(typeof b === 'string' ? enc(b) : b);
      push(enc('\nendobj\n'));
    };
    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    // object numbers: 1 catalog, 2 pages, 3 info, 4..8 fonts, then images, then per page: page, content
    const fontNames = Object.keys(FONTS);
    const fontObj = (i) => 4 + i;
    const imgObj = (i) => 4 + fontNames.length + i;
    const pageObj = (i) => 4 + fontNames.length + this.images.length + i * 2;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const I = this.info;
    obj(3, `<< /Title ${pdfString(toWinAnsi(I.title))} /Author ${pdfString(toWinAnsi(I.author))} /Subject ${pdfString(toWinAnsi(I.subject))} /Creator ${pdfString(toWinAnsi(I.creator))} /Producer (Inside the Circuit PDF writer) /CreationDate (${date}) >>`);
    fontNames.forEach((k, i) => obj(fontObj(i), `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k].base} /Encoding /WinAnsiEncoding >>`));
    this.images.forEach((im, i) => obj(imgObj(i), [
      `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`,
      im.bytes, '\nendstream',
    ]));
    const fontRes = fontNames.map((k, i) => `/${k} ${fontObj(i)} 0 R`).join(' ');
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      const xo = [...p.images].map((k) => `/Im${k} ${imgObj(k)} 0 R`).join(' ');
      const annots = p.links.map((l) => `<< /Type /Annot /Subtype /Link /Rect [${num(l.x)} ${num(A4.h - l.y - l.h)} ${num(l.x + l.w)} ${num(A4.h - l.y)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(toWinAnsi(l.uri))} >> >>`).join(' ');
      obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << ${fontRes} >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${pageObj(i) + 1} 0 R${annots ? ` /Annots [${annots}]` : ''} >>`);
      let data = enc(p.ops.join('\n'));
      let filter = '';
      if (deflate) {
        data = await deflate(data);
        filter = ' /Filter /FlateDecode';
      }
      obj(pageObj(i) + 1, [`<< /Length ${data.length}${filter} >>\nstream\n`, data, '\nendstream']);
    }
    const count = pageObj(this.pages.length - 1) + 2;
    const xref = length;
    let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    push(enc(`${x}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(length);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/** zlib deflate with the platform's CompressionStream (browsers, Node 18+), or null if there is none. */
export function platformDeflate() {
  if (typeof CompressionStream === 'undefined') return null;
  return async (bytes) => {
    const cs = new CompressionStream('deflate');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(await out);
  };
}

/* ------------------------------------------------------------------ line breaking */
/**
 * Breaks runs of styled text into lines that fit a width. A run is { text, font, size, color, href? }.
 * Returns lines, each an array of pieces { text, font, size, color, href, x, w } with x from the line start.
 */
export function wrapRuns(runs, width) {
  const lines = [];
  let line = [], x = 0, pendingSpace = null;
  const flush = () => {
    lines.push(line);
    line = [];
    x = 0;
    pendingSpace = null;
  };
  for (const r of runs) {
    if (r.br) {
      flush();
      continue;
    }
    const t = toWinAnsi(r.text);
    // words, keeping where the spaces were
    const parts = t.split(/( +)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^ +$/.test(part)) {
        if (line.length) pendingSpace = { r, w: textWidth(' ', r.font, r.size) };
        continue;
      }
      let word = part;
      let w = textWidth(word, r.font, r.size);
      const sp = pendingSpace ? pendingSpace.w : 0;
      if (line.length && x + sp + w > width) flush();
      else if (pendingSpace) x += sp;
      pendingSpace = null;
      // a word longer than the line (a URL, a long identifier): split it by characters
      while (w > width && word.length > 1) {
        let k = word.length - 1;
        while (k > 1 && textWidth(word.slice(0, k), r.font, r.size) > width - x) k--;
        const head = word.slice(0, k);
        line.push({ ...r, text: head, x, w: textWidth(head, r.font, r.size) });
        flush();
        word = word.slice(k);
        w = textWidth(word, r.font, r.size);
      }
      const prev = line[line.length - 1];
      if (prev && prev.font === r.font && prev.size === r.size && prev.color === r.color && prev.href === r.href && Math.abs(prev.x + prev.w + sp - x) < 0.01 && !r.noMerge) {
        // same style as the previous piece: one piece with the space inside
        prev.text += (sp ? ' ' : '') + word;
        prev.w = textWidth(prev.text, r.font, r.size);
      } else line.push({ ...r, text: word, x, w });
      x += w;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}
