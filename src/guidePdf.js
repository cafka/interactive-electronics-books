/*
 * The experiment guide as a real PDF file, downloaded directly (no print dialog).
 * Input: the guide document built by guide.js from the chapter's own content (left page, notebook tabs, guided
 * experiments, links, 3D snapshot), so nothing is written twice. This module only lays that document out on
 * A4 pages: headings, paragraphs with bold / italic / code / links, lists, tables, code listings (wrapped, with line
 * numbers and the notebook's colours), diagrams (the SVGs are drawn into images) and pictures.
 */
import { PdfDoc, A4, wrapRuns, textWidth, toWinAnsi, platformDeflate } from './pdf.js';

const C = {
  ink: '#2b2740', soft: '#5d5670', accent: '#b5432a', teal: '#1f6f78', navy: '#17213f', gold: '#d8b25a',
  paper: '#fbf7ec', rule: '#e1d9c3', cell: '#d9d0b8', head: '#f3ecd6', codeBg: '#f4f1ea', codeInk: '#1f2433',
  codeNum: '#9a95ad', light: '#cfd8ee', white: '#fff7e2', salmon: '#ffb59f', safety: '#c0392b',
};
const CODE_COLORS = { kw: '#b5432a', num: '#8a5a00', nm: '#8a5a00', cm: '#7b7690', str: '#2f7d3a', fn: '#1f6f78', pp: '#7a3fb0' };
const M = { l: 44, r: 44, t: 46, b: 54 };
const W = A4.w - M.l - M.r;
const BOTTOM = A4.h - M.b;
// pieces of the notebook that only make sense on screen (live readouts, quizzes, buttons)
const SKIP = '.chip, .status-row, .alarm-box, .gp-grid, .guided em, .reveal, .quiz, .g-toc, script, style, button, input, select, textarea, canvas, video, audio, iframe, [hidden]';
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'TABLE', 'FIGURE', 'FIGCAPTION', 'BLOCKQUOTE', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'HR', 'FORM', 'FIELDSET']);

/* ------------------------------------------------------------------ pictures */
const b64ToBytes = (b64) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const loadImage = (src) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error('image did not load'));
  im.src = src;
});
/** Draws an image source onto a white canvas and returns { bytes, w, h } as JPEG. */
async function toJpeg(src, maxW = 1600) {
  const im = await loadImage(src);
  const k = Math.min(1, maxW / (im.naturalWidth || maxW));
  const w = Math.max(1, Math.round((im.naturalWidth || maxW) * k)), h = Math.max(1, Math.round((im.naturalHeight || maxW * 0.6) * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(im, 0, 0, w, h);
  return { bytes: b64ToBytes(c.toDataURL('image/jpeg', 0.9).split(',')[1]), w, h };
}
/** An inline SVG element as a JPEG, drawn at 1600 px across. Icons (24 x 24 and similar) are skipped. */
async function svgToJpeg(svg) {
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const vw = vb[2] || parseFloat(svg.getAttribute('width')) || 0, vh = vb[3] || parseFloat(svg.getAttribute('height')) || 0;
  if (!(vw > 60 && vh > 30)) return null;
  const c = svg.cloneNode(true);
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const pxW = 1600, pxH = Math.round((pxW * vh) / vw);
  c.setAttribute('width', String(pxW));
  c.setAttribute('height', String(pxH));
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(c))}`;
  const j = await toJpeg(src, pxW);
  return { ...j, ratio: vh / vw };
}
async function imgToJpeg(img) {
  const src = img.getAttribute('src') || '';
  const m = /^data:image\/jpeg;base64,(.*)$/i.exec(src);
  if (m) {
    const im = await loadImage(src);
    return { bytes: b64ToBytes(m[1]), w: im.naturalWidth, h: im.naturalHeight, ratio: im.naturalHeight / im.naturalWidth };
  }
  const j = await toJpeg(src);
  return { ...j, ratio: j.h / j.w };
}

/* ------------------------------------------------------------------ layout */
class Layout {
  constructor(pdf, pictures) {
    this.pdf = pdf;
    this.pictures = pictures; // element -> { index, ratio }
    this.y = BOTTOM; // forces a first page
    this.marker = null; // list marker waiting for the first line of its item
  }
  newPage() {
    this.pdf.addPage();
    this.y = M.t;
  }
  need(h) {
    if (this.y + h > BOTTOM) this.newPage();
  }
  gap(h) {
    if (this.y > M.t + 1) this.y += h;
  }
  /** Lines of runs, each line kept on one page. */
  paragraph(runs, { indent = 0, size = 10, lead = 1.38, after = 5, bg = null } = {}) {
    if (!runs.some((r) => r.br || toWinAnsi(r.text).trim())) {
      this.flushMarker(indent, size);
      return;
    }
    const lines = wrapRuns(runs, W - indent);
    for (const line of lines) {
      const lh = Math.max(size, ...line.map((p) => p.size)) * lead;
      this.need(lh);
      if (bg) this.pdf.rect(M.l + indent - 4, this.y - 1, W - indent + 8, lh + 2, { fill: bg });
      const base = this.y + lh * 0.74;
      this.drawMarker(base, indent);
      for (const p of line) {
        this.pdf.text(M.l + indent + p.x, base, p.text, { font: p.font, size: p.size, color: p.color });
        if (p.href) this.pdf.link(M.l + indent + p.x, base - p.size * 0.8, p.w, p.size * 1.05, p.href);
      }
      this.y += lh;
    }
    this.y += after;
  }
  drawMarker(base, indent) {
    if (!this.marker) return;
    const m = this.marker;
    this.marker = null;
    this.pdf.text(M.l + indent - m.w - 5, base, m.text, { font: m.font, size: m.size, color: m.color });
  }
  flushMarker(indent, size) {
    if (!this.marker) return;
    this.need(size * 1.4);
    this.drawMarker(this.y + size * 1.03, indent);
    this.y += size * 1.4;
  }
  heading2(numText, label, color) {
    this.gap(12);
    this.need(46);
    const base = this.y + 15;
    const w = this.pdf.text(M.l, base, numText, { font: 'F2', size: 14, color });
    this.pdf.text(M.l + w + 8, base, label, { font: 'F2', size: 14, color: C.ink });
    this.pdf.line(M.l, this.y + 21, M.l + W, this.y + 21, { color, lineWidth: 1.6 });
    this.y += 29;
  }
  heading3(text) {
    this.gap(6);
    this.need(34);
    this.paragraph([{ text: text.toUpperCase(), font: 'F2', size: 8.5, color: C.teal }], { after: 2 });
  }
  picture(info, { indent = 0, maxH = 400, caption = '' } = {}) {
    let w = W - indent, h = w * info.ratio;
    if (h > maxH) {
      h = maxH;
      w = h / info.ratio;
    }
    this.need(h + 6);
    this.pdf.image(info.index, M.l + indent + (W - indent - w) / 2, this.y, w, h);
    this.y += h + 6;
    if (caption) this.paragraph([{ text: caption, font: 'F3', size: 8, color: C.soft }], { indent, after: 4 });
  }
  code(pre, indent) {
    const size = 7.6, lh = 10.2, pad = 7;
    const lines = [];
    const lnEls = [...pre.querySelectorAll('.ln')];
    const segsOf = (el) => {
      const out = [];
      const walk = (n, color) => {
        // line breaks are kept (a plain listing is split on them); everything else is converted to WinAnsi
        if (n.nodeType === 3) out.push({ text: n.textContent.split('\n').map(toWinAnsi).join('\n'), color });
        else if (n.nodeType === 1) {
          const cls = [...n.classList].find((k) => CODE_COLORS[k]);
          for (const ch of n.childNodes) walk(ch, cls ? CODE_COLORS[cls] : color);
        }
      };
      walk(el, C.codeInk);
      return out;
    };
    if (lnEls.length) lnEls.forEach((el) => lines.push({ n: el.getAttribute('data-n') || '', segs: segsOf(el) }));
    else {
      // plain listing: one segment list per text line
      const all = segsOf(pre);
      let cur = [];
      for (const s of all) {
        const parts = s.text.split('\n');
        parts.forEach((p, i) => {
          if (i > 0) {
            lines.push({ n: '', segs: cur });
            cur = [];
          }
          if (p) cur.push({ text: p, color: s.color });
        });
      }
      lines.push({ n: '', segs: cur });
      while (lines.length && !lines[lines.length - 1].segs.some((s) => s.text.trim())) lines.pop();
    }
    const numbered = lines.some((l) => l.n);
    const numW = numbered ? 4 * 0.6 * size + 6 : 0;
    const maxChars = Math.max(20, Math.floor((W - indent - 2 * pad - numW) / (0.6 * size)));
    // visual lines: a long source line continues on the next visual line, indented under itself
    const vis = [];
    for (const l of lines) {
      const chars = [];
      for (const s of l.segs) for (const ch of s.text) chars.push({ ch, color: s.color });
      if (!chars.length) {
        vis.push({ n: l.n, segs: [] });
        continue;
      }
      for (let i = 0, first = true; i < chars.length; first = false) {
        const take = chars.slice(i, i + maxChars);
        i += maxChars;
        const segs = [];
        for (const c of take) {
          const last = segs[segs.length - 1];
          if (last && last.color === c.color) last.text += c.ch;
          else segs.push({ text: c.ch, color: c.color });
        }
        vis.push({ n: first ? l.n : '', segs });
      }
    }
    let k = 0;
    this.gap(2);
    while (k < vis.length) {
      this.need(lh * Math.min(3, vis.length - k) + 2 * pad);
      const room = Math.max(1, Math.floor((BOTTOM - this.y - 2 * pad) / lh));
      const part = vis.slice(k, k + room);
      const h = part.length * lh + 2 * pad;
      this.pdf.rect(M.l + indent, this.y, W - indent, h, { fill: C.codeBg, stroke: C.rule, lineWidth: 0.6, radius: 5 });
      let y = this.y + pad;
      for (const v of part) {
        const base = y + lh * 0.75;
        if (v.n) this.pdf.text(M.l + indent + pad + numW - 6 - textWidth(v.n, 'F4', size), base, v.n, { font: 'F4', size, color: C.codeNum });
        let x = M.l + indent + pad + numW;
        for (const s of v.segs) x += this.pdf.text(x, base, s.text, { font: 'F4', size, color: s.color });
        y += lh;
      }
      this.y += h;
      k += part.length;
      if (k < vis.length) this.newPage();
    }
    this.y += 7;
  }
  table(table, indent) {
    const rows = [...table.rows].map((tr) => [...tr.cells]);
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const size = 8.3, pad = 4, lead = 1.3;
    const cellRuns = rows.map((r) => r.map((td) => inlineRuns(td, { font: td.tagName === 'TH' ? 'F2' : 'F1', size, color: C.ink })));
    const avail = W - indent;
    const nat = Array(cols).fill(0), min = Array(cols).fill(0);
    cellRuns.forEach((r) => r.forEach((runs, j) => {
      const text = runs.map((x) => x.text || '').join('');
      const t = toWinAnsi(text);
      nat[j] = Math.max(nat[j], Math.min(avail, textWidth(t, 'F2', size)) + 2 * pad);
      const longest = t.split(/\s+/).reduce((m, w) => Math.max(m, textWidth(w, 'F2', size)), 0);
      min[j] = Math.max(min[j], Math.min(avail / cols * 1.6, longest) + 2 * pad);
    }));
    let widths;
    const sumMin = min.reduce((a, b) => a + b, 0), sumNat = nat.reduce((a, b) => a + b, 0);
    if (sumNat <= avail) widths = nat.map((n) => n + (avail - sumNat) / cols);
    else if (sumMin >= avail) widths = min.map((m) => (m * avail) / sumMin);
    else {
      const extra = avail - sumMin, want = nat.map((n, j) => n - min[j]), sw = want.reduce((a, b) => a + b, 0) || 1;
      widths = min.map((m, j) => m + (extra * want[j]) / sw);
    }
    const head = rows[0].every((c) => c.tagName === 'TH') ? 0 : -1;
    const drawRow = (i) => {
      const laid = cellRuns[i].map((runs, j) => wrapRuns(runs, widths[j] - 2 * pad));
      const h = Math.max(...laid.map((ls) => ls.length || 1)) * size * lead + 2 * pad;
      if (this.y + h > BOTTOM) {
        this.newPage();
        if (head === 0 && i !== 0) drawRow(0);
      }
      let x = M.l + indent;
      for (let j = 0; j < cols; j++) {
        const w = widths[j];
        this.pdf.rect(x, this.y, w, h, { fill: i === head ? C.head : null, stroke: C.cell, lineWidth: 0.6 });
        let y = this.y + pad;
        for (const line of laid[j] || []) {
          const base = y + size * lead * 0.74;
          for (const p of line) {
            this.pdf.text(x + pad + p.x, base, p.text, { font: p.font, size: p.size, color: p.color });
            if (p.href) this.pdf.link(x + pad + p.x, base - p.size * 0.8, p.w, p.size * 1.05, p.href);
          }
          y += size * lead;
        }
        x += w;
      }
      this.y += h;
    };
    this.gap(3);
    for (let i = 0; i < rows.length; i++) drawRow(i);
    this.y += 8;
  }
  cards(el, indent) {
    const cards = [...el.querySelectorAll('.g-card')];
    const colW = (W - indent - 10) / 2, pad = 7;
    for (let i = 0; i < cards.length; i += 2) {
      const pair = cards.slice(i, i + 2).map((c) => {
        const head = c.querySelector('b')?.textContent || '';
        const body = c.querySelector('p')?.textContent || '';
        const hl = wrapRuns([{ text: head, font: 'F2', size: 8, color: c.classList.contains('teal') ? C.teal : C.accent }], colW - 2 * pad);
        const bl = wrapRuns([{ text: body, font: 'F1', size: 9, color: C.ink }], colW - 2 * pad);
        return { c, hl, bl, h: hl.length * 11 + bl.length * 12.4 + 2 * pad + 2 };
      });
      const h = Math.max(...pair.map((p) => p.h));
      this.need(h + 6);
      pair.forEach((p, k) => {
        const x = M.l + indent + k * (colW + 10);
        const teal = p.c.classList.contains('teal');
        this.pdf.rect(x, this.y, colW, h, { fill: teal ? '#eaf3f3' : '#fbefeb', stroke: teal ? C.teal : C.accent, lineWidth: 1.1, radius: 6 });
        let y = this.y + pad;
        for (const line of p.hl) {
          for (const q of line) this.pdf.text(x + pad + q.x, y + 8, q.text, { font: q.font, size: q.size, color: q.color });
          y += 11;
        }
        y += 2;
        for (const line of p.bl) {
          for (const q of line) this.pdf.text(x + pad + q.x, y + 9, q.text, { font: q.font, size: q.size, color: q.color });
          y += 12.4;
        }
      });
      this.y += h + 8;
    }
  }
  header(head) {
    const brand = head.querySelector('.g-brand')?.textContent || '';
    const bookT = head.querySelector('.g-book')?.textContent || '';
    const chap = head.querySelector('.g-chapter')?.textContent || '';
    const title = head.querySelector('h1')?.textContent || '';
    const meta = [...(head.querySelector('.g-meta')?.children || [])].map((s) => s.textContent.trim()).join('  ·  ');
    const inner = W - 32;
    const tl = wrapRuns([{ text: title, font: 'F2', size: 21, color: C.white }], inner);
    const ml = wrapRuns([{ text: meta, font: 'F1', size: 8.5, color: C.light }], inner);
    const bl = wrapRuns([{ text: bookT, font: 'F3', size: 10.5, color: C.light }], inner);
    const h = 16 + 12 + bl.length * 14 + 14 + tl.length * 25 + 6 + ml.length * 12 + 12;
    this.newPage();
    this.pdf.rect(M.l, this.y, W, h, { fill: C.navy, radius: 9 });
    let y = this.y + 16;
    this.pdf.text(M.l + 16, y + 8, brand.toUpperCase(), { font: 'F2', size: 8.5, color: C.gold });
    y += 14;
    for (const line of bl) {
      for (const p of line) this.pdf.text(M.l + 16 + p.x, y + 10, p.text, { font: p.font, size: p.size, color: p.color });
      y += 14;
    }
    this.pdf.text(M.l + 16, y + 10, chap.toUpperCase(), { font: 'F2', size: 8.5, color: C.salmon });
    y += 14;
    for (const line of tl) {
      for (const p of line) this.pdf.text(M.l + 16 + p.x, y + 20, p.text, { font: p.font, size: p.size, color: p.color });
      y += 25;
    }
    y += 6;
    for (const line of ml) {
      for (const p of line) this.pdf.text(M.l + 16 + p.x, y + 9, p.text, { font: p.font, size: p.size, color: p.color });
      y += 12;
    }
    this.y += h + 10;
    const img = head.querySelector('figure img');
    if (img && this.pictures.has(img)) this.picture(this.pictures.get(img), { maxH: 270, caption: head.querySelector('figcaption')?.textContent || '' });
  }

  /* ---------- the walk over the document ---------- */
  blocks(node, indent = 0, base = { font: 'F1', size: 10, color: C.ink }) {
    let inline = [];
    const flush = () => {
      if (inline.length) {
        const runs = inline.flatMap((n) => inlineRuns(n, base));
        this.paragraph(runs, { indent, size: base.size });
      }
      inline = [];
    };
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        if (n.textContent.trim()) inline.push(n);
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toUpperCase();
      const isSvg = tag === 'SVG' && this.pictures.has(n); // other SVGs are icons inside the text
      if (!BLOCK.has(tag) && !isSvg && !(tag === 'IMG' && this.pictures.has(n))) {
        inline.push(n);
        continue;
      }
      flush();
      this.block(n, tag, indent, base);
    }
    flush();
    if (this.marker) this.flushMarker(indent, base.size);
  }
  block(n, tag, indent, base) {
    const cls = n.classList;
    if (cls.contains('g-head')) return this.header(n);
    if (cls.contains('g-cards')) return this.cards(n, indent);
    if (tag === 'SVG' || tag === 'IMG') {
      const info = this.pictures.get(n);
      if (info) this.picture(info, { indent });
      return;
    }
    if (tag === 'H1') return this.paragraph(inlineRuns(n, { font: 'F2', size: 16, color: C.ink }), { indent, after: 6 });
    if (tag === 'H2') {
      const num = n.querySelector('.n')?.textContent || '';
      const label = [...n.childNodes].filter((c) => !(c.nodeType === 1 && c.classList.contains('n'))).map((c) => c.textContent).join('').trim();
      const safety = n.closest('section')?.classList.contains('safety');
      return this.heading2(num, label, safety ? C.safety : C.accent);
    }
    if (tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return this.heading3(n.textContent.trim());
    if (tag === 'PRE') return this.code(n, indent);
    if (tag === 'TABLE') return this.table(n, indent);
    if (tag === 'HR') {
      this.need(10);
      this.pdf.line(M.l + indent, this.y + 4, M.l + W, this.y + 4, { color: C.rule });
      this.y += 10;
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      let k = Number(n.getAttribute('start')) || 1;
      const ordered = tag === 'OL';
      const step = ordered ? 18 : 13;
      for (const li of n.children) {
        if (li.tagName.toUpperCase() !== 'LI') continue;
        const text = ordered ? `${k++}.` : '•';
        const font = ordered ? 'F2' : 'F1';
        this.marker = { text, font, size: base.size, color: ordered ? C.accent : C.accent, w: textWidth(toWinAnsi(text), font, base.size) };
        // a bold title followed by its text (steps, guided experiments): the title on its own line
        const first = li.firstElementChild;
        if (first && first.tagName.toUpperCase() === 'B' && first.nextElementSibling && first.nextElementSibling.tagName.toUpperCase() === 'SPAN') first.dataset.brk = '1';
        this.blocks(li, indent + step, base);
        this.y += 1;
      }
      this.y += 3;
      return;
    }
    if (tag === 'FIGURE') {
      const cap = n.querySelector('figcaption')?.textContent?.trim() || '';
      for (const c of n.children) if (c.tagName.toUpperCase() !== 'FIGCAPTION') this.block(c, c.tagName.toUpperCase(), indent, base);
      if (cap) this.paragraph([{ text: cap, font: 'F3', size: 8, color: C.soft }], { indent });
      return;
    }
    if (tag === 'SUMMARY') return this.paragraph(inlineRuns(n, { ...base, font: 'F2', color: C.teal }), { indent, size: base.size });
    if (cls.contains('code-head')) return this.paragraph(inlineRuns(n, { font: 'F2', size: 8.3, color: C.soft }), { indent, after: 2 });
    if (cls.contains('note') || cls.contains('g-note') || cls.contains('sim-note')) return this.blocks(n, indent, { font: 'F3', size: 8.8, color: C.soft });
    if (cls.contains('g-foot')) {
      this.gap(8);
      this.need(30);
      this.pdf.line(M.l, this.y, M.l + W, this.y, { color: C.rule });
      this.y += 6;
      return this.paragraph(inlineRuns(n, { font: 'F1', size: 7.8, color: C.soft }));
    }
    if (tag === 'P' || tag === 'DT' || tag === 'DD' || tag === 'FIGCAPTION' || tag === 'BLOCKQUOTE') {
      // a paragraph may still hold a block (rare): walk it like a container
      if ([...n.children].some((c) => BLOCK.has(c.tagName.toUpperCase()) || c.tagName.toUpperCase() === 'SVG')) return this.blocks(n, indent, base);
      return this.paragraph(inlineRuns(n, base), { indent, size: base.size });
    }
    return this.blocks(n, indent, base);
  }
}

/** Styled runs of an inline piece of the document. */
function inlineRuns(node, style) {
  const out = [];
  const walk = (n, s) => {
    if (n.nodeType === 3) {
      const t = n.textContent.replace(/\s+/g, ' ');
      if (t) out.push({ text: t, ...s });
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toUpperCase();
    if (tag === 'BR') return out.push({ br: true });
    if (tag === 'SVG' || tag === 'IMG') return; // icons inside text
    let t = s;
    if (tag === 'B' || tag === 'STRONG' || tag === 'TH') t = { ...t, font: t.font === 'F4' ? 'F5' : 'F2' };
    else if (tag === 'I' || tag === 'EM' || tag === 'CITE') t = { ...t, font: t.font === 'F2' ? 'F2' : 'F3' };
    else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') t = { ...t, font: t.font === 'F2' ? 'F5' : 'F4', size: s.size * 0.92, color: '#4a2f7a' };
    else if (tag === 'A' && n.getAttribute('href')) t = { ...t, color: C.teal, href: n.getAttribute('href') };
    for (const c of n.childNodes) walk(c, t);
    if (n.dataset && n.dataset.brk) out.push({ br: true });
    if (tag === 'A' && t.href && /^https?:/i.test(t.href) && !n.textContent.includes(t.href)) {
      out.push({ text: ` (${t.href})`, ...s, size: s.size * 0.82, color: C.soft, href: t.href });
    }
  };
  walk(node, style);
  return out;
}

/**
 * The guide document (from guide.js buildGuideHtml) as PDF bytes.
 * @param {string} html
 * @param {{ title?: string, subject?: string }} meta
 */
export async function guidePdf(html, meta = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.g-wrap') || doc.body;
  root.querySelectorAll(SKIP).forEach((e) => e.remove());
  const pdf = new PdfDoc({ title: meta.title || doc.title, subject: meta.subject || '', author: 'Inside the Circuit', creator: 'Inside the Circuit interactive book' });
  // pictures first (drawing an SVG into an image is asynchronous); one that cannot be drawn is left out
  const pictures = new Map();
  for (const el of root.querySelectorAll('svg, img')) {
    if (el.parentElement && el.parentElement.closest('svg')) continue;
    try {
      const j = el.tagName.toUpperCase() === 'IMG' ? await imgToJpeg(el) : await svgToJpeg(el);
      if (j) pictures.set(el, { index: pdf.addJpeg(j.bytes, j.w, j.h), ratio: j.ratio });
    } catch (err) {
      console.warn('guide PDF: a picture was left out', err);
    }
  }
  const lay = new Layout(pdf, pictures);
  lay.blocks(root);
  if (!pdf.pages.length) pdf.addPage();
  // footer on every page
  const total = pdf.pages.length;
  const foot = toWinAnsi(meta.footer || 'Inside the Circuit · Experiment guide');
  pdf.pages.forEach((p, i) => {
    pdf.page = p;
    pdf.line(M.l, A4.h - 36, M.l + W, A4.h - 36, { color: C.rule, lineWidth: 0.5 });
    pdf.text(M.l, A4.h - 24, foot, { font: 'F1', size: 7.5, color: '#8a8270' });
    const right = `Page ${i + 1} of ${total}`;
    pdf.text(M.l + W - textWidth(right, 'F1', 7.5), A4.h - 24, right, { font: 'F1', size: 7.5, color: '#8a8270' });
  });
  return pdf.output({ deflate: platformDeflate() });
}

/** Saves bytes as a file through a temporary link. Returns the object URL (valid for two minutes). */
export function downloadFile(bytes, fileName, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return url;
}
