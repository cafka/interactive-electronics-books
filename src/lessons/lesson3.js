import * as THREE from 'three';
import { buildCircuit } from '../circuit.js';
import { leftPageTexture, rightPageTexture } from '../textures.js';
import { PAGE_CONTENT } from '../pageContent.js';
import { PwmGenerator, drawScope, describeDuty, I_HIGH_MA, DEFAULT_DUTY, REAL_HZ, SLOW_HZ } from '../pwm.js';
import { $, $$, renderCode, bindCopy, createConsole, renderSteps } from '../ui.js';
import lesson1 from './lesson1.js';

/*
 * Lesson 3: control the brightness of an LED with PWM.
 * The 3D scene is the same circuit as lesson 1 (GPIO17 -> 330 ohm -> LED -> GND), so it reuses buildCircuit().
 * Only the signal on GPIO17 changes: instead of a steady HIGH it is a square wave with an adjustable duty cycle.
 */

const STEPS = [
  { title: 'Python sets a duty cycle', text: 'led.value = 0.25 asks gpiozero for a 25 % duty cycle: GPIO17 is HIGH for a quarter of every period.', view: 'circuit' },
  { title: 'GPIO17 switches between LOW and HIGH', text: 'The pin changes level 100 times per second. It only ever outputs 0 V or 3.3 V, never a voltage in between.', view: 'gpio' },
  { title: 'Each pulse drives current through the resistor', text: `While the pin is HIGH, about ${I_HIGH_MA.toFixed(1)} mA flows through the 330 Ω resistor and the LED. While it is LOW, no current flows.`, view: 'led' },
  { title: 'Your eye averages the flashes', text: '100 flashes per second are too fast to follow, so the LED looks steady. It looks as bright as the share of time it is on.', view: 'led' },
  { title: 'Longer pulses make a brighter LED', text: 'Raise the duty cycle and every HIGH pulse gets longer. At 100 % the pin stays HIGH, at 0 % it stays LOW.', view: 'circuit' },
];

const PRESETS = [0, 25, 50, 75, 100];

const simHtml = () => `
  <div class="duty-box">
    <div class="duty-head">
      <label for="dutySlider">Brightness (duty cycle)</label>
      <output id="dutyOut" for="dutySlider">50 %</output>
    </div>
    <input type="range" id="dutySlider" min="0" max="100" step="1" value="50" aria-describedby="dutyCode">
    <div class="presets" role="group" aria-label="Duty cycle presets">
      ${PRESETS.map((p) => `<button class="chip-btn preset" data-duty="${p}">${p} %</button>`).join('')}
    </div>
    <code id="dutyCode" class="duty-code">led.value = 0.5</code>
  </div>

  <div class="speed-row" role="group" aria-label="Signal speed">
    <button id="spReal" class="seg-btn active" aria-pressed="true">Real speed<small>${REAL_HZ} Hz · looks steady</small></button>
    <button id="spSlow" class="seg-btn" aria-pressed="false">Slow motion<small>${SLOW_HZ} Hz · see each pulse</small></button>
  </div>

  <div class="status-row">
    <div class="chip" id="chipDuty"><span>Duty cycle</span><b>50 %</b></div>
    <div class="chip" id="chipPin"><span>GPIO17</span><b>100 pulses/s</b></div>
    <div class="chip" id="chipLed"><span>LED</span><b>50 % bright</b></div>
  </div>

  <p class="note sim-note"><b>Web simulation.</b> Move the slider, press a preset, or run the program. Nothing here touches real hardware.</p>
  <div class="period-bar" id="periodBar" aria-hidden="true">
    <div class="hi" id="pbHi"><span></span></div><div class="lo" id="pbLo"><span></span></div>
  </div>
  <p class="period-cap" id="periodCap"></p>
  <p class="explain" id="explain"></p>

  <h3>GPIO17 signal</h3>
  <canvas id="scope" class="scope" width="760" height="260" role="img" aria-label="Plot of the PWM signal on GPIO17"></canvas>
  <p class="note" id="avgNote"></p>

  <p class="prog-state" id="progState">Python program: stopped</p>
  <div class="btn-row">
    <button id="btnRun" class="btn accent">▶ Run program</button>
    <button id="btnStop" class="btn" disabled>■ Stop program</button>
  </div>

  <h3>Console</h3>
  <div class="console" id="console" aria-live="off"></div>
  <div class="options">
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <h3>Camera</h3>
  <div class="views">${lesson1.viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = `
  <p>Python with <code>gpiozero</code>. <code>PWMLED</code> is an LED whose brightness you set with a number from 0 to 1.
    Press <b>Run program</b> in the Simulate tab to watch each line run.</p>
  <div class="code-head"><span>led_pwm.py</span><button id="copyBtn" class="chip-btn">Copy</button></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What each part does</h3>
  <ul class="explain-list">
    <li><code>PWMLED(17)</code> sets up GPIO17 as a PWM <b>output</b>. By default the pin switches at <b>100 Hz</b>.</li>
    <li><code>led.value = 0.25</code> sets the duty cycle: 0 is always LOW, 1 is always HIGH, 0.25 is HIGH a quarter of the time. It is not a voltage.</li>
    <li><code>sleep(2)</code> keeps each brightness for two seconds. gpiozero keeps the pulses going by itself while the program waits.</li>
    <li>The <code>for</code> loop walks through 0 %, 25 %, 50 %, 75 % and 100 %. <code>while True</code> repeats it until you press <kbd>Ctrl</kbd> + <kbd>C</kbd>.</li>
    <li>Tip: <code>led.pulse()</code> fades the LED in and out automatically, by changing the duty cycle for you.</li>
  </ul>
  <h3>Run it on your Raspberry Pi 5</h3>
  <ol class="steps-list">
    <li>Build the circuit shown in the book (same as Lesson 1).</li>
    <li>Save the code as <code>led_pwm.py</code> (also in this project's <code>python/</code> folder).</li>
    <li>Run <code>python3 led_pwm.py</code> and watch the brightness change.</li>
    <li>Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop.</li>
  </ol>
  <p class="note"><code>PWMLED(17)</code> uses BCM numbering: GPIO17 is physical pin 11. This page is a web simulation and does not control real hardware.</p>`;

function howHtml() {
  const rows = PRESETS.map((p) => {
    const d = p / 100;
    const hi = d * 10, lo = 10 - hi;
    const pin = p === 0 ? 'LOW all the time' : p === 100 ? 'HIGH all the time' : `HIGH ${hi} ms, LOW ${lo} ms`;
    const led = ['off', 'dim', 'medium', 'bright', 'full'][PRESETS.indexOf(p)];
    return `<tr><td>${p} %</td><td>${pin}</td><td>${(I_HIGH_MA * d).toFixed(1)} mA</td><td>${led}</td></tr>`;
  }).join('');
  return `
  <p>Click a step to move the camera. The highlighted step follows the signal.</p>
  <ol class="steps" id="steps"></ol>
  <h3>Duty cycle</h3>
  <p>PWM repeats a short period over and over (10 ms at 100 Hz). The <b>duty cycle</b> is the part of each period during which GPIO17 is HIGH.</p>
  <table class="wiring duty-table">
    <tr><th>Duty</th><th>GPIO17 every 10 ms</th><th>Avg. current</th><th>LED</th></tr>
    ${rows}
  </table>
  <p class="note">Perceived brightness is not exactly proportional to the duty cycle, but a higher duty cycle always looks brighter.</p>
  <h3>It is not a lower voltage</h3>
  <p>With PWM the pin never outputs 1.65 V for 50 %. It alternates between 0 V and 3.3 V. Only the <i>proportion of time</i> spent HIGH changes. The “average” line in the plot is a calculation, not a voltage you could measure as a steady level on the pin.</p>
  <h3>Why keep the 330 Ω resistor?</h3>
  <p>Every pulse is a full 3.3 V. Without the resistor the current during each HIGH pulse would be limited only by the pin, which can damage the LED or the Raspberry Pi. With it, each pulse carries about ${I_HIGH_MA.toFixed(1)} mA, and PWM changes only how often.</p>
  <h3>Real speed vs slow motion</h3>
  <p><b>Real speed</b> is what happens on the board: 100 pulses every second, too fast to see, so you see a steady brightness. <b>Slow motion</b> is a teaching aid: the same square wave at 0.5 Hz (one period lasts 2 s, 200 times slower), so you can watch every pulse.</p>
  <h3>Wiring recap</h3>
  <table class="wiring">
    <tr><th>From</th><th>To</th></tr>
    <tr><td>GPIO17 (pin 11)</td><td>Column 12 → 330 Ω resistor → column 8</td></tr>
    <tr><td>LED long leg (anode, +)</td><td>Column 8</td></tr>
    <tr><td>LED short leg (cathode, −)</td><td>Column 7</td></tr>
    <tr><td>Column 7</td><td>GND (pin 6)</td></tr>
  </table>`;
}

const pct = (x) => Math.round(x * 100);

export default {
  id: 'pwm',
  number: 3,
  title: 'LED Brightness with PWM',
  chapter: 'PWM output',
  defaultView: 'circuit',
  viewButtons: lesson1.viewButtons, // same circuit, same cameras
  views: lesson1.views,
  pageContent: PAGE_CONTENT.pwm,
  textures: () => ({
    left: leftPageTexture(PAGE_CONTENT.pwm),
    right: rightPageTexture({
      fig: 'FIG. 3', caption: 'GPIO17 (PWM) → 330 Ω → LED → GND', page: 6,
      hint: 'Drag the slider in the notebook to change the brightness. Drag the page to orbit, scroll to zoom.',
    }),
  }),

  async create(env) {
    const circuit = buildCircuit(); // identical wiring to lesson 1
    const gen = new PwmGenerator();
    gen.onEdge = (high) => circuit.pulse(high ? '#ffd27a' : '#7fb5ff'); // only fires in slow motion

    let source;
    try {
      source = await (await fetch('python/led_pwm.py', { cache: 'no-store' })).text();
    } catch {
      source = '# Could not load python/led_pwm.py. Start the project with: npm start';
    }

    /* ---------- state ---------- */
    let ui = null; // DOM handles while this lesson's notebook is mounted
    let running = false;
    let runId = 0;
    let ledVis = 0; // smoothed LED brightness 0..1
    let gpioVis = 0; // smoothed pin glow 0..1
    let lastChange = -99; // gen.t of the last duty change
    let flashTimer = 0;
    const sig = { front: 0, tail: 0, level: 1, led: 0, gpio: 0 };

    const A = circuit.anchors;
    const up = (v, y) => v.clone().add(new THREE.Vector3(0, y, 0));
    const stateText = () => {
      if (gen.duty <= 0) return '0 V · LOW';
      if (gen.duty >= 1) return '3.3 V · HIGH';
      return gen.slow ? (gen.high ? '3.3 V · HIGH' : '0 V · LOW') : `PWM · ${pct(gen.duty)} % duty`;
    };
    const labels = [
      { id: 'pi', title: 'Raspberry Pi 5', sub: 'Simplified model', at: A.pi, side: 'right' },
      { id: 'gpio', title: 'GPIO17 · pin 11', sub: () => `<span class="val">${stateText()}</span>`, at: up(A.pin11, 0.55), side: 'right' },
      { id: 'gnd', title: 'GND · pin 6', sub: '0 V reference', at: up(A.pin6, 0.55), side: 'left' },
      { id: 'res', title: '330 Ω resistor', sub: 'Limits the current in every pulse', at: up(A.resistor, 0.3), side: 'right' },
      { id: 'led', title: 'Red LED', sub: () => `<span class="val">${gen.slow ? (gen.high ? 'ON (pulse)' : 'OFF (gap)') : `${pct(gen.duty)} % bright`}</span>`, at: A.led, side: 'left' },
      { id: 'board', title: 'Breadboard', sub: 'Holes a–e in a column are linked', at: A.board, side: 'right' },
    ];

    const log = (t, c) => ui && ui.log(t, c);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function setDuty(duty, { fromProgram = false } = {}) {
      gen.setDuty(duty);
      lastChange = gen.t;
      if (!fromProgram && ui) {
        clearTimeout(flashTimer);
        ui.code.setActive(ui.L.setVal);
        flashTimer = setTimeout(() => !running && ui && ui.code.setActive(-1), 1000);
      }
    }
    const valueText = (d) => `led.value = ${Number.isInteger(d * 4) ? d : d.toFixed(2)}`;

    function hardStop() {
      runId++;
      running = false;
      clearTimeout(flashTimer);
      gen.reset();
      lastChange = -99;
      ledVis = gpioVis = 0;
    }

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml;
      tabs.how.innerHTML = howHtml();

      const code = renderCode($('#code', tabs.code), source);
      bindCopy($('#copyBtn', tabs.code), () => source, $('#code', tabs.code));
      const L = {
        importPwm: code.find(/from gpiozero/),
        importSleep: code.find(/from time/),
        create: code.find(/led = PWMLED\(17\)/),
        loop: code.find(/while True/),
        forLine: code.find(/for duty in/),
        setVal: code.find(/led\.value = duty/),
        sleep: code.find(/sleep\(2\)/),
      };
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim));
      ui = { code, L, log: consoleLog, steps };

      const q = (s) => $(s, tabs.sim);
      const slider = q('#dutySlider'), dutyOut = q('#dutyOut'), dutyCode = q('#dutyCode');
      const presets = $$('.preset', tabs.sim);
      const spReal = q('#spReal'), spSlow = q('#spSlow');
      const btnRun = q('#btnRun'), btnStop = q('#btnStop');
      const chipDuty = q('#chipDuty'), chipPin = q('#chipPin'), chipLed = q('#chipLed');
      const pbHi = q('#pbHi'), pbLo = q('#pbLo'), periodCap = q('#periodCap');
      const explain = q('#explain'), avgNote = q('#avgNote'), progEl = q('#progState');
      const scope = q('#scope');
      const optLabels = q('#optLabels');
      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Web simulation. No real GPIO is used.', 'c');
      consoleLog(`# ${valueText(gen.duty)}   # ${pct(gen.duty)} % duty cycle`, 'c');

      slider.addEventListener('input', () => {
        if (running) return;
        setDuty(Number(slider.value) / 100);
      });
      slider.addEventListener('change', () => {
        if (!running) consoleLog(`>>> ${valueText(gen.duty)}   # ${pct(gen.duty)} % duty cycle`, 'p');
      });
      presets.forEach((b) =>
        b.addEventListener('click', () => {
          if (running) return;
          setDuty(Number(b.dataset.duty) / 100);
          consoleLog(`>>> ${valueText(gen.duty)}   # ${pct(gen.duty)} % duty cycle`, 'p');
        }),
      );
      const setSlow = (slow) => {
        gen.setSlow(slow);
        consoleLog(slow ? '# Slow motion: same square wave, 200 times slower (0.5 Hz).' : '# Real speed: 100 Hz, the LED looks steady.', 'c');
      };
      spReal.addEventListener('click', () => setSlow(false));
      spSlow.addEventListener('click', () => setSlow(true));

      const setRunning = (v) => {
        running = v;
        ui.refreshProgram();
      };
      ui.refreshProgram = () => {
        btnRun.disabled = running;
        btnStop.disabled = !running;
        slider.disabled = running;
        presets.forEach((b) => (b.disabled = running));
        code.setTag(L.sleep, running ? '← holds this duty cycle' : '');
        if (!running) code.setActive(-1);
      };

      async function run() {
        if (running) return;
        const id = ++runId;
        setRunning(true);
        const step = async (line, ms, msg) => {
          if (id !== runId) throw new Error('stopped');
          code.setActive(line);
          if (msg) consoleLog(msg, 'p');
          await sleep(ms);
        };
        try {
          await step(L.importPwm, 350);
          await step(L.importSleep, 350);
          await step(L.create, 500, '>>> led = PWMLED(17)   # GPIO17 set up for PWM, 100 Hz');
          await step(L.loop, 300);
          while (id === runId) {
            for (const duty of [0, 0.25, 0.5, 0.75, 1]) {
              await step(L.forLine, 150);
              await step(L.setVal, 120);
              setDuty(duty, { fromProgram: true });
              consoleLog(`>>> ${valueText(duty)}   # ${pct(duty)} % duty cycle`, 'p');
              await step(L.sleep, 2000);
            }
            await step(L.loop, 150);
          }
        } catch {
          /* stopped */
        }
      }
      function stopByUser() {
        if (!running) return;
        runId++;
        setDuty(0);
        code.setActive(-1);
        consoleLog('^C KeyboardInterrupt → GPIO17 released, LED off', 'c');
        setRunning(false);
      }
      btnRun.addEventListener('click', run);
      btnStop.addEventListener('click', stopByUser);
      ui.run = run;
      ui.refreshProgram();

      let lastExplain = '', lastScope = 0;
      ui.frame = (now) => {
        const p = pct(gen.duty);
        const dsc = describeDuty(gen);
        if (Number(slider.value) !== p) slider.value = p;
        slider.style.setProperty('--fill', `${p}%`);
        dutyOut.textContent = `${p} %`;
        dutyCode.textContent = valueText(gen.duty);
        presets.forEach((b) => b.classList.toggle('active', Number(b.dataset.duty) === p));
        spReal.classList.toggle('active', !gen.slow);
        spSlow.classList.toggle('active', gen.slow);
        spReal.setAttribute('aria-pressed', String(!gen.slow));
        spSlow.setAttribute('aria-pressed', String(gen.slow));

        // chips
        const set = (chip, on, text) => {
          chip.classList.toggle('on', on);
          const b = $('b', chip);
          if (b.textContent !== text) b.textContent = text;
        };
        set(chipDuty, gen.duty > 0, `${p} %`);
        const pinText = gen.duty <= 0 ? '0 V · LOW' : gen.duty >= 1 ? '3.3 V · HIGH' : gen.slow ? (gen.high ? '3.3 V · HIGH' : '0 V · LOW') : '100 pulses/s';
        set(chipPin, gen.duty >= 1 || (gen.duty > 0 && (!gen.slow || gen.high)), pinText);
        const ledText = gen.slow ? (ledVis > 0.5 ? 'ON (pulse)' : 'OFF') : gen.duty <= 0 ? 'OFF' : gen.duty >= 1 ? 'ON · full' : `${p} % bright`;
        set(chipLed, ledVis > 0.12, ledText);

        // period bar: how the period is shared between HIGH and LOW
        pbHi.style.flexGrow = String(gen.duty * 100);
        pbLo.style.flexGrow = String((1 - gen.duty) * 100);
        pbHi.classList.toggle('empty', gen.duty <= 0.001);
        pbLo.classList.toggle('empty', gen.duty >= 0.999);
        pbHi.firstChild.textContent = gen.duty >= 0.16 ? `HIGH ${dsc.on}` : '';
        pbLo.firstChild.textContent = 1 - gen.duty >= 0.16 ? `LOW ${dsc.off}` : '';
        const capText = `One period = ${dsc.period} (${gen.slow ? '0.5 Hz slow motion' : '100 Hz'}). HIGH for ${dsc.on}, LOW for ${dsc.off}.`;
        if (periodCap.textContent !== capText) periodCap.textContent = capText;

        let text;
        if (gen.duty <= 0) text = '0 %: GPIO17 stays LOW all the time. No current flows and the LED is off.';
        else if (gen.duty >= 1) text = '100 %: GPIO17 stays HIGH all the time. The LED is at full brightness, just like led.on() in Lesson 1.';
        else if (gen.slow) text = `${p} % in slow motion: one period lasts ${dsc.period}. GPIO17 is HIGH for ${dsc.on}, then LOW for ${dsc.off}, and the LED blinks. The real signal is 200 times faster, so the LED looks steady and ${p < 40 ? 'dim' : p < 65 ? 'medium' : 'bright'}.`;
        else text = `${p} %: every ${dsc.period}, GPIO17 is HIGH for ${dsc.on} and LOW for ${dsc.off}. The LED flashes 100 times per second, too fast to see, so it looks steady and ${p < 40 ? 'dim' : p < 65 ? 'medium' : 'bright'}. Each pulse is a full 3.3 V: only the time HIGH changes. Press Slow motion to watch the pulses.`;
        if (text !== lastExplain) {
          explain.textContent = text;
          lastExplain = text;
        }
        avgNote.textContent = `While HIGH: (3.3 V − 2.0 V) ÷ 330 Ω ≈ ${I_HIGH_MA.toFixed(1)} mA. Average over time: ${I_HIGH_MA.toFixed(1)} mA × ${p} % ≈ ${dsc.avgMa} mA.`;

        const ps = !running ? 'Python program: stopped (you control the duty cycle)' : 'Python program: running · setting led.value every 2 s';
        if (progEl.textContent !== ps) progEl.textContent = ps;
        progEl.classList.toggle('on', running);

        if (now - lastScope > 33) {
          lastScope = now;
          drawScope(scope, gen);
        }
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
        gen.update(dt);
        // slow motion shows every pulse; at real speed the eye only sees the average, so brightness follows the duty
        const slow = gen.slow;
        const on = slow ? (gen.high ? 1 : 0) : gen.duty;
        const k = 1 - Math.exp(-dt * (slow ? 16 : 7));
        ledVis += (on - ledVis) * k;
        gpioVis += (on - gpioVis) * k;
        sig.front = slow ? (gen.high ? 1 : 0) : gen.duty > 0 ? 1 : 0;
        sig.tail = 0;
        sig.level = slow ? 1 : gen.duty;
        sig.led = ledVis;
        sig.gpio = gpioVis;
        circuit.update(time, dt, sig, camera, viewportH);
      },
      activeStep() {
        if (gen.t - lastChange < 1.2) return 0;
        if (gen.duty <= 0) return -1;
        if (gen.slow) return gen.high ? 2 : 1;
        return 3;
      },
      /** Stop the program and every electrical animation (used when the page turns or the page is read). */
      stop(reason) {
        const wasRunning = running;
        hardStop();
        if (ui) {
          ui.code.setActive(-1);
          ui.refreshProgram();
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Run program to start it again.', 'c');
          else if (wasRunning) ui.log('# Program stopped.', 'c');
        }
      },
      // lesson 3 has no 3D controls (the control is the slider in the notebook)
      pick: () => false,
      pressStart() {},
      pressEnd() {},
      releaseAll() {},
      runFromQuery(action) {
        if (action === 'run') ui?.run();
      },
      debugOn() {
        gen.setDuty(0.25);
      },
      /** Test helper: set the duty cycle and speed directly. */
      debug({ duty, slow } = {}) {
        if (slow != null) gen.setSlow(!!slow);
        if (duty != null) setDuty(duty);
      },
    };
  },
};
