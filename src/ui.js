/* Shared notebook UI: shell (header, pager, tabs) and small widgets used by every lesson. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Very small Python highlighter (keywords, numbers, names we care about, comments). */
export function highlightPython(line) {
  const hash = line.indexOf('#');
  const code = hash >= 0 ? line.slice(0, hash) : line;
  const comment = hash >= 0 ? line.slice(hash) : '';
  const html = escapeHtml(code).replace(
    /\b(from|import|while|for|in|True|False)\b|\b(\d+(?:\.\d+)?)\b|\b(LED|PWMLED|Button|sleep|pause|on|off|value|when_pressed|when_released)\b/g,
    (m, kw, num) => {
      if (kw) return `<span class="kw">${m}</span>`;
      if (num) return `<span class="num">${m}</span>`;
      return `<span class="fn">${m}</span>`;
    },
  );
  return html + (comment ? `<span class="cm">${escapeHtml(comment)}</span>` : '');
}

/** Small Arduino C++ highlighter: keywords, types, constants, numbers, preprocessor lines and comments. */
export function highlightCpp(line) {
  const idx = line.indexOf('//');
  const code = idx >= 0 ? line.slice(0, idx) : line;
  const comment = idx >= 0 ? line.slice(idx) : '';
  const html = escapeHtml(code).replace(
    /^(\s*#\w+)|\b(const|constexpr|static|void|enum|class|if|else|switch|case|break|return|while|for|true|false|unsigned|long|bool|int|byte|uint8_t|uint32_t)\b|\b(0x[0-9a-fA-F]+|\d+(?:UL|ul|U|L)?)\b|\b(pinMode|digitalRead|digitalWrite|millis|setup|loop|Serial|begin|println|print|INPUT_PULLUP|OUTPUT|HIGH|LOW)\b/g,
    (m, pre, kw, num) => {
      if (pre) return `<span class="kw">${m}</span>`;
      if (kw) return `<span class="kw">${m}</span>`;
      if (num) return `<span class="num">${m}</span>`;
      return `<span class="fn">${m}</span>`;
    },
  );
  return html + (comment ? `<span class="cm">${escapeHtml(comment)}</span>` : '');
}

/** Renders source code with line numbers into <pre>. lang: 'python' (default) or 'cpp'. */
export function renderCode(el, source, lang = 'python') {
  const highlight = lang === 'cpp' ? highlightCpp : highlightPython;
  const lines = source.replace(/\r/g, '').replace(/\n$/, '').split('\n');
  el.innerHTML = lines.map((l, i) => `<span class="ln" data-n="${i + 1}">${highlight(l) || ' '}</span>`).join('');
  const lineEls = $$('.ln', el);
  return {
    lines,
    lineEls,
    find(re, from = 0) {
      for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
      return -1;
    },
    /** i: one line index, or an array of indexes (for several lines that run together), or -1 for none. */
    setActive(i) {
      const on = Array.isArray(i) ? i : [i];
      lineEls.forEach((e, n) => e.classList.toggle('active', on.includes(n)));
    },
    setTag(i, text) {
      lineEls.forEach((e, n) => {
        if (n === i && text) e.dataset.tag = text;
        else delete e.dataset.tag;
      });
    },
  };
}

export function bindCopy(button, getText, codeEl) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = 'Copied!';
    } catch {
      button.textContent = 'Press Ctrl+C';
      const r = document.createRange();
      r.selectNodeContents(codeEl);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
    setTimeout(() => (button.textContent = 'Copy'), 1600);
  });
}

export function createConsole(el, max = 5) {
  return (text, cls = '') => {
    const d = document.createElement('div');
    d.className = `l ${cls}`;
    d.textContent = text;
    el.appendChild(d);
    while (el.children.length > max) el.firstChild.remove();
  };
}

/** Numbered explanation cards. Clicking one moves the camera. */
export function renderSteps(ol, steps, onView) {
  ol.innerHTML = steps.map((s) => `<li tabindex="0"><b>${s.title}</b><span>${s.text}</span></li>`).join('');
  const els = $$('li', ol);
  els.forEach((el, i) => {
    const go = () => onView(steps[i].view);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go()));
  });
  let active = -2;
  return {
    setActive(i) {
      if (i === active) return;
      active = i;
      els.forEach((el, n) => el.classList.toggle('active', n === i));
    },
  };
}

/**
 * Scrolling logic-level chart. channels: [{ label, history: () => [{t, v}], isOn: () => bool,
 * hi: '3.3 V', lo: '0 V', on: 'HIGH', off: 'LOW', color }]
 */
export function createTimingChart(canvas, channels, windowMs = 8000) {
  const ctx = canvas.getContext('2d');
  return {
    draw(now) {
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const padL = 64, padR = 12, padT = 22, padB = 24;
      const laneH = (h - padT - padB) / channels.length;
      const x = (t) => padL + ((t - (now - windowMs)) / windowMs) * (w - padL - padR);

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#8c93b3';
      ctx.textAlign = 'center';
      for (let s = 0; s <= 8; s += 2) {
        const gx = x(now - s * 1000);
        ctx.beginPath();
        ctx.moveTo(gx, padT - 6);
        ctx.lineTo(gx, h - padB + 2);
        ctx.stroke();
        ctx.fillText(s === 0 ? 'now' : `-${s} s`, gx, h - 7);
      }

      channels.forEach((ch, k) => {
        const top = padT + k * laneH;
        const yHigh = top + 18, yLow = top + laneH - 12;
        ctx.textAlign = 'right';
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.fillStyle = ch.color;
        ctx.fillText(ch.hi, padL - 8, yHigh + 4);
        ctx.fillStyle = '#8c93b3';
        ctx.fillText(ch.lo, padL - 8, yLow + 4);

        const hist = ch.history();
        let first = 0;
        for (let i = 0; i < hist.length; i++) if (hist[i].t <= now - windowMs) first = i;
        let last = hist[first].v;
        const pts = [[now - windowMs, last]];
        for (let i = first + 1; i < hist.length; i++) {
          pts.push([hist[i].t, last], [hist[i].t, hist[i].v]);
          last = hist[i].v;
        }
        pts.push([now, last]);
        const Y = (v) => (v ? yHigh : yLow);

        ctx.fillStyle = ch.fill || 'rgba(255,207,107,0.16)';
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i][1] && pts[i + 1][1]) {
            ctx.fillRect(x(pts[i][0]), yHigh, Math.max(0, x(pts[i + 1][0]) - x(pts[i][0])), yLow - yHigh);
          }
        }
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([t, v], i) => (i ? ctx.lineTo(x(t), Y(v)) : ctx.moveTo(x(t), Y(v))));
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.font = '600 12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#cfd8ee';
        ctx.fillText(ch.label, padL, top + 11);
        ctx.fillStyle = ch.isOn() ? ch.color : '#8c93b3';
        ctx.fillText(ch.isOn() ? ch.on : ch.off, padL + ctx.measureText(ch.label).width + 8, top + 11);
      });
    },
  };
}

/** Header, pager and tabs of the notebook. */
export function createShell({ onPrev, onNext, onCloseBook }) {
  const tabs = { sim: $('#tabSim'), code: $('#tabCode'), how: $('#tabHow') };
  const prev = $('#prevBtn'), next = $('#nextBtn');

  $$('.tab-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === btn.dataset.tab));
    }),
  );
  prev.addEventListener('click', onPrev);
  next.addEventListener('click', onNext);
  $('#closeBookBtn').addEventListener('click', onCloseBook);

  return {
    tabs,
    setLesson(lesson, index, total, book = { title: 'Raspberry Pi 5 · The Interactive Book' }) {
      document.querySelector('.tab-btn[data-tab=code]').textContent = lesson.codeTab || 'Python';
      $('#lessonChapter').textContent = `Chapter ${lesson.number} · ${lesson.chapter}`;
      $('#lessonTitle').textContent = lesson.title;
      $('#pageInfo').innerHTML = `<b>Lesson ${lesson.number}</b> of ${total}`;
      document.title = `${book.title} · Lesson ${lesson.number}: ${lesson.title}`;
      prev.disabled = index === 0;
      next.disabled = index === total - 1;
    },
    setBusy(busy, index, total) {
      prev.disabled = busy || index === 0;
      next.disabled = busy || index === total - 1;
      $('#readBtn').disabled = busy;
      for (const id of ['#expandBtn', '#guideBtn']) if ($(id)) $(id).disabled = busy;
      $('#panel').classList.toggle('turning', busy);
    },
  };
}
