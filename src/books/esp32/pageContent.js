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

/* ------------------------------------------------------------------ chapter 2: smart plant watering */
const vres = (x, y, w = 18, h = 40) => `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="3"/>`;

const plantSchematic = svgWrap(860, 500, `
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- soil sensor -->
    <rect x="120" y="14" width="190" height="96" rx="12"/>
    <path d="M60 46 H120"/><path d="M215 110 V124"/><path d="${gnd(215, 124)}"/>
    <path d="M310 70 H500"/><path d="M420 70 V84"/>${vres(420, 84, 18, 36)}<path d="M420 120 V130"/><path d="${gnd(420, 130)}"/>
    <!-- pump branch -->
    <path d="M60 300 H110"/><path d="${zig(110, 300)}"/><path d="M194 300 H325"/>
    <path d="M250 300 V322"/>${vres(250, 322, 18, 36)}<path d="M250 358 V368"/><path d="${gnd(250, 368)}"/>
    <path d="M325 283 V317"/><path d="M345 273 V290 M345 296 V304 M345 310 V327"/><path d="M345 273 V258 H430 V266"/>
    <path d="M345 327 V352"/><path d="${gnd(345, 352)}"/>
    <path d="M345 300 H337"/>
    <path d="M360 190 H520"/><path d="M430 190 V212"/><circle cx="430" cy="238" r="26"/><path d="M430 264 V258"/>
    <path d="M500 190 V214 M486 214 H514 M486 246 H514 L500 214 Z M500 246 V258 H430"/>
    <path d="M580 190 V228 M566 228 H594 M566 240 H594 M580 240 V300"/><path d="${gnd(580, 300)}"/>
  </g>
  <path d="M345 310 l-10 -4 v8 z" fill="${INK}"/>
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- LED branch -->
    <path d="M60 440 H110"/><path d="${zig(110, 440)}"/><path d="M194 440 H240 M240 420 V460 L272 440 Z M272 420 V460 M272 440 H330 V458"/><path d="${gnd(330, 458)}"/>
    <!-- button branch -->
    <path d="M480 440 H560"/><circle cx="560" cy="440" r="6"/><circle cx="640" cy="440" r="6"/><path d="M560 440 L632 416"/><path d="M646 440 H700 V458"/><path d="${gnd(700, 458)}"/>
  </g>
  <g fill="${INK}"><circle cx="60" cy="46" r="7"/><circle cx="500" cy="70" r="7"/><circle cx="60" cy="300" r="7"/><circle cx="250" cy="300" r="5"/><circle cx="430" cy="258" r="5"/><circle cx="500" cy="190" r="5"/><circle cx="430" cy="190" r="5"/><circle cx="580" cy="190" r="5"/><circle cx="60" cy="440" r="7"/><circle cx="480" cy="440" r="7"/><circle cx="420" cy="70" r="5"/></g>
  <g fill="${INK}" font-size="20" font-weight="600">
    <text x="48" y="38" text-anchor="end">3V3</text>
    <text x="215" y="46" text-anchor="middle">capacitive soil</text><text x="215" y="70" text-anchor="middle">moisture sensor</text><text x="215" y="94" text-anchor="middle" font-size="16" opacity="0.7">VCC · AOUT · GND</text>
    <text x="518" y="76">IO34 (ADC)</text><text x="440" y="108">100 kΩ</text>
    <text x="48" y="308" text-anchor="end">IO25</text><text x="152" y="348" text-anchor="middle">100 Ω</text><text x="270" y="346">10 kΩ</text>
    <text x="300" y="268" text-anchor="end">N-MOSFET</text><text x="300" y="290" text-anchor="end" font-size="16" opacity="0.7">logic level</text>
    <text x="474" y="244" text-anchor="end">pump</text><text x="520" y="236" font-size="16" opacity="0.7">flyback</text><text x="520" y="256" font-size="16" opacity="0.7">diode</text>
    <text x="610" y="226">470 µF</text><text x="540" y="182" text-anchor="end">5V</text>
    <text x="48" y="448" text-anchor="end">IO26</text><text x="152" y="488" text-anchor="middle">330 Ω</text><text x="256" y="484" text-anchor="middle">LED</text>
    <text x="468" y="448" text-anchor="end">IO27</text><text x="600" y="408" text-anchor="middle">button</text>
  </g>
  <g fill="${ACCENT}" font-size="17" font-weight="700"><text x="402" y="20" text-anchor="middle">0 V if the wire is off</text><text x="600" y="340" font-size="16"> </text></g>
  <g fill="${INK}" font-size="17" opacity="0.75"><text x="362" y="340">source to GND</text><text x="352" y="196" text-anchor="end">pump: 5 V from USB</text></g>`,
'Schematic: 3.3 V powers a soil sensor whose output goes to IO34 with a 100 kilohm pull-down; IO25 drives a logic-level MOSFET through 100 ohms with a 10 kilohm pull-down; the MOSFET switches a pump from 5 volts, with a diode across the pump and a capacitor on the supply; IO26 drives an LED through 330 ohms; IO27 reads a button to ground');

const plantStates = svgWrap(860, 210, `
  <defs><marker id="ap" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="10" y="30" width="180" height="74" rx="14" fill="#e9e1c8"/>
    <rect x="236" y="30" width="180" height="74" rx="14" fill="#c9e3f2"/>
    <rect x="462" y="30" width="180" height="74" rx="14" fill="#d9e3c4"/>
    <rect x="688" y="30" width="162" height="74" rx="14" fill="#f3b7a8"/>
    <path d="M192 67 H234" marker-end="url(#ap)"/><path d="M418 67 H460" marker-end="url(#ap)"/>
    <path d="M552 106 V158 H100 V108" marker-end="url(#ap)"/>
    <path d="M644 54 H686" marker-end="url(#ap)" stroke-dasharray="6 5"/>
    <path d="M520 28 V12 H326 V28" marker-end="url(#ap)"/>
    <path d="M769 106 V186 H100" stroke-dasharray="6 5"/>
  </g>
  <g fill="${INK}" font-size="21" font-weight="700" text-anchor="middle">
    <text x="100" y="62">IDLE</text><text x="326" y="62">WATERING</text><text x="552" y="62">SOAKING</text><text x="769" y="62">LOCKED</text>
  </g>
  <g fill="${INK}" font-size="15" text-anchor="middle">
    <text x="100" y="86">pump off · reads</text><text x="326" y="86">pump on · 3 s</text><text x="552" y="86">pump off · 60 s</text><text x="769" y="86">pump off · saved</text>
    <text x="213" y="58">dry</text><text x="439" y="58">3 s</text>
    <text x="326" y="6">gaining but still dry: next pulse</text>
    <text x="326" y="152">wet enough: back to IDLE</text>
    <text x="436" y="203" font-size="14">any fault: sensor, no response, time limit. Button clears it.</text>
  </g>`,
'States: idle waits for dry soil; watering pumps three seconds; soaking waits sixty seconds then measures; if wet enough it returns to idle, if gaining but dry it pumps again, and any fault leads to locked, which only the button clears');

export const ESP32_PLANT_PAGE = {
  eyebrow: 'CHAPTER 2  ·  MEASURE, DECIDE, SWITCH',
  title: ['Smart Plant', 'Watering'],
  pageNumber: 3,
  blocks: [
    { type: 'p', text: 'A sensor measures the soil. When it is dry the ESP32 pumps for 3 s, waits 60 s and measures again. Any fault locks the pump off until you press the button.' },
    { type: 'h', text: 'YOU WILL NEED (FULL LIST IN THE NOTEBOOK)' },
    { type: 'bullets', items: ['ESP32-DevKitC, 5 V 2 A charger, LED, button', 'Soil sensor, 5 V pump, IRLZ44N, 1N5819, 470 µF'] },
    { type: 'h', text: 'SCHEMATIC (GPIO NAMES)' },
    { type: 'svg', svg: plantSchematic, w: 860, h: 500 },
    { type: 'h', text: 'STATES' },
    { type: 'svg', svg: plantStates, w: 860, h: 210 },
    { type: 'p', text: '5 V only. Water below the electronics, a tray under the pot.' },
  ],
};
