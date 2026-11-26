/*
 * "Download experiment guide": a printable guide built from what the chapter already shows, with nothing written
 * twice. Sources, for any book and chapter:
 *   - the book and chapter metadata (title, board, chapter number and name, code language);
 *   - the left page content (lesson.pageContent: the same blocks as the 3D page and the "Read page" view);
 *   - the notebook tabs as they are mounted ("Code" and "How it works"; from "Simulate" only the guided
 *     experiments, which state their expected results);
 *   - a picture of the 3D book, taken from the current view.
 * Every heading is sorted into the sections of the guide by its words (materials, wiring, steps, code, ...), so a new
 * chapter needs no extra work. guidePdf.js lays this document out as a PDF file that is downloaded directly
 * (selectable text, no extra library, works offline).
 */

const BRAND = 'Inside the Circuit';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sections of the guide, in order. */
export const GUIDE_SECTIONS = [
  ['objective', 'Objective'],
  ['materials', 'Materials'],
  ['wiring', 'Wiring diagram'],
  ['steps', 'Step-by-step instructions'],
  ['code', 'Source code'],
  ['how', 'How it works'],
  ['expected', 'Expected results'],
  ['exercises', 'Exercises'],
  ['troubleshooting', 'Troubleshooting'],
  ['safety', 'Warnings and precautions'],
  ['references', 'References'],
];
const RULES = [
  ['materials', /you will need|parts list|materials|bill of materials|what you need|components needed/i],
  ['troubleshooting', /diagnos|troubleshoot/i],
  ['exercises', /exercise/i],
  ['safety', /safety|warning|caution|precaution|cannot detect|what it cannot|can and cannot/i],
  ['references', /^sources?$|references|documentation|further reading/i],
  ['steps', /assembly|step by step|upload|run it|try it|calibrat|set ?up|install|programming the|build it/i],
  ['wiring', /schematic|wiring|connection|pins\b|pinout|path of the signal/i],
];
/** Which section a heading belongs to. `fallback` is used when no rule matches. */
export function classifyHeading(title, fallback = 'how') {
  for (const [k, re] of RULES) if (re.test(title || '')) return k;
  return fallback;
}

/* ------------------------------------------------------------------ left page blocks -> sections */
function blockHtml(b) {
  if (b.type === 'p') return `<p>${esc(b.text)}</p>`;
  if (b.type === 'bullets') return `<ul>${b.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  if (b.type === 'numbered') return `<ol>${b.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
  if (b.type === 'cards') return `<div class="g-cards">${b.items.map((c) => `<div class="g-card ${c.tone === 'teal' ? 'teal' : ''}"><b>${esc(c.head)}</b><p>${esc(c.body)}</p></div>`).join('')}</div>`;
  if (b.type === 'svg') return `<figure class="g-fig">${b.svg}</figure>`;
  return '';
}
/** Splits the left page at its small headings; the text before the first heading is the objective. */
export function pageSections(content) {
  const out = [];
  let cur = { bucket: 'objective', title: null, parts: [] };
  for (const b of content?.blocks || []) {
    if (b.type === 'h') {
      if (cur.parts.length) out.push(cur);
      cur = { bucket: classifyHeading(b.text, 'how'), title: b.text, parts: [] };
      continue;
    }
    // a diagram outside any heading goes where its description says
    if (b.type === 'svg' && cur.bucket === 'objective') {
      const label = (b.svg.match(/aria-label="([^"]*)"/) || [])[1] || '';
      if (cur.parts.length) out.push(cur);
      out.push({ bucket: /schematic|wiring/i.test(label) ? 'wiring' : 'how', title: null, parts: [blockHtml(b)] });
      cur = { bucket: 'objective', title: null, parts: [] };
      continue;
    }
    cur.parts.push(blockHtml(b));
  }
  if (cur.parts.length) out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ notebook tabs -> sections */
const DROP = 'button, input, select, textarea, canvas, script, style, .console, .views, .options, .code-actions, .speed-row, [hidden]';
/** A copy of a mounted tab without its controls (buttons, inputs, live canvases), ready to print. */
function cleanCopy(root) {
  const c = root.cloneNode(true);
  c.querySelectorAll(DROP).forEach((e) => e.remove());
  c.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  c.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
  c.querySelectorAll('[tabindex], [aria-live], [data-tag]').forEach((e) => {
    e.removeAttribute('tabindex');
    e.removeAttribute('aria-live');
    e.removeAttribute('data-tag');
  });
  c.querySelectorAll('.active').forEach((e) => e.classList.remove('active'));
  // instructions about the 3D page itself make no sense on paper
  c.querySelectorAll('p').forEach((p) => /click a step to move the camera/i.test(p.textContent) && p.remove());
  c.querySelectorAll('label').forEach((l) => !l.textContent.trim() && l.remove());
  return c;
}
/** Splits a tab at its h3 headings. Text before the first heading belongs to the tab's own section. */
export function tabSections(root, tab) {
  if (!root) return [];
  const c = cleanCopy(root);
  const out = [];
  let cur = { title: null, nodes: [] };
  const isCode = (n) => n.nodeType === 1 && (n.matches('pre.code, .code-head') || !!n.querySelector('pre.code'));
  const htmlOf = (nodes) => nodes.map((n) => n.outerHTML ?? esc(n.textContent)).join('');
  const flush = () => {
    if (!cur.nodes.some((n) => n.textContent.trim() || n.querySelector?.('svg, img, table'))) return;
    const at = cur.nodes.findIndex(isCode);
    const fallback = tab === 'code' ? (at >= 0 ? 'code' : 'steps') : 'how';
    let bucket = classifyHeading(cur.title, fallback);
    if (at >= 0 && tab === 'code' && bucket !== 'steps') bucket = 'code';
    if (at >= 0 && bucket !== 'code') {
      // a listing under a heading about something else (setup, environment): the listing gets its own section
      const before = cur.nodes.slice(0, at);
      if (before.some((n) => n.textContent.trim())) out.push({ bucket, title: cur.title, parts: [htmlOf(before)] });
      out.push({ bucket: 'code', title: null, parts: [htmlOf(cur.nodes.slice(at))] });
      return;
    }
    out.push({ bucket, title: cur.title, parts: [htmlOf(cur.nodes)] });
  };
  for (const n of [...c.childNodes]) {
    if (n.nodeType === 1 && n.tagName === 'H3') {
      flush();
      cur = { title: n.textContent.trim(), nodes: [] };
    } else if (n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())) cur.nodes.push(n);
  }
  flush();
  return out;
}
/** Guided experiments (Simulate tab): what to do and what to expect, without the buttons and live results. */
export function expectedResults(simRoot) {
  const items = [...(simRoot?.querySelectorAll('ol.guided > li') || [])];
  if (!items.length) return [];
  const li = items.map((x) => {
    const title = x.querySelector('b')?.textContent.trim() || '';
    const text = x.querySelector('span')?.textContent.trim() || '';
    return `<li><b>${esc(title)}</b> ${esc(text)}</li>`;
  }).join('');
  return [{ bucket: 'expected', title: 'Guided experiments', parts: [`<ol class="g-guided">${li}</ol><p class="g-note">Each experiment can be run in the Simulate tab of the interactive book, which checks the result.</p>`] }];
}
/** Every external link of the chapter, once. */
function collectLinks(roots) {
  const seen = new Map();
  for (const r of roots) for (const a of r?.querySelectorAll('a[href^="http"]') || []) {
    const href = a.getAttribute('href');
    if (!seen.has(href)) seen.set(href, a.textContent.trim() || href);
  }
  return [...seen].map(([href, text]) => ({ href, text }));
}

/* ------------------------------------------------------------------ the document */
const CSS = `
  @page { size: A4; margin: 15mm 14mm 17mm; @bottom-left { content: "${BRAND} · experiment guide"; font: 8pt 'Segoe UI', Arial, sans-serif; color: #8a8270; } @bottom-right { content: counter(page) " / " counter(pages); font: 8pt 'Segoe UI', Arial, sans-serif; color: #8a8270; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { background: #fff; }
  body { margin: 0; color: #2b2740; font: 10pt/1.5 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif; }
  .g-wrap { max-width: 182mm; margin: 0 auto; }
  @media screen { body { background: #e9e4d6; } .g-wrap { background: #fff; padding: 14mm; margin: 10mm auto; box-shadow: 0 4px 24px rgba(0,0,0,0.15); } }
  .g-head { border-radius: 10px; padding: 16px 18px 14px; background: linear-gradient(135deg, #17213f, #2b2740); color: #f3ecd6; }
  .g-brand { margin: 0; font: 700 8.5pt 'Segoe UI', Arial, sans-serif; letter-spacing: 0.28em; text-transform: uppercase; color: #d8b25a; }
  .g-book { margin: 6px 0 0; font: italic 10.5pt Georgia, 'Times New Roman', serif; color: #cfd8ee; }
  .g-head h1 { margin: 4px 0 2px; font: 700 21pt/1.15 Georgia, 'Times New Roman', serif; color: #fff7e2; }
  .g-chapter { margin: 0; font: 700 8.5pt 'Segoe UI', Arial, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #ffb59f; }
  .g-meta { margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 8.5pt; color: #cfd8ee; }
  .g-meta b { color: #f3ecd6; }
  .g-shot { margin: 12px 0 0; }
  .g-shot img { display: block; width: 100%; max-height: 92mm; object-fit: contain; border-radius: 8px; background: #141a33; }
  .g-shot figcaption { font-size: 8pt; color: #6b6478; margin-top: 4px; }
  .g-toc { margin: 12px 0 4px; padding: 8px 12px; border: 1px solid #e1d9c3; border-radius: 8px; background: #fbf7ec; font-size: 9pt; columns: 2; }
  .g-toc ol { margin: 0; padding-left: 18px; }
  h2 { margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #b5432a; font: 700 14pt Georgia, 'Times New Roman', serif; color: #2b2740; break-after: avoid; }
  h2 .n { color: #b5432a; margin-right: 8px; }
  h3 { margin: 12px 0 4px; font: 700 8.5pt 'Segoe UI', Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #1f6f78; break-after: avoid; }
  p { margin: 4px 0 6px; }
  ul, ol { margin: 4px 0 8px; padding-left: 20px; }
  li { margin: 2px 0; }
  code, kbd { font: 8.8pt Consolas, 'Cascadia Mono', Menlo, monospace; background: #f3eee1; border-radius: 3px; padding: 0 3px; }
  a { color: #1f6f78; }
  figure { margin: 8px 0; break-inside: avoid; }
  .g-fig svg { display: block; width: 100%; height: auto; max-height: 120mm; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 8.8pt; break-inside: auto; }
  th, td { border: 1px solid #d9d0b8; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f3ecd6; font-weight: 700; }
  tr { break-inside: avoid; }
  pre.code { margin: 6px 0 10px; padding: 8px 10px; border-radius: 8px; background: #1b2133; color: #e8e6f0; font: 7.6pt/1.42 Consolas, 'Cascadia Mono', Menlo, monospace; white-space: pre-wrap; word-break: break-word; overflow: visible; }
  pre.code .ln { display: block; padding-left: 3.2em; text-indent: -3.2em; }
  pre.code .ln::before { content: attr(data-n); display: inline-block; width: 2.4em; margin-right: 0.8em; text-align: right; color: #6f7694; text-indent: 0; }
  pre.code .kw { color: #ff9e7d; } pre.code .num, pre.code .nm { color: #ffd27a; } pre.code .cm { color: #8c93b3; font-style: italic; } pre.code .str { color: #9ee6a8; } pre.code .fn { color: #7ad3ff; } pre.code .pp { color: #c58cff; }
  pre.code.small { font-size: 7.6pt; }
  .code-head { font: 700 8.5pt 'Segoe UI', Arial, sans-serif; color: #6b6478; margin-top: 8px; }
  ol.steps { list-style: none; padding: 0; counter-reset: st; }
  ol.steps > li { counter-increment: st; position: relative; margin: 6px 0; padding: 6px 10px 6px 34px; border: 1px solid #e1d9c3; border-radius: 8px; background: #fbf7ec; break-inside: avoid; }
  ol.steps > li::before { content: counter(st); position: absolute; left: 9px; top: 6px; width: 18px; height: 18px; border-radius: 50%; background: #b5432a; color: #fff; font: 700 8pt/18px 'Segoe UI', Arial, sans-serif; text-align: center; }
  ol.steps > li b { display: block; }
  .note, .g-note { font-size: 8.8pt; color: #5d5670; font-style: italic; }
  .path-line { padding: 6px 10px; border-radius: 6px; background: rgba(31,111,120,0.08); }
  .g-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0; }
  .g-card { border: 1.5px solid #b5432a; border-radius: 8px; padding: 6px 10px; background: rgba(181,67,42,0.06); break-inside: avoid; }
  .g-card.teal { border-color: #1f6f78; background: rgba(31,111,120,0.06); }
  .g-card b { font-size: 8pt; letter-spacing: 0.12em; }
  .g-card p { margin: 2px 0 0; font-size: 9pt; }
  section.safety { padding: 4px 12px 8px; border: 2px solid #c0392b; border-radius: 10px; background: #fff6f3; }
  section.safety h2 { border-bottom-color: #c0392b; }
  ul.g-refs { padding-left: 18px; } ul.g-refs li { word-break: break-all; }
  ul.g-refs .t { word-break: normal; }
  details summary { font-weight: 700; color: #1f6f78; list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  .g-foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e1d9c3; font-size: 8pt; color: #6b6478; }
  /* pieces of the notebook's own layout that should not take room on paper */
  .chip, .status-row, .alarm-box, .gp-grid, .guided em, .reveal, .quiz { display: none !important; }
`;

/**
 * The whole guide as an HTML document.
 * @param {{ book, lesson, tabs: { sim, code, how }, snapshot?: string, generated?: Date }} p
 */
export function buildGuideHtml({ book, lesson, tabs, snapshot, generated = new Date() }) {
  const all = [
    ...pageSections(lesson.pageContent),
    ...tabSections(tabs.code, 'code'),
    ...tabSections(tabs.how, 'how'),
    ...expectedResults(tabs.sim),
  ];
  const links = collectLinks([tabs.how, tabs.code, tabs.sim]);
  const by = Object.fromEntries(GUIDE_SECTIONS.map(([k]) => [k, []]));
  for (const s of all) (by[s.bucket] || by.how).push(s);
  // the references section lists the links once, even if a tab had its own "Sources" list
  by.references = links.length ? [{ title: null, parts: [`<ul class="g-refs">${links.map((l) => `<li><span class="t">${esc(l.text)}</span><br><a href="${esc(l.href)}">${esc(l.href)}</a></li>`).join('')}</ul>`] }] : [];
  const used = GUIDE_SECTIONS.filter(([k]) => by[k].length);
  const title = `${book.name || book.title} · Chapter ${lesson.number}: ${lesson.title}`;
  const date = generated.toISOString().slice(0, 10);
  const body = used.map(([k, label], i) => `
    <section class="${k}">
      <h2><span class="n">${i + 1}</span>${esc(label)}</h2>
      ${by[k].map((s) => `${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${s.parts.join('')}`).join('')}
    </section>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(guideFileName(book, lesson))}</title>
<meta name="description" content="${esc(title)}"><style>${CSS}</style></head>
<body><main class="g-wrap">
  <header class="g-head">
    <p class="g-brand">${BRAND} · Experiment guide</p>
    <p class="g-book">${esc(book.title)}</p>
    <p class="g-chapter">Chapter ${lesson.number} · ${esc(lesson.chapter || '')}</p>
    <h1>${esc(lesson.title)}</h1>
    <p class="g-meta"><span><b>Board:</b> ${esc(book.board || book.name || '')}</span><span><b>Code:</b> ${esc(lesson.codeTab || 'Python')}</span><span><b>Generated:</b> ${date}</span></p>
    ${snapshot ? `<figure class="g-shot"><img src="${snapshot}" alt="The project in the interactive 3D book"><figcaption style="color:#cfd8ee">The project in the interactive 3D book (web simulation).</figcaption></figure>` : ''}
  </header>
  <nav class="g-toc" aria-label="Contents"><ol>${used.map(([, label]) => `<li>${esc(label)}</li>`).join('')}</ol></nav>
  ${body}
  <p class="g-foot">${BRAND} · ${esc(title)}. Generated from the interactive book on ${date}. The book's simulation runs in a web browser and never touches real hardware: check every connection on your own parts before you power them.</p>
</main></body></html>`;
}

/** File name of the PDF, without the extension. */
export function guideFileName(book, lesson) {
  const slug = (s) => String(s).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  return `Inside-the-Circuit_${slug(book.name || book.id)}_Chapter-${lesson.number}_${slug(lesson.title)}`;
}
