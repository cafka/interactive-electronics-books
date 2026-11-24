import * as THREE from 'three';
import { buildCircuit } from '../circuit.js';
import { Signal, CURRENT_MA } from '../simulation.js';
import { leftPageTexture, rightPageTexture } from '../textures.js';
import { PAGE_CONTENT } from '../pageContent.js';
import { $, $$, renderCode, bindCopy, createConsole, renderSteps, createTimingChart } from '../ui.js';

const STEPS = [
  { title: 'Python asks for HIGH', text: 'led.on() makes gpiozero tell the Linux GPIO driver to drive GPIO17 high.', view: 'circuit' },
  { title: 'The RP1 chip drives the pin', text: 'The Pi 5 I/O chip (RP1) connects GPIO17 to its 3.3 V supply.', view: 'gpio' },
  { title: 'Current leaves pin 11', text: 'It flows along the orange jumper wire into breadboard column 12.', view: 'gpio' },
  { title: 'The resistor limits the current', text: 'The 330 Ω resistor drops about 1.3 V, so the current stays near 3.9 mA.', view: 'led' },
  { title: 'The LED lights, current returns', text: 'The LED drops about 2.0 V and emits light. The current returns to GND (pin 6).', view: 'led' },
];

const viewButtons = [['circuit', 'Circuit'], ['book', 'Whole book'], ['leftpage', 'Left page'], ['gpio', 'GPIO pins'], ['led', 'Resistor + LED']];

const simHtml = () => `
  <div class="status-row">
    <div class="chip" id="chipLed"><span>LED</span><b>OFF</b></div>
    <div class="chip" id="chipGpio"><span>GPIO17</span><b>0 V · LOW</b></div>
    <div class="chip" id="chipCurrent"><span>Current</span><b>0.0 mA</b></div>
  </div>
  <div class="btn-row">
    <button id="btnOn" class="btn primary"><code>led.on()</code></button>
    <button id="btnOff" class="btn"><code>led.off()</code></button>
  </div>
  <div class="btn-row">
    <button id="btnRun" class="btn accent">▶ Run program</button>
    <button id="btnStop" class="btn" disabled>■ Stop</button>
  </div>
  <h3>GPIO17 over time</h3>
  <canvas id="timing" width="760" height="170"></canvas>
  <h3>Where do the 3.3 V go?</h3>
  <div class="budget" id="budget">
    <div class="seg seg-r" style="flex: 1.3"><b>1.3 V</b><span>330 Ω resistor</span></div>
    <div class="seg seg-l" style="flex: 2.0"><b>2.0 V</b><span>red LED</span></div>
  </div>
  <p class="note">I = (3.3 V − 2.0 V) ÷ 330 Ω ≈ 3.9 mA, a safe current for a GPIO pin.</p>
  <h3>Console</h3>
  <div class="console" id="console" aria-live="polite"></div>
  <div class="options">
    <label><input type="checkbox" id="optSlow"> Slow-motion signals</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = `
  <p>Python code using <code>gpiozero</code>, the library included in Raspberry Pi OS.
    Press <b>Run program</b> in the Simulate tab to watch each line execute.</p>
  <div class="code-head"><span>led_blink.py</span><button id="copyBtn" class="chip-btn">Copy</button></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>Run it on your Raspberry Pi 5</h3>
  <ol class="steps-list">
    <li>Build the circuit shown in the book.</li>
    <li>Save the code as <code>led_blink.py</code> (it is also in this project's <code>python/</code> folder).</li>
    <li>Open a terminal and run <code>python3 led_blink.py</code>.</li>
    <li>Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop.</li>
  </ol>
  <h3>Shorter version</h3>
  <pre class="code small"><span class="kw">from</span> gpiozero <span class="kw">import</span> LED
<span class="kw">from</span> signal <span class="kw">import</span> pause

led = LED(<span class="num">17</span>)
led.blink(on_time=<span class="num">1</span>, off_time=<span class="num">1</span>)  <span class="cm"># runs in the background</span>
pause()</pre>
  <p class="note"><code>LED(17)</code> uses BCM numbering: GPIO17 is physical pin 11 on the header.</p>`;

const howHtml = `
  <p>Click a step to move the camera. While the LED turns on, the active step follows the signal.</p>
  <ol class="steps" id="steps"></ol>
  <p class="note">The animation is slowed down for learning. Particles show conventional current, flowing from the HIGH pin to GND. In a real circuit the whole path responds almost instantly.</p>
  <h3>Why 330 Ω?</h3>
  <p>An LED has almost no resistance once it conducts, so without a resistor the current would be limited only by the pin. The resistor sets the current to a few milliamps: bright enough to see and safe for the GPIO pin.</p>
  <h3>Wiring recap</h3>
  <table class="wiring">
    <tr><th>From</th><th>To</th></tr>
    <tr><td>GPIO17 (pin 11)</td><td>Breadboard column 12</td></tr>
    <tr><td>Column 12</td><td>330 Ω resistor → column 8</td></tr>
    <tr><td>Column 8</td><td>LED long leg (anode, +)</td></tr>
    <tr><td>LED short leg (cathode, −)</td><td>Column 7</td></tr>
    <tr><td>Column 7</td><td>GND (pin 6)</td></tr>
  </table>`;

export default {
  id: 'led',
  number: 1,
  title: 'Light an LED',
  chapter: 'GPIO output',
  defaultView: 'circuit',
  viewButtons,
  views: {
    circuit: { t: [5.2, 0.4, 0.2], r: 16.5, phi: 0.85, theta: 0 },
    gpio: { t: [3.0, 1.0, -0.2], r: 7.5, phi: 0.95, theta: 0.18 },
    led: { t: [3.9, 1.1, -2.5], r: 6.2, phi: 0.9, theta: 0.12 },
  },
  pageContent: PAGE_CONTENT.led,
  textures: () => ({
    left: leftPageTexture(PAGE_CONTENT.led),
    right: rightPageTexture({ fig: 'FIG. 1', caption: 'GPIO17 → 330 Ω → LED → GND', page: 2 }),
  }),

  async create(env) {
    const circuit = buildCircuit();
    const signal = new Signal();
    signal.ledFraction = circuit.fractions.ledApex;
    signal.onChange((on) => circuit.pulse(on ? '#ffd27a' : '#7fb5ff'));

    let source;
    try {
      source = await (await fetch('python/led_blink.py', { cache: 'no-store' })).text();
    } catch {
      source = '# Could not load python/led_blink.py. Start the project with: npm start';
    }

    let ui = null; // DOM handles, only while this lesson's notebook is mounted
    let running = false;
    let runId = 0;

    const A = circuit.anchors;
    const labels = [
      { id: 'pi', title: 'Raspberry Pi 5', sub: 'Simplified model', at: A.pi, side: 'right' },
      { id: 'gpio', title: 'GPIO17 · pin 11', sub: () => `<span class="val">${signal.on ? '3.3 V · HIGH' : '0 V · LOW'}</span>`, at: A.pin11.clone().add(new THREE.Vector3(0, 0.55, 0)), side: 'right' },
      { id: 'gnd', title: 'GND · pin 6', sub: '0 V reference', at: A.pin6.clone().add(new THREE.Vector3(0, 0.55, 0)), side: 'left' },
      { id: 'res', title: '330 Ω resistor', sub: 'Limits the current', at: A.resistor.clone().add(new THREE.Vector3(0, 0.3, 0)), side: 'right' },
      { id: 'led', title: 'Red LED', sub: 'Long leg = anode (+)', at: A.led, side: 'left' },
      { id: 'board', title: 'Breadboard', sub: 'Holes a–e in a column are linked', at: A.board, side: 'right' },
    ];

    const log = (text, cls) => ui && ui.log(text, cls);
    const setLine = (i) => ui && ui.code.setActive(i);

    function hardStop() {
      runId++;
      running = false;
      signal.reset();
    }

    function mountUI(tabs) {
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml;
      tabs.how.innerHTML = howHtml;

      const code = renderCode($('#code', tabs.code), source);
      bindCopy($('#copyBtn', tabs.code), () => source, $('#code', tabs.code));
      const L = {
        importLed: code.find(/from gpiozero/),
        importSleep: code.find(/from time/),
        create: code.find(/led = LED\(17\)/),
        loop: code.find(/while True/),
        on: code.find(/led\.on\(\)/),
        off: code.find(/led\.off\(\)/),
      };
      L.sleep1 = code.find(/sleep\(1\)/, L.on);
      L.sleep2 = code.find(/sleep\(1\)/, L.off);

      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim));
      const chart = createTimingChart($('#timing', tabs.sim), [{
        label: 'GPIO17', history: () => signal.history, isOn: () => signal.on,
        hi: '3.3 V', lo: '0 V', on: 'HIGH', off: 'LOW', color: '#ffcf6b',
      }]);
      ui = { code, log: consoleLog, steps, chart, L };

      const q = (s) => $(s, tabs.sim);
      const btnOn = q('#btnOn'), btnOff = q('#btnOff'), btnRun = q('#btnRun'), btnStop = q('#btnStop');
      const chipLed = q('#chipLed'), chipGpio = q('#chipGpio'), chipCur = q('#chipCurrent'), budget = q('#budget');
      const optSlow = q('#optSlow'), optLabels = q('#optLabels');
      optSlow.checked = env.options.slow;
      optLabels.checked = env.options.labels;
      optSlow.addEventListener('change', (e) => (env.options.slow = e.target.checked));
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Ready. GPIO17 is LOW (0 V).', 'c');

      const setRunning = (v) => {
        running = v;
        btnRun.disabled = v;
        btnStop.disabled = !v;
        btnOn.disabled = v;
        btnOff.disabled = v;
      };
      const apply = (value) => {
        const changed = signal.set(value);
        consoleLog(
          changed
            ? value ? '>>> led.on()   # GPIO17 → 3.3 V (HIGH)' : '>>> led.off()  # GPIO17 → 0 V (LOW)'
            : `# GPIO17 is already ${value ? 'HIGH' : 'LOW'}`,
          changed ? 'p' : 'c',
        );
      };
      btnOn.addEventListener('click', () => { setLine(L.on); apply(true); });
      btnOff.addEventListener('click', () => { setLine(L.off); apply(false); });

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      async function run() {
        if (running) return;
        const id = ++runId;
        setRunning(true);
        const step = async (line, ms, msg) => {
          if (id !== runId) throw new Error('stopped');
          setLine(line);
          if (msg) log(msg, 'p');
          await sleep(ms);
        };
        try {
          await step(L.importLed, 350);
          await step(L.importSleep, 350);
          await step(L.create, 500, '>>> led = LED(17)  # GPIO17 set as output');
          await step(L.loop, 350);
          while (id === runId) {
            await step(L.on, 80);
            signal.set(true);
            log('>>> led.on()   # GPIO17 → 3.3 V (HIGH)', 'p');
            await step(L.sleep1, 1000);
            await step(L.off, 80);
            signal.set(false);
            log('>>> led.off()  # GPIO17 → 0 V (LOW)', 'p');
            await step(L.sleep2, 1000);
            await step(L.loop, 120);
          }
        } catch {
          /* stopped */
        }
      }
      function stopByUser() {
        if (!running) return;
        runId++;
        setLine(-1);
        signal.set(false);
        log('^C KeyboardInterrupt → GPIO17 released, LED off', 'c');
        setRunning(false);
      }
      btnRun.addEventListener('click', run);
      btnStop.addEventListener('click', stopByUser);
      ui.run = run;
      ui.frame = (now) => {
        chipLed.classList.toggle('on', signal.led > 0.5);
        $('b', chipLed).textContent = signal.led > 0.5 ? 'ON' : 'OFF';
        chipGpio.classList.toggle('on', signal.on);
        $('b', chipGpio).textContent = signal.on ? '3.3 V · HIGH' : '0 V · LOW';
        const mA = CURRENT_MA * signal.led;
        chipCur.classList.toggle('on', mA > 0.2);
        $('b', chipCur).textContent = `${mA.toFixed(1)} mA`;
        budget.classList.toggle('off', signal.led < 0.5);
        chart.draw(now);
      };
    }

    return {
      root: circuit.root,
      popDuration: 2.3,
      labels,
      mountUI,
      unmountUI() {
        ui = null;
      },
      frameUI(now) {
        ui?.frame(now);
        ui?.steps.setActive(this.activeStep());
      },
      setPop: (tp) => circuit.setPop(tp),
      update(time, dt, camera, viewportH) {
        signal.slow = env.options.slow;
        signal.update(dt);
        circuit.update(time, dt, signal, camera, viewportH);
      },
      activeStep: () => signal.activeStep(circuit.fractions),
      /** Stop the program and every electrical animation (used when the page turns). */
      stop(reason) {
        hardStop();
        if (ui) {
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Run program to start it again.', 'c');
          ui.code.setActive(-1);
          $('#btnRun', document).disabled = false;
          $('#btnStop', document).disabled = true;
          $('#btnOn', document).disabled = false;
          $('#btnOff', document).disabled = false;
        }
      },
      // lesson 1 has no 3D controls
      pick: () => false,
      pressStart() {},
      pressEnd() {},
      releaseAll() {},
      runFromQuery(action) {
        if (action === 'run') ui?.run();
      },
      debugOn() {
        signal.on = true;
        signal.front = 1;
        signal.led = 1;
        signal.gpio = 1;
        signal.history.push({ t: performance.now() - 2000, v: 1 });
      },
    };
  },
};
