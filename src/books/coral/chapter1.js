import * as THREE from 'three';
import { buildPresenceScene } from './presenceScene.js';
import { leftPageTexture, rightPageTexture } from '../../textures.js';
import { CORAL_PRESENCE_PAGE } from './pageContent.js';
import { CORAL, SOURCES, PresenceSim, CYCLE, CYCLE_MS, visibleShare, personDetected, detectorScores, fovFromDiagonal } from './presence.js';
import { $, $$, escapeHtml, renderCode, bindCopy, createConsole, renderSteps } from '../../ui.js';

/*
 * Coral book, chapter 1: "How does Coral know someone is there?"
 *   scene  src/books/coral/presenceScene.js  (official CAD model of the Dev Board Micro, figure, camera image panel)
 *   logic  src/books/coral/presence.js       (simulated detector and inference cycle; verified facts and sources)
 *   page   src/books/coral/pageContent.js    (left page)
 * The camera image and the detector use the same pinhole geometry, so what the panel shows and what the detector
 * "sees" always agree. The detector itself is a stand-in, not a neural network (said on the page).
 */

const viewButtons = [['circuit', 'Whole project'], ['stage', 'Board + person'], ['leftpage', 'Left page'], ['board', 'Board'], ['camside', 'Camera side'], ['panel', 'Camera image']];

const STEPS = [
  { title: 'The camera captures, all the time', text: 'The Himax HM01B0 sensor delivers a 324 × 324 image, frame after frame. The green Camera LED above it is on while it captures, whatever the image shows.', view: 'board' },
  { title: 'The image is made small and gray', text: 'For the detector each frame becomes 96 × 96 pixels in grayscale (CameraFormat::kY8). That is all the model gets: about 9,000 numbers.', view: 'panel' },
  { title: 'The model runs on the Cortex-M7', text: 'A 300 kB TensorFlow Lite Micro model runs on the Cortex-M7 core of the NXP i.MX RT1176. It returns two scores: person and no person. The Edge TPU is not used.', view: 'board' },
  { title: 'The program sets the User LED', text: 'One line decides: person_detected = person_score > no_person_score. Then LedSet(Led::kUser, person_detected) turns the green User LED near the centre on or off.', view: 'board' },
  { title: 'Presence, not identity', text: 'The answer is only “person” or “no person”. Nothing in the demo recognises who it is, and nothing is stored or sent anywhere.', view: 'stage' },
];

const PARTS = {
  camera: { name: 'Camera · Himax HM01B0', text: 'It turns light into a 324 × 324 image, again and again, whether or not anyone is there.' },
  mcu: { name: 'Cortex-M7 · inside the NXP i.MX RT1176', text: 'It runs the small person-detection model on each image and gets two scores: person and no person.' },
  ledCam: { name: 'Camera LED · green, above the camera', text: 'It shows that the camera is capturing images. It says nothing about what is in them.' },
  ledUser: { name: 'User LED · green, near the centre', text: 'The program turns it on when the person score beats the no-person score, and off otherwise.' },
  tpu: { name: 'Coral Edge TPU · under the metal shield', text: 'An accelerator for larger models. This demo does not use it, so its white LED stays off.' },
};
const PART_ORDER = ['camera', 'mcu', 'ledCam', 'ledUser', 'tpu'];

const PREDICT = { camera: 'the Camera LED (top)', user: 'the User LED (centre)', both: 'both LEDs' };
const QUIZ = [
  { id: 'empty', text: 'The scene is empty.', ok: false, why: 'Not necessarily. Someone may be just outside the frame, in the dark, or not recognised by the model.' },
  { id: 'stopped', text: 'The camera has stopped capturing.', ok: false, why: 'No. The Camera LED is on, so the camera is capturing images.' },
  { id: 'right', text: 'The detector is not signalling a person right now.', ok: true, why: 'Right. The User LED only reports the detector’s latest answer, nothing more.' },
  { id: 'who', text: 'The board has recognised who is there.', ok: false, why: 'No. The model only scores “person” and “no person”. It never identifies anyone.' },
];
const STAGE_TEXT = { capture: 'Camera captures a frame', resize: 'Frame becomes 96 × 96 gray', infer: 'Model runs on the Cortex-M7', decide: 'Program sets the User LED' };
const WALK_SPEED = 0.36; // path lengths per second for the buttons
const esc = (s) => escapeHtml(String(s));
const fov = fovFromDiagonal(CORAL.camera.diagonalFovDeg);

const ICON_CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 21v-3.5a6.5 6.5 0 0 1 13 0V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/* The official code (Apache-2.0), shortened: the lines this chapter talks about, unchanged, with // ... for cuts. */
const CODE = `// From google-coral/coralmicro, examples/tflm_person_detection_m7
// Copyright 2022 Google LLC. Licensed under the Apache License, Version 2.0.
// Shortened for the book: "// ..." marks lines left out.

// person_detection.cc
void RespondToDetection(tflite::ErrorReporter* error_reporter,
                        int8_t person_score, int8_t no_person_score) {
  TF_LITE_REPORT_ERROR(error_reporter, "person_score: %d no_person_score: %d",
                       person_score, no_person_score);

  bool person_detected = person_score > no_person_score;
  LedSet(coralmicro::Led::kUser, person_detected);
}

[[noreturn]] void Main() {
  // ...
  CameraTask::GetSingleton()->SetPower(true);
  CameraTask::GetSingleton()->Enable(CameraMode::kStreaming);

  setup();
  while (true) {
    // ...
    loop();
    // ...
  }
}

// main_functions.cc (TensorFlow Lite Micro person detection, Apache-2.0)
void loop() {
  // Get image from provider.
  if (kTfLiteOk != GetImage(error_reporter, kNumCols, kNumRows, kNumChannels,
                            input->data.int8)) {
    TF_LITE_REPORT_ERROR(error_reporter, "Image capture failed.");
  }

  // Run the model on this input and make sure it succeeds.
  if (kTfLiteOk != interpreter->Invoke()) {
    TF_LITE_REPORT_ERROR(error_reporter, "Invoke failed.");
  }

  TfLiteTensor* output = interpreter->output(0);

  // Process the inference results.
  int8_t person_score = output->data.uint8[kPersonIndex];
  int8_t no_person_score = output->data.uint8[kNotAPersonIndex];
  RespondToDetection(error_reporter, person_score, no_person_score);
}
`;

const simHtml = () => `
  <p class="note sim-note"><b>Didactic simulation.</b> The board, its camera image and the detector run in your browser. No board, webcam, camera permission or online service is used. The detector is a stand-in, not a neural network: it checks how much of the person is in the frame and how well it is lit.</p>

  <div class="led-pair" role="group" aria-label="The two green LEDs of the board">
    <div class="led-chip" id="chipCam"><i class="led-ico">${ICON_CAM}</i><div><span>Camera LED · top</span><b>–</b><small></small></div></div>
    <div class="led-chip" id="chipUser"><i class="led-ico">${ICON_PERSON}</i><div><span>User LED · centre</span><b>–</b><small></small></div></div>
  </div>
  <p class="prog-state" id="progState"></p>

  <ol class="cp-steps">
    <li class="cp-step" id="cpPredict">
      <h3><i>1</i> Predict</h3>
      <p>The camera is on and the User LED is off. <b>If someone walks into the image, which light will change?</b></p>
      <div class="btn-row three choice" id="predict" role="group" aria-label="Your prediction">
        <button class="btn" data-p="camera">Camera LED (top)</button>
        <button class="btn" data-p="user">User LED (centre)</button>
        <button class="btn" data-p="both">Both</button>
      </div>
      <p class="note" id="predictOut">Choose one. Then try it in step 2.</p>
      <div class="reveal" id="reveal" hidden></div>
      <button class="chip-btn" id="btnReveal" hidden>I tried it: show the explanation</button>
    </li>

    <li class="cp-step" id="cpExperiment">
      <h3><i>2</i> Experiment</h3>
      <p>Drag the person in the 3D scene (mouse or finger), or use the buttons. Watch both LEDs and the camera image.</p>
      <div class="btn-row">
        <button id="btnIn" class="btn accent">Step into frame</button>
        <button id="btnOut" class="btn">Step out of frame</button>
      </div>
      <div class="slider-ctl">
        <label for="posRange">Where the person is: <b id="posVal"></b></label>
        <input type="range" id="posRange" min="0" max="100" step="1" value="0" aria-describedby="posHint">
        <p class="note" id="posHint">0 = outside the frame, 100 = in the middle of the frame.</p>
      </div>
      <div class="cp-view">
        <figure class="px96-wrap">
          <canvas id="in96" width="${CORAL.model.inputW}" height="${CORAL.model.inputH}" class="px96" role="img" aria-label="The 96 by 96 grayscale image the model receives"></canvas>
          <figcaption>What the model gets: ${CORAL.model.inputW} × ${CORAL.model.inputH} gray</figcaption>
        </figure>
        <div class="scores">
          <div class="score-row"><span>person</span><div class="bar"><i id="barP"></i></div><b id="valP">–</b></div>
          <div class="score-row"><span>no person</span><div class="bar"><i id="barN"></i></div><b id="valN">–</b></div>
          <p class="note" id="shareInfo"></p>
        </div>
      </div>
    </li>

    <li class="cp-step" id="cpUnderstand">
      <h3><i>3</i> Understand</h3>
      <p>Tap a part of the board in the 3D scene, or here:</p>
      <div class="part-btns" id="partBtns">${PART_ORDER.map((k) => `<button class="chip-btn" data-part="${k}" aria-pressed="false">${esc(PARTS[k].name.split(' · ')[0])}</button>`).join('')}</div>
      <p class="part-info" id="partInfo" aria-live="polite">Nothing selected yet.</p>
      <ol class="pipe" id="pipe" aria-label="One cycle of the demo">
        ${CYCLE.map((c, i) => `<li data-stage="${c.id}"><b>${i + 1}</b><span>${STAGE_TEXT[c.id]}</span></li>`).join('')}
      </ol>
      <p class="note">This repeats for every frame. The board also has a Coral Edge TPU accelerator, but the factory demo runs its 300 kB model on the Cortex-M7. The answer is “person” or “no person”: it shows presence and does not identify anyone.</p>
    </li>

    <li class="cp-step" id="cpCheck">
      <h3><i>4</i> Check</h3>
      <p><b>The camera is on and the User LED is off. What can you say?</b></p>
      <div class="quiz" id="quiz" role="group" aria-label="Choose an answer">
        ${QUIZ.map((q) => `<button class="btn quiz-opt" data-q="${q.id}">${esc(q.text)}</button>`).join('')}
      </div>
      <p class="quiz-out" id="quizOut" aria-live="polite"></p>
      <div id="realWorld" hidden>
        <p>On a real board the framing and the light matter, so a dark User LED does not prove the scene is empty. Try it:</p>
        <div class="btn-row">
          <button id="btnHalf" class="btn">Stand half in the frame</button>
          <button id="btnDim" class="btn" aria-pressed="false">Dim the room</button>
        </div>
        <p class="note" id="realOut"></p>
        <p class="bridge">In the LED lesson, <code>led.on()</code> lit the LED because one line said so. Here a line still does it, <code>LedSet(Led::kUser, person_detected)</code>, but its value comes from what a model finds in an image. <a href="?book=raspberry-pi&amp;open=1&amp;lesson=1">Open the LED lesson</a></p>
      </div>
    </li>
  </ol>

  <h3>Serial console (simulated)</h3>
  <div class="console" id="console" aria-live="off"></div>
  <div class="options">
    <label><input type="checkbox" id="optFov" checked> Field of view</label>
    <label><input type="checkbox" id="optRoute" checked> Path of each cycle</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = () => `
  <h3 class="code-title">C++ · coralmicro (FreeRTOS)</h3>
  <p class="code-sub">The open-source example of the same person detector, from Google's <code>coralmicro</code> repository. The lines highlight as the simulated cycle runs.</p>
  <div class="code-head"><span>tflm_person_detection_m7 (shortened)</span><span class="code-actions"><button id="copyBtn" class="chip-btn">Copy</button></span></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What the lines do</h3>
  <ul class="explain-list">
    <li><code>Enable(CameraMode::kStreaming)</code>: the camera captures frames continuously. The Camera LED shows this activity.</li>
    <li><code>GetImage(…)</code>: takes the next frame as ${CORAL.model.inputW} × ${CORAL.model.inputH} grayscale pixels (<code>kY8</code>), the size the model was trained with.</li>
    <li><code>interpreter-&gt;Invoke()</code>: runs the TensorFlow Lite Micro model on the Cortex-M7. It fills two numbers, the person score and the no-person score.</li>
    <li><code>person_score &gt; no_person_score</code>: the whole decision. <code>LedSet(Led::kUser, …)</code> turns the User LED on when it is true and off when it is false.</li>
    <li>The scores are printed on the serial console, like the simulated console in the Simulate tab: <code>person_score: 67 no_person_score: -67</code>.</li>
  </ul>
  <p class="note">The example also switches the orange Status LED on at start. The guide describes the factory demo with the Camera LED and the User LED only, so this page shows those two.</p>
  <h3>Try it on a real board</h3>
  <ol class="steps-list">
    <li>The board arrives with the person detection demo installed. Connect a USB-C cable to the board and your computer.</li>
    <li>After a moment the green LED above the camera turns on: the camera is on.</li>
    <li>Light your face well, hold the board up with the USB port facing down, and aim the camera at yourself. Then away, and back.</li>
    <li>The green LED near the centre turns on when it faces you.</li>
  </ol>
  <p class="note">Hold the board by its edges: some components can get hot. Steps from Coral's guide “Get started with the Dev Board Micro”. This page did not run on a real board.</p>`;

const howHtml = () => `
  <p>Click a step to move the camera. The highlighted step follows the simulated cycle.</p>
  <ol class="steps" id="steps"></ol>
  <h3>Checked facts</h3>
  <table class="wiring">
    <tr><th>Part</th><th>What the documentation says</th></tr>
    <tr><td>MCU</td><td>${esc(CORAL.mcu)}: ${esc(CORAL.cores.m7)} and ${esc(CORAL.cores.m4)}</td></tr>
    <tr><td>Camera</td><td>${esc(CORAL.camera.sensor)}, ${CORAL.camera.px} × ${CORAL.camera.px} px, ${CORAL.camera.diagonalFovDeg}° diagonal field of view, f/${CORAL.camera.fNumber.toFixed(1)}, fixed focus</td></tr>
    <tr><td>Camera LED</td><td>Green, above the camera. On during image capture.</td></tr>
    <tr><td>User LED</td><td>Green, near the centre. Programmable, off by default.</td></tr>
    <tr><td>Edge TPU LED</td><td>White. On while the Edge TPU is powered.</td></tr>
    <tr><td>Demo model</td><td>About ${CORAL.model.sizeKb} kB, runs entirely on the Cortex-M7, not on the Edge TPU. Input ${CORAL.model.inputW} × ${CORAL.model.inputH} × ${CORAL.model.channels} (grayscale).</td></tr>
    <tr><td>Board</td><td>${CORAL.boardMm.w} × ${CORAL.boardMm.h} mm</td></tr>
  </table>
  <h3>What is real and what is simulated here</h3>
  <ul class="explain-list">
    <li><b>Real:</b> the board's shape and the positions of the camera, the LEDs, the Edge TPU shield and the i.MX RT1176. They come from Google's official CAD model (<code>Dev Board Micro.step</code>, Apache-2.0), shown at life size, USB-C down as the guide says to hold it.</li>
    <li><b>Real:</b> the order of the steps and the LED rule, from the coralmicro example code.</li>
    <li><b>Real geometry:</b> the camera image is rendered from the lens with the ${CORAL.camera.diagonalFovDeg}° diagonal field of view (${fov.hDeg.toFixed(1)}° across a square sensor).</li>
    <li><b>Simulated:</b> the detector. It scores how much of the person is inside the frame (head and body count more than legs) and how well lit the image is. A real model looks at pixels and can be wrong in ways this one is not.</li>
    <li><b>Simulated:</b> the timing. One cycle takes ${CYCLE_MS} ms here so you can follow it. The real example prints its own latency on the serial console.</li>
    <li><b>Illustrations:</b> the stand, the cable, the figure (not to scale) and the colours of the board, which the CAD model does not carry. The CAD model has no printed markings, so the board shows none.</li>
  </ul>
  <h3>Sources</h3>
  <ul class="explain-list">${SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul>`;

export default {
  id: 'coral-presence',
  number: 1,
  title: 'How does Coral know someone is there?',
  chapter: 'Camera, model, LED',
  codeTab: 'C++',
  defaultView: 'stage',
  viewButtons,
  views: {
    circuit: { t: [0, 0.6, 0.4], r: 27, phi: 0.74, theta: 0, fit: 'book' },
    // from the front, a little to the right of the camera's axis: the board's face and the person side by side
    stage: { t: [6.6, 2.4, -1.4], r: 19.5, phi: 0.9, theta: 0.12 },
    // the whole board below the camera bar, also on a phone (the camera and its LED are at the top of the board)
    board: { t: [8.85, 4.5, -3.85], r: 10.5, phi: 1.22, theta: -0.96 },
    camside: { t: [5.0, 3.0, -1.2], r: 10.5, phi: 1.12, theta: 2.18 },
    panel: { t: [9.0, 2.7, 3.7], r: 8.5, phi: 0.98, theta: -0.3 },
  },
  pageContent: CORAL_PRESENCE_PAGE,
  textures: () => ({
    left: leftPageTexture(CORAL_PRESENCE_PAGE),
    right: rightPageTexture({
      fig: 'FIG. 1', caption: 'Camera → 96 × 96 image → model on the Cortex-M7 → User LED', page: 2,
      hint: 'Drag the person into the camera’s view, or use the notebook.',
    }),
  }),

  async create(env) {
    const scene = await buildPresenceScene();

    /* ---------- state ---------- */
    let light = 1;
    const measure = () => ({ share: visibleShare(scene.pinhole, scene.figureWorld), light });
    const sim = new PresenceSim(measure);
    let running = false, paused = false, autoStart = false, popT = 0;
    let targetU = null, walkingFor = 0, simSpeed = 1;
    let ui = null;
    let pickWhat = null, pickPoint = null, pickRay = null, drag = null, pressMoved = false;
    let prediction = null, revealed = false, sawOn = false, sawOffAfterOn = false, quiz = null;
    let eventsSeen = 0, lastLoggedCycle = -1;
    const log = (t, c) => ui && ui.log(t, c);

    function start() {
      running = true;
      paused = false;
      sim.reset();
      eventsSeen = 0;
      lastLoggedCycle = -1;
      log('Person Detection Example!', 'p');
      log('# Camera streaming. The Camera LED is on: images are being captured.', 'c');
      ui?.refresh();
    }
    function setPaused(on) {
      if (!running || paused === on) return;
      paused = on;
      log(on ? '# Paused: the simulated cycle is frozen.' : '# Playing again.', 'c');
      ui?.refresh();
    }
    function moveTo(u) {
      targetU = Math.min(1, Math.max(0, u));
    }
    /**
     * u along the path where as much of the person as possible is in the image (at least a quarter) while the
     * detector still answers "no person": someone is there and the User LED is off. Computed, not guessed.
     */
    function halfU() {
      const keep = scene.u;
      let best = null, bestShare = -1;
      for (let k = 0; k <= 200; k++) {
        scene.setU(k / 200, false);
        const share = visibleShare(scene.pinhole, scene.figureWorld);
        if (share >= 0.25 && !personDetected(detectorScores(share, 1)) && share > bestShare) {
          bestShare = share;
          best = k / 200;
        }
      }
      scene.setU(keep, false);
      return best ?? 0.5;
    }
    function select(part) {
      scene.selectPart(part);
      ui?.showPart(part);
    }

    /* ---------- labels ---------- */
    const A = scene.anchors;
    const labels = [
      { id: 'ledCam', cls: 'compact', title: 'Camera LED', sub: () => `<span class="val">${running ? 'ON · camera capturing' : 'off'}</span>`, at: A.ledCam, side: 'right' },
      { id: 'ledUser', cls: 'compact', title: 'User LED', sub: () => `<span class="val">${running && sim.userLed ? 'ON · person detected' : 'OFF · no person detected'}</span>`, at: A.ledUser, side: 'right' },
      { id: 'figure', cls: 'compact', title: 'Person', sub: () => `<span class="val">${Math.round(measure().share * 100)} % in the frame</span> · drag`, at: A.figure, side: 'right' },
      { id: 'panel', cls: 'compact', title: 'Camera image', sub: 'simulated · what the sensor captures', at: A.panel, side: 'right' },
      { id: 'camera', cls: 'compact', title: 'Camera · HM01B0', sub: `${CORAL.camera.px} × ${CORAL.camera.px} px · ${CORAL.camera.diagonalFovDeg}°`, at: A.camera, side: 'left' },
      { id: 'mcu', cls: 'compact', title: 'i.MX RT1176 · Cortex-M7', sub: 'runs the detector', at: A.mcu, side: 'left' },
      { id: 'tpu', cls: 'compact', title: 'Edge TPU', sub: 'not used by this demo', at: A.tpu, side: 'left', hideNarrow: true },
      { id: 'out', cls: 'compact', title: 'Outside the frame', sub: 'start here', at: A.out, side: 'left', hideNarrow: true },
    ];

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      autoStart = autoStart || !running;
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml();
      tabs.how.innerHTML = howHtml();
      const code = renderCode($('#code', tabs.code), CODE, 'cpp');
      bindCopy($('#copyBtn', tabs.code), () => CODE, $('#code', tabs.code));
      const L = {
        stream: code.find(/Enable\(CameraMode::kStreaming\)/),
        get: code.find(/GetImage\(error_reporter/),
        invoke: code.find(/interpreter->Invoke\(\)/),
        decide: code.find(/bool person_detected/),
        led: code.find(/LedSet\(coralmicro::Led::kUser/),
        print: code.find(/"person_score: %d/),
      };
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim), 9);
      ui = { code, L, log: consoleLog, steps };
      const q = (s) => $(s, tabs.sim);
      const chipCam = q('#chipCam'), chipUser = q('#chipUser'), progEl = q('#progState');
      const predictBtns = $$('#predict button', tabs.sim), predictOut = q('#predictOut'), reveal = q('#reveal'), btnReveal = q('#btnReveal');
      const btnIn = q('#btnIn'), btnOut = q('#btnOut'), posRange = q('#posRange'), posVal = q('#posVal');
      const c96 = q('#in96'), ctx96 = c96.getContext('2d'), img96 = ctx96.createImageData(CORAL.model.inputW, CORAL.model.inputH);
      const barP = q('#barP'), barN = q('#barN'), valP = q('#valP'), valN = q('#valN'), shareInfo = q('#shareInfo');
      const partBtns = $$('#partBtns button', tabs.sim), partInfo = q('#partInfo'), pipeItems = $$('#pipe li', tabs.sim);
      const quizBtns = $$('#quiz button', tabs.sim), quizOut = q('#quizOut'), realWorld = q('#realWorld'), realOut = q('#realOut');
      const btnHalf = q('#btnHalf'), btnDim = q('#btnDim');
      const optFov = q('#optFov'), optRoute = q('#optRoute'), optLabels = q('#optLabels');

      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      optFov.checked = ui.showFov ?? true;
      optRoute.checked = ui.showRoute ?? true;
      ui.showFov = optFov.checked;
      ui.showRoute = optRoute.checked;
      optFov.addEventListener('change', () => (ui.showFov = optFov.checked));
      optRoute.addEventListener('change', () => (ui.showRoute = optRoute.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Simulated serial console (115200 baud on a real board).', 'c');

      const renderPrediction = () => {
        predictBtns.forEach((b) => b.classList.toggle('chosen', b.dataset.p === prediction));
        predictBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === prediction)));
        if (prediction && !revealed) predictOut.textContent = `Your prediction: ${PREDICT[prediction]}. Now bring the person in and out in step 2.`;
      };
      predictBtns.forEach((b) => b.addEventListener('click', () => {
        if (revealed) return;
        prediction = b.dataset.p;
        renderPrediction();
      }));
      const doReveal = () => {
        revealed = true;
        const right = prediction === 'user';
        reveal.hidden = false;
        btnReveal.hidden = true;
        reveal.innerHTML = `${prediction ? `<p class="${right ? 'good' : 'bad'}"><b>${right ? 'Your prediction was right.' : `You predicted ${esc(PREDICT[prediction])}.`}</b></p>` : ''}
          <p>Only the <b>User LED</b> changed. The <b>Camera LED</b> stayed on the whole time, with and without the person.</p>
          <p>The Camera LED tells you the camera is capturing. The User LED tells you what the detector answered about the latest image.</p>`;
        predictBtns.forEach((b) => (b.disabled = true));
        predictOut.textContent = '';
        log('# Explanation shown in step 1.', 'c');
      };
      btnReveal.addEventListener('click', doReveal);
      ui.maybeReveal = () => {
        if (revealed) return;
        if (sawOn && sawOffAfterOn) doReveal();
        else if (sawOn) btnReveal.hidden = false;
      };
      renderPrediction();
      if (revealed) doReveal();

      btnIn.addEventListener('click', () => moveTo(1));
      btnOut.addEventListener('click', () => moveTo(0));
      posRange.addEventListener('input', () => {
        targetU = null;
        scene.setU(Number(posRange.value) / 100, true);
        walkingFor = 0.25;
      });

      ui.showPart = (part) => {
        partBtns.forEach((b) => {
          b.classList.toggle('active', b.dataset.part === part);
          b.setAttribute('aria-pressed', String(b.dataset.part === part));
        });
        partInfo.innerHTML = part ? `<b>${esc(PARTS[part].name)}</b> ${esc(PARTS[part].text)}` : 'Nothing selected yet.';
      };
      partBtns.forEach((b) => b.addEventListener('click', () => select(scene.selected === b.dataset.part ? null : b.dataset.part)));
      ui.showPart(scene.selected);

      const renderQuiz = () => {
        quizBtns.forEach((b) => {
          const it = QUIZ.find((x) => x.id === b.dataset.q);
          b.classList.toggle('right', quiz === it.id && it.ok);
          b.classList.toggle('wrong', quiz === it.id && !it.ok);
          b.setAttribute('aria-pressed', String(quiz === it.id));
        });
        const it = QUIZ.find((x) => x.id === quiz);
        quizOut.textContent = it ? it.why : '';
        quizOut.className = `quiz-out ${it ? (it.ok ? 'good' : 'bad') : ''}`;
        realWorld.hidden = !(it && it.ok);
      };
      quizBtns.forEach((b) => b.addEventListener('click', () => {
        quiz = b.dataset.q;
        renderQuiz();
      }));
      renderQuiz();
      btnHalf.addEventListener('click', () => moveTo(halfU()));
      btnDim.addEventListener('click', () => {
        light = light < 1 ? 1 : 0.12;
        scene.setLight(light);
        btnDim.setAttribute('aria-pressed', String(light < 1));
        btnDim.textContent = light < 1 ? 'Light the room again' : 'Dim the room';
        log(light < 1 ? '# Room light dimmed (the camera image gets dark).' : '# Room light back to normal.', 'c');
      });
      btnDim.setAttribute('aria-pressed', String(light < 1));
      btnDim.textContent = light < 1 ? 'Light the room again' : 'Dim the room';

      ui.refresh = () => {};
      let lastPix = 0;
      const setText = (el, t) => el.textContent !== t && (el.textContent = t);
      ui.frame = (now) => {
        const camOn = running && sim.cameraLed, userOn = running && sim.userLed;
        chipCam.classList.toggle('on', camOn);
        chipUser.classList.toggle('on', userOn);
        setText($('b', chipCam), camOn ? 'ON' : 'OFF');
        setText($('small', chipCam), camOn ? 'the camera is capturing' : 'camera off');
        setText($('b', chipUser), userOn ? 'ON' : 'OFF');
        setText($('small', chipUser), userOn ? 'detector says: person' : 'detector says: no person');
        setText(progEl, !running ? 'Board: starting…' : paused ? 'Board: PAUSED (Play in the top bar continues)' : `Board: running · ${STAGE_TEXT[sim.stageId]}`);
        progEl.classList.toggle('on', running && !paused);
        const share = measure().share;
        const pct = Math.round(scene.u * 100);
        if (document.activeElement !== posRange && Number(posRange.value) !== pct) posRange.value = String(pct);
        setText(posVal, pct === 0 ? 'outside the frame' : pct === 100 ? 'middle of the frame' : `${pct} of 100`);
        const s = sim.scores;
        barP.style.width = `${((s.person + 128) / 255) * 100}%`;
        barN.style.width = `${((s.noPerson + 128) / 255) * 100}%`;
        barP.classList.toggle('win', personDetected(s));
        barN.classList.toggle('win', !personDetected(s));
        setText(valP, running ? String(s.person) : '–');
        setText(valN, running ? String(s.noPerson) : '–');
        setText(shareInfo, `${Math.round(share * 100)} % of the person is inside the frame${light < 1 ? ' · room dimmed' : ''}. Last answer: ${personDetected(s) ? 'person' : 'no person'}.`);
        pipeItems.forEach((li) => li.classList.toggle('active', running && li.dataset.stage === sim.stageId));
        if (!realWorld.hidden) {
          const someone = share > 0.15;
          setText(realOut, someone && !userOn ? 'Someone is in the image and the User LED is off.' : someone ? 'The detector sees a person now.' : 'Nobody is in the image.');
        }
        // the 96 x 96 input: read back a few times a second (rows come bottom-up from WebGL)
        if (now - lastPix > 250) {
          lastPix = now;
          scene.requestPixels();
        }
        const px = scene.takePixels();
        if (px) {
          const W = CORAL.model.inputW, H = CORAL.model.inputH;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const src = ((H - 1 - y) * W + x) * 4, dst = (y * W + x) * 4;
            img96.data[dst] = img96.data[dst + 1] = img96.data[dst + 2] = px[src];
            img96.data[dst + 3] = 255;
          }
          ctx96.putImageData(img96, 0, 0);
        }
        // highlighted code line
        let active = -1;
        if (running) {
          const st = sim.stageId;
          active = st === 'capture' || st === 'resize' ? L.get : st === 'infer' ? L.invoke : [L.decide, L.led];
        }
        code.setActive(active);
        code.setTag(L.decide, running && sim.stageId === 'decide' ? `← ${s.person} > ${s.noPerson} is ${personDetected(s)}` : '');
      };
    }

    /* ---------- runtime ---------- */
    function resetSim() {
      running = false;
      paused = false;
      targetU = null;
      scene.setU(0, false);
      light = 1;
      scene.setLight(1);
      sim.reset();
      sim.powered = false;
      sawOn = sawOffAfterOn = false;
    }
    resetSim();

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
      update(time, dt) {
        if (autoStart && popT >= scene.popDuration - 0.2) {
          autoStart = false;
          start();
        }
        let walking = walkingFor > 0;
        walkingFor = Math.max(0, walkingFor - dt);
        const sdt = Math.min(dt, 0.1) * simSpeed; // simulated seconds this frame (simSpeed is 1 except in tests)
        if (running && !paused) {
          if (targetU != null) {
            const d = targetU - scene.u, stepU = WALK_SPEED * sdt;
            if (Math.abs(d) <= stepU) {
              scene.setU(targetU, true);
              targetU = null;
            } else scene.setU(scene.u + Math.sign(d) * stepU, true);
            walking = true;
          }
          sim.step(sdt * 1000);
          // LED changes: the console prints them, and they drive the "reveal" of step 1
          while (eventsSeen < sim.events.length) {
            const ev = sim.events[eventsSeen++];
            log(`person_score: ${ev.scores.person} no_person_score: ${ev.scores.noPerson}`, 'p');
            log(ev.on ? '# person_score > no_person_score → LedSet(kUser, true): User LED on' : '# person_score <= no_person_score → LedSet(kUser, false): User LED off', 'c');
            if (ev.on) sawOn = true;
            else if (sawOn) sawOffAfterOn = true;
            ui?.maybeReveal();
          }
          if (sim.cycles !== lastLoggedCycle && sim.cycles % 6 === 0 && sim.stageId === 'capture') {
            lastLoggedCycle = sim.cycles;
            log(`person_score: ${sim.scores.person} no_person_score: ${sim.scores.noPerson}`, 'p');
          }
        }
        scene.update(time, dt, {
          camLed: running && sim.cameraLed, userLed: running && sim.userLed, stage: running && !paused ? sim.stageId : null, stageK: sim.stageProgress(),
          decision: personDetected(sim.scores), showFov: ui ? ui.showFov !== false : true, showRoute: ui ? ui.showRoute !== false : true, walking: walking && !paused,
        });
      },
      activeStep() {
        if (!running) return -1;
        return { capture: 0, resize: 1, infer: 2, decide: 3 }[sim.stageId];
      },
      /** Page turn, reading mode, closing the book, back to the library: stop and put the person outside again. */
      stop(reason) {
        const was = running;
        resetSim();
        autoStart = false;
        if (ui) {
          ui.code.setActive(-1);
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Play in the top bar to start it again.', 'c');
          else if (was) ui.log('# Simulation stopped.', 'c');
        }
      },
      pick(raycaster) {
        if (popT < scene.popDuration || !scene.root.visible) return false;
        const hits = raycaster.intersectObjects(scene.hitMeshes(), false);
        if (!hits.length) return false;
        pickWhat = hits[0].object.userData.hit || null;
        pickPoint = hits[0].point.clone();
        pickRay = raycaster.ray.direction.clone();
        return !!pickWhat;
      },
      pressStart() {
        pressMoved = false;
        if (pickWhat === 'figure') {
          drag = { plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -pickPoint.y), u0: scene.u, a0: scene.uAt(pickPoint) };
          targetU = null;
        }
      },
      pressMove(raycaster) {
        // a tap with a finger always moves a little: only a turn of the pointer ray above ~0.6 degrees is a drag
        if (pickRay && raycaster.ray.direction.angleTo(pickRay) > 0.01) pressMoved = true;
        if (!drag) return;
        const p = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(drag.plane, p)) return;
        scene.setU(drag.u0 + scene.uAt(p) - drag.a0, true);
        walkingFor = 0.25;
      },
      pressEnd() {
        if (pickWhat && pickWhat !== 'figure' && !pressMoved) select(scene.selected === pickWhat ? null : pickWhat);
        pickWhat = null;
        drag = null;
      },
      releaseAll() {
        pickWhat = null;
        drag = null;
      },
      runFromQuery(what) {
        if (what === 'run') autoStart = true;
      },
      debugOn() {
        autoStart = true;
      },
      /** Camera bar play / pause. Play starts the board if it is stopped; Pause freezes the simulated cycle. */
      isRunning: () => running && !paused,
      setRunning(on) {
        if (on) {
          if (!running) start();
          else setPaused(false);
        } else setPaused(true);
      },
      inspect() {
        return {
          running, paused, u: scene.u, share: measure().share, light, scores: { ...sim.scores }, userLed: running && sim.userLed, camLed: running && sim.cameraLed,
          stage: sim.stageId, cycles: sim.cycles, prediction, revealed, quiz, selected: scene.selected, hasUi: !!ui, targetU,
          path: [scene.path.out.toArray(), scene.path.in.toArray()],
        };
      },
      debugSetU: (u) => {
        targetU = null;
        scene.setU(u, false);
      },
      debugSelect: (p) => select(p),
      /** Test helper: run the simulated time faster (software WebGL draws about one frame a second). */
      debugSpeed: (v) => (simSpeed = v),
      debugHalfU: () => halfU(),
    };
  },
};
