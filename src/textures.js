import * as THREE from 'three';

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const INK = '#1d1a33';
const ACCENT = '#b5432a';
const GOLD = '#d8b25a';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function wrap(ctx, text, x, y, maxW, lh) {
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lh;
  }
  return y;
}

function paper(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#f1e8d2');
  g.addColorStop(0.5, '#f8f1de');
  g.addColorStop(1, '#efe5cc');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // fibres
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(120,95,50,${Math.random() * 0.045})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
  }
}

/** Page edge stripes (the stacked paper look on the sides of the page block). */
export function pageEdgeTexture() {
  const [c, ctx] = canvas(8, 256);
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, 8, 256);
  for (let y = 0; y < 256; y += 3) {
    ctx.fillStyle = `rgba(110,85,45,${0.12 + Math.random() * 0.18})`;
    ctx.fillRect(0, y, 8, 1);
  }
  return texture(c);
}

/** Cover art. Drawn rotated 180 degrees because it is mounted on the underside of the left cover. */
export function coverTexture() {
  return coverFromPainter(paintPiCover);
}

/** Wraps a cover painter (ctx, W, H) into the texture of the hinged cover (rotated 180 degrees, see above). */
export function coverFromPainter(paint) {
  const W = 1100, H = 1400;
  const [c, ctx] = canvas(W, H);
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  paint(ctx, W, H);
  return texture(c);
}

/** Raspberry Pi book cover, drawn upright (library thumbnails use it as is). */
export function paintPiCover(ctx, W = 1100, H = 1400) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1b2f5c');
  bg.addColorStop(1, '#0b1630');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // gold frame
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.strokeRect(60, 60, W - 120, H - 120);
  ctx.lineWidth = 2;
  ctx.strokeRect(80, 80, W - 160, H - 160);

  ctx.textAlign = 'center';
  ctx.fillStyle = GOLD;
  ctx.font = `600 28px ${SANS}`;
  ctx.letterSpacing = '8px';
  ctx.fillText('AN INTERACTIVE SCIENCE BOOK', W / 2, 190);

  ctx.letterSpacing = '2px';
  ctx.font = `bold 120px ${SERIF}`;
  ctx.fillStyle = '#f6e7b8';
  ctx.fillText('Raspberry', W / 2, 340);
  ctx.fillText('Pi 5', W / 2, 460);

  ctx.letterSpacing = '0px';
  ctx.font = `italic 40px ${SERIF}`;
  ctx.fillStyle = '#cfd8ee';
  ctx.fillText('Electronics you can touch', W / 2, 540);

  // illustration: glowing LED above a GPIO header
  const cx = W / 2, cy = 800;
  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 260);
  glow.addColorStop(0, 'rgba(255,120,90,0.95)');
  glow.addColorStop(0.35, 'rgba(255,70,60,0.35)');
  glow.addColorStop(1, 'rgba(255,60,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 300, cy - 300, 600, 600);
  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath();
  ctx.arc(cx, cy, 62, Math.PI, 0);
  ctx.lineTo(cx + 62, cy + 80);
  ctx.lineTo(cx - 62, cy + 80);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx - 24, cy - 24, 12, 26, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(cx - 62, cy + 80, 124, 10);
  ctx.fillRect(cx - 30, cy + 90, 7, 90);
  ctx.fillRect(cx + 23, cy + 90, 7, 90);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(cx - 285 + i * 30, 1010 + row * 30, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(216,178,90,0.8)';
  ctx.font = `600 24px ${SANS}`;
  ctx.letterSpacing = '5px';
  ctx.fillText('40-PIN GPIO', W / 2, 1100);

  ctx.letterSpacing = '6px';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('VOLUME I', W / 2, 1220);
  ctx.letterSpacing = '0px';
  ctx.font = `italic 34px ${SERIF}`;
  ctx.fillStyle = '#f6e7b8';
  ctx.fillText('Lesson 1: Light an LED', W / 2, 1275);
}

export function rightPageTexture({ fig = 'FIG. 1', caption = 'GPIO17 → 330 Ω → LED → GND', hint = 'Drag to orbit, scroll to zoom. Use the notebook to run the code.', page = 2 } = {}) {
  const W = 1100, H = 1400;
  const [c, ctx] = canvas(W, H);
  paper(ctx, W, H);
  // dot grid, like lab paper
  ctx.fillStyle = 'rgba(70,90,120,0.16)';
  for (let x = 50; x < W; x += 50) for (let y = 50; y < H; y += 50) ctx.fillRect(x - 1, y - 1, 3, 3);
  const sh = ctx.createLinearGradient(0, 0, 140, 0);
  sh.addColorStop(0, 'rgba(90,60,20,0.22)');
  sh.addColorStop(1, 'rgba(90,60,20,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, 140, H);

  ctx.textAlign = 'left';
  ctx.fillStyle = ACCENT;
  ctx.font = `700 22px ${SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText(fig, 100, 62);
  ctx.fillStyle = INK;
  ctx.font = `italic 26px ${SERIF}`;
  ctx.letterSpacing = '0px';
  ctx.fillText(caption, 215, 62);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(43,39,64,0.7)';
  ctx.font = `italic 24px ${SERIF}`;
  ctx.fillText(hint, W / 2, 1350);
  ctx.fillStyle = 'rgba(43,39,64,0.55)';
  ctx.font = `italic 26px ${SERIF}`;
  ctx.fillText(`— ${page} —`, W / 2, 1385);
  return texture(c);
}

/** Deterministic pseudo random numbers, so textures look the same on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stylised raspberry used for the board logo and the RP1 chip. */
function drawBerry(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  const rows = [[-1, 1], [-1.5, -0.5, 0.5, 1.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5], [-0.5, 0.5], [0]];
  rows.forEach((row, r) => row.forEach((c) => {
    ctx.beginPath();
    ctx.arc(x + c * s * 0.42, y + (r - 1.6) * s * 0.4, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }));
  ctx.beginPath();
  ctx.ellipse(x - s * 0.34, y - s * 1.28, s * 0.3, s * 0.13, -0.5, 0, Math.PI * 2);
  ctx.ellipse(x + s * 0.34, y - s * 1.28, s * 0.3, s * 0.13, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Package marking for the chips (generic dashes, not real part numbers). kind: 'ram' | 'rp1' | 'soc' | 'small' */
function paintChip(kind) {
  const [c, ctx] = canvas(384, 288);
  const rand = rng(kind.length * 977 + 13);
  if (kind === 'soc') {
    const g = ctx.createLinearGradient(0, 0, 384, 288);
    g.addColorStop(0, '#e2e4e8');
    g.addColorStop(0.5, '#c4c7cd');
    g.addColorStop(1, '#d6d8dc');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 384, 288);
    for (let y = 0; y < 288; y += 2) {
      ctx.fillStyle = `rgba(70,75,85,${0.03 + rand() * 0.05})`;
      ctx.fillRect(0, y, 384, 1);
    }
    ctx.fillStyle = 'rgba(60,64,74,0.55)';
    [[34, 70, 300], [34, 96, 250], [34, 122, 280], [34, 148, 210]].forEach(([x, y, w]) => {
      for (let i = 0; i < w; i += 14) ctx.fillRect(x + i, y, 8 + rand() * 4, 6);
    });
    ctx.strokeStyle = 'rgba(60,64,74,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 50, 344, 140);
    ctx.fillStyle = 'rgba(60,64,74,0.5)';
    ctx.beginPath();
    ctx.arc(34, 250, 9, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = kind === 'small' ? '#111114' : '#0b0b0e';
    ctx.fillRect(0, 0, 384, 288);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand() * 0.035})`;
      ctx.fillRect(rand() * 384, rand() * 288, 2, 2);
    }
    ctx.fillStyle = 'rgba(210,214,224,0.62)';
    const rows = kind === 'ram' ? 3 : 2;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < 12 + (r % 2) * 3; i++) ctx.fillRect(110 + i * 15, 60 + r * 34, 9 + rand() * 3, 7);
    }
    ctx.beginPath();
    ctx.arc(34, 34, 9, 0, Math.PI * 2);
    ctx.fill();
    if (kind === 'rp1') drawBerry(ctx, 192, 188, 46, '#f1f1f1');
  }
  return texture(c);
}

/**
 * Silkscreen and copper detail for the Pi PCB (300 px per scene unit, board 8.5 x 5.6).
 * Texture top = header side (-z). Only text visible in the reference photo is used:
 * "Raspberry Pi 5" (with the 5 in a rounded box), "HDMI" and the raspberry logo.
 */
function paintPiSilk(headerX) {
  const S = 300, W = 2550, H = 1680;
  const [c, ctx] = canvas(W, H);
  const px = (x) => (x + 4.25) * S;
  const pz = (z) => (z + 2.8) * S;
  const rand = rng(5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // copper traces: a fan from the header toward the chips, plus a few board-wide runs
  ctx.strokeStyle = 'rgba(175,235,185,0.30)';
  ctx.lineWidth = 3.2;
  for (let i = 0; i < 22; i++) {
    const x0 = headerX - 2.3 + i * 0.21;
    const x1 = x0 + (rand() - 0.5) * 1.1;
    ctx.beginPath();
    ctx.moveTo(px(x0), pz(-2.05));
    ctx.lineTo(px(x0), pz(-1.85));
    ctx.lineTo(px(x1), pz(-1.45));
    ctx.lineTo(px(x1), pz(-1.2 + rand() * 0.2));
    ctx.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = -3.4 + rand() * 6.2, z = -1.0 + rand() * 3.0;
    ctx.beginPath();
    ctx.moveTo(px(x), pz(z));
    ctx.lineTo(px(x + (rand() - 0.5) * 0.9), pz(z));
    ctx.lineTo(px(x + (rand() - 0.5) * 0.9), pz(z + (rand() - 0.5) * 0.9));
    ctx.stroke();
  }
  // vias and test pads
  for (let i = 0; i < 160; i++) {
    const x = -4.0 + rand() * 7.2, z = -2.2 + rand() * 4.6;
    ctx.fillStyle = rand() > 0.6 ? 'rgba(222,190,90,0.85)' : 'rgba(205,240,205,0.45)';
    ctx.beginPath();
    ctx.arc(px(x), pz(z), 3.5 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // silkscreen text
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 76px "Segoe UI", system-ui, sans-serif';
  const label = 'Raspberry Pi';
  const cx = px(-0.9), cy = pz(-1.62);
  ctx.textAlign = 'left';
  const wText = ctx.measureText(label + ' ').width;
  ctx.fillText(label, cx - (wText + 62) / 2, cy + 26);
  const bx = cx - (wText + 62) / 2 + wText;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(bx - 4, cy - 34, 66, 72, 12);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillText('5', bx + 29, cy + 26);

  ctx.font = '800 112px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('HDMI', px(-0.55), pz(2.1) + 36);
  drawBerry(ctx, px(-3.15), pz(0.82), 74, 'rgba(255,255,255,0.92)');

  // header outline
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(px(headerX - 2.58), pz(-2.35 - 0.34), 5.16 * S, 0.68 * S);

  // mounting holes (gold ring, dark centre)
  for (const [x, z] of [[-3.9, -2.45], [1.9, -2.45], [-3.9, 2.45], [1.9, 2.45]]) {
    const g = ctx.createRadialGradient(px(x), pz(z), 0.1 * S, px(x), pz(z), 0.23 * S);
    g.addColorStop(0, '#f2d26a');
    g.addColorStop(1, '#c79a2b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px(x), pz(z), 0.23 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#07311d';
    ctx.beginPath();
    ctx.arc(px(x), pz(z), 0.115 * S, 0, Math.PI * 2);
    ctx.fill();
  }
  return texture(c);
}


/** Row letters, column numbers and rail signs on the breadboard (200 px / unit, 8.2 x 5.5). */
function paintBoardLabels(pitch, usedCols) {
  const S = 200, W = 1640, H = 1100;
  const [c, ctx] = canvas(W, H);
  const px = (x) => (x + 4.1) * S;
  const pz = (z) => (z + 2.75) * S;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(70,70,80,0.75)';
  ctx.font = `600 22px ${SANS}`;
  const rows = { a: 1.396, b: 1.142, c: 0.888, d: 0.634, e: 0.38, f: -0.38, g: -0.634, h: -0.888, i: -1.142, j: -1.396 };
  for (const [k, z] of Object.entries(rows)) {
    ctx.fillText(k, px(-3.95), pz(z));
    ctx.fillText(k, px(3.95), pz(z));
  }
  ctx.font = `600 18px ${SANS}`;
  for (let col = 1; col <= 30; col++) {
    if (col !== 1 && col % 5 !== 0 && !usedCols.includes(col)) continue;
    const x = (col - 15.5) * pitch;
    ctx.fillText(String(col), px(x), pz(1.68));
    ctx.fillText(String(col), px(x), pz(-1.68));
  }
  ctx.font = `bold 26px ${SANS}`;
  for (const side of [1, -1]) {
    for (const x of [-3.95, 3.95]) {
      ctx.fillStyle = '#c0392b';
      ctx.fillText('+', px(x), pz(side * 2.154));
      ctx.fillStyle = '#2b62c0';
      ctx.fillText('−', px(x), pz(side * 1.9));
    }
  }
  // coloured rail lines (red outside, blue inside)
  ctx.lineWidth = 3;
  for (const side of [1, -1]) {
    ctx.strokeStyle = 'rgba(192,57,43,0.7)';
    ctx.beginPath();
    ctx.moveTo(px(-3.6), pz(side * 2.37));
    ctx.lineTo(px(3.6), pz(side * 2.37));
    ctx.stroke();
  }
  return texture(c);
}

function paintGlow() {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/* ------------------------------------------------------------------ Left page (generic, from shared content) */
const LP = { W: 1100, H: 1400, M: 88, TW: 924, BOTTOM: 1345 };
const TEX_SCALE = 2; // the left page is painted at 2x so it stays sharp in the front view

function wrapLines(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Lays the content out top to bottom. With draw=false it only measures. Returns the final y. */
function flowLeftPage(ctx, content, images, s, draw) {
  const { W, M, TW } = LP;
  // slightly emboldened body text: thin strokes survive the texture being shown smaller than it was painted
  const text = (s, x, y) => {
    ctx.fillText(s, x, y);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
  };
  let y = 125;
  ctx.textAlign = 'left';

  if (draw) {
    ctx.fillStyle = ACCENT;
    ctx.font = `700 24px ${SANS}`;
    ctx.letterSpacing = '5px';
    ctx.fillText(content.eyebrow, M, y);
    ctx.letterSpacing = '0px';
  }
  const ts = content.title.length > 1 ? 74 : 96;
  y += ts + 4;
  content.title.forEach((line, i) => {
    if (i) y += ts + 3;
    if (draw) {
      ctx.fillStyle = INK;
      ctx.font = `bold ${ts}px ${SERIF}`;
      ctx.fillText(line, M, y);
    }
  });
  y += 28;
  if (draw) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(M, y, 140, 5);
  }
  y += 66;

  for (const b of content.blocks) {
    if (b.type === 'p') {
      ctx.font = `${30 * s}px ${SERIF}`;
      const lh = 42 * s;
      for (const l of wrapLines(ctx, b.text, TW)) {
        if (draw) {
          ctx.fillStyle = INK;
          text(l, M, y);
        }
        y += lh;
      }
      y += 18 * s;
    } else if (b.type === 'h') {
      y += 22 * s;
      if (draw) {
        ctx.fillStyle = ACCENT;
        ctx.font = `700 24px ${SANS}`;
        ctx.letterSpacing = '4px';
        ctx.fillText(b.text, M, y);
        ctx.letterSpacing = '0px';
      }
      y += 42 * s;
    } else if (b.type === 'bullets') {
      ctx.font = `${30 * s}px ${SERIF}`;
      for (const item of b.items) {
        if (draw) {
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(M + 8, y - 10 * s, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = INK;
          text(item, M + 34, y);
        }
        y += 42 * s;
      }
      y += 6 * s;
    } else if (b.type === 'numbered') {
      b.items.forEach((item, i) => {
        ctx.font = `${27 * s}px ${SERIF}`;
        if (draw) {
          ctx.font = `bold ${27 * s}px ${SERIF}`;
          ctx.fillStyle = ACCENT;
          ctx.fillText(`${i + 1}.`, M, y);
          ctx.font = `${27 * s}px ${SERIF}`;
          ctx.fillStyle = INK;
        }
        for (const l of wrapLines(ctx, item, TW - 40)) {
          if (draw) text(l, M + 40, y);
          y += 36 * s;
        }
      });
      y += 6 * s;
    } else if (b.type === 'cards') {
      const cardW = (TW - 40) / 2;
      ctx.font = `${23 * s}px ${SERIF}`;
      const lens = b.items.map((c) => wrapLines(ctx, c.body, cardW - 40));
      const cardH = Math.max(...lens.map((l) => 74 * s + l.length * 31 * s + 18 * s));
      b.items.forEach((c, i) => {
        if (!draw) return;
        const x = M + i * (cardW + 40);
        const color = c.tone === 'teal' ? '#1f6f78' : ACCENT;
        ctx.fillStyle = c.tone === 'teal' ? 'rgba(31,111,120,0.10)' : 'rgba(181,67,42,0.10)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(x, y, cardW, cardH, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = `700 21px ${SANS}`;
        ctx.letterSpacing = '3px';
        ctx.fillText(c.head, x + 20, y + 36 * s);
        ctx.letterSpacing = '0px';
        ctx.fillStyle = INK;
        ctx.font = `${23 * s}px ${SERIF}`;
        lens[i].forEach((l, n) => text(l, x + 20, y + 74 * s + n * 31 * s));
      });
      y += cardH + 34 * s;
    } else if (b.type === 'svg') {
      const w = TW * Math.max(0.78, s);
      const h = (w * b.h) / b.w;
      y += 4;
      if (draw && images.get(b)) ctx.drawImage(images.get(b), M + (TW - w) / 2, y, w, h);
      y += h + 18;
    }
  }
  if (draw) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(43,39,64,0.55)';
    ctx.font = `italic 26px ${SERIF}`;
    ctx.fillText(`— ${content.pageNumber} —`, W / 2, 1372);
  }
  return y;
}

/** Test helper: height needed by a page's content at each text scale (the page shrinks the text until it fits). */
export function measureLeftPage(content) {
  const [, ctx] = canvas(8, 8);
  const images = new Map();
  return [1, 0.94, 0.88, 0.82, 0.76, 0.7].map((s) => [s, Math.round(flowLeftPage(ctx, content, images, s, false))]);
}

function paintLeftPage(ctx, content, images) {
  const { W, H } = LP;
  ctx.setTransform(TEX_SCALE, 0, 0, TEX_SCALE, 0, 0); // draw in 1100 x 1400 page units on a 2x canvas
  ctx.clearRect(0, 0, W, H);
  paper(ctx, W, H);
  const sh = ctx.createLinearGradient(W - 140, 0, W, 0);
  sh.addColorStop(0, 'rgba(90,60,20,0)');
  sh.addColorStop(1, 'rgba(90,60,20,0.22)');
  ctx.fillStyle = sh;
  ctx.fillRect(W - 140, 0, 140, H);
  // shrink the text a little if a lesson has more content than fits
  for (const s of [1, 0.94, 0.88, 0.82, 0.76, 0.7]) {
    if (flowLeftPage(ctx, content, images, s, false) <= LP.BOTTOM || s === 0.7) {
      flowLeftPage(ctx, content, images, s, true);
      break;
    }
  }
}

/**
 * Left page of a lesson, painted from the shared page content (src/pageContent.js).
 * Schematics are SVG: they are rasterised into the texture as soon as they load.
 */
export function leftPageTexture(content) {
  const [c, ctx] = canvas(LP.W * TEX_SCALE, LP.H * TEX_SCALE);
  const tex = texture(c);
  const images = new Map();
  const render = () => {
    paintLeftPage(ctx, content, images);
    tex.needsUpdate = true;
  };
  render();
  for (const b of content.blocks) {
    if (b.type !== 'svg') continue;
    const img = new Image();
    img.onload = () => {
      images.set(b, img);
      render();
    };
    const svg = b.svg.replace('<svg ', `<svg width="${b.w * 2}" height="${b.h * 2}" `);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  return tex;
}

/* ------------------------------------------------------------------ shared, cached textures */
// Lessons 1 and 3 (and 2) each build their own copy of the circuit, but the big canvases are identical:
// build each one once and share it between all the materials that use it.
const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};
export const chipTexture = (kind) => once(`chip:${kind}`, () => paintChip(kind));
export const piSilkTexture = (headerX) => once(`silk:${headerX}`, () => paintPiSilk(headerX));
export const boardLabelTexture = (pitch, usedCols = [7, 8, 12]) => once(`labels:${pitch}:${usedCols.join(',')}`, () => paintBoardLabels(pitch, usedCols));
export const glowTexture = () => once('glow', paintGlow);