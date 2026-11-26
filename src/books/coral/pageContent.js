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
