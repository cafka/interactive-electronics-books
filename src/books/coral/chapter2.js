import * as THREE from 'three';
import { buildPresenceScene, REST_POSE } from './presenceScene.js';
import { leftPageTexture, rightPageTexture } from '../../textures.js';
import { CORAL_CASCADE_PAGE } from './pageContent.js';
import { CORAL, visibleShare, personDetected } from './presence.js';
import { CASCADE, KEYPOINTS, EDGES, CASCADE_SOURCES, CascadeSim, M4_STAGES, M7_STAGES, drawnEdges } from './cascade.js';
import { $, $$, escapeHtml, renderCode, bindCopy, createConsole, renderSteps } from '../../ui.js';
import { PRESENTATION } from '../../presentation.js';

/*
 * Coral book, chapter 2: "Wake up the AI: Intelligent pose detection".
 * Based on the official app google-coral/coralmicro apps/multicore_model_cascade (checked against its source):
 * person detection on the Cortex-M4, then pose detection with PoseNet on the Cortex-M7 and the Edge TPU.
 *   scene  src/books/coral/presenceScene.js (shared with chapter 1: official CAD model; here with a posable figure,
 *          the white and orange LEDs, the routes to the Edge TPU and the USB port, and a copy of the host client)
 *   logic  src/books/coral/cascade.js (the cascade as the source runs it; stand-in models, stated on the page)
 *   page   src/books/coral/pageContent.js (left page)
 */

const viewButtons = [['circuit', 'Whole project'], ['stage', 'Board + person'], ['leftpage', 'Left page'], ['board', 'Board'], ['camside', 'Camera side'], ['panel', 'Host client']];
const esc = (s) => escapeHtml(String(s));
const AMBER = '#ffb347', VIOLET = '#c58cff';

/** Poses the figure can take (radians, see REST_POSE). */
const POSES = {
  rest: { label: 'Arms down', p: {} },
  up: { label: 'Both arms up', p: { raiseL: 2.75, raiseR: 2.75, bendL: 0.1, bendR: 0.1 } },
  out: { label: 'Arms out', p: { raiseL: 1.55, raiseR: 1.55 } },
  wave: { label: 'Wave', p: { raiseR: 1.45, bendR: 1.55 } },
  leftUp: { label: 'Left arm up', p: { raiseL: 2.7 } },
  wide: { label: 'Legs apart', p: { spreadL: 0.34, spreadR: 0.34, raiseL: 0.45, raiseR: 0.45 } },
  knee: { label: 'Knee up', p: { liftL: 1.35, kneeL: 1.7, raiseL: 0.5, raiseR: 0.5 } },
};
const POSE_ORDER = ['rest', 'up', 'out', 'wave', 'leftUp', 'wide', 'knee'];
const poseOf = (id) => ({ ...REST_POSE, ...POSES[id].p });

const STAGE_TEXT = {
  m4capture: 'M4: camera frame, 96 × 96 gray',
  m4infer: 'M4: person detection model',
  m4decide: 'M4: User LED = person?',
  handoff: 'Hand-over between the cores (IPC message)',
  m7capture: 'M7: camera frame, 324 × 324 colour',
  m7jpeg: 'M7: JPEG of the frame to the computer',
  tpu: 'Edge TPU: PoseNet',
  decode: 'M7: decode the poses',
  send: 'M7: poses (JSON) to the computer',
};
const PIPE = ['m4capture', 'm4infer', 'm4decide', 'handoff', 'm7capture', 'm7jpeg', 'tpu', 'decode', 'send'];

const STEPS = [
  { title: 'The Cortex-M4 watches', text: 'A small TensorFlow Lite Micro model on the Cortex-M4 checks each 96 × 96 grayscale frame: person or no person. After every frame it sets the green User LED to the answer.', view: 'board' },
  { title: 'A person: the M4 hands over', text: 'As soon as the answer is “person”, the M4 disables the camera, sends a message to the Cortex-M7 (inter-processor communication) and suspends itself.', view: 'board' },
  { title: 'The M7 captures and sends', text: 'The M7 enables the camera, takes 324 × 324 colour frames, compresses each one to JPEG and sends it to the computer.', view: 'board' },
  { title: 'The Edge TPU runs PoseNet', text: 'The M7 gives the frame to PoseNet (MobileNet v1 0.75, 324 × 324). The model runs on the Edge TPU; its decoder runs on the M7 and returns poses with 17 keypoints each.', view: 'board' },
  { title: 'The computer draws the pose', text: 'Poses scoring at least 0.4 are sent as JSON. The Python client draws the keypoints (score at least 0.2) and the lines between them on the frame.', view: 'panel' },
  { title: '5 s without a pose: back to the M4', text: 'Once a second the M7 checks when it last sent a pose. After 5 s without one it stops the camera, tells the M4 to resume, and suspends itself.', view: 'stage' },
];

const PARTS = {
  camera: { name: 'Camera · Himax HM01B0', text: 'The only camera: the M4 uses it while it searches, the M7 while it estimates poses. Each core enables it and disables it at the hand-over.' },
  mcu: { name: 'NXP i.MX RT1176 · Cortex-M4 + Cortex-M7', text: 'One chip with two cores. They take turns here: the M4 runs the person detector, the M7 runs the camera, the network and the pose model.' },
  tpu: { name: 'Coral Edge TPU · under the metal shield', text: 'Runs the PoseNet model for the M7 (the model was compiled for the Edge TPU). The person detector on the M4 does not use it.' },
  ledCam: { name: 'Camera LED · green, above the camera', text: 'Shows camera operation. The camera is disabled for a moment at each hand-over.' },
  ledTpu: { name: 'Edge TPU LED · white', text: 'The README says it turns on when the M7 starts the pose model. The app’s code never switches it (no LedSet(Led::kTpu)).' },
  ledUser: { name: 'User LED · green, near the centre', text: 'Set by the M4 after every frame: on for “person”. The M7 never changes it, so it stays on while the M7 works.' },
  ledStatus: { name: 'Status LED · orange', text: 'The M4 turns it on once its model is loaded: LedSet(Led::kStatus, true).' },
  usb: { name: 'USB-C port', text: 'Power, flashing, the serial console, and the network over USB the host client uses (10.10.10.1, port 27000).' },
};
const PART_ORDER = ['camera', 'mcu', 'tpu', 'ledCam', 'ledTpu', 'ledUser', 'ledStatus', 'usb'];

const PREDICT = { m4: 'only the Cortex-M4', m7: 'the Cortex-M7 and the Edge TPU', none: 'nothing changes' };
const QUIZ = [
  { id: 'still', text: 'Someone is still in front of the camera.', ok: false, why: 'Not necessarily. Only the M4 sets the User LED, and the M4 is suspended while the M7 works. The LED still shows its last answer.' },
  { id: 'timer', text: 'The M7 is waiting: after 5 s without a pose it hands back to the M4, which then turns the LED off.', ok: true, why: 'Right. The M7 checks once a second; after 5 s without a pose it stops, the M4 resumes, and its next “no person” switches the User LED off.' },
  { id: 'tpu', text: 'The Edge TPU switched the User LED on.', ok: false, why: 'No. The Edge TPU only runs the pose model. The User LED is set by the M4 with LedSet(Led::kUser, person_detected).' },
  { id: 'cloud', text: 'The board is streaming the room to the internet.', ok: false, why: 'No. Both models run on the board. Frames and poses go only to the computer the client runs on (over USB, or your local network with an add-on board).' },
];

/* ---------- the official code (Apache-2.0), shortened: lines unchanged, "// ..." for cuts ---------- */
const CODE_M4 = `// From google-coral/coralmicro, apps/multicore_model_cascade
// Copyright 2022 Google LLC. Licensed under the Apache License, Version 2.0.
// Shortened for the book: "// ..." marks lines left out.

// multicore_model_cascade_cm4.cc: runs on the Cortex-M4
bool DetectPerson(tflite::MicroInterpreter* interpreter) {
  auto* input_tensor = interpreter->input(0);

  // Get image and copy it into the input tensor.
  coralmicro::CameraFrameFormat fmt{CameraFormat::kY8,
                                    coralmicro::CameraFilterMethod::kBilinear,
                                    CameraRotation::k270,
                                    kNumCols,
                                    kNumRows,
                                    /*preserve_ration=*/false,
                                    tflite::GetTensorData<uint8>(input_tensor)};
  if (!coralmicro::CameraTask::GetSingleton()->GetFrame({fmt})) {
    printf("Image capture failed\\r\\n");
    vTaskSuspend(nullptr);
  }

  // Run the model on this input and make sure it succeeds.
  if (interpreter->Invoke() != kTfLiteOk) {
    printf("Invoke failed\\r\\n");
    vTaskSuspend(nullptr);
  }

  auto* output_tensor = interpreter->output(0);
  // Process the inference results.
  auto person_score =
      static_cast<int8_t>(output_tensor->data.uint8[kPersonIndex]);
  auto no_person_score =
      static_cast<int8_t>(output_tensor->data.uint8[kNotAPersonIndex]);
  printf("person_score: %d no_person_score: %d\\r\\n", person_score,
         no_person_score);
  return person_score > no_person_score;
}

[[noreturn]] void Main() {
  // ...
  std::vector<uint8_t> person_detect_model_data;
  if (!coralmicro::LfsReadFile("/models/person_detect_model.tflite",
                               &person_detect_model_data)) {
    printf("Error: Cannot load model\\r\\n");
    vTaskSuspend(nullptr);
  }
  // ...
  // Turn on Status LED to show the board is on.
  LedSet(Led::kStatus, true);
  // ...
  while (true) {
    printf("M4 Started, detecting person...\\r\\n");
    CameraTask::GetSingleton()->Enable(CameraMode::kStreaming);
    // ...
    while (true) {
      bool person_detected = DetectPerson(&interpreter);
      // Turn on user led if a person is detected, or turn it off if no person
      // detected.
      LedSet(Led::kUser, person_detected);
      // ...
      if (person_detected) {
        break;
      }
      // ...
    }
    printf("Person detected, let M7 take over.\\r\\n");
    CameraTask::GetSingleton()->Disable();
    IpcMessage msg{};
    msg.type = IpcMessageType::kApp;
    IpcM4::GetSingleton()->SendMessage(msg);
    printf("M4 stopped\\r\\n");
    vTaskSuspend(nullptr);
  }
}
`;
const CODE_M7 = `// From google-coral/coralmicro, apps/multicore_model_cascade
// Copyright 2022 Google LLC. Licensed under the Apache License, Version 2.0.
// Shortened for the book: "// ..." marks lines left out.

// multicore_model_cascade_cm7.cc: runs on the Cortex-M7
constexpr float kThreshold = 0.4;
// ...
constexpr int kNetworkPort = 27000;
// ...
constexpr char kModelPath[] =
    "/models/"
    "posenet_mobilenet_v1_075_324_324_16_quant_decoder_edgetpu.tflite";
constexpr int kModelWidth = 324;
constexpr int kModelHeight = 324;

// MainTask::Run(): the camera task
        case kCmdStart:
          configASSERT(!started);
          started = true;
          CameraTask::GetSingleton()->Enable(CameraMode::kStreaming);
          printf("M7 Main Task: started\\r\\n");
          // ...
        case kCmdProcess: {
          // ...
          coralmicro::CameraFrameFormat fmt;
          fmt.width = kModelWidth;
          fmt.height = kModelHeight;
          fmt.fmt = CameraFormat::kRgb;
          fmt.filter = CameraFilterMethod::kBilinear;
          fmt.preserve_ratio = false;
          fmt.buffer = input.data();
          CameraTask::GetSingleton()->GetFrame({fmt});

          auto jpeg_size =
              JpegCompressRgb(input.data(), fmt.width, fmt.height,
                              /*quality=*/75, jpeg.data(), jpeg.size());
          network_task_->Send(kMessageTypeImageData, jpeg.data(), jpeg_size);

          posenet_task_->Put(input);

          // Process next camera frame.
          QueueProcess();
        } break;

// PosenetTask::Run(): the pose task
      CHECK(interpreter_->Invoke() == kTfLiteOk);
      auto poses = tensorflow::GetPosenetOutput(interpreter_.get(), kThreshold);
      if (!poses.empty()) {
        CreatePoseJson(poses, kThreshold, &json);
        network_task_->Send(kMessageTypePoseData, json.data(), json.size());
      }
      if (poses.size() != num_poses_ || counter_ % kLogInterval == 0) {
          printf("Poses: %u\\r\\n", poses.size());
      }

[[noreturn]] void Main() {
  printf("Multicore Model Cascade!\\r\\n");
  // ...
  auto tpu_context =
      EdgeTpuManager::GetSingleton()->OpenDevice(PerformanceMode::kMax);
  // ...
  resolver.AddCustom(kCustomOp, RegisterCustomOp());
  resolver.AddCustom(kPosenetDecoderOp, RegisterPosenetDecoderOp());
  // ...
  IpcM7::GetSingleton()->StartM4();
  // ...
  vTaskSuspend(nullptr);
  while (true) {
    low_power = false;
    network_task.Send(kLowPowerChange, &low_power, 1);
    network_task.ResetPosenetTimer();

    // Start camera_task processing, which will start posenet_task.
    main_task.Start();

    while (true) {
      // ...
      if (network_task.PosenetInactiveForMs(5000)) {
        printf("No poses detected for 5 seconds\\r\\n");
        break;
      }
      // ...
      vTaskDelay(pdMS_TO_TICKS(1000));
    }

    low_power = true;
    network_task.Send(kLowPowerChange, &low_power, 1);

    // Stop camera_task processing. This will also stop posenet_task.
    main_task.Stop();

    IpcMessage msg{};
    msg.type = IpcMessageType::kApp;
    IpcM7::GetSingleton()->SendMessage(msg);
    vTaskSuspend(nullptr);
  }
}
`;
/* Commands, as written in the coralmicro README, the app's README and the "Get started" guide. */
const CMD = {
  clone: 'git clone --recurse-submodules -j8 https://github.com/google-coral/coralmicro',
  setup: 'cd coralmicro && bash setup.sh',
  build: 'bash build.sh',
  lsusb: 'lsusb',
  flash: 'python3 scripts/flashtool.py -a multicore_model_cascade',
  pip: 'python3 -m pip install -r apps/multicore_model_cascade/requirements.txt',
  client: 'python3 apps/multicore_model_cascade/multicore_model_cascade.py',
  serialLinux: 'ls /dev/ttyACM*',
  serialMac: 'ls /dev/cu.usbmodem*',
  screen: 'screen /dev/cu.usbmodem1301 115200',
  wifi: 'python3 scripts/flashtool.py -a multicore_model_cascade \\\n    --subapp multicore_model_cascade_wifi --wifi_config wifi.txt',
  eth: 'python3 scripts/flashtool.py -a multicore_model_cascade \\\n    --subapp multicore_model_cascade_ethernet',
  clientIp: 'python3 apps/multicore_model_cascade/multicore_model_cascade.py \\\n    --device_ip_address 192.168.86.42',
  demo: 'python3 scripts/flashtool.py --app multicore_model_cascade \\\n    --subapp multicore_model_cascade_demo',
  help: 'python3 apps/multicore_model_cascade/multicore_model_cascade.py --help',
  dialout: 'sudo usermod -aG dialout $USER',
};
const cmd = (k) => `<pre class="cmd"><code>${esc(CMD[k])}</code></pre>`;

const ICON_CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 21v-3.5a6.5 6.5 0 0 1 13 0V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_CHIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_DOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const simHtml = () => `
  <p class="note sim-note"><b>Didactic simulation.</b> The board, its two cores, the Edge TPU and the host client run in your browser. No board, webcam or online service is used. Both models are stand-ins, not neural networks: the person detector is the one from chapter 1, and a keypoint counts as found when its point on the figure is inside the camera’s frame. No confidence, speed or latency is computed or shown.</p>

  <div class="led-pair quad" role="group" aria-label="The four LEDs of the board">
    <div class="led-chip" id="chipStatus"><i class="led-ico">${ICON_DOT}</i><div><span>Status LED · orange</span><b>–</b><small></small></div></div>
    <div class="led-chip" id="chipUser"><i class="led-ico">${ICON_PERSON}</i><div><span>User LED · green</span><b>–</b><small></small></div></div>
    <div class="led-chip white" id="chipTpu"><i class="led-ico">${ICON_CHIP}</i><div><span>Edge TPU LED · white</span><b>–</b><small></small></div></div>
    <div class="led-chip" id="chipCam"><i class="led-ico">${ICON_CAM}</i><div><span>Camera LED · green</span><b>–</b><small></small></div></div>
  </div>
  <div class="cores" role="group" aria-label="What each processor is doing">
    <div class="core" id="coreM4"><b>Cortex-M4</b><span></span></div>
    <div class="core" id="coreM7"><b>Cortex-M7</b><span></span></div>
    <div class="core" id="coreTpu"><b>Edge TPU</b><span></span></div>
  </div>
  <div class="pose-timer" id="poseTimer" hidden><span>Time since the last pose:</span><div class="bar"><i id="timerBar"></i></div><b id="timerVal"></b></div>
  <p class="prog-state" id="progState"></p>

  <ol class="cp-steps">
    <li class="cp-step" id="cpPredict">
      <h3><i>1</i> Predict</h3>
      <p>Nobody is in front of the camera. <b>Someone walks in and stays. Which part starts working?</b></p>
      <div class="btn-row three choice" id="predict" role="group" aria-label="Your prediction">
        <button class="btn" data-p="m4">Only the Cortex-M4</button>
        <button class="btn" data-p="m7">The M7 and the Edge TPU</button>
        <button class="btn" data-p="none">Nothing changes</button>
      </div>
      <p class="note" id="predictOut">Choose one. Then try it in step 2.</p>
      <div class="reveal" id="reveal" hidden></div>
      <button class="chip-btn" id="btnReveal" hidden>I tried it: show the explanation</button>
    </li>

    <li class="cp-step" id="cpExperiment">
      <h3><i>2</i> Experiment</h3>
      <p>Drag the person in the 3D scene (mouse or finger), or use the buttons. Then change the pose.</p>
      <div class="btn-row">
        <button id="btnIn" class="btn accent">Step into frame</button>
        <button id="btnOut" class="btn">Step out of frame</button>
      </div>
      <div class="slider-ctl">
        <label for="posRange">Where the person is: <b id="posVal"></b></label>
        <input type="range" id="posRange" min="0" max="100" step="1" value="0" aria-describedby="posHint">
        <p class="note" id="posHint">0 = outside the frame, 100 = in the middle of the frame.</p>
      </div>
      <div class="pose-btns" id="poseBtns" role="group" aria-label="Pose of the person">${POSE_ORDER.map((k) => `<button class="chip-btn" data-pose="${k}" aria-pressed="false">${esc(POSES[k].label)}</button>`).join('')}</div>
      <label class="check-row"><input type="checkbox" id="optCycle"> Keep changing pose</label>
      <div class="cp-view two">
        <figure class="px96-wrap">
          <canvas id="in96" width="${CASCADE.m4.input.w}" height="${CASCADE.m4.input.h}" class="px96" role="img" aria-label="The 96 by 96 grayscale frame the Cortex-M4 model receives"></canvas>
          <figcaption id="cap96">What the M4 gets: 96 × 96 gray</figcaption>
        </figure>
        <figure class="client-wrap">
          <canvas id="clientMini" width="216" height="216" class="client-mini" role="img" aria-label="The keypoints the host client draws"></canvas>
          <figcaption id="capClient">What the computer draws</figcaption>
        </figure>
      </div>
      <p class="note" id="kpInfo" aria-live="polite"></p>
    </li>

    <li class="cp-step" id="cpUnderstand">
      <h3><i>3</i> Understand</h3>
      <p>Tap a part of the board in the 3D scene, or here:</p>
      <div class="part-btns" id="partBtns">${PART_ORDER.map((k) => `<button class="chip-btn" data-part="${k}" aria-pressed="false">${esc(PARTS[k].name.split(' · ')[0])}</button>`).join('')}</div>
      <p class="part-info" id="partInfo" aria-live="polite">Nothing selected yet.</p>
      <ol class="pipe wide" id="pipe" aria-label="The cascade, step by step">
        ${PIPE.map((id, i) => `<li data-stage="${id}" class="${id.startsWith('m4') ? 'm4' : id === 'handoff' ? 'ipc' : 'm7'}"><b>${i + 1}</b><span>${esc(STAGE_TEXT[id])}</span></li>`).join('')}
      </ol>
      <p class="note">On the board the M7 runs these steps in two tasks at once: the camera task takes the next frame while the pose task works on the previous one, and a frame is handed to PoseNet only when it is free. The page shows them one after the other.</p>
    </li>

    <li class="cp-step" id="cpCheck">
      <h3><i>4</i> Check</h3>
      <p><b>The person left the frame a few seconds ago. The User LED is still on. What is true?</b></p>
      <div class="quiz" id="quiz" role="group" aria-label="Choose an answer">
        ${QUIZ.map((q) => `<button class="btn quiz-opt" data-q="${q.id}">${esc(q.text)}</button>`).join('')}
      </div>
      <p class="quiz-out" id="quizOut" aria-live="polite"></p>
      <div id="realWorld" hidden>
        <p>Try it: step in, wait for the pose, then step out and watch the timer, the User LED and the cores.</p>
        <div class="btn-row">
          <button id="btnLeave" class="btn">Step out now</button>
          <button id="btnDim" class="btn" aria-pressed="false">Dim the room</button>
        </div>
        <p class="note" id="realOut"></p>
        <p class="bridge">In chapter 1 the factory demo ran one person detector on the Cortex-M7 and the User LED was the whole answer. Here a detector of the same kind runs on the Cortex-M4, and its “person” wakes the M7 and the Edge TPU for a bigger model. <a href="?book=coral&amp;open=1&amp;lesson=1">Open chapter 1</a></p>
      </div>
    </li>
  </ol>

  <h3>Serial console (simulated)</h3>
  <div class="console" id="console" aria-live="off"></div>
  <div class="options">
    <label><input type="checkbox" id="optFov" checked> Field of view</label>
    <label><input type="checkbox" id="optRoute" checked> Path of each frame</label>
    <label><input type="checkbox" id="optSkel" checked> Keypoints on the person</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = () => `
  <h3 class="code-title">C++ · coralmicro (FreeRTOS), two programs</h3>
  <p class="code-sub">The official app <code>${CASCADE.repoPath}</code> has one program per core. The lines highlight as the simulated cascade runs.</p>
  <div class="code-head"><span>multicore_model_cascade_cm4.cc · Cortex-M4 (shortened)</span><span class="code-actions"><button id="copyM4" class="chip-btn">Copy</button></span></div>
  <pre class="code" id="codeM4" tabindex="0"></pre>
  <div class="code-head"><span>multicore_model_cascade_cm7.cc · Cortex-M7 (shortened)</span><span class="code-actions"><button id="copyM7" class="chip-btn">Copy</button></span></div>
  <pre class="code" id="codeM7" tabindex="0"></pre>
  <h3>What the code does</h3>
  <ul class="explain-list">
    <li><b>Cortex-M4.</b> <code>DetectPerson()</code> takes a ${CASCADE.m4.input.w} × ${CASCADE.m4.input.h} grayscale frame (<code>kY8</code>, rotated 270° so it is upright with the USB port down), runs <code>person_detect_model.tflite</code> with TensorFlow Lite for Microcontrollers and compares the two scores. <code>LedSet(Led::kUser, person_detected)</code> shows the answer. On “person” the loop breaks: the camera is disabled, an IPC message wakes the M7, and the M4 suspends itself.</li>
    <li><b>Cortex-M7, at start.</b> It opens the Edge TPU (<code>PerformanceMode::kMax</code>), loads the PoseNet model, registers two custom operators (the Edge TPU operator and the PoseNet decoder), starts the M4 with <code>StartM4()</code> and suspends itself until the M4 wakes it.</li>
    <li><b>Cortex-M7, camera task.</b> For each frame: <code>GetFrame</code> at ${CASCADE.m7.input.w} × ${CASCADE.m7.input.h} RGB, <code>JpegCompressRgb</code> (quality ${CASCADE.m7.jpegQuality}), send the JPEG, and give the frame to the pose task with <code>Put()</code> (only if that task is free).</li>
    <li><b>Cortex-M7, pose task.</b> <code>Invoke()</code> runs PoseNet on the Edge TPU, <code>GetPosenetOutput(…, kThreshold)</code> keeps the poses scoring at least ${CASCADE.m7.poseThreshold}, and if there is one or more they are sent as JSON: an overall score and 17 keypoints, each <code>[score, x, y]</code>. The console prints <code>Poses: N</code> when the number changes or every ${CASCADE.m7.logInterval} inferences.</li>
    <li><b>Cortex-M7, main loop.</b> Once a second it asks <code>PosenetInactiveForMs(5000)</code>. When no pose was sent for 5 s it tells the client “low power”, stops the camera task and sends an IPC message so the M4 resumes.</li>
    <li><b>The computer.</b> <code>multicore_model_cascade.py</code> connects to port ${CASCADE.m7.port}, shows each JPEG, and draws the keypoints with a score of at least ${CASCADE.client.keypointThreshold} and the 19 lines between them. While the board is in “low power” it shows “${CASCADE.client.waitingText}”.</li>
  </ul>
  <table class="wiring">
    <tr><th>Core</th><th>Model and data</th><th>Output</th></tr>
    <tr><td>Cortex-M4 (400 MHz)</td><td><code>person_detect_model.tflite</code>, TFLM, input 96 × 96 × 1 (gray), tensor arena ${CASCADE.m4.tensorArenaKb} kB</td><td>person / no person; User LED; IPC to the M7</td></tr>
    <tr><td>Cortex-M7 (800 MHz) + Edge TPU</td><td><code>posenet_mobilenet_v1_075_324_324_16_quant_decoder_edgetpu.tflite</code>, input 324 × 324 × 3 (RGB), tensor arena ${CASCADE.m7.tensorArenaMb} MB</td><td>JPEG frames and pose JSON on port ${CASCADE.m7.port}; IPC to the M4</td></tr>
  </table>
  <p class="note">The white Edge TPU LED: the app’s README says it turns on when the M7 starts the pose model, and the guide says this LED indicates Edge TPU operation. The app’s code does not switch it (there is no <code>LedSet(Led::kTpu)</code>), and the M7 opens the Edge TPU once at start. The page lights it while PoseNet runs, as the README describes; how it behaves while the M4 searches was not checked on a board.</p>

  <h3>Materials</h3>
  <ul class="explain-list">
    <li>Coral Dev Board Micro. Its on-board camera is the one the app uses; nothing else needs to be connected.</li>
    <li>USB-C cable between the board and the computer (power, flashing, serial console and the USB network the client uses).</li>
    <li>A computer with Python 3. The guide lists Linux or macOS for building; the app’s README says the USB variant works with Linux and Windows only, and the guide shows the image stream over USB on Linux.</li>
    <li>If the computer cannot supply enough power over USB (the board needs 5 V at 2 A; the Edge TPU draws current peaks), a powered USB hub.</li>
    <li>Optional: the Coral Wireless Add-on or PoE Add-on, for the Wi-Fi or Ethernet variant.</li>
  </ul>

  <h3>Environment and dependencies</h3>
  <ul class="explain-list">
    <li>The <code>coralmicro</code> source with all its submodules, and the tools its <code>setup.sh</code> installs (such as CMake).</li>
    <li>For the host client: Python 3 and the package in <code>requirements.txt</code>: <code>${esc(CASCADE.client.requirements)}</code>. The client also uses Python’s <code>tkinter</code> for its window.</li>
    <li>For the serial console: a terminal program such as <code>screen</code>, at 115200 baud.</li>
  </ul>

  <h3>Get the code</h3>
  ${cmd('clone')}
  <p>This can take a few minutes. Then install the tools:</p>
  ${cmd('setup')}

  <h3>Build the app</h3>
  <p>From the <code>coralmicro</code> folder, this builds every project (the app included) into <code>build</code>:</p>
  ${cmd('build')}

  <h3>Flash the app (install the firmware)</h3>
  <p>Plug in the board and check that it is detected (it should show as <i>Google Inc. Coral Dev Board Micro</i>):</p>
  ${cmd('lsusb')}
  <p>Flash the USB variant. The flashtool copies the program and the two models to the board, then the board restarts:</p>
  ${cmd('flash')}
  <p class="note">The app’s README writes the same command with <code>--app</code>; <code>-a</code> is the short form for projects in <code>coralmicro/apps/</code>.</p>

  <h3>Run it and see the results</h3>
  <ol class="steps-list">
    <li>Leave the board lying down so the camera cannot see you.</li>
    <li>Install the client’s package, then start the client:</li>
  </ol>
  ${cmd('pip')}
  ${cmd('client')}
  <ol class="steps-list" start="3">
    <li>A window opens. It stays black until the board detects a person and starts the pose model.</li>
    <li>Hold the board facing you, USB port down. When the M4 detects you the green User LED turns on, and the window shows the camera frames with your pose drawn on them.</li>
    <li>Keys in the window: <kbd>f</kbd> full screen, <kbd>x</kbd> and <kbd>y</kbd> mirror the image, <kbd>q</kbd> quit. More options: <code>--help</code>.</li>
  </ol>
  <p>On any system you can also read the serial console. Find the device, then connect at 115200 baud (example from the guide):</p>
  ${cmd('serialLinux')}
  ${cmd('serialMac')}
  ${cmd('screen')}
  <p>The guide shows this sequence when the person detector recognises you (the <code>Poses</code> lines are printed at a reduced rate):</p>
  <pre class="cmd"><code>person_score: 67 no_person_score: -67
Person detected, let M7 take over.
M4 stopped
M7 Main Task: started
Poses: 1
Poses: 1</code></pre>

  <h3>Other builds of the same app</h3>
  <ul class="explain-list">
    <li>Wi-Fi (Coral Wireless Add-on) or Ethernet (Coral PoE Add-on): the frames and poses go over your local network. Start the client with the board’s IP address, which is printed on the serial console.</li>
  </ul>
  ${cmd('wifi')}
  ${cmd('eth')}
  ${cmd('clientIp')}
  <ul class="explain-list">
    <li>Demo builds (<code>multicore_model_cascade_demo</code> and its Wi-Fi and Ethernet versions): timers switch between the cores instead of the results. In the source the M4 timer is ${CASCADE.demo.m4TimerMs / 1000} s (its comment says 5 s) and the M7 runs ${CASCADE.demo.m7Iterations} one-second iterations. This page simulates the normal build.</li>
  </ul>
  ${cmd('demo')}

  <h3>Troubleshooting</h3>
  <ul class="explain-list">
    <li><b>The client window stays black:</b> the pose model has not started. The board shows frames only after the M4 detects a person: light your face well and hold the board up, USB port down. Check the serial console for <code>person_score</code> lines.</li>
    <li><b>The window says “${CASCADE.client.waitingText}”:</b> the M7 found no pose for 5 s and handed back to the M4. Step in front of the camera again.</li>
    <li><b>Flashing fails, or the board does not respond:</b> start Serial Downloader mode. Hold the User button while you press Reset (or while you plug in the USB cable), release it when the orange LED turns on, then flash again.</li>
    <li><b><code>STATE_CHECK_FOR_SDP</code>, “Unable to find device in SDP mode”:</b> a serial console may be holding the board’s USB serial port. Close it, or enter Serial Downloader mode by hand as above.</li>
    <li><b>“No device found” on Linux:</b> your user may not be in the group that owns <code>/dev/ttyACM0</code> (often <code>dialout</code>). Add it and reboot:</li>
  </ul>
  ${cmd('dialout')}
  <ul class="explain-list">
    <li><b>The board resets or stops during inference:</b> the Edge TPU draws current peaks; connect the board through a powered USB hub.</li>
    <li><b>Wi-Fi or Ethernet variant, Status and User LEDs both on and nothing happens:</b> in the source this is what the M7 does when the network fails to start or connect: both LEDs on, then it stops.</li>
    <li><b>Messages on the serial console:</b> <code>ERROR: Failed to read model</code> or <code>Error: Cannot load model</code> means a model file is missing on the board (flash again with the data); <code>Failed to get tpu context.</code> means the Edge TPU did not start.</li>
  </ul>
  <p class="note">The commands and messages come from the coralmicro README, the app’s README and source, and the guide “Get started with the Dev Board Micro”. This page did not run on a real board.</p>`;

const howHtml = () => `
  <p>Click a step to move the camera. The highlighted step follows the simulated cascade.</p>
  <ol class="steps" id="steps"></ol>
  <h3>Checked facts</h3>
  <table class="wiring">
    <tr><th>Item</th><th>What the source and the documentation say</th></tr>
    <tr><td>App</td><td><code>${CASCADE.repoPath}</code> in google-coral/coralmicro (an app, not one of the <code>examples/</code>)</td></tr>
    <tr><td>MCU</td><td>${esc(CORAL.mcu)}: ${esc(CORAL.cores.m7)} and ${esc(CORAL.cores.m4)}</td></tr>
    <tr><td>M4 model</td><td><code>person_detect_model.tflite</code>, TensorFlow Lite for Microcontrollers on the M4, 96 × 96 grayscale input</td></tr>
    <tr><td>M7 model</td><td>PoseNet, MobileNet v1 0.75, 324 × 324, compiled for the Edge TPU, with a decoder operator; 17 keypoints per pose</td></tr>
    <tr><td>Thresholds</td><td>poses sent from a score of ${CASCADE.m7.poseThreshold} (board); keypoints drawn from ${CASCADE.client.keypointThreshold} (client)</td></tr>
    <tr><td>Back to the M4</td><td>after ${CASCADE.m7.inactiveMs / 1000} s without a pose, checked every ${CASCADE.m7.checkMs / 1000} s</td></tr>
    <tr><td>To the computer</td><td>JPEG frames (quality ${CASCADE.m7.jpegQuality}) and pose JSON, TCP port ${CASCADE.m7.port}; over USB the client connects to ${CASCADE.client.defaultHost}</td></tr>
    <tr><td>LEDs</td><td>${esc(CASCADE.leds.status)} ${esc(CASCADE.leds.user)} ${esc(CASCADE.leds.tpu)}</td></tr>
  </table>
  <h3>The 17 keypoints and how the client joins them</h3>
  <p class="kp-names">${KEYPOINTS.map((k, i) => `<span><b>${i}</b> ${esc(k.toLowerCase().replace('_', ' '))}</span>`).join('')}</p>
  <p class="note">The client draws ${EDGES.length} lines: face (nose, eyes, ears), shoulders, arms, sides of the body, hips and legs. “Left” and “right” are the person’s own sides, so on an image that is not mirrored the person’s left side appears on the right.</p>
  <h3>What is real and what is simulated here</h3>
  <ul class="explain-list">
    <li><b>Real:</b> the order of the steps, which core does what, the LED rules, the 5 s and 1 s timers, the console messages, the 17 keypoints and the 19 lines, from the app’s source.</li>
    <li><b>Real:</b> the board’s shape and the positions of the camera, the LEDs, the Edge TPU shield and the i.MX RT1176, from Google’s official CAD model, as in chapter 1.</li>
    <li><b>Real geometry:</b> the frames and the keypoints use the camera’s position and its ${CORAL.camera.diagonalFovDeg}° diagonal field of view.</li>
    <li><b>Simulated:</b> both models. The person detector is the stand-in of chapter 1. A keypoint counts as found when its point on the figure is inside the frame, and a pose is reported when the nose and both shoulders are in the frame and the room is lit. A real PoseNet looks at pixels, gives each keypoint a score, can miss a hidden arm or place a point wrongly; this stand-in does none of that.</li>
    <li><b>Not shown:</b> scores of the poses and keypoints, frame rates and latencies. The page would have to invent them.</li>
    <li><b>Simulated:</b> the timing of each step, slowed down so you can follow it. The two M7 tasks run one after the other here, in parallel on the board.</li>
    <li><b>Illustrations:</b> the stand, the cable, the figure (not to scale) and the board’s colours.</li>
  </ul>
  <h3>From chapter 1 to chapter 2</h3>
  <p>Chapter 1: one model, on the Cortex-M7, decides one LED. Chapter 2: the same kind of small model runs on the Cortex-M4 as a gate. Only when it says “person” does the board start the camera stream, the Cortex-M7 and the Edge TPU for a model that does much more. When nobody has been seen for 5 s, the big part stops again.</p>
  <h3>Sources</h3>
  <ul class="explain-list">${CASCADE_SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul>`;

export default {
  id: 'coral-cascade',
  number: 2,
  title: 'Wake up the AI: Intelligent pose detection',
  chapter: 'Two cores, two models',
  codeTab: 'C++',
  defaultView: 'stage',
  viewButtons,
  views: {
    circuit: { t: [0, 0.6, 0.4], r: 27, phi: 0.74, theta: 0, fit: 'book' },
    stage: { t: [6.6, 2.4, -1.4], r: 19.5, phi: 0.9, theta: 0.12 },
    board: { t: [8.85, 4.5, -3.85], r: 10.5, phi: 1.22, theta: -0.96 },
    camside: { t: [5.0, 3.0, -1.2], r: 10.5, phi: 1.12, theta: 2.18 },
    panel: { t: [9.0, 2.7, 3.7], r: 8.5, phi: 0.98, theta: -0.3 },
  },
  pageContent: CORAL_CASCADE_PAGE,
  textures: () => ({
    left: leftPageTexture(CORAL_CASCADE_PAGE),
    right: rightPageTexture({
      fig: 'FIG. 2', caption: 'Cortex-M4 finds a person → Cortex-M7 + Edge TPU find the pose → computer', page: 4,
      hint: 'Drag the person into the camera’s view, then change the pose in the notebook.',
    }),
  }),

  async create(env) {
    const scene = await buildPresenceScene({ posable: true, panel: 'client', cascade: true });

    /* ---------- state ---------- */
    let light = 1;
    const pin = scene.pinhole;
    const measure = () => ({
      share: visibleShare(pin, scene.figureWorld),
      light,
      keypoints: scene.keypointsWorld().map((p) => pin.project(p)),
    });
    const sim = new CascadeSim(measure);
    let running = false, paused = false, autoStart = false, popT = 0;
    let targetU = null, walkingFor = 0, simSpeed = 1;
    let ui = null;
    let pickWhat = null, pickPoint = null, pickRay = null, drag = null, pressMoved = false;
    let prediction = null, revealed = false, sawM7 = false, quiz = null;
    let poseId = 'rest', cycling = false, cycleT = 0;
    let logSeen = 0, eventsSeen = 0;
    // the copy of the host client window
    const client = { mode: 'black', points: null, lastPoseAt: -1e9, lowPowerSince: null, frames: 0 };
    const log = (t, c) => ui && ui.log(t, c);

    function setPose(id) {
      poseId = id;
      scene.setPose(poseOf(id));
      ui?.showPose();
    }
    function start() {
      running = true;
      paused = false;
      sim.reset();
      logSeen = 0;
      eventsSeen = 0;
      Object.assign(client, { mode: 'black', points: null, lastPoseAt: -1e9, lowPowerSince: null, frames: 0 });
      scene.resetClient();
      log('# Board powered over USB. The flashed app starts on both cores.', 'c');
      ui?.refresh();
    }
    function setPaused(on) {
      if (!running || paused === on) return;
      paused = on;
      log(on ? '# Paused: the simulated cascade is frozen.' : '# Playing again.', 'c');
    }
    const moveTo = (u) => (targetU = Math.min(1, Math.max(0, u)));
    function select(part) {
      scene.selectPart(part);
      ui?.showPart(part);
    }
    /** Keypoints of the last frame the client received, in pixels of the 324 x 324 image (null = not drawn). */
    function clientPoints(frame, found) {
      return frame.keypoints.map((q, i) => (found[i] ? [((q.x + 1) / 2) * CASCADE.m7.input.w, ((1 - q.y) / 2) * CASCADE.m7.input.h] : null));
    }

    /* ---------- labels ---------- */
    const A = scene.anchors;
    const coreText = () => (sim.core === 'm7' ? 'M7 + Edge TPU' : sim.core === 'm4' ? 'M4' : 'hand-over');
    const labels = [
      { id: 'ledUser', cls: 'compact', title: 'User LED', sub: () => `<span class="val">${running && sim.userLed ? 'ON · last M4 answer: person' : 'OFF'}</span>`, at: A.ledUser, side: 'right' },
      { id: 'ledTpu', cls: 'compact', title: 'Edge TPU LED', sub: () => `<span class="val">${running && sim.tpuActive ? 'ON · PoseNet running' : 'off'}</span>`, at: A.ledTpu, side: 'right' },
      { id: 'figure', cls: 'compact', title: 'Person', sub: () => `<span class="val">${esc(POSES[poseId].label.toLowerCase())}</span> · drag`, at: A.figure, side: 'right' },
      { id: 'panel', cls: 'compact', title: 'Host client window', sub: 'simulated · what the computer shows', at: A.panel, side: 'right' },
      { id: 'mcu', cls: 'compact', title: 'i.MX RT1176 · M4 + M7', sub: () => `now: ${coreText()}`, at: A.mcu, side: 'left' },
      { id: 'tpu', cls: 'compact', title: 'Edge TPU', sub: 'runs PoseNet for the M7', at: A.tpu, side: 'left' },
      { id: 'ledCam', cls: 'compact', title: 'Camera LED', sub: () => `<span class="val">${running && sim.cameraOn ? 'ON' : 'off'}</span>`, at: A.ledCam, side: 'right', hideNarrow: true },
      { id: 'ledStatus', cls: 'compact', title: 'Status LED', sub: () => `<span class="val">${running && sim.statusLed ? 'ON' : 'off'}</span>`, at: A.ledStatus, side: 'left', hideNarrow: true },
      { id: 'camera', cls: 'compact', title: 'Camera · HM01B0', sub: 'shared by both cores', at: A.camera, side: 'left', hideNarrow: true },
      { id: 'usb', cls: 'compact', title: 'USB-C', sub: 'frames and poses to the computer', at: A.usb, side: 'left', hideNarrow: true },
    ];

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      autoStart = autoStart || !running;
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml();
      tabs.how.innerHTML = howHtml();
      const c4 = renderCode($('#codeM4', tabs.code), CODE_M4, 'cpp');
      const c7 = renderCode($('#codeM7', tabs.code), CODE_M7, 'cpp');
      bindCopy($('#copyM4', tabs.code), () => CODE_M4, $('#codeM4', tabs.code));
      bindCopy($('#copyM7', tabs.code), () => CODE_M7, $('#codeM7', tabs.code));
      const L4 = {
        get: c4.find(/GetFrame\(\{fmt\}\)\)/), invoke: c4.find(/interpreter->Invoke\(\)/), ret: c4.find(/return person_score > no_person_score/),
        led: c4.find(/LedSet\(Led::kUser, person_detected\)/), hand: c4.find(/Person detected, let M7 take over/), disable: c4.find(/->Disable\(\)/),
        ipc: c4.find(/IpcM4::GetSingleton\(\)->SendMessage/), resume: c4.find(/M4 Started, detecting person/),
      };
      const L7 = {
        start: c7.find(/main_task\.Start\(\)/), started: c7.find(/M7 Main Task: started/), get: c7.find(/GetFrame\(\{fmt\}\);/),
        jpeg: c7.find(/JpegCompressRgb\(/), sendImg: c7.find(/Send\(kMessageTypeImageData/), put: c7.find(/posenet_task_->Put/),
        invoke: c7.find(/interpreter_->Invoke\(\)/), decode: c7.find(/GetPosenetOutput\(/), sendPose: c7.find(/Send\(kMessageTypePoseData/),
        inactive: c7.find(/PosenetInactiveForMs\(5000\)/), stop: c7.find(/main_task\.Stop\(\)/), ipc: c7.find(/IpcM7::GetSingleton\(\)->SendMessage/),
      };
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim), 10);
      ui = { c4, c7, L4, L7, log: consoleLog, steps };
      const q = (s) => $(s, tabs.sim);
      const chips = { status: q('#chipStatus'), user: q('#chipUser'), tpu: q('#chipTpu'), cam: q('#chipCam') };
      const cores = { m4: q('#coreM4'), m7: q('#coreM7'), tpu: q('#coreTpu') };
      const timerEl = q('#poseTimer'), timerBar = q('#timerBar'), timerVal = q('#timerVal'), progEl = q('#progState');
      const predictBtns = $$('#predict button', tabs.sim), predictOut = q('#predictOut'), reveal = q('#reveal'), btnReveal = q('#btnReveal');
      const btnIn = q('#btnIn'), btnOut = q('#btnOut'), posRange = q('#posRange'), posVal = q('#posVal');
      const poseBtns = $$('#poseBtns button', tabs.sim), optCycle = q('#optCycle');
      const c96 = q('#in96'), ctx96 = c96.getContext('2d'), img96 = ctx96.createImageData(CASCADE.m4.input.w, CASCADE.m4.input.h), cap96 = q('#cap96');
      const cMini = q('#clientMini'), ctxMini = cMini.getContext('2d'), capClient = q('#capClient'), kpInfo = q('#kpInfo');
      const partBtns = $$('#partBtns button', tabs.sim), partInfo = q('#partInfo'), pipeItems = $$('#pipe li', tabs.sim);
      const quizBtns = $$('#quiz button', tabs.sim), quizOut = q('#quizOut'), realWorld = q('#realWorld'), realOut = q('#realOut');
      const btnLeave = q('#btnLeave'), btnDim = q('#btnDim');
      const optFov = q('#optFov'), optRoute = q('#optRoute'), optSkel = q('#optSkel'), optLabels = q('#optLabels');

      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      for (const [box, key] of [[optFov, 'showFov'], [optRoute, 'showRoute'], [optSkel, 'showSkel']]) {
        box.checked = ui[key] ?? true;
        ui[key] = box.checked;
        box.addEventListener('change', () => (ui[key] = box.checked));
      }
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Simulated serial console (115200 baud on a real board).', 'c');

      const renderPrediction = () => {
        predictBtns.forEach((b) => {
          b.classList.toggle('chosen', b.dataset.p === prediction);
          b.setAttribute('aria-pressed', String(b.dataset.p === prediction));
        });
        if (prediction && !revealed) predictOut.textContent = `Your prediction: ${PREDICT[prediction]}. Now bring the person in, in step 2.`;
      };
      predictBtns.forEach((b) => b.addEventListener('click', () => {
        if (revealed) return;
        prediction = b.dataset.p;
        renderPrediction();
      }));
      const doReveal = () => {
        revealed = true;
        const right = prediction === 'm7';
        reveal.hidden = false;
        btnReveal.hidden = true;
        reveal.innerHTML = `${prediction ? `<p class="${right ? 'good' : 'bad'}"><b>${right ? 'Your prediction was right.' : `You predicted ${esc(PREDICT[prediction])}.`}</b></p>` : ''}
          <p>The <b>Cortex-M4</b> was working before anyone came: it searches all the time. When it saw a person it stopped and woke the <b>Cortex-M7</b>, which started the camera stream and ran PoseNet on the <b>Edge TPU</b>.</p>
          <p>The two cores take turns: the small model is the gate, the big one runs only when it is needed.</p>`;
        predictBtns.forEach((b) => (b.disabled = true));
        predictOut.textContent = '';
      };
      btnReveal.addEventListener('click', doReveal);
      ui.maybeReveal = () => {
        if (!revealed && sawM7) btnReveal.hidden = false;
      };
      renderPrediction();
      if (revealed) doReveal();

      btnIn.addEventListener('click', () => moveTo(1));
      btnOut.addEventListener('click', () => moveTo(0));
      btnLeave.addEventListener('click', () => moveTo(0));
      posRange.addEventListener('input', () => {
        targetU = null;
        scene.setU(Number(posRange.value) / 100, true);
        walkingFor = 0.25;
      });
      ui.showPose = () => poseBtns.forEach((b) => {
        b.classList.toggle('active', b.dataset.pose === poseId);
        b.setAttribute('aria-pressed', String(b.dataset.pose === poseId));
      });
      poseBtns.forEach((b) => b.addEventListener('click', () => {
        cycling = false;
        optCycle.checked = false;
        setPose(b.dataset.pose);
      }));
      optCycle.checked = cycling;
      optCycle.addEventListener('change', () => {
        cycling = optCycle.checked;
        cycleT = 0;
      });
      ui.showPose();

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
      const syncDim = () => {
        btnDim.setAttribute('aria-pressed', String(light < 1));
        btnDim.textContent = light < 1 ? 'Light the room again' : 'Dim the room';
      };
      btnDim.addEventListener('click', () => {
        light = light < 1 ? 1 : 0.12;
        scene.setLight(light);
        syncDim();
        log(light < 1 ? '# Room light dimmed (the camera image gets dark).' : '# Room light back to normal.', 'c');
      });
      syncDim();

      ui.refresh = () => {};
      let lastPix = 0;
      const setText = (el, t) => el.textContent !== t && (el.textContent = t);
      const chip = (el, on, small) => {
        el.classList.toggle('on', on);
        setText($('b', el), on ? 'ON' : 'OFF');
        setText($('small', el), small);
      };
      ui.frame = (now) => {
        const on = running;
        chip(chips.status, on && sim.statusLed, on && sim.statusLed ? 'M4 model loaded' : 'board off');
        chip(chips.user, on && sim.userLed, !on ? '' : sim.userLed ? (sim.core === 'm4' ? 'M4 says: person' : 'last M4 answer (M4 suspended)') : 'M4 says: no person');
        chip(chips.tpu, on && sim.tpuActive, on && sim.tpuActive ? 'PoseNet running (README)' : 'pose model not running');
        chip(chips.cam, on && sim.cameraOn, !on ? '' : sim.cameraOn ? (sim.core === 'm7' ? 'used by the M7' : 'used by the M4') : 'disabled for the hand-over');
        const st = sim.stageId;
        const states = {
          m4: sim.core === 'm4' ? 'searching for a person' : sim.core === 'toM7' ? 'handing over' : sim.core === 'toM4' ? 'resuming' : 'suspended',
          m7: sim.core === 'm7' ? 'camera stream + PoseNet' : sim.core === 'toM7' ? 'waking up' : sim.core === 'toM4' ? 'stopping' : 'suspended',
          tpu: sim.core === 'm7' ? (st === 'tpu' ? 'running PoseNet' : 'waiting for a frame') : 'idle',
        };
        for (const [k, el] of Object.entries(cores)) {
          el.classList.toggle('on', on && (k === 'm4' ? sim.core === 'm4' : sim.core === 'm7' && (k === 'm7' || st === 'tpu')));
          setText($('span', el), on ? states[k] : '–');
        }
        timerEl.hidden = !(on && sim.core === 'm7');
        if (!timerEl.hidden) {
          const w = Math.min(sim.msWithoutPose, CASCADE.m7.inactiveMs);
          timerBar.style.width = `${(w / CASCADE.m7.inactiveMs) * 100}%`;
          timerBar.classList.toggle('late', sim.msWithoutPose > 2500);
          setText(timerVal, `${(w / 1000).toFixed(1)} s of 5 s`);
        }
        setText(progEl, !on ? 'Board: starting…' : paused ? 'Board: PAUSED (Play in the top bar continues)' : `Board: running · ${STAGE_TEXT[st]}`);
        progEl.classList.toggle('on', on && !paused);
        const pct = Math.round(scene.u * 100);
        if (document.activeElement !== posRange && Number(posRange.value) !== pct) posRange.value = String(pct);
        setText(posVal, pct === 0 ? 'outside the frame' : pct === 100 ? 'middle of the frame' : `${pct} of 100`);
        pipeItems.forEach((li) => li.classList.toggle('active', on && li.dataset.stage === st));
        // keypoints: which ones the stand-in found in the last frame the client received
        const f = sim.pose.found, n = f.filter(Boolean).length;
        setText(kpInfo, !on || sim.core !== 'm7' ? 'Keypoints: the pose model runs only while the M7 is awake.'
          : sim.pose.reported ? `Pose sent: ${n} of 17 keypoints found${n < 17 ? `; not in the frame: ${KEYPOINTS.filter((_, i) => !f[i]).map((k) => k.toLowerCase().replace('_', ' ')).join(', ')}` : ''}.`
            : 'No pose in this frame: nothing is sent, and the 5 s timer keeps running.');
        // the copy of the client window, small: the keypoints and lines only (the frame itself is on the 3D panel)
        ctxMini.fillStyle = '#000';
        ctxMini.fillRect(0, 0, 216, 216);
        const sc = 216 / CASCADE.m7.input.w;
        if (client.mode === 'waiting') {
          ctxMini.fillStyle = '#fff';
          ctxMini.font = '700 12px "Segoe UI", system-ui, sans-serif';
          ctxMini.textAlign = 'center';
          ctxMini.fillText(CASCADE.client.waitingText, 108, 112);
        } else if (client.mode === 'image') {
          ctxMini.fillStyle = '#1b2133';
          ctxMini.fillRect(0, 0, 216, 216);
          const P = client.points;
          if (P) {
            ctxMini.strokeStyle = '#ffff00';
            ctxMini.lineWidth = 2;
            for (const [a, b] of EDGES) if (P[a] && P[b]) {
              ctxMini.beginPath();
              ctxMini.moveTo(P[a][0] * sc, P[a][1] * sc);
              ctxMini.lineTo(P[b][0] * sc, P[b][1] * sc);
              ctxMini.stroke();
            }
            for (const p of P) if (p) {
              ctxMini.beginPath();
              ctxMini.arc(p[0] * sc, p[1] * sc, 4, 0, Math.PI * 2);
              ctxMini.fillStyle = '#00ffff';
              ctxMini.fill();
              ctxMini.strokeStyle = '#ffff00';
              ctxMini.lineWidth = 1;
              ctxMini.stroke();
            }
          }
        }
        setText(capClient, client.mode === 'black' ? 'Computer: black window (no frame yet)' : client.mode === 'waiting' ? `Computer: “${CASCADE.client.waitingText}”` : client.points ? 'Computer: pose drawn (frame on the 3D panel)' : 'Computer: frame, no pose');
        setText(cap96, sim.core === 'm4' || !on ? 'What the M4 gets: 96 × 96 gray' : 'M4 suspended: last 96 × 96 frame');
        c96.classList.toggle('dim', on && sim.core !== 'm4');
        if (!realWorld.hidden) {
          const inFrame = measure().share > 0.15;
          setText(realOut, sim.core === 'm7' && !inFrame && sim.userLed ? `Nobody in the frame, and the User LED is still on: the M7 hands back in ${Math.max(0, (CASCADE.m7.inactiveMs - sim.msWithoutPose) / 1000).toFixed(1)} s or less.` : sim.core === 'm4' ? (sim.userLed ? 'The M4 sees a person and is handing over.' : 'The M4 searches; the User LED shows its answers.') : 'The M7 is estimating poses.');
        }
        // the M4 input, read back a few times a second while the M4 works
        if ((sim.core === 'm4' || !on) && now - lastPix > 250) {
          lastPix = now;
          scene.requestPixels();
        }
        const px = scene.takePixels();
        if (px) {
          const W = CASCADE.m4.input.w, H = CASCADE.m4.input.h;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const src = ((H - 1 - y) * W + x) * 4, dst = (y * W + x) * 4;
            img96.data[dst] = img96.data[dst + 1] = img96.data[dst + 2] = px[src];
            img96.data[dst + 3] = 255;
          }
          ctx96.putImageData(img96, 0, 0);
        }
        // highlighted code lines
        let a4 = -1, a7 = -1;
        if (on) {
          const L4 = ui.L4, L7 = ui.L7;
          if (st === 'm4capture') a4 = L4.get;
          else if (st === 'm4infer') a4 = L4.invoke;
          else if (st === 'm4decide') a4 = [L4.ret, L4.led];
          else if (st === 'handoff') {
            if (sim.core === 'toM7') {
              a4 = [L4.hand, L4.disable, L4.ipc];
              a7 = [L7.start, L7.started];
            } else {
              a7 = [L7.inactive, L7.stop, L7.ipc];
              a4 = L4.resume;
            }
          } else if (st === 'm7capture') a7 = L7.get;
          else if (st === 'm7jpeg') a7 = [L7.jpeg, L7.sendImg, L7.put];
          else if (st === 'tpu') a7 = L7.invoke;
          else if (st === 'decode') a7 = L7.decode;
          else if (st === 'send') a7 = sim.pose.reported ? L7.sendPose : L7.decode;
        }
        ui.c4.setActive(a4);
        ui.c7.setActive(a7);
        ui.c4.setTag(ui.L4.ret, on && st === 'm4decide' ? `← ${sim.scores.person} > ${sim.scores.noPerson} is ${personDetected(sim.scores)} (stand-in)` : '');
        ui.c7.setTag(ui.L7.inactive, on && sim.core === 'm7' ? `← ${(sim.msWithoutPose / 1000).toFixed(1)} s since the last pose` : '');
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
      cycling = false;
      poseId = 'rest';
      scene.setPose(poseOf('rest'));
      scene.snapPose();
      sim.reset();
      sim.powered = false;
      sawM7 = false;
      Object.assign(client, { mode: 'black', points: null, lastPoseAt: -1e9, lowPowerSince: null, frames: 0 });
      scene.resetClient();
      scene.setClient({ mode: 'black', points: null, edges: [] });
    }
    resetSim();

    /** The simulated host client: what it does with each message, as multicore_model_cascade.py does. */
    function clientStep(nowS) {
      while (eventsSeen < sim.events.length) {
        const ev = sim.events[eventsSeen++];
        // Presentation: a frame's picture is taken when the M7 captures it ('capture') and shown, with that frame's
        // pose, when the cycle ends ('cycle'). On the board the JPEG and the pose JSON arrive a few milliseconds
        // apart; on the slowed-down page they would be most of a second apart, and the drawing would belong to the
        // previous image.
        if (ev.type === 'frame') {
          client.frames++; // the JPEG left the board
        } else if (ev.type === 'capture') {
          scene.clientCapture();
        } else if (ev.type === 'cycle') {
          scene.clientShow();
          if (client.mode !== 'waiting' || !sim.lowPower) client.mode = 'image';
          if (ev.reported) {
            client.points = clientPoints(ev, ev.found);
            client.lastPoseAt = nowS;
          } else if (client.points && nowS - client.lastPoseAt > CASCADE.client.clearAfterS) {
            // a frame without a pose, and none for 0.5 s: the drawing is cleared (write_data([]))
            client.points = null;
          }
        } else if (ev.type === 'handoff') {
          if (ev.to === 'm7') {
            sawM7 = true;
            ui?.maybeReveal();
            client.lowPowerSince = null;
            if (client.mode === 'waiting') client.mode = 'image';
          } else client.lowPowerSince = nowS;
        }
      }
      // low power: the waiting text appears 2 s later (set_low_power uses a 2 s timer)
      if (client.lowPowerSince != null && nowS - client.lowPowerSince >= CASCADE.client.waitingDelayS) {
        client.mode = 'waiting';
        client.lowPowerSince = null;
      }
      // while the M7 runs, the 0.5 s timer is checked when a frame arrives (above): one page cycle is longer than
      // 0.5 s, and checking it every frame made the drawing blink between two valid poses. Once the M7 has stopped,
      // no frame arrives any more and the timer runs on its own.
      if (sim.core !== 'm7' && client.points && nowS - client.lastPoseAt > CASCADE.client.clearAfterS) client.points = null;
      scene.setClient({ mode: client.mode, points: client.points, edges: EDGES });
    }

    let simClockS = 0; // simulated seconds (the client's timers use the same clock)
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
        const sdt = Math.min(dt, 0.1) * simSpeed;
        if (running && !paused) {
          simClockS += sdt;
          if (targetU != null) {
            const d = targetU - scene.u, stepU = PRESENTATION.walkSpeed * sdt;
            if (Math.abs(d) <= stepU) {
              scene.setU(targetU, true);
              targetU = null;
            } else scene.setU(scene.u + Math.sign(d) * stepU, true);
            walking = true;
          }
          if (cycling) {
            cycleT += sdt;
            if (cycleT > PRESENTATION.poseHoldS) {
              cycleT = 0;
              setPose(POSE_ORDER[(POSE_ORDER.indexOf(poseId) + 1) % POSE_ORDER.length]);
            }
          }
          sim.step(sdt * 1000);
          clientStep(simClockS);
          while (logSeen < sim.log.length) {
            const line = sim.log[logSeen++].text;
            log(line, line.startsWith('person_score') || line.startsWith('Poses') ? 'p' : '');
          }
        }
        const st = running ? sim.stageId : null, k = sim.stageProgress();
        const flowOf = () => {
          if (!running || paused) return null;
          if (st === 'm4capture') return { route: 'toMcu', k, color: AMBER };
          if (st === 'm4decide') return { route: 'toLed', k, color: personDetected(sim.scores) ? '#6dff8f' : '#9aa0b4' };
          if (st === 'm7capture') return { route: 'toMcu', k, color: VIOLET };
          if (st === 'm7jpeg') return { route: 'toUsb', k, color: '#7ad3ff' };
          if (st === 'tpu') return k < 0.5 ? { route: 'toTpu', k: k * 2, color: VIOLET } : { route: 'fromTpu', k: k * 2 - 1, color: '#ffe14a' };
          if (st === 'send' && sim.pose.reported) return { route: 'toUsb', k, color: '#ffe14a' };
          return null;
        };
        const mcuColor = !running || paused ? null : st === 'm4infer' ? AMBER : st === 'decode' ? VIOLET : st === 'handoff' ? (Math.sin(time * 12) > 0 ? AMBER : VIOLET) : null;
        const showSkel = !!(ui ? ui.showSkel !== false : true) && running && sim.core === 'm7' && sim.pose.reported;
        scene.update(time, dt, {
          camLed: running && sim.cameraOn, userLed: running && sim.userLed, tpuLed: running && sim.tpuActive, statusLed: running && sim.statusLed,
          stageK: k, flow: flowOf(), mcuColor, tpuBusy: running && !paused && st === 'tpu', lens: running && !paused && (st === 'm4capture' || st === 'm7capture'),
          skeleton: showSkel ? sim.pose.found : null, edges: showSkel ? drawnEdges(sim.pose.found) : [],
          showFov: ui ? ui.showFov !== false : true, showRoute: ui ? ui.showRoute !== false : true, walking: walking && !paused,
        });
      },
      activeStep() {
        if (!running) return -1;
        const st = sim.stageId;
        if (st.startsWith('m4')) return 0;
        if (st === 'handoff') return sim.core === 'toM7' ? 1 : 5;
        if (st === 'm7capture' || st === 'm7jpeg') return 2;
        if (st === 'tpu' || st === 'decode') return 3;
        return 4;
      },
      stop(reason) {
        const was = running;
        resetSim();
        autoStart = false;
        if (ui) {
          ui.c4.setActive(-1);
          ui.c7.setActive(-1);
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
      isRunning: () => running && !paused,
      setRunning(on) {
        if (on) {
          if (!running) start();
          else setPaused(false);
        } else setPaused(true);
      },
      inspect() {
        return {
          running, paused, u: scene.u, core: sim.core, stage: sim.stageId, userLed: running && sim.userLed, tpuLed: running && sim.tpuActive,
          statusLed: running && sim.statusLed, camLed: running && sim.cameraOn, lowPower: sim.lowPower, msWithoutPose: sim.msWithoutPose,
          poseReported: sim.pose.reported, keypointsFound: sim.pose.found.filter(Boolean).length, pose: poseId, client: client.mode,
          clientPoints: client.points ? client.points.filter(Boolean).length : 0, handoffs: { ...sim.handoffs }, timeMs: sim.timeMs,
          prediction, revealed, quiz, selected: scene.selected, hasUi: !!ui, log: sim.log.slice(-12).map((l) => l.text),
        };
      },
      debugSetU: (u) => {
        targetU = null;
        scene.setU(u, false);
      },
      debugPose: (id) => {
        setPose(id);
        scene.snapPose();
      },
      debugSelect: (p) => select(p),
      debugSpeed: (v) => (simSpeed = v),
      /** Test helper: the stand-in result for the current position and pose (no simulated time passes). */
      debugMeasure: () => {
        const m = measure();
        return { share: m.share, inFrame: m.keypoints.map((q) => Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.depth > 0) };
      },
      stages: { m4: M4_STAGES.map((s) => s.id), m7: M7_STAGES.map((s) => s.id) },
    };
  },
};
