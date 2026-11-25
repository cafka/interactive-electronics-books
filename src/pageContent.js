/*
 * Single source of truth for the written content of each lesson's LEFT page.
 * The same data feeds (1) the canvas texture on the 3D book page (textures.js) and
 * (2) the selectable HTML "Read page" view (buildReader below), so they can never drift apart.
 *
 * Block types: p, h (small heading), bullets, numbered, cards, svg.
 */

const INK = '#2b2740';
const ACCENT = '#b5432a';
const SANS = "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";

const svgWrap = (w, h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" font-family="${SANS}">${body}</svg>`;

/* ---------- Lesson 1 schematic: GPIO17 -> 330 ohm -> LED -> GND ---------- */
const schematic1 = svgWrap(860, 230, `
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 100 H200 L212 78 L230 122 L248 78 L266 122 L284 78 L302 122 L330 100 H470"/>
    <path d="M470 66 V134 L526 100 Z"/>
    <path d="M526 66 V134 M526 100 H760 V150"/>
    <path d="M730 150 H790 M739 162 H781 M748 174 H772"/>
  </g>
  <g fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M486 54 L510 26 M498 26 H510 V38"/>
    <path d="M510 54 L534 26 M522 26 H534 V38"/>
  </g>
  <g fill="${INK}" font-size="22" font-weight="600" text-anchor="middle">
    <text x="62" y="78">GPIO17</text><text x="270" y="162">330 Ω</text>
    <text x="498" y="168">LED</text><text x="760" y="206">GND</text>
  </g>`, 'Schematic: GPIO17 to a 330 ohm resistor to an LED to ground');

/* ---------- Lesson 2 schematic: pull-up input with button + LED output ---------- */
const schematic2 = svgWrap(860, 285, `
  <rect x="2" y="10" width="298" height="228" rx="12" fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="9 7"/>
  <g fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">
    <path d="M110 46 V58 L119 62 L101 69 L119 76 L101 83 L119 90 L101 97 V108 V120 H300"/>
    <path d="M40 160 V200 L80 180 Z"/>
    <path d="M80 180 H300"/>
    <path d="M308 120 H520 M640 120 H740 M520 120 L628 90 M580 84 V62 M558 62 H602"/>
    <path d="M308 190 H470 L482 172 L499 208 L516 172 L533 208 L550 172 L567 208 L590 190 H640"/>
    <path d="M640 160 V220 L690 190 Z"/>
    <path d="M690 160 V220 M690 190 H740"/>
    <path d="M740 120 V240"/>
    <path d="M714 240 H766 M722 251 H758 M730 262 H750"/>
  </g>
  <g fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M654 150 L676 126 M666 126 H676 V136"/>
    <path d="M676 150 L698 126 M688 126 H698 V136"/>
  </g>
  <g fill="${INK}">
    <circle cx="110" cy="120" r="5"/><circle cx="740" cy="120" r="5"/><circle cx="740" cy="190" r="5"/>
    <circle cx="520" cy="120" r="6"/><circle cx="640" cy="120" r="6"/>
  </g>
  <g fill="#d8b04a" stroke="${INK}" stroke-width="2.5"><circle cx="300" cy="120" r="8"/><circle cx="300" cy="190" r="8"/></g>
  <g fill="${INK}" font-size="19" font-weight="600">
    <text x="110" y="34" text-anchor="middle">3.3 V</text>
    <text x="318" y="106">GPIO27 · pin 13</text>
    <text x="318" y="176">GPIO17 · pin 11</text>
    <text x="580" y="152" text-anchor="middle">push button</text>
    <text x="530" y="238" text-anchor="middle">330 Ω</text>
    <text x="665" y="246" text-anchor="middle">LED</text>
    <text x="774" y="268">GND</text>
  </g>
  <g fill="${INK}" font-size="17">
    <text x="128" y="86">internal pull-up</text>
    <text x="88" y="214">program output</text>
  </g>
  <text x="14" y="232" fill="${INK}" font-size="18" font-style="italic" font-family="Georgia, serif">Raspberry Pi 5</text>`,
'Schematic: GPIO27 input with internal pull-up and a push button to ground, and GPIO17 output through a resistor and LED to ground');
/* ---------- Lesson 3 schematic: GPIO17 (PWM) -> 330 ohm -> LED -> GND (same circuit as lesson 1) ---------- */
const schematic3 = svgWrap(860, 214, `
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 100 H200 L212 78 L230 122 L248 78 L266 122 L284 78 L302 122 L330 100 H470"/>
    <path d="M470 66 V134 L526 100 Z"/>
    <path d="M526 66 V134 M526 100 H760 V150"/>
    <path d="M730 150 H790 M739 162 H781 M748 174 H772"/>
  </g>
  <path d="M14 46 V26 H44 V46 H64 V26 H94 V46 H114 V26 H144 V46" fill="none" stroke="#c98a12" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M486 54 L510 26 M498 26 H510 V38"/>
    <path d="M510 54 L534 26 M522 26 H534 V38"/>
  </g>
  <g fill="${INK}" font-size="22" font-weight="600" text-anchor="middle">
    <text x="82" y="86">GPIO17 (PWM)</text><text x="270" y="162">330 Ω</text>
    <text x="498" y="168">LED</text><text x="760" y="206">GND</text>
  </g>`, 'Schematic: GPIO17 sending a PWM pulse train through a 330 ohm resistor and an LED to ground');

/* ---------- Duty cycle strip: 0, 25, 50, 75 and 100 % ---------- */
const dutyStrip = (() => {
  const duties = [0, 0.25, 0.5, 0.75, 1];
  const names = ['LED off', 'dim', 'medium', 'bright', 'full brightness'];
  const notes = ['always LOW', 'HIGH ¼ of the time', 'HIGH half the time', 'HIGH ¾ of the time', 'always HIGH'];
  const P = 75, HI = 62, LO = 118;
  let body = '';
  duties.forEach((d, k) => {
    const x0 = 10 + k * 175;
    let path = `M${x0} ${LO}`;
    for (let p = 0; p < 2; p++) {
      const s = x0 + p * P;
      if (d === 0) path += ` H${s + P}`;
      else if (d === 1) path += p === 0 ? ` V${HI} H${s + P}` : ` H${s + P}`;
      else path += ` V${HI} H${s + d * P} V${LO} H${s + P}`;
      if (d > 0 && d < 1) body += `<rect x="${s}" y="${HI}" width="${d * P}" height="${LO - HI}" fill="${ACCENT}" fill-opacity="0.16"/>`;
    }
    if (d === 1) body += `<rect x="${x0}" y="${HI}" width="${2 * P}" height="${LO - HI}" fill="${ACCENT}" fill-opacity="0.16"/>`;
    body += `<path d="${path}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`;
    body += `<path d="M${x0} ${LO + 6} H${x0 + 2 * P}" stroke="${INK}" stroke-opacity="0.25" stroke-width="2"/>`;
    body += `<text x="${x0 + P}" y="40" text-anchor="middle" font-size="28" font-weight="700" fill="${ACCENT}">${Math.round(d * 100)} %</text>`;
    body += `<text x="${x0 + P}" y="148" text-anchor="middle" font-size="21" font-weight="700" fill="${INK}">${names[k]}</text>`;
    body += `<text x="${x0 + P}" y="170" text-anchor="middle" font-size="18" fill="${INK}" fill-opacity="0.95">${notes[k]}</text>`;
  });
  return svgWrap(860, 186, body, 'Duty cycle waveforms for 0, 25, 50, 75 and 100 percent');
})();
/* ---------- Lesson 4 schematic: three LED branches + a push button with the internal pull-up ---------- */
const schematic4 = (() => {
  const rows = [
    { y: 52, pin: 'GPIO17 · pin 11', name: 'RED LED', c: '#d6453a' },
    { y: 122, pin: 'GPIO27 · pin 13', name: 'YELLOW LED', c: '#c9a000' },
    { y: 192, pin: 'GPIO22 · pin 15', name: 'GREEN LED', c: '#2e9e55' },
  ];
  let b = `<rect x="2" y="8" width="230" height="314" rx="12" fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="9 7"/>`;
  for (const r of rows) {
    const y = r.y;
    b += `<g fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">`
      + `<path d="M232 ${y} H410 L420 ${y - 16} L436 ${y + 16} L452 ${y - 16} L468 ${y + 16} L484 ${y - 16} L496 ${y} H560"/>`
      + `<path d="M560 ${y - 26} V${y + 26} L610 ${y} Z" fill="${r.c}" fill-opacity="0.22" stroke="${r.c}"/>`
      + `<path d="M610 ${y - 26} V${y + 26} M610 ${y} H720" stroke="${r.c}"/></g>`
      + `<g fill="none" stroke="${r.c}" stroke-width="2.6" stroke-linecap="round"><path d="M616 ${y + 8} L630 ${y + 22} M622 ${y + 22} H630 V${y + 14}"/><path d="M634 ${y + 8} L648 ${y + 22} M640 ${y + 22} H648 V${y + 14}"/></g>`
      + `<circle cx="232" cy="${y}" r="8" fill="#d8b04a" stroke="${INK}" stroke-width="2.5"/><circle cx="720" cy="${y}" r="5" fill="${INK}"/>`
      + `<text x="244" y="${y - 12}" font-size="19" font-weight="600" fill="${INK}">${r.pin}</text>`
      + `<text x="453" y="${y - 28}" font-size="18" font-weight="600" text-anchor="middle" fill="${INK}">330 Ω</text>`
      + `<text x="668" y="${y - 12}" font-size="17" font-weight="700" text-anchor="middle" fill="${r.c}">${r.name}</text>`;
  }
  const y = 285;
  b += `<g fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">`
    + `<path d="M140 ${y} H440 M540 ${y} H720 M440 ${y} L528 ${y - 26} M484 ${y - 20} V${y - 46} M464 ${y - 46} H504"/>`
    + `<path d="M140 226 V236 L148 241 L132 249 L148 257 L132 265 L140 270 V${y}"/>`
    + `<path d="M720 52 V${y + 12} M694 ${y + 12} H746 M702 ${y + 22} H738 M710 ${y + 32} H730"/></g>`
    + `<circle cx="232" cy="${y}" r="8" fill="#d8b04a" stroke="${INK}" stroke-width="2.5"/>`
    + `<circle cx="400" cy="${y}" r="6" fill="${INK}"/><circle cx="500" cy="${y}" r="6" fill="${INK}"/><circle cx="140" cy="${y}" r="5" fill="${INK}"/><circle cx="720" cy="${y}" r="5" fill="${INK}"/>`
    + `<text x="244" y="${y - 12}" font-size="19" font-weight="600" fill="${INK}">GPIO23 · pin 16</text>`
    + `<text x="490" y="${y + 32}" font-size="18" font-weight="600" text-anchor="middle" fill="${INK}">push button</text>`
    + `<text x="140" y="214" font-size="18" font-weight="600" text-anchor="middle" fill="${INK}">3.3 V</text>`
    + `<text x="154" y="252" font-size="16" fill="${INK}">pull-up</text>`
    + `<text x="762" y="${y + 18}" font-size="19" font-weight="600" fill="${INK}">GND</text>`
    + `<text x="14" y="312" font-size="18" font-style="italic" font-family="Georgia, serif" fill="${INK}">Raspberry Pi 5</text>`;
  return svgWrap(860, 330, b, 'Schematic: three LEDs, each with its own 330 ohm resistor, on GPIO17, GPIO27 and GPIO22, and a push button on GPIO23 with the internal pull-up, all returning to ground');
})();

/* ---------- Lesson 4 states: GREEN -> YELLOW -> RED -> GREEN ---------- */
const statesFigure = (() => {
  const node = (x, fill, text, dark) => `<circle cx="${x}" cy="62" r="44" fill="${fill}"/><text x="${x}" y="69" text-anchor="middle" font-size="21" font-weight="700" fill="${dark ? '#2b2210' : '#fff'}">${text}</text>`;
  const arrow = (x1, x2, top, bottom) => `<path d="M${x1} 62 H${x2 - 12}" stroke="${INK}" stroke-width="3.5" fill="none"/><path d="M${x2} 62 l-14 -8 v16 z" fill="${INK}"/>`
    + `<text x="${(x1 + x2) / 2}" y="44" text-anchor="middle" font-size="19" font-weight="600" fill="${INK}">${top}</text>`
    + `<text x="${(x1 + x2) / 2}" y="88" text-anchor="middle" font-size="17" fill="${INK}" fill-opacity="0.85">${bottom}</text>`;
  const body = node(80, '#2e9e55', 'GREEN') + node(430, '#e2b623', 'YELLOW', true) + node(780, '#d6453a', 'RED')
    + arrow(130, 380, 'request + 4 s', 'minimum green')
    + arrow(480, 730, '2 s', 'wait')
    + `<path d="M780 108 V134 H80 V108" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M80 106 l-8 14 h16 z" fill="${INK}"/>`
    + `<text x="430" y="128" text-anchor="middle" font-size="18" font-weight="600" fill="${INK}" stroke="#f3ecd6" stroke-width="7" paint-order="stroke">5 s: pedestrians cross, request served</text>`;
  return svgWrap(860, 146, body, 'State diagram: green, after a request and four seconds yellow, after two seconds red, after five seconds back to green');
})();
export const PAGE_CONTENT = {
  led: {
    eyebrow: 'CHAPTER 1  ·  GPIO OUTPUT',
    title: ['Light an LED'],
    pageNumber: 1,
    blocks: [
      { type: 'p', text: 'The Raspberry Pi 5 has a 40-pin GPIO header. Software can set each pin to 3.3 V (HIGH) or 0 V (LOW). In this lesson, GPIO17 switches an LED on and off.' },
      { type: 'h', text: 'YOU WILL NEED' },
      { type: 'bullets', items: ['Raspberry Pi 5', 'Half-size breadboard', '5 mm red LED', '330 Ω resistor (orange, orange, brown)', '2 jumper wires (female to male)'] },
      { type: 'h', text: 'SCHEMATIC' },
      { type: 'svg', svg: schematic1, w: 860, h: 230 },
      { type: 'h', text: 'WIRING' },
      {
        type: 'numbered',
        items: [
          'Pin 11 (GPIO17) to breadboard column 12.',
          '330 Ω resistor from column 12 to column 8.',
          'LED long leg (anode, +) in column 8, short leg (cathode, −) in column 7.',
          'Column 7 to pin 6 (GND).',
        ],
      },
    ],
  },

  button: {
    eyebrow: 'CHAPTER 2  ·  GPIO INPUT',
    title: ['Control an LED', 'with a Button'],
    pageNumber: 3,
    blocks: [
      { type: 'p', text: 'In Lesson 1 a pin sent a level out: an output. Now a pin must read a level: an input. GPIO27 reads the button. The program decides what that reading means and drives the LED through GPIO17.' },
      {
        type: 'cards',
        items: [
          { head: 'OUTPUT · GPIO17', body: 'The program writes a level (HIGH or LOW) to drive the LED.', tone: 'accent' },
          { head: 'INPUT · GPIO27', body: 'The program reads a level. Here, LOW means the button connects the pin to GND.', tone: 'teal' },
        ],
      },
      { type: 'h', text: 'SCHEMATIC' },
      { type: 'svg', svg: schematic2, w: 860, h: 285 },
      { type: 'h', text: 'WIRING' },
      {
        type: 'numbered',
        items: [
          'GPIO17 (pin 11) → column 12 → 330 Ω → column 8 (LED anode, long leg).',
          'LED cathode (short leg) in column 7 → GND (pin 6).',
          'Button straddles the center channel, legs in columns 24 and 27, rows e and f. GPIO27 (pin 13) → column 24, row a.',
          'GND (pin 14) → column 24, row i.',
        ],
      },
    ],
  },
  pwm: {
    eyebrow: 'CHAPTER 3  ·  PWM',
    title: ['Control LED', 'Brightness with PWM'],
    pageNumber: 5,
    blocks: [
      { type: 'p', text: 'PWM dims an LED by switching GPIO17 between LOW and HIGH 100 times per second. The duty cycle is the share of each period spent HIGH.' },
      { type: 'svg', svg: dutyStrip, w: 860, h: 186 },
      { type: 'p', text: 'The pin is only ever 0 V or 3.3 V, never in between. Each pulse is a full 3.3 V, so the 330 Ω resistor must still limit the current.' },
      { type: 'h', text: 'YOU WILL NEED' },
      { type: 'bullets', items: ['Raspberry Pi 5, breadboard and 2 jumper wires', '5 mm red LED and 330 Ω resistor (orange, orange, brown)'] },
      { type: 'h', text: 'SCHEMATIC' },
      { type: 'svg', svg: schematic3, w: 860, h: 214 },
      { type: 'h', text: 'WIRING (SAME AS LESSON 1)' },
      {
        type: 'numbered',
        items: [
          'Pin 11 (GPIO17) → column 12 → 330 Ω resistor → column 8.',
          'LED long leg (anode, +) in column 8, short leg (cathode, −) in column 7.',
          'Column 7 → pin 6 (GND).',
        ],
      },
    ],
  },
  traffic: {
    eyebrow: 'CHAPTER 4  ·  STATE MACHINE',
    title: ['Traffic Light with', 'Pedestrian Button'],
    pageNumber: 7,
    blocks: [
      { type: 'p', text: 'Three outputs and one input. The program remembers a state (green, yellow or red). A button press only registers a request; the lights change when the rules allow it.' },
      { type: 'h', text: 'YOU WILL NEED' },
      { type: 'bullets', items: ['Raspberry Pi 5, breadboard and jumper wires', 'Red, yellow and green LEDs, one 330 Ω resistor each', 'One 4-leg push button'] },
      { type: 'h', text: 'SCHEMATIC (BCM GPIO NUMBER · PHYSICAL PIN)' },
      { type: 'svg', svg: schematic4, w: 860, h: 330 },
      { type: 'h', text: 'STATES' },
      { type: 'svg', svg: statesFigure, w: 860, h: 146 },
    ],
  },
};

/* ------------------------------------------------------------------ HTML "Read page" view */
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** Builds the selectable HTML version of a left page from the same content the 3D texture uses. */
export function buildReader(content) {
  const page = el('article', 'reader-page');
  page.appendChild(el('p', 'r-eyebrow', content.eyebrow.replace(/\s+/g, ' ')));
  const h = el('h2', 'r-title');
  content.title.forEach((line, i) => {
    if (i) h.appendChild(document.createElement('br'));
    h.appendChild(document.createTextNode(line));
  });
  page.appendChild(h);
  page.appendChild(el('hr', 'r-rule'));

  for (const b of content.blocks) {
    if (b.type === 'p') page.appendChild(el('p', 'r-p', b.text));
    else if (b.type === 'h') page.appendChild(el('h3', 'r-h', b.text));
    else if (b.type === 'bullets' || b.type === 'numbered') {
      const list = el(b.type === 'bullets' ? 'ul' : 'ol', `r-list r-${b.type}`);
      b.items.forEach((t) => list.appendChild(el('li', '', t)));
      page.appendChild(list);
    } else if (b.type === 'cards') {
      const wrap = el('div', 'r-cards');
      b.items.forEach((c) => {
        const card = el('div', `r-card r-${c.tone}`);
        card.append(el('h4', '', c.head), el('p', '', c.body));
        wrap.appendChild(card);
      });
      page.appendChild(wrap);
    } else if (b.type === 'svg') {
      const fig = el('figure', 'r-fig');
      const scroller = el('div', 'r-fig-scroll');
      scroller.innerHTML = b.svg;
      fig.appendChild(scroller);
      fig.appendChild(el('figcaption', 'r-figcap', 'Swipe sideways to see the whole schematic.'));
      page.appendChild(fig);
    }
  }
  page.appendChild(el('p', 'r-foot', `— ${content.pageNumber} —`));
  return page;
}
