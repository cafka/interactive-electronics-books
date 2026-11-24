import { buildDoorScene, DOOR_MAX, CONTACT_CLOSE_DEG, CONTACT_OPEN_DEG } from './scene.js';
import { leftPageTexture, rightPageTexture } from '../../textures.js';
import { ESP32_DOOR_PAGE } from './pageContent.js';
import { DoorAlarm, parseSettings, PINS, CLOSED, OPEN_LEVEL } from './doorAlarm.js';
import { $, $$, renderCode, bindCopy, createConsole, renderSteps } from '../../ui.js';

/*
 * ESP32 chapter 1: open door alarm.
 *   scene   src/books/esp32/scene.js      (ESP32-DevKitC, breadboard, parts, refrigerator / box, wires, particles)
 *   logic   src/books/esp32/doorAlarm.js  (a port of arduino/door_alarm/door_alarm.ino; constants are read from the sketch)
 *   page    src/books/esp32/pageContent.js
 * The simulation has no timers: everything advances with the frame clock in update(dt), so stopping the chapter is
 * enough to stop the program, the animation and the sound.
 */

const viewButtons = [['circuit', 'Assembly'], ['book', 'Whole book'], ['leftpage', 'Left page'], ['wiring', 'Wiring'], ['pins', 'ESP32 pins'], ['sensor', 'Door sensor'], ['box', 'Box version']];

const STEPS = [
  { title: 'The magnet closes the contact', text: 'With the door closed the magnet is next to the reed switch, so its two metal blades touch. That is a closed contact. Opening the door takes the magnet away and the blades spring apart.', view: 'sensor' },
  { title: 'The contact becomes a voltage', text: 'GPIO27 uses INPUT_PULLUP: a resistor inside the ESP32 pulls the pin up to 3.3 V. Contact open: the pin reads HIGH. Contact closed: the switch joins the pin to GND and it reads LOW. In this program LOW means “door closed”.', view: 'pins' },
  { title: 'Debounce, then trust it', text: 'Metal contacts bounce for a few milliseconds. The program accepts a new level only after it stays the same for 30 ms, so one door movement counts as one change.', view: 'wiring' },
  { title: 'The program measures time', text: 'When the open door is confirmed, the program stores millis(). Each pass of loop() subtracts it from the current millis(). At 30 000 ms the state becomes ALARM. There is no delay(), so the door is checked all the time.', view: 'circuit' },
  { title: 'Two outputs, one pattern', text: 'In ALARM the program switches the LED (GPIO26) and the buzzer driver (GPIO25) together: 200 ms on, 300 ms off. The GPIO25 pin only drives the base of a transistor. The buzzer current comes from the 5 V pin.', view: 'wiring' },
];

const SPEEDS = [1, 5, 10, 30];

const simHtml = (s) => `
  <p class="note sim-note"><b>Web simulation.</b> Open and close the door in the 3D scene (drag it, or click it), or use the controls below. Nothing here touches real hardware.</p>

  <div class="alarm-box closed" id="alBox">
    <div class="al-main" id="alMain" role="status">Door closed</div>
    <div class="al-sub" id="alSub">Counter at zero</div>
    <div class="al-bar" aria-hidden="true"><i id="alFill"></i></div>
    <div class="al-time"><span id="alElapsed">Open for 0.0 s</span><span id="alLeft">${s.openLimit / 1000} s left</span></div>
  </div>

  <div class="status-row four">
    <div class="chip" id="chDoor"><span>Door</span><b>closed</b></div>
    <div class="chip" id="chContact"><span>Contact</span><b>closed</b></div>
    <div class="chip" id="chPin"><span>GPIO${s.reedPin}</span><b>LOW</b></div>
    <div class="chip" id="chProg"><span>Program</span><b>CLOSED</b></div>
  </div>

  <h3>Door</h3>
  <div class="door-ctl">
    <label for="doorSlider">Door opening: <b id="doorVal">0°</b></label>
    <input type="range" id="doorSlider" min="0" max="90" step="1" value="0" aria-label="Door opening angle in degrees">
    <div class="btn-row">
      <button id="btnOpenDoor" class="btn">Open door</button>
      <button id="btnCloseDoor" class="btn">Close door</button>
    </div>
    <fieldset class="mount-pick"><legend>Where the sensor is mounted</legend>
      <label><input type="radio" name="mount" value="fridge" checked> Refrigerator</label>
      <label><input type="radio" name="mount" value="box"> Cardboard box</label>
    </fieldset>
    <p class="note" id="mountNote">The contact closes when the door is within about ${CONTACT_CLOSE_DEG}° of closed and opens again beyond ${CONTACT_OPEN_DEG}°. The real distance depends on your magnet and must be tested on the real parts.</p>
  </div>

  <h3>Program</h3>
  <p class="prog-state" id="progState"></p>
  <div class="btn-row three">
    <button id="btnRun" class="btn accent">▶ Run</button>
    <button id="btnStop" class="btn">■ Stop</button>
    <button id="btnRestart" class="btn">↻ Restart</button>
  </div>
  <div class="speed-row" role="group" aria-label="Simulation speed">
    <span>Speed</span>
    ${SPEEDS.map((v) => `<button class="chip-btn speed" data-speed="${v}" aria-pressed="${v === 1}">${v}×</button>`).join('')}
    <b id="speedInfo">1×</b>
  </div>
  <p class="note" id="clockInfo"></p>

  <h3>Pin levels</h3>
  <div class="gp-grid" id="gpGrid">
    <div class="gp-row" data-k="reed"><i class="gp-dot" style="--c:#3f7be0"></i><div class="gp-name"><b>GPIO${s.reedPin} · IO${s.reedPin}</b><span>reed switch · input with pull-up</span></div><div class="gp-level">HIGH</div></div>
    <div class="gp-row" data-k="led"><i class="gp-dot" style="--c:#e2b623"></i><div class="gp-name"><b>GPIO${s.ledPin} · IO${s.ledPin}</b><span>red LED · output</span></div><div class="gp-level">LOW</div></div>
    <div class="gp-row" data-k="buzzer"><i class="gp-dot" style="--c:#2e9e55"></i><div class="gp-name"><b>GPIO${s.buzzerPin} · IO${s.buzzerPin}</b><span>buzzer driver (transistor base) · output</span></div><div class="gp-level">LOW</div></div>
  </div>

  <h3>Options</h3>
  <div class="options col">
    <label><input type="checkbox" id="optSound"> Play the buzzer sound (off by default; only at 1×)</label>
    <label><input type="checkbox" id="optBounce"> Simulate contact bounce</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <p class="note" id="bounceInfo">Raw edges seen by the program: <b id="rawEdges">0</b> · changes accepted after debounce: <b id="accEdges">0</b></p>

  <h3>Guided tests</h3>
  <ol class="guided" id="guided">
    <li data-n="0"><b>Open and close before 30 s.</b> <span>The door is opened for 10 s, then closed. Expected: no alarm, counter back to zero.</span><button class="chip-btn">Start test 1</button><em></em></li>
    <li data-n="1"><b>Hold it open until it sounds.</b> <span>Expected: the alarm starts after 30 s and beeps 200 ms on, 300 ms off.</span><button class="chip-btn">Start test 2</button><em></em></li>
    <li data-n="2"><b>Close it while it sounds.</b> <span>Expected: LED and buzzer stop at once, even in the middle of a beep.</span><button class="chip-btn">Start test 3</button><em></em></li>
    <li data-n="3"><b>Reopen it and check the count restarts.</b> <span>Expected: after closing and reopening, the count starts again from zero.</span><button class="chip-btn">Start test 4</button><em></em></li>
  </ol>
  <p class="note">Tests run at 10× so you do not wait 30 s. The code still uses its real 30 s limit.</p>

  <h3>Timeline</h3>
  <canvas id="tlCanvas" class="tl-canvas" width="760" height="170" role="img" aria-label="Timeline of the door and of the program state"></canvas>
  <p class="note" id="tlLegend">Last 60 s of simulated time.</p>

  <h3>Console</h3>
  <div class="console" id="console" aria-live="off"></div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = (s) => `
  <p>Arduino C++ for the ESP32-DevKitC. This file is the one that runs on the board, the one the simulation follows and the one you download. The loop never blocks: it reads <code>millis()</code> and decides what to do on every pass.</p>
  <div class="code-head"><span>door_alarm.ino</span>
    <span class="code-actions"><button id="copyBtn" class="chip-btn">Copy</button><a id="dlLink" class="chip-btn" href="arduino/door_alarm/door_alarm.ino" download="door_alarm.ino">Download</a></span></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What each part does</h3>
  <ul class="explain-list">
    <li><code>REED_PIN</code>, <code>LED_PIN</code>, <code>BUZZER_PIN</code>: ESP32 GPIO numbers (${s.reedPin}, ${s.ledPin}, ${s.buzzerPin}). They are not the positions on the header.</li>
    <li><code>pinMode(REED_PIN, INPUT_PULLUP)</code> turns on the internal pull-up. The contact joins the pin to GND, so closed = <code>LOW</code>.</li>
    <li><code>OPEN_LIMIT_MS</code>, <code>DEBOUNCE_MS</code>, <code>BEEP_ON_MS</code>, <code>BEEP_OFF_MS</code>: all the timings, in milliseconds. The simulation reads them from this file.</li>
    <li><code>enum State</code> and <code>state</code>: the program is always in one of three states: closed, open (counting) or alarm.</li>
    <li><code>readDoor()</code> is the debounce: a new reading is accepted only after <code>DEBOUNCE_MS</code> without changes.</li>
    <li><code>now - openedAtMs &gt;= OPEN_LIMIT_MS</code> uses unsigned subtraction, so the result stays right when <code>millis()</code> wraps to zero after about 49.7 days.</li>
    <li>In <code>ALARM</code> the program flips <code>beepOn</code> by checking the clock. There is no <code>delay()</code>, so closing the door is noticed within one pass of <code>loop()</code>.</li>
    <li>If the door is already open at power-on, <code>setup()</code> starts the count from that moment.</li>
  </ul>
  <h3>Upload it to your ESP32</h3>
  <ol class="steps-list">
    <li>Install the Arduino IDE and add the <b>esp32 by Espressif Systems</b> board package (Boards Manager).</li>
    <li>Download <code>door_alarm.ino</code> and put it in a folder called <code>door_alarm</code>.</li>
    <li>Choose the board <b>ESP32 Dev Module</b> and its USB port, then press Upload. If it does not connect, hold the BOOT button while it starts uploading.</li>
    <li>Open the Serial Monitor at 115200 baud to see the state messages.</li>
  </ol>
  <p class="note">This page is a web simulation. It was checked against a compiled copy of this sketch on a PC, but it has not been run on a real ESP32 or with real parts.</p>`;

const howHtml = (s) => `
  <p>Click a step to move the camera. The highlighted step follows what the program is doing.</p>
  <ol class="steps" id="steps"></ol>

  <h3>The path of the signal</h3>
  <p class="path-line"><b>magnet</b> → <b>reed contact</b> → <b>GPIO${s.reedPin}</b> → <b>30 s timer</b> → <b>LED</b> and <b>buzzer</b></p>

  <h3>Board and pins</h3>
  <p>The board is an <b>ESP32-DevKitC with an ESP32-WROOM-32E module</b> (the 38-pin version). Other ESP32 boards, even with the same chip, can put the pins in other places. Check the pin table of your board before copying a wiring.</p>
  <table class="wiring">
    <tr><th>Name</th><th>Where on the board</th><th>Used for</th></tr>
    <tr><td>GPIO${s.buzzerPin} (IO${s.buzzerPin})</td><td>left header, 9th pin from the antenna end</td><td>transistor base, through 1 kΩ</td></tr>
    <tr><td>GPIO${s.ledPin} (IO${s.ledPin})</td><td>left header, 10th pin</td><td>LED, through 330 Ω</td></tr>
    <tr><td>GPIO${s.reedPin} (IO${s.reedPin})</td><td>left header, 11th pin</td><td>reed switch input</td></tr>
    <tr><td>GND</td><td>left header, 14th pin</td><td>common ground rail</td></tr>
    <tr><td>5V</td><td>left header, last pin (19th)</td><td>buzzer supply (it is the USB 5 V)</td></tr>
  </table>
  <p class="note">GPIO25, 26 and 27 are not boot-strapping pins and are not connected to the module's flash (GPIO6 to 11), so they are safe to use here. Power the board from only one source: USB here.</p>

  <h3>Parts</h3>
  <table class="wiring">
    <tr><th>Part</th><th>Value</th><th>Why</th></tr>
    <tr><td>Reed switch</td><td>normally open (Standex-Meder MK04-1A66B-500W is one example)</td><td>closed with the magnet near, open when it leaves</td></tr>
    <tr><td>Magnet</td><td>small neodymium disc</td><td>on the door; the distance that closes the contact depends on it</td></tr>
    <tr><td>LED + resistor</td><td>red, 330 Ω</td><td>(3.3 V − about 2 V) / 330 Ω ≈ 4 mA</td></tr>
    <tr><td>Buzzer</td><td>5 V magnetic buzzer with built-in driver (for example Same Sky CMI-1295IC-0585T: 4–7 V, up to 30 mA, 2.4 kHz)</td><td>makes the sound by itself when powered</td></tr>
    <tr><td>Transistor</td><td>2N3904 (NPN)</td><td>switches the buzzer's ground</td></tr>
    <tr><td>Base resistor</td><td>1 kΩ</td><td>(3.3 V − 0.7 V) / 1 kΩ ≈ 2.6 mA into the base</td></tr>
  </table>

  <h3>Why a transistor for the buzzer?</h3>
  <p>The buzzer is rated for 5 V and can take up to 30 mA. A GPIO pin gives 3.3 V. So the buzzer is connected between the board's 5 V pin and the transistor's collector, and the transistor connects its other side to GND. The GPIO pin only has to push about 2.6 mA into the base, far below what the pin can supply. 2.6 mA is much more than the buzzer's 30 mA needs from this transistor, so it switches fully on. The buzzer has its own driver inside, so no flyback diode is needed. A bare coil or a relay would need one.</p>
  <p class="note">2N3904 pins, flat side facing you: emitter, base, collector from left to right. If your buzzer clicks when the board starts, add a 10 kΩ resistor from the base to GND (optional).</p>

  <h3>Wiring recap</h3>
  <table class="wiring">
    <tr><th>From</th><th>To</th></tr>
    <tr><td>GPIO25 (IO25)</td><td>column 3, row j. 1 kΩ from column 3 to column 7 (row i). Transistor emitter 6, base 7, collector 8 (row f)</td></tr>
    <tr><td>Emitter, column 6</td><td>GND rail</td></tr>
    <tr><td>Collector, column 8</td><td>jumper to column 10: buzzer “−”. Buzzer “+” at column 12, jumper to the 5V rail</td></tr>
    <tr><td>GPIO26 (IO26)</td><td>column 20; 330 Ω to column 16; LED long leg (anode) in 16, short leg in 15; column 15 to the GND rail</td></tr>
    <tr><td>GPIO27 (IO27)</td><td>column 24; first wire of the sensor cable in the same column; second wire to the GND rail</td></tr>
    <tr><td>ESP32 GND and 5V</td><td>to the GND rail and the 5V rail</td></tr>
  </table>

  <h3>Safety and limits</h3>
  <ul class="explain-list">
    <li>Only low-voltage power from USB. Do not connect any of this to mains power, and do not use the alarm to switch anything on the refrigerator's power.</li>
    <li>A breadboard and loose wires are for learning. They are not meant to be a permanent installation, and not for damp places such as the inside of a refrigerator.</li>
    <li>What still needs real parts: how close the magnet must be for the contact to close, how loud the buzzer is, the real current of the buzzer and transistor, and the bounce of your switch.</li>
  </ul>`;

const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;
const hl = (v) => (v ? 'HIGH' : 'LOW');
const PROG_COLORS = { DOOR_CLOSED: '#2e9e55', DOOR_OPEN: '#e2b623', ALARM: '#d6453a', STOPPED: '#555a70' };
const PROG_NAMES = { DOOR_CLOSED: 'CLOSED', DOOR_OPEN: 'OPEN', ALARM: 'ALARM', STOPPED: 'STOPPED' };

export default {
  id: 'esp32-door-alarm',
  number: 1,
  title: 'Open Door Alarm',
  chapter: 'Input, time and output',
  codeTab: 'Arduino C++',
  defaultView: 'circuit',
  viewButtons,
  views: {
    circuit: { t: [6.3, 0.8, -1.2], r: 21, phi: 0.86, theta: 0.02 },
    wiring: { t: [5.2, 0.6, -0.6], r: 11, phi: 0.72, theta: 0 },
    pins: { t: [4.8, 0.6, -2.3], r: 6.4, phi: 0.78, theta: 0.1 },
    sensor: { t: [10.1, 2.4, -4.2], r: 7.4, phi: 1.02, theta: 0.5 },
    box: { t: [9.6, 0.9, -4.6], r: 8.2, phi: 0.86, theta: 0.45 },
  },
  pageContent: ESP32_DOOR_PAGE,
  textures: () => ({
    left: leftPageTexture(ESP32_DOOR_PAGE),
    right: rightPageTexture({
      fig: 'FIG. 1', caption: 'Magnet → reed switch → GPIO27 → 30 s timer → LED and buzzer', page: 2,
      hint: 'Drag the door in the scene, or use the controls in the notebook.',
    }),
  }),

  async create(env) {
    const scene = buildDoorScene();
    let source = null;
    for (let attempt = 0; attempt < 3 && source == null; attempt++) {
      try {
        const res = await fetch('arduino/door_alarm/door_alarm.ino', { cache: 'no-store' });
        if (res.ok) source = await res.text();
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    source ??= '// Could not load arduino/door_alarm/door_alarm.ino. Start the project with: npm start';
    const { settings: S, missing } = parseSettings(source);

    /* ---------- state ---------- */
    let mount = 'fridge';
    let doorDeg = 0; // 0 closed .. DOOR_MAX
    let doorGoal = null; // animated move target (deg) or null
    let grab = null; // { offset, start, moved } while the pointer holds the door
    let contactClosed = true; // the reed contact: closed = pin LOW
    let speed = 1;
    let running = false;
    let devMs = 0; // device time since the program started (ms, float)
    let passMs = 0; // last whole millisecond for which loop() ran
    let clockBase = 0; // millis() at program start (tests start near the 2^32 wrap)
    let lastElapsed = 0;
    let popT = 0;
    let autoStart = false;
    let cam = null;
    let ui = null;
    let pickAngle = null;
    let bounce = null; // { t0, from, to }
    let alarmCount = 0, openedAt = null, alarmAt = null, closeCmdAt = null, outOffAt = null;
    const view = { led: 0, buzzer: 0, reed: 0, input: 0, base: 0 };
    let hist = [];
    const audio = { on: false, ctx: null, osc: null, gain: null };
    let guided = null; // { n, steps, i, state }
    const BOUNCE_OFFSETS = [0, 2, 3, 6, 8, 12, 15]; // ms after the contact moves: an odd number of changes ends on the new level

    const rawLevel = (ms) => {
      const level = contactClosed ? CLOSED : OPEN_LEVEL;
      if (!bounce) return level;
      const o = ms - bounce.t0;
      if (o >= BOUNCE_OFFSETS[BOUNCE_OFFSETS.length - 1]) return level;
      const n = BOUNCE_OFFSETS.filter((x) => x <= o).length;
      return n % 2 === 1 ? bounce.to : bounce.from;
    };
    const io = { read: () => rawLevel(passMs), onEvent: (ev) => onEvent(ev) };
    const alarm = new DoorAlarm(S, io);

    const log = (t, c) => ui && ui.log(t, c);
    const maxDeg = () => DOOR_MAX[mount];
    const clampDeg = (d) => Math.min(maxDeg(), Math.max(0, d));
    const progState = () => alarm.state;
    const pushHist = () => {
      const last = hist[hist.length - 1];
      const rec = { t: devMs / 1000, door: contactClosed ? 0 : 1, prog: progState() };
      if (!last || last.door !== rec.door || last.prog !== rec.prog) hist.push(rec);
      if (hist.length > 80) hist.splice(0, hist.length - 80);
    };

    /* ---------- events from the program ---------- */
    function onEvent(ev) {
      if (ev.type === 'state') {
        if (ev.to === 'DOOR_OPEN') {
          openedAt = passMs;
          log(`>>> state: ${PROG_NAMES[ev.from] || ev.from} → OPEN   # the count starts`, 'p');
        } else if (ev.to === 'ALARM') {
          alarmCount++;
          alarmAt = passMs;
          log('>>> state: OPEN → ALARM   # 30 s open: LED and buzzer beep', 'p');
          scene.pulse('led', '#ff7a5a');
          scene.pulse('buzzer', '#ffb04a');
        } else if (ev.to === 'DOOR_CLOSED') {
          log(`>>> state: ${PROG_NAMES[ev.from] || ev.from} → CLOSED   # outputs off, counter at zero`, 'p');
        }
        ui?.markState(ev.to);
      } else if (ev.type === 'accepted') {
        log(`# debounce: GPIO${S.reedPin} stayed ${hl(ev.level)} for ${S.debounce} ms → accepted`, 'c');
        scene.pulse('reed', '#6fe3ff');
      }
    }

    /* ---------- the program ---------- */
    function startProgram(why = 'run') {
      bounce = null;
      devMs = 0;
      passMs = 0;
      lastElapsed = 0;
      alarmCount = 0;
      openedAt = alarmAt = closeCmdAt = outOffAt = null;
      hist = [];
      alarm.setup(clockBase);
      pushHist();
      log(why === 'restart' ? '# restart: state cleared, starts from the current door position' : '# setup(): the program starts', 'p');
      if (!contactClosed) log('# The door is already open: counting starts now.', 'c');
      ui?.refresh();
    }
    function stopProgram(why) {
      const was = alarm.running;
      lastElapsed = alarm.elapsedMs(clockBase + passMs);
      alarm.stop();
      mute();
      pushHist();
      if (was) log(why === 'user' ? '# Stopped: LED and buzzer off, counter halted.' : '# Program stopped: LED and buzzer off.', 'c');
      ui?.refresh();
    }
    running = false;

    /* ---------- the door ---------- */
    function setMount(m, quiet) {
      if (m === mount) return;
      mount = m;
      scene.setMount(m);
      doorDeg = 0;
      doorGoal = null;
      grab = null;
      if (ui) {
        ui.slider.max = String(maxDeg());
        ui.radios.forEach((r) => (r.checked = r.value === m));
      }
      if (!quiet) log(m === 'box' ? '# Mount: cardboard box. The lid carries the magnet.' : '# Mount: refrigerator. The door carries the magnet.', 'c');
    }
    const openGoal = () => (mount === 'box' ? 85 : 80);
    const toggleDoor = () => (doorGoal = doorDeg > 20 ? 0 : openGoal());

    function updateContact() {
      if (contactClosed && doorDeg > CONTACT_OPEN_DEG) setContact(false);
      else if (!contactClosed && doorDeg < CONTACT_CLOSE_DEG) setContact(true);
    }
    function setContact(closed) {
      const from = contactClosed ? CLOSED : OPEN_LEVEL;
      contactClosed = closed;
      const to = closed ? CLOSED : OPEN_LEVEL;
      if (ui?.optBounce.checked && alarm.running) bounce = { t0: passMs, from, to };
      if (!closed) closeCmdAt = null;
      else closeCmdAt = passMs;
      outOffAt = null;
      scene.pulse('reed', closed ? '#6fe3ff' : '#ffd27a');
      log(closed ? `# The magnet reaches the reed switch: contact closed, GPIO${S.reedPin} pulled to GND (LOW)` : `# The magnet leaves: contact open, the pull-up lifts GPIO${S.reedPin} to HIGH`, 'c');
      pushHist();
    }

    /* ---------- sound (optional, off by default, user-activated) ---------- */
    function enableSound(on) {
      audio.on = on;
      if (!on) {
        silence();
        return;
      }
      try {
        if (!audio.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          audio.ctx = new AC();
          audio.osc = audio.ctx.createOscillator();
          audio.gain = audio.ctx.createGain();
          audio.osc.type = 'square';
          audio.osc.frequency.value = 2400; // the buzzer's rated frequency
          audio.gain.gain.value = 0;
          audio.osc.connect(audio.gain).connect(audio.ctx.destination);
          audio.osc.start();
        }
        audio.ctx.resume();
      } catch {
        audio.on = false;
        if (ui) {
          ui.optSound.checked = false;
          log('# This browser could not start audio. The alarm is still shown on screen.', 'c');
        }
      }
    }
    function mute() {
      if (audio.gain) {
        audio.gain.gain.cancelScheduledValues(0);
        audio.gain.gain.value = 0;
      }
    }
    function silence() {
      // the audio graph is torn down, so nothing can keep sounding after the chapter stops
      if (audio.ctx) {
        try {
          audio.osc.stop();
          audio.osc.disconnect();
          audio.ctx.close().catch(() => {});
        } catch {}
      }
      audio.ctx = audio.osc = audio.gain = null;
    }
    function driveSound() {
      if (!audio.on || !audio.ctx) return;
      const want = alarm.running && speed === 1 && alarm.out.buzzer ;
      if (want && audio.ctx.state !== 'running') audio.ctx.resume();
      audio.gain.gain.setTargetAtTime(want ? 0.04 : 0, audio.ctx.currentTime, 0.004);
    }

    /* ---------- guided tests (scripted door movements, checked against what the program really did) ---------- */
    const wait = (ms) => (st) => {
      st.until ??= devMs + ms;
      if (devMs >= st.until) {
        st.until = null;
        return true;
      }
      return false;
    };
    const waitFor = (fn, maxMs = 90000) => (st) => {
      st.until ??= devMs + maxMs;
      if (fn()) {
        st.until = null;
        return true;
      }
      if (devMs >= st.until) {
        st.until = null;
        return true; // timed out: the check at the end of the test reports the failure
      }
      return false;
    };
    const doIt = (fn) => (st, mem) => (fn(st, mem), true);
    const restartClosed = doIt(() => {
      doorGoal = null;
      doorDeg = 0;
      contactClosed = true;
      startProgram('restart');
    });
    const open = doIt(() => (doorGoal = openGoal()));
    const close = doIt(() => (doorGoal = 0));
    const slam = doIt(() => {
      doorGoal = null;
      doorDeg = 0; // closed at once, in the middle of a beep
    });
    const isOpen = () => !contactClosed;
    const isClosed = () => contactClosed;
    const TESTS = [
      () => [
        restartClosed, wait(500), open, waitFor(isOpen, 5000), wait(10000), doIt((st, mem) => (mem.openFor = lastOpenMs())), close, waitFor(isClosed, 5000), wait(400),
        (st, mem) => {
          const ok = alarm.state === 'DOOR_CLOSED' && alarmCount === 0 && alarm.elapsedMs(clockBase + passMs) === 0 && !alarm.out.buzzer;
          return finish(ok, `Passed: the door was open for ${fmtS(mem.openFor)} (limit ${fmtS(S.openLimit)}). No alarm, LED and buzzer stayed off, counter back to zero.`, `Failed: state ${PROG_NAMES[alarm.state]}, alarms ${alarmCount}.`);
        },
      ],
      () => [
        restartClosed, wait(500), open, waitFor(() => alarm.state === 'ALARM'), wait(1100),
        () => {
          const t = (alarmAt - openedAt) / 1000;
          const ok = alarm.state === 'ALARM' && Math.abs(t - S.openLimit / 1000) < 0.3 && beepsSeen >= 2;
          return finish(ok, `Passed: the alarm started ${t.toFixed(1)} s after the door opened (limit ${S.openLimit / 1000} s) and beeps ${S.beepOn} ms on, ${S.beepOff} ms off.`, `Failed: alarm after ${t.toFixed(1)} s, beeps seen ${beepsSeen}.`);
        },
      ],
      () => [
        restartClosed, wait(500), open, waitFor(() => alarm.state === 'ALARM'), wait(700), waitFor(() => alarm.out.buzzer, 3000), slam,
        waitFor(() => alarm.state === 'DOOR_CLOSED', 3000), wait(300),
        () => {
          const dt = closeCmdAt != null && outOffAt != null ? outOffAt - closeCmdAt : null;
          const ok = alarm.state === 'DOOR_CLOSED' && !alarm.out.buzzer && !alarm.out.led && dt != null && dt < S.debounce + 60;
          return finish(ok, `Passed: the door closed in the middle of a beep and LED and buzzer were off ${dt} ms later (the debounce time is ${S.debounce} ms). The beep was not allowed to finish.`, `Failed: state ${PROG_NAMES[alarm.state]}, outputs ${alarm.out.buzzer ? 'on' : 'off'}.`);
        },
      ],
      () => [
        restartClosed, wait(500), open, waitFor(() => alarm.state === 'ALARM'), wait(800), close, waitFor(isClosed, 5000), wait(1000), open,
        waitFor(() => alarm.state === 'DOOR_OPEN', 5000), wait(300), doIt((st, mem) => (mem.e1 = alarm.elapsedMs(clockBase + passMs))), wait(5000),
        (st, mem) => {
          const e2 = alarm.elapsedMs(clockBase + passMs);
          const ok = mem.e1 < 3000 && e2 > mem.e1 + 3500 && e2 < 10000 && alarm.state === 'DOOR_OPEN';
          return finish(ok, `Passed: after the alarm, closing and reopening started a new count: ${fmtS(mem.e1)} soon after and ${fmtS(e2)} five seconds later (the old count was past 30 s), with no alarm.`, `Failed: count ${fmtS(mem.e1)} then ${fmtS(e2)}, state ${PROG_NAMES[alarm.state]}.`);
        },
      ],
    ];
    let beepsSeen = 0;
    const lastOpenMs = () => (openedAt != null ? passMs - openedAt : 0);
    function finish(ok, pass, fail) {
      guided.result = { ok, text: ok ? pass : fail };
      ui?.setGuided(guided.n, guided.result);
      log(`# Test ${guided.n + 1}: ${ok ? 'passed' : 'failed'}`, 'c');
      guided.done = true;
      return true;
    }
    function startGuided(n) {
      speed = 10;
      ui?.setSpeed(speed);
      beepsSeen = 0;
      guided = { n, steps: TESTS[n](), i: 0, st: {}, mem: {}, done: false, result: null };
      ui?.setGuided(n, null, true);
      log(`# Guided test ${n + 1} started at 10×.`, 'c');
    }
    function stepGuided() {
      if (!guided || guided.done) {
        if (guided?.done) {
          guided = null;
          ui?.setGuidedBusy(false);
        }
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
      ui?.setGuided(guided.n, { ok: false, text: msg || 'Cancelled.' });
      guided = null;
      ui?.setGuidedBusy(false);
    }

    /* ---------- labels ---------- */
    const A = scene.anchors;
    const sensorAt = A.sensor.fridge.clone();
    const doorAt = A.door.fridge.clone();
    const pinLabel = (key, gp) => () => {
      const lvl = key === 'reed' ? rawLevel(passMs) : key === 'led' ? alarm.out.led : alarm.out.buzzer;
      return `<span class="val">GPIO${gp} · ${hl(lvl)}</span>`;
    };
    const labels = [
      { id: 'esp', title: 'ESP32-DevKitC', sub: 'WROOM-32E module', at: A.esp, side: 'left', hideNarrow: true },
      { id: 'io27', cls: 'compact', title: 'IO27 · reed input', sub: pinLabel('reed', S.reedPin), at: A.pin.reed, side: 'right' },
      { id: 'io26', cls: 'compact', title: 'IO26 · LED', sub: pinLabel('led', S.ledPin), at: A.pin.led, side: 'left', hideNarrow: true },
      { id: 'io25', cls: 'compact', title: 'IO25 · buzzer driver', sub: pinLabel('buzzer', S.buzzerPin), at: A.pin.buzzer, side: 'left' },
      { id: 'gnd', title: 'GND', sub: 'common ground', at: A.pin.gnd, side: 'right', hideNarrow: true },
      { id: 'v5', title: '5V pin', sub: 'USB 5 V for the buzzer', at: A.pin.v5, side: 'right', hideNarrow: true },
      { id: 'led', cls: 'compact', title: 'Red LED', sub: () => `<span class="val">${alarm.out.led ? 'on' : 'off'}</span> · 330 Ω`, at: A.led, side: 'right' },
      { id: 'buzz', cls: 'compact', title: 'Buzzer 5 V', sub: () => `<span class="val">${alarm.out.buzzer ? 'sounding' : 'silent'}</span>`, at: A.buzzer, side: 'left' },
      { id: 'q', title: '2N3904', sub: 'switches the buzzer', at: A.transistor, side: 'left', hideNarrow: true },
      { id: 'sensor', cls: 'compact', title: 'Reed switch', sub: () => `<span class="val">${contactClosed ? 'contact closed · LOW' : 'contact open · HIGH'}</span>`, at: sensorAt, side: 'right' },
      { id: 'door', cls: 'compact', title: 'Door or lid', sub: () => `<span class="val">${Math.round(doorDeg)}° · ${contactClosed ? 'closed' : 'open'}</span> · magnet on it`, at: doorAt, side: 'left' },
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
        pull: code.find(/pinMode\(REED_PIN, INPUT_PULLUP\)/),
        debounce: code.find(/\(now - lastChangeMs\) >= DEBOUNCE_MS/),
        open: code.find(/if \(!doorIsClosed\(\)\) enterState\(DOOR_OPEN, now\)/),
        limit: code.find(/now - openedAtMs >= OPEN_LIMIT_MS/),
        beepOff: code.find(/beepOn && now - beepChangedMs >= BEEP_ON_MS/),
        beepOn: code.find(/!beepOn && now - beepChangedMs >= BEEP_OFF_MS/),
        closeAlarm: -1,
        closed: code.find(/case DOOR_CLOSED:/),
        alarmCase: code.find(/case ALARM:/),
      };
      L.closeAlarm = L.alarmCase >= 0 ? code.find(/enterState\(DOOR_CLOSED, now\)/, L.alarmCase) : -1;
      const unmatched = Object.entries(L).filter(([, v]) => v < 0).map(([k]) => k);
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim));
      ui = { code, L, log: consoleLog, steps };

      const q = (s) => $(s, tabs.sim);
      const box = q('#alBox'), main = q('#alMain'), sub = q('#alSub'), fill = q('#alFill'), elapsedEl = q('#alElapsed'), leftEl = q('#alLeft');
      const chDoor = q('#chDoor'), chContact = q('#chContact'), chPin = q('#chPin'), chProg = q('#chProg');
      const slider = q('#doorSlider'), doorVal = q('#doorVal');
      const btnRun = q('#btnRun'), btnStop = q('#btnStop'), btnRestart = q('#btnRestart');
      const progEl = q('#progState'), speedInfo = q('#speedInfo'), clockInfo = q('#clockInfo');
      const canvas = q('#tlCanvas');
      const optSound = q('#optSound'), optBounce = q('#optBounce'), optLabels = q('#optLabels');
      const gp = Object.fromEntries($$('.gp-row', tabs.sim).map((r) => [r.dataset.k, r]));
      const rawEl = q('#rawEdges'), accEl = q('#accEdges');
      const speedBtns = $$('.speed', tabs.sim);
      const guidedItems = $$('#guided li', tabs.sim);
      ui.slider = slider;
      ui.optSound = optSound;
      ui.optBounce = optBounce;
      ui.radios = $$('input[name=mount]', tabs.sim);

      // everything off when the notebook is (re)built
      audio.on = false;
      optSound.checked = false;
      slider.max = String(maxDeg());
      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      optSound.addEventListener('change', (e) => enableSound(e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Web simulation. No real GPIO is used.', 'c');
      consoleLog(`# Read from door_alarm.ino: limit ${S.openLimit / 1000} s, debounce ${S.debounce} ms, beeps ${S.beepOn}/${S.beepOff} ms, pins ${S.reedPin}/${S.ledPin}/${S.buzzerPin}.`, 'c');
      if (missing.length) consoleLog(`# Not found in the sketch (defaults used): ${missing.join(', ')}`, 'c');
      if (unmatched.length) consoleLog(`# Could not match these code lines to highlight: ${unmatched.join(', ')}`, 'c');

      let sliding = false;
      slider.addEventListener('pointerdown', () => (sliding = true));
      for (const ev of ['pointerup', 'pointercancel', 'blur']) slider.addEventListener(ev, () => (sliding = false));
      slider.addEventListener('input', () => {
        doorGoal = null;
        doorDeg = clampDeg(Number(slider.value));
      });
      q('#btnOpenDoor').addEventListener('click', () => (doorGoal = openGoal()));
      q('#btnCloseDoor').addEventListener('click', () => (doorGoal = 0));
      ui.radios.forEach((r) => r.addEventListener('change', () => r.checked && setMount(r.value)));
      btnRun.addEventListener('click', () => !alarm.running && startProgram('run'));
      btnStop.addEventListener('click', () => {
        cancelGuided('Cancelled: the program was stopped.');
        stopProgram('user');
      });
      btnRestart.addEventListener('click', () => {
        cancelGuided('Cancelled: the program was restarted.');
        startProgram('restart');
      });
      speedBtns.forEach((b) => b.addEventListener('click', () => {
        speed = Number(b.dataset.speed);
        ui.setSpeed(speed);
      }));
      guidedItems.forEach((li) => $('button', li).addEventListener('click', () => {
        if (guided) return;
        startGuided(Number(li.dataset.n));
        ui.setGuidedBusy(true);
      }));

      ui.setSpeed = (v) => {
        speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v)));
      };
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
      ui.markState = () => {};
      ui.refresh = () => {
        btnRun.disabled = alarm.running;
        btnStop.disabled = !alarm.running;
        code.setTag(L.pull, '');
        if (!alarm.running) code.setActive(-1);
      };
      ui.refresh();
      let lastMain = '';
      let lastDraw = 0;
      let flashKeys = null, flashUntil = 0;
      ui.flash = (keys) => {
        flashKeys = keys;
        flashUntil = devMs + 900;
      };

      ui.frame = (now) => {
        const run = alarm.running;
        const st = progState();
        const t = clockBase + passMs;
        const elapsed = run ? alarm.elapsedMs(t) : lastElapsed;
        if (run) lastElapsed = elapsed;
        const remaining = st === 'DOOR_OPEN' ? Math.max(0, S.openLimit - elapsed) : st === 'ALARM' ? 0 : run ? S.openLimit : 0;

        // banner
        let cls = 'closed', m = 'Door closed', s2 = 'Counter at zero. LED and buzzer off.';
        if (!run) {
          cls = 'stopped';
          m = 'Program stopped';
          s2 = `LED and buzzer off. The counter is halted at ${fmtS(elapsed)}.`;
        } else if (st === 'DOOR_OPEN') {
          cls = 'counting';
          m = 'Door open: counting';
          s2 = `${fmtS(remaining)} until the alarm. LED and buzzer off.`;
        } else if (st === 'ALARM') {
          cls = 'alarm';
          m = 'ALARM: door left open';
          s2 = alarm.out.buzzer ? 'Beep: LED and buzzer on.' : 'Silence between beeps.';
        }
        box.className = `alarm-box ${cls}${alarm.out.buzzer ? ' beep' : ''}`;
        if (m !== lastMain) {
          main.textContent = m;
          lastMain = m;
        }
        sub.textContent = s2;
        fill.style.width = `${Math.min(100, (elapsed / S.openLimit) * 100).toFixed(1)}%`;
        elapsedEl.textContent = `Open for ${fmtS(elapsed)}`;
        leftEl.textContent = st === 'ALARM' ? 'limit reached' : `${fmtS(remaining)} left`;

        // chips
        $('b', chDoor).textContent = contactClosed ? 'closed' : `open ${Math.round(doorDeg)}°`;
        chDoor.classList.toggle('on', !contactClosed);
        $('b', chContact).textContent = contactClosed ? 'closed' : 'open';
        chContact.classList.toggle('on', contactClosed);
        const raw = rawLevel(passMs);
        $('b', chPin).textContent = raw ? 'HIGH' : 'LOW';
        chPin.classList.toggle('on', !!raw);
        $('b', chProg).textContent = PROG_NAMES[st];
        chProg.className = `chip prog-${st.toLowerCase()}`;

        const setRow = (k, high) => {
          const lvl = $('.gp-level', gp[k]);
          const txt = `${high ? 'HIGH · 3.3 V' : 'LOW · 0 V'}${k === 'reed' ? (high ? ' · contact open' : ' · contact closed') : ''}`;
          if (lvl.textContent !== txt) lvl.textContent = txt;
          lvl.classList.toggle('hi', !!high);
        };
        setRow('reed', raw);
        setRow('led', alarm.out.led);
        setRow('buzzer', alarm.out.buzzer);

        doorVal.textContent = `${Math.round(doorDeg)}°`;
        if (!sliding && Number(slider.value) !== Math.round(doorDeg)) slider.value = String(Math.round(doorDeg));
        slider.setAttribute('aria-valuetext', `${Math.round(doorDeg)} degrees, ${contactClosed ? 'door closed' : 'door open'}`);

        const ps = run ? `Program: running · ${PROG_NAMES[st]}` : 'Program: STOPPED (LED and buzzer off, counter halted)';
        if (progEl.textContent !== ps) progEl.textContent = ps;
        progEl.classList.toggle('on', run);
        progEl.classList.toggle('stopped', !run);

        speedInfo.textContent = `${speed}×`;
        clockInfo.textContent = run
          ? `Simulated time since start: ${fmtS(devMs)}. At ${speed}× one real second is ${speed} simulated second${speed > 1 ? 's' : ''}.${speed > 1 && audio.on ? ' Sound plays only at 1×.' : ''}`
          : 'Simulated time stops with the program.';
        rawEl.textContent = String(alarm.stats.rawEdges);
        accEl.textContent = String(alarm.stats.accepted);

        // highlighted code: the line group that matters now
        let active = -1;
        if (run) {
          if (st === 'DOOR_CLOSED') active = L.closed;
          else if (st === 'DOOR_OPEN') active = L.limit;
          else active = alarm.beepOn ? L.beepOff : L.beepOn;
        }
        code.setActive(flashKeys && devMs < flashUntil ? flashKeys : active);
        code.setTag(L.limit, run && st === 'DOOR_OPEN' ? `← ${fmtS(elapsed)} of ${S.openLimit / 1000} s` : '');

        if (now - lastDraw > 66) {
          lastDraw = now;
          drawTimeline(canvas);
        }
      };
    }

    const WIN = 60;
    function drawTimeline(canvas) {
      const ctx = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const padL = 14, padR = 14, plotW = w - padL - padR;
      const now = devMs / 1000;
      const x = (t) => padL + ((t - (now - WIN)) / WIN) * plotW;
      const SANS = '"Segoe UI", system-ui, sans-serif';
      const lane = (y, hgt, title, pick) => {
        ctx.font = `600 16px ${SANS}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8c93b3';
        ctx.fillText(title, padL, y - 8);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(padL, y, plotW, hgt);
        for (let i = 0; i < hist.length; i++) {
          const t1 = i + 1 < hist.length ? hist[i + 1].t : now;
          const a = Math.max(padL, x(hist[i].t)), b = Math.min(padL + plotW, x(t1));
          if (b <= a) continue;
          const [col, txt] = pick(hist[i]);
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillRect(a, y, b - a, hgt);
          if (b - a > 70 && txt) {
            ctx.fillStyle = '#0d1020';
            ctx.font = `700 14px ${SANS}`;
            ctx.textAlign = 'center';
            ctx.fillText(txt, (a + b) / 2, y + hgt / 2 + 5);
          }
        }
      };
      lane(34, 36, 'Door', (r) => (r.door ? ['#e2b623', 'open'] : ['#2e9e55', 'closed']));
      lane(100, 36, 'Program', (r) => [PROG_COLORS[r.prog], PROG_NAMES[r.prog]]);
      ctx.fillStyle = '#8c93b3';
      ctx.font = `14px ${SANS}`;
      ctx.textAlign = 'center';
      for (let s = 0; s <= WIN; s += 20) {
        ctx.fillText(s === 0 ? 'now' : `-${s} s`, Math.min(padL + plotW - 14, Math.max(padL + 14, x(now - s))), h - 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(x(now - s), 22);
        ctx.lineTo(x(now - s), h - 24);
        ctx.stroke();
      }
    }

    /* ---------- the runtime the engine talks to ---------- */
    function silenceAll() {
      audio.on = false;
      silence();
      if (ui) ui.optSound.checked = false;
    }

    return {
      root: scene.root,
      popDuration: scene.popDuration,
      labels,
      mountUI,
      unmountUI() {
        ui = null;
      },
      frameUI(now) {
        ui?.frame(now);
        ui?.steps.setActive(this.activeStep());
      },
      setPop(tp) {
        popT = tp;
        scene.setPop(tp);
      },
      update(time, dt, camera, viewportH) {
        cam = camera;
        if (autoStart && popT >= scene.popDuration - 0.2) {
          autoStart = false;
          startProgram('run');
        }
        // the door: follows the pointer while grabbed, otherwise moves toward its goal
        if (grab) {
          // doorDeg is set by pressMove
        } else if (doorGoal != null) {
          const step = 150 * dt;
          const d = doorGoal - doorDeg;
          doorDeg = Math.abs(d) <= step ? doorGoal : doorDeg + Math.sign(d) * step;
          if (doorDeg === doorGoal) doorGoal = null;
        }
        updateContact();

        // the program: loop() runs once per simulated millisecond
        if (alarm.running) {
          devMs += dt * 1000 * speed;
          const target = Math.floor(devMs);
          while (passMs < target) {
            passMs++;
            const before = alarm.out.buzzer;
            alarm.loop(clockBase + passMs);
            if (alarm.out.buzzer && !before) beepsSeen++;
            if (closeCmdAt != null && outOffAt == null && alarm.state === 'DOOR_CLOSED' && !alarm.out.buzzer) outOffAt = passMs;
          }
          pushHist();
        }
        stepGuided();
        driveSound();

        const k = 1 - Math.exp(-dt * 16);
        view.led += ((alarm.out.led ? 1 : 0) - view.led) * k;
        view.buzzer += ((alarm.out.buzzer ? 1 : 0) - view.buzzer) * k;
        view.base += ((alarm.out.buzzer ? 1 : 0) - view.base) * k;
        view.reed += ((rawLevel(passMs) ? 1 : 0) - view.reed) * (1 - Math.exp(-dt * 20));
        view.input += ((contactClosed && alarm.running ? 1 : 0) - view.input) * (1 - Math.exp(-dt * 16));

        // labels that follow the active mount
        sensorAt.copy(A.sensor[mount]);
        doorAt.copy(A.door[mount]);
        scene.update(time, dt, {
          door: doorDeg, contact: contactClosed, reed: view.reed, led: view.led, buzzer: view.buzzer, input: view.input, base: view.base,
        }, camera, viewportH);
      },
      activeStep() {
        if (!alarm.running) return -1;
        if (alarm.state === 'ALARM') return 4;
        if (alarm.state === 'DOOR_OPEN') return 3;
        return 0;
      },
      /** Stop the program, the sound and every animation (page turn, reading mode, closing the book, back to the library). */
      stop(reason) {
        const was = alarm.running;
        if (was) {
          lastElapsed = 0;
          alarm.stop();
        }
        silenceAll();
        grab = null;
        doorGoal = null;
        doorDeg = 0;
        contactClosed = true;
        bounce = null;
        speed = 1;
        guided = null;
        autoStart = false;
        view.led = view.buzzer = view.reed = view.input = view.base = 0;
        hist = [];
        if (mount !== 'fridge') setMount('fridge', true);
        if (ui) {
          ui.setSpeed(1);
          ui.setGuidedBusy(false);
          ui.refresh();
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Run to start it again.', 'c');
          else if (was) ui.log('# Program stopped.', 'c');
        }
      },
      pick(raycaster) {
        if (popT < 2.2 || !scene.root.visible) return false;
        const hits = raycaster.intersectObjects(scene.hitMeshes(), false);
        if (!hits.length) return false;
        pickAngle = cam ? scene.angleFromRay(raycaster, cam) : null;
        return true;
      },
      pressStart() {
        doorGoal = null;
        grab = { offset: pickAngle != null ? pickAngle - doorDeg : 0, start: doorDeg, moved: false };
      },
      pressMove(raycaster, camera) {
        if (!grab) return;
        const a = scene.angleFromRay(raycaster, camera);
        if (a == null) return;
        const d = clampDeg(a - grab.offset);
        if (!grab.moved && Math.abs(d - grab.start) > 3) grab.moved = true;
        if (grab.moved) doorDeg = d;
      },
      pressEnd() {
        if (!grab) return;
        if (!grab.moved) toggleDoor();
        grab = null;
      },
      releaseAll() {
        grab = null;
      },
      runFromQuery(what) {
        if (what === 'run') autoStart = true;
      },
      /** Test helper (?led=on): arms the program to start as soon as the scene is built. */
      debugOn() {
        autoStart = true;
      },
      /** Test helpers. */
      debugSetDoor(deg) {
        doorGoal = null;
        doorDeg = clampDeg(deg);
      },
      debugSetClockBase(ms) {
        clockBase = ms >>> 0;
      },
      inspect() {
        return {
          running: alarm.running, state: alarm.state, doorDeg, contactClosed, mount, speed, devMs, passMs, elapsed: alarm.elapsedMs(clockBase + passMs),
          led: alarm.out.led, buzzer: alarm.out.buzzer, stats: { ...alarm.stats }, alarmCount, grab: !!grab, guided: guided ? guided.n : null,
          audio: { enabled: audio.on, state: audio.ctx ? audio.ctx.state : 'none', gain: audio.gain ? audio.gain.gain.value : 0 },
          hasUi: !!ui, clockBase, pins: PINS, settings: { ...S },
        };
      },
      debugSetMount: (m) => setMount(m),
    };
  },
};
