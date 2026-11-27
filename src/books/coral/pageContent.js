/*
 * Left page of Coral chapter 1 (same block types as src/pageContent.js). The 3D page texture and the HTML
 * "Read page" view are both built from this object.
 */
const INK = '#2b2740';
const ACCENT = '#b5432a';
const TEAL = '#1f6f78';
const SANS = "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";
const svgWrap = (w, h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" font-family="${SANS}">${body}</svg>`;

/* One cycle of the demo: four boxes in a row, each arrow ends on a box edge, labels inside the boxes. */
const pipeline = svgWrap(860, 250, `
  <defs><marker id="cpa" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="8" y="58" width="190" height="118" rx="14" fill="#d8e6f2"/>
    <rect x="228" y="58" width="190" height="118" rx="14" fill="#e6e6e6"/>
    <rect x="448" y="58" width="190" height="118" rx="14" fill="#e7dcf3"/>
    <rect x="668" y="58" width="184" height="118" rx="14" fill="#d9ecd9"/>
    <path d="M198 117 H227" marker-end="url(#cpa)"/>
    <path d="M418 117 H447" marker-end="url(#cpa)"/>
    <path d="M638 117 H667" marker-end="url(#cpa)"/>
    <path d="M760 176 V196 H103 V177" stroke-dasharray="7 6" marker-end="url(#cpa)"/>
  </g>
  <g fill="${INK}" font-size="21" font-weight="700" text-anchor="middle">
    <text x="103" y="92">1 · Camera</text><text x="323" y="92">2 · Smaller</text><text x="543" y="92">3 · Model</text><text x="760" y="92">4 · Program</text>
  </g>
  <g fill="${INK}" font-size="17" text-anchor="middle">
    <text x="103" y="122">captures a</text><text x="103" y="146">324 × 324 image</text>
    <text x="323" y="122">96 × 96 pixels,</text><text x="323" y="146">grayscale</text>
    <text x="543" y="122">on the Cortex-M7:</text><text x="543" y="146">person / no person</text>
    <text x="760" y="122">User LED on if</text><text x="760" y="146">person wins</text>
  </g>
  <g fill="${TEAL}" font-size="17" font-weight="700">
    <text x="12" y="34">Camera LED: on the whole time the camera captures</text>
  </g>
  <g fill="${ACCENT}" font-size="16" text-anchor="middle" font-weight="600">
    <text x="430" y="226">repeats for every frame, with or without a person</text>
  </g>
  <path d="M10 44 H850" stroke="${TEAL}" stroke-width="4" stroke-linecap="round"/>`,
'One cycle of the person detection demo: the camera captures a 324 by 324 image, it is reduced to 96 by 96 grayscale pixels, a model on the Cortex-M7 scores person and no person, and the program turns the User LED on if person wins. The cycle repeats for every frame. The Camera LED stays on the whole time the camera captures');

/* Chapter 2: the cascade of the official app multicore_model_cascade, as its source runs it. */
const cascadeSvg = svgWrap(860, 330, `
  <defs><marker id="cca" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="8" y="70" width="250" height="150" rx="14" fill="#f6e3c4"/>
    <rect x="330" y="70" width="250" height="150" rx="14" fill="#e7dcf3"/>
    <rect x="652" y="70" width="200" height="150" rx="14" fill="#eef0f4"/>
    <path d="M258 120 H329" marker-end="url(#cca)"/>
    <path d="M580 120 H651" marker-end="url(#cca)"/>
    <path d="M651 175 H581" marker-end="url(#cca)"/>
    <path d="M455 220 V262 H133 V221" stroke-dasharray="7 6" marker-end="url(#cca)"/>
  </g>
  <g fill="${INK}" font-size="21" font-weight="700" text-anchor="middle">
    <text x="133" y="104">1 · Cortex-M4</text><text x="455" y="104">2 · Cortex-M7</text><text x="752" y="104">3 · Edge TPU</text>
  </g>
  <g fill="${INK}" font-size="16" text-anchor="middle">
    <text x="133" y="134">person detection</text><text x="133" y="157">96 × 96 gray, TFLM</text><text x="133" y="180">User LED = person</text><text x="133" y="203">until a person</text>
    <text x="455" y="134">camera 324 × 324 RGB</text><text x="455" y="157">JPEG + poses to the PC</text><text x="455" y="180">runs the decoder</text><text x="455" y="203">wakes on a person</text>
    <text x="752" y="134">PoseNet</text><text x="752" y="157">MobileNet v1 0.75</text><text x="752" y="180">17 keypoints</text><text x="752" y="203">per person</text>
  </g>
  <g fill="${ACCENT}" font-size="16" font-weight="700" text-anchor="middle">
    <text x="294" y="110">person</text><text x="616" y="110">frame</text><text x="616" y="200">result</text>
    <text x="294" y="290">no pose for 5 s: back to the M4</text>
  </g>
  <g fill="${TEAL}" font-size="17" font-weight="700">
    <text x="12" y="34">One NXP i.MX RT1176 chip, two cores: they take turns</text>
  </g>
  <path d="M10 46 H850" stroke="${TEAL}" stroke-width="4" stroke-linecap="round"/>`,
'The cascade of the multicore model cascade app: the Cortex-M4 runs a small person detection model on 96 by 96 grayscale frames and sets the User LED. When it finds a person it wakes the Cortex-M7, which captures 324 by 324 color frames, sends them to the computer as JPEG and runs the PoseNet model on the Edge TPU, which finds 17 keypoints per person; the M7 decodes them and sends them to the computer. After 5 seconds without a pose the M7 stops and the M4 searches again');

/* Chapter 3: the path of one window in examples/classify_audio, and the book's extension (dashed). */
const acousticSvg = svgWrap(860, 340, `
  <defs><marker id="caa" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="${INK}"/></marker></defs>
  <g stroke="${INK}" stroke-width="3" fill="none">
    <rect x="8" y="62" width="190" height="128" rx="14" fill="#d8e6f2"/>
    <rect x="228" y="62" width="190" height="128" rx="14" fill="#e6e6e6"/>
    <rect x="448" y="62" width="190" height="128" rx="14" fill="#e7dcf3"/>
    <rect x="668" y="62" width="184" height="128" rx="14" fill="#eef0f4"/>
    <path d="M198 126 H227" marker-end="url(#caa)"/>
    <path d="M418 126 H447" marker-end="url(#caa)"/>
    <path d="M638 126 H667" marker-end="url(#caa)"/>
    <rect x="448" y="236" width="404" height="88" rx="14" fill="#fbeadf" stroke-dasharray="8 6"/>
    <path d="M760 190 V235" stroke-dasharray="7 6" marker-end="url(#caa)"/>
  </g>
  <g fill="${INK}" font-size="20" font-weight="700" text-anchor="middle">
    <text x="103" y="94">1 · Microphone</text><text x="323" y="94">2 · Features</text><text x="543" y="94">3 · YAMNet</text><text x="760" y="94">4 · Threshold</text>
  </g>
  <g fill="${INK}" font-size="16" text-anchor="middle">
    <text x="103" y="124">PDM, 16 kHz</text><text x="103" y="147">latest 975 ms</text><text x="103" y="170">never stops</text>
    <text x="323" y="124">on the Cortex-M7</text><text x="323" y="147">96 frames ×</text><text x="323" y="170">64 bands</text>
    <text x="543" y="124">on the Edge TPU</text><text x="543" y="147">(or the M7)</text><text x="543" y="170">521 class scores</text>
    <text x="760" y="124">score ≥ 0.3</text><text x="760" y="147">top 5, printed</text><text x="760" y="170">on the console</text>
  </g>
  <g fill="${ACCENT}" text-anchor="middle">
    <text x="650" y="266" font-size="18" font-weight="700">5 · Book extension, not in the example</text>
    <text x="650" y="292" font-size="16">threshold per class, persistence, cooldown</text>
    <text x="650" y="314" font-size="16">→ User LED + event log</text>
  </g>
  <g fill="${TEAL}" font-size="17" font-weight="700">
    <text x="12" y="34">Everything runs on the board: no audio leaves it</text>
  </g>
  <g fill="${INK}" font-size="15" text-anchor="middle">
    <text x="214" y="262">Edge TPU build: waits 975 ms,</text><text x="214" y="284">then reads the next window.</text><text x="214" y="306">Audio heard while it computes</text><text x="214" y="328">is in no window.</text>
  </g>
  <path d="M10 46 H850" stroke="${TEAL}" stroke-width="4" stroke-linecap="round"/>`,
'The path of one window in the classify audio example: the PDM microphone records at 16 kilohertz and keeps the latest 975 milliseconds; the Cortex-M7 turns them into 96 frames of 64 bands; YAMNet on the Edge TPU, or on the M7, gives 521 class scores; the classes scoring at least 0.3, at most five, are printed on the console. A dashed fifth box is this book\u2019s extension, not part of the example: a threshold per class, persistence and a cooldown, then the User LED and an event log. The Edge TPU build waits 975 milliseconds between windows, so audio heard while it computes is in no window. Everything runs on the board');

export const CORAL_ACOUSTIC_PAGE = {
  eyebrow: 'CHAPTER 3  ·  MICROPHONE, YAMNET, ALERTS',
  title: ['Listening for trouble:', 'acoustic events with local AI'],
  pageNumber: 5,
  blocks: [
    { type: 'p', text: 'The board has a microphone. Its official audio example names what it hears with YAMNet, a model that knows 521 kinds of sound. This chapter turns a few of them into alerts, and counts how often the alerts are wrong.' },
    { type: 'numbered', items: [
      'Predict: will clinking dishes set off the glass alert?',
      'Experiment: play sounds near and far, with a fan or a TV on.',
      'Understand: follow one 975 ms window to the LED.',
      'Check: tune the thresholds; count false alarms and misses.',
    ] },
    { type: 'h', text: 'THE PATH OF THE SIGNAL' },
    { type: 'svg', svg: acousticSvg, w: 860, h: 340 },
    { type: 'cards', items: [
      { head: 'OFFICIAL EXAMPLE', tone: 'teal', body: 'classify_audio: microphone, features and YAMNet on the board. It prints the classes scoring 0.3 or more.' },
      { head: 'BOOK EXTENSION', tone: 'red', body: 'Alert rules, the User LED and an event log. Written for this book, not part of coralmicro.' },
    ] },
    { type: 'p', text: 'A demonstration, not a security system: how reliably it hears breaking glass has not been measured.' },
  ],
};

export const CORAL_CASCADE_PAGE = {
  eyebrow: 'CHAPTER 2  ·  TWO CORES, TWO MODELS',
  title: ['Wake up the AI:', 'Intelligent pose detection'],
  pageNumber: 3,
  blocks: [
    { type: 'p', text: 'In chapter 1 one small model looked for a person. Here that answer wakes a bigger model that finds the pose of the body: where the head, the arms and the legs are.' },
    { type: 'numbered', items: [
      'Predict: when someone walks in, which core starts working?',
      'Experiment: walk in and out, change the arms and the legs.',
      'Understand: follow each frame from the camera to the computer.',
      'Check: the User LED stays on. Is someone still there?',
    ] },
    { type: 'h', text: 'A CASCADE OF MODELS' },
    { type: 'svg', svg: cascadeSvg, w: 860, h: 330 },
    { type: 'cards', items: [
      { head: 'CORTEX-M4 · 400 MHz', tone: 'teal', body: 'Watches while no one is there, with a tiny model. Says only: person or no person.' },
      { head: 'CORTEX-M7 · EDGE TPU', tone: 'red', body: 'Wakes for a person. Finds 17 body keypoints and sends them to the computer.' },
    ] },
    { type: 'p', text: 'Both models run on the board. The computer only receives the frames and the keypoints the board sends, and draws them.' },
  ],
};

export const CORAL_PRESENCE_PAGE = {
  eyebrow: 'CHAPTER 1  ·  CAMERA, MODEL, LED',
  title: ['How does Coral know', 'someone is there?'],
  pageNumber: 1,
  blocks: [
    { type: 'p', text: 'The Coral Dev Board Micro comes with a person detection demo. Power it, point its camera at a scene, and watch its two green LEDs.' },
    { type: 'numbered', items: [
      'Predict: if someone walks into the image, which light will change?',
      'Experiment: move the person in and out of the camera’s view.',
      'Understand: tap the camera, the Cortex-M7 and the two LEDs.',
      'Check: the camera is on and the User LED is off. What do you know?',
    ] },
    { type: 'h', text: 'ONE CYCLE, OVER AND OVER' },
    { type: 'svg', svg: pipeline, w: 860, h: 250 },
    { type: 'cards', items: [
      { head: 'CAMERA LED', tone: 'teal', body: 'Above the camera. On while the camera captures images, whatever they show.' },
      { head: 'USER LED', tone: 'red', body: 'Near the centre. On when the detector says “person”. It finds presence, not who it is.' },
    ] },
    { type: 'p', text: 'In the LED lesson a program turned an LED on. Here it still does, but the reason comes from a model reading an image.' },
  ],
};
