import { buildPlantScene } from './plantScene.js';
import { leftPageTexture, rightPageTexture } from '../../textures.js';
import { ESP32_PLANT_PAGE } from './pageContent.js';
import { PlantWatering, parseSettings, PINS, LOCK, LOCK_TEXT, LOCK_NAME } from './plantWatering.js';
import { PlantWorld, WEAK_PUMP } from './plantWorld.js';
import { PARTS, CONNECTIONS, FAULTS, PIN_TABLE, ELEC, electricalCheck, ADC_LINEAR_NOTE } from './plantParts.js';
import { $, $$, escapeHtml, renderCode, bindCopy, createConsole, renderSteps } from '../../ui.js';

/*
 * ESP32 chapter 2: smart plant watering.
 *   scene   src/books/esp32/plantScene.js     (ESP32, breadboard, sensor, MOSFET, pump, tank, hose, pot, plant)
 *   logic   src/books/esp32/plantWatering.js  (a port of arduino/plant_watering/plant_watering.ino; constants read from it)
 *   world   src/books/esp32/plantWorld.js     (soil, tank, pump and sensor faults: what the sketch cannot see)
 *   data    src/books/esp32/plantParts.js     (parts, connections, faults, electrical check)
 *   page    src/books/esp32/pageContent.js    (ESP32_PLANT_PAGE)
 * Like chapter 1 there are no timers: loop() runs once per simulated millisecond from update(dt), and the world
 * advances every 10 simulated ms, exactly as in tests/plantWatering.test.mjs.
 */

const viewButtons = [
  ['circuit', 'Whole project'], ['book', 'Whole book'], ['leftpage', 'Left page'], ['wiring', 'Breadboard'],
  ['pins', 'ESP32 pins'], ['water', 'Water side'], ['sensor', 'Soil sensor'], ['pump', 'Tank and pump'],
];

const STEPS = [
  { title: 'The sensor turns moisture into a voltage', text: 'The capacitive sensor has no bare metal in the soil. Water changes the capacitance of its coated blade, and its small circuit turns that into a voltage on AOUT: about 2.3 V in dry air, about 1 V in water. Wetter soil gives a lower voltage.', view: 'sensor' },
  { title: 'The ADC turns the voltage into a number', text: 'analogRead(34) gives 0 to 4095 (12 bits). GPIO34 is on ADC1, which keeps working when Wi-Fi is on. With 11 dB attenuation the input range reaches about 3.1 V, so the sensor output fits.', view: 'pins' },
  { title: 'Calibration gives the number a meaning', text: 'RAW_DRY and RAW_WET are two readings you take on your own sensor: in dry air and in water. The program maps the reading to 0 to 100 % between them. Every sensor is a little different, so these two constants are yours to measure.', view: 'sensor' },
  { title: 'The filter ignores noise', text: 'One reading every 100 ms goes into an average of the last 16 (1.6 s). A single spike moves the average by one sixteenth. Readings outside 200 to 3900 are not averaged at all: they count as a possible fault.', view: 'pins' },
  { title: 'Two thresholds: hysteresis', text: 'Below 35 % the soil is dry and watering starts. It stops only at 60 % or more. Between the two the program keeps doing what it was doing, so noise near one threshold cannot switch the pump on and off.', view: 'water' },
  { title: 'The MOSFET switches the pump', text: 'GPIO25 cannot power a pump. It only charges the gate of a logic-level MOSFET through 100 Ω. With 3.3 V on the gate the MOSFET joins the pump “−” to GND, and the pump current flows from the 5V pin. 10 kΩ keeps the gate at 0 V while the ESP32 starts.', view: 'wiring' },
  { title: 'The diode protects the MOSFET', text: 'A pump is a coil. When the MOSFET opens, the coil keeps pushing current for a moment and the drain voltage would jump far above 5 V. The diode across the pump gives that current a path back to 5 V. The 470 µF capacitor covers the start-up current so the board does not reset.', view: 'wiring' },
  { title: 'Pulse, soak, measure', text: 'Water takes time to reach the sensor. So the program pumps 3 s, waits 60 s, and only then decides: wet enough (stop), wetter but still dry (another pulse), or no change (fault). There is no delay(): every pass of loop() compares millis() with the time the state started.', view: 'water' },
  { title: 'Faults lock the pump off', text: 'An invalid reading for 2 s, a pulse that did not wet the soil, or 24 s of pump time in one episode: the program goes to LOCKED, switches the pump off and saves the reason in flash, so a reset does not clear it. Only the button clears it, and only if the sensor reads valid values again.', view: 'pump' },
];

const SPEEDS = [1, 10, 60, 200];
const GUIDED_SPEED = 60;
const STATE_NAMES = { IDLE: 'IDLE', WATERING: 'WATERING', SOAKING: 'SOAKING', LOCKED: 'LOCKED', STOPPED: 'STOPPED' };
const STATE_COLORS = { IDLE: '#2e9e55', WATERING: '#2f86d6', SOAKING: '#1f9aa0', LOCKED: '#d6453a', STOPPED: '#555a70' };
const BANNER = { IDLE: 'closed', WATERING: 'watering', SOAKING: 'soaking', LOCKED: 'alarm', STOPPED: 'stopped' };
const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;
const hl = (v) => (v ? 'HIGH' : 'LOW');
const pct = (x) => `${Math.round(x)} %`;
const esc = (s) => escapeHtml(String(s));

const simHtml = (s) => `
  <p class="note sim-note"><b>Web simulation.</b> Change the soil, the tank and the faults below, or click the red button and the soil sensor in the 3D scene. Nothing here touches real hardware.</p>

  <div class="alarm-box closed" id="pwBox">
    <div class="al-main" id="pwMain" role="status">Waiting</div>
    <div class="al-sub" id="pwSub"></div>
    <div class="al-bar" aria-hidden="true"><i id="pwFill"></i></div>
    <div class="al-time"><span id="pwLeft"></span><span id="pwTotal"></span></div>
  </div>

  <div class="status-row four">
    <div class="chip" id="chSoil"><span>Soil (real)</span><b>–</b></div>
    <div class="chip" id="chAdc"><span>GPIO${s.sensorPin} ADC</span><b>–</b></div>
    <div class="chip" id="chFilt"><span>Program sees</span><b>–</b></div>
    <div class="chip" id="chProg"><span>State</span><b>–</b></div>
  </div>

  <h3>Program</h3>
  <p class="prog-state" id="progState"></p>
  <div class="btn-row three">
    <button id="btnRun" class="btn accent">▶ Run</button>
    <button id="btnStop" class="btn">■ Stop</button>
    <button id="btnPower" class="btn" title="Like unplugging the USB cable and plugging it back in">⏻ Power cycle</button>
  </div>
  <button id="btnHold" class="btn hold-btn" aria-describedby="holdHint">Hold to press the button (GPIO${s.buttonPin})</button>
  <p class="note" id="holdHint">The button clears a lock. You can also press the red button in the 3D scene (or Space / Enter here).</p>
  <div class="speed-row" role="group" aria-label="Simulation speed">
    <span>Speed</span>
    ${SPEEDS.map((v) => `<button class="chip-btn speed" data-speed="${v}" aria-pressed="false">${v}×</button>`).join('')}
    <b id="speedInfo"></b>
  </div>
  <p class="note" id="clockInfo"></p>

  <h3>Soil and tank</h3>
  <div class="slider-ctl">
    <label for="soilSlider">Soil moisture (what is really in the pot): <b id="soilVal"></b></label>
    <input type="range" id="soilSlider" min="0" max="100" step="1" value="30">
    <label for="tankSlider">Water in the tank: <b id="tankVal"></b></label>
    <input type="range" id="tankSlider" min="0" max="500" step="10" value="400">
    <div class="btn-row"><button id="btnRefill" class="btn">Fill the tank</button><button id="btnEmpty" class="btn">Empty the tank</button></div>
  </div>

  <h3>Thresholds (hysteresis)</h3>
  <div class="slider-ctl">
    <label for="dryRange">Start watering below: <b id="dryVal"></b></label>
    <input type="range" id="dryRange" min="10" max="80" step="1" value="${s.dryOn}">
    <label for="wetRange">Stop watering at: <b id="wetVal"></b></label>
    <input type="range" id="wetRange" min="20" max="95" step="1" value="${s.wetOff}">
    <button id="btnThrReset" class="chip-btn">Back to the sketch values (${s.dryOn} % and ${s.wetOff} %)</button>
  </div>
  <p class="note">On the board these are <code>DRY_ON_PERCENT</code> and <code>WET_OFF_PERCENT</code> in the sketch. The page keeps them at least 5 points apart.</p>

  <h3>Faults to try</h3>
  <fieldset class="mount-pick"><legend>Sensor cable (AOUT)</legend>
    <label><input type="radio" name="sensorMode" value="ok" checked> Connected</label>
    <label><input type="radio" name="sensorMode" value="disconnected"> Wire off</label>
    <label><input type="radio" name="sensorMode" value="short"> Shorted to 3.3 V</label>
  </fieldset>
  <div class="options col">
    <label><input type="checkbox" id="optPull" checked> 100 kΩ pull-down fitted on AOUT</label>
    <label><input type="checkbox" id="optNoise"> Noisy readings (long cable, pump motor nearby)</label>
    <label><input type="checkbox" id="optHose"> Hose blocked or kinked</label>
    <label><input type="checkbox" id="optWeak"> Weak pump (${Math.round(WEAK_PUMP * 100)} % of its flow)</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>

  <h3>Pin levels</h3>
  <div class="gp-grid" id="gpGrid">
    <div class="gp-row" data-k="sensor"><i class="gp-dot" style="--c:#a56ae0"></i><div class="gp-name"><b>GPIO${s.sensorPin} · IO${s.sensorPin}</b><span>soil sensor AOUT · analog input</span></div><div class="gp-level"></div></div>
    <div class="gp-row" data-k="pump"><i class="gp-dot" style="--c:#2e9e55"></i><div class="gp-name"><b>GPIO${s.pumpPin} · IO${s.pumpPin}</b><span>MOSFET gate · output</span></div><div class="gp-level"></div></div>
    <div class="gp-row" data-k="led"><i class="gp-dot" style="--c:#e2b623"></i><div class="gp-name"><b>GPIO${s.ledPin} · IO${s.ledPin}</b><span>status LED · output</span></div><div class="gp-level"></div></div>
    <div class="gp-row" data-k="button"><i class="gp-dot" style="--c:#3f7be0"></i><div class="gp-name"><b>GPIO${s.buttonPin} · IO${s.buttonPin}</b><span>button · input with pull-up</span></div><div class="gp-level"></div></div>
  </div>

  <h3>Guided experiments</h3>
  <ol class="guided" id="guided">
    <li data-n="0"><b>A normal watering.</b> <span>Dry soil (25 %). Expected: pulses of 3 s with 60 s of soaking, then back to IDLE at ${s.wetOff} % or more. No water lost.</span><button class="chip-btn">Start experiment 1</button><em></em></li>
    <li data-n="1"><b>Hysteresis.</b> <span>Soil at 45 %, between the thresholds. Expected: two minutes with the pump off.</span><button class="chip-btn">Start experiment 2</button><em></em></li>
    <li data-n="2"><b>Empty tank.</b> <span>Expected: one pulse with no water, then LOCKED, code 2, after the soak.</span><button class="chip-btn">Start experiment 3</button><em></em></li>
    <li data-n="3"><b>Sensor wire comes off.</b> <span>Expected: LOCKED, code 1, about ${s.sensorFaultMs / 1000} s later, pump off.</span><button class="chip-btn">Start experiment 4</button><em></em></li>
    <li data-n="4"><b>Weak pump: time limit.</b> <span>Expected: pulses until ${s.maxWaterTotalMs / 1000} s of pump time, then LOCKED, code 3. Never more.</span><button class="chip-btn">Start experiment 5</button><em></em></li>
    <li data-n="5"><b>The lock survives a power cut.</b> <span>Expected: after a power cycle it is still LOCKED; the button clears it.</span><button class="chip-btn">Start experiment 6</button><em></em></li>
  </ol>
  <p class="note">Experiments run at ${GUIDED_SPEED}×. The program still uses its real times (3 s, 60 s, 24 s).</p>

  <h3>Moisture and state</h3>
  <canvas id="pwCanvas" class="tl-canvas" width="760" height="230" role="img" aria-label="Plot of the real soil moisture, what the program sees, the two thresholds and the program state"></canvas>
  <p class="note">Last 5 minutes of simulated time. Blue: real moisture. Violet: the filtered value the program uses. Dashed lines: the two thresholds.</p>

  <h3>Calibration bench</h3>
  <p>Do what you will do with the real sensor: measure it in dry air and in a glass of water (up to the white line), 32 readings each.</p>
  <div class="btn-row"><button id="btnCalDry" class="btn">Measure in dry air</button><button id="btnCalWet" class="btn">Measure in water</button></div>
  <p class="note" id="calOut">The sketch uses RAW_DRY = ${s.rawDry} and RAW_WET = ${s.rawWet}.</p>

  <h3>Console</h3>
  <div class="console" id="console" aria-live="off"></div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = (s) => `
  <p>Arduino C++ for the ESP32-DevKitC. This is the file that runs on the board, the one the simulation follows (its constants are read from it) and the one you download. The loop never blocks.</p>
  <div class="code-head"><span>plant_watering.ino</span>
    <span class="code-actions"><button id="copyBtn" class="chip-btn">Copy</button><a id="dlLink" class="chip-btn" href="arduino/plant_watering/plant_watering.ino" download="plant_watering.ino">Download</a></span></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What each part does</h3>
  <ul class="explain-list">
    <li><code>SENSOR_PIN</code>, <code>PUMP_PIN</code>, <code>LED_PIN</code>, <code>BUTTON_PIN</code>: GPIO numbers (${s.sensorPin}, ${s.pumpPin}, ${s.ledPin}, ${s.buttonPin}), not header positions.</li>
    <li><code>analogReadResolution(12)</code> and <code>analogSetPinAttenuation(SENSOR_PIN, ADC_11db)</code>: readings from 0 to 4095 for an input up to about 3.1 V.</li>
    <li><code>RAW_DRY</code> and <code>RAW_WET</code>: your calibration. <code>moisturePercent()</code> maps a reading between them to 0 to 100 % with integer arithmetic and clamps it.</li>
    <li><code>RAW_VALID_MIN</code> and <code>RAW_VALID_MAX</code>: a reading outside them is not a working sensor. It is never averaged; ${s.sensorFaultMs / 1000} s of them in a row (<code>SENSOR_FAULT_MS</code>) lock the pump off.</li>
    <li><code>samples[]</code>, <code>sampleSum</code>: a ring buffer. Each new reading replaces the oldest, and the sum is updated with one subtraction and one addition. Nothing is decided until it is full (<code>filterReady()</code>).</li>
    <li><code>DRY_ON_PERCENT</code> and <code>WET_OFF_PERCENT</code>: the two thresholds of the hysteresis.</li>
    <li><code>enterState()</code> is the only place that writes the pump pin after <code>setup()</code>: HIGH only when the new state is <code>WATERING</code>. Every other state switches it off on entry.</li>
    <li><code>PULSE_MS</code>, <code>SOAK_MS</code>, <code>MIN_RISE_PERCENT</code>, <code>MAX_WATER_TOTAL_MS</code>: pump ${s.pulseMs / 1000} s, wait ${s.soakMs / 1000} s, expect at least ${s.minRise} points more, and never more than ${s.maxWaterTotalMs / 1000} s of pump time in one episode.</li>
    <li><code>Preferences</code> saves the lock reason in flash (<code>prefs.putUChar("lock", ...)</code>), so <code>setup()</code> starts LOCKED after a reset or a power cut.</li>
    <li>The button uses the same debounce as chapter 1 (${s.debounceMs} ms) and only counts a press, not a release.</li>
    <li><code>ledShouldBeOn()</code> computes the LED from the state and the time in that state: a flash every 2 s (IDLE), on (WATERING), slow blink (SOAKING), 1, 2 or 3 quick blinks (LOCKED, the code of the fault).</li>
    <li>All the time checks are <code>now - start &gt;= LIMIT</code> with unsigned numbers, so they stay correct when <code>millis()</code> wraps after about 49.7 days.</li>
  </ul>
  <h3>Upload it to your ESP32</h3>
  <ol class="steps-list">
    <li>Arduino IDE with the <b>esp32 by Espressif Systems</b> board package. <code>Preferences</code> comes with it; no other library is needed.</li>
    <li>Download <code>plant_watering.ino</code> into a folder called <code>plant_watering</code>.</li>
    <li><b>First upload with the pump wire disconnected.</b> Board <b>ESP32 Dev Module</b>, its port, Upload (hold BOOT if it does not connect).</li>
    <li>Serial Monitor at 115200 baud: a status line every 2 s with the raw reading, the filtered value and the state. Calibrate (see “How it works”), edit the constants, upload again, then connect the pump.</li>
  </ol>
  <p class="note">This page is a web simulation. The logic was checked against a JavaScript port of this sketch with automated tests. It has not been compiled for or run on a real ESP32, and no real parts were measured.</p>`;

function table(head, rows) {
  return `<table class="wiring"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

const howHtml = (s) => {
  const e = electricalCheck();
  const n2 = (x) => x.toFixed(2);
  const mA = (a) => `${Math.round(a * 1000)} mA`;
  const seen = (v) => (v === true ? 'yes' : v === false ? 'no' : 'only indirectly');
  return `
  <p>Click a step to move the camera. The highlighted step follows what the program is doing.</p>
  <ol class="steps" id="steps"></ol>

  <h3>The path of the signal</h3>
  <p class="path-line"><b>soil water</b> → <b>sensor</b> → <b>GPIO${s.sensorPin} ADC</b> → <b>filter + calibration</b> → <b>state machine</b> → <b>GPIO${s.pumpPin}</b> → <b>MOSFET</b> → <b>pump</b> → <b>soil water</b></p>

  <h3>Parts list</h3>
  ${table(['Part', 'Qty', 'Specification', 'Compatible alternatives'], PARTS.map((p) => [`<b>${esc(p.name)}</b>`, esc(p.qty), esc(p.spec), esc(p.alt)]))}

  <h3>ESP32 pins</h3>
  ${table(['Pin', 'Used for', 'Mode', 'Note'], PIN_TABLE.map((p) => [esc(p.name), esc(p.role), esc(p.mode), esc(p.note)]))}
  <p class="note">GPIO34 is input-only, which is fine for a sensor. GPIO25, 26, 27 and 34 are not strapping pins and not on the flash (GPIO6 to 11). Do not use ADC2 pins (GPIO0, 2, 4, 12 to 15, 25 to 27) for the sensor: ADC2 stops working when Wi-Fi is on.</p>

  <h3>Connection table (breadboard columns as in the 3D model)</h3>
  ${table(['From', 'To', 'Why'], CONNECTIONS.map((c) => [esc(c.from), esc(c.to), esc(c.note)]))}

  <h3>Electrical check (on paper)</h3>
  <ul class="explain-list">
    <li><b>Gate:</b> 3.3 V through 100 Ω with 10 kΩ to ground gives ${n2(e.gateV)} V at the gate. The IRLZ44N starts to conduct between 1 and 2 V and is specified fully on at 4 V (Rds(on) ${ELEC.mosfetRdsOn4V * 1000} mΩ). At 3.3 V a small pump is far below its current limit, but use a logic-level part: an IRF520 or IRFZ44N barely turns on at 3.3 V.</li>
    <li><b>MOSFET heat:</b> even with a stalled pump (${mA(ELEC.pumpStallA)}) the drop is ${n2(e.pumpDrop)} V and the heat ${n2(e.pumpHeat)} W. No heatsink needed.</li>
    <li><b>Supply:</b> board ${mA(ELEC.boardA)} + sensor ${mA(ELEC.sensorSupplyA)} + pump ${mA(ELEC.pumpRunA)} = ${mA(e.normalA)} while pumping. With a stalled pump: ${mA(e.stallA)}. A PC port gives 500 mA, so use a <b>5 V charger of at least 1.5 A</b>. The pump current goes through the board's 5V pin, which is wired straight to USB: keep the pump small (250 mA or less running).</li>
    <li><b>Start-up:</b> a motor draws several times its running current for a few milliseconds. The 470 µF capacitor between 5 V and GND supplies that, so the 3.3 V regulator does not dip and reset the ESP32.</li>
    <li><b>Diode:</b> the 1N5819 carries the coil current (up to ${mA(e.flybackA)}) for a moment when the MOSFET opens. It is rated 1 A and 40 V. Band (cathode) toward 5 V, otherwise it shorts the supply when the pump runs.</li>
    <li><b>LED:</b> (3.3 − 2.0) V / 330 Ω ≈ ${mA(e.ledA)}.</li>
    <li><b>Sensor:</b> powered from <b>3.3 V</b>, so its output can never exceed what the ADC accepts. Powered from 5 V some versions give more than 3.3 V on AOUT. ${esc(ADC_LINEAR_NOTE)}</li>
  </ul>

  <h3>Assembly, step by step</h3>
  <ol class="steps-list">
    <li><b>Plan the layout first.</b> The tank and the pot go on a tray, lower than the electronics and at least 30 cm away. The breadboard and the ESP32 sit higher, on a dry surface. Water can only run downhill, away from the board.</li>
    <li>Unplug the USB. Put the ESP32 at the end of the breadboard and connect <b>GND</b> to the GND rail and <b>5V</b> to the 5V rail. Check twice: 5V and GND swapped damages the board.</li>
    <li>Status LED: GPIO26 → 330 Ω → LED anode (long leg); cathode → GND rail.</li>
    <li>Button: GPIO27 to one side of the button, the opposite side to the GND rail (use legs on opposite corners).</li>
    <li>Sensor: VCC to <b>3V3</b> (not 5V), GND to the GND rail, AOUT to GPIO34. Put the 100 kΩ from GPIO34 to GND.</li>
    <li>MOSFET with the printed face toward you: gate, drain, source from left to right. Gate ← 100 Ω ← GPIO25. 10 kΩ from gate to GND. Source to GND.</li>
    <li>Pump: “+” wire to the 5V rail, “−” wire to the drain. Diode across the pump: anode on the drain, band on 5 V. Capacitor: long leg on 5 V, short leg on GND.</li>
    <li><b>Test without water:</b> leave the pump out of the tank, upload, and watch the Serial Monitor. Pump in a dry glass must not run for more than a couple of seconds, so for this step disconnect the pump “−” wire and watch the LED instead (solid while it would pump).</li>
    <li>Calibrate (next section), edit the constants, upload again.</li>
    <li>Pump in the tank, hose end clipped over the pot (not touching the soil), sensor in the soil up to its white line, close to where the water lands but not under it.</li>
  </ol>

  <h3>Calibration</h3>
  <ol class="steps-list">
    <li>With the sketch running, read <code>raw=</code> on the Serial Monitor with the sensor <b>in dry air</b>. Wait 10 s and note a typical value: that is <code>RAW_DRY</code> (the sketch has ${s.rawDry}).</li>
    <li>Put the sensor in a glass of water <b>up to the white line</b>, not deeper. Note the value: that is <code>RAW_WET</code> (${s.rawWet} in the sketch). Dry the sensor.</li>
    <li>Check your values are inside <code>RAW_VALID_MIN</code> and <code>RAW_VALID_MAX</code> (${s.rawValidMin} and ${s.rawValidMax}). If not, change those too, keeping some margin.</li>
    <li>Put the sensor in the pot when the soil is as dry as you will let it get, and again an hour after a good watering. Choose <code>DRY_ON_PERCENT</code> and <code>WET_OFF_PERCENT</code> from those two percentages. Leave at least 15 points between them.</li>
    <li>Measure the pump: run it 10 s into a measuring jug. Most small pumps give 1 to 2 L per minute (15 to 30 ml/s). If yours is stronger, shorten <code>PULSE_MS</code> so one pulse is less than a cup.</li>
  </ol>
  <p class="note">The calibration bench in the Simulation tab does steps 1 and 2 on the simulated sensor.</p>

  <h3>What the hardware can and cannot detect</h3>
  ${table(['Fault', 'Detected?', 'How, or what it would need'], FAULTS.map((f) => [esc(f.fault), `<b>${seen(f.seen)}</b>`, esc(f.how)]))}

  <h3>Diagnosis</h3>
  ${table(['Symptom', 'Likely cause', 'What to check'], [
    ['The board resets when the pump starts', 'Supply too weak', 'Use a 1.5 A or 2 A charger and a short, good cable. Check the 470 µF is fitted, long leg on 5 V.'],
    ['LED blinks once, then pauses (code 1)', 'Sensor reading not valid', 'Serial Monitor raw value: near 0 = AOUT wire off or sensor GND missing; near 4095 = AOUT shorted to 3.3 V.'],
    ['LED blinks twice (code 2)', 'Soil did not get wetter', 'Tank level, hose kinked, pump outlet facing the right way, hose end over the pot. Then press the button.'],
    ['LED blinks three times (code 3)', 'Pump time limit reached', 'Weak pump or long hose: measure the flow. The sensor may be far from where the water lands.'],
    ['Pump never stops in a test (pump wire on, LED off)', 'MOSFET wired wrong or damaged', 'Unplug at once. Check G, D, S order and that the gate goes to 100 Ω, not straight to 5 V.'],
    ['Pump never runs, LED solid', 'Power path', 'Pump “+” on the 5V rail, “−” on the drain; source on GND; diode band toward 5 V.'],
    ['Readings jump around', 'Noise', 'Shorter sensor cable, keep it away from the pump wires, check the sensor GND.'],
    ['Moisture reads 0 % or 100 % all the time', 'Calibration', 'RAW_DRY and RAW_WET swapped or from another sensor. Repeat the calibration.'],
  ].map((r) => r.map(esc)))}

  <h3>Exercises</h3>
  <ol class="steps-list">
    <li>Set the thresholds to 50 % and 52 % and the noise on. What does the pump do near 50 %? Now set 35 % and 60 %. <details><summary>Answer</summary>With 2 points of hysteresis the filtered value crosses both thresholds often, so episodes start and end close together. With 25 points, noise is far smaller than the gap.</details></li>
    <li>Turn the pull-down off, then pull the sensor wire off. Why is this worse than with the resistor? <details><summary>Answer</summary>A floating pin drifts through values that look valid, so the sensor check does not fire. Only the no-response check catches it, after one pulse. With 100 kΩ the pin reads about 0 and the fault is found in 2 s.</details></li>
    <li>Empty the tank. How much pump time is spent before the lock, and why is that the minimum with this hardware? <details><summary>Answer</summary>One pulse (3 s). The program cannot see the tank; it learns only from the soil not changing. A float switch would stop it before the first pulse.</details></li>
    <li>Make the soak 10 s instead of 60 s in your head: what goes wrong with a sensor 5 cm from where the water lands? <details><summary>Answer</summary>The water has not reached it yet, so the soil looks unchanged and the program locks with code 2, or keeps pumping and overshoots.</details></li>
    <li>Why is the pump pin written only in <code>enterState()</code>? <details><summary>Answer</summary>So one rule decides it: pump on only in WATERING. No other part of the program can leave it on by mistake.</details></li>
  </ol>

  <h3>Safety</h3>
  <ul class="explain-list">
    <li>Only low voltage: 5 V from a USB charger. No mains pumps, no relays to mains, no 230 V near water.</li>
    <li>Water below the electronics, a tray under the pot, the breadboard on a dry shelf. Route the hose and the cables with a drip loop (a dip before they reach the board) so drops fall off before the board.</li>
    <li>Use a small tank (0.5 L): the worst failure (MOSFET shorted, pump on) can then spill at most that.</li>
    <li>A breadboard is for learning. For a permanent build solder the circuit and put it in a closed box.</li>
    <li>Never let a submersible pump run dry for long: it can overheat. The lock limits it to one pulse.</li>
  </ul>`;
};

export default {
  id: 'esp32-plant-watering',
  number: 2,
  title: 'Smart Plant Watering',
  chapter: 'Measure, decide, switch',
  codeTab: 'Arduino C++',
  defaultView: 'circuit',
  viewButtons,
  views: {
    circuit: { t: [7.0, 1.0, -1.4], r: 21, phi: 0.84, theta: 0.12 },
    wiring: { t: [5.6, 0.6, 1.2], r: 10.5, phi: 0.72, theta: 0 },
    pins: { t: [4.6, 0.6, -2.4], r: 6.4, phi: 0.78, theta: 0.1 },
    water: { t: [9.8, 1.4, -4.0], r: 11, phi: 0.92, theta: 0.55 },
    sensor: { t: [10.4, 2.0, -5.3], r: 6.8, phi: 1.0, theta: 0.45 },
    pump: { t: [9.9, 0.8, -2.4], r: 6.5, phi: 0.9, theta: 0.4 },
  },
  pageContent: ESP32_PLANT_PAGE,
  textures: () => ({
    left: leftPageTexture(ESP32_PLANT_PAGE),
    right: rightPageTexture({
      fig: 'FIG. 2', caption: 'Soil → sensor → GPIO34 → filter → state machine → GPIO25 → MOSFET → pump', page: 4,
      hint: 'Click the red button or the soil sensor in the scene, or use the notebook.',
    }),
  }),

  async create(env) {
    const scene = buildPlantScene();
    let source = null;
    for (let attempt = 0; attempt < 3 && source == null; attempt++) {
      try {
        const res = await fetch('arduino/plant_watering/plant_watering.ino', { cache: 'no-store' });
        if (res.ok) source = await res.text();
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    source ??= '// Could not load arduino/plant_watering/plant_watering.ino. Start the project with: npm start';
    const { settings: S, missing } = parseSettings(source);

    /* ---------- state ---------- */
    const storage = { lock: LOCK.NONE }; // the simulated flash (Preferences)
    let world = new PlantWorld();
    let buttonDown = false;
    let speed = 10;
    let devMs = 0, passMs = 0, pumpMs = 0, lastHist = -1e9;
    const clockBase = 0;
    let popT = 0, autoStart = false, ui = null;
    let pickWhat = null, pressMoved = false;
    let hist = [];
    let guided = null;
    const view = { pump: 0, led: 0, button: 0, flow: 0 };

    const io = {
      readAdc: () => world.readAdc(S),
      readButton: () => (buttonDown ? 0 : 1),
      loadLock: () => storage.lock,
      saveLock: (n) => (storage.lock = n),
      onEvent: (ev) => onEvent(ev),
    };
    const ctrl = new PlantWatering(S, io);
    const log = (t, c) => ui && ui.log(t, c);
    const now = () => clockBase + passMs;
    const percentSeen = () => (ctrl.filterReady() ? ctrl.currentPercent() : null);

    function onEvent(ev) {
      if (ev.type === 'state') {
        const t = `${fmtS(passMs)}`;
        if (ev.to === 'WATERING') {
          log(`>>> ${t}  state: ${ev.from} → WATERING   # pump on for ${S.pulseMs / 1000} s (moisture ${ctrl.percentBeforePulse} %)`, 'p');
          scene.pulse('pump', '#7be3a0');
        } else if (ev.to === 'SOAKING') log(`>>> ${t}  state: WATERING → SOAKING   # pump off, wait ${S.soakMs / 1000} s (pump total ${fmtS(ctrl.pumpTotalMs)})`, 'p');
        else if (ev.to === 'IDLE' && ev.from === 'SOAKING') log(`>>> ${t}  state: SOAKING → IDLE   # wet enough`, 'p');
        else if (ev.to === 'IDLE') log(`>>> ${t}  state: ${ev.from} → IDLE`, 'p');
        else if (ev.to === 'LOCKED' && ev.from === 'STOPPED') log(`# setup(): a lock saved in flash is still there: ${LOCK_TEXT[ctrl.lockReason]}`, 'c');
      } else if (ev.type === 'lock') {
        log(`>>> ${fmtS(passMs)}  LOCKED: ${LOCK_TEXT[ev.reason]} (code ${ev.reason}, saved in flash)`, 'p');
        scene.pulse('led', '#ff7a5a');
      } else if (ev.type === 'check') {
        log(`# after soaking: ${ev.percent} % (was ${ev.before} % before the pulse)`, 'c');
      } else if (ev.type === 'cleared') {
        log('# button: lock cleared, flash erased', 'c');
        scene.pulse('button', '#6fe3ff');
      } else if (ev.type === 'clear-refused') {
        log('# button: refused, the sensor reading is still not valid', 'c');
      } else if (ev.type === 'button') {
        scene.pulse('button', '#6fe3ff');
      }
    }

    /* ---------- program ---------- */
    function startProgram(why = 'run') {
      devMs = passMs = pumpMs = 0;
      lastHist = -1e9;
      hist = [];
      ctrl.setup(now());
      log(why === 'power' ? '# Power cycle: setup() runs again. RAM is lost, flash (the lock) is kept.' : '# setup(): the program starts. The filter needs 1.6 s before the first decision.', 'p');
      ui?.refresh();
    }
    function stopProgram(why) {
      const was = ctrl.running;
      ctrl.stop();
      if (was && why === 'user') log('# Stopped: pump and LED off.', 'c');
      ui?.refresh();
    }
    function powerCycle() {
      ctrl.stop();
      startProgram('power');
    }
    function resetWorld(opts = {}) {
      world = new PlantWorld({}, 12345);
      Object.assign(world, opts);
      ui?.syncControls();
    }

    /* ---------- guided experiments ---------- */
    const wait = (ms) => (st) => {
      st.until ??= devMs + ms;
      return devMs >= st.until;
    };
    const waitFor = (fn, maxMs) => (st) => {
      st.until ??= devMs + maxMs;
      return fn() || devMs >= st.until;
    };
    const doIt = (fn) => (st, mem) => (fn(mem), true);
    const fresh = (opts, thr) => doIt((mem) => {
      storage.lock = LOCK.NONE;
      buttonDown = false;
      ctrl.setThresholds(thr ? thr[0] : S.dryOn, thr ? thr[1] : S.wetOff);
      resetWorld(opts);
      startProgram('run');
      mem.p0 = ctrl.stats.pulses;
    });
    const press = [doIt(() => (buttonDown = true)), wait(150), doIt(() => (buttonDown = false)), wait(200)];
    const st = () => ctrl.state;
    const TESTS = [
      () => [
        fresh({ bulk: 25 }), wait(2000), waitFor(() => st() === 'IDLE' && ctrl.stats.pulses > 0, 600000),
        () => finish(st() === 'IDLE' && ctrl.lockReason === LOCK.NONE && world.bulk >= ctrl.s.wetOff && world.spillMl === 0,
          `Passed: ${ctrl.stats.pulses} pulses (${fmtS(pumpMs)} of pump), soil now ${pct(world.bulk)}, back to IDLE, nothing spilled.`,
          `Failed: state ${st()}, soil ${pct(world.bulk)}, pulses ${ctrl.stats.pulses}.`),
      ],
      () => [
        fresh({ bulk: 45, p: { ...world.p, evapPerS: 0 } }), wait(120000),
        () => finish(ctrl.stats.pulses === 0 && st() === 'IDLE',
          `Passed: two minutes at ${pct(world.bulk)} (between ${ctrl.s.dryOn} % and ${ctrl.s.wetOff} %) and the pump never ran.`,
          `Failed: ${ctrl.stats.pulses} pulses at ${pct(world.bulk)}.`),
      ],
      () => [
        fresh({ bulk: 20, tankMl: 0 }), waitFor(() => st() === 'LOCKED', 120000),
        () => finish(st() === 'LOCKED' && ctrl.lockReason === LOCK.NO_RESPONSE && pumpMs === S.pulseMs,
          `Passed: one dry pulse (${fmtS(pumpMs)}), then LOCKED with code 2 after the soak. The program learned it from the soil, not from the tank.`,
          `Failed: state ${st()}, reason ${LOCK_NAME[ctrl.lockReason]}, pump ${fmtS(pumpMs)}.`),
      ],
      () => [
        fresh({ bulk: 50 }), wait(5000), doIt((mem) => { world.sensor = 'disconnected'; mem.t0 = devMs; ui?.syncControls(); }),
        waitFor(() => st() === 'LOCKED', 10000),
        (s0, mem) => finish(st() === 'LOCKED' && ctrl.lockReason === LOCK.SENSOR && !ctrl.out.pump,
          `Passed: LOCKED with code 1 ${fmtS(devMs - mem.t0)} after the wire came off. The 100 kΩ pulled the pin to about 0.`,
          `Failed: state ${st()}, reason ${LOCK_NAME[ctrl.lockReason]}.`),
      ],
      () => [
        fresh({ bulk: 30, pumpStrength: WEAK_PUMP }), waitFor(() => st() === 'LOCKED', 1200000),
        () => finish(st() === 'LOCKED' && ctrl.lockReason === LOCK.TIMEOUT && pumpMs === S.maxWaterTotalMs,
          `Passed: the soil kept gaining a little, ${ctrl.stats.pulses} pulses, ${fmtS(pumpMs)} of pump time in total, then LOCKED with code 3. Not one millisecond more.`,
          `Failed: state ${st()}, reason ${LOCK_NAME[ctrl.lockReason]}, pump ${fmtS(pumpMs)}.`),
      ],
      () => [
        fresh({ bulk: 20, tankMl: 0 }), waitFor(() => st() === 'LOCKED', 120000), doIt((mem) => { mem.used = pumpMs; world.tankMl = 400; ui?.syncControls(); }),
        doIt(() => powerCycle()), wait(5000), doIt((mem) => (mem.afterBoot = st())), ...press, wait(1000),
        (s0, mem) => finish(mem.afterBoot === 'LOCKED' && st() !== 'LOCKED' && storage.lock === LOCK.NONE,
          `Passed: after the power cycle it was still LOCKED (saved in flash) and the pump stayed off. The button cleared it and the tank was full again, so it is now ${st()}.`,
          `Failed: after boot ${mem.afterBoot}, now ${st()}.`),
      ],
    ];
    function finish(ok, pass, fail) {
      guided.result = { ok, text: ok ? pass : fail };
      ui?.setGuided(guided.n, guided.result);
      log(`# Experiment ${guided.n + 1}: ${ok ? 'passed' : 'failed'}`, 'c');
      guided.done = true;
      return true;
    }
    function startGuided(n) {
      speed = GUIDED_SPEED;
      ui?.setSpeed(speed);
      guided = { n, steps: TESTS[n](), i: 0, st: {}, mem: {}, done: false };
      ui?.setGuided(n, null, true);
      log(`# Experiment ${n + 1} started at ${GUIDED_SPEED}×.`, 'c');
    }
    function stepGuided() {
      if (!guided) return;
      if (guided.done) {
        guided = null;
        ui?.setGuidedBusy(false);
        return;
      }
      const step = guided.steps[guided.i];
      if (step(guided.st, guided.mem)) {
        guided.st = {};
        guided.i++;
      }
    }
    function cancelGuided(msg) {
      if (!guided) return;
      ui?.setGuided(guided.n, { ok: false, text: msg });
      guided = null;
      ui?.setGuidedBusy(false);
    }

    /* ---------- labels ---------- */
    const A = scene.anchors;
    const labels = [
      { id: 'esp', title: 'ESP32-DevKitC', sub: 'WROOM-32E module', at: A.esp, side: 'left', hideNarrow: true },
      { id: 'io34', cls: 'compact', title: 'IO34 · sensor ADC', sub: () => `<span class="val">${ctrl.running ? ctrl.lastRaw : '–'} / 4095</span>`, at: A.pin.sensor, side: 'left' },
      { id: 'io25', cls: 'compact', title: 'IO25 · MOSFET gate', sub: () => `<span class="val">${hl(ctrl.out.pump)}</span>`, at: A.pin.pump, side: 'left', hideNarrow: true },
      { id: 'fet', cls: 'compact', title: 'IRLZ44N', sub: () => `<span class="val">${ctrl.out.pump ? 'on: pump current flows' : 'off'}</span>`, at: A.mosfet, side: 'right' },
      { id: 'diode', title: '1N5819', sub: 'flyback diode', at: A.diode, side: 'right', hideNarrow: true },
      { id: 'cap', title: '470 µF', sub: 'covers the pump start', at: A.cap, side: 'left', hideNarrow: true },
      { id: 'btn', cls: 'compact', title: 'Button · IO27', sub: () => `<span class="val">${buttonDown ? 'pressed · LOW' : 'released · HIGH'}</span>`, at: A.button, side: 'right' },
      { id: 'sensor', cls: 'compact', title: 'Soil sensor', sub: () => `<span class="val">${world.sensor === 'ok' ? 'connected' : world.sensor === 'short' ? 'shorted' : 'wire off'}</span> · click`, at: A.sensor, side: 'right' },
      { id: 'soil', cls: 'compact', title: 'Soil', sub: () => `<span class="val">${pct(world.bulk)}</span>`, at: A.soil, side: 'right' },
      { id: 'pump', cls: 'compact', title: 'Pump 5 V', sub: () => `<span class="val">${ctrl.out.pump ? (world.tankMl <= 0 ? 'running dry!' : world.hoseBlocked ? 'blocked!' : 'pumping') : 'off'}</span>`, at: A.pump, side: 'left' },
      { id: 'tank', cls: 'compact', title: 'Tank', sub: () => `<span class="val">${Math.round(world.tankMl)} ml</span>`, at: A.tank, side: 'right', hideNarrow: true },
    ];

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      autoStart = true;
      tabs.sim.innerHTML = simHtml(S);
      tabs.code.innerHTML = codeHtml(S);
      tabs.how.innerHTML = howHtml(S);
      const code = renderCode($('#code', tabs.code), source, 'cpp');
      bindCopy($('#copyBtn', tabs.code), () => source, $('#code', tabs.code));
      const L = {
        analog: code.find(/analogRead\(SENSOR_PIN\)/),
        idle: code.find(/filterReady\(\) && currentPercent\(\) < DRY_ON_PERCENT/),
        pulse: code.find(/now - stateSinceMs >= PULSE_MS/),
        soak: code.find(/now - stateSinceMs >= SOAK_MS/),
        locked: code.find(/case LOCKED:/),
        sensorLock: code.find(/lockOut\(LOCK_SENSOR, now\)/),
        noResp: code.find(/lockOut\(LOCK_NO_RESPONSE, now\)/),
        timeout: code.find(/lockOut\(LOCK_TIMEOUT, now\)/),
        pumpPin: code.find(/digitalWrite\(PUMP_PIN, next == WATERING/),
      };
      const unmatched = Object.entries(L).filter(([, v]) => v < 0).map(([k]) => k);
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim), 8);
      ui = { code, L, log: consoleLog, steps };

      const q = (s) => $(s, tabs.sim);
      const box = q('#pwBox'), main = q('#pwMain'), sub = q('#pwSub'), fill = q('#pwFill'), leftEl = q('#pwLeft'), totalEl = q('#pwTotal');
      const chSoil = q('#chSoil'), chAdc = q('#chAdc'), chFilt = q('#chFilt'), chProg = q('#chProg');
      const soilSlider = q('#soilSlider'), soilVal = q('#soilVal'), tankSlider = q('#tankSlider'), tankVal = q('#tankVal');
      const dryRange = q('#dryRange'), wetRange = q('#wetRange'), dryVal = q('#dryVal'), wetVal = q('#wetVal');
      const btnRun = q('#btnRun'), btnStop = q('#btnStop'), btnPower = q('#btnPower'), btnHold = q('#btnHold');
      const progEl = q('#progState'), speedInfo = q('#speedInfo'), clockInfo = q('#clockInfo');
      const optPull = q('#optPull'), optNoise = q('#optNoise'), optHose = q('#optHose'), optWeak = q('#optWeak'), optLabels = q('#optLabels');
      const radios = $$('input[name=sensorMode]', tabs.sim);
      const gp = Object.fromEntries($$('.gp-row', tabs.sim).map((r) => [r.dataset.k, r]));
      const speedBtns = $$('.speed', tabs.sim);
      const guidedItems = $$('#guided li', tabs.sim);
      const canvas = q('#pwCanvas'), calOut = q('#calOut');

      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Web simulation. No real GPIO is used.', 'c');
      consoleLog(`# Read from plant_watering.ino: dry ${S.dryOn} %, wet ${S.wetOff} %, pulse ${S.pulseMs / 1000} s, soak ${S.soakMs / 1000} s, limit ${S.maxWaterTotalMs / 1000} s, calibration ${S.rawDry}/${S.rawWet}.`, 'c');
      if (missing.length) consoleLog(`# Not found in the sketch (defaults used): ${missing.join(', ')}`, 'c');
      if (unmatched.length) consoleLog(`# Could not match these code lines to highlight: ${unmatched.join(', ')}`, 'c');

      let draggingSoil = false;
      soilSlider.addEventListener('pointerdown', () => (draggingSoil = true));
      for (const ev of ['pointerup', 'pointercancel', 'blur']) soilSlider.addEventListener(ev, () => (draggingSoil = false));
      soilSlider.addEventListener('input', () => {
        world.bulk = Number(soilSlider.value);
        world.surface = 0;
      });
      tankSlider.addEventListener('input', () => (world.tankMl = Number(tankSlider.value)));
      q('#btnRefill').addEventListener('click', () => (world.tankMl = world.p.tankMax));
      q('#btnEmpty').addEventListener('click', () => (world.tankMl = 0));
      const applyThr = () => {
        ctrl.setThresholds(Number(dryRange.value), Number(wetRange.value));
        dryRange.value = String(ctrl.s.dryOn);
        wetRange.value = String(ctrl.s.wetOff);
      };
      dryRange.addEventListener('input', applyThr);
      wetRange.addEventListener('input', applyThr);
      q('#btnThrReset').addEventListener('click', () => {
        dryRange.value = String(S.dryOn);
        wetRange.value = String(S.wetOff);
        applyThr();
      });
      radios.forEach((r) => r.addEventListener('change', () => {
        if (!r.checked) return;
        world.sensor = r.value;
        log(r.value === 'ok' ? '# Sensor cable connected.' : r.value === 'short' ? '# AOUT shorted to 3.3 V: the pin reads 4095.' : `# AOUT wire off: ${world.pulldown ? 'the 100 kΩ pulls the pin to about 0 V' : 'the pin floats and drifts'}.`, 'c');
      }));
      optPull.addEventListener('change', () => (world.pulldown = optPull.checked));
      optNoise.addEventListener('change', () => (world.noisy = optNoise.checked));
      optHose.addEventListener('change', () => (world.hoseBlocked = optHose.checked));
      optWeak.addEventListener('change', () => (world.pumpStrength = optWeak.checked ? WEAK_PUMP : 1));

      btnRun.addEventListener('click', () => !ctrl.running && startProgram('run'));
      btnStop.addEventListener('click', () => {
        cancelGuided('Cancelled: the program was stopped.');
        stopProgram('user');
      });
      btnPower.addEventListener('click', () => {
        cancelGuided('Cancelled: power cycle.');
        powerCycle();
      });
      const down = () => (buttonDown = true);
      const up = () => (buttonDown = false);
      btnHold.addEventListener('pointerdown', (e) => {
        btnHold.setPointerCapture?.(e.pointerId);
        down();
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) btnHold.addEventListener(ev, up);
      btnHold.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          down();
        }
      });
      btnHold.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && up());
      speedBtns.forEach((b) => b.addEventListener('click', () => {
        speed = Number(b.dataset.speed);
        ui.setSpeed(speed);
      }));
      guidedItems.forEach((li) => $('button', li).addEventListener('click', () => {
        if (guided) return;
        startGuided(Number(li.dataset.n));
        ui.setGuidedBusy(true);
      }));

      // calibration bench: its own sensor and its own noise, so it does not disturb the running simulation
      const bench = (pctValue, what) => {
        const w = new PlantWorld({}, 999 + Math.floor(Math.random() * 1000));
        w.bulk = pctValue;
        const reads = Array.from({ length: 32 }, () => w.readAdc(S));
        const avg = Math.round(reads.reduce((a, b) => a + b, 0) / reads.length);
        const lo = Math.min(...reads), hi = Math.max(...reads);
        calOut.innerHTML = `${what}: average <b>${avg}</b> (from ${lo} to ${hi} over 32 readings). The sketch has ${pctValue === 0 ? `RAW_DRY = ${S.rawDry}` : `RAW_WET = ${S.rawWet}`}. With your own sensor, put your average in that constant.`;
      };
      q('#btnCalDry').addEventListener('click', () => bench(0, 'In dry air'));
      q('#btnCalWet').addEventListener('click', () => bench(100, 'In water up to the line'));

      ui.setSpeed = (v) => speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v)));
      ui.setGuided = (n, result, started) => {
        const li = guidedItems[n];
        const em = $('em', li);
        li.classList.toggle('running', !!started);
        li.classList.toggle('ok', !!result && result.ok);
        li.classList.toggle('bad', !!result && !result.ok);
        em.textContent = started ? 'Running…' : result ? result.text : '';
        if (started) guidedItems.forEach((o) => o !== li && (o.classList.remove('running', 'ok', 'bad'), ($('em', o).textContent = '')));
      };
      ui.setGuidedBusy = (busy) => guidedItems.forEach((li) => ($('button', li).disabled = busy));
      ui.syncControls = () => {
        tankSlider.value = String(Math.round(world.tankMl));
        radios.forEach((r) => (r.checked = r.value === world.sensor));
        optPull.checked = world.pulldown;
        optNoise.checked = world.noisy;
        optHose.checked = world.hoseBlocked;
        optWeak.checked = world.pumpStrength < 1;
        dryRange.value = String(ctrl.s.dryOn);
        wetRange.value = String(ctrl.s.wetOff);
      };
      ui.refresh = () => {
        btnRun.disabled = ctrl.running;
        btnStop.disabled = !ctrl.running;
        if (!ctrl.running) code.setActive(-1);
      };
      ui.setSpeed(speed);
      ui.syncControls();
      ui.refresh();

      let lastDraw = 0;
      const setText = (el, t) => el.textContent !== t && (el.textContent = t);
      ui.frame = (tNow) => {
        const run = ctrl.running;
        const stName = ctrl.state;
        const seen = percentSeen();
        const t = now();

        // banner
        let m, s2;
        if (!run) {
          m = 'Program stopped';
          s2 = 'Pump and LED off. The simulated clock is stopped.';
        } else if (stName === 'IDLE') {
          m = 'Waiting: soil is fine';
          s2 = seen == null ? 'Filling the average (1.6 s) before the first decision.' : `Watering starts below ${ctrl.s.dryOn} %. Now ${seen} %.`;
        } else if (stName === 'WATERING') {
          m = 'Watering: pump on';
          s2 = world.tankMl <= 0 ? 'The tank is empty: the pump runs dry. The program cannot know yet.' : world.hoseBlocked ? 'The hose is blocked: no water arrives. The program cannot know yet.' : 'Water is going into the pot.';
        } else if (stName === 'SOAKING') {
          m = 'Soaking: pump off, waiting';
          s2 = `The water is spreading. Then it compares with ${ctrl.percentBeforePulse} % from before the pulse.`;
        } else {
          m = `LOCKED: code ${ctrl.lockReason}`;
          s2 = `${LOCK_TEXT[ctrl.lockReason]}. Pump off. Fix it, then press the button.`;
        }
        box.className = `alarm-box ${BANNER[run ? stName : 'STOPPED']}`;
        setText(main, m);
        setText(sub, s2);
        const rem = ctrl.remainingMs(t);
        const span = stName === 'WATERING' ? S.pulseMs : stName === 'SOAKING' ? S.soakMs : 0;
        fill.style.width = span ? `${(((span - rem) / span) * 100).toFixed(1)}%` : '0%';
        setText(leftEl, span ? `${fmtS(rem)} left in this ${stName === 'WATERING' ? 'pulse' : 'soak'}` : '');
        setText(totalEl, `pump time this episode: ${fmtS(ctrl.pumpTotalMs + (stName === 'WATERING' ? S.pulseMs - rem : 0))} of ${S.maxWaterTotalMs / 1000} s`);

        // chips
        setText($('b', chSoil), pct(world.bulk));
        setText($('b', chAdc), run ? String(ctrl.lastRaw) : '–');
        chAdc.classList.toggle('on', run && (ctrl.lastRaw < S.rawValidMin || ctrl.lastRaw > S.rawValidMax));
        setText($('b', chFilt), run && seen != null ? `${seen} %` : '–');
        setText($('b', chProg), run ? STATE_NAMES[stName] : 'STOPPED');
        chProg.className = `chip prog-${(run ? stName : 'STOPPED').toLowerCase()}`;

        const setRow = (k, txt, high) => {
          const lvl = $('.gp-level', gp[k]);
          setText(lvl, txt);
          lvl.classList.toggle('hi', !!high);
        };
        const volts = run ? (ctrl.lastRaw / 4095) * ELEC.adcFullScaleV : 0;
        setRow('sensor', run ? `${ctrl.lastRaw} · ≈${volts.toFixed(2)} V` : '–', false);
        setRow('pump', `${hl(ctrl.out.pump)} · ${ctrl.out.pump ? '3.3' : '0'} V`, ctrl.out.pump);
        setRow('led', `${hl(ctrl.out.led)}`, ctrl.out.led);
        setRow('button', `${hl(!buttonDown)}${buttonDown ? ' · pressed' : ''}`, !buttonDown);

        if (!draggingSoil && Number(soilSlider.value) !== Math.round(world.bulk)) soilSlider.value = String(Math.round(world.bulk));
        setText(soilVal, pct(world.bulk));
        if (document.activeElement !== tankSlider) tankSlider.value = String(Math.round(world.tankMl));
        setText(tankVal, `${Math.round(world.tankMl)} ml`);
        setText(dryVal, `${ctrl.s.dryOn} %`);
        setText(wetVal, `${ctrl.s.wetOff} %`);
        btnHold.classList.toggle('held', buttonDown);

        const ps = run ? `Program: running · ${STATE_NAMES[stName]}` : 'Program: STOPPED (pump and LED off)';
        setText(progEl, ps);
        progEl.classList.toggle('on', run);
        progEl.classList.toggle('stopped', !run);
        setText(speedInfo, `${speed}×`);
        setText(clockInfo, run ? `Simulated time since start: ${fmtS(devMs)}. At ${speed}× one real second is ${speed} simulated seconds. Water pumped: ${Math.round(world.pumpedMl)} ml.` : 'Simulated time stops with the program.');

        // highlighted code line
        let active = -1;
        if (run) {
          if (stName === 'IDLE') active = L.idle;
          else if (stName === 'WATERING') active = [L.pumpPin, L.pulse];
          else if (stName === 'SOAKING') active = L.soak;
          else active = ctrl.lockReason === LOCK.SENSOR ? L.sensorLock : ctrl.lockReason === LOCK.NO_RESPONSE ? L.noResp : L.timeout;
        }
        code.setActive(active);
        code.setTag(L.soak, run && stName === 'SOAKING' ? `← ${fmtS(rem)} left` : '');

        if (tNow - lastDraw > 80) {
          lastDraw = tNow;
          drawPlot(canvas);
        }
      };
    }

    const WIN = 300;
    function drawPlot(canvas) {
      const ctx = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const padL = 46, padR = 12, top = 14, plotH = 150, laneY = 186, laneH = 18, plotW = w - padL - padR;
      const tNow = devMs / 1000;
      const X = (t) => padL + ((t - (tNow - WIN)) / WIN) * plotW;
      const Y = (p) => top + (1 - p / 100) * plotH;
      const SANS = '"Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(padL, top, plotW, plotH);
      ctx.font = `13px ${SANS}`;
      ctx.fillStyle = '#8c93b3';
      ctx.textAlign = 'right';
      for (const p of [0, 50, 100]) ctx.fillText(`${p} %`, padL - 6, Y(p) + 4);
      const thr = (p, color, label) => {
        ctx.strokeStyle = color;
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padL, Y(p));
        ctx.lineTo(padL + plotW, Y(p));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(label, padL + 4, Y(p) - 4);
      };
      thr(ctrl.s.wetOff, '#4cc27a', `stop ${ctrl.s.wetOff} %`);
      thr(ctrl.s.dryOn, '#e0a53a', `start ${ctrl.s.dryOn} %`);
      const line = (key, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        let started = false;
        for (const r of hist) {
          if (r.t < tNow - WIN || r[key] == null) {
            started = false;
            continue;
          }
          const x = X(r.t), y = Y(r[key]);
          if (!started) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          started = true;
        }
        ctx.stroke();
      };
      line('soil', '#4aa8ff', 2.5);
      line('seen', '#c58cff', 2);
      ctx.fillStyle = '#8c93b3';
      ctx.textAlign = 'left';
      ctx.fillText('State', padL, laneY - 4);
      for (let i = 0; i < hist.length; i++) {
        const t1 = i + 1 < hist.length ? hist[i + 1].t : tNow;
        const a = Math.max(padL, X(hist[i].t)), b = Math.min(padL + plotW, X(t1));
        if (b <= a) continue;
        ctx.fillStyle = STATE_COLORS[hist[i].state] || '#555a70';
        ctx.fillRect(a, laneY, b - a, laneH);
      }
      ctx.fillStyle = '#8c93b3';
      ctx.textAlign = 'center';
      for (let s = 0; s <= WIN; s += 60) ctx.fillText(s === 0 ? 'now' : `-${s / 60} min`, Math.min(padL + plotW - 16, Math.max(padL + 16, X(tNow - s))), h - 6);
    }

    /* ---------- runtime ---------- */
    function resetAll() {
      ctrl.stop();
      storage.lock = LOCK.NONE;
      ctrl.setThresholds(S.dryOn, S.wetOff);
      world = new PlantWorld();
      buttonDown = false;
      speed = 10;
      guided = null;
      autoStart = false;
      hist = [];
      devMs = passMs = pumpMs = 0;
      view.pump = view.led = view.button = view.flow = 0;
    }

    return {
      root: scene.root,
      popDuration: scene.popDuration,
      labels,
      mountUI,
      unmountUI() {
        ui = null;
      },
      frameUI(t) {
        ui?.frame(t);
        ui?.steps.setActive(this.activeStep());
      },
      setPop(tp) {
        popT = tp;
        scene.setPop(tp);
      },
      update(time, dt, camera, viewportH) {
        if (autoStart && popT >= scene.popDuration - 0.2) {
          autoStart = false;
          startProgram('run');
        }
        if (ctrl.running) {
          devMs += dt * 1000 * speed;
          const target = Math.floor(devMs);
          while (passMs < target) {
            passMs++;
            ctrl.loop(now());
            if (ctrl.out.pump) pumpMs++;
            if (passMs % 10 === 0) world.step(0.01, ctrl.out.pump);
          }
          if (devMs - lastHist >= 250) {
            lastHist = devMs;
            hist.push({ t: devMs / 1000, soil: world.bulk, seen: percentSeen(), state: ctrl.state });
            if (hist.length > 1600) hist.splice(0, hist.length - 1600);
          }
        }
        stepGuided();

        const k = 1 - Math.exp(-dt * 14);
        view.pump += ((ctrl.out.pump ? 1 : 0) - view.pump) * k;
        view.led += ((ctrl.out.led ? 1 : 0) - view.led) * k;
        view.button += ((buttonDown ? 1 : 0) - view.button) * (1 - Math.exp(-dt * 25));
        view.flow += ((world.flowing ? world.pumpStrength : 0) - view.flow) * (1 - Math.exp(-dt * 6));
        const pumping = ctrl.out.pump;
        scene.update(time, dt, {
          soil: world.wetness, surface: world.surface, tank: world.tankMl / world.p.tankMax, flow: view.flow,
          gate: view.pump, pumpI: world.hoseBlocked && pumping ? Math.max(view.pump, 1) : view.pump, led: view.led, button: view.button,
          adc: ctrl.running ? ctrl.lastRaw / 4095 : 0, sensorMode: world.sensor, running: ctrl.running,
          dryRun: pumping && world.tankMl <= 0 ? 1 : 0, stall: pumping && world.hoseBlocked ? 1 : 0, locked: ctrl.state === 'LOCKED',
        }, camera, viewportH);
      },
      activeStep() {
        if (!ctrl.running) return -1;
        if (ctrl.state === 'WATERING') return 5;
        if (ctrl.state === 'SOAKING') return 7;
        if (ctrl.state === 'LOCKED') return 8;
        return ctrl.filterReady() ? 4 : 3;
      },
      /** Stop the program and every animation (page turn, reading mode, closing the book, back to the library). */
      stop(reason) {
        const was = ctrl.running;
        resetAll();
        if (ui) {
          ui.setSpeed(speed);
          ui.setGuidedBusy(false);
          ui.syncControls();
          ui.refresh();
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Run to start it again.', 'c');
          else if (was) ui.log('# Program stopped.', 'c');
        }
      },
      pick(raycaster) {
        if (popT < 2.4 || !scene.root.visible) return false;
        const hits = raycaster.intersectObjects(scene.hitMeshes(), false);
        if (!hits.length) return false;
        pickWhat = hits[0].object.userData.hit || null;
        return !!pickWhat;
      },
      pressStart() {
        pressMoved = false;
        if (pickWhat === 'button') buttonDown = true;
      },
      pressMove() {
        pressMoved = true;
      },
      pressEnd() {
        if (pickWhat === 'button') buttonDown = false;
        else if (pickWhat === 'sensor' && !pressMoved) {
          world.sensor = world.sensor === 'ok' ? 'disconnected' : 'ok';
          log(world.sensor === 'ok' ? '# Sensor cable plugged back in.' : '# You pulled the sensor cable (AOUT) off.', 'c');
          ui?.syncControls();
        }
        pickWhat = null;
      },
      releaseAll() {
        buttonDown = false;
        pickWhat = null;
      },
      runFromQuery(what) {
        if (what === 'run') autoStart = true;
      },
      debugOn() {
        autoStart = true;
      },
      inspect() {
        return {
          running: ctrl.running, state: ctrl.state, lockReason: ctrl.lockReason, stored: storage.lock, speed, devMs, pumpMs,
          out: { ...ctrl.out }, raw: ctrl.lastRaw, seen: percentSeen(), thresholds: [ctrl.s.dryOn, ctrl.s.wetOff],
          world: { bulk: world.bulk, tankMl: world.tankMl, sensor: world.sensor, spillMl: world.spillMl, pumpedMl: world.pumpedMl },
          guided: guided ? guided.n : null, hasUi: !!ui, buttonDown, pins: PINS, settings: { ...S },
        };
      },
      /** Test helpers. */
      debugWorld: () => world,
      debugGuided: (n) => {
        if (!guided) {
          startGuided(n);
          ui?.setGuidedBusy(true);
        }
      },
      debugSpeed: (v) => {
        speed = v;
        ui?.setSpeed(v);
      },
    };
  },
};
