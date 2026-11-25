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
    <path d="M640 310 V370 M640 322 L700 296 V258 M640 358 L700 384 V392"/>
    <circle cx="700" cy="228" r="30"/>
    <path d="M700 198 V176 M700 258 V296"/>
    <path d="${gnd(700, 392)}" />
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
    <text x="730" y="424" font-size="18">GND</text>
  </g>
  <g fill="${ACCENT}" font-size="17" font-weight="700"><text x="474" y="18">magnet closes it</text></g>
  <g fill="${INK}" font-size="17" opacity="0.7"><text x="150" y="26" text-anchor="start">pull-up on</text><text x="700" y="232" text-anchor="middle" font-size="22" font-weight="700">+</text></g>`, 'Schematic: IO27 to a reed switch to ground; IO26 through 330 ohms to an LED to ground; IO25 through 1 kilohm to a 2N3904 that switches a buzzer between 5 volts and ground');

const statesFigure = svgWrap(860, 168, `
  <defs><marker id="ar" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="${INK}"/></marker></defs>
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

/* ------------------------------------------------------------------ chapter 2: smart plant watering */
const vres = (x, y, w = 18, h = 40) => `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="3"/>`;

/*
 * Schematic, same nets as src/books/esp32/plantParts.js (NETS) and the breadboard in plantScene.js:
 *   3V3 -> sensor VCC, sensor GND -> GND, sensor AOUT -> IO34, 100 kohm IO34 -> GND
 *   IO25 -> 100 ohm -> gate; 10 kohm gate -> GND; source -> GND; drain -> pump "-"; pump "+" -> 5V
 *   1N5819 across the pump: anode on the drain, cathode (bar) on 5V; 470 uF from 5V to GND
 *   IO26 -> 330 ohm -> LED -> GND;  IO27 -> button -> GND
 * Layout rule: no label sits on a wire, every wire ends on a node dot or a part, nothing leaves the 860 x 500 box.
 */
const plantSchematic = svgWrap(860, 500, `
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- soil sensor: VCC from 3V3, GND to ground, AOUT to IO34 with a 100 kohm pull-down -->
    <rect x="120" y="14" width="190" height="82" rx="12"/>
    <path d="M60 40 H120"/>
    <path d="M215 96 V104"/><path d="${gnd(215, 104)}"/>
    <path d="M310 55 H500"/>
    <path d="M420 55 V66"/>${vres(420, 66, 18, 34)}<path d="M420 100 V108"/><path d="${gnd(420, 108)}"/>
    <!-- 5 V rail from the board's 5V pin -->
    <path d="M410 168 H720"/>
    <!-- pump between 5V and the drain -->
    <path d="M470 168 V184"/><circle cx="470" cy="206" r="22"/><path d="M470 228 V262"/>
    <!-- flyback diode across the pump: cathode bar at the top (5V), anode at the bottom (drain) -->
    <path d="M550 168 V196"/><path d="M534 196 H566"/><path d="M534 228 H566 L550 196 Z"/><path d="M550 228 V262 H470"/>
    <!-- 470 uF electrolytic from 5V to GND -->
    <path d="M720 168 V200"/><path d="M700 200 H740"/><path d="M700 214 Q720 206 740 214"/><path d="M720 212 V248"/><path d="${gnd(720, 248)}"/>
    <!-- N-channel MOSFET: drain on top, source at the bottom, body joined to the source -->
    <path d="M470 262 V286 H444"/>
    <path d="M440 278 V294 M440 300 V316 M440 322 V338" stroke-width="5"/>
    <path d="M446 308 H470 V330"/><path d="M444 330 H470"/><path d="M470 330 V346"/><path d="${gnd(470, 346)}"/>
    <path d="M428 280 V336"/>
    <!-- gate: IO25 -> 100 ohm -> gate, 10 kohm to GND -->
    <path d="M60 330 H110"/><path d="${zig(110, 330)}"/><path d="M194 330 H428"/>
    <path d="M360 330 V342"/>${vres(360, 342, 18, 34)}<path d="M360 376 V382"/><path d="${gnd(360, 382)}"/>
    <!-- status LED -->
    <path d="M60 446 H110"/><path d="${zig(110, 446)}"/><path d="M194 446 H240"/><path d="M240 428 V464 L272 446 Z"/><path d="M272 428 V464"/><path d="M272 446 H330 V452"/><path d="${gnd(330, 452)}"/>
    <!-- button to GND -->
    <path d="M480 446 H554"/><circle cx="560" cy="446" r="6"/><circle cx="640" cy="446" r="6"/><path d="M563 442 L630 420"/><path d="M646 446 H700 V452"/><path d="${gnd(700, 452)}"/>
  </g>
  <path d="M446 308 l12 -6 v12 z" fill="${INK}"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M254 420 L268 404 M260 404 H268 V412"/><path d="M270 422 L284 406 M276 406 H284 V414"/>
  </g>
  <g fill="${INK}">
    <circle cx="60" cy="40" r="7"/><circle cx="500" cy="55" r="7"/><circle cx="420" cy="55" r="5"/>
    <circle cx="410" cy="168" r="7"/><circle cx="470" cy="168" r="5"/><circle cx="550" cy="168" r="5"/><circle cx="470" cy="262" r="5"/>
    <circle cx="60" cy="330" r="7"/><circle cx="360" cy="330" r="5"/><circle cx="60" cy="446" r="7"/><circle cx="480" cy="446" r="7"/>
  </g>
  <g fill="${INK}" font-size="20" font-weight="600">
    <text x="48" y="47" text-anchor="end">3V3</text>
    <text x="215" y="40" text-anchor="middle">capacitive soil</text><text x="215" y="64" text-anchor="middle">moisture sensor</text>
    <text x="512" y="62">IO34 (ADC)</text><text x="438" y="90">100 kΩ</text>
    <text x="398" y="175" text-anchor="end">5V (USB)</text>
    <text x="470" y="213" text-anchor="middle" font-weight="700">M</text><text x="440" y="212" text-anchor="end">pump</text>
    <text x="574" y="216">1N5819</text><text x="748" y="226">470 µF</text>
    <text x="48" y="337" text-anchor="end">IO25</text><text x="152" y="374" text-anchor="middle">100 Ω</text><text x="378" y="366">10 kΩ</text>
    <text x="488" y="314">IRLZ44N</text>
    <text x="48" y="453" text-anchor="end">IO26</text><text x="152" y="490" text-anchor="middle">330 Ω</text><text x="256" y="490" text-anchor="middle">LED</text>
    <text x="468" y="453" text-anchor="end">IO27</text><text x="600" y="412" text-anchor="middle">button</text>
  </g>
  <g fill="${INK}" font-size="17" opacity="0.75">
    <text x="215" y="87" text-anchor="middle">VCC · AOUT · GND</text>
    <text x="488" y="184">+</text><text x="488" y="246">−</text><text x="574" y="236">flyback</text><text x="746" y="196">+</text>
    <text x="420" y="296" text-anchor="end">G</text><text x="478" y="280">D</text><text x="480" y="362">S</text>
    <text x="488" y="336">logic-level N-MOSFET</text>
  </g>
  <g fill="${ACCENT}" font-size="16" font-weight="700"><text x="452" y="134">wire off → reads ≈ 0 V</text></g>`,
'Schematic: 3.3 volts powers a soil sensor whose output goes to IO34 with a 100 kilohm pull-down to ground. IO25 drives the gate of a logic-level MOSFET through 100 ohms, with 10 kilohms from gate to ground. The pump sits between 5 volts and the MOSFET drain; the source goes to ground. A 1N5819 diode across the pump has its cathode on 5 volts. A 470 microfarad capacitor joins 5 volts and ground. IO26 drives an LED through 330 ohms; IO27 reads a button to ground');

/* States: boxes in one row, every arrow ends on a box edge, every label sits above its own line. */
const plantStates = svgWrap(860, 210, `
  <defs><marker id="ap" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="10" y="40" width="170" height="70" rx="14" fill="#e9e1c8"/>
    <rect x="230" y="40" width="170" height="70" rx="14" fill="#c9e3f2"/>
    <rect x="450" y="40" width="170" height="70" rx="14" fill="#d9e3c4"/>
    <rect x="680" y="40" width="170" height="70" rx="14" fill="#f3b7a8"/>
    <path d="M180 75 H229" marker-end="url(#ap)"/>
    <path d="M400 75 H449" marker-end="url(#ap)"/>
    <path d="M535 40 V30 H315 V39" marker-end="url(#ap)"/>
    <path d="M620 75 H679" marker-end="url(#ap)" stroke-dasharray="7 5"/>
    <path d="M535 110 V140 H95 V111" marker-end="url(#ap)"/>
    <path d="M765 110 V174 H50 V111" marker-end="url(#ap)"/>
  </g>
  <g fill="${INK}" font-size="20" font-weight="700" text-anchor="middle">
    <text x="95" y="70">IDLE</text><text x="315" y="70">WATERING</text><text x="535" y="70">SOAKING</text><text x="765" y="70">LOCKED</text>
  </g>
  <g fill="${INK}" font-size="17" text-anchor="middle">
    <text x="95" y="96">pump off · reads</text><text x="315" y="96">pump on · 3 s</text><text x="535" y="96">pump off · 60 s</text><text x="765" y="96">pump off · saved</text>
    <text x="204" y="64">dry</text><text x="424" y="64">3 s</text><text x="649" y="64">fault</text>
    <text x="425" y="20">gaining but still dry: one more pulse</text>
    <text x="315" y="133">wet enough: back to IDLE</text>
    <text x="408" y="167">button, only if the sensor reads valid values</text>
  </g>
  <g fill="${INK}" font-size="16" text-anchor="middle" opacity="0.8"><text x="430" y="201">A fault in any state goes to LOCKED. The pump runs only in WATERING.</text></g>`,
'States: idle waits for dry soil; watering pumps three seconds; soaking waits sixty seconds and measures. Wet enough goes back to idle, gaining but still dry pumps again, and a fault in any state goes to locked. Only the button, with a valid sensor, goes from locked back to idle. The pump runs only in watering');

export const ESP32_PLANT_PAGE = {
  eyebrow: 'CHAPTER 2  ·  MEASURE, DECIDE, SWITCH',
  title: ['Smart Plant', 'Watering'],
  pageNumber: 3,
  blocks: [
    { type: 'p', text: 'A sensor measures the soil. When it is dry the ESP32 pumps for 3 s, waits 60 s and measures again. Any fault locks the pump off until you press the button.' },
    { type: 'p', text: 'Parts: ESP32-DevKitC, soil sensor, 5 V pump, IRLZ44N, 1N5819, 470 µF, LED, button (full list in the notebook).' },
    { type: 'h', text: 'SCHEMATIC (GPIO NAMES)' },
    { type: 'svg', svg: plantSchematic, w: 860, h: 500 },
    { type: 'h', text: 'STATES' },
    { type: 'svg', svg: plantStates, w: 860, h: 210 },
    { type: 'p', text: '5 V only. Water below the electronics, a tray under the pot.' },
  ],
};
