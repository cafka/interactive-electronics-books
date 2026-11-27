import { buildAcousticScene, paintSpectrogram } from './acousticScene.js';
import { leftPageTexture, rightPageTexture } from '../../textures.js';
import { CORAL_ACOUSTIC_PAGE } from './pageContent.js';
import { CORAL } from './presence.js';
import {
  ACOUSTIC, ACOUSTIC_SOURCES, YAMNET, CLASSES, ALERT_CLASSES, SOUNDS, BACKGROUNDS, DEFAULT_RULES, BENCH_FACTS,
  cloneRules, Monitor, benchScenes, runScene, runBench, sweep, formatResults, PRINT_ID, dominantHz,
} from './acoustic.js';
import { $, $$, escapeHtml, renderCode, bindCopy, createConsole, renderSteps } from '../../ui.js';

/*
 * Coral book, chapter 3: "Listening for trouble: acoustic events with local AI".
 * Based on the official example google-coral/coralmicro examples/classify_audio (checked against its source):
 * the on-board PDM microphone, audio features on the Cortex-M7, YAMNet on the Edge TPU (or on the M7 with YAMNET_CPU),
 * results printed with a threshold of 0.3 and the top 5. The alert rules, the User LED and the event log are a teaching
 * extension written for this book (not part of coralmicro), and the page says so wherever they appear.
 *   scene  src/books/coral/acousticScene.js (the official CAD model on the stand of chapters 1 and 2, a sound source)
 *   logic  src/books/coral/acoustic.js (features computed for real; synthesised sounds; a stand-in classifier)
 *   page   src/books/coral/pageContent.js (left page)
 */

const viewButtons = [['circuit', 'Whole project'], ['stage', 'Board + sound'], ['leftpage', 'Left page'], ['board', 'Board'], ['panel', 'Spectrogram']];
const esc = (s) => escapeHtml(String(s));
const CLASS = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
const TARGETS = Object.keys(SOUNDS).filter((k) => SOUNDS[k].target);
const LOOKALIKES = Object.keys(SOUNDS).filter((k) => !SOUNDS[k].target);
const TEAL = '#1f6f78', AMBER = '#c97a12';

const STAGE_TEXT = {
  capture: 'Microphone: 16 kHz samples into a 975 ms buffer (never stops)',
  features: 'Cortex-M7: 96 × 64 audio features',
  infer: 'YAMNet: 521 class scores',
  threshold: 'Cortex-M7: score ≥ 0.3, top 5, print',
  response: 'Extension: alert rules → User LED + log',
};
const PIPE = ['capture', 'features', 'infer', 'threshold', 'response'];

const STEPS = [
  { title: 'The microphone records all the time', text: 'The on-board PDM microphone sends samples through DMA, 16 000 a second. The audio service keeps the latest 975 ms in a buffer, even while the program is busy or waiting.', view: 'board' },
  { title: 'The M7 turns 975 ms into features', text: 'The loop copies the latest 975 ms (15 600 samples) and the TensorFlow Lite Micro audio frontend makes 96 frames of 64 bands (25 ms frames, every 10 ms, 125 to 7500 Hz). This runs on the Cortex-M7.', view: 'board' },
  { title: 'YAMNet scores 521 classes', text: 'The Edge TPU build runs YAMNet on the Edge TPU; with YAMNET_CPU it runs on the Cortex-M7. Each of the 521 AudioSet classes gets its own score from 0 to 1.', view: 'board' },
  { title: 'Threshold 0.3, top 5, printed', text: 'GetClassificationResults keeps the classes scoring at least 0.3, at most 5, best first. The example prints their numbers and scores on the serial console, and that is all it does with them.', view: 'board' },
  { title: 'Extension: from scores to an alert', text: 'Not in coralmicro. This book adds rules: a threshold per class, persistence for long sounds, a cooldown, then the User LED and a line in the event log.', view: 'board' },
  { title: 'Edge TPU build: wait 975 ms', text: 'After each window the Edge TPU build waits 975 ms (“rate limit”). The next window holds the audio heard during that wait, so what was heard while the board was computing is in no window.', view: 'stage' },
];

const PARTS = {
  mic: { name: 'Microphone · PDM, on the board', text: 'Next to the camera. The audio driver reads it through DMA at 16 kHz (the driver also offers 48 kHz) in two 50 ms buffers; the first 150 ms are dropped.' },
  mcu: { name: 'NXP i.MX RT1176 · Cortex-M7 + Cortex-M4', text: 'The example is built for the Cortex-M7 only. The M7 computes the audio features, runs the interpreter, applies the threshold and prints. The M4 is not used.' },
  tpu: { name: 'Coral Edge TPU · under the metal shield', text: 'Runs the YAMNet model compiled for it (yamnet_spectra_in_edgetpu.tflite). In the CPU build it is not used: the M7 runs yamnet_spectra_in.tflite.' },
  ledUser: { name: 'User LED · green', text: 'The official example never switches it. In this book’s extension it lights for 2 s after an alert.' },
  ledStatus: { name: 'Status LED · orange', text: 'The example turns it on at start, right after printing “YamNet Example!”: LedSet(Led::kStatus, true).' },
  source: { name: 'Sound source · illustration', text: 'Plays the page’s synthesised sounds, 1 m or 4 m from the board (not to scale). Nothing here uses a real microphone or loudspeaker.' },
};
const PART_ORDER = ['mic', 'mcu', 'tpu', 'ledUser', 'ledStatus', 'source'];

const PREDICT = { yes: 'yes, it will', no: 'no, it will not', depends: 'it depends on the room and the threshold' };
const QUIZ = [
  { id: 'ready', text: 'At threshold 0.7 the test bench has no false alarms, so it is ready to guard a shop.', ok: false, why: `No. At 0.7 it misses ${BENCH_FACTS.at07.fn} of the ${BENCH_FACTS.events} events, and the bench is a few synthesised sounds scored by a stand-in, not recordings of a real room scored by YAMNet.` },
  { id: 'test', text: 'It is a demonstration: before trusting it you would test the real board with real sounds, in the real room, many times.', ok: true, why: 'Right. Fewer false alarms cost missed events, and the numbers here say nothing about YAMNet on a board. Only tests with the real device, real recordings and the real room can tell how often it is right.' },
  { id: 'low', text: 'Use threshold 0.2 everywhere: then it never misses anything.', ok: false, why: `No. At 0.2 the bench still misses ${BENCH_FACTS.at02.fn} and raises ${BENCH_FACTS.at02.fp} false alarms. An alarm that goes off all the time gets ignored.` },
];

/* ---------- the official code (Apache-2.0), shortened: lines unchanged, "// ..." for cuts ---------- */
const CODE_MAIN = `// From google-coral/coralmicro, examples/classify_audio/classify_audio.cc
// Copyright 2022 Google LLC. Licensed under the Apache License, Version 2.0.
// Shortened for the book: "// ..." marks lines left out.

// Recognizes various sounds heard with the on-board mic, using YamNet,
// running on the Edge TPU (though it can be modified to run on the CPU).
// See model details here: https://tfhub.dev/google/yamnet/1
//
// To build and flash from coralmicro root:
//    bash build.sh
//    python3 scripts/flashtool.py -e yamnet

constexpr int kTensorArenaSize = 1 * 1024 * 1024;
STATIC_TENSOR_ARENA_IN_SDRAM(tensor_arena, kTensorArenaSize);
constexpr int kNumDmaBuffers = 2;
constexpr int kDmaBufferSizeMs = 50;
// ...
constexpr int kDropFirstSamplesMs = 150;
// ...
constexpr float kThreshold = 0.3;
constexpr int kTopK = 5;

std::array<int16_t, tensorflow::kYamnetAudioSize> audio_input;

#ifdef YAMNET_CPU
// To run YamNet on the CPU, see the CMakeLists file to enable this.
constexpr char kModelName[] = "/models/yamnet_spectra_in.tflite";
constexpr bool kUseTpu = false;
#else
constexpr char kModelName[] = "/models/yamnet_spectra_in_edgetpu.tflite";
constexpr bool kUseTpu = true;
#endif

// Run invoke and get the results after the interpreter have already been
// populated with raw audio input.
void run(tflite::MicroInterpreter* interpreter, FrontendState* frontend_state) {
  auto input_tensor = interpreter->input_tensor(0);
  auto preprocess_start = TimerMillis();
  tensorflow::YamNetPreprocessInput(audio_input.data(), input_tensor,
                                    frontend_state);
  // Reset frontend state.
  FrontendReset(frontend_state);
  auto preprocess_end = TimerMillis();
  if (interpreter->Invoke() != kTfLiteOk) {
    printf("Failed to invoke on test input\\r\\n");
    vTaskSuspend(nullptr);
  }
  auto current_time = TimerMillis();
  printf(
      "Yamnet preprocess time: %lums, invoke time: %lums, total: "
      "%lums\\r\\n",
      // ...
  auto results =
      tensorflow::GetClassificationResults(interpreter, kThreshold, kTopK);
  printf("%s\\r\\n", tensorflow::FormatClassificationOutput(results).c_str());
}

[[noreturn]] void Main() {
  printf("YamNet Example!\\r\\n");
  // Turn on Status LED to show the board is on.
  LedSet(Led::kStatus, true);

  std::vector<uint8_t> yamnet_tflite;
  if (!LfsReadFile(kModelName, &yamnet_tflite)) {
    printf("Failed to load model\\r\\n");
    vTaskSuspend(nullptr);
  }
  // ...
#ifndef YAMNET_CPU
  auto edgetpu_context = EdgeTpuManager::GetSingleton()->OpenDevice();
  if (!edgetpu_context) {
    printf("Failed to get TPU context\\r\\n");
    vTaskSuspend(nullptr);
  }
#endif
  // ...
  auto yamnet_resolver = tensorflow::SetupYamNetResolver</*tForTpu=*/kUseTpu>();
  // ...
  FrontendState frontend_state{};
  if (!coralmicro::tensorflow::PrepareAudioFrontEnd(
          &frontend_state, coralmicro::tensorflow::AudioModel::kYAMNet)) {
  // ...
  // Run tensorflow on test input file.
  std::vector<uint8_t> yamnet_test_input_bin;
  if (!LfsReadFile("/models/yamnet_test_audio.bin", &yamnet_test_input_bin)) {
  // ...
  run(&interpreter, &frontend_state);

  // Setup audio
  AudioDriverConfig audio_config{AudioSampleRate::k16000_Hz, kNumDmaBuffers,
                                 kDmaBufferSizeMs};
  AudioService audio_service(&audio_driver, audio_config, kAudioServicePriority,
                             kDropFirstSamplesMs);
  LatestSamples audio_latest(
      MsToSamples(AudioSampleRate::k16000_Hz, tensorflow::kYamnetDurationMs));
  // ...
  // Delay for the first buffers to fill.
  vTaskDelay(pdMS_TO_TICKS(tensorflow::kYamnetDurationMs));
  while (true) {
    audio_latest.AccessLatestSamples(
        [](const std::vector<int32_t>& samples, size_t start_index) {
          // ...
            audio_input[i] = samples[i + start_index] >> 16;
          // ...
        });
    run(&interpreter, &frontend_state);
#ifndef YAMNET_CPU
    // Delay 975 ms to rate limit the TPU version.
    vTaskDelay(pdMS_TO_TICKS(tensorflow::kYamnetDurationMs));
#endif
  }
}
`;

/* ---------- the teaching extension: written for this book, NOT from coralmicro ---------- */
const CODE_EXT = `// Teaching extension for this book. NOT part of coralmicro.
// Not compiled or run on a board by the book's author: treat it as a starting point.
// Add it to classify_audio.cc (inside the same namespace), then call
// CheckAlerts(interpreter); at the end of run(), after the results are printed.

struct AlertRule {
  const char* name;
  std::array<int, 3> ids;  // YAMNet class ids (yamnet_class_map.csv), -1 = unused
  float threshold;         // this class's own threshold
  int k, n;                // must pass in k of the last n windows
  uint64_t cooldown_ms;    // after an alert, stay quiet this long
  uint32_t history = 0;    // one bit per window, newest in bit 0
  bool fired = false;
  uint64_t last_alert_ms = 0;
};

AlertRule rules[] = {
    {"clap", {58, 62, -1}, 0.5f, 1, 1, 2000},      // Clapping, Applause
    {"knock", {353, 454, -1}, 0.5f, 1, 1, 2000},   // Knock, Thump/thud
    {"glass", {437, 435, 464}, 0.5f, 1, 1, 4000},  // Shatter, Glass, Breaking
    {"alarm", {393, 382, 394}, 0.5f, 2, 3, 6000},  // Smoke detector, Alarm, Fire alarm
};
uint64_t led_off_ms = 0;

void CheckAlerts(tflite::MicroInterpreter* interpreter) {
  // Every class, not only the top 5 above kThreshold.
  auto all = tensorflow::GetClassificationResults(interpreter);
  auto now = TimerMillis();
  for (auto& r : rules) {
    float best = 0;
    for (const auto& c : all)
      for (int id : r.ids)
        if (c.id == id && c.score > best) best = c.score;
    r.history = (r.history << 1) | (best >= r.threshold ? 1u : 0u);
    int passes = __builtin_popcount(r.history & ((1u << r.n) - 1));
    bool cooling = r.fired && now - r.last_alert_ms < r.cooldown_ms;
    if ((r.history & 1) && passes >= r.k && !cooling) {
      r.fired = true;
      r.last_alert_ms = now;
      led_off_ms = now + 2000;
      // The serial console is the event log (score in hundredths).
      printf("ALERT %s %d at %lu ms\\r\\n", r.name, static_cast<int>(best * 100),
             static_cast<uint32_t>(now));
    }
  }
  // Checked once per window, so the LED goes off at the first window after 2 s.
  LedSet(Led::kUser, now < led_off_ms);
}
`;

/* Commands, as written in the coralmicro README, the "Get started" guide and the example's folder name. */
const CMD = {
  clone: 'git clone --recurse-submodules -j8 https://github.com/google-coral/coralmicro',
  setup: 'cd coralmicro && bash setup.sh',
  build: 'bash build.sh',
  lsusb: 'lsusb',
  flash: 'python3 scripts/flashtool.py -e classify_audio',
  serialLinux: 'ls /dev/ttyACM*',
  serialMac: 'ls /dev/cu.usbmodem*',
  screen: 'screen /dev/cu.usbmodem1301 115200',
  cpu: '# set(YAMNET_CPU true)',
  dialout: 'sudo usermod -aG dialout $USER',
};
const cmd = (k) => `<pre class="cmd"><code>${esc(CMD[k])}</code></pre>`;

const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_DOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const soundBtn = (k) => `<button class="chip-btn snd" data-sound="${k}">${esc(SOUNDS[k].label)}</button>`;
const choiceBtns = (name, items, label) => `<div class="pose-btns seg" id="${name}" role="group" aria-label="${label}">${items.map(([v, t]) => `<button class="chip-btn" data-v="${v}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>`;

const simHtml = () => `
  <p class="note sim-note"><b>Didactic simulation.</b> No microphone, board or online service is used. The sounds are synthesised in your browser and their audio features (96 × 64, as the example computes them) are computed for real. The classifier is a small hand-written scorer, <b>not YAMNet</b>: its scores are not YAMNet scores and say nothing about how well a real board hears. The alert rules, the User LED and the event log are this book’s <b>extension</b>, not part of the official example.</p>

  <div class="led-pair" role="group" aria-label="The board's LEDs">
    <div class="led-chip" id="chipStatus"><i class="led-ico">${ICON_DOT}</i><div><span>Status LED · orange</span><b>–</b><small></small></div></div>
    <div class="led-chip" id="chipUser"><i class="led-ico">${ICON_BELL}</i><div><span>User LED · green · extension</span><b>–</b><small></small></div></div>
  </div>
  <div class="cores" role="group" aria-label="What each part is doing">
    <div class="core" id="coreMic"><b>Microphone</b><span></span></div>
    <div class="core" id="coreM7"><b>Cortex-M7</b><span></span></div>
    <div class="core" id="coreTpu"><b>Edge TPU</b><span></span></div>
  </div>
  <p class="prog-state" id="progState"></p>
  <figure class="timeline-wrap">
    <canvas id="timeline" class="timeline" width="440" height="118" role="img" aria-label="The last 8 seconds: the sounds played, the 975 ms windows the board analysed, and the audio that fell in no window"></canvas>
    <figcaption><span class="lg snd-t">sound to detect</span> <span class="lg snd-o">other sound</span> <span class="lg win">window analysed</span> <span class="lg alert">window with an alert</span> <span class="lg gap">in no window</span></figcaption>
  </figure>

  <ol class="cp-steps">
    <li class="cp-step" id="cpPredict">
      <h3><i>1</i> Predict</h3>
      <p>Someone drops a spoon on a plate near the board. <b>Will the “glass breaking” alert go off?</b></p>
      <div class="btn-row three choice" id="predict" role="group" aria-label="Your prediction">
        <button class="btn" data-p="yes">Yes</button>
        <button class="btn" data-p="no">No</button>
        <button class="btn" data-p="depends">It depends</button>
      </div>
      <p class="note" id="predictOut">Choose one. Then play “Dishes clinking” in step 2, in more than one room.</p>
      <div class="reveal" id="reveal" hidden></div>
      <button class="chip-btn" id="btnReveal" hidden>I tried it: show the explanation</button>
    </li>

    <li class="cp-step" id="cpExperiment">
      <h3><i>2</i> Experiment</h3>
      <p>Play a sound into the board’s microphone. Sounds the alerts should catch:</p>
      <div class="pose-btns" id="sndTargets">${TARGETS.map(soundBtn).join('')}</div>
      <p>Everyday sounds that should not raise an alert:</p>
      <div class="pose-btns" id="sndOthers">${LOOKALIKES.map(soundBtn).join('')}</div>
      <div class="ctl-grid">
        <span>Distance</span>${choiceBtns('distBtns', [['1', 'Near · 1 m'], ['4', 'Far · 4 m']], 'Distance from the board')}
        <span>Room</span>${choiceBtns('bgBtns', Object.entries(BACKGROUNDS).map(([k, b]) => [k, b.label]), 'Background noise')}
      </div>
      <div class="cp-view spec-view">
        <figure class="px96-wrap">
          <canvas id="specMini" width="${ACOUSTIC.frames}" height="${ACOUSTIC.bands}" class="spec-mini" role="img" aria-label="Spectrogram of the last window: 96 frames by 64 bands"></canvas>
          <figcaption id="capSpec">Last window: 96 × 64 features</figcaption>
        </figure>
        <div class="scores" id="scores" aria-live="off">
          ${CLASSES.map((c) => `<div class="score-row wide" data-c="${c.id}"><span>${esc(c.name)}</span><div class="bar"><i></i>${c.alert ? '<u></u>' : ''}</div><b>–</b></div>`).join('')}
          <p class="note tiny">Demo scores (not YAMNet). Red mark: the class’s alert threshold.</p>
        </div>
      </div>
      <p class="note" id="winInfo" aria-live="polite"></p>
      <p class="printed" id="printed"></p>
    </li>

    <li class="cp-step" id="cpUnderstand">
      <h3><i>3</i> Understand</h3>
      <p>Tap a part in the 3D scene, or here:</p>
      <div class="part-btns" id="partBtns">${PART_ORDER.map((k) => `<button class="chip-btn" data-part="${k}" aria-pressed="false">${esc(PARTS[k].name.split(' · ')[0])}</button>`).join('')}</div>
      <p class="part-info" id="partInfo" aria-live="polite">Nothing selected yet.</p>
      <ol class="pipe five" id="pipe" aria-label="One window, step by step">
        ${PIPE.map((id, i) => `<li data-stage="${id}" class="${id === 'response' ? 'ext' : ''}"><b>${i + 1}</b><span>${esc(STAGE_TEXT[id])}</span></li>`).join('')}
      </ol>
      <div class="ctl-grid">
        <span>Build</span>${choiceBtns('buildBtns', [['tpu', 'Edge TPU (default)'], ['cpu', 'CPU · YAMNET_CPU']], 'Which build')}
      </div>
      <label class="check-row"><input type="checkbox" id="optNoPause"> Exercise: remove the 975 ms delay of the Edge TPU build</label>
      <div class="slider-ctl">
        <label for="procRange">Time the board needs per window: <b id="procVal"></b> <span class="tag-assume">assumption</span></label>
        <input type="range" id="procRange" min="100" max="900" step="50" value="250" aria-describedby="procHint">
        <p class="note" id="procHint">The documentation gives no figure. A real board prints its own on every window: “total: …ms”. Set it here and watch the gaps.</p>
      </div>
      <p class="note" id="gapInfo" aria-live="polite"></p>
    </li>

    <li class="cp-step" id="cpCheck">
      <h3><i>4</i> Check: tune the alerts</h3>
      <p>These rules are the extension. Each alert class has its own threshold; the alarm can be asked to persist; after an alert the class stays quiet for a while (cooldown).</p>
      <div class="rules" id="rules">
        ${ALERT_CLASSES.map((id) => `<div class="rule-row" data-c="${id}"><label class="check-row"><input type="checkbox" data-k="enabled"> ${esc(CLASS[id].name)}</label><input type="range" data-k="threshold" min="0.1" max="0.95" step="0.05" aria-label="Threshold for ${esc(CLASS[id].name)}"><b></b></div>`).join('')}
      </div>
      <div class="ctl-grid">
        <span>Alarm needs</span>${choiceBtns('persistBtns', [['1', '1 of 1 window'], ['2', '2 of 3'], ['3', '3 of 3']], 'Persistence for the alarm')}
        <span>Cooldown</span>${choiceBtns('coolBtns', [['on', '2–6 s'], ['off', 'none']], 'Cooldown after an alert')}
      </div>
      <button class="chip-btn" id="btnRulesReset">Back to the default rules</button>
      <h3>Event log (extension)</h3>
      <p class="tally" id="tally"></p>
      <ol class="event-log" id="eventLog" aria-live="polite"></ol>
      <p class="note">“Correct”, “false alarm” and “missed” are known here because the page knows which sound it played. A real board only knows what it heard.</p>
      <h3>Test bench</h3>
      <p>The same ${BENCH_FACTS.scenes} recordings for every rule: each sound near and far, in each room (${BENCH_FACTS.events} of them should raise an alert). Windows follow each other here, with no gaps.</p>
      <div class="btn-row">
        <button class="btn accent" id="btnBench">Run with my rules</button>
        <button class="btn" id="btnSweep">Try one threshold for all</button>
      </div>
      <div id="benchOut" aria-live="polite"></div>
      <p><b>The bench shows no false alarms at threshold 0.7. What is true?</b></p>
      <div class="quiz" id="quiz" role="group" aria-label="Choose an answer">
        ${QUIZ.map((q) => `<button class="btn quiz-opt" data-q="${q.id}">${esc(q.text)}</button>`).join('')}
      </div>
      <p class="quiz-out" id="quizOut" aria-live="polite"></p>
      <p class="bridge" id="bridge" hidden>Chapter 1 turned a camera frame into one LED; chapter 2 let a small model wake a bigger one. Here the input is sound, the model runs on every window, and the hard part is deciding when a score is worth an alert. <a href="?book=coral&amp;open=1&amp;lesson=1">Chapter 1</a> · <a href="?book=coral&amp;open=1&amp;lesson=2">Chapter 2</a></p>
    </li>
  </ol>

  <h3>Serial console (simulated)</h3>
  <div class="console" id="console" aria-live="off"></div>
  <div class="options">
    <label><input type="checkbox" id="optWaves" checked> Sound waves</label>
    <label><input type="checkbox" id="optRoute" checked> Path of each window</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const classIds = (c) => c.yamnet.map((n) => `${YAMNET[n]} ${esc(n)}`).join(', ');

const codeHtml = () => `
  <h3 class="code-title">C++ · coralmicro (FreeRTOS), the official example and an extension</h3>
  <p class="code-sub">The official example <code>${ACOUSTIC.example}</code> classifies sound with YAMNet. The lines highlight as the simulated board runs.</p>
  <div class="code-head"><span>classify_audio.cc · Cortex-M7 (official, shortened)</span><span class="code-actions"><button id="copyMain" class="chip-btn">Copy</button></span></div>
  <pre class="code" id="codeMain" tabindex="0"></pre>
  <p class="note">The comment in the source says <code>-e yamnet</code>, but the example’s folder, and so its project name, is <code>classify_audio</code>. The flash command below uses that name.</p>
  <div class="code-head"><span>alerts.cc · teaching extension (not from coralmicro)</span><span class="code-actions"><button id="copyExt" class="chip-btn">Copy</button></span></div>
  <pre class="code ext" id="codeExt" tabindex="0"></pre>

  <h3>What the code does</h3>
  <ul class="explain-list">
    <li><b>Microphone.</b> <code>AudioService</code> reads the PDM microphone through DMA (${ACOUSTIC.dmaBuffers} buffers of ${ACOUSTIC.dmaBufferMs} ms, 16 kHz) and drops the first ${ACOUSTIC.dropFirstMs} ms. A callback appends every block to <code>LatestSamples</code>, which keeps the latest ${ACOUSTIC.windowMs} ms. The driver gives 32-bit samples; the loop keeps the top 16 bits (<code>&gt;&gt; 16</code>).</li>
    <li><b>Features, on the Cortex-M7.</b> <code>YamNetPreprocessInput</code> runs the TensorFlow Lite Micro audio frontend prepared by <code>PrepareAudioFrontEnd(…, kYAMNet)</code>: ${ACOUSTIC.windowSamples} samples become ${ACOUSTIC.frames} frames of ${ACOUSTIC.bands} bands (${ACOUSTIC.frameMs} ms frames every ${ACOUSTIC.hopMs} ms, ${ACOUSTIC.lowHz}–${ACOUSTIC.highHz} Hz). The model takes this spectrogram as its input, which is why it is called <code>yamnet_spectra_in</code>.</li>
    <li><b>YAMNet.</b> <code>Invoke()</code> runs the model. Default build: <code>${ACOUSTIC.tpuModel}</code> on the Edge TPU; the resolver needs only ${ACOUSTIC.tpuOps.join(', ')}. With <code>YAMNET_CPU</code>: <code>${ACOUSTIC.cpuModel}</code> on the M7, with ${ACOUSTIC.cpuOps.length} TensorFlow Lite Micro operators (${ACOUSTIC.cpuOps.join(', ')}). Tensor arena: ${ACOUSTIC.tensorArenaMb} MB in SDRAM.</li>
    <li><b>Threshold.</b> <code>GetClassificationResults(interpreter, ${ACOUSTIC.threshold}, ${ACOUSTIC.topK})</code> keeps the classes scoring at least ${ACOUSTIC.threshold}, at most ${ACOUSTIC.topK}, best first. <code>FormatClassificationOutput</code> prints “Results:” and one “id: score” line each, or “No results”. The ids are rows of the YAMNet class map (${ACOUSTIC.classes} classes).</li>
    <li><b>Timing.</b> Each window is timed and printed (preprocess, invoke, total). The Edge TPU build then waits ${ACOUSTIC.windowMs} ms. The microphone keeps recording during the wait, so the next window is the audio of the wait; the audio heard while the board was computing is in no window. The CPU build has no wait: it reads again at once, and its windows overlap.</li>
    <li><b>The test input.</b> Before the microphone starts, the example loads <code>${ACOUSTIC.testAudio}</code>, copies it into the input tensor and calls <code>run()</code>. Reading the source, <code>run()</code> then fills that tensor from <code>audio_input</code>, which is still all zeros at that point, so the first result may not describe the test file. Not checked on a board.</li>
    <li><b>LEDs.</b> Only the Status LED is used: on at start. The example does nothing with the results besides printing them.</li>
    <li><b>The extension</b> reads every class score (<code>GetClassificationResults(interpreter)</code> with no threshold, so a class can have a threshold below 0.3), takes the best of the YAMNet classes that belong to each alert, and applies three rules: its own threshold, k of the last n windows, and a cooldown. An alert prints a line (the serial console is the log) and keeps the User LED on for about 2 s.</li>
  </ul>
  <table class="wiring">
    <tr><th>Alert (extension)</th><th>YAMNet classes it reads (id, name)</th></tr>
    ${CLASSES.filter((c) => c.alert).map((c) => `<tr><td>${esc(c.name)}</td><td>${classIds(c)}</td></tr>`).join('')}
  </table>

  <h3>Materials</h3>
  <ul class="explain-list">
    <li>Coral Dev Board Micro. Its on-board microphone is the one the example uses; nothing else needs to be connected.</li>
    <li>USB-C cable between the board and the computer (power, flashing and the serial console).</li>
    <li>A computer with Linux or macOS for building (as the guide lists).</li>
    <li>If the computer cannot supply enough power over USB (the board needs 5 V at 2 A; the Edge TPU draws current peaks), a powered USB hub.</li>
    <li>For the exercises: a phone or loudspeaker to play recorded sounds, and a tape measure.</li>
  </ul>

  <h3>Environment and dependencies</h3>
  <ul class="explain-list">
    <li>The <code>coralmicro</code> source with all its submodules, and the tools its <code>setup.sh</code> installs (such as CMake).</li>
    <li>For the serial console: a terminal program such as <code>screen</code>, at 115200 baud.</li>
    <li>The models and the test audio are copied to the board by the flashtool with the example (<code>${ACOUSTIC.tpuModel}</code>, <code>${ACOUSTIC.cpuModel}</code>, <code>${ACOUSTIC.testAudio}</code>).</li>
  </ul>

  <h3>Get the code</h3>
  ${cmd('clone')}
  <p>This can take a few minutes. Then install the tools:</p>
  ${cmd('setup')}

  <h3>Build the example</h3>
  <p>From the <code>coralmicro</code> folder, this builds every project (the example included) into <code>build</code>:</p>
  ${cmd('build')}

  <h3>Flash the example (install the firmware)</h3>
  <p>Plug in the board and check that it is detected (it should show as <i>Google Inc. Coral Dev Board Micro</i>):</p>
  ${cmd('lsusb')}
  <p>Flash it. <code>-e</code> takes the name of a project in <code>coralmicro/examples/</code>:</p>
  ${cmd('flash')}

  <h3>Run it and see the results</h3>
  <p>The board restarts and runs the example; the orange Status LED turns on. Open the serial console (example from the guide):</p>
  ${cmd('serialLinux')}
  ${cmd('serialMac')}
  ${cmd('screen')}
  <p>The console shows the example’s lines in this order (the times and the scores are your board’s; none are shown here because none were measured):</p>
  <pre class="cmd"><code>YamNet Example!
Yamnet preprocess time: …ms, invoke time: …ms, total: …ms
Results:
id: score
…</code></pre>
  <p>Clap, talk or play a sound near the board and watch the ids change. Look the ids up in the YAMNet class map: for example ${YAMNET.Speech} is Speech, ${YAMNET.Clapping} Clapping, ${YAMNET.Knock} Knock, ${YAMNET['Smoke detector, smoke alarm']} Smoke detector, ${YAMNET.Shatter} Shatter, ${YAMNET.Silence} Silence. “No results” means no class reached ${ACOUSTIC.threshold}.</p>

  <h3>The CPU build</h3>
  <p>To run YAMNet on the Cortex-M7 instead of the Edge TPU, uncomment this line in <code>examples/classify_audio/CMakeLists.txt</code>, then build and flash again:</p>
  ${cmd('cpu')}
  <p>This build has no 975 ms wait, and its resolver registers the ${ACOUSTIC.cpuOps.length} operators the model needs. Compare the “total” times the two builds print.</p>

  <h3>Exercises</h3>
  <ol class="steps-list">
    <li><b>Read your board’s time.</b> Note the “total” of ten windows. Set that value on the page (step 3) and look at the gaps on the timeline. How long is a sound that can fall in no window?</li>
    <li><b>Remove the wait.</b> Comment out the <code>vTaskDelay</code> after <code>run()</code>, build, flash, and count the results per second. On the page, tick the exercise box and compare the gaps. What does the source say the wait is for?</li>
    <li><b>CPU against Edge TPU.</b> Make the CPU build and compare the invoke times with the Edge TPU build.</li>
    <li><b>Name the classes.</b> Print the class name next to each id (copy the names you need from the class map into an array).</li>
    <li><b>Add the extension.</b> Add <code>CheckAlerts()</code>, build, and test it with real sounds: play a recording of breaking glass from a loudspeaker at 1 m and at 4 m, 10 times each, and count the alerts. Then leave it for an hour with the room’s normal sounds and count the false alarms.</li>
    <li><b>On the page.</b> Find the lowest glass threshold with no false alarm on the test bench. How many glass events does it miss? Then try the TV room and the fan.</li>
  </ol>

  <h3>Troubleshooting</h3>
  <ul class="explain-list">
    <li><b>Only “No results”:</b> no class reached ${ACOUSTIC.threshold}. Make a louder sound, closer to the board; the microphone is on the front, next to the camera.</li>
    <li><b>Flashing fails, or the board does not respond:</b> start Serial Downloader mode. Hold the User button while you press Reset (or while you plug in the USB cable), release it when the orange LED turns on, then flash again.</li>
    <li><b><code>STATE_CHECK_FOR_SDP</code>, “Unable to find device in SDP mode”:</b> a serial console may be holding the board’s USB serial port. Close it, or enter Serial Downloader mode by hand as above.</li>
    <li><b>“No device found” on Linux:</b> your user may not be in the group that owns <code>/dev/ttyACM0</code> (often <code>dialout</code>). Add it and reboot:</li>
  </ul>
  ${cmd('dialout')}
  <ul class="explain-list">
    <li><b>The board resets or stops during inference:</b> the Edge TPU draws current peaks; connect the board through a powered USB hub.</li>
    <li><b>Messages on the serial console</b> (from the source): <code>Failed to load model</code> (a model file is missing on the board: flash again), <code>Failed to get TPU context</code> (the Edge TPU did not start), <code>AllocateTensors failed.</code>, <code>Failed to load test input!</code>, <code>Input audio size doesn't match expected</code>.</li>
  </ul>
  <p class="note">The commands and messages come from the coralmicro README and source and the guide “Get started with the Dev Board Micro”. This page did not run on a real board, and the extension was not compiled.</p>`;

const howHtml = () => `
  <p>Click a step to move the camera. The highlighted step follows the simulated board.</p>
  <ol class="steps" id="steps"></ol>
  <h3>Checked facts</h3>
  <table class="wiring">
    <tr><th>Item</th><th>What the source says</th></tr>
    <tr><td>Example</td><td><code>${ACOUSTIC.example}</code> in google-coral/coralmicro, built for the ${ACOUSTIC.core} (<code>add_executable_m7</code>)</td></tr>
    <tr><td>MCU</td><td>${esc(CORAL.mcu)}; the Cortex-M4 is not used</td></tr>
    <tr><td>Microphone</td><td>${esc(ACOUSTIC.mic)}; 16 kHz here (the driver also offers 48 kHz)</td></tr>
    <tr><td>Window</td><td>${ACOUSTIC.windowMs} ms = ${ACOUSTIC.windowSamples} samples; ${ACOUSTIC.frames} × ${ACOUSTIC.bands} features, ${ACOUSTIC.frameMs} ms frames every ${ACOUSTIC.hopMs} ms, ${ACOUSTIC.lowHz}–${ACOUSTIC.highHz} Hz, computed on the M7</td></tr>
    <tr><td>Model</td><td>YAMNet with spectrogram input, ${ACOUSTIC.classes} AudioSet classes. Edge TPU: <code>yamnet_spectra_in_edgetpu.tflite</code> (default). CPU: <code>yamnet_spectra_in.tflite</code> with <code>YAMNET_CPU</code></td></tr>
    <tr><td>Results</td><td>score ≥ ${ACOUSTIC.threshold}, top ${ACOUSTIC.topK}, printed as “id: score”</td></tr>
    <tr><td>Rate</td><td>Edge TPU build: ${ACOUSTIC.windowMs} ms wait after each window; CPU build: no wait</td></tr>
    <tr><td>LEDs</td><td>Status LED on at start; the User LED is not used by the example</td></tr>
  </table>
  <h3>Can a sound model run on the Edge TPU?</h3>
  <p>Yes, for this one: coralmicro ships YAMNet compiled for the Edge TPU, and the example uses it by default. The audio frontend (the features) is not part of the model: it runs on the Cortex-M7 with TensorFlow Lite Micro. Other models need their own Edge TPU build; coralmicro also has a speech example on the Cortex-M7 alone (<code>tflm_micro_speech</code>) and a keyword example on the Edge TPU (<code>classify_speech</code>).</p>
  <h3>What is real and what is simulated here</h3>
  <ul class="explain-list">
    <li><b>Real:</b> the order of the steps, the window and feature sizes, the threshold and top 5, the 975 ms wait, the console format and the YAMNet class ids, from the example’s source and the class map.</li>
    <li><b>Real computation:</b> the 96 × 64 features of each window are computed in your browser with the example’s settings. They are close to, not equal to, the TensorFlow Lite Micro frontend’s numbers (different FFT, filters and scaling).</li>
    <li><b>Real:</b> the board and the place of the microphone, the MCU, the Edge TPU and the LEDs, from Google’s official CAD model.</li>
    <li><b>Simulated:</b> the sounds (synthesised, not recorded), the rooms and the distances (the sound is weaker far away; real rooms also echo).</li>
    <li><b>Simulated:</b> the classifier. A few hand-written rules on loudness, length, attack, pitch and frequency balance give a score per class. YAMNet is a neural network trained on millions of clips; its scores, mistakes and speed are not these.</li>
    <li><b>Assumed:</b> the time the board needs per window (you can change it). The board prints the real one.</li>
    <li><b>Extension, not from coralmicro:</b> the alert rules, the User LED alerts, the event log and the test bench.</li>
    <li><b>Illustrations:</b> the stand, the cable, the sound source and the waves; distances are not to scale.</li>
  </ul>
  <h3>What it cannot do: this is not a security system</h3>
  <ul class="explain-list">
    <li>Nobody has measured here how often YAMNet on this board recognises breaking glass, knocks or alarms, or how often it raises false alarms. The page cannot tell you; only tests with the real board, real sounds and the real room can.</li>
    <li>Do not rely on it to protect people or property, or in place of a certified smoke or fire alarm.</li>
    <li>It hears only what reaches its microphone, loud enough, and only in its windows. The Edge TPU build misses the audio heard while it computes.</li>
    <li>Look-alike sounds will raise false alarms, and quieter or distant events will be missed. Raising a threshold trades one for the other.</li>
    <li>Everything runs on the board: the example sends no audio anywhere. The serial console shows only class ids and scores. If you add recording or networking, tell the people in the room.</li>
  </ul>
  <h3>Sources</h3>
  <ul class="explain-list">${ACOUSTIC_SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul>`;

/** The bench scenes, kept so their scores are computed once per page. */
let BENCH = null;
const bench = () => (BENCH ??= benchScenes());

export default {
  id: 'coral-acoustic',
  number: 3,
  title: 'Listening for trouble: acoustic events with local AI',
  chapter: 'Microphone, YAMNet, alerts',
  codeTab: 'C++',
  defaultView: 'stage',
  viewButtons,
  views: {
    circuit: { t: [0, 0.6, 0.4], r: 27, phi: 0.74, theta: 0, fit: 'book' },
    stage: { t: [6.4, 2.0, -1.6], r: 19, phi: 0.9, theta: 0.12 },
    board: { t: [8.85, 4.5, -3.85], r: 10.5, phi: 1.22, theta: -0.96 },
    panel: { t: [9.2, 2.6, 3.6], r: 8.5, phi: 0.98, theta: -0.3 },
  },
  pageContent: CORAL_ACOUSTIC_PAGE,
  textures: () => ({
    left: leftPageTexture(CORAL_ACOUSTIC_PAGE),
    right: rightPageTexture({
      fig: 'FIG. 3', caption: 'Microphone → features on the Cortex-M7 → YAMNet on the Edge TPU → threshold → alert', page: 6,
      hint: 'Play a sound from the notebook, then watch the windows and the scores.',
    }),
  }),

  async create(env) {
    const scene = await buildAcousticScene();

    /* ---------- state ---------- */
    let rules = cloneRules(DEFAULT_RULES);
    const settings = { bg: 'quiet', build: 'tpu', noPause: false, procMs: 250, distance: 1 };
    const mon = new Monitor({ ...settings, rules });
    let running = false, paused = false, autoStart = false, popT = 0, simSpeed = 1;
    let ui = null, pickWhat = null, pickRay = null, pressMoved = false;
    let prediction = null, revealed = false, quiz = null, dishesPlayed = 0;
    let consoleSeen = 0, benchBusy = false, benchHtml = '';
    const log = (t, c) => ui && ui.log(t, c);

    function start() {
      running = true;
      paused = false;
      mon.reset();
      consoleSeen = 0;
      log('# Board powered over USB. The flashed example starts on the Cortex-M7.', 'c');
      log('# It first classifies the test file /models/yamnet_test_audio.bin (not simulated), then the microphone.', 'c');
      log('# Each window also prints “Yamnet preprocess time: …ms, invoke time: …ms, total: …ms” (times not simulated).', 'c');
    }
    function setPaused(on) {
      if (!running || paused === on) return;
      paused = on;
      log(on ? '# Paused: the simulated board is frozen.' : '# Playing again.', 'c');
    }
    function play(kind) {
      if (!running) start();
      if (paused) setPaused(false);
      const ev = mon.play(kind, { distance: settings.distance });
      if (kind === 'dishes') {
        dishesPlayed++;
        ui?.maybeReveal();
      }
      const amp = 1 / settings.distance;
      scene.emit(SOUNDS[kind].label, SOUNDS[kind].ms, amp, SOUNDS[kind].target ? '#ffb347' : '#7ad3ff');
      log(`# Sound: ${SOUNDS[kind].label}, ${settings.distance} m, ${BACKGROUNDS[settings.bg].label.toLowerCase()}.`, 'c');
      return ev;
    }
    function apply(opts) {
      Object.assign(settings, opts);
      mon.set({ bg: settings.bg, build: settings.build, noPause: settings.noPause, procMs: settings.procMs });
      if ('distance' in opts) scene.setDistance(settings.distance);
      ui?.sync();
    }
    function setRules(r) {
      rules = cloneRules(r);
      mon.set({ rules });
      ui?.syncRules();
    }
    function select(part) {
      scene.selectPart(part);
      ui?.showPart(part);
    }

    /* ---------- labels ---------- */
    const A = scene.anchors;
    const stageWord = () => (mon.phase === 'wait' ? 'waiting (vTaskDelay)' : mon.stage === 'features' ? 'computing features' : mon.stage === 'infer' ? 'running YAMNet' : 'threshold + print');
    const labels = [
      { id: 'mic', cls: 'compact', title: 'Microphone · PDM', sub: () => `<span class="val">${running ? 'recording, 16 kHz' : 'off'}</span>`, at: A.mic, side: 'right' },
      { id: 'ledUser', cls: 'compact', title: 'User LED · extension', sub: () => `<span class="val">${running && mon.userLed ? 'ON · alert' : 'off'}</span>`, at: A.ledUser, side: 'right' },
      { id: 'mcu', cls: 'compact', title: 'i.MX RT1176 · Cortex-M7', sub: () => (running ? stageWord() : '–'), at: A.mcu, side: 'left' },
      { id: 'tpu', cls: 'compact', title: 'Edge TPU', sub: () => (settings.build === 'cpu' ? 'not used (CPU build)' : 'runs YAMNet'), at: A.tpu, side: 'left' },
      { id: 'source', cls: 'compact', title: 'Sound source', sub: () => `simulated · ${settings.distance} m`, at: A.source, side: 'right' },
      { id: 'panel', cls: 'compact', title: 'Spectrogram', sub: 'last window, computed in the page', at: A.panel, side: 'right', hideNarrow: true },
      { id: 'ledStatus', cls: 'compact', title: 'Status LED', sub: () => `<span class="val">${running ? 'ON' : 'off'}</span>`, at: A.ledStatus, side: 'left', hideNarrow: true },
    ];

    /* ---------- the bench (heavy the first time: computed in small steps) ---------- */
    async function primeBench(progress) {
      const scenes = bench();
      for (let i = 0; i < scenes.length; i++) {
        if (!scenes[i]._scored) {
          runScene(scenes[i]);
          progress?.(i + 1, scenes.length);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      return scenes;
    }
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
    function benchTable(b) {
      const fps = b.rows.filter((r) => r.fp > 0), fns = b.rows.filter((r) => r.fn > 0);
      const where = (r) => `${esc(SOUNDS[r.kind].label)}, ${esc(BACKGROUNDS[r.bg].label.toLowerCase())}, ${r.distance} m`;
      return `<table class="wiring bench">
        <tr><th>Found</th><th>False alarms</th><th>Missed</th></tr>
        <tr><td>${b.tp} of ${b.events} (${pct(b.tp, b.events)} %)</td><td>${b.fp}</td><td>${b.fn}</td></tr></table>
        ${fps.length ? `<p class="note"><b>False alarms:</b> ${fps.map((r) => `${where(r)} → ${r.alerts.filter((a) => a !== r.target).map((a) => esc(CLASS[a].name)).join(', ')}`).join('; ')}.</p>` : '<p class="note">No false alarms on the bench.</p>'}
        ${fns.length ? `<p class="note"><b>Missed:</b> ${fns.map(where).join('; ')}.</p>` : '<p class="note">Nothing missed on the bench.</p>'}`;
    }
    async function runBenchUI(kind) {
      if (benchBusy) return;
      benchBusy = true;
      const out = () => ui && $('#benchOut', ui.sim);
      const show = (h) => {
        benchHtml = h;
        const el = out();
        if (el) el.innerHTML = h;
      };
      show('<p class="note">Scoring the bench…</p>');
      const scenes = await primeBench((i, n) => show(`<p class="note">Scoring the bench… ${i} of ${n}</p>`));
      if (kind === 'sweep') {
        const rows = sweep([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], rules, scenes);
        show(`<table class="wiring bench"><tr><th>Threshold (all classes)</th><th>Found</th><th>False alarms</th><th>Missed</th></tr>
          ${rows.map((r) => `<tr><td>${r.threshold.toFixed(1)}</td><td>${r.tp} of ${r.events}</td><td>${r.fp}</td><td>${r.fn}</td></tr>`).join('')}</table>
          <p class="note">Your persistence and cooldown rules are kept; only the thresholds change. Lower: fewer misses, more false alarms. Higher: the other way round. No threshold gives both zero.</p>`);
      } else show(benchTable(runBench(rules, scenes)));
      benchBusy = false;
      ui?.afterBench();
    }

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      autoStart = autoStart || !running;
      tabs.sim.innerHTML = simHtml();
      tabs.code.innerHTML = codeHtml();
      tabs.how.innerHTML = howHtml();
      const cm = renderCode($('#codeMain', tabs.code), CODE_MAIN, 'cpp');
      const ce = renderCode($('#codeExt', tabs.code), CODE_EXT, 'cpp');
      bindCopy($('#copyMain', tabs.code), () => CODE_MAIN, $('#codeMain', tabs.code));
      bindCopy($('#copyExt', tabs.code), () => CODE_EXT, $('#codeExt', tabs.code));
      const access = cm.find(/audio_latest\.AccessLatestSamples\(/);
      const L = {
        access: [access, cm.find(/audio_input\[i\] = samples/)], pre: cm.find(/YamNetPreprocessInput\(/), invoke: cm.find(/interpreter->Invoke\(\)/),
        results: cm.find(/GetClassificationResults\(interpreter, kThreshold/), print: cm.find(/FormatClassificationOutput\(results\)/),
        delay: cm.find(/vTaskDelay\(pdMS_TO_TICKS/, access), status: cm.find(/LedSet\(Led::kStatus/),
      };
      const E = { best: ce.find(/c\.score > best/), rule: ce.find(/passes >= r\.k/), print: ce.find(/printf\("ALERT/), led: ce.find(/LedSet\(Led::kUser/) };
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim), 12);
      ui = { cm, ce, L, E, log: consoleLog, steps, sim: tabs.sim };
      const q = (s) => $(s, tabs.sim);
      const chips = { status: q('#chipStatus'), user: q('#chipUser') };
      const cores = { mic: q('#coreMic'), m7: q('#coreM7'), tpu: q('#coreTpu') };
      const progEl = q('#progState'), tl = q('#timeline'), tctx = tl.getContext('2d');
      const predictBtns = $$('#predict button', tabs.sim), predictOut = q('#predictOut'), reveal = q('#reveal'), btnReveal = q('#btnReveal');
      const spec = q('#specMini'), sctx = spec.getContext('2d'), capSpec = q('#capSpec');
      const scoreRows = Object.fromEntries($$('#scores .score-row', tabs.sim).map((r) => [r.dataset.c, { i: $('i', r), u: $('u', r), b: $('b', r) }]));
      const winInfo = q('#winInfo'), printed = q('#printed');
      const partBtns = $$('#partBtns button', tabs.sim), partInfo = q('#partInfo'), pipeItems = $$('#pipe li', tabs.sim);
      const optNoPause = q('#optNoPause'), procRange = q('#procRange'), procVal = q('#procVal'), gapInfo = q('#gapInfo');
      const ruleRows = $$('#rules .rule-row', tabs.sim);
      const tally = q('#tally'), eventLog = q('#eventLog'), benchOut = q('#benchOut');
      const quizBtns = $$('#quiz button', tabs.sim), quizOut = q('#quizOut'), bridge = q('#bridge');
      const optWaves = q('#optWaves'), optRoute = q('#optRoute'), optLabels = q('#optLabels');

      optLabels.checked = env.options.labels;
      optLabels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      for (const [box, key] of [[optWaves, 'showWaves'], [optRoute, 'showRoute']]) {
        box.checked = ui[key] ?? true;
        ui[key] = box.checked;
        box.addEventListener('change', () => (ui[key] = box.checked));
      }
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Simulated serial console (115200 baud on a real board).', 'c');
      consoleLog('# Lines starting with [extension] come from this book’s alert rules, not from the example.', 'c');

      /* step 1 */
      const renderPrediction = () => {
        predictBtns.forEach((b) => {
          b.classList.toggle('chosen', b.dataset.p === prediction);
          b.setAttribute('aria-pressed', String(b.dataset.p === prediction));
        });
        if (prediction && !revealed) predictOut.textContent = `Your prediction: ${PREDICT[prediction]}. Now play “Dishes clinking” in step 2, with different rooms and distances.`;
      };
      predictBtns.forEach((b) => b.addEventListener('click', () => {
        if (revealed) return;
        prediction = b.dataset.p;
        renderPrediction();
      }));
      const doReveal = () => {
        revealed = true;
        const right = prediction === 'depends';
        const mine = mon.log.filter((e) => e.type === 'alert' && e.verdict === 'false alarm' && e.cls === 'glass' && e.sounds.includes(SOUNDS.dishes.label)).length;
        reveal.hidden = false;
        btnReveal.hidden = true;
        reveal.innerHTML = `${prediction ? `<p class="${right ? 'good' : 'bad'}"><b>${right ? 'Your prediction was right.' : `You predicted: ${esc(PREDICT[prediction])}.`}</b></p>` : ''}
          <p>In your tries, dishes set off the glass alert <b>${mine}</b> time${mine === 1 ? '' : 's'}. On the page’s test bench, with the default rules, they set it off in <b>${BENCH_FACTS.dishesGlass} of ${BENCH_FACTS.dishesCases}</b> cases (${esc(BENCH_FACTS.dishesWhere)}).</p>
          <p>A clink is short, sharp and high, like breaking glass. Whether it passes depends on the room noise, the distance, where the window cuts the sound, and the threshold. That is why a detector has to be tested with the look-alikes, not only with the sounds it should catch.</p>`;
        predictBtns.forEach((b) => (b.disabled = true));
        predictOut.textContent = '';
      };
      btnReveal.addEventListener('click', doReveal);
      ui.maybeReveal = () => {
        if (!revealed && dishesPlayed > 0) btnReveal.hidden = false;
      };
      renderPrediction();
      ui.maybeReveal();
      if (revealed) doReveal();

      /* step 2 */
      $$('button[data-sound]', tabs.sim).forEach((b) => b.addEventListener('click', () => play(b.dataset.sound)));
      const seg = (id, key, conv = (v) => v) => {
        const btns = $$(`#${id} button`, tabs.sim);
        btns.forEach((b) => b.addEventListener('click', () => apply({ [key]: conv(b.dataset.v) })));
        return () => btns.forEach((b) => {
          const on = conv(b.dataset.v) === settings[key];
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      };
      const syncs = [seg('distBtns', 'distance', Number), seg('bgBtns', 'bg'), seg('buildBtns', 'build')];

      /* step 3 */
      ui.showPart = (part) => {
        partBtns.forEach((b) => {
          b.classList.toggle('active', b.dataset.part === part);
          b.setAttribute('aria-pressed', String(b.dataset.part === part));
        });
        partInfo.innerHTML = part ? `<b>${esc(PARTS[part].name)}</b> ${esc(PARTS[part].text)}` : 'Nothing selected yet.';
      };
      partBtns.forEach((b) => b.addEventListener('click', () => select(scene.selected === b.dataset.part ? null : b.dataset.part)));
      ui.showPart(scene.selected);
      optNoPause.addEventListener('change', () => apply({ noPause: optNoPause.checked }));
      procRange.addEventListener('input', () => apply({ procMs: Number(procRange.value) }));
      ui.sync = () => {
        syncs.forEach((f) => f());
        optNoPause.checked = settings.noPause;
        optNoPause.disabled = settings.build === 'cpu';
        procRange.value = String(settings.procMs);
        procVal.textContent = `${settings.procMs} ms`;
        const gap = mon.gapMs, period = mon.periodMs;
        gapInfo.textContent = settings.build === 'cpu' || settings.noPause
          ? `A new window every ${period} ms. The windows overlap by ${ACOUSTIC.windowMs - Math.min(period, ACOUSTIC.windowMs)} ms: every moment of audio is in at least one window, and a short sound can be scored more than once.${settings.build === 'cpu' ? ' (On a real board the CPU build is likely slower per window than the Edge TPU build: measure it.)' : ''}`
          : `A new window every ${period} ms (${settings.procMs} ms computing + ${ACOUSTIC.windowMs} ms wait). The ${gap} ms of audio heard while the board computes is in no window.`;
      };
      ui.sync();

      /* step 4 */
      ui.syncRules = () => {
        ruleRows.forEach((row) => {
          const r = rules[row.dataset.c];
          $('[data-k="enabled"]', row).checked = r.enabled;
          const rg = $('[data-k="threshold"]', row);
          rg.value = String(r.threshold);
          rg.disabled = !r.enabled;
          $('b', row).textContent = r.threshold.toFixed(2);
          const u = scoreRows[row.dataset.c]?.u;
          if (u) u.style.left = `${r.threshold * 100}%`;
        });
        const k = rules.alarm.k;
        $$('#persistBtns button', tabs.sim).forEach((b) => {
          const on = Number(b.dataset.v) === k;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        const coolOn = ALERT_CLASSES.some((c) => rules[c].cooldownMs > 0);
        $$('#coolBtns button', tabs.sim).forEach((b) => {
          const on = (b.dataset.v === 'on') === coolOn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      };
      ruleRows.forEach((row) => {
        const id = row.dataset.c;
        $('[data-k="enabled"]', row).addEventListener('change', (e) => setRules({ ...rules, [id]: { ...rules[id], enabled: e.target.checked } }));
        $('[data-k="threshold"]', row).addEventListener('input', (e) => setRules({ ...rules, [id]: { ...rules[id], threshold: Number(e.target.value) } }));
      });
      $$('#persistBtns button', tabs.sim).forEach((b) => b.addEventListener('click', () => {
        const k = Number(b.dataset.v);
        setRules({ ...rules, alarm: { ...rules.alarm, k, n: k === 1 ? 1 : 3 } });
      }));
      $$('#coolBtns button', tabs.sim).forEach((b) => b.addEventListener('click', () => {
        const r = cloneRules(rules);
        for (const c of ALERT_CLASSES) r[c].cooldownMs = b.dataset.v === 'on' ? DEFAULT_RULES[c].cooldownMs : 0;
        setRules(r);
      }));
      q('#btnRulesReset').addEventListener('click', () => setRules(DEFAULT_RULES));
      ui.syncRules();
      q('#btnBench').addEventListener('click', () => runBenchUI('bench'));
      q('#btnSweep').addEventListener('click', () => runBenchUI('sweep'));
      benchOut.innerHTML = benchHtml;
      ui.afterBench = () => {};

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
        bridge.hidden = !(it && it.ok);
      };
      quizBtns.forEach((b) => b.addEventListener('click', () => {
        quiz = b.dataset.q;
        renderQuiz();
      }));
      renderQuiz();

      /* every frame */
      const setText = (el, t) => el.textContent !== t && (el.textContent = t);
      const chip = (el, on, small) => {
        el.classList.toggle('on', on);
        setText($('b', el), on ? 'ON' : 'OFF');
        setText($('small', el), small);
      };
      let lastWin = null, logLen = -1, tallyKey = '';
      const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
      ui.frame = () => {
        const on = running;
        chip(chips.status, on, on ? 'on since start (official)' : 'board off');
        chip(chips.user, on && mon.userLed, !on ? '' : mon.userLed ? 'alert, for 2 s' : 'no alert');
        const st = mon.stage, cpu = settings.build === 'cpu';
        setText($('span', cores.mic), on ? 'recording into the 975 ms buffer' : '–');
        setText($('span', cores.m7), !on ? '–' : st === 'wait' ? 'waiting 975 ms (vTaskDelay)' : st === 'features' ? 'computing the features' : st === 'infer' ? (cpu ? 'running YAMNet itself' : 'waiting for the Edge TPU') : 'threshold, top 5, print');
        setText($('span', cores.tpu), !on ? '–' : cpu ? 'not used (CPU build)' : st === 'infer' ? 'running YAMNet' : 'idle');
        cores.mic.classList.toggle('on', on);
        cores.m7.classList.toggle('on', on && st !== 'wait');
        cores.tpu.classList.toggle('on', on && !cpu && st === 'infer');
        const p = mon.pending;
        setText(progEl, !on ? 'Board: starting…' : paused ? 'Board: PAUSED (Play in the top bar continues)'
          : `Board: t = ${sec(mon.t)} · ${p ? `window ${sec(p.start)}–${sec(p.end)}: ${STAGE_TEXT[st === 'decide' ? 'threshold' : st]}` : `next window at ${sec(mon.nextRead)}`}`);
        progEl.classList.toggle('on', on && !paused);
        const active = !on ? [] : st === 'wait' ? ['capture'] : st === 'decide' ? ['threshold', 'response'] : [st];
        pipeItems.forEach((li) => li.classList.toggle('active', active.includes(li.dataset.stage)));
        drawTimeline(tctx, tl.width, tl.height);
        // the last window: spectrogram, scores, measurements, what the example prints
        const w = mon.last;
        if (w !== lastWin) {
          lastWin = w;
          if (w) {
            paintSpectrogram(sctx, w.features, ACOUSTIC.frames, ACOUSTIC.bands);
            const best = Object.entries(w.scores).sort((a, b) => b[1] - a[1])[0];
            setText(capSpec, `Window ${sec(w.start)}–${sec(w.end)}`);
            for (const c of CLASSES) {
              const r = scoreRows[c.id], v = w.scores[c.id];
              r.i.style.width = `${Math.round(v * 100)}%`;
              r.i.classList.toggle('win', c.id === best[0] && v >= ACOUSTIC.threshold);
              r.i.classList.toggle('alert', w.alerts.some((a) => a.id === c.id));
              setText(r.b, v.toFixed(2));
            }
            const m = w.m;
            setText(winInfo, `Measured in this window: ${m.peak.toFixed(1)} above the room (log units), ${m.activeMs} ms loud, ${m.bursts} burst${m.bursts === 1 ? '' : 's'}, ${Math.round(m.high * 100)} % of the energy above 4 kHz, strongest band about ${Math.round(dominantHz(w.features, m))} Hz.${w.alerts.length ? ` Alert: ${w.alerts.map((a) => CLASS[a.id].name).join(', ')}.` : ''}`);
            printed.innerHTML = `<b>The example prints</b> (threshold ${ACOUSTIC.threshold}, top ${ACOUSTIC.topK}, demo scores): <code>${esc(formatResults(w.top).join(' · '))}</code>${w.top.length ? ` = ${w.top.map((t) => `${PRINT_ID[t.id]} ${esc(CLASS[t.id].yamnet[0])}`).join(', ')}` : ''}`;
          }
        }
        // the event log, newest first
        if (mon.log.length !== logLen) {
          logLen = mon.log.length;
          eventLog.innerHTML = mon.log.slice(-12).reverse().map((e) => e.type === 'alert'
            ? `<li class="${e.verdict === 'correct' ? 'ok' : 'fa'}"><b>${sec(e.t)} · ${esc(CLASS[e.cls].name)} alert · ${e.score.toFixed(2)}</b><span>${e.verdict === 'correct' ? 'correct' : 'false alarm'} · heard: ${esc(e.sounds.join(', '))}</span></li>`
            : `<li class="miss"><b>${sec(e.t)} · missed: ${esc(e.sounds.join(', '))}</b><span>${esc(e.reason)}</span></li>`).join('') || '<li class="none">No alerts yet. Play a sound.</li>';
        }
        const tk = JSON.stringify(mon.stats);
        if (tk !== tallyKey) {
          tallyKey = tk;
          tally.innerHTML = `<span class="ok">Correct: <b>${mon.stats.tp}</b></span> <span class="fa">False alarms: <b>${mon.stats.fp}</b></span> <span class="miss">Missed: <b>${mon.stats.fn}</b></span>`;
        }
        // highlighted code lines
        let a = -1, b = -1;
        if (on && !paused) {
          if (st === 'features') a = [...L.access, L.pre];
          else if (st === 'infer') a = L.invoke;
          else if (st === 'decide') {
            a = [L.results, L.print];
            b = mon.userLed ? [E.best, E.rule, E.print, E.led] : [E.best, E.rule];
          } else if (st === 'wait') a = cpu ? -1 : L.delay;
        }
        cm.setActive(a);
        ce.setActive(b);
        cm.setTag(L.delay, on && !cpu && settings.noPause ? '← removed in the exercise' : '');
      };

      /** The last 8 s: sounds, windows, and the audio in no window. */
      function drawTimeline(c, W, H) {
        const span = 8000, t1 = Math.max(mon.t, span * 0.6), t0 = t1 - span, LEFT = 66, R = W - 6;
        const X = (t) => LEFT + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * (R - LEFT);
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#fffaf0';
        c.fillRect(0, 0, W, H);
        c.font = '600 12px "Segoe UI", system-ui, sans-serif';
        c.fillStyle = '#5b5670';
        c.textAlign = 'left';
        c.fillText('Sounds', 4, 23);
        c.fillText('Windows', 4, 57);
        c.fillText('No window', 4, 91);
        // sounds
        for (const ev of mon.events) {
          const e1 = ev.at + SOUNDS[ev.kind].ms;
          if (e1 < t0 || ev.at > t1) continue;
          const x0 = X(ev.at), x1 = Math.max(X(e1), x0 + 2);
          c.fillStyle = SOUNDS[ev.kind].target ? '#f0a43a' : '#8c93b3';
          c.fillRect(x0, 10, x1 - x0, 18);
          if (x1 - x0 > 46) {
            c.fillStyle = '#1b2133';
            c.save();
            c.beginPath();
            c.rect(x0, 10, x1 - x0, 18);
            c.clip();
            c.fillText(SOUNDS[ev.kind].label, x0 + 3, 23);
            c.restore();
          }
        }
        // windows: two lanes so overlapping windows stay visible
        const reads = [...mon.reads];
        if (mon.pending) reads.push({ ...mon.pending, pending: true });
        reads.forEach((r, i) => {
          if (r.end < t0) return;
          const y = 38 + (i % 2) * 16, x0 = X(r.start), x1 = X(r.end);
          c.fillStyle = r.pending ? 'rgba(31,111,120,0.15)' : r.alert ? 'rgba(46,158,85,0.55)' : 'rgba(31,111,120,0.32)';
          c.fillRect(x0, y, x1 - x0, 13);
          c.strokeStyle = r.alert ? '#1f8a46' : TEAL;
          c.lineWidth = 1;
          if (r.pending) c.setLineDash([4, 3]);
          c.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, 12);
          c.setLineDash([]);
        });
        // audio in no window, up to the end of the latest window
        const sorted = reads.slice().sort((p, q2) => p.start - q2.start);
        let covered = sorted.length ? sorted[0].end : 0;
        c.fillStyle = 'rgba(192,57,43,0.75)';
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].start > covered && covered < t1 && sorted[i].start > t0) c.fillRect(X(covered), 80, Math.max(2, X(sorted[i].start) - X(covered)), 14);
          covered = Math.max(covered, sorted[i].end);
        }
        // time axis
        c.fillStyle = '#8a8499';
        c.font = '11px "Segoe UI", system-ui, sans-serif';
        c.textAlign = 'center';
        for (let s = Math.ceil(t0 / 1000); s * 1000 <= t1; s++) {
          if (s < 0) continue;
          const x = X(s * 1000);
          c.fillRect(x, 100, 1, 4);
          if (s % 2 === 0) c.fillText(`${s} s`, x, 114);
        }
        if (running) {
          c.fillStyle = AMBER;
          c.fillRect(X(mon.t) - 1, 6, 2, 92);
        }
      }
    }

    /* ---------- runtime ---------- */
    return {
      root: scene.root,
      popDuration: scene.popDuration,
      labels,
      mountUI,
      unmountUI() {
        ui = null;
      },
      frameUI() {
        ui?.frame();
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
        if (running && !paused) {
          mon.step(Math.min(dt, 0.1) * 1000 * simSpeed);
          // the monitor keeps the last 80 lines; print the ones not shown yet
          const lines = mon.console;
          while (consoleSeen < mon.consoleTotal) {
            const idx = lines.length - (mon.consoleTotal - consoleSeen);
            consoleSeen++;
            if (idx < 0) continue;
            const line = lines[idx];
            log(line, line.startsWith('[extension]') ? 'x' : line === 'Results:' || line === 'No results' || /^\d+: /.test(line) ? 'p' : '');
          }
        }
        const st = mon.stage;
        const w = mon.last;
        if (w && w !== scene._lastDrawn) {
          scene._lastDrawn = w;
          const best = w.top[0];
          scene.drawSpectrogram(w.features, w.alerts.length ? `ALERT: ${CLASS[w.alerts[0].id].name}` : best ? `${PRINT_ID[best.id]} · ${CLASS[best.id].name} ${best.score.toFixed(2)} (demo)` : 'No results', w.alerts.length ? '#6dff8f' : '#ffffff');
        }
        scene.update(time, dt, {
          statusLed: running, userLed: running && mon.userLed, tpuLed: false, listening: running && !paused,
          stage: running && !paused ? (st === 'wait' ? null : st) : null, build: settings.build, alert: !!(w && w.alerts.length && st === 'decide'),
          showWaves: ui ? ui.showWaves !== false : true, showRoute: ui ? ui.showRoute !== false : true,
        });
      },
      activeStep() {
        if (!running) return -1;
        const st = mon.stage;
        if (st === 'wait') return 5;
        if (st === 'features') return 1;
        if (st === 'infer') return 2;
        return mon.userLed ? 4 : 3;
      },
      stop(reason) {
        const was = running;
        running = false;
        paused = false;
        autoStart = false;
        mon.reset();
        consoleSeen = 0;
        if (ui) {
          ui.cm.setActive(-1);
          ui.ce.setActive(-1);
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Play in the top bar to start it again.', 'c');
          else if (was) ui.log('# Simulation stopped.', 'c');
        }
      },
      pick(raycaster) {
        if (popT < scene.popDuration || !scene.root.visible) return false;
        const hits = raycaster.intersectObjects(scene.hitMeshes(), false);
        if (!hits.length) return false;
        pickWhat = hits[0].object.userData.hit || null;
        pickRay = raycaster.ray.direction.clone();
        return !!pickWhat;
      },
      pressStart() {
        pressMoved = false;
      },
      pressMove(raycaster) {
        if (pickRay && raycaster.ray.direction.angleTo(pickRay) > 0.01) pressMoved = true;
      },
      pressEnd() {
        if (pickWhat && !pressMoved) select(scene.selected === pickWhat ? null : pickWhat);
        pickWhat = null;
      },
      releaseAll() {
        pickWhat = null;
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
        const w = mon.last;
        return {
          running, paused, t: mon.t, phase: mon.phase, stage: mon.stage, settings: { ...settings }, periodMs: mon.periodMs, gapMs: mon.gapMs,
          userLed: running && mon.userLed, stats: { ...mon.stats }, reads: mon.reads.length, events: mon.events.map((e) => ({ kind: e.kind, state: e.state })),
          last: w ? { start: w.start, top: w.top.map((t) => t.id), alerts: w.alerts.map((a) => a.id) } : null,
          log: mon.log.map((e) => ({ type: e.type, cls: e.cls, verdict: e.verdict })), console: mon.console.slice(-8),
          rules: cloneRules(rules), prediction, revealed, quiz, selected: scene.selected, hasUi: !!ui, benchBusy,
        };
      },
      debugPlay: (kind) => play(kind),
      debugApply: (opts) => apply(opts),
      debugRules: (r) => setRules(r),
      debugSelect: (p) => select(p),
      debugSpeed: (v) => (simSpeed = v),
      debugBench: (kind = 'bench') => runBenchUI(kind),
    };
  },
};
