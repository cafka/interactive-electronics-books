/*
 * Chapter 3: kinematics of the 4-DOF feeder arm (base yaw, shoulder pitch, elbow pitch, wrist pitch).
 * Pure functions, millimetres and degrees, no DOM. The same formulas are in arduino/cat_feeder/cat_feeder.ino.
 *
 * Frame: origin at the centre of the base on the floor of the arm chamber. x forward, y to the left, z up.
 * The base turns the whole arm about z by q0. The other three joints move the arm in the vertical plane that
 * contains the base axis:
 *   q1 shoulder: angle of the upper arm above horizontal
 *   q2 elbow: angle of the forearm relative to the upper arm (negative = folded down, "elbow up" pose)
 *   q3 wrist: angle of the spoon relative to the forearm
 * The spoon pitch (absolute) is phi = q1 + q2 + q3: 0 = level, positive = tip raised, below about -40 it pours.
 */

export const DEG = Math.PI / 180;

/** Link lengths and joint limits. Values match the sketch's constants (read from it by parseFeederSettings). */
export const ARM = {
  h0: 90, // shoulder axis above the chamber floor
  l1: 120, // shoulder -> elbow
  l2: 120, // elbow -> wrist
  l3: 70, // wrist -> centre of the spoon bowl
  limits: [
    [-90, 90], // q0 base
    [10, 160], // q1 shoulder
    [-150, 0], // q2 elbow
    [-95, 95], // q3 wrist
  ],
};

/** Forward kinematics: joint angles (deg) -> positions of every joint and the spoon (mm), and the spoon pitch. */
export function forward(q, arm = ARM) {
  const [q0, q1, q2, q3] = q.map((a) => a * DEG);
  const a1 = q1, a2 = q1 + q2, a3 = q1 + q2 + q3;
  const rE = arm.l1 * Math.cos(a1), zE = arm.h0 + arm.l1 * Math.sin(a1);
  const rW = rE + arm.l2 * Math.cos(a2), zW = zE + arm.l2 * Math.sin(a2);
  const rS = rW + arm.l3 * Math.cos(a3), zS = zW + arm.l3 * Math.sin(a3);
  const c = Math.cos(q0), s = Math.sin(q0);
  const p = (r, z) => ({ x: r * c, y: r * s, z });
  return {
    shoulder: p(0, arm.h0), elbow: p(rE, zE), wrist: p(rW, zW), spoon: p(rS, zS),
    r: rS, phi: a3 / DEG,
  };
}

/** True if every joint angle is inside its limit (with a small tolerance for rounding). */
export function withinLimits(q, arm = ARM, eps = 1e-6) {
  return q.every((v, i) => v >= arm.limits[i][0] - eps && v <= arm.limits[i][1] + eps);
}

/**
 * Inverse kinematics: spoon target (x, y, z in mm) and spoon pitch phi (deg) -> joint angles, elbow-up solution.
 * Returns { ok: true, q } or { ok: false, reason, q? } where reason is 'out-of-reach', 'too-close' or 'joint-limit'.
 */
export function inverse({ x, y, z, phi }, arm = ARM) {
  const q0 = Math.atan2(y, x) / DEG;
  const r = Math.hypot(x, y);
  const rw = r - arm.l3 * Math.cos(phi * DEG); // the wrist point, found by stepping back along the spoon
  const zw = z - arm.h0 - arm.l3 * Math.sin(phi * DEG);
  const d2 = rw * rw + zw * zw;
  const c2 = (d2 - arm.l1 * arm.l1 - arm.l2 * arm.l2) / (2 * arm.l1 * arm.l2); // law of cosines
  if (c2 > 1 + 1e-9) return { ok: false, reason: 'out-of-reach', d: Math.sqrt(d2) };
  if (c2 < -1 - 1e-9) return { ok: false, reason: 'too-close', d: Math.sqrt(d2) };
  const q2 = -Math.acos(Math.max(-1, Math.min(1, c2))) / DEG; // elbow up: forearm folds down from the upper arm
  const q1 = (Math.atan2(zw, rw) - Math.atan2(arm.l2 * Math.sin(q2 * DEG), arm.l1 + arm.l2 * Math.cos(q2 * DEG))) / DEG;
  const q3 = phi - q1 - q2;
  const q = [q0, q1, q2, q3];
  if (!withinLimits(q, arm)) {
    const bad = q.map((v, i) => (v < arm.limits[i][0] || v > arm.limits[i][1] ? i : -1)).filter((i) => i >= 0);
    return { ok: false, reason: 'joint-limit', q, joints: bad };
  }
  return { ok: true, q };
}

/** Largest and smallest distance from the shoulder axis that the wrist can reach (mm). */
export const reachOf = (arm = ARM) => ({ max: arm.l1 + arm.l2, min: Math.abs(arm.l1 - arm.l2) });

/**
 * Static gravity torque on each pitch joint (N*m) for a pose, from link and payload masses (kg) at their centres.
 * masses: { upper, elbowServo, fore, wristServo, spoon } with link masses at mid-length.
 */
export function holdingTorques(q, masses, payloadKg, arm = ARM) {
  const g = 9.81;
  const a1 = q[1] * DEG, a2 = (q[1] + q[2]) * DEG, a3 = (q[1] + q[2] + q[3]) * DEG;
  // horizontal positions (mm from the base axis) of the joints and of each mass
  const xE = arm.l1 * Math.cos(a1), xW = xE + arm.l2 * Math.cos(a2), xS = xW + arm.l3 * Math.cos(a3);
  const items = [
    { m: masses.upper, x: (arm.l1 / 2) * Math.cos(a1), link: 1 },
    { m: masses.elbowServo, x: xE, link: 1 },
    { m: masses.fore, x: xE + (arm.l2 / 2) * Math.cos(a2), link: 2 },
    { m: masses.wristServo, x: xW, link: 2 },
    { m: masses.spoon + payloadKg, x: xS, link: 3 },
  ];
  // a joint holds every mass outboard of it: tau = g * sum(m * horizontal lever)
  const jointX = [0, 0, xE, xW];
  const tau = [0, 0, 0, 0];
  for (let j = 1; j <= 3; j++) {
    tau[j] = Math.abs(items.filter((it) => it.link >= j).reduce((s, it) => s + it.m * g * ((it.x - jointX[j]) / 1000), 0));
  }
  return tau;
}

/**
 * A coordinated joint move: every joint starts and stops together, with a smooth (smoothstep) speed profile.
 * The peak speed of smoothstep is 1.5 times the average, so the duration keeps every joint under vmax (deg/s).
 */
export function planMove(from, to, vmax) {
  const span = Math.max(...to.map((v, i) => Math.abs(v - from[i])));
  const duration = span < 1e-6 ? 0 : (1.5 * span) / vmax; // seconds
  return { from: [...from], to: [...to], duration };
}
export function sampleMove(move, t) {
  if (move.duration === 0) return [...move.to];
  const u = Math.min(1, Math.max(0, t / move.duration));
  const s = u * u * (3 - 2 * u);
  return move.from.map((a, i) => a + (move.to[i] - a) * s);
}
