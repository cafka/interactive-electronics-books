import * as THREE from 'three';
import { buildButtonCircuit } from '../circuit2.js';
import { Signal, Wave } from '../simulation.js';
import { leftPageTexture, rightPageTexture } from '../textures.js';
import { PAGE_CONTENT } from '../pageContent.js';
import { $, $$, renderCode, bindCopy, createConsole, renderSteps, createTimingChart } from '../ui.js';

const STEPS = [
  { title: 'You press the button', text: 'The cap moves down and the bridge plate touches both contact bars. The two legs on each side were always connected; now the two sides are joined.', view: 'button' },
  { title: 'GPIO27 reads LOW', text: 'Released, the internal pull-up holds GPIO27 at 3.3 V (HIGH). Pressed, the button connects it to GND, so it falls to about 0 V (LOW).', view: 'gpio' },
  { title: 'The program notices', text: 'After bounce_time (50 ms of stable signal), gpiozero sets button.is_pressed to True and calls the function saved in when_pressed.', view: 'circuit' },
  { title: 'The program writes GPIO17', text: 'led.on() drives GPIO17 HIGH. This is an output: the program decides its level. The button does not power the LED.', view: 'gpio' },
  { title: 'Current lights the LED', text: 'Current flows from GPIO17 through the 330 Ω resistor and the LED to GND (pin 6). Release the button and the same chain turns it off.', view: 'led' },
];

const viewButtons = [['circuit', 'Circuit'], ['book', 'Whole book'], ['leftpage', 'Left page'], ['gpio', 'GPIO pins'], ['button', 'Push button'], ['led', 'LED']];

const simHtml = () => `
  <p class="note sim-note"><b>Web simulation.</b> Hold the 3D push button with the mouse or a finger, or use the pad below. Release to let go.</p>
  <div class="chain" id="chain" aria-label="Signal chain">
    <div class="node" id="cBtn"><span>Button</span><b>Released</b></div>
    <div class="node" id="cG27"><span>GPIO27 in</span><b>3.3 V · HIGH</b></div>
    <div class="node" id="cProg"><span>is_pressed</span><b>False</b></div>
    <div class="node" id="cG17"><span>GPIO17 out</span><b>0 V · LOW</b></div>
    <div class="node" id="cLed"><span>LED</span><b>OFF</b></div>
  </div>
  <p class="explain" id="explain"></p>
  <button id="btnPress" class="press-pad" aria-pressed="false">
    <span class="pad-main">Hold to press the button</span>
    <small>mouse, touch, or hold Space / Enter</small>
  </button>
  <p class="prog-state" id="progState"></p>
  <div class="btn-row">
    <button id="btnRun" class="btn accent">▶ Run program</button>
    <button id="btnStop" class="btn">■ Stop program</button>
  </div>
  <div class="legend">
    <span><i class="lg lg-out"></i>Current (LED)</span>
    <span><i class="lg lg-in"></i>Pull-up current (tiny)</span>
    <span><i class="lg lg-logic"></i>Logic: what the program reads and decides</span>
  </div>
  <h3>GPIO27 and GPIO17 over time</h3>
  <canvas id="timing" width="760" height="250"></canvas>
  <h3>Console</h3>
  <div class="console" id="console" aria-live="off"></div>
  <div class="options">
    <label><input type="checkbox" id="optSlow"> Slow-motion signals</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = `
  <p>Python with <code>gpiozero</code>. The program registers what to do on each event, then waits.
    Press and release the button in the Simulate tab to see the matching line light up.</p>
  <div class="code-head"><span>led_button.py</span><button id="copyBtn" class="chip-btn">Copy</button></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What each part does</h3>
  <ul class="explain-list">
    <li><code>LED(17)</code> configures GPIO17 as an <b>output</b>.</li>
    <li><code>Button(27, pull_up=True, ...)</code> configures GPIO27 as an <b>input</b> with the internal pull-up resistor.</li>
    <li><code>when_pressed</code> and <code>when_released</code> register functions that gpiozero calls on those events. They name the function (<code>led.on</code>) without calling it.</li>
    <li><code>pause()</code> keeps the program alive, waiting for events. It is not a loop that runs lines again.</li>
    <li><code>bounce_time=0.05</code> helps filter mechanical bounce: changes shorter than 50 ms are ignored.</li>
  </ul>
  <h3>Run it on your Raspberry Pi 5</h3>
  <ol class="steps-list">
    <li>Build the circuit shown in the book.</li>
    <li>Save the code as <code>led_button.py</code> (also in this project's <code>python/</code> folder).</li>
    <li>Run <code>python3 led_button.py</code>, then press the button.</li>
    <li>Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop.</li>
  </ol>
  <p class="note"><code>Button(27)</code> uses BCM numbering: GPIO27 is physical pin 13. This page is a web simulation and does not control real hardware.</p>`;

const howHtml = `
  <p>Click a step to move the camera. The highlighted step follows the signal chain.</p>
  <ol class="steps" id="steps"></ol>
  <h3>Input vs output</h3>
  <p><b>Output (GPIO17):</b> the program <i>sets</i> the level and the pin drives the LED.
     <b>Input (GPIO27):</b> the program <i>reads</i> the level. A LOW input can mean “button pressed”, but only because the program interprets it that way. The pin level is just a voltage.</p>
  <h3>Why a pull-up?</h3>
  <p>A released button leaves the input unconnected, so it could read random values. The internal pull-up resistor (tens of kΩ, inside the Pi) gently pulls GPIO27 up to 3.3 V. Pressing the button connects the pin to GND, which wins over the weak pull-up and gives a clean LOW. Only a tiny current flows while pressed.</p>
  <h3>The four-leg button</h3>
  <p>The two legs on each side of the button are always connected inside (the two bars in the cutaway). Pressing pushes a bridge onto both bars and joins the two sides. That is why the button straddles the breadboard's center channel: one side carries GPIO27, the other GND. Check your own part with a multimeter, because the connected pairs depend on how it is oriented.</p>
  <h3>Two different paths</h3>
  <p><b>Current</b> (amber and cyan dots) is electrical charge that flows. <b>Logic</b> (violet diamonds) is information: the button changes GPIO27, the program reads it and decides to change GPIO17. The logic path never powers the LED; the LED current comes from GPIO17.</p>
  <h3>Wiring recap</h3>
  <table class="wiring">
    <tr><th>From</th><th>To</th></tr>
    <tr><td>GPIO17 (pin 11)</td><td>Column 12 → 330 Ω → column 8</td></tr>
    <tr><td>LED anode / cathode</td><td>Column 8 / column 7</td></tr>
    <tr><td>Column 7</td><td>GND (pin 6)</td></tr>
    <tr><td>GPIO27 (pin 13)</td><td>Column 24, row a</td></tr>
    <tr><td>Button legs</td><td>Columns 24 and 27, rows e and f</td></tr>
    <tr><td>GND (pin 14)</td><td>Column 24, row i</td></tr>
  </table>`;

/** GPIO17 + LED signal for this lesson: the program drives it, so there is no extra "software" delay. */
class OutSignal extends Signal {
  get delay() {
    return 0;
  }
  get speed() {
    return this.slow ? 1 : 10;
  }
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export default {
  id: 'button',
  number: 2,
  title: 'Control an LED with a Button',
  chapter: 'GPIO input',
  defaultView: 'circuit',
  viewButtons,
  views: {
    circuit: { t: [5.9, 0.4, 0.2], r: 18, phi: 0.85, theta: 0 },
    gpio: { t: [3.3, 1.0, -0.1], r: 7.2, phi: 0.95, theta: 0.18 },
    button: { t: [8.0, 0.8, -3.0], r: 5.4, phi: 0.95, theta: 0.0 },
    led: { t: [3.9, 1.1, -2.5], r: 6.2, phi: 0.9, theta: 0.12 },
  },
  pageContent: PAGE_CONTENT.button,
  textures: () => ({
    left: leftPageTexture(PAGE_CONTENT.button),
    right: rightPageTexture({
      fig: 'FIG. 2', caption: 'Button → GPIO27 → program → GPIO17 → LED', page: 4,
      hint: 'Hold the blue button to press it. Drag the page to orbit, scroll to zoom.',
    }),
  }),

  async create(env) {
    const circuit = buildButtonCircuit();
    const F = circuit.fractions;
    const out = new OutSignal();
    out.ledFraction = F.out.ledApex;
    out.onChange((on) => circuit.pulse(11, on ? '#ffd27a' : '#7fb5ff'));
    const input = new Wave();

    let source;
    try {
      source = await (await fetch('python/led_button.py', { cache: 'no-store' })).text();
    } catch {
      source = '# Could not load python/led_button.py. Start the project with: npm start';
    }

    /* ---------- state ---------- */
    const held = new Set(); // sources currently holding the button: 'mouse', 'pad', 'kbd'...
    let plunger = 0; // 0 released .. 1 fully pressed (visual)
    let contact = false; // bridge touching both bars (hysteresis)
    let gpio27 = 1; // smoothed pin level for visuals (1 = HIGH)
    let running = false; // is the Python program running?
    let isPressed = false; // what button.is_pressed would return
    let simT = 0;
    let lastToggle = -99;
    let lastFire = -99;
    let popT = 0;
    let events = [];
    let packets = [];
    const hist27 = [{ t: performance.now(), v: 1 }];
    let flash = null; // { line, until }
    let ui = null;
    const slow = () => env.options.slow;

    const A = circuit.anchors;
    const up = (v, y) => v.clone().add(new THREE.Vector3(0, y, 0));
    const labels = [
      { id: 'gpio17', title: 'GPIO17 · pin 11', sub: () => `<span class="val">output · ${out.on ? '3.3 V · HIGH' : '0 V · LOW'}</span>`, at: up(A.pin11, 3.2), side: 'left' },
      { id: 'gpio27', title: 'GPIO27 · pin 13', sub: () => `<span class="val">input · ${contact ? '0 V · LOW' : '3.3 V · HIGH'}</span>`, at: up(A.pin13, 3.2), side: 'right' },
      { id: 'gnd6', title: 'GND · pin 6', sub: 'LED return', at: up(A.pin6, 0.35), side: 'left' },
      { id: 'gnd14', title: 'GND · pin 14', sub: 'Button return', at: up(A.pin14, 0.35), side: 'right' },
      { id: 'res', title: '330 Ω resistor', sub: 'Limits the LED current', at: up(A.resistor, 0.3), side: 'right' },
      { id: 'led', title: 'Red LED', sub: 'Long leg = anode (+)', at: A.led, side: 'left' },
      { id: 'button', title: 'Push button', sub: () => `<span class="val">${plunger > 0.5 ? 'Pressed' : 'Released'}</span> · hold to press`, at: A.button, side: 'right' },
    ];

    /* ---------- logging helpers (only while the notebook is mounted) ---------- */
    const log = (t, c) => ui && ui.log(t, c);
    const flashLine = (line, name) => (flash = { line, name, until: simT + 0.9 });

    /* ---------- electrical + program model ---------- */
    function onContact(c) {
      contact = c;
      input.set(c);
      hist27.push({ t: performance.now(), v: c ? 0 : 1 });
      if (hist27.length > 400) hist27.splice(0, hist27.length - 400);
      circuit.pulse(13, c ? '#6fe3ff' : '#ffd27a');
      log(c ? '# GPIO27: HIGH → LOW (button joins it to GND)' : '# GPIO27: LOW → HIGH (pull-up wins again)', 'c');

      const lat = slow() ? 0.6 : 0.05;
      // bounce_time: a change that reverses within 50 ms never reaches the program
      const last = events[events.length - 1];
      if (simT - lastToggle < 0.05 && last && !last.fired) {
        events.pop();
        packets = packets.filter((p) => p !== last.packet);
        lastToggle = simT;
        return;
      }
      lastToggle = simT;
      const packet = { t0: simT, lat, ignored: !running, color: c ? '#b388ff' : '#8fb4ff' };
      packets.push(packet);
      if (running) events.push({ type: c ? 'pressed' : 'released', due: simT + lat, packet, fired: false });
    }

    function fire(ev) {
      ev.fired = true;
      lastFire = simT;
      if (ev.type === 'pressed') {
        isPressed = true;
        out.set(true);
        flashLine(ui?.L.pressed ?? -1, 'when_pressed → led.on()');
        log('>>> when_pressed → led.on()   # GPIO17 → HIGH', 'p');
      } else {
        isPressed = false;
        out.set(false);
        flashLine(ui?.L.released ?? -1, 'when_released → led.off()');
        log('>>> when_released → led.off() # GPIO17 → LOW', 'p');
      }
    }

    function startProgram() {
      if (running) return;
      running = true;
      isPressed = contact; // gpiozero does not fire when_pressed for a button already held at start
      log('$ python3 led_button.py', 'p');
      log(contact ? '# started with the button held: no event yet' : '# waiting for events (pause)', 'c');
      ui?.refreshProgram();
    }
    function stopProgram(byUser) {
      if (!running) return;
      running = false;
      events = [];
      isPressed = false;
      out.set(false);
      flash = null;
      if (byUser) log('^C KeyboardInterrupt → GPIO17 released, LED off', 'c');
      ui?.refreshProgram();
    }

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml;
      tabs.how.innerHTML = howHtml;

      const code = renderCode($('#code', tabs.code), source);
      bindCopy($('#copyBtn', tabs.code), () => source, $('#code', tabs.code));
      const L = {
        pressed: code.find(/when_pressed/),
        released: code.find(/when_released/),
        pause: code.find(/pause\(\)/),
      };
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim));
      const chart = createTimingChart($('#timing', tabs.sim), [
        { label: 'GPIO27 (input)', history: () => hist27, isOn: () => !contact, hi: '3.3 V', lo: '0 V', on: 'HIGH (released)', off: 'LOW (pressed)', color: '#5cd68a', fill: 'rgba(92,214,138,0.14)' },
        { label: 'GPIO17 (output)', history: () => out.history, isOn: () => out.on, hi: '3.3 V', lo: '0 V', on: 'HIGH', off: 'LOW', color: '#ffcf6b' },
      ]);
      ui = { code, L, log: consoleLog, steps, chart };

      const q = (s) => $(s, tabs.sim);
      const nodes = { btn: q('#cBtn'), g27: q('#cG27'), prog: q('#cProg'), g17: q('#cG17'), led: q('#cLed') };
      const explain = q('#explain');
      const progEl = q('#progState');
      const pad = q('#btnPress'), btnRun = q('#btnRun'), btnStop = q('#btnStop');
      const optSlow = q('#optSlow'), optLabels = q('#optLabels');
      optSlow.checked = env.options.slow;
      optLabels.checked = env.options.labels;
      optSlow.addEventListener('change', (e) => (env.options.slow = e.target.checked));
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));

      // equivalent control for the 3D button: hold with pointer or keyboard
      pad.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        pad.setPointerCapture(e.pointerId);
        press('pad');
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, () => release('pad'));
      pad.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!e.repeat) press('kbd');
        }
      });
      pad.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && release('kbd'));
      pad.addEventListener('blur', () => release('kbd'));
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
      pad.addEventListener('click', (e) => e.preventDefault());

      btnRun.addEventListener('click', startProgram);
      btnStop.addEventListener('click', () => stopProgram(true));

      ui.refreshProgram = () => {
        btnRun.disabled = running;
        btnStop.disabled = !running;
        code.setTag(L.pause, running ? '← waiting for events' : '');
        if (!running) code.setActive(-1);
      };
      ui.frame = (now) => {
        const isHeld = plunger > 0.5;
        const set = (node, on, text) => {
          node.classList.toggle('on', on);
          $('b', node).textContent = text;
        };
        set(nodes.btn, isHeld, isHeld ? 'Pressed' : 'Released');
        set(nodes.g27, contact, contact ? '0 V · LOW' : '3.3 V · HIGH');
        set(nodes.prog, running && isPressed, running ? (isPressed ? 'True' : 'False') : 'stopped');
        set(nodes.g17, out.on, out.on ? '3.3 V · HIGH' : '0 V · LOW');
        set(nodes.led, out.led > 0.5, out.led > 0.5 ? 'ON' : 'OFF');
        pad.classList.toggle('held', held.size > 0);
        pad.setAttribute('aria-pressed', String(held.size > 0));

        let text;
        if (!running) text = 'The program is stopped, so nothing reads GPIO27. The button still changes the pin, but the LED cannot respond.';
        else if (contact && !isPressed) text = 'GPIO27 is LOW. The program waits for a stable signal (bounce_time) before it reacts.';
        else if (!contact && isPressed) text = 'GPIO27 is HIGH again. The program has not reacted to the release yet.';
        else if (contact) text = 'Pressed: the button joins GPIO27 to GND, so it reads 0 V (LOW). The program reads LOW as “pressed” and sets GPIO17 HIGH. The button does not power the LED.';
        else text = 'Released: the pull-up holds GPIO27 at 3.3 V (HIGH). button.is_pressed is False, GPIO17 stays LOW and the LED is off.';
        if (explain.textContent !== text) explain.textContent = text;

        const handling = flash && simT < flash.until;
        const ps = !running ? 'Python program: stopped' : handling ? `Python program: running · handling ${flash.name}` : 'Python program: running · waiting for events (pause)';
        if (progEl.textContent !== ps) progEl.textContent = ps;
        progEl.classList.toggle('on', running);

        code.setActive(handling ? flash.line : -1);
        chart.draw(now);
      };
      consoleLog('# Web simulation. No real GPIO is used.', 'c');
      startProgram();
      ui.refreshProgram();
    }

    function press(src) {
      held.add(src);
    }
    function release(src) {
      held.delete(src);
    }

    function packetViews() {
      const legT = slow() ? 0.9 : 0.1;
      const pf = F.logic.prog;
      const views = [];
      packets = packets.filter((p) => {
        const e = simT - p.t0;
        const life = p.ignored ? p.lat + 0.6 : p.lat + legT + 0.3;
        if (e > life) return false;
        let s, alpha = 1;
        if (e < p.lat) s = (pf * e) / p.lat;
        else if (p.ignored) {
          s = pf;
          alpha = 1 - (e - p.lat) / 0.6;
        } else {
          const u = clamp((e - p.lat) / legT, 0, 1);
          s = pf + (1 - pf) * u;
          if (u >= 1) alpha = 1 - (e - p.lat - legT) / 0.3;
        }
        views.push({ s, alpha: clamp(alpha, 0, 1), color: p.ignored ? '#9a9ab0' : p.color, e, lat: p.lat });
        return true;
      });
      return views;
    }

    function resetAll() {
      held.clear();
      events = [];
      packets = [];
      flash = null;
      plunger = 0;
      contact = false;
      gpio27 = 1;
      running = false;
      isPressed = false;
      lastToggle = -99;
      input.reset();
      out.reset();
      hist27.length = 0;
      hist27.push({ t: performance.now(), v: 1 });
    }

    return {
      root: circuit.root,
      popDuration: 2.85,
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
        out.slow = slow();

        // button mechanics: quick travel, contact with hysteresis
        const target = held.size > 0 && popT > 2.0 ? 1 : 0;
        plunger += (target - plunger) * (1 - Math.exp(-dt * (target ? 26 : 16)));
        if (Math.abs(target - plunger) < 0.002) plunger = target;
        if (!contact && plunger > 0.85) onContact(true);
        else if (contact && plunger < 0.6) onContact(false);

        // program events (after bounce_time, stretched in slow motion)
        for (const ev of events) if (!ev.fired && simT >= ev.due) fire(ev);
        events = events.filter((e) => !e.fired);

        input.update(dt, slow() ? 1 / 0.9 : 10);
        out.update(dt);
        gpio27 += ((contact ? 0 : 1) - gpio27) * (1 - Math.exp(-dt * 14));

        const views = packetViews();
        circuit.update(time, dt, {
          out, input, plunger, gpio27, packets: views,
        }, camera, viewportH);
      },
      activeStep() {
        const pressing = held.size > 0 && plunger < 0.85;
        if (pressing) return 0;
        const live = packets.filter((p) => !p.ignored);
        if (live.length) {
          const p = live[live.length - 1];
          const e = simT - p.t0;
          if (e < p.lat) return e < p.lat * 0.4 ? 1 : 2;
          return simT - lastFire < 0.4 ? 3 : 4;
        }
        if (packets.length) return 1;
        return out.on && out.led > 0.5 ? 4 : -1;
      },
      /** Stop the program and every electrical animation (used when the page turns). */
      stop(reason) {
        resetAll();
        ui?.refreshProgram?.();
        if (reason === 'reading') ui?.log('# Simulation stopped while reading. Press Run program to start it again.', 'c');
      },
      pick(raycaster) {
        if (popT < 2.0 || !circuit.root.visible) return false;
        return raycaster.intersectObject(circuit.hit, false).length > 0;
      },
      pressStart: press,
      pressEnd: release,
      releaseAll() {
        held.clear();
      },
      runFromQuery() {},
      debugOn() {
        press('debug');
      },
    };
  },
};
