/*
 * Coral chapter 2 logic: a didactic model of the official app "multicore_model_cascade" of the Dev Board Micro.
 * Pure JavaScript (no DOM, no THREE) so it runs in the page and in Node tests.
 *
 * Checked against the source (google-coral/coralmicro, apps/multicore_model_cascade: README.md,
 * multicore_model_cascade_cm4.cc, multicore_model_cascade_cm7.cc, multicore_model_cascade.py, CMakeLists.txt,
 * requirements.txt; libs/tensorflow/posenet.h, libs/base/led.h, libs/camera/camera.h) and the guide
 * "Get started with the Dev Board Micro", section "Try multi-core model cascading". The behaviour modelled here is
 * the normal build (`multicore_model_cascade`, USB), not the timer-driven "demo" build.
 *
 * What is simulated: both models. Nothing here runs a neural network. The person detector on the M4 is the same
 * stand-in as in chapter 1 (how much of the person is in the frame, and the light). The pose model is a stand-in too:
 * a keypoint counts as found when its point on the figure falls inside the camera's frame, and a pose is reported
 * when the head and the shoulders are in the frame and the room is lit. No confidence value is computed or shown.
 * Stage durations are chosen for the page, not measured; the 5 s and 1 s timers are the app's own.
 */
import { detectorScores, personDetected, lightFactor } from './presence.js';
import { presentMs } from '../../presentation.js';

/** Facts from the app's source and README, used by the page and the tests. */
export const CASCADE = {
  repoPath: 'apps/multicore_model_cascade',
  m4: {
    core: 'Cortex-M4',
    model: '/models/person_detect_model.tflite',
    runtime: 'TensorFlow Lite for Microcontrollers (on the M4, no Edge TPU)',
    input: { w: 96, h: 96, format: 'CameraFormat::kY8', rotation: 'CameraRotation::k270' },
    tensorArenaKb: 136, // kTensorArenaSize = 136 * 1024, in OCRAM
    ops: ['AveragePool2D', 'Conv2D', 'DepthwiseConv2D', 'Reshape', 'Softmax'],
  },
  m7: {
    core: 'Cortex-M7',
    model: '/models/posenet_mobilenet_v1_075_324_324_16_quant_decoder_edgetpu.tflite',
    input: { w: 324, h: 324, format: 'CameraFormat::kRgb' },
    tpuMode: 'PerformanceMode::kMax',
    customOps: ['kCustomOp (Edge TPU)', 'kPosenetDecoderOp (PoseNet decoder)'],
    tensorArenaMb: 2, // kTensorArenaSize = 1024 * 1024 * 2, in SDRAM
    poseThreshold: 0.4, // kThreshold: poses below this overall score are not reported
    jpegQuality: 75,
    port: 27000, // kNetworkPort
    inactiveMs: 5000, // PosenetInactiveForMs(5000): back to the M4 after 5 s without a reported pose
    checkMs: 1000, // vTaskDelay(pdMS_TO_TICKS(1000)) between checks
    logInterval: 15, // kLogInterval: "Poses: N" every 15 inferences, or when the number changes
  },
  client: {
    script: 'apps/multicore_model_cascade/multicore_model_cascade.py',
    requirements: 'Pillow>=9.0.0',
    defaultHost: '10.10.10.1',
    keypointThreshold: 0.2, // update_poses(threshold=0.2): keypoints and edges below it are not drawn
    // The client clears the drawing when no pose arrives for 0.5 s. On a board, poses arrive many times in 0.5 s;
    // on the page one cycle takes M7_CYCLE_MS (more than 0.5 s), so the page checks this timer only when a frame
    // arrives (at the end of each cycle). Between two frames that both have a pose, the drawing stays.
    clearAfterS: 0.5,
    waitingText: 'Waiting for Person Detection',
    waitingDelayS: 2, // the waiting text appears 2 s after the board reports low power
  },
  // demo build (timers instead of results): not modelled, mentioned on the page
  demo: { m4TimerMs: 10000, m7Iterations: 20 },
  leds: {
    status: 'Orange Status LED: the M4 turns it on once its model is loaded (LedSet(Led::kStatus, true)).',
    user: 'Green User LED: the M4 sets it after every frame, LedSet(Led::kUser, person_detected). The M7 never changes it.',
    tpu: 'White Edge TPU LED: the README says it turns on when the M7 starts the pose model; the app\'s code never calls LedSet(Led::kTpu).',
    camera: 'Green Camera LED: shows camera operation (the camera is enabled by the M4, then by the M7, and disabled at each hand-over).',
  },
};

/** The 17 PoseNet keypoints, in the order of libs/tensorflow/posenet.h (KeypointTypes). */
export const KEYPOINTS = [
  'NOSE', 'LEFT_EYE', 'RIGHT_EYE', 'LEFT_EAR', 'RIGHT_EAR', 'LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_ELBOW',
  'RIGHT_ELBOW', 'LEFT_WRIST', 'RIGHT_WRIST', 'LEFT_HIP', 'RIGHT_HIP', 'LEFT_KNEE', 'RIGHT_KNEE', 'LEFT_ANKLE', 'RIGHT_ANKLE',
];
const K = Object.fromEntries(KEYPOINTS.map((n, i) => [n, i]));
/** The 19 connections the official host client draws (EDGES in multicore_model_cascade.py), as index pairs. */
export const EDGES = [
  ['NOSE', 'LEFT_EYE'], ['NOSE', 'RIGHT_EYE'], ['NOSE', 'LEFT_EAR'], ['NOSE', 'RIGHT_EAR'], ['LEFT_EAR', 'LEFT_EYE'],
  ['RIGHT_EAR', 'RIGHT_EYE'], ['LEFT_EYE', 'RIGHT_EYE'], ['LEFT_SHOULDER', 'RIGHT_SHOULDER'], ['LEFT_SHOULDER', 'LEFT_ELBOW'],
  ['LEFT_SHOULDER', 'LEFT_HIP'], ['RIGHT_SHOULDER', 'RIGHT_ELBOW'], ['RIGHT_SHOULDER', 'RIGHT_HIP'], ['LEFT_ELBOW', 'LEFT_WRIST'],
  ['RIGHT_ELBOW', 'RIGHT_WRIST'], ['LEFT_HIP', 'RIGHT_HIP'], ['LEFT_HIP', 'LEFT_KNEE'], ['RIGHT_HIP', 'RIGHT_KNEE'],
  ['LEFT_KNEE', 'LEFT_ANKLE'], ['RIGHT_KNEE', 'RIGHT_ANKLE'],
].map(([a, b]) => [K[a], K[b]]);

export const CASCADE_SOURCES = [
  ['coralmicro app multicore_model_cascade (README and source)', 'https://github.com/google-coral/coralmicro/tree/main/apps/multicore_model_cascade'],
  ['Get started with the Dev Board Micro: Try multi-core model cascading', 'https://coral.ai/docs/dev-board-micro/get-started/'],
  ['coralmicro: libs/tensorflow/posenet.h (17 keypoints)', 'https://github.com/google-coral/coralmicro/blob/main/libs/tensorflow/posenet.h'],
  ['coralmicro: libs/base/led.h (Status, User and Edge TPU LEDs)', 'https://github.com/google-coral/coralmicro/blob/main/libs/base/led.h'],
  ['coralmicro: libs/camera/camera.h (frame formats, rotation)', 'https://github.com/google-coral/coralmicro/blob/main/libs/camera/camera.h'],
  ['coralmicro repository README (clone, setup, build, flash)', 'https://github.com/google-coral/coralmicro'],
  ['3D model: google-coral/mechanicals, dev_board_micro/Dev Board Micro.step (Apache-2.0)', 'https://github.com/google-coral/mechanicals/tree/master/dev_board_micro'],
];

/* ------------------------------------------------------------------ the stand-in pose model */
/**
 * keypoints: 17 projected points { x, y, depth } (x, y in -1..1 inside the frame, y up), in KEYPOINTS order.
 * Returns which keypoints count as found (inside the frame, in front of the lens) and whether a pose is reported.
 * Stand-in rule for "pose score >= 0.4": the nose and both shoulders are found and the room is lit.
 */
export function standInPose(keypoints, light = 1) {
  const found = keypoints.map((q) => q.depth > 0 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1);
  const lit = lightFactor(light) >= 0.5;
  const reported = lit && found[K.NOSE] && found[K.LEFT_SHOULDER] && found[K.RIGHT_SHOULDER];
  return { found: reported ? found : found.map(() => false), reported, count: reported ? found.filter(Boolean).length : 0 };
}
/** Edges the client would draw: both ends found (stand-in for both keypoint scores >= 0.2). */
export const drawnEdges = (found) => EDGES.filter(([a, b]) => found[a] && found[b]);

/* ------------------------------------------------------------------ the cascade */
/**
 * Stages, in the order of the source. Durations are chosen for the page (not measured on a board).
 *   M4 (multicore_model_cascade_cm4.cc, DetectPerson + loop): capture a 96 x 96 Y8 frame, Invoke, compare the scores,
 *     LedSet(kUser, person_detected); if a person: Disable the camera, send an IPC message, suspend.
 *   M7 (multicore_model_cascade_cm7.cc): MainTask captures a 324 x 324 RGB frame, compresses it to JPEG and sends it,
 *     gives the frame to the PoseNet task, which runs the model on the Edge TPU, decodes the poses and sends them as
 *     JSON when there is at least one. Main checks once a second; after 5 s without a pose it stops the camera and
 *     sends an IPC message back to the M4.
 */
// Base page times, scaled by PRESENTATION.stageScale (src/presentation.js) so each step can be followed.
// The app's own timers (5 s without a pose, a check every 1 s) are hardware times and are not scaled.
export const M4_STAGES = [
  { id: 'm4capture', ms: presentMs(140) },
  { id: 'm4infer', ms: presentMs(260) },
  { id: 'm4decide', ms: presentMs(100) },
];
export const M7_STAGES = [
  { id: 'm7capture', ms: presentMs(140) },
  { id: 'm7jpeg', ms: presentMs(120) },
  { id: 'tpu', ms: presentMs(220) },
  { id: 'decode', ms: presentMs(120) },
  { id: 'send', ms: presentMs(120) },
];
export const HANDOFF_MS = presentMs(360); // shown as one step: camera disabled, IPC message, the other core resumes
/** One M7 cycle on the page (capture to pose sent). A real board runs many cycles a second. */
export const M7_CYCLE_MS = M7_STAGES.reduce((s, x) => s + x.ms, 0);

export class CascadeSim {
  /**
   * measure() -> { share, light, keypoints } is read when a frame is captured (the frame the model will see).
   */
  constructor(measure) {
    this.measure = measure;
    this.reset();
  }
  reset() {
    this.powered = true;
    this.core = 'm4'; // 'm4' | 'toM7' | 'm7' | 'toM4'
    this.stage = 0;
    this.t = 0;
    this.timeMs = 0; // simulated time since power-on
    this.frame = null;
    this.scores = { evidence: 0, person: -100, noPerson: 100 };
    this.statusLed = true; // M4: model loaded -> LedSet(kStatus, true)
    this.userLed = false;
    this.cameraOn = true; // M4: Enable(CameraMode::kStreaming)
    this.tpuActive = false; // the white LED, as the README describes it
    this.lowPower = true; // the value the M7 sends to the client (kLowPowerChange)
    this.pose = { found: Array(17).fill(false), reported: false, count: 0 };
    this.lastPoseAt = 0; // last time pose data was sent (NetworkTask::Send(kMessageTypePoseData))
    this.nextCheckAt = 0;
    this.m7Inferences = 0; // PosenetTask counter_
    this.lastPoseCount = 0; // PosenetTask num_poses_
    this.m4Frames = 0;
    this.handoffs = { toM7: 0, toM4: 0 };
    this.log = [];
    this.events = [];
    this.say('Multicore Model Cascade!');
    this.say(`INFO: Waiting for clients on ${CASCADE.m7.port}...`);
    this.say('Posenet task started');
    this.say('M4 Started, detecting person...');
    this.capture();
  }
  say(text) {
    this.log.push({ t: this.timeMs, text });
  }
  get stages() {
    return this.core === 'm7' ? M7_STAGES : M4_STAGES;
  }
  get stageId() {
    if (this.core === 'toM7' || this.core === 'toM4') return 'handoff';
    return this.stages[this.stage].id;
  }
  /** Fraction of the current stage done (for the animation). */
  stageProgress() {
    const ms = this.core === 'toM7' || this.core === 'toM4' ? HANDOFF_MS : this.stages[this.stage].ms;
    return Math.min(1, this.t / ms);
  }
  /** Milliseconds since the last pose was sent (only meaningful while the M7 runs). */
  get msWithoutPose() {
    return this.timeMs - this.lastPoseAt;
  }
  capture() {
    this.frame = this.measure();
    // the M7's camera frame: the page takes its picture now, so the image and the keypoints are of the same moment
    if (this.core === 'm7') this.events.push({ type: 'capture', t: this.timeMs });
  }
  step(dtMs) {
    if (!this.powered) return;
    let left = dtMs;
    // advance in small slices so the 1 s checks happen at the right simulated time
    while (left > 0) {
      const d = Math.min(left, 20);
      left -= d;
      this.timeMs += d;
      this.t += d;
      this.advance();
      if (this.core === 'm7' && this.timeMs >= this.nextCheckAt) this.check();
    }
  }
  advance() {
    for (;;) {
      if (this.core === 'toM7' || this.core === 'toM4') {
        if (this.t < HANDOFF_MS) return;
        this.t -= HANDOFF_MS;
        if (this.core === 'toM7') this.startM7();
        else this.startM4();
        continue;
      }
      const st = this.stages[this.stage];
      if (this.t < st.ms) return;
      this.t -= st.ms;
      this.finish(st.id);
      if (this.core === 'toM7' || this.core === 'toM4') continue;
      this.stage = (this.stage + 1) % this.stages.length;
      if (this.stage === 0) this.capture();
    }
  }
  finish(id) {
    if (id === 'm4infer') this.scores = detectorScores(this.frame.share, this.frame.light);
    if (id === 'm4decide') {
      const on = personDetected(this.scores);
      this.say(`person_score: ${this.scores.person} no_person_score: ${this.scores.noPerson}`);
      if (on !== this.userLed) this.events.push({ type: 'userLed', on, t: this.timeMs });
      this.userLed = on; // LedSet(Led::kUser, person_detected)
      this.m4Frames++;
      if (on) {
        // the normal build hands over as soon as a person is detected
        this.say('Person detected, let M7 take over.');
        this.cameraOn = false; // CameraTask::GetSingleton()->Disable()
        this.say('M4 stopped');
        this.core = 'toM7';
        this.t = 0;
        this.handoffs.toM7++;
        this.events.push({ type: 'handoff', to: 'm7', t: this.timeMs });
      }
    }
    if (id === 'decode') {
      this.pose = standInPose(this.frame.keypoints, this.frame.light);
      this.m7Inferences++;
      const n = this.pose.reported ? 1 : 0;
      if (n !== this.lastPoseCount || this.m7Inferences % CASCADE.m7.logInterval === 0) this.say(`Poses: ${n}`);
      this.lastPoseCount = n;
    }
    if (id === 'm7jpeg') this.events.push({ type: 'frame', t: this.timeMs }); // the JPEG goes to the client
    if (id === 'send' && this.pose.reported) {
      this.lastPoseAt = this.timeMs; // pose JSON sent: the 5 s timer starts again
      // the event carries its own frame: by the time it is read, the next frame may already be captured
      this.events.push({ type: 'pose', t: this.timeMs, count: this.pose.count, keypoints: this.frame.keypoints, found: [...this.pose.found] });
    }
    // end of the cycle: the client has this frame's image and, if there was one, its pose. The page shows both
    // together (presentation), so the drawing always belongs to the image under it.
    if (id === 'send') this.events.push({ type: 'cycle', t: this.timeMs, reported: this.pose.reported, keypoints: this.frame.keypoints, found: [...this.pose.found] });
  }
  startM7() {
    this.core = 'm7';
    this.stage = 0;
    this.lowPower = false; // network_task.Send(kLowPowerChange, false)
    this.lastPoseAt = this.timeMs; // ResetPosenetTimer()
    this.nextCheckAt = this.timeMs + CASCADE.m7.checkMs;
    this.cameraOn = true; // MainTask kCmdStart: Enable(CameraMode::kStreaming)
    this.tpuActive = true;
    this.lastPoseCount = 0;
    this.pose = { found: Array(17).fill(false), reported: false, count: 0 };
    this.say('M7 Main Task: started');
    this.capture();
  }
  check() {
    this.nextCheckAt += CASCADE.m7.checkMs;
    if (this.timeMs - this.lastPoseAt > CASCADE.m7.inactiveMs) {
      this.say('No poses detected for 5 seconds');
      this.lowPower = true;
      this.cameraOn = false; // MainTask kCmdStop: Disable()
      this.tpuActive = false;
      this.pose = { found: Array(17).fill(false), reported: false, count: 0 };
      this.say('M7 Main Task: stopped');
      this.core = 'toM4';
      this.t = 0;
      this.handoffs.toM4++;
      this.events.push({ type: 'handoff', to: 'm4', t: this.timeMs });
    }
  }
  startM4() {
    this.core = 'm4';
    this.stage = 0;
    this.cameraOn = true;
    this.say('M4 Started, detecting person...');
    this.capture();
  }
}
