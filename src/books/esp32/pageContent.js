/*
 * Left page of ESP32 chapter 1 (same block types as src/pageContent.js). The 3D page texture and the HTML
 * "Read page" view are both built from this object.
 */
const INK = '#2b2740';
const ACCENT = '#b5432a';
const SANS = "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";
const svgWrap = (w, h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" font-family="${SANS}">${body}</svg>`;

/* zigzag resistor from (x, y), length 80 */
const zig = (x, y) => `M${x} ${y} L${x + 10} ${y} L${x + 18} ${y - 18} L${x + 34} ${y + 18} L${x + 50} ${y - 18} L${x + 66} ${y + 18} L${x + 74} ${y} L${x + 84} ${y}`;
const gnd = (x, y) => `M${x} ${y} V${y + 22} M${x - 22} ${y + 22} H${x + 22} M${x - 14} ${y + 32} H${x + 14} M${x - 6} ${y + 42} H${x + 6}`;

const schematic = svgWrap(860, 440, `
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- reed switch branch -->
    <path d="M150 50 H330"/>
    <path d="M330 50 L452 18"/>
    <path d="M470 50 H600 V70"/><path d="${gnd(600, 70)}"/>
    <!-- LED branch -->
    <path d="M150 150 H240"/><path d="${zig(240, 150)}"/>
    <path d="M324 150 H370 M370 126 V174 L412 150 Z M412 126 V174 M412 150 H470 V176"/><path d="${gnd(470, 176)}"/>
    <!-- buzzer branch -->
    <path d="M150 340 H240"/><path d="${zig(240, 340)}"/>
    <path d="M324 340 H640"/>
    <path d="M640 310 V370 M640 322 L700 296 V258 M640 358 L700 384 V400"/>
    <circle cx="700" cy="228" r="30"/>
    <path d="M700 198 V176 M700 258 V296"/>
    <path d="${gnd(700, 400)}" />
  </g>
  <g fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M430 118 L452 92 M441 92 H452 V103"/><path d="M452 118 L474 92 M463 92 H474 V103"/>
  </g>
  <g fill="${INK}">
    <circle cx="150" cy="50" r="7"/><circle cx="150" cy="150" r="7"/><circle cx="150" cy="340" r="7"/>
    <circle cx="330" cy="50" r="6"/><circle cx="470" cy="50" r="6"/><circle cx="640" cy="340" r="5"/>
  </g>
  <g fill="${INK}" font-size="20" font-weight="600">
    <text x="138" y="42" text-anchor="end">IO27</text>
    <text x="138" y="142" text-anchor="end">IO26</text>
    <text x="138" y="332" text-anchor="end">IO25</text>
    <text x="400" y="86" text-anchor="middle">reed switch (door sensor)</text>
    <text x="282" y="196" text-anchor="middle">330 Ω</text>
    <text x="392" y="200" text-anchor="middle">LED</text>
    <text x="282" y="386" text-anchor="middle">1 kΩ</text>
    <text x="622" y="392" text-anchor="end">2N3904</text>
    <text x="742" y="234">buzzer</text>
    <text x="700" y="166" text-anchor="middle">5V</text>
    <text x="600" y="132" text-anchor="middle">GND</text>
    <text x="470" y="236" text-anchor="middle">GND</text>
    <text x="700" y="456" text-anchor="middle" font-size="18">GND</text>
  </g>
  <g fill="${ACCENT}" font-size="17" font-weight="700"><text x="474" y="18">magnet closes it</text></g>
  <g fill="${INK}" font-size="17" opacity="0.7"><text x="150" y="26" text-anchor="start">pull-up on</text><text x="700" y="232" text-anchor="middle" font-size="22" font-weight="700">+</text></g>`, 'Schematic: IO27 to a reed switch to ground; IO26 through 330 ohms to an LED to ground; IO25 through 1 kilohm to a 2N3904 that switches a buzzer between 5 volts and ground');

const statesFigure = svgWrap(860, 168, `
  <defs><marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="12" y="38" width="210" height="72" rx="14" fill="#e9e1c8"/>
    <rect x="325" y="38" width="210" height="72" rx="14" fill="#f4dfa6"/>
    <rect x="638" y="38" width="210" height="72" rx="14" fill="#f3b7a8"/>
    <path d="M224 66 H323" marker-end="url(#ar)"/><path d="M537 66 H636" marker-end="url(#ar)"/>
    <path d="M743 112 V146 H117 V112" marker-end="url(#ar)"/>
    <path d="M430 112 V146"/>
  </g>
  <g fill="${INK}" font-size="21" font-weight="700" text-anchor="middle">
    <text x="117" y="68">CLOSED</text><text x="430" y="68">OPEN</text><text x="743" y="68">ALARM</text>
  </g>
  <g fill="${INK}" font-size="16" text-anchor="middle">
    <text x="117" y="94">LED and buzzer off</text><text x="430" y="94">counting time</text><text x="743" y="94">LED and buzzer beep</text>
    <text x="273" y="56">door opens</text><text x="586" y="56">30 s open</text>
    <text x="430" y="164">door closes (from any state)</text>
  </g>`, 'States: closed, open (counting) and alarm. The door opening moves closed to open, thirty seconds moves open to alarm, and the door closing goes back to closed from any state');

export const ESP32_DOOR_PAGE = {
  eyebrow: 'CHAPTER 1  ·  INPUT, TIME AND OUTPUT',
  title: ['Open Door Alarm'],
  pageNumber: 1,
  blocks: [
    { type: 'p', text: 'A magnet on the door and a reed switch on the frame tell the ESP32 whether the door is closed. If it stays open for 30 seconds, an LED and a buzzer beep until the door closes.' },
    { type: 'h', text: 'YOU WILL NEED' },
    { type: 'bullets', items: ['ESP32-DevKitC (ESP32-WROOM-32E), USB cable', 'Half-size breadboard, jumper wires', 'Normally open reed switch and a magnet', 'Red LED, 330 Ω, 1 kΩ, 2N3904 transistor', '5 V magnetic buzzer (built-in driver)', 'Cardboard box with a lid, for the home build'] },
    { type: 'h', text: 'SCHEMATIC (GPIO NAMES)' },
    { type: 'svg', svg: schematic, w: 860, h: 440 },
    { type: 'h', text: 'STATES' },
    { type: 'svg', svg: statesFigure, w: 860, h: 168 },
    { type: 'p', text: 'Low voltage only, from USB. Do not connect this to mains power. A breadboard is for learning, not for a permanent or damp installation.' },
  ],
};
