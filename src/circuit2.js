import * as THREE from 'three';
import {
  V, clamp01, easeOutBack, BOARD, PI_CENTER, PI_Y, PCB_T, HEADER_H, ROW_Z, PITCH,
  holePos, pinPos, std, box, cylinderBetween, Polyline,
  buildPi, buildBoard, buildResistor, buildLed, buildJumper,
} from './circuit.js';
import { glowTexture } from './textures.js';

/*
 * Lesson 2 scene: LED branch (GPIO17 -> 330 ohm -> LED -> GND) plus a four-leg push button
 * between GPIO27 and GND. The button is drawn as a cutaway: the housing is translucent so the
 * two permanent contact bars and the moving bridge are visible.
 *
 * Button legs (breadboard): columns 24 and 27, rows e (near half) and f (far half).
 *   near pair: (24,e)-(27,e) always connected      far pair: (24,f)-(27,f) always connected
 *   GPIO27 -> column 24 row a (near half), GND -> column 24 row i (far half).
 *   Pressing the cap lowers the bridge onto both bars, joining the two halves.
 */

export const BTN_TRAVEL = 0.115;
const BH = BOARD.h;

/** Soft round particles that follow a Polyline between [tail, front]. */
export class ParticleFlow {
  constructor(path, { count, size, color, flowSpeed }) {
    this.path = path;
    this.n = count;
    this.flowSpeed = flowSpeed;
    this.pos = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: size }, uScale: { value: 800 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        attribute float aAlpha; varying float vA; uniform float uSize; uniform float uScale;
        void main(){ vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=uSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        varying float vA; uniform vec3 uColor;
        void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d);
          gl_FragColor=vec4(uColor*(0.6+a), a*vA); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.tmp = new THREE.Vector3();
  }
  update(time, tail, front, uScale, level = 1) {
    this.mat.uniforms.uScale.value = uScale;
    const flow = time * this.flowSpeed;
    for (let i = 0; i < this.n; i++) {
      const s = (i / this.n + flow) % 1;
      this.path.at(s, this.tmp);
      this.pos.set([this.tmp.x, this.tmp.y, this.tmp.z], i * 3);
      this.alpha[i] = s > tail && s < front ? Math.min(1, (s - tail) / 0.02, (front - s) / 0.02) * level : 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/** Diamond-shaped markers for the logical (information) path. A few packets with short tails. */
class PacketFlow {
  constructor(path, maxPackets = 4, tail = 7) {
    this.path = path;
    this.max = maxPackets;
    this.tailN = tail;
    const n = maxPackets * tail;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uSize: { value: 0.3 }, uScale: { value: 800 } },
      vertexShader: `
        attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC;
        uniform float uSize; uniform float uScale;
        void main(){ vA=aAlpha; vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=uSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main(){ vec2 c=abs(gl_PointCoord-0.5); float d=c.x+c.y;
          float a=smoothstep(0.5,0.38,d); float rim=smoothstep(0.30,0.42,d);
          if(a*vA<0.02) discard;
          gl_FragColor=vec4(mix(vC,vec3(1.0),0.35*(1.0-rim)), a*vA); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    this.tmp = new THREE.Vector3();
    this.c = new THREE.Color();
  }
  /** packets: [{ s, alpha, color }] */
  update(packets, uScale) {
    this.mat.uniforms.uScale.value = uScale;
    this.alpha.fill(0);
    packets.slice(0, this.max).forEach((p, k) => {
      this.c.set(p.color);
      for (let i = 0; i < this.tailN; i++) {
        const s = p.s - i * 0.014;
        const idx = k * this.tailN + i;
        if (s < 0 || s > 1) continue;
        this.path.at(s, this.tmp);
        this.pos.set([this.tmp.x, this.tmp.y, this.tmp.z], idx * 3);
        this.color.set([this.c.r, this.c.g, this.c.b], idx * 3);
        this.alpha[idx] = p.alpha * (1 - i / this.tailN);
      }
    });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ push button (cutaway) */
export function buildButton() {
  const x1 = holePos(24, 'e').x, x2 = holePos(27, 'e').x;
  const zE = holePos(24, 'e').z, zF = holePos(24, 'f').z;
  const hx = (x2 - x1) / 2, hz = (zE - zF) / 2;
  const g = new THREE.Group();
  g.position.set((x1 + x2) / 2, BH, (zE + zF) / 2);

  const metal = std('#d4d7dd', 0.3, 0.95);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) cylinderBetween(g, V(sx * hx, -0.25, sz * hz), V(sx * hx, 0.14, sz * hz), 0.03, metal);
  }

  // permanent contact bars: near side (GPIO27) and far side (GND)
  const barA = std('#e0a53a', 0.35, 0.8, { emissive: '#e0a53a', emissiveIntensity: 0.25 });
  const barB = std('#4d7cff', 0.35, 0.8, { emissive: '#4d7cff', emissiveIntensity: 0.25 });
  for (const [mat, sz] of [[barA, 1], [barB, -1]]) {
    box(g, 2 * hx + 0.07, 0.03, 0.07, mat, 0, 0.14, sz * hz);
    box(g, 0.24, 0.03, 0.27, mat, 0, 0.14, sz * (hz - 0.13));
  }

  // translucent housing
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#273045', transparent: true, opacity: 0.3, roughness: 0.25, side: THREE.DoubleSide, depthWrite: false,
  });
  const half = 0.4;
  box(g, 2 * half, 0.04, 2 * half, glass, 0, 0.1, 0);
  for (const s of [-1, 1]) {
    box(g, 0.03, 0.36, 2 * half, glass, s * half, 0.28, 0);
    box(g, 2 * half, 0.36, 0.03, glass, 0, 0.28, s * half);
  }
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * half, 0.36, 2 * half)),
    new THREE.LineBasicMaterial({ color: '#9aa6c8', transparent: true, opacity: 0.7 }),
  );
  edges.position.y = 0.28;
  g.add(edges);

  // moving part: bridge plate, stem, cap
  const moving = new THREE.Group();
  g.add(moving);
  const bridgeMat = std('#e9ebef', 0.25, 1, { emissive: '#ffffff', emissiveIntensity: 0 });
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 28), bridgeMat);
  bridge.position.y = 0.285;
  moving.add(bridge);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.17, 12), std('#2a2d36', 0.5));
  stem.position.y = 0.385;
  moving.add(stem);
  const capMat = std('#2f6bd6', 0.4, 0.05, { emissive: '#2f6bd6', emissiveIntensity: 0 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.2, 32), capMat);
  cap.position.y = 0.56;
  moving.add(cap);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  dome.scale.y = 0.35;
  dome.position.y = 0.66;
  moving.add(dome);

  // generous invisible hit area for mouse and touch
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 16), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.4;
  g.add(hit);

  return {
    group: g, moving, hit, barA, barB, bridgeMat, capMat, hx, hz,
    center: g.position.clone(),
  };
}

/* ------------------------------------------------------------------ the whole scene */
export function buildButtonCircuit() {
  const root = new THREE.Group();
  const pi = buildPi();
  const { group: board, strips } = buildBoard({
    strips: [[7, 'n'], [8, 'n'], [12, 'n'], [24, 'n'], [27, 'n'], [24, 'f'], [27, 'f']],
    labelCols: [7, 8, 12, 24, 27],
  });
  const resistor = buildResistor();
  const led = buildLed();
  const button = buildButton();
  const w17 = buildJumper(11, holePos(12, 'a'), '#ff7a1a', 0.35, 0.235);
  const w6 = buildJumper(6, holePos(7, 'a'), '#3b3b44', 0.35, 0.235);
  const w27 = buildJumper(13, holePos(24, 'a'), '#2fae5a', 0.4, 0.235);
  const w14 = buildJumper(14, holePos(24, 'i'), '#7a5a40', 0.6, 0.235);

  // Where the logic path passes through the processor. It is only a waypoint: nothing is drawn there.
  const nodePos = V(PI_CENTER.x - 0.5, 0.95, PI_CENTER.z + 0.7); // above the SoC spreader

  root.add(pi, board, resistor.group, led.group, button.group, w17.root, w6.root, w27.root, w14.root);
  root.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow && o.material.opacity === 1 && o.material.visible !== false) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  /* ---- paths ---- */
  const SURF = BH + 0.05;
  const pin11 = pinPos(11), pin13 = pinPos(13), pin14 = pinPos(14), pin6 = pinPos(6);
  const hole = (c, r) => holePos(c, r);
  const surf = (h) => V(h.x, SURF, h.z);
  const h12a = hole(12, 'a'), h12c = hole(12, 'c'), h8c = hole(8, 'c'), h8e = hole(8, 'e'), h7e = hole(7, 'e'), h7a = hole(7, 'a');
  const h24a = hole(24, 'a'), h24e = hole(24, 'e'), h24f = hole(24, 'f'), h24i = hole(24, 'i');
  const lx = (h8e.x + h7e.x) / 2;

  // 1) output current: GPIO17 -> wire -> resistor -> LED -> wire -> GND (pin 6)
  const outPts = [], outMarks = {};
  const pushTo = (arr, marks) => (v, name) => {
    arr.push(v.clone());
    if (name) marks[name] = arr.length - 1;
  };
  {
    const push = pushTo(outPts, outMarks);
    push(V(pin11.x, 0.78, pin11.z));
    for (const p of w17.curve.getPoints(60)) push(p);
    push(surf(h12a), 'wire1End');
    push(surf(h12c));
    push(V(h12c.x, BH + 0.2, h12c.z), 'resIn');
    push(V((h12c.x + h8c.x) / 2, BH + 0.2, h12c.z), 'resMid');
    push(V(h8c.x, BH + 0.2, h8c.z), 'resOut');
    push(surf(h8c));
    push(surf(h8e), 'strip8End');
    push(V(h8e.x, BH + 0.45, h8e.z), 'ledIn');
    push(V(lx, BH + 0.85, h8e.z), 'ledApex');
    push(V(h7e.x, BH + 0.45, h7e.z), 'ledOut');
    push(surf(h7e));
    push(surf(h7a), 'strip7End');
    for (const p of w6.curve.getPoints(60).reverse()) push(p);
    push(V(pin6.x, 0.78, pin6.z), 'end');
  }
  const outPath = new Polyline(outPts);
  const OF = {};
  for (const [k, i] of Object.entries(outMarks)) OF[k] = outPath.fractionAt(i);

  // 2) input current (pull-up): GPIO27 pin -> wire -> button (through the closed bridge) -> wire -> GND (pin 14)
  const inPts = [], inMarks = {};
  {
    const push = pushTo(inPts, inMarks);
    const c = button.center;
    push(V(pin13.x, 0.78, pin13.z));
    for (const p of w27.curve.getPoints(60)) push(p);
    push(surf(h24a), 'wireInEnd');
    push(surf(h24e), 'stripN');
    push(V(h24e.x, BH + 0.14, h24e.z));
    push(V(c.x, BH + 0.14, h24e.z), 'barA');
    push(V(c.x, BH + 0.14, c.z + 0.2));
    push(V(c.x, BH + 0.165, c.z), 'bridge');
    push(V(c.x, BH + 0.14, c.z - 0.2));
    push(V(c.x, BH + 0.14, h24f.z), 'barB');
    push(V(h24f.x, BH + 0.14, h24f.z));
    push(surf(h24f), 'stripF');
    push(surf(h24i), 'stripFEnd');
    for (const p of w14.curve.getPoints(60).reverse()) push(p);
    push(V(pin14.x, 0.78, pin14.z), 'end');
  }
  const inPath = new Polyline(inPts);
  const IF = {};
  for (const [k, i] of Object.entries(inMarks)) IF[k] = inPath.fractionAt(i);

  // 3) logic path: button -> GPIO27 -> program (inside the Pi) -> GPIO17 -> LED. Drawn slightly above the wires.
  const logicPts = [], logicMarks = {};
  {
    const push = pushTo(logicPts, logicMarks);
    const c = button.center;
    push(V(c.x, BH + 0.95, c.z), 'button');
    push(V(h24a.x, BH + 0.95, c.z + 0.2));
    for (const p of w27.curve.getPoints(60).reverse()) push(p);
    push(V(pin13.x, 1.1, pin13.z + 0.7), 'gpio27');
    push(V(pin13.x + 0.9, 1.1, pin13.z + 1.8));
    push(nodePos.clone(), 'prog');
    push(V(pin11.x + 0.5, 1.1, pin11.z + 1.3));
    push(V(pin11.x, 1.1, pin11.z + 0.7));
    push(V(pin11.x, 1.31, pin11.z), 'gpio17');
    for (const p of w17.curve.getPoints(60)) push(p);
    push(surf(h12a));
    push(surf(h12c));
    push(V(h12c.x, BH + 0.2, h12c.z));
    push(V(h8c.x, BH + 0.2, h8c.z));
    push(surf(h8e));
    push(V(h8e.x, BH + 0.45, h8e.z));
    push(V(lx, BH + 0.85, h8e.z), 'led');
  }
  logicPts.forEach((p) => (p.y += 0.12));
  const logicPath = new Polyline(logicPts);
  const LF = {};
  for (const [k, i] of Object.entries(logicMarks)) LF[k] = logicPath.fractionAt(i);

  const dashed = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(logicPts),
    new THREE.LineDashedMaterial({ color: '#b388ff', dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.4, depthTest: false }),
  );
  dashed.computeLineDistances();
  dashed.renderOrder = 8;
  root.add(dashed);

  /* ---- particles ---- */
  const outFlow = new ParticleFlow(outPath, { count: 130, size: 0.13, color: '#ffc65a', flowSpeed: 0.2 });
  const inFlow = new ParticleFlow(inPath, { count: 60, size: 0.1, color: '#6fe3ff', flowSpeed: 0.17 });
  const packets = new PacketFlow(logicPath);
  root.add(outFlow.points, inFlow.points, packets.points);

  /* ---- glows ---- */
  const glowTex = glowTexture();
  const sprite = (color, order = 9, depthTest = false) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, depthTest,
    }));
    s.renderOrder = order;
    root.add(s);
    return s;
  };
  const ledTop = V(lx, BH + 0.75, h8e.z);
  const ledGlow = sprite('#ff3b2a', 0, true);
  ledGlow.position.copy(ledTop);
  const ledLight = new THREE.PointLight('#ff3020', 0, 9, 2);
  ledLight.position.set(lx, BH + 1.3, h8e.z + 0.2);
  root.add(ledLight);
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({
      map: glowTex, color: '#ff2a1a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false,
    }),
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(lx, BH + 0.012, h8e.z);
  decal.userData.noShadow = true;
  root.add(decal);

  const pin11Glow = sprite('#ffb23a');
  pin11Glow.position.set(pin11.x, 1.5, pin11.z);
  const pin13Glow = sprite('#ffb23a');
  pin13Glow.position.set(pin13.x, 1.5, pin13.z);
  const btnGlow = sprite('#6fe3ff');
  btnGlow.position.set(button.center.x, BH + 0.45, button.center.z);

  const ringGeo = new THREE.RingGeometry(0.28, 0.34, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const makeRing = (x, z) => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: '#ffd27a', transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    m.position.set(x, PI_Y + PCB_T + HEADER_H + 0.02, z);
    m.renderOrder = 9;
    m.visible = false;
    root.add(m);
    return { mesh: m, t: 99, color: '#ffd27a' };
  };
  const rings = { 11: makeRing(pin11.x, pin11.z), 13: makeRing(pin13.x, pin13.z) };

  /* ---- pop-in ---- */
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
    scalePiece(resistor.group, 0.7, 0.6),
    scalePiece(led.group, 0.85, 0.6),
    scalePiece(button.group, 1.0, 0.7),
    wirePiece(w6, 1.35),
    wirePiece(w17, 1.55),
    wirePiece(w27, 1.75),
    wirePiece(w14, 1.95),
  ];
  let popK = 0; // overall visibility for effects (particles, glows)

  const lv = { w17: 0, s12: 0, res: 0, s8: 0, s7: 0, w6: 0, w27: 0, s24n: 0, s24f: 0, w14: 0 };
  const lerpTo = (cur, target, dt, rate = 12) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
  const amber = new THREE.Color('#e0a53a'), blue = new THREE.Color('#4d7cff');
  const BTN_CENTER = button.center;

  return {
    root,
    button,
    hit: button.hit,
    nodePos,
    fractions: { out: OF, in: IF, logic: LF },
    anchors: {
      pin11, pin13, pin14, pin6,
      pi: V(PI_CENTER.x + 3.4, PI_Y + 1.8, PI_CENTER.z + 1.95),
      resistor: V(PI_CENTER.x - 1.4, BH + 0.2, h12c.z),
      led: ledTop.clone(),
      board: V(5.5 + BOARD.w / 2 - 0.3, BH, -3.3 - BOARD.d / 2 + 0.4),
      button: V(BTN_CENTER.x, BH + 0.78, BTN_CENTER.z),
    },

    setPop(tp) {
      root.visible = tp > 0;
      popK = clamp01((tp - 1.2) / 1.2);
      for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
    },

    pulse(pin, color = '#ffd27a') {
      const r = rings[pin];
      if (r) {
        r.t = 0;
        r.color = color;
      }
    },

    /**
     * s: { out: Signal (GPIO17 + LED), input: Wave (pull-up current), plunger 0..1, gpio27 0..1 (smoothed, 1 = HIGH),
     *      gpio17: 0..1, packets: [{s, alpha, color}] }
     */
    update(time, dt, s, camera, viewportH) {
      const uScale = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const out = s.out, inp = s.input;

      // button animation and contact colours
      button.moving.position.y = -BTN_TRAVEL * s.plunger;
      button.capMat.emissiveIntensity = 0.45 * s.plunger;
      button.bridgeMat.emissiveIntensity = inp.on ? 0.5 : 0;
      button.barA.color.copy(blue).lerp(amber, s.gpio27);
      button.barA.emissive.copy(button.barA.color);
      button.barA.emissiveIntensity = 0.25 + 0.5 * (inp.on ? 1 : 0);
      button.barB.emissiveIntensity = 0.25 + 0.5 * (inp.on ? 1 : 0);

      // energised parts
      const litOut = (c) => (out.tail < c && out.front > c ? 1 : 0);
      const litIn = (c) => (inp.tail < c && inp.front > c ? 1 : 0);
      lv.w17 = lerpTo(lv.w17, litOut(OF.wire1End * 0.5), dt);
      lv.s12 = lerpTo(lv.s12, litOut((OF.wire1End + OF.resIn) / 2), dt);
      lv.res = lerpTo(lv.res, litOut(OF.resMid), dt);
      lv.s8 = lerpTo(lv.s8, litOut((OF.resOut + OF.strip8End) / 2), dt);
      lv.s7 = lerpTo(lv.s7, litOut((OF.ledOut + OF.strip7End) / 2), dt);
      lv.w6 = lerpTo(lv.w6, litOut((OF.strip7End + OF.end) / 2), dt);
      lv.w27 = lerpTo(lv.w27, litIn(IF.wireInEnd * 0.5), dt);
      lv.s24n = lerpTo(lv.s24n, litIn((IF.wireInEnd + IF.stripN) / 2), dt);
      lv.s24f = lerpTo(lv.s24f, litIn((IF.stripF + IF.stripFEnd) / 2), dt);
      lv.w14 = lerpTo(lv.w14, litIn((IF.stripFEnd + IF.end) / 2), dt);

      w17.wireMat.emissive.set('#ff8a1a');
      w17.wireMat.emissiveIntensity = 0.9 * lv.w17;
      w6.wireMat.emissive.set('#ffb35a');
      w6.wireMat.emissiveIntensity = 0.7 * lv.w6;
      w27.wireMat.emissive.set('#5cffa0');
      w27.wireMat.emissiveIntensity = 0.7 * lv.w27;
      w14.wireMat.emissive.set('#6fe3ff');
      w14.wireMat.emissiveIntensity = 0.7 * lv.w14;
      resistor.bodyMat.emissive.set('#ff7a00');
      resistor.bodyMat.emissiveIntensity = 0.22 * lv.res;
      strips[12].opacity = 0.14 + 0.5 * lv.s12;
      strips[8].opacity = 0.14 + 0.5 * lv.s8;
      strips[7].opacity = 0.14 + 0.5 * lv.s7;
      strips[24].opacity = 0.14 + 0.5 * lv.s24n;
      strips['24f'].opacity = 0.14 + 0.5 * lv.s24f;
      strips[27].opacity = 0.14 + 0.5 * lv.s24n;
      strips['27f'].opacity = 0.14 + 0.5 * lv.s24f;

      // LED
      const L = out.led;
      led.shellMat.emissiveIntensity = 2.4 * L;
      led.shellMat.opacity = 0.78 + 0.2 * L;
      led.coreMat.color.setRGB(0.29 + 0.71 * L, 0.05 + 0.6 * L, 0.05 + 0.55 * L);
      ledLight.intensity = 22 * L;
      ledGlow.material.opacity = 0.95 * L;
      ledGlow.scale.setScalar(2.4 + 0.6 * L + 0.05 * Math.sin(time * 9) * L);
      decal.material.opacity = 0.7 * L;

      // pin level glows: GPIO17 amber when HIGH; GPIO27 amber while released (HIGH by pull-up), dark when LOW
      pin11Glow.material.opacity = 0.75 * out.gpio * popK;
      pin11Glow.scale.setScalar(1.2 + 0.15 * Math.sin(time * 6) * out.gpio);
      pin13Glow.material.opacity = 0.55 * s.gpio27 * popK;
      pin13Glow.scale.setScalar(1.1);
      btnGlow.material.opacity = 0.7 * (s.plunger > 0.5 ? 1 : 0) * popK;
      btnGlow.scale.setScalar(1.6);

      for (const r of Object.values(rings)) {
        r.t += dt;
        if (r.t < 0.9) {
          const k = r.t / 0.9;
          r.mesh.visible = true;
          r.mesh.scale.setScalar(0.6 + k * 5);
          r.mesh.material.opacity = (1 - k) * 0.9;
          r.mesh.material.color.set(r.color);
        } else r.mesh.visible = false;
      }

      // particles + packets
      outFlow.update(time, out.tail, out.front, uScale);
      inFlow.update(time, inp.tail, inp.front, uScale);
      packets.update(s.packets, uScale);
      dashed.material.opacity = 0.3 + 0.5 * Math.min(1, s.packets.length);
    },
  };
}

export { ROW_Z, PITCH };
