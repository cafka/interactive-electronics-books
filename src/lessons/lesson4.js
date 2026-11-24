import * as THREE from 'three';
import { buildTrafficCircuit } from '../circuitTraffic.js';
import { leftPageTexture, rightPageTexture } from '../textures.js';
import { PAGE_CONTENT } from '../pageContent.js';
import { TrafficMachine, parseSettings, PINS } from '../traffic.js';
import { $, $$, renderCode, bindCopy, createConsole, renderSteps } from '../ui.js';

/*
 * Chapter 4: traffic light with a pedestrian button.
 *   scene     src/circuitTraffic.js (shared parts: Pi, breadboard, LED, resistor, jumpers, push button)
 *   logic     src/traffic.js        (the state machine; timing constants are read from python/traffic_light.py)
 *   page      src/pageContent.js    (PAGE_CONTENT.traffic: left page and Read page)
 * The simulation has no timers: everything advances with the frame clock (update(dt)), so stopping the chapter is
 * enough to stop everything, and nothing can run on in the background.
 */

const STEPS = [
  { title: 'Each LED has its own pin', text: 'red = LED(17), yellow = LED(27) and green = LED(22) are three independent outputs. change_state() sets each one HIGH or LOW, so exactly one LED is on at a time.', view: 'gpio' },
  { title: 'Each LED has its own resistor', text: 'Every LED sits in its own branch: pin → 330 Ω → LED → GND. The resistor sets that LED’s current. Colors drop different voltages, so one shared resistor would give each color a different current.', view: 'leds' },
  { title: 'The button is read with the pull-up', text: 'Button(23, pull_up=True) turns on the Pi’s internal pull-up resistor. Released: GPIO23 reads HIGH (3.3 V). Pressed: the button joins it to GND and it reads LOW (0 V). The program treats LOW as “pressed”.', view: 'button' },
  { title: 'A state changes when its rule is met', text: 'The variable state remembers GREEN, YELLOW or RED. GREEN → YELLOW needs a request and the minimum green. YELLOW → RED needs 2 s. RED → GREEN needs 5 s.', view: 'circuit' },
  { title: 'Registering is not serving', text: 'A press only sets request = True: the request is registered. It is served when the lights run through yellow and red, and request goes back to False at the end. More presses change nothing.', view: 'circuit' },
];

const viewButtons = [['circuit', 'Circuit'], ['book', 'Whole book'], ['leftpage', 'Left page'], ['gpio', 'GPIO pins'], ['leds', 'Traffic LEDs'], ['button', 'Push button']];

const WALK_SVG = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.2" r="2.1" fill="currentColor" stroke="none"/><path d="M12 7.5 V14 M12 9 L8 12.5 M12 9 L16.5 11 M12 14 L9 21 M12 14 L16 20"/></svg>';

const ROWS = [
  ['red', 'LED', 'red LED · output', '#d6453a'],
  ['yellow', 'LED', 'yellow LED · output', '#d9a400'],
  ['green', 'LED', 'green LED · output', '#2e9e55'],
  ['button', 'IN', 'push button · input with pull-up', '#3f7be0'],
];

const simHtml = () => `
  <p class="note sim-note"><b>Web simulation.</b> Press the blue button in the 3D scene (hold it with the mouse or a finger), or use the pad below. Nothing here touches real hardware.</p>
  <div class="status-row" id="tlStatus">
    <div class="chip" id="tlState"><span>State</span><b>GREEN</b></div>
    <div class="chip" id="tlReq"><span>Request</span><b>none</b></div>
    <div class="chip" id="tlTime"><span>Timer</span><b>—</b></div>
  </div>

  <div class="walk wait" id="walk" role="status">
    <div class="walk-icon">${WALK_SVG}</div>
    <div class="walk-text"><b id="walkMain">Wait</b><span id="walkSub"></span></div>
    <div class="walk-count" id="walkCount" aria-hidden="true"></div>
  </div>
  <p class="walk-note">Pedestrian display: a teaching aid on screen. It is <b>not</b> a component of the circuit and uses no GPIO.</p>

  <h3>GPIO levels</h3>
  <div class="gp-grid" id="gpGrid">
    ${ROWS.map(([k, , role, color]) => `<div class="gp-row" data-k="${k}"><i class="gp-dot" style="--c:${color}"></i><div class="gp-name"><b>GPIO${PINS[k].bcm} · pin ${PINS[k].pin}</b><span>${role}</span></div><div class="gp-level">LOW · 0 V</div></div>`).join('')}
  </div>
  <p class="note">GPIO number (BCM) is the name Python uses. Pin is the physical position on the 40-pin header.</p>

  <button id="btnPress" class="press-pad" aria-pressed="false">
    <span class="pad-main">Hold to press the pedestrian button</span>
    <small>mouse, touch, or hold Space / Enter</small>
  </button>
  <p class="prog-state" id="progState"></p>
  <div class="btn-row three">
    <button id="btnRun" class="btn accent">▶ Run</button>
    <button id="btnStop" class="btn">■ Stop</button>
    <button id="btnRestart" class="btn">↻ Restart</button>
  </div>

  <h3>Timeline</h3>
  <canvas id="tlCanvas" class="tl-canvas" width="760" height="190" role="img" aria-label="Timeline of the traffic light phases and button presses"></canvas>
  <p class="note" id="tlLegend"></p>

  <div class="explore">
    <b>Try it</b>
    <p>What happens if you press the button several times during the red?</p>
    <button id="btnExplore" class="btn">Check it in the simulation</button>
    <p class="explore-result" id="exploreResult" aria-live="polite"></p>
    <details class="explore-answer"><summary>Show the answer</summary>
      <p>Nothing changes. During the red <code>request_crossing()</code> does nothing because <code>state</code> is not <code>"GREEN"</code>. The presses are not stored, no timer restarts and no second crossing happens. After the green is back, a new press is needed.</p>
    </details>
  </div>

  <h3>Console</h3>
  <div class="console" id="console" aria-live="off"></div>
  <div class="options"><label><input type="checkbox" id="optLabels"> Show labels</label></div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = (s) => `
  <p>Python with <code>gpiozero</code> for the Raspberry Pi 5. The loop never blocks: it checks the clock and pauses ${s.poll * 1000} ms, so a button press is noticed at any moment.
    Press <b>Run</b> in the Simulate tab to see the lines that run.</p>
  <div class="code-head"><span>traffic_light.py</span>
    <span class="code-actions"><button id="copyBtn" class="chip-btn">Copy</button><a id="dlLink" class="chip-btn" href="python/traffic_light.py" download="traffic_light.py">Download</a></span></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What each part does</h3>
  <ul class="explain-list">
    <li><code>LED(17)</code>, <code>LED(27)</code>, <code>LED(22)</code>: three outputs, one per light. The numbers are BCM GPIO numbers; the comments give the physical pin.</li>
    <li><code>Button(23, pull_up=True, bounce_time=0.05)</code>: an input that uses the internal pull-up and ignores contact bounce shorter than 50 ms.</li>
    <li><code>state</code> remembers the current state. <code>state_since</code> holds when it started, read with <code>monotonic()</code>, a clock that never jumps back.</li>
    <li><code>request</code> is <code>True</code> from the press until the crossing ends. That is “registered but not served yet”.</li>
    <li><code>change_state()</code> switches to a new state and sets the three LEDs. Only the matching one is on.</li>
    <li><code>request_crossing()</code> runs when the button is pressed (<code>when_pressed</code>). It only accepts the request in <code>"GREEN"</code>, so presses during yellow and red are ignored.</li>
    <li>The <code>while True</code> loop moves between states when their time is up. <code>sleep(POLL_SECONDS)</code> is a very short pause, not a wait for the whole phase.</li>
  </ul>
  <h3>Run it on your Raspberry Pi 5</h3>
  <ol class="steps-list">
    <li>Build the circuit shown in the book.</li>
    <li>Download <code>traffic_light.py</code> (it is also in this project's <code>python/</code> folder).</li>
    <li>Run <code>python3 traffic_light.py</code> and press the button.</li>
    <li>Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop.</li>
  </ol>
  <p class="note">The times at the top (<code>MIN_GREEN_SECONDS</code>, <code>YELLOW_SECONDS</code>, <code>CROSSING_SECONDS</code>) are read from this same file by the simulation. Change them and the demo follows. This page is a web simulation and does not control real hardware.</p>`;

const howHtml = (s) => `
  <p>Click a step to move the camera. The highlighted step follows what the program is doing.</p>
  <ol class="steps" id="steps"></ol>

  <h3>What is a state?</h3>
  <p>A state is the situation the program is in, remembered between loop passes. Here there are three: <b>GREEN</b>, <b>YELLOW</b> and <b>RED</b>. The state decides which LED is on and how the button is treated. A <b>transition</b> is the move from one state to the next, and each one has a rule.</p>
  <table class="wiring state-table">
    <tr><th>From → to</th><th>What causes it</th></tr>
    <tr><td>GREEN → YELLOW</td><td>a request is registered <b>and</b> green has lasted at least ${s.minGreen} s</td></tr>
    <tr><td>YELLOW → RED</td><td>${s.yellow} s have passed</td></tr>
    <tr><td>RED → GREEN</td><td>${s.crossing} s have passed; the request is cleared</td></tr>
  </table>

  <h3>Registering is not serving</h3>
  <p>Pressing the button only <b>registers</b> a request (<code>request = True</code>). The crossing is <b>served</b> later, when the lights go through yellow and red. Until then extra presses change nothing, and during yellow and red they are ignored on purpose, so no timer restarts and crossings do not pile up.</p>

  <h3>Why each LED has its own resistor</h3>
  <p>Each LED needs a resistor in series to limit its current. Different colors drop different voltages (a red LED about 2 V, green and blue more), so the same resistor would give each color a different current. With one resistor per LED, every branch is independent and you can change one without touching the others. A single shared resistor would also split its current between LEDs that are on together.</p>

  <h3>How the button is read</h3>
  <p>One leg of the button goes to GPIO23 and the other to GND. <code>pull_up=True</code> connects GPIO23 to 3.3 V through a resistor inside the Pi, so a released button reads <b>HIGH</b>. Pressing joins the pin to GND and it reads <b>LOW</b>. The pin is only a voltage; the program decides that LOW means “pressed”. The button never powers an LED.</p>

  <h3>BCM numbers and physical pins</h3>
  <table class="wiring">
    <tr><th>Python (BCM)</th><th>Header pin</th><th>Connected to</th></tr>
    <tr><td>GPIO17</td><td>pin 11</td><td>red LED branch</td></tr>
    <tr><td>GPIO27</td><td>pin 13</td><td>yellow LED branch</td></tr>
    <tr><td>GPIO22</td><td>pin 15</td><td>green LED branch</td></tr>
    <tr><td>GPIO23</td><td>pin 16</td><td>push button</td></tr>
    <tr><td>GND</td><td>pin 6</td><td>LED return (breadboard “−” rail)</td></tr>
    <tr><td>GND</td><td>pin 14</td><td>button return</td></tr>
  </table>

  <h3>Wiring recap</h3>
  <table class="wiring">
    <tr><th>From</th><th>To</th></tr>
    <tr><td>Pin 11, 13, 15</td><td>columns 7, 14, 21 (row a), one jumper each</td></tr>
    <tr><td>Each of those columns</td><td>330 Ω resistor → LED anode (long leg)</td></tr>
    <tr><td>LED cathodes</td><td>columns 2, 9, 16 → short jumpers to the “−” rail</td></tr>
    <tr><td>“−” rail</td><td>GND (pin 6)</td></tr>
    <tr><td>Pin 16 (GPIO23)</td><td>button, column 24 (row a)</td></tr>
    <tr><td>Button other side</td><td>column 24 (row i) → GND (pin 14)</td></tr>
  </table>
  <p class="note">The pedestrian display is a teaching aid in this notebook. It is not wired to anything.</p>`;

const pct = (x) => Math.round(x * 100);
const fmt = (s) => `${s.toFixed(1)} s`;
const COLORS = { GREEN: '#2e9e55', YELLOW: '#e2b623', RED: '#d6453a', STOPPED: '#555a70' };
const PIN_OF = { GREEN: 'green', YELLOW: 'yellow', RED: 'red' };

export default {
  id: 'traffic',
  number: 4,
  title: 'Traffic Light with Pedestrian Button',
  chapter: 'State machine',
  defaultView: 'circuit',
  viewButtons,
  views: {
    circuit: { t: [5.5, 0.3, -0.5], r: 16.5, phi: 0.82, theta: 0 },
    gpio: { t: [3.5, 1.0, -0.1], r: 7.4, phi: 0.95, theta: 0.18 },
    leds: { t: [4.0, 0.9, -2.4], r: 9.5, phi: 0.9, theta: 0.1 },
    button: { t: [8.0, 0.8, -3.0], r: 5.4, phi: 0.95, theta: 0 },
  },
  pageContent: PAGE_CONTENT.traffic,
  textures: () => ({
    left: leftPageTexture(PAGE_CONTENT.traffic),
    right: rightPageTexture({
      fig: 'FIG. 4', caption: 'Button → GPIO23 → program → RED / YELLOW / GREEN', page: 8,
      hint: 'Press the blue button in the scene, or use the pad in the notebook.',
    }),
  }),

  async create(env) {
    const circuit = buildTrafficCircuit();
    let source;
    try {
      source = await (await fetch('python/traffic_light.py', { cache: 'no-store' })).text();
    } catch {
      source = '# Could not load python/traffic_light.py. Start the project with: npm start';
    }
    const { settings, missing } = parseSettings(source);
    const machine = new TrafficMachine(settings);

    /* ---------- state ---------- */
    const held = new Set(); // what is holding the button: 'mouse:N', 'pad', 'kbd', 'guide'
    let plunger = 0; // 0 released .. 1 fully pressed (visual)
    let contact = false; // the bridge touches both bars: GPIO23 reads LOW
    let simT = 0; // seconds of simulated time (advances with the frame clock only while the chapter is visible)
    let popT = 0;
    let autoStart = false;
    let flash = null; // { keys, until }
    let lastTransition = -99, lastPress = -99;
    let explore = null;
    let ui = null;
    const levels = { red: 0, yellow: 0, green: 0 }; // smoothed LED brightness
    const pins = { red: 0, yellow: 0, green: 0, button: 1 }; // smoothed pin level (button: 1 = HIGH = released)
    let inputLevel = 0;
    let phases, marks, spans;
    const resetTimeline = () => {
      phases = [{ state: 'STOPPED', t: simT }];
      marks = [];
      spans = [];
    };
    resetTimeline();

    const A = circuit.anchors;
    const up = (v, y) => v.clone().add(new THREE.Vector3(0, y, 0));
    const hl = (on) => (on ? 'HIGH' : 'LOW');
    const lamp = () => machine.lights;
    const walkText = () => {
      if (!machine.running) return 'stopped';
      if (machine.state === 'RED') return `you can cross · ${Math.ceil(machine.timer(simT).left)} s`;
      return machine.request ? 'request registered' : 'wait';
    };
    const labels = [
      { id: 'pi', title: 'Raspberry Pi 5', sub: 'Simplified model', at: A.pi, side: 'right', hideNarrow: true },
      { id: 'red', cls: 'compact', title: 'Red LED', sub: () => `<span class="val">GPIO17 · pin 11 · ${hl(lamp().red)}</span>`, at: up(A.led.red, 1.0), side: 'left' },
      { id: 'yellow', cls: 'compact', title: 'Yellow LED', sub: () => `<span class="val">GPIO27 · pin 13 · ${hl(lamp().yellow)}</span>`, at: up(A.led.yellow, 2.1), side: 'left' },
      { id: 'green', cls: 'compact', title: 'Green LED', sub: () => `<span class="val">GPIO22 · pin 15 · ${hl(lamp().green)}</span>`, at: up(A.led.green, 1.35), side: 'right' },
      { id: 'res', title: '330 Ω resistors', sub: 'one per LED', at: up(A.resistor.yellow, 0.35), side: 'right', hideNarrow: true },
      { id: 'button', cls: 'compact', title: 'Push button', sub: () => `<span class="val">GPIO23 · pin 16 · ${contact ? 'LOW (pressed)' : 'HIGH (released)'}</span>`, at: A.button, side: 'right' },
      { id: 'gnd', title: 'GND · pins 6 and 14', sub: 'LED rail and button return', at: up(A.pin.gnd6, 0.55), side: 'left', hideNarrow: true },
      { id: 'ped', cls: 'virtual', title: 'Pedestrian display', sub: () => `<span class="val">${walkText()}</span> · teaching aid, not a part`, at: up(A.pedestrian, 0.5), side: 'right', hideNarrow: true },
    ];

    const log = (t, c) => ui && ui.log(t, c);
    const lineIndexes = (keys) => (keys || []).map((k) => ui?.L[k]).filter((i) => i != null && i >= 0);
    const doFlash = (...keys) => (flash = { keys, until: simT + 1.1 });

    function setPhase(state, t) {
      if (phases[phases.length - 1].state === state) return;
      phases.push({ state, t });
      if (phases.length > 40) phases.splice(0, phases.length - 40);
    }
    const closeSpan = (t) => {
      const open = spans[spans.length - 1];
      if (open && open.t1 == null) open.t1 = t;
    };

    /* ---------- program ---------- */
    function startProgram() {
      if (machine.running) return;
      machine.start(simT);
      setPhase('GREEN', simT);
      closeSpan(simT);
      lastTransition = simT;
      log('$ python3 traffic_light.py', 'p');
      log('# GREEN on, request = False. The loop is watching the button.', 'c');
      doFlash('initGreen');
      circuit.pulse('green', '#ffd27a');
      ui?.refresh();
    }
    function stopProgram(why) {
      explore = null;
      if (ui) ui.setExplore(false);
      const was = machine.running;
      machine.stop();
      flash = null;
      setPhase('STOPPED', simT);
      closeSpan(simT);
      if (was) log(why === 'user' ? '^C KeyboardInterrupt → LEDs off, pending request forgotten' : '# Program stopped: LEDs off, pending request forgotten.', 'c');
      ui?.refresh();
    }
    function restartProgram() {
      explore = null;
      machine.stop();
      closeSpan(simT);
      machine.start(simT);
      setPhase('GREEN', simT);
      lastTransition = simT;
      flash = null;
      log('$ python3 traffic_light.py   # restart: back to GREEN, timers from zero', 'p');
      doFlash('initGreen');
      ui?.refresh();
    }

    function handlePress() {
      lastPress = simT;
      const r = machine.press(simT);
      switch (r.result) {
        case 'registered':
          marks.push({ t: simT, kind: 'registered' });
          spans.push({ t0: simT, t1: null });
          log('>>> when_pressed → request_crossing()   # request = True: registered', 'p');
          doFlash('ifGreen', 'request');
          break;
        case 'already-pending':
          marks.push({ t: simT, kind: 'ignored' });
          log('# Pressed again: request is already True. Nothing changes and no timer restarts.', 'c');
          doFlash('ifGreen', 'request');
          break;
        case 'ignored-crossing':
          marks.push({ t: simT, kind: 'ignored' });
          log(`# Pressed during ${machine.state}: request_crossing() ignores it (state is not "GREEN"). No crossing is queued.`, 'c');
          doFlash('ifGreen');
          break;
        default:
          marks.push({ t: simT, kind: 'stopped' });
          log('# GPIO23 goes LOW, but the program is stopped: nobody reads the button.', 'c');
      }
    }

    function onContact(c) {
      contact = c;
      circuit.pulse('button', c ? '#6fe3ff' : '#ffd27a');
      log(c ? '# GPIO23: HIGH → LOW (the button joins it to GND)' : '# GPIO23: LOW → HIGH (the pull-up wins again)', 'c');
      if (c) handlePress();
    }

    const LINES = {
      GREEN_YELLOW: ['condYellow', 'toYellow'],
      YELLOW_RED: ['condRed', 'toRed'],
      RED_GREEN: ['condGreen', 'clear', 'toGreen'],
    };
    function onTransition(ev) {
      setPhase(ev.to, ev.t);
      lastTransition = simT;
      if (ev.served) closeSpan(ev.t);
      circuit.pulse(PIN_OF[ev.from], '#7fb5ff');
      circuit.pulse(PIN_OF[ev.to], '#ffd27a');
      log(`>>> state: ${ev.from} → ${ev.to}   # change_state("${ev.to}", now)${ev.served ? '   (request served and cleared)' : ''}`, 'p');
      doFlash(...LINES[`${ev.from}_${ev.to}`]);
    }

    /* ---------- guided experiment: "what if you press several times during the red?" ---------- */
    function startExplore() {
      if (explore) return;
      restartProgram();
      explore = { phase: 'first', pressAt: simT + 0.5, releaseAt: null, mash: 0, nextMash: 0, baseIgnored: 0 };
      ui?.setExplore(true, 'Running: one press requests the crossing, then six presses during the red…');
    }
    function stepExplore() {
      const e = explore;
      if (!machine.running) {
        explore = null;
        ui?.setExplore(false, 'Experiment cancelled because the program stopped.');
        return;
      }
      if (e.releaseAt != null && simT >= e.releaseAt) {
        held.delete('guide');
        e.releaseAt = null;
      }
      if (e.phase === 'first' && simT >= e.pressAt) {
        held.add('guide');
        e.releaseAt = simT + 0.3;
        e.phase = 'wait-red';
      } else if (e.phase === 'wait-red' && machine.state === 'RED' && machine.elapsed(simT) >= 0.6 && e.releaseAt == null) {
        e.phase = 'mash';
        e.nextMash = simT;
        e.baseIgnored = machine.stats.ignored;
      } else if (e.phase === 'mash') {
        if (e.mash < 6 && simT >= e.nextMash && e.releaseAt == null) {
          held.add('guide');
          e.releaseAt = simT + 0.2;
          e.nextMash = simT + 0.6;
          e.mash++;
        }
        if (e.mash >= 6 && e.releaseAt == null) e.phase = 'wait-green';
      } else if (e.phase === 'wait-green' && machine.state === 'GREEN' && machine.stats.served >= 1) {
        const st = machine.stats;
        const text = `Result: ${st.ignored - e.baseIgnored} presses during the red were ignored. The red lasted ${fmt(st.lastCrossing)} (the program says ${settings.crossing} s), `
          + `${st.served} crossing was served and the request is ${machine.request ? 'still pending' : 'cleared'}. Pressing during the red changes nothing.`;
        explore = null;
        ui?.setExplore(false, text);
        log('# Experiment done: the extra presses did not restart the red or queue another crossing.', 'c');
      }
    }

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      autoStart = true; // like chapter 2: the program starts by itself once the scene is built
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml(settings);
      tabs.how.innerHTML = howHtml(settings);

      const code = renderCode($('#code', tabs.code), source);
      bindCopy($('#copyBtn', tabs.code), () => source, $('#code', tabs.code));
      const L = {
        ifGreen: code.find(/^\s+if state == "GREEN":/),
        request: code.find(/^\s+request = True/),
        initGreen: code.find(/change_state\("GREEN", monotonic\(\)\)/),
        condYellow: code.find(/state == "GREEN" and request/),
        toYellow: code.find(/change_state\("YELLOW", now\)/),
        condRed: code.find(/state == "YELLOW" and elapsed/),
        toRed: code.find(/change_state\("RED", now\)/),
        condGreen: code.find(/state == "RED" and elapsed/),
        toGreen: code.find(/change_state\("GREEN", now\)/),
        poll: code.find(/sleep\(POLL_SECONDS\)/),
      };
      L.clear = L.condGreen >= 0 ? code.find(/request = False/, L.condGreen) : -1;
      const unmatched = Object.entries(L).filter(([, v]) => v < 0).map(([k]) => k);
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim));
      ui = { code, L, log: consoleLog, steps };

      const q = (s) => $(s, tabs.sim);
      const chipState = q('#tlState'), chipReq = q('#tlReq'), chipTime = q('#tlTime');
      const walk = q('#walk'), walkMain = q('#walkMain'), walkSub = q('#walkSub'), walkCount = q('#walkCount');
      const progEl = q('#progState');
      const pad = q('#btnPress'), btnRun = q('#btnRun'), btnStop = q('#btnStop'), btnRestart = q('#btnRestart');
      const canvas = q('#tlCanvas'), legend = q('#tlLegend');
      const btnExplore = q('#btnExplore'), exploreResult = q('#exploreResult');
      const optLabels = q('#optLabels');
      const gp = Object.fromEntries($$('.gp-row', tabs.sim).map((r) => [r.dataset.k, r]));
      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Web simulation. No real GPIO is used.', 'c');
      consoleLog(`# Timing read from traffic_light.py: green ≥ ${settings.minGreen} s, yellow ${settings.yellow} s, red ${settings.crossing} s.`, 'c');
      if (missing.length) consoleLog(`# Not found in the Python file (defaults used): ${missing.join(', ')}`, 'c');
      if (unmatched.length) consoleLog(`# Could not match these code lines to highlight: ${unmatched.join(', ')}`, 'c');

      // the notebook control that is equivalent to the 3D button (mouse, touch and keyboard)
      pad.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        pad.setPointerCapture(e.pointerId);
        held.add('pad');
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, () => held.delete('pad'));
      pad.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!e.repeat) held.add('kbd');
        }
      });
      pad.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && held.delete('kbd'));
      pad.addEventListener('blur', () => held.delete('kbd'));
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
      pad.addEventListener('click', (e) => e.preventDefault());

      btnRun.addEventListener('click', startProgram);
      btnStop.addEventListener('click', () => stopProgram('user'));
      btnRestart.addEventListener('click', restartProgram);
      btnExplore.addEventListener('click', startExplore);

      ui.refresh = () => {
        btnRun.disabled = machine.running;
        btnStop.disabled = !machine.running;
        code.setTag(L.poll, machine.running ? '← checks the clock and the button every pass' : '');
        if (!machine.running) code.setActive(-1);
      };
      ui.setExplore = (busy, text) => {
        btnExplore.disabled = busy;
        if (text != null) exploreResult.textContent = text;
      };
      ui.refresh();

      let lastText = '', lastDraw = 0;
      ui.frame = (now) => {
        const st = machine.state, tm = machine.timer(simT), run = machine.running;
        const lights = machine.lights;

        // state, request and timer
        chipState.className = `chip tl-${st.toLowerCase()}`;
        $('b', chipState).textContent = st;
        chipReq.classList.toggle('on', run && machine.request);
        $('b', chipReq).textContent = !run ? '—' : machine.request ? 'REGISTERED' : 'none';
        const timerLabel = { 'min-green': ['Min. green left', fmt(tm.left ?? 0)], waiting: ['Green', 'waiting'], now: ['Green', 'changing…'], yellow: ['Yellow left', fmt(tm.left ?? 0)], cross: ['Crossing left', fmt(tm.left ?? 0)], stopped: ['Timer', '—'] }[tm.kind];
        $('span', chipTime).textContent = timerLabel[0];
        $('b', chipTime).textContent = timerLabel[1];
        chipTime.classList.toggle('on', run && tm.kind !== 'waiting');

        // pedestrian display (teaching aid)
        let wc = 'wait', main = 'Wait', sub = 'Cars have the green. Press the button to request a crossing.', count = '';
        if (!run) {
          wc = 'stopped';
          main = 'Stopped';
          sub = 'The program is not running: every LED is off and nobody reads the button.';
        } else if (st === 'RED') {
          wc = 'go';
          main = 'You can cross';
          sub = 'Cars have the red. The crossing ends when the time is up.';
          count = String(Math.ceil(tm.left));
        } else if (st === 'YELLOW') {
          wc = 'requested';
          main = 'Wait';
          sub = `Yellow: the red (and the crossing) starts in ${fmt(tm.left)}.`;
        } else if (machine.request) {
          wc = 'requested';
          main = 'Request registered';
          sub = tm.kind === 'min-green' ? `Green must last at least ${settings.minGreen} s: ${fmt(tm.left)} left. More presses change nothing.` : 'The green minimum is over: changing to yellow now.';
        }
        walk.className = `walk ${wc}`;
        const text = `${main}|${sub}`;
        if (text !== lastText) {
          walkMain.textContent = main;
          walkSub.textContent = sub;
          lastText = text;
        }
        walkCount.textContent = count;

        // GPIO levels
        const setRow = (k, high, extra = '') => {
          const lvl = $('.gp-level', gp[k]);
          const t = `${high ? 'HIGH · 3.3 V' : 'LOW · 0 V'}${extra}`;
          if (lvl.textContent !== t) lvl.textContent = t;
          lvl.classList.toggle('hi', high);
        };
        setRow('red', lights.red);
        setRow('yellow', lights.yellow);
        setRow('green', lights.green);
        setRow('button', !contact, contact ? ' · pressed' : ' · released');

        pad.classList.toggle('held', held.size > 0);
        pad.setAttribute('aria-pressed', String(held.size > 0));
        const ps = run ? `Python program: running · state ${st}` : 'Python program: STOPPED (LEDs off, no request pending)';
        if (progEl.textContent !== ps) progEl.textContent = ps;
        progEl.classList.toggle('on', run);
        progEl.classList.toggle('stopped', !run);

        // highlighted code: only the lines that really ran for the last event
        code.setActive(flash && simT < flash.until ? lineIndexes(flash.keys) : -1);

        if (now - lastDraw > 33) {
          lastDraw = now;
          drawTimeline(canvas);
        }
        legend.textContent = `Last 30 s. Top: LED phase. Bottom: a registered request (amber bar), presses (▲ registered, △ ignored). Presses so far: registered ${machine.stats.registered}, repeated ${machine.stats.repeated}, ignored ${machine.stats.ignored}, crossings served ${machine.stats.served}.`;
      };
    }

    const WINDOW = 30;
    function drawTimeline(canvas) {
      const ctx = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const padL = 14, padR = 14, plotW = w - padL - padR;
      const x = (t) => padL + ((t - (simT - WINDOW)) / WINDOW) * plotW;
      const SANS = '"Segoe UI", system-ui, sans-serif';
      // phase lane
      const y1 = 34, h1 = 54;
      ctx.font = `600 16px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8c93b3';
      ctx.fillText('LEDs', padL, 20);
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        const t1 = i + 1 < phases.length ? phases[i + 1].t : simT;
        const a = Math.max(padL, x(p.t)), b = Math.min(padL + plotW, x(t1));
        if (b <= a) continue;
        ctx.fillStyle = COLORS[p.state];
        ctx.fillRect(a, y1, b - a, h1);
        if (b - a > 60) {
          ctx.fillStyle = p.state === 'YELLOW' ? '#2b2210' : '#ffffff';
          ctx.font = `700 16px ${SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText(p.state, (a + b) / 2, y1 + h1 / 2 + 6);
        }
      }
      // request lane
      const y2 = 112, h2 = 22;
      ctx.textAlign = 'left';
      ctx.font = `600 16px ${SANS}`;
      ctx.fillStyle = '#8c93b3';
      ctx.fillText('Request and presses', padL, 104);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(padL, y2, plotW, h2);
      for (const sp of spans) {
        const a = Math.max(padL, x(sp.t0)), b = Math.min(padL + plotW, x(sp.t1 ?? simT));
        if (b > a) {
          ctx.fillStyle = '#e0a53a';
          ctx.fillRect(a, y2, b - a, h2);
        }
      }
      for (const m of marks) {
        const mx = x(m.t);
        if (mx < padL || mx > padL + plotW) continue;
        ctx.beginPath();
        ctx.moveTo(mx, y2 + h2 + 4);
        ctx.lineTo(mx - 7, y2 + h2 + 20);
        ctx.lineTo(mx + 7, y2 + h2 + 20);
        ctx.closePath();
        if (m.kind === 'registered') {
          ctx.fillStyle = '#ffcf6b';
          ctx.fill();
        } else {
          ctx.strokeStyle = m.kind === 'stopped' ? '#6b7092' : '#cfd8ee';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      // time axis
      ctx.fillStyle = '#8c93b3';
      ctx.font = `14px ${SANS}`;
      ctx.textAlign = 'center';
      for (let s = 0; s <= WINDOW; s += 10) ctx.fillText(s === 0 ? 'now' : `-${s} s`, Math.min(padL + plotW - 14, Math.max(padL + 14, x(simT - s))), h - 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      for (let s = 0; s <= WINDOW; s += 10) {
        ctx.beginPath();
        ctx.moveTo(x(simT - s), y1 - 4);
        ctx.lineTo(x(simT - s), h - 22);
        ctx.stroke();
      }
    }

    return {
      root: circuit.root,
      popDuration: circuit.popDuration,
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
        circuit.setPop(tp);
      },
      update(time, dt, camera, viewportH) {
        simT += dt;
        if (autoStart && popT >= circuit.popDuration - 0.2) {
          autoStart = false;
          startProgram();
        }
        // the button: quick travel, contact with hysteresis (the pin only reads LOW once the bridge touches)
        const target = held.size > 0 && popT > 2.2 ? 1 : 0;
        plunger += (target - plunger) * (1 - Math.exp(-dt * (target ? 26 : 16)));
        if (Math.abs(target - plunger) < 0.002) plunger = target;
        if (!contact && plunger > 0.85) onContact(true);
        else if (contact && plunger < 0.6) onContact(false);

        const ev = machine.tick(simT);
        if (ev) onTransition(ev);
        if (explore) stepExplore();

        const on = machine.lights;
        const k = 1 - Math.exp(-dt * 14);
        for (const id of ['red', 'yellow', 'green']) {
          levels[id] += ((on[id] ? 1 : 0) - levels[id]) * k;
          pins[id] += ((on[id] ? 1 : 0) - pins[id]) * (1 - Math.exp(-dt * 20));
        }
        pins.button += ((contact ? 0 : 1) - pins.button) * (1 - Math.exp(-dt * 20));
        inputLevel += ((contact ? 1 : 0) - inputLevel) * (1 - Math.exp(-dt * 16));
        circuit.update(time, dt, { levels, pins, plunger, input: inputLevel }, camera, viewportH);
      },
      activeStep() {
        if (!machine.running) return -1;
        if (simT - lastPress < 1.2) return 2;
        if (simT - lastTransition < 1.6) return 3;
        if (machine.request) return 4;
        return 0;
      },
      /** Stop the program and every animation (used when the page turns, the page is read or the book closes). */
      stop(reason) {
        const wasRunning = machine.running;
        machine.stop();
        held.clear();
        plunger = 0;
        contact = false;
        explore = null;
        flash = null;
        autoStart = false;
        for (const id of ['red', 'yellow', 'green']) levels[id] = pins[id] = 0;
        pins.button = 1;
        inputLevel = 0;
        resetTimeline();
        if (ui) {
          ui.setExplore(false, '');
          ui.refresh();
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Run to start it again.', 'c');
          else if (wasRunning) ui.log('# Program stopped.', 'c');
        }
      },
      pick(raycaster) {
        if (popT < 2.2 || !circuit.root.visible) return false;
        return raycaster.intersectObject(circuit.hit, false).length > 0;
      },
      pressStart: (src) => held.add(src),
      pressEnd: (src) => held.delete(src),
      releaseAll() {
        held.delete('pad');
        held.delete('kbd');
        for (const s of [...held]) if (s.startsWith('mouse:') || s === 'debug') held.delete(s);
      },
      runFromQuery() {},
      /** Test helper (?led=on): arms the program to start as soon as the scene is built. */
      debugOn() {
        autoStart = true;
      },
      /** Test helper: a read-only view of the model. */
      inspect() {
        return {
          running: machine.running, state: machine.state, request: machine.request, since: machine.since, simT, contact, plunger, heldCount: held.size,
          stats: { ...machine.stats }, levels: { ...levels }, lights: machine.lights, exploring: !!explore,
        };
      },
      /** Test helper: press and release the button from code. */
      debugPress(on = true) {
        if (on) held.add('debug');
        else held.delete('debug');
      },
    };
  },
};
