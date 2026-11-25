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

/*
 * Chapter 3 schematic, same nets as arduino/cat_feeder/cat_feeder.ino (header) and feederParts.js:
 *   3V3 -> PCA9685 VCC; IO21 SDA, IO22 SCL -> PCA9685 (0x40) and INA219 (0x45); IO33 -> OE with 2.2 kohm to 3V3
 *   6 V supply + -> E-stop main NC contact -> 3 A slow fuse -> INA219 shunt -> PCA9685 V+ (1000 uF to GND)
 *   PCA9685 ch0..ch4 -> base, shoulder, elbow, wrist, door servos
 *   IO19 <- HX711 DT, IO18 -> HX711 SCK; IO27 <- IR receiver; IO26, IO25, IO13 <- switches to GND; IO4 -> 330 ohm -> LED
 * Layout rule as above: no label on a wire, every wire ends on a node, a part or a "GND" tag, nothing leaves the box.
 */
const sw = (x, y, nc = false) => `<circle cx="${x}" cy="${y}" r="5"/><circle cx="${x + 60}" cy="${y}" r="5"/>${nc ? `<path d="M${x} ${y - 7} H${x + 60}"/>` : `<path d="M${x + 3} ${y - 4} L${x + 54} ${y - 13}"/>`}`;
const feederSchematic = svgWrap(860, 620, `
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <rect x="16" y="20" width="168" height="572" rx="10"/>
    <!-- servo supply: + -> E-stop main NC contact -> 5 A fuse -> INA219 shunt -> PCA9685 V+ ; 1000 uF to GND -->
    <path d="M400 40 H560 M640 40 H670 M720 40 H748 M802 40 H830"/>
    <rect x="560" y="28" width="80" height="24" rx="4"/>
    <rect x="670" y="33" width="50" height="14" rx="3"/>
    <circle cx="753" cy="40" r="5"/><circle cx="797" cy="40" r="5"/><path d="M753 31 H797"/>
    <path d="M520 40 V120"/>
    <path d="M400 40 V56"/><path d="M380 56 H420"/><path d="M380 70 Q400 62 420 70"/><path d="M400 68 V80"/><path d="${gnd(400, 80)}"/>
    <!-- PCA9685 -->
    <rect x="430" y="120" width="180" height="140" rx="8"/>
    <path d="M184 140 H430 M184 170 H430 M184 200 H430 M184 230 H430"/>
    <path d="M330 230 V242"/>${vres(330, 242, 18, 34)}<path d="M330 276 V284"/>
    <path d="M610 135 H640 M610 160 H640 M610 185 H640 M610 210 H640 M610 235 H640"/>
    <!-- HX711 and the load cell -->
    <rect x="430" y="320" width="200" height="70" rx="8"/>
    <path d="M184 340 H430 M184 370 H430 M630 355 H660"/>
    <!-- inputs: IR receiver, lid switch, E-stop second contact (NC), button; LED -->
    <path d="M184 420 H300"/><rect x="300" y="406" width="150" height="28" rx="5"/>
    <path d="M184 450 H306"/>${sw(306, 450)}<path d="M371 450 H420"/>
    <path d="M184 480 H306"/>${sw(306, 480, true)}<path d="M371 480 H420"/>
    <path d="M184 510 H306"/>${sw(306, 510)}<path d="M371 510 H420"/>
    <path d="M184 540 H300"/><path d="${zig(300, 540)}"/><path d="M384 540 H400"/><path d="M400 524 V556 L432 540 Z"/><path d="M432 524 V556"/><path d="M432 540 H470"/>
    <path d="M184 570 H210"/><path d="${gnd(210, 570)}"/>
  </g>
  <g fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M412 560 L426 576 M418 576 H426 V568"/><path d="M428 560 L442 576 M434 576 H442 V568"/>
  </g>
  <g fill="${INK}">
    <circle cx="400" cy="40" r="5"/><circle cx="520" cy="40" r="5"/><circle cx="830" cy="40" r="7"/><circle cx="330" cy="230" r="5"/>
  </g>
  <g fill="${INK}" font-size="20" font-weight="700">
    <text x="100" y="52" text-anchor="middle">ESP32</text>
    <text x="548" y="186" text-anchor="middle">PCA9685</text>
    <text x="560" y="350" text-anchor="middle">HX711</text>
  </g>
  <g fill="${INK}" font-size="18" font-weight="600" text-anchor="end">
    <text x="176" y="146">3V3</text><text x="176" y="176">IO21</text><text x="176" y="206">IO22</text><text x="176" y="236">IO33</text>
    <text x="176" y="346">IO19</text><text x="176" y="376">IO18</text><text x="176" y="426">IO27</text><text x="176" y="456">IO26</text>
    <text x="176" y="486">IO25</text><text x="176" y="516">IO13</text><text x="176" y="546">IO4</text><text x="176" y="576">GND</text>
  </g>
  <g fill="${INK}" font-size="16">
    <text x="100" y="74" text-anchor="middle">DevKitC</text>
    <text x="440" y="146">VCC</text><text x="440" y="176">SDA</text><text x="440" y="206">SCL</text><text x="440" y="236">OE</text>
    <text x="548" y="210" text-anchor="middle">0x40 · 50 Hz</text><text x="528" y="110">V+</text>
    <text x="648" y="141">0 base · MG996R</text><text x="648" y="166">1 shoulder · MG996R</text><text x="648" y="191">2 elbow · MG996R</text>
    <text x="648" y="216">3 wrist · MG90S</text><text x="648" y="241">4 door · MG90S</text>
    <text x="440" y="346">DT</text><text x="440" y="376">SCK</text><text x="560" y="374" text-anchor="middle">VCC 3V3 · GND</text>
    <text x="668" y="350">load cell</text><text x="668" y="372">under the plate</text>
    <text x="342" y="304" text-anchor="middle">2.2 kΩ to 3V3</text>
    <text x="600" y="20" text-anchor="middle" font-weight="600">INA219</text><text x="600" y="74" text-anchor="middle">0x45 · same I²C</text>
    <text x="695" y="24" text-anchor="middle">3 A</text><text x="775" y="22" text-anchor="middle">E-stop</text>
    <text x="830" y="66" text-anchor="middle">+6 V</text><text x="814" y="94" text-anchor="middle">5 A supply</text>
    <text x="370" y="74" text-anchor="end">1000 µF</text>
    <text x="375" y="426" text-anchor="middle">IR receiver</text>
    <text x="428" y="456">GND</text><text x="428" y="486">GND</text><text x="428" y="516">GND</text><text x="478" y="546">GND</text>
    <text x="462" y="426">LOW = beam broken (cat)</text>
    <text x="500" y="456">lid switch · closed = LOW</text>
    <text x="500" y="486">E-stop NC contact · pressed = HIGH</text>
    <text x="500" y="516">button · short: feed, long: reset</text>
    <text x="530" y="546">330 Ω · status LED</text>
    <text x="250" y="606">common GND: supply −, PCA9685, INA219, HX711, ESP32</text>
  </g>`,
'Schematic: the ESP32 3V3 pin powers the PCA9685 logic. IO21 and IO22 are the I2C bus to the PCA9685 at address 0x40 and the INA219 at 0x45. IO33 drives the PCA9685 output enable, with a 2.2 kilohm pull-up to 3V3. A separate 6 volt 5 amp supply goes through the emergency stop main contact, a 3 amp slow fuse and the INA219 shunt to the PCA9685 V+, with 1000 microfarads to ground. PCA9685 channels 0 to 4 drive the base, shoulder, elbow, wrist and door servos. IO19 and IO18 read the HX711 and its load cell. IO27 reads the IR beam receiver, IO26 the lid switch, IO25 the emergency stop second contact and IO13 the button, all to ground. IO4 drives an LED through 330 ohms. All grounds are joined');

/* States of the feeder: one row for a normal ration, FAULT and RECOVERING below. */
const feederStates = svgWrap(860, 214, `
  <defs><marker id="af" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="10" y="40" width="146" height="64" rx="12" fill="#e9e1c8"/>
    <rect x="184" y="40" width="146" height="64" rx="12" fill="#d8e2ef"/>
    <rect x="358" y="40" width="146" height="64" rx="12" fill="#d9e3c4"/>
    <rect x="532" y="40" width="146" height="64" rx="12" fill="#c9e3f2"/>
    <rect x="706" y="40" width="146" height="64" rx="12" fill="#d8e2ef"/>
    <rect x="184" y="148" width="146" height="60" rx="12" fill="#f3b7a8"/>
    <rect x="532" y="148" width="146" height="60" rx="12" fill="#f1d9a8"/>
    <path d="M156 72 H183" marker-end="url(#af)"/><path d="M330 72 H357" marker-end="url(#af)"/>
    <path d="M504 72 H531" marker-end="url(#af)"/><path d="M678 72 H705" marker-end="url(#af)"/>
    <path d="M779 40 V26 H83 V39" marker-end="url(#af)"/>
    <path d="M257 104 V147" marker-end="url(#af)" stroke-dasharray="7 5"/>
    <path d="M330 178 H531" marker-end="url(#af)"/>
    <path d="M605 148 V105" marker-end="url(#af)"/>
  </g>
  <g fill="${INK}" font-size="17" font-weight="700" text-anchor="middle">
    <text x="83" y="68">IDLE</text><text x="257" y="68">DOOR CLOSE</text><text x="431" y="68">TARE</text><text x="605" y="68">CYCLE</text><text x="779" y="68">DOOR OPEN</text>
    <text x="257" y="174">FAULT</text><text x="605" y="174">RECOVERING</text>
  </g>
  <g fill="${INK}" font-size="15" text-anchor="middle">
    <text x="83" y="90">door open, arm off</text><text x="257" y="90">checks, door shut</text><text x="431" y="90">weigh the plate</text>
    <text x="605" y="90">scoop, pour, weigh</text><text x="779" y="90">arm parked</text>
    <text x="257" y="196">arm off, door shut</text><text x="605" y="196">slow, door shut</text>
    <text x="431" y="18">parked: servo outputs off, then the door opens to Pancho</text>
    <text x="431" y="170">long press, cause gone</text>
  </g>
  <g fill="${INK}" font-size="15">
    <text x="265" y="132">any fault, cat, lid, E-stop</text><text x="613" y="132">spoon emptied, home</text>
  </g>`,
'States: idle with the door open and the arm off; door close after the checks; tare weighs the plate; the cycle scoops, pours and weighs; door open once the arm is parked, then back to idle. Any fault, the cat, the lid or the emergency stop goes to fault with the arm off and the door shut. A long press with the cause gone starts recovering, which empties the spoon and goes home slowly');

export const ESP32_FEEDER_PAGE = {
  eyebrow: 'CHAPTER 3  ·  MOVE, MEASURE, STOP SAFELY',
  title: ['Smart Robotic', 'Cat Feeder'],
  pageNumber: 5,
  blocks: [
    { type: 'p', text: 'A 4-joint arm scoops dry food from a hopper and pours a measured ration into Pancho’s plate. A load cell weighs what arrived. The access door stays shut while anything moves.' },
    { type: 'h', text: 'SCHEMATIC (GPIO NAMES)' },
    { type: 'svg', svg: feederSchematic, w: 860, h: 620 },
    { type: 'h', text: 'STATES' },
    { type: 'svg', svg: feederStates, w: 860, h: 214 },
    { type: 'p', text: 'A teaching design, not a certified safe device: build and test it before any use with an animal.' },
  ],
};

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
