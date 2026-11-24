import * as THREE from 'three';
import { boardLabelTexture, glowTexture } from './textures.js';
import { buildPiModel } from './piModel.js';

/*
 * Scene units: 1 unit = 1 cm. The circuit sits on the right page of the book (y = 0 is the page surface).
 * The Pi is closest to the reader, the breadboard is behind it, and two jumper wires cross the gap.
 */

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const easeOutBack = (x) => {
  const c1 = 1.5, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export const PITCH = 0.254; // 2.54 mm
export const BOARD = { w: 8.2, h: 0.85, d: 5.5 };
export const PI_Y = 0.3;
export const PCB_T = 0.16;
const HEADER_X = -1.0;
export const HEADER_H = 0.25;
export const PI_CENTER = V(5.5, 0, 3.2);
export const BOARD_CENTER = V(5.5, 0, -3.3);
export const ROW_Z = { a: 1.396, b: 1.142, c: 0.888, d: 0.634, e: 0.38, f: -0.38, g: -0.634, h: -0.888, i: -1.142, j: -1.396 };

/** Top-surface position of a breadboard hole. */
export function holePos(col, row) {
  return V(BOARD_CENTER.x + (col - 15.5) * PITCH, BOARD.h, BOARD_CENTER.z + ROW_Z[row]);
}

/** Top-surface position of hole i (0..24) of a power rail: 'near-minus' | 'near-plus' | 'far-minus' | 'far-plus'. */
export function railPos(i, name = 'near-minus') {
  const z = { 'near-minus': 1.9, 'near-plus': 2.154, 'far-minus': -1.9, 'far-plus': -2.154 }[name];
  return V(BOARD_CENTER.x - 3.556 + i * PITCH + Math.floor(i / 5) * PITCH, BOARD.h, BOARD_CENTER.z + z);
}

/** Tip position of a GPIO header pin by physical pin number (1..40). */
export function pinPos(n) {
  const c = Math.floor((n - 1) / 2);
  const odd = n % 2 === 1;
  return V(
    PI_CENTER.x + HEADER_X - 2.413 + c * PITCH,
    PI_Y + PCB_T + HEADER_H + 0.45,
    PI_CENTER.z - 2.35 + (odd ? 0.127 : -0.127),
  );
}

export const std = (color, roughness = 0.5, metalness = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

export function roundedSlab(w, d, h, r) {
  const x = -w / 2, y = -d / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + d - r);
  s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + d);
  s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  return g;
}

export function box(parent, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function cylinderBetween(parent, a, b, r, mat) {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  parent.add(m);
  return m;
}

export class Polyline {
  constructor(points) {
    this.pts = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  fractionAt(index) {
    return this.cum[index] / this.length;
  }
  at(s, out) {
    const d = clamp01(s) * this.length;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    return out.copy(this.pts[lo]).lerp(this.pts[hi], (d - this.cum[lo]) / seg);
  }
}

/* ------------------------------------------------------------------ Raspberry Pi 5 (see piModel.js) */
export function buildPi() {
  return buildPiModel({ std, roundedSlab, box, PI_CENTER, PI_Y, PCB_T, HEADER_X, HEADER_H, PITCH });
}

/* ------------------------------------------------------------------ Breadboard */
export function buildBoard(opts = {}) {
  const g = new THREE.Group();
  g.position.copy(BOARD_CENTER);
  g.add(new THREE.Mesh(roundedSlab(BOARD.w, BOARD.d, BOARD.h, 0.12), std('#ebe7dc', 0.55, 0)));
  box(g, 7.9, 0.003, 0.42, std('#cdc8b8', 0.7), 0, BOARD.h + 0.0015, 0);

  const positions = [];
  for (let col = 1; col <= 30; col++) for (const z of Object.values(ROW_Z)) positions.push([(col - 15.5) * PITCH, z]);
  for (const z of [1.9, 2.154, -1.9, -2.154]) {
    for (let i = 0; i < 25; i++) positions.push([-3.556 + i * PITCH + Math.floor(i / 5) * PITCH, z]);
  }
  const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.03, 0.12), std('#26262b', 0.8), positions.length);
  const m4 = new THREE.Matrix4();
  positions.forEach(([x, z], i) => {
    m4.setPosition(x, BOARD.h, z);
    holes.setMatrixAt(i, m4);
  });
  holes.userData.noShadow = true;
  g.add(holes);

  const labels = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.w, BOARD.d),
    new THREE.MeshBasicMaterial({
      map: boardLabelTexture(PITCH, opts.labelCols), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1,
    }),
  );
  labels.rotation.x = -Math.PI / 2;
  labels.position.y = BOARD.h + 0.004;
  labels.userData.noShadow = true;
  g.add(labels);

  // translucent strips: the five holes of a column (a-e) are connected inside the board
  const strips = {};
  // opts.strips: [[column, 'n' (rows a-e) | 'f' (rows f-j)], ...]. Keys: column number for 'n', ${column}f for 'f'.
  for (const [col, side] of opts.strips || [[7, 'n'], [8, 'n'], [12, 'n']]) {
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffcf6b', transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.19, ROW_Z.a - ROW_Z.e + 0.2), mat);
    m.rotation.x = -Math.PI / 2;
    const zc = side === 'n' ? (ROW_Z.a + ROW_Z.e) / 2 : (ROW_Z.f + ROW_Z.j) / 2;
    m.position.set((col - 15.5) * PITCH, BOARD.h + 0.006, zc);
    m.userData.noShadow = true;
    g.add(m);
    strips[side === 'n' ? col : col + 'f'] = mat;
  }
  // opts.rails: ['near-minus', ...] adds a translucent strip along that rail, keyed 'rail:<name>'
  const RAIL_Z = { 'near-minus': 1.9, 'near-plus': 2.154, 'far-minus': -1.9, 'far-plus': -2.154 };
  for (const name of opts.rails || []) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffcf6b', transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 0.19), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, BOARD.h + 0.006, RAIL_Z[name]);
    m.userData.noShadow = true;
    g.add(m);
    strips['rail:' + name] = mat;
  }
  return { group: g, strips };
}

/* ------------------------------------------------------------------ Resistor 330 ohm */
export function buildResistor({ a = holePos(8, 'c'), b = holePos(12, 'c'), colors = ['#ff8a1a', '#ff8a1a', '#6b3a1c', '#d4af37'] } = {}) {
  const g = new THREE.Group();
  g.position.set((a.x + b.x) / 2, BOARD.h, a.z);
  const half = (b.x - a.x) / 2;
  const lead = std('#cfd0d4', 0.3, 0.95);
  const bodyMat = std('#d9c08e', 0.6, 0);

  const profile = [[0, -0.31], [0.08, -0.31], [0.13, -0.27], [0.13, -0.2], [0.095, -0.17], [0.095, 0.17], [0.13, 0.2], [0.13, 0.27], [0.08, 0.31], [0, 0.31]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(profile, 24);
  lathe.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(lathe, bodyMat);
  body.position.y = 0.2;
  g.add(body);

  const bands = [-0.115, -0.055, 0.005, 0.105].map((x, i) => [x, colors[i]]);
  for (const [x, color] of bands) {
    const geo = new THREE.CylinderGeometry(0.099, 0.099, 0.04, 20);
    geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, std(color, 0.5));
    m.position.set(x, 0.2, 0);
    g.add(m);
  }
  for (const s of [-1, 1]) {
    cylinderBetween(g, V(s * half, -0.25, 0), V(s * half, 0.2, 0), 0.022, lead);
    cylinderBetween(g, V(s * half, 0.2, 0), V(s * 0.3, 0.2, 0), 0.022, lead);
  }
  return { group: g, bodyMat };
}

/* ------------------------------------------------------------------ LED */
export function buildLed({ cathode = holePos(7, 'e'), anode = holePos(8, 'e'), color = '#ff2f2f', emissive = '#ff1a10', coreOff = '#4a0c0c' } = {}) {
  const g = new THREE.Group();
  g.position.set((cathode.x + anode.x) / 2, BOARD.h, anode.z);
  const lead = std('#cfd0d4', 0.3, 0.95);
  const dx = (anode.x - cathode.x) / 2;

  cylinderBetween(g, V(dx, -0.25, 0), V(dx, 0.4, 0), 0.025, lead);
  cylinderBetween(g, V(-dx, -0.25, 0), V(-dx, 0.4, 0), 0.025, lead);

  const shellMat = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.78,
    emissive, emissiveIntensity: 0, clearcoat: 1, clearcoatRoughness: 0.1,
  });
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 28), shellMat);
  flange.position.y = 0.35;
  g.add(flange);
  const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.425, 28), shellMat);
  bodyM.position.y = 0.5875;
  g.add(bodyM);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  dome.position.y = 0.8;
  g.add(dome);

  // internal anvil / die
  const inner = std('#9a9a9f', 0.4, 0.9);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), inner);
  post.position.set(dx, 0.58, 0);
  g.add(post);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.05, 0.12, 14, 1, true), inner);
  cup.material.side = THREE.DoubleSide;
  cup.position.set(-dx, 0.7, 0);
  g.add(cup);
  cylinderBetween(g, V(-dx, 0.4, 0), V(-dx, 0.65, 0), 0.03, inner);
  const coreMat = new THREE.MeshBasicMaterial({ color: coreOff, toneMapped: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), coreMat);
  core.position.set(-dx, 0.76, 0);
  g.add(core);
  return { group: g, shellMat, coreMat, anodeOffset: dx };
}

/* ------------------------------------------------------------------ Jumper wire (female -> male) */
export function buildJumper(pinNumber, endHole, wireColor, arc, housingW = 0.27) {
  return buildJumperAt(pinPos(pinNumber), PI_Y + PCB_T + HEADER_H + 0.6, endHole, wireColor, arc, housingW);
}

/** Same wire for any board: starts on a header pin at p (x, z) with the plastic housing ending at housingTopY. */
export function buildJumperAt(p, housingTopY, endHole, wireColor, arc, housingW = 0.27) {
  const root = new THREE.Group();
  const start = V(p.x, housingTopY, p.z);
  const end = endHole.clone();
  const s1 = start.clone().add(V(0, 0.5, 0));
  const e0 = end.clone();
  e0.y = BOARD.h + 0.5;
  const e1 = e0.clone();
  e1.y += 0.55;
  const mid = s1.clone().lerp(e1, 0.5);
  mid.y += arc;
  const curve = new THREE.CatmullRomCurve3([start, s1, mid, e1, e0], false, 'centripetal');

  const wireMat = std(wireColor, 0.45, 0, { emissive: '#000000' });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.05, 10, false), wireMat);
  root.add(tube);

  const housing = new THREE.Group();
  housing.position.set(p.x, 0, p.z);
  box(housing, housingW, 0.6, housingW, std('#16161a', 0.6), 0, housingTopY - 0.3, 0);
  box(housing, 0.1, 0.06, 0.1, wireMat, 0, housingTopY + 0.02, 0);
  root.add(housing);

  const plug = new THREE.Group();
  plug.position.set(end.x, BOARD.h, end.z);
  box(plug, 0.17, 0.4, 0.17, std('#16161a', 0.6), 0, 0.3, 0);
  cylinderBetween(plug, V(0, -0.25, 0), V(0, 0.12, 0), 0.03, std('#cfd0d4', 0.3, 0.95));
  root.add(plug);

  return { root, curve, tube, housing, plug, wireMat, housingPos: V(p.x, housingTopY, p.z) };
}

/* ------------------------------------------------------------------ Jumper wire (male -> male, breadboard to breadboard) */
export function buildBoardJumper(holeA, holeB, wireColor, arc = 0.45) {
  const root = new THREE.Group();
  const top = (p) => V(p.x, BOARD.h + 0.5, p.z);
  const a0 = top(holeA), b0 = top(holeB);
  const mid = a0.clone().lerp(b0, 0.5);
  mid.y += arc;
  const curve = new THREE.CatmullRomCurve3([a0, a0.clone().add(V(0, 0.4, 0)), mid, b0.clone().add(V(0, 0.4, 0)), b0], false, 'centripetal');
  const wireMat = std(wireColor, 0.45, 0, { emissive: '#000000' });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.05, 10, false), wireMat);
  root.add(tube);
  const plug = (hole) => {
    const g = new THREE.Group();
    g.position.set(hole.x, BOARD.h, hole.z);
    box(g, 0.17, 0.4, 0.17, std('#16161a', 0.6), 0, 0.3, 0);
    cylinderBetween(g, V(0, -0.25, 0), V(0, 0.12, 0), 0.03, std('#cfd0d4', 0.3, 0.95));
    root.add(g);
    return g;
  };
  return { root, curve, tube, plugA: plug(holeA), plugB: plug(holeB), wireMat };
}

/* ------------------------------------------------------------------ Whole circuit */
export function buildCircuit() {
  const root = new THREE.Group();

  const pi = buildPi();
  const { group: board, strips } = buildBoard();
  const resistor = buildResistor();
  const led = buildLed();
  const gpioWire = buildJumper(11, holePos(12, 'a'), '#ff7a1a', 0.35);
  const gndWire = buildJumper(6, holePos(7, 'a'), '#3b3b44', 0.35);
  root.add(pi, board, resistor.group, led.group, gpioWire.root, gndWire.root);

  root.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  /* --- signal path: GPIO17 pin 11 -> wire -> col 12 -> resistor -> col 8 -> LED -> col 7 -> wire -> GND pin 6 --- */
  const pts = [];
  const marks = {};
  const push = (v, name) => {
    pts.push(v.clone());
    if (name) marks[name] = pts.length - 1;
  };
  const pin11 = pinPos(11), pin6 = pinPos(6);
  const SURF = BOARD.h + 0.05;
  push(V(pin11.x, 0.78, pin11.z), 'start');
  for (const p of gpioWire.curve.getPoints(60)) push(p);
  const h12a = holePos(12, 'a'), h12c = holePos(12, 'c'), h8c = holePos(8, 'c'), h8e = holePos(8, 'e');
  const h7e = holePos(7, 'e'), h7a = holePos(7, 'a');
  push(V(h12a.x, SURF, h12a.z), 'wire1End');
  push(V(h12c.x, SURF, h12c.z));
  push(V(h12c.x, BOARD.h + 0.2, h12c.z), 'resIn');
  push(V((h12c.x + h8c.x) / 2, BOARD.h + 0.2, h12c.z), 'resMid');
  push(V(h8c.x, BOARD.h + 0.2, h8c.z), 'resOut');
  push(V(h8c.x, SURF, h8c.z));
  push(V(h8e.x, SURF, h8e.z), 'strip8End');
  const lx = (h8e.x + h7e.x) / 2, dx = led.anodeOffset;
  push(V(h8e.x, BOARD.h + 0.45, h8e.z), 'ledIn');
  push(V(lx, BOARD.h + 0.85, h8e.z), 'ledApex');
  push(V(h7e.x, BOARD.h + 0.45, h7e.z), 'ledOut');
  push(V(h7e.x, SURF, h7e.z));
  push(V(h7a.x, SURF, h7a.z), 'strip7End');
  const back = gndWire.curve.getPoints(60).reverse();
  for (const p of back) push(p);
  push(V(pin6.x, 0.78, pin6.z), 'end');
  const path = new Polyline(pts);
  const F = {};
  for (const [k, i] of Object.entries(marks)) F[k] = path.fractionAt(i);

  /* --- moving charge particles --- */
  const N = 150;
  const pos = new Float32Array(N * 3);
  const alpha = new Float32Array(N);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pgeo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const pmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 0.13 }, uScale: { value: 800 }, uColor: { value: new THREE.Color('#ffc65a') } },
    vertexShader: `
      attribute float aAlpha; varying float vA; uniform float uSize; uniform float uScale;
      void main(){ vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=uSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      varying float vA; uniform vec3 uColor;
      void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d);
        gl_FragColor=vec4(uColor*(0.6+a), a*vA); }`,
  });
  const particles = new THREE.Points(pgeo, pmat);
  particles.frustumCulled = false;
  particles.renderOrder = 10;
  root.add(particles);

  /* --- glows: LED halo, pin glow, board decal, pulse ring --- */
  const glowTex = glowTexture();
  const ledTop = V(lx, BOARD.h + 0.75, h8e.z);
  const ledGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: '#ff3b2a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
  }));
  ledGlow.position.copy(ledTop);
  root.add(ledGlow);

  const ledLight = new THREE.PointLight('#ff3020', 0, 9, 2);
  ledLight.position.set(lx, BOARD.h + 1.3, h8e.z + 0.2);
  root.add(ledLight);

  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({
      map: glowTex, color: '#ff2a1a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false,
    }),
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(lx, BOARD.h + 0.012, h8e.z);
  decal.userData.noShadow = true;
  root.add(decal);

  const pinGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: '#ffb23a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, depthTest: false,
  }));
  pinGlow.position.set(pin11.x, gpioWire.housingPos.y + 0.1, pin11.z);
  pinGlow.scale.setScalar(1.3);
  pinGlow.renderOrder = 9;
  root.add(pinGlow);

  const ringGeo = new THREE.RingGeometry(0.28, 0.34, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: '#ffd27a', transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  ring.position.set(pin11.x, PI_Y + PCB_T + HEADER_H + 0.02, pin11.z);
  ring.renderOrder = 9;
  ring.visible = false;
  root.add(ring);
  let ringT = 99;
  let ringColor = '#ffd27a';

  /* --- pop-in animation pieces --- */
  const scalePiece = (obj, delay, dur = 0.7, lift = 1.0) => {
    const base = obj.position.y;
    return {
      delay, dur,
      apply(k) {
        const e = easeOutBack(k);
        obj.visible = k > 0;
        obj.scale.setScalar(Math.max(e, 0.0001));
        obj.position.y = base + (1 - Math.min(e, 1)) * lift;
      },
    };
  };
  const wirePiece = (w, delay, dur = 0.9) => {
    const count = w.tube.geometry.index.count;
    return {
      delay, dur,
      apply(k) {
        w.tube.visible = k > 0;
        w.tube.geometry.setDrawRange(0, Math.floor((count * clamp01(k * 1.05)) / 3) * 3);
        w.housing.visible = k > 0;
        w.housing.scale.setScalar(Math.max(easeOutBack(clamp01(k * 4)), 0.0001));
        w.plug.visible = k > 0.93;
        w.plug.scale.setScalar(Math.max(easeOutBack(clamp01((k - 0.93) * 14)), 0.0001));
      },
    };
  };
  const pieces = [
    scalePiece(pi, 0.0, 0.9, 1.6),
    scalePiece(board, 0.2, 0.9, 1.6),
    scalePiece(resistor.group, 0.75, 0.6, 1.0),
    scalePiece(led.group, 0.95, 0.6, 1.0),
    wirePiece(gndWire, 1.2),
    wirePiece(gpioWire, 1.4),
  ];

  const lv = { gpioWire: 0, strip12: 0, res: 0, strip8: 0, strip7: 0, gndWire: 0 };
  const tmp = new THREE.Vector3();
  const lerpTo = (cur, target, dt, rate = 12) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

  return {
    root,
    path,
    fractions: F,
    anchors: {
      pin11: pin11.clone(), pin6: pin6.clone(),
      resistor: V(PI_CENTER.x - 1.4, BOARD.h + 0.2, h12c.z),
      led: ledTop.clone(),
      board: V(BOARD_CENTER.x + BOARD.w / 2 - 0.3, BOARD.h, BOARD_CENTER.z - BOARD.d / 2 + 0.4),
      pi: V(PI_CENTER.x + 3.4, PI_Y + 1.8, PI_CENTER.z + 1.95),
    },

    /** tp = seconds since the book finished opening (0 hides everything). */
    setPop(tp) {
      root.visible = tp > 0;
      for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
    },

    pulse(color = '#ffd27a') {
      ringT = 0;
      ringColor = color;
    },

    /** sig: { front, tail, led (0..1), gpio (0..1) } */
    update(time, dt, sig, camera, viewportHeightPx) {
      pmat.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));

      // sig.level (optional, 0..1) scales every lit part: used by the PWM lesson for the time-averaged intensity
      const level = sig.level ?? 1;
      const lit = (c) => (sig.tail < c && sig.front > c ? level : 0);
      lv.gpioWire = lerpTo(lv.gpioWire, lit(F.wire1End * 0.5), dt);
      lv.strip12 = lerpTo(lv.strip12, lit((F.wire1End + F.resIn) / 2), dt);
      lv.res = lerpTo(lv.res, lit(F.resMid), dt);
      lv.strip8 = lerpTo(lv.strip8, lit((F.resOut + F.strip8End) / 2), dt);
      lv.strip7 = lerpTo(lv.strip7, lit((F.ledOut + F.strip7End) / 2), dt);
      lv.gndWire = lerpTo(lv.gndWire, lit((F.strip7End + F.end) / 2), dt);

      gpioWire.wireMat.emissive.set('#ff8a1a');
      gpioWire.wireMat.emissiveIntensity = 0.9 * lv.gpioWire;
      gndWire.wireMat.emissive.set('#ffb35a');
      gndWire.wireMat.emissiveIntensity = 0.7 * lv.gndWire;
      resistor.bodyMat.emissive.set('#ff7a00');
      resistor.bodyMat.emissiveIntensity = 0.22 * lv.res;
      strips[12].opacity = 0.14 + 0.5 * lv.strip12;
      strips[8].opacity = 0.14 + 0.5 * lv.strip8;
      strips[7].opacity = 0.14 + 0.5 * lv.strip7;

      // LED
      const L = sig.led;
      led.shellMat.emissiveIntensity = 2.4 * L;
      led.shellMat.opacity = 0.78 + 0.2 * L;
      led.coreMat.color.setRGB(0.29 + 0.71 * L, 0.05 + 0.6 * L, 0.05 + 0.55 * L);
      ledLight.intensity = 22 * L;
      ledGlow.material.opacity = 0.95 * L;
      ledGlow.scale.setScalar(2.4 + 0.6 * L + 0.05 * Math.sin(time * 9) * L);
      decal.material.opacity = 0.7 * L;

      // GPIO pin glow + pulse ring
      pinGlow.material.opacity = 0.75 * sig.gpio;
      pinGlow.scale.setScalar(1.2 + 0.15 * Math.sin(time * 6) * sig.gpio);
      ringT += dt;
      if (ringT < 0.9) {
        const k = ringT / 0.9;
        ring.visible = true;
        ring.scale.setScalar(0.6 + k * 5);
        ring.material.opacity = (1 - k) * 0.9;
        ring.material.color.set(ringColor);
      } else ring.visible = false;

      // particles
      const flow = time * 0.2;
      const edge = 0.02;
      for (let i = 0; i < N; i++) {
        const s = (i / N + flow) % 1;
        path.at(s, tmp);
        pos[i * 3] = tmp.x;
        pos[i * 3 + 1] = tmp.y;
        pos[i * 3 + 2] = tmp.z;
        let a = 0;
        if (s > sig.tail && s < sig.front) {
          a = Math.min(1, (s - sig.tail) / edge, (sig.front - s) / edge);
        }
        alpha[i] = Math.max(0, a) * level;
      }
      pgeo.attributes.position.needsUpdate = true;
      pgeo.attributes.aAlpha.needsUpdate = true;
    },
  };
}
