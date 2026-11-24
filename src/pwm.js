/*
 * PWM model for lesson 3.
 *
 * Real behaviour: gpiozero PWMLED switches the pin between LOW (0 V) and HIGH (3.3 V) 100 times per second
 * (frequency=100 by default). The duty cycle is the share of each 10 ms period spent HIGH. The pin never outputs a
 * steady in-between voltage, and the eye cannot follow 100 flashes per second, so it sees a steady brightness.
 *
 * Teaching aid: "slow motion" runs the same square wave at 0.5 Hz (one period = 2 s), so every pulse is visible.
 */
export const REAL_HZ = 100;
export const SLOW_HZ = 0.5;
export const DEFAULT_DUTY = 0.5;
export const SUPPLY_V = 3.3;
export const LED_VF = 2.0;
export const RESISTOR_OHMS = 330;
/** Current while the pin is HIGH: (3.3 V - 2.0 V) / 330 ohm. */
export const I_HIGH_MA = ((SUPPLY_V - LED_VF) / RESISTOR_OHMS) * 1000;

export class PwmGenerator {
  constructor() {
    this.onEdge = null; // (high: boolean) => void, only fired in slow motion
    this.reset();
  }

  reset() {
    this.duty = DEFAULT_DUTY;
    this.slow = false;
    this.phase = 0;
    this.t = 0;
    this.high = false;
    this.history = [{ t: 0, v: 0 }]; // GPIO17 level transitions (slow motion only)
    this.wraps = [0]; // start time of each period (slow motion only)
  }

  get periodSeconds() {
    return 1 / (this.slow ? SLOW_HZ : REAL_HZ);
  }

  /** What the LED looks like on average: the time-averaged share of "on", 0..1. */
  get average() {
    return this.duty;
  }

  setSlow(slow) {
    if (slow === this.slow) return;
    this.slow = slow;
    this.phase = 0;
    this.high = false;
    this.history = [{ t: this.t, v: 0 }];
    this.wraps = [this.t];
  }

  setDuty(duty) {
    this.duty = Math.min(1, Math.max(0, duty));
  }

  update(dt) {
    this.t += dt;
    if (!this.slow) {
      this.high = this.duty >= 1;
      return;
    }
    this.phase += dt * SLOW_HZ;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.wraps.push(this.t);
    }
    const high = this.duty >= 1 || (this.duty > 0 && this.phase < this.duty);
    if (high !== this.high) {
      this.high = high;
      this.history.push({ t: this.t, v: high ? 1 : 0 });
      this.onEdge?.(high);
    }
    const old = this.t - 9;
    while (this.history.length > 2 && this.history[1].t < old) this.history.shift();
    while (this.wraps.length > 2 && this.wraps[1] < old) this.wraps.shift();
  }
}

/** Short text for a duty cycle: pulse widths and average current, for the current period. */
export function describeDuty(gen) {
  const period = gen.periodSeconds;
  const on = gen.duty * period, off = period - on;
  const fmt = (s) => (s >= 0.1 ? `${+s.toFixed(1)} s` : `${+(s * 1000).toFixed(1)} ms`);
  return { period: fmt(period), on: fmt(on), off: fmt(off), avgMa: (I_HIGH_MA * gen.duty).toFixed(1) };
}

/**
 * Oscilloscope-style plot of GPIO17.
 * Real speed: five ideal 10 ms periods (the real signal is far too fast to animate).
 * Slow motion: the last 6 s of the simulated pin, scrolling, with period markers.
 */
export function drawScope(canvas, gen) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const padL = 86, padR = 18, padT = 48, padB = 46;
  const yHigh = padT + 8, yLow = h - padB - 8;
  const plotW = w - padL - padR;
  const SANS = '"Segoe UI", system-ui, sans-serif';
  const GOLD = '#ffcf6b';

  // axis labels
  ctx.font = `19px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = GOLD;
  ctx.fillText('3.3 V', padL - 8, yHigh + 4);
  ctx.fillStyle = '#8c93b3';
  ctx.fillText('0 V', padL - 8, yLow + 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, yHigh);
  ctx.lineTo(w - padR, yHigh);
  ctx.moveTo(padL, yLow);
  ctx.lineTo(w - padR, yLow);
  ctx.stroke();

  // title
  ctx.textAlign = 'left';
  ctx.font = `600 19px ${SANS}`;
  ctx.fillStyle = '#cfd8ee';
  ctx.fillText('GPIO17', padL, 24);
  const label = gen.slow ? 'slow motion · 0.5 Hz' : 'real signal · 100 Hz';
  ctx.fillStyle = '#8c93b3';
  ctx.fillText(label, padL + 82, 24);

  // build the polyline [x, level]
  const pts = [];
  let x0 = padL, x1 = w - padR;
  let periodMarks = [];
  if (gen.slow) {
    const win = 6;
    const X = (t) => padL + ((t - (gen.t - win)) / win) * plotW;
    let first = 0;
    for (let i = 0; i < gen.history.length; i++) if (gen.history[i].t <= gen.t - win) first = i;
    let last = gen.history[first].v;
    pts.push([x0, last]);
    for (let i = first + 1; i < gen.history.length; i++) {
      const x = X(gen.history[i].t);
      pts.push([x, last], [x, gen.history[i].v]);
      last = gen.history[i].v;
    }
    pts.push([x1, last]);
    periodMarks = gen.wraps.map(X).filter((x) => x >= padL - 1 && x <= x1 + 1);
    // time axis
    ctx.fillStyle = '#8c93b3';
    ctx.textAlign = 'center';
    ctx.font = `17px ${SANS}`;
    for (let s = 0; s <= 6; s += 2) ctx.fillText(s === 0 ? 'now' : `-${s} s`, X(gen.t - s), h - 12);
  } else {
    const periods = 5, pw = plotW / periods;
    pts.push([x0, 0]);
    for (let p = 0; p < periods; p++) {
      const s = x0 + p * pw;
      periodMarks.push(s);
      if (gen.duty >= 1) {
        pts.push([s, 1], [s + pw, 1]);
      } else if (gen.duty <= 0) {
        pts.push([s, 0], [s + pw, 0]);
      } else {
        pts.push([s, 0], [s, 1], [s + gen.duty * pw, 1], [s + gen.duty * pw, 0], [s + pw, 0]);
      }
    }
    periodMarks.push(x1);
    ctx.fillStyle = '#8c93b3';
    ctx.textAlign = 'center';
    ctx.font = `17px ${SANS}`;
    ctx.fillText('5 periods shown. The real signal repeats 100 times every second.', padL + plotW / 2, h - 12);
  }
  const Y = (v) => (v ? yHigh : yLow);

  // period markers
  ctx.save();
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(160,175,220,0.35)';
  for (const x of periodMarks) {
    ctx.beginPath();
    ctx.moveTo(x, padT - 2);
    ctx.lineTo(x, yLow + 8);
    ctx.stroke();
  }
  ctx.restore();
  // bracket over the most recent complete period
  if (periodMarks.length >= 2) {
    let i = periodMarks.length - 2;
    if (gen.slow && periodMarks.length >= 3) i = periodMarks.length - 2; // last full period
    const a = periodMarks[i], b = periodMarks[i + 1];
    if (b - a > 40) {
      ctx.strokeStyle = '#a9b8ee';
      ctx.fillStyle = '#a9b8ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a + 2, padT - 2);
      ctx.lineTo(b - 2, padT - 2);
      ctx.moveTo(a + 2, padT - 8);
      ctx.lineTo(a + 2, padT + 4);
      ctx.moveTo(b - 2, padT - 8);
      ctx.lineTo(b - 2, padT + 4);
      ctx.stroke();
      ctx.font = `600 17px ${SANS}`;
      ctx.textAlign = 'center';
      const txt = gen.slow ? 'one period = 2 s' : 'one period = 10 ms';
      const tw = ctx.measureText(txt).width + 10;
      ctx.fillStyle = '#14182c';
      ctx.fillRect((a + b) / 2 - tw / 2, padT - 26, tw, 21);
      ctx.fillStyle = '#a9b8ee';
      ctx.fillText(txt, (a + b) / 2, padT - 9);
    }
  }

  // HIGH areas + signal
  ctx.fillStyle = 'rgba(255,207,107,0.17)';
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i][1] && pts[i + 1][1]) ctx.fillRect(pts[i][0], yHigh, Math.max(0, pts[i + 1][0] - pts[i][0]), yLow - yHigh);
  }
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, v], i) => (i ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v))));
  ctx.stroke();

  // time-averaged level: a calculation, not a voltage the pin ever outputs
  const yAvg = yLow - gen.duty * (yLow - yHigh);
  ctx.save();
  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = 'rgba(127,209,199,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, yAvg);
  ctx.lineTo(w - padR, yAvg);
  ctx.stroke();
  ctx.restore();
  ctx.font = `600 17px ${SANS}`;
  ctx.textAlign = 'right';
  const avgTxt = `average ${(gen.duty * SUPPLY_V).toFixed(2)} V (calculated, not on the pin)`;
  const aw = ctx.measureText(avgTxt).width + 10;
  const ay = gen.duty > 0.5 ? yAvg + 24 : yAvg - 8;
  ctx.fillStyle = 'rgba(20,24,44,0.9)';
  ctx.fillRect(w - padR - aw, ay - 16, aw, 23);
  ctx.fillStyle = '#7fd1c7';
  ctx.fillText(avgTxt, w - padR - 5, ay);
}
