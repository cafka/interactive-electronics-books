/*
 * Coral chapter 3 logic: acoustic event monitoring, the way the official example examples/classify_audio does it,
 * plus a teaching extension (alert rules and an event log) that is NOT part of coralmicro.
 * Pure JavaScript (no DOM, no THREE) so it runs in the page and in Node tests.
 *
 * Checked against google-coral/coralmicro: examples/classify_audio (classify_audio.cc, CMakeLists.txt),
 * libs/tensorflow/audio_models.h / .cc, libs/tensorflow/classification.cc, libs/audio/audio_driver.h /
 * audio_service.h, and the YAMNet class map (tensorflow/models, research/audioset/yamnet/yamnet_class_map.csv).
 *
 * What is computed for real here: the audio features. Each 975 ms window of 16 kHz audio becomes 96 frames of
 * 64 log mel energies (25 ms window, 10 ms step, 125..7500 Hz), the same layout the example feeds to YAMNet.
 * The numbers are not bit-exact with the TensorFlow Lite Micro frontend (different FFT, filter and scaling details).
 * What is simulated: the sounds (synthesised, not recorded) and the classifier. The classifier is a small
 * hand-written scorer over a few spectral measurements, not YAMNet and not a neural network. Its scores are not
 * YAMNet scores and say nothing about how well YAMNet or a real device would do.
 */

/** Facts from the official example and libraries (sources in ACOUSTIC_SOURCES). */
export const ACOUSTIC = {
  example: 'examples/classify_audio',
  mic: 'on-board PDM microphone, read by the audio driver through DMA',
  sampleRates: [16000, 48000], // AudioSampleRate::k16000_Hz, k48000_Hz
  sampleRate: 16000, // kYamnetSampleRate
  windowMs: 975, // kYamnetDurationMs
  windowSamples: 15600, // kYamnetAudioSize = 16000 * 975 / 1000
  frameMs: 25, // kYamnetFeatureSliceDurationMs
  hopMs: 10, // kYamnetFeatureSliceStrideMs
  bands: 64, // kYamnetFeatureSliceSize
  frames: 96, // kYamnetFeatureSliceCount
  lowHz: 125, // filterbank.lower_band_limit
  highHz: 7500, // filterbank.upper_band_limit
  threshold: 0.3, // kThreshold
  topK: 5, // kTopK
  classes: 521,
  dmaBuffers: 2, // kNumDmaBuffers
  dmaBufferMs: 50, // kDmaBufferSizeMs
  dropFirstMs: 150, // kDropFirstSamplesMs
  tpuModel: '/models/yamnet_spectra_in_edgetpu.tflite',
  cpuModel: '/models/yamnet_spectra_in.tflite',
  testAudio: '/models/yamnet_test_audio.bin',
  tensorArenaMb: 1, // kTensorArenaSize = 1 * 1024 * 1024
  tpuOps: ['Quantize', 'Dequantize', 'Edge TPU custom op'],
  cpuOps: ['Quantize', 'Dequantize', 'Reshape', 'Split', 'Conv2D', 'DepthwiseConv2D', 'Logistic', 'Mean', 'FullyConnected'],
  core: 'Cortex-M7', // add_executable_m7(classify_audio ...)
  sampleShift: 16, // audio_input[i] = samples[i] >> 16 (32-bit driver samples to 16-bit)
};

export const ACOUSTIC_SOURCES = [
  ['coralmicro example classify_audio (YAMNet, Edge TPU or CPU)', 'https://github.com/google-coral/coralmicro/tree/main/examples/classify_audio'],
  ['coralmicro: libs/tensorflow/audio_models.h and .cc (frontend settings, YAMNet ops)', 'https://github.com/google-coral/coralmicro/blob/main/libs/tensorflow/audio_models.h'],
  ['coralmicro: libs/audio/audio_driver.h and audio_service.h (PDM microphone, 16 / 48 kHz)', 'https://github.com/google-coral/coralmicro/blob/main/libs/audio/audio_driver.h'],
  ['coralmicro: libs/tensorflow/classification.cc (threshold and top-k)', 'https://github.com/google-coral/coralmicro/blob/main/libs/tensorflow/classification.cc'],
  ['YAMNet class map (521 AudioSet classes)', 'https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv'],
  ['YAMNet model page', 'https://tfhub.dev/google/yamnet/1'],
  ['Get started with the Dev Board Micro (hardware, flashing, troubleshooting)', 'https://coral.ai/docs/dev-board-micro/get-started/'],
  ['coralmicro examples tflm_micro_speech (TFLM on the M7) and classify_speech (Edge TPU)', 'https://github.com/google-coral/coralmicro/tree/main/examples'],
];

/** YAMNet classes this chapter talks about, with their index in the official class map. */
export const YAMNET = {
  Speech: 0, Clapping: 58, Applause: 62, Music: 132, Door: 348, Slam: 352, Knock: 353, 'Dishes, pots, and pans': 358,
  Alarm: 382, 'Smoke detector, smoke alarm': 393, 'Fire alarm': 394, Siren: 390, Beep: 475, Glass: 435, 'Chink, clink': 436,
  Shatter: 437, 'Smash, crash': 463, Breaking: 464, 'Thump, thud': 454, Silence: 494,
};

/** The demonstration classifier's classes, each tied to the YAMNet classes a real program would read. */
export const CLASSES = [
  { id: 'clap', name: 'Clapping', yamnet: ['Clapping', 'Applause'], alert: true },
  { id: 'knock', name: 'Knock', yamnet: ['Knock', 'Thump, thud'], alert: true },
  { id: 'glass', name: 'Glass breaking', yamnet: ['Shatter', 'Glass', 'Breaking'], alert: true },
  { id: 'alarm', name: 'Alarm', yamnet: ['Smoke detector, smoke alarm', 'Alarm', 'Fire alarm'], alert: true },
  { id: 'speech', name: 'Speech', yamnet: ['Speech'], alert: false },
  { id: 'music', name: 'Music', yamnet: ['Music'], alert: false },
  { id: 'silence', name: 'Silence', yamnet: ['Silence'], alert: false },
];
export const ALERT_CLASSES = CLASSES.filter((c) => c.alert).map((c) => c.id);

/** Sounds the page can play into the microphone. target: the class a correct detector should report (or null). */
export const SOUNDS = {
  clap: { label: 'Two claps', target: 'clap', ms: 520 },
  knock: { label: 'Knock on a door', target: 'knock', ms: 620 },
  glass: { label: 'Glass breaking', target: 'glass', ms: 760 },
  alarm: { label: 'Smoke alarm beeping', target: 'alarm', ms: 2900 },
  slam: { label: 'Door slam', target: null, ms: 420 },
  dishes: { label: 'Dishes clinking', target: null, ms: 360 },
  beeps: { label: 'Microwave beeps', target: null, ms: 900 },
  speech: { label: 'Someone talking', target: null, ms: 1900 },
  music: { label: 'Music', target: null, ms: 2900 },
};
export const BACKGROUNDS = {
  quiet: { label: 'Quiet room', level: 0.004 },
  fan: { label: 'Fan running', level: 0.028 },
  tv: { label: 'TV in the next room', level: 0.022 },
};

/* ------------------------------------------------------------------ deterministic random numbers */
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ synthesised sounds (16 kHz) */
const FS = ACOUSTIC.sampleRate;
const TAU = Math.PI * 2;
/** One-pole filters, enough to colour noise. */
function lowpass(x, fc) {
  const a = Math.exp((-TAU * fc) / FS);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y = (1 - a) * x[i] + a * y;
  return x;
}
function highpass(x, fc) {
  const lp = lowpass(Float32Array.from(x), fc);
  for (let i = 0; i < x.length; i++) x[i] -= lp[i];
  return x;
}
const decayAt = (t, tau) => Math.exp(-t / tau);
function addTone(out, start, f, amp, tau, len, phase = 0) {
  const n0 = Math.round(start * FS), n = Math.round(len * FS);
  for (let i = 0; i < n && n0 + i < out.length; i++) {
    const t = i / FS;
    out[n0 + i] += amp * Math.sin(TAU * f * t + phase) * decayAt(t, tau) * Math.min(1, t * 2000);
  }
}
function addBurst(out, start, amp, tau, len, r, band = [0, 8000]) {
  const n0 = Math.round(start * FS), n = Math.round(len * FS);
  let seg = new Float32Array(n);
  for (let i = 0; i < n; i++) seg[i] = r() * 2 - 1;
  if (band[0] > 0) seg = highpass(seg, band[0]);
  if (band[1] < 8000) seg = lowpass(seg, band[1]);
  for (let i = 0; i < n && n0 + i < out.length; i++) out[n0 + i] += amp * seg[i] * decayAt(i / FS, tau);
}

/** A sound as 16 kHz samples (about -1..1 at level 1). */
export function synth(kind, { level = 1, seed = 1 } = {}) {
  const r = rng(seed * 7919 + kind.length * 131);
  const out = new Float32Array(Math.round((SOUNDS[kind].ms / 1000) * FS));
  if (kind === 'clap') {
    for (const t0 of [0, 0.3]) addBurst(out, t0, 0.9, 0.012, 0.09, r, [900, 5000]);
  } else if (kind === 'knock') {
    for (const t0 of [0, 0.19, 0.38]) {
      addTone(out, t0, 210 + r() * 20, 0.55, 0.035, 0.14);
      addTone(out, t0, 470 + r() * 30, 0.3, 0.025, 0.12);
      addBurst(out, t0, 0.18, 0.004, 0.02, r, [600, 3000]);
    }
  } else if (kind === 'slam') {
    addTone(out, 0, 75, 0.9, 0.11, 0.42);
    addTone(out, 0, 130, 0.45, 0.07, 0.3);
    addBurst(out, 0, 0.5, 0.05, 0.4, r, [0, 900]);
  } else if (kind === 'glass') {
    addBurst(out, 0, 0.8, 0.045, 0.25, r, [2000, 8000]);
    for (let k = 0; k < 26; k++) {
      const t0 = r() * 0.55, f = 2600 + r() * 4600;
      addTone(out, t0, f, 0.12 + r() * 0.16, 0.03 + r() * 0.12, 0.2, r() * TAU);
    }
    for (let k = 0; k < 5; k++) addBurst(out, 0.1 + r() * 0.5, 0.25, 0.01, 0.04, r, [3000, 8000]);
  } else if (kind === 'dishes') {
    for (const [t0, f] of [[0, 3150], [0.17, 4180]]) {
      addTone(out, t0, f, 0.5, 0.06, 0.18);
      addTone(out, t0, f * 2.71, 0.16, 0.035, 0.12);
    }
  } else if (kind === 'alarm') {
    for (let t0 = 0; t0 < 2.8; t0 += 1.0) for (let h = 1; h <= 3; h++) addTone(out, t0, 3100 * h > 7900 ? 0 : 3100 * h, 0.5 / h, 10, 0.5);
  } else if (kind === 'beeps') {
    for (const t0 of [0, 0.3, 0.6]) addTone(out, t0, 1000, 0.5, 10, 0.16);
  } else if (kind === 'speech') {
    // a voice-like signal: pitch pulses shaped by vowel formants, syllables about 4 a second
    const formants = [[700, 1200], [400, 2000], [600, 1000], [300, 2300]];
    for (let i = 0; i < out.length; i++) {
      const t = i / FS, syl = Math.floor(t * 4.2), [f1, f2] = formants[syl % 4];
      const env = Math.max(0, Math.sin(Math.PI * ((t * 4.2) % 1))) ** 1.5;
      const f0 = 120 + 15 * Math.sin(TAU * 0.7 * t);
      let s = 0;
      for (let h = 1; h * f0 < 3500; h++) {
        const f = h * f0, g = Math.exp(-(((f - f1) / 160) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 220) ** 2)) + 0.05;
        s += g * Math.sin(TAU * f * t) / Math.sqrt(h);
      }
      out[i] = 0.22 * env * s;
    }
  } else if (kind === 'music') {
    const chords = [[262, 330, 392], [220, 277, 330], [196, 247, 294]];
    for (let i = 0; i < out.length; i++) {
      const t = i / FS, c = chords[Math.floor(t / 1.0) % 3], tn = t % 1.0;
      let s = 0;
      for (const f of c) for (let h = 1; h <= 4; h++) s += Math.sin(TAU * f * h * t) / (h * h);
      out[i] = 0.14 * s * (0.4 + 0.6 * Math.exp(-tn * 2.5)) * Math.min(1, tn * 40);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] *= level;
  return out;
}

/** Background noise for `n` samples, starting at sample `offset` of an endless stream (so windows join up). */
export function background(kind, n, offset = 0, seed = 1) {
  const bg = BACKGROUNDS[kind] || BACKGROUNDS.quiet;
  const r = rng(seed * 104729 + Math.floor(offset / 1600));
  const pad = 400;
  const x = new Float32Array(n + pad);
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  if (kind === 'fan') {
    lowpass(x, 1500);
    for (let i = 0; i < x.length; i++) x[i] = x[i] * 2.2 + 0.35 * Math.sin((TAU * 100 * (offset + i)) / FS);
  } else if (kind === 'tv') {
    lowpass(x, 3000);
    for (let i = 0; i < x.length; i++) {
      const t = (offset + i) / FS;
      x[i] = x[i] * 0.9 + 0.8 * Math.sin(TAU * 180 * t) * Math.max(0, Math.sin(TAU * 3.7 * t)) + 0.5 * Math.sin(TAU * 330 * t) * Math.max(0, Math.sin(TAU * 2.3 * t + 1));
    }
  } else lowpass(x, 4000);
  const out = x.subarray(pad);
  for (let i = 0; i < n; i++) out[i] *= bg.level;
  return out;
}

/* ------------------------------------------------------------------ audio features (log mel spectrogram) */
const NFFT = 512;
const FRAME = Math.round((ACOUSTIC.frameMs / 1000) * FS); // 400
const HOP = Math.round((ACOUSTIC.hopMs / 1000) * FS); // 160
const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / (FRAME - 1)));
const mel = (f) => 2595 * Math.log10(1 + f / 700);
const imel = (m) => 700 * (10 ** (m / 2595) - 1);
/** Triangular mel filters: 64 bands, 125..7500 Hz (the example's settings). */
const FILTERS = (() => {
  const m0 = mel(ACOUSTIC.lowHz), m1 = mel(ACOUSTIC.highHz);
  const edges = Array.from({ length: ACOUSTIC.bands + 2 }, (_, i) => imel(m0 + ((m1 - m0) * i) / (ACOUSTIC.bands + 1)));
  const binHz = FS / NFFT;
  return Array.from({ length: ACOUSTIC.bands }, (_, b) => {
    const [lo, c, hi] = [edges[b], edges[b + 1], edges[b + 2]];
    const w = [];
    for (let k = Math.floor(lo / binHz); k <= Math.ceil(hi / binHz) && k <= NFFT / 2; k++) {
      const f = k * binHz;
      const v = f <= c ? (f - lo) / (c - lo) : (hi - f) / (hi - c);
      if (v > 0) w.push([k, v]);
    }
    return w;
  });
})();
/** Centre frequency of each band (Hz). */
export const BAND_HZ = (() => {
  const m0 = mel(ACOUSTIC.lowHz), m1 = mel(ACOUSTIC.highHz);
  return Array.from({ length: ACOUSTIC.bands }, (_, b) => imel(m0 + ((m1 - m0) * (b + 1)) / (ACOUSTIC.bands + 1)));
})();
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
/** 975 ms of samples -> 96 frames x 64 bands of natural-log mel energy. */
export function logMel(samples) {
  const frames = [];
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  for (let f = 0; f < ACOUSTIC.frames; f++) {
    re.fill(0);
    im.fill(0);
    const s0 = f * HOP;
    for (let i = 0; i < FRAME; i++) re[i] = (samples[s0 + i] || 0) * hann[i];
    fft(re, im);
    const row = new Float32Array(ACOUSTIC.bands);
    for (let b = 0; b < ACOUSTIC.bands; b++) {
      let e = 0;
      for (const [k, v] of FILTERS[b]) e += v * (re[k] * re[k] + im[k] * im[k]);
      row[b] = Math.log(e + 1e-6);
    }
    frames.push(row);
  }
  return frames;
}

/* ------------------------------------------------------------------ the demonstration classifier */
const bandBelow = (hz) => BAND_HZ.findIndex((f) => f >= hz);
const B500 = bandBelow(500), B1500 = bandBelow(1500), B2500 = bandBelow(2500), B4000 = bandBelow(4000);
const sig = (x) => 1 / (1 + Math.exp(-x));
const percentile = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
/**
 * A few measurements of a window, all readable on the page:
 *   peak      how far the loudest frame rises above the room (the quietest tenth of the window), in log units
 *   activeMs  how long the sound stays clearly above the typical level
 *   onset     the largest rise from one frame to the next (sharp attack)
 *   low, mid, high  share of the sound's energy below 500 Hz, 500..2500 Hz, above 4 kHz (active frames only)
 *   tonal     how much one band stands out from the others (a pure tone is high, a noise burst low)
 *   steady    how often the loudest band stays the same from frame to frame
 *   modeShare how many loud frames have the usual loudest band (a single tone is near 1)
 *   bursts    how many separate loud parts the window has
 */
export function measure(features) {
  const E = features.map((row) => {
    let m = -Infinity;
    for (const v of row) m = Math.max(m, v);
    let s = 0;
    for (const v of row) s += Math.exp(v - m);
    return m + Math.log(s);
  });
  // the room's level: the quietest tenth of the window (a long sound would raise the median)
  const base = percentile(E, 0.1), top = Math.max(...E), peak = top - base;
  const thr = base + Math.max(1.2, peak * 0.45);
  const active = E.map((e) => e > thr);
  const activeFrames = active.filter(Boolean).length;
  let onset = 0, bursts = 0;
  for (let t = 1; t < E.length; t++) {
    onset = Math.max(onset, E[t] - E[t - 1]);
    if (active[t] && !active[t - 1]) bursts++;
  }
  if (active[0]) bursts++;
  let lo = 0, mi = 0, hi = 0, tot = 0, tonal = 0, steadyN = 0, prevArg = -1;
  const args = [];
  for (let t = 0; t < features.length; t++) {
    if (!active[t]) continue;
    const row = features[t];
    let arg = 0, mx = -Infinity, sumLog = 0;
    for (let b = 0; b < row.length; b++) {
      const e = Math.exp(row[b] - E[t]);
      tot += e;
      if (b < B500) lo += e;
      else if (b < B2500 && b >= B500) mi += e;
      if (b >= B4000) hi += e;
      if (row[b] > mx) {
        mx = row[b];
        arg = b;
      }
      sumLog += row[b];
    }
    tonal += mx - sumLog / row.length;
    if (prevArg >= 0 && Math.abs(arg - prevArg) <= 1) steadyN++;
    prevArg = arg;
    args.push(arg);
  }
  const n = Math.max(1, activeFrames);
  // share of the loud frames whose loudest band is the usual one (within one band): about 1 for a single tone
  const counts = new Array(ACOUSTIC.bands).fill(0);
  for (const a of args) counts[a]++;
  let modeShare = 0;
  for (let b = 0; b < counts.length; b++) modeShare = Math.max(modeShare, (counts[b - 1] || 0) + counts[b] + (counts[b + 1] || 0));
  modeShare = args.length ? modeShare / args.length : 0;
  return {
    peak, activeMs: activeFrames * ACOUSTIC.hopMs, onset, bursts,
    low: tot ? lo / tot : 0, mid: tot ? mi / tot : 0, high: tot ? hi / tot : 0,
    tonal: tonal / n, steady: activeFrames > 1 ? steadyN / (activeFrames - 1) : 0, modeShare,
    loudness: top, base,
  };
}
/**
 * Scores (0..1, one per class, like YAMNet's independent class scores) from the measurements. Hand-written
 * rules, deliberately simple: they show why short clinks look like glass and slams like knocks. Not YAMNet.
 */
export function classify(features) {
  const m = measure(features);
  const loud = sig((m.peak - 2.2) * 2.2); // a sound clearly above the room
  const short = sig((260 - m.activeMs) / 60), long = sig((m.activeMs - 300) / 90);
  const impulsive = sig((m.onset - 1.6) * 2.5);
  const tonal = sig((m.tonal - 5.5) * 1.4), noisy = 1 - tonal;
  const s = {
    clap: loud * impulsive * short * noisy * sig((m.mid + m.high - 0.5) * 8) * sig((0.7 - m.high) * 9) * sig((m.bursts - 1.5) * 3 + 1.5),
    knock: loud * impulsive * sig((m.low - 0.72) * 12) * sig((m.bursts - 1.5) * 3) * sig((0.25 - m.high) * 12),
    glass: loud * impulsive * sig((m.high - 0.35) * 9) * sig((m.activeMs - 120) / 60) * sig((9.5 - m.tonal) * 0.9),
    alarm: loud * tonal * sig((m.steady - 0.6) * 9) * sig((m.modeShare - 0.72) * 14) * long,
    speech: loud * long * sig((m.mid - 0.45) * 7) * sig((0.75 - m.steady) * 6) * sig((0.2 - m.high) * 10),
    music: loud * long * tonal * sig((m.low + m.mid - 0.7) * 8) * sig((0.85 - m.steady) * 5),
    silence: 1 - loud,
  };
  // a tone below about 2 kHz is not a smoke alarm: keep the alarm score for high steady tones
  s.alarm *= sig((dominantHz(features, m) - 2000) / 250);
  for (const k of Object.keys(s)) s[k] = Math.max(0, Math.min(1, s[k]));
  return { scores: s, m };
}
/** Frequency (Hz) of the band that is loudest most often during the active frames. */
export function dominantHz(features, m = measure(features)) {
  const count = new Array(ACOUSTIC.bands).fill(0);
  for (const row of features) {
    let e = -Infinity;
    for (const v of row) e = Math.max(e, v);
    if (e < m.base + 1.2) continue;
    count[row.indexOf(e)]++;
  }
  const best = count.indexOf(Math.max(...count));
  return BAND_HZ[best];
}
/** Classes at or above a threshold, best first, at most k (GetClassificationResults(threshold, top_k)). */
export function topResults(scores, threshold = ACOUSTIC.threshold, k = ACOUSTIC.topK) {
  return Object.entries(scores).filter(([, v]) => v >= threshold).sort((a, b) => b[1] - a[1]).slice(0, k).map(([id, score]) => ({ id, score }));
}

/* ------------------------------------------------------------------ the sound stream and its windows */
/**
 * A stream of audio: background noise plus sounds placed at given times, cut into back-to-back 975 ms windows
 * (the board reads the latest 975 ms, analyses it, waits 975 ms on the Edge TPU build, and reads again).
 * events: [{ kind, at (ms), level, distance (m), seed }]
 */
export function windowSamples(index, scene) {
  return windowSamplesAt(index * ACOUSTIC.windowMs, scene);
}
/** The 975 ms of audio that start at `startMs` of the stream. */
export function windowSamplesAt(startMs, { bg = 'quiet', events = [], seed = 1 }) {
  const n = ACOUSTIC.windowSamples, start = Math.round((startMs / 1000) * FS);
  const out = background(bg, n, start, seed);
  for (const ev of events) {
    const s0 = Math.round((ev.at / 1000) * FS) - start;
    const len = Math.round((SOUNDS[ev.kind].ms / 1000) * FS);
    if (s0 >= n || s0 + len <= 0) continue;
    const gain = (ev.level ?? 1) / Math.max(0.5, ev.distance ?? 1);
    const snd = ev._cache ??= synth(ev.kind, { level: 1, seed: ev.seed ?? 1 });
    for (let i = Math.max(0, -s0); i < len && s0 + i < n; i++) out[s0 + i] += gain * snd[i];
  }
  return out;
}
/** Which event targets are in a window: an event counts in the windows that hold at least 30 % of its length. */
export function truthOf(index, events) {
  return truthAt(index * ACOUSTIC.windowMs, events);
}
export function truthAt(startMs, events) {
  const w0 = startMs, w1 = w0 + ACOUSTIC.windowMs;
  const set = new Set();
  for (const ev of events) {
    const t = SOUNDS[ev.kind].target;
    if (!t) continue;
    const a = Math.max(w0, ev.at), b = Math.min(w1, ev.at + SOUNDS[ev.kind].ms);
    if (b - a >= 0.3 * Math.min(SOUNDS[ev.kind].ms, ACOUSTIC.windowMs)) set.add(t);
  }
  return set;
}

/* ------------------------------------------------------------------ teaching extension: alert rules */
/**
 * Not in coralmicro. What a monitoring program could add after the example's classification step:
 *   threshold per class    an alert class must reach its own threshold (the example uses one, 0.3, for printing);
 *   persistence k of n     the class must pass in k of the last n windows (long sounds such as alarms);
 *   cooldown               after an alert, the same class stays quiet for a while (one event, one alert).
 */
export const DEFAULT_RULES = {
  clap: { threshold: 0.5, k: 1, n: 1, cooldownMs: 2000, enabled: true },
  knock: { threshold: 0.5, k: 1, n: 1, cooldownMs: 2000, enabled: true },
  glass: { threshold: 0.5, k: 1, n: 1, cooldownMs: 4000, enabled: true },
  alarm: { threshold: 0.5, k: 2, n: 3, cooldownMs: 6000, enabled: true },
};
export function cloneRules(r = DEFAULT_RULES) {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v }]));
}
export class AlertRules {
  constructor(rules = DEFAULT_RULES) {
    this.rules = cloneRules(rules);
    this.reset();
  }
  reset() {
    this.history = Object.fromEntries(ALERT_CLASSES.map((c) => [c, []]));
    this.lastAlert = Object.fromEntries(ALERT_CLASSES.map((c) => [c, -1e12]));
  }
  /** One window's scores at time tMs (end of the window). Returns the alerts raised: [{ id, score }]. */
  step(scores, tMs) {
    const out = [];
    for (const id of ALERT_CLASSES) {
      const r = this.rules[id];
      const h = this.history[id];
      h.push(scores[id] >= r.threshold);
      while (h.length > r.n) h.shift();
      const passes = h.filter(Boolean).length;
      if (!r.enabled || passes < r.k || !h[h.length - 1]) continue;
      if (tMs - this.lastAlert[id] < r.cooldownMs) continue;
      this.lastAlert[id] = tMs;
      out.push({ id, score: scores[id] });
    }
    return out;
  }
}

/**
 * Runs a whole scene offline (no time passes): windows, scores, alerts, and the outcome against the truth.
 * Returns { windows: [{ index, scores, top, alerts, truth }], outcome: { tp, fp, fn, perClass } }.
 */
export function runScene(scene, rules = DEFAULT_RULES) {
  // the scores do not depend on the rules: computed once per scene and kept with it
  if (!scene._scored) {
    const lastMs = Math.max(ACOUSTIC.windowMs * 3, ...scene.events.map((e) => e.at + SOUNDS[e.kind].ms)) + ACOUSTIC.windowMs * 3;
    const count = Math.ceil(lastMs / ACOUSTIC.windowMs);
    scene._scored = Array.from({ length: count }, (_, i) => ({ index: i, scores: classify(logMel(windowSamples(i, scene))).scores, truth: truthOf(i, scene.events) }));
  }
  const ar = new AlertRules(rules);
  const windows = scene._scored.map((w) => ({ ...w, top: topResults(w.scores), alerts: ar.step(w.scores, (w.index + 1) * ACOUSTIC.windowMs) }));
  return { windows, outcome: judge(windows, scene.events) };
}
/**
 * Outcome per alert class: an event is found (true positive) when an alert of its class comes in one of its
 * windows or the two after it (persistence needs time); an alert with no such event is a false alarm (false
 * positive); an event with no alert is missed (false negative).
 */
export function judge(windows, events) {
  const perClass = Object.fromEntries(ALERT_CLASSES.map((c) => [c, { tp: 0, fp: 0, fn: 0 }]));
  const used = new Set();
  const evWins = events.filter((e) => SOUNDS[e.kind].target).map((e) => {
    const first = Math.floor(e.at / ACOUSTIC.windowMs), last = Math.floor((e.at + SOUNDS[e.kind].ms) / ACOUSTIC.windowMs) + 2;
    return { e, cls: SOUNDS[e.kind].target, first, last, found: false };
  });
  windows.forEach((w) => w.alerts.forEach((a, j) => {
    const match = evWins.find((x) => x.cls === a.id && w.index >= x.first && w.index <= x.last);
    if (match) {
      if (!match.found) {
        match.found = true;
        perClass[a.id].tp++;
      }
      used.add(`${w.index}:${j}`);
    } else perClass[a.id].fp++;
  }));
  for (const x of evWins) if (!x.found) perClass[x.cls].fn++;
  const sum = (k) => Object.values(perClass).reduce((s, v) => s + v[k], 0);
  return { tp: sum('tp'), fp: sum('fp'), fn: sum('fn'), perClass };
}

/**
 * The page's test bench: each target sound and each look-alike, near and far, in each background. The same set
 * is scored at several thresholds so the trade-off between missed events and false alarms can be read in a table.
 */
export function benchScenes() {
  const scenes = [];
  let seed = 11;
  for (const bg of Object.keys(BACKGROUNDS)) for (const kind of Object.keys(SOUNDS)) for (const distance of [1, 4]) {
    scenes.push({ id: `${kind}-${bg}-${distance}m`, bg, kind, distance, seed, events: [{ kind, at: 1300, level: 1, distance, seed: seed++ }] });
  }
  return scenes;
}
export function runBench(rules = DEFAULT_RULES, scenes = benchScenes()) {
  const rows = scenes.map((s) => {
    const r = runScene(s, rules);
    const alerts = r.windows.flatMap((w) => w.alerts.map((a) => a.id));
    return { id: s.id, kind: s.kind, bg: s.bg, distance: s.distance, target: SOUNDS[s.kind].target, alerts, ...r.outcome };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { rows, tp: sum('tp'), fp: sum('fp'), fn: sum('fn'), events: rows.filter((r) => r.target).length };
}
/* ------------------------------------------------------------------ the live monitor (the page's board) */
/** The primary YAMNet index printed for each demo class (the example prints class numbers, not names). */
export const PRINT_ID = { clap: YAMNET.Clapping, knock: YAMNET.Knock, glass: YAMNET.Shatter, alarm: YAMNET['Smoke detector, smoke alarm'], speech: YAMNET.Speech, music: YAMNET.Music, silence: YAMNET.Silence };
/** Console text of the example's FormatClassificationOutput(), with the demo scores. */
export function formatResults(top) {
  if (!top.length) return ['No results'];
  return ['Results:', ...top.map((r) => `${PRINT_ID[r.id]}: ${r.score.toFixed(6)}`)];
}
/**
 * The board's loop, in simulated time, as classify_audio.cc runs it:
 *   - the microphone never stops: the audio service keeps appending samples to LatestSamples (the latest 975 ms);
 *   - the loop copies the latest 975 ms (the "read"), computes the features and runs YAMNet (procMs), prints;
 *   - Edge TPU build: then vTaskDelay(975 ms) ("rate limit the TPU version"). The next read takes the 975 ms heard
 *     during that delay, so the audio heard while the board was computing (procMs) is in no window;
 *   - CPU build (YAMNET_CPU): no delay, the next read comes right after the computation, and the windows overlap.
 * procMs is an assumption of the page: the documentation gives no figure (the board prints its own as "total: …ms").
 * noPause removes the Edge TPU build's delay (a change to the example, offered by the page as an exercise).
 */
export class Monitor {
  constructor(opts = {}) {
    this.opts = { bg: 'quiet', build: 'tpu', noPause: false, procMs: 250, seed: 1, ...opts };
    this.rules = new AlertRules(opts.rules || DEFAULT_RULES);
    this.reset();
  }
  reset() {
    this.t = 0;
    // the first 150 ms are dropped (kDropFirstSamplesMs), then the program waits 975 ms for the buffer to fill
    this.nextRead = ACOUSTIC.dropFirstMs + ACOUSTIC.windowMs;
    this.pending = null;
    this.events = [];
    this.windows = [];
    this.reads = []; // every analysed window: { start, end (the read), doneAt }
    this.log = [];
    this.console = ['YamNet Example!'];
    this.consoleTotal = 1; // lines printed since the start (the array keeps the last 80)
    this.last = null;
    this.ledUntil = -1;
    this.stats = { tp: 0, fp: 0, fn: 0 };
    this.seedN = this.opts.seed * 1000;
    this.rules.reset();
  }
  /** The Edge TPU build's vTaskDelay after each window (0 for the CPU build, or with noPause). */
  get delayMs() {
    return this.opts.build === 'tpu' && !this.opts.noPause ? ACOUSTIC.windowMs : 0;
  }
  get procMs() {
    return Math.max(50, this.opts.procMs);
  }
  /** Time from one read to the next. */
  get periodMs() {
    return this.procMs + this.delayMs;
  }
  /** Audio heard between two windows that no window contains (0 when the windows touch or overlap). */
  get gapMs() {
    return Math.max(0, this.periodMs - ACOUSTIC.windowMs);
  }
  /** 'compute' from a read until its result, 'wait' during the delay (the microphone records in both). */
  get phase() {
    return this.pending ? 'compute' : 'wait';
  }
  /** Display stage of the window being computed (the page splits procMs: features, YAMNet, result). */
  get stage() {
    if (!this.pending) return 'wait';
    const k = (this.t - this.pending.end) / this.procMs;
    return k < 0.35 ? 'features' : k < 0.85 ? 'infer' : 'decide';
  }
  get userLed() {
    return this.t < this.ledUntil;
  }
  set(opts) {
    Object.assign(this.opts, opts);
    if (opts.rules) this.rules.rules = cloneRules(opts.rules);
  }
  /** A sound starts now (plus 30 ms). */
  play(kind, { distance = 1, level = 1 } = {}) {
    const ev = { id: this.events.length + 1, kind, at: this.t + 30, distance, level, seed: ++this.seedN, state: 'pending', max: 0, covered: 0 };
    this.events.push(ev);
    while (this.events.length > 40 && this.events[0].state !== 'pending') this.events.shift();
    return ev;
  }
  step(dtMs) {
    this.t += dtMs;
    for (;;) {
      if (this.pending && this.t >= this.pending.end + this.procMs) {
        const p = this.pending;
        this.pending = null;
        this.analyse(p.start, p.end + this.procMs);
        this.nextRead = p.end + this.procMs + this.delayMs;
      } else if (!this.pending && this.t >= this.nextRead) {
        this.pending = { start: this.nextRead - ACOUSTIC.windowMs, end: this.nextRead };
      } else break;
    }
    this.judgeMisses();
  }
  analyse(start, doneAt) {
    const scene = { bg: this.opts.bg, events: this.events, seed: this.opts.seed };
    const samples = windowSamplesAt(start, scene);
    const features = logMel(samples);
    const { scores, m } = classify(features);
    const top = topResults(scores);
    const end = start + ACOUSTIC.windowMs;
    const alerts = this.rules.step(scores, end);
    const w = { start, end, doneAt, samples, features, scores, m, top, alerts, truth: truthAt(start, this.events) };
    this.windows.push(w);
    while (this.windows.length > 12) this.windows.shift();
    this.reads.push({ start, end, doneAt, alert: alerts.length > 0 });
    while (this.reads.length > 60) this.reads.shift();
    this.last = w;
    this.say(...formatResults(top));
    // which pending events this window heard, and how strongly
    for (const ev of this.events) {
      const tgt = SOUNDS[ev.kind].target;
      const ov = Math.min(end, ev.at + SOUNDS[ev.kind].ms) - Math.max(start, ev.at);
      if (ov <= 0) continue;
      ev.covered = Math.max(ev.covered, ov / Math.min(SOUNDS[ev.kind].ms, ACOUSTIC.windowMs));
      if (tgt) ev.max = Math.max(ev.max, scores[tgt]);
    }
    for (const a of alerts) {
      this.ledUntil = this.t + 2000;
      const reach = ACOUSTIC.windowMs + this.periodMs * 2;
      const ev = this.events.find((e) => SOUNDS[e.kind].target === a.id && e.state !== 'found' && e.at < end && e.at + SOUNDS[e.kind].ms + reach > start);
      const sound = this.events.filter((e) => e.at < end && e.at + SOUNDS[e.kind].ms > start).map((e) => SOUNDS[e.kind].label);
      if (ev) {
        ev.state = 'found';
        this.stats.tp++;
      } else this.stats.fp++;
      const line = `[extension] ALERT ${a.id} score ${a.score.toFixed(2)}`;
      this.say(line);
      this.log.push({ t: end, type: 'alert', cls: a.id, score: a.score, verdict: ev ? 'correct' : 'false alarm', sounds: sound.length ? sound : ['background only'] });
    }
    while (this.console.length > 80) this.console.shift();
  }
  say(...lines) {
    this.console.push(...lines);
    this.consoleTotal += lines.length;
  }
  judgeMisses() {
    const wait = ACOUSTIC.windowMs + this.periodMs * 3 + this.procMs;
    for (const ev of this.events) {
      if (ev.state !== 'pending') continue;
      const tgt = SOUNDS[ev.kind].target, end = ev.at + SOUNDS[ev.kind].ms;
      if (this.t < end + wait) continue;
      if (!tgt) {
        ev.state = 'done';
        continue;
      }
      ev.state = 'missed';
      this.stats.fn++;
      const r = this.rules.rules[tgt];
      const reason = ev.covered < 0.3 ? 'no single window held enough of it: it was split between two windows, or heard while the board was computing' : ev.max < r.threshold ? `its best score, ${ev.max.toFixed(2)}, stayed below the threshold ${r.threshold.toFixed(2)}` : !r.enabled ? 'alerts for this class are switched off' : 'the persistence or cooldown rule held the alert back';
      this.log.push({ t: end, type: 'missed', cls: tgt, score: ev.max, verdict: 'missed', reason, sounds: [SOUNDS[ev.kind].label] });
    }
  }
}

/**
 * Numbers the chapter quotes about its own test bench (tests/coralAcoustic.test.mjs recomputes and checks them).
 * They describe this page's synthesised sounds and stand-in classifier, nothing else.
 */
export const BENCH_FACTS = {
  scenes: 54,
  events: 24,
  defaults: { tp: 21, fp: 5, fn: 3 },
  dishesGlass: 2,
  dishesCases: 6,
  dishesWhere: 'fan at 1 m, TV at 1 m',
  at02: { fp: 18, fn: 1 },
  at07: { fp: 0, fn: 8 },
};

/** The same bench with one threshold for every alert class (the rest of the rules unchanged). */
export function sweep(thresholds = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], base = DEFAULT_RULES, scenes = benchScenes()) {
  return thresholds.map((t) => {
    const rules = cloneRules(base);
    for (const k of Object.keys(rules)) rules[k].threshold = t;
    const b = runBench(rules, scenes);
    return { threshold: t, tp: b.tp, fp: b.fp, fn: b.fn, events: b.events };
  });
}
