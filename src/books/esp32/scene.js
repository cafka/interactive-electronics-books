import * as THREE from 'three';
import {
  V, clamp01, std, box, cylinderBetween, BOARD, PITCH, ROW_Z, Polyline,
  buildBoard, buildResistor, buildLed, buildJumperAt, buildBoardJumper,
} from '../../circuit.js';
import { ParticleFlow } from '../../circuit2.js';
import { scalePiece, wirePiece, boardWirePiece } from '../../popin.js';
import { glowTexture } from '../../textures.js';
import { buildEsp32Board, pinLocal, ESP } from './board.js';

/*
 * Chapter 1 scene: ESP32-DevKitC, half-size breadboard, LED + 330 ohm, buzzer driven by a 2N3904 (1 kohm base
 * resistor), and the door sensor (reed switch + magnet) on a small refrigerator or on a cardboard box.
 * Units are centimetres; y = 0 is the page.
 *
 * Wiring (breadboard far half = rows f..j, row j is nearest the ESP32; "far-minus" is the GND rail, "far-plus" the 5V rail):
 *   GPIO25 -> jumper -> (3,j)   1 kohm (3,i)-(7,i)   2N3904 E=(6,f) B=(7,f) C=(8,f)
 *   emitter jumper (6,j) -> GND rail        collector jumper (8,j) -> (10,j)
 *   buzzer "-" (10,g), "+" (12,g)           buzzer + jumper (12,j) -> 5V rail
 *   GPIO26 -> jumper -> (20,j)   330 ohm (20,i)-(16,i)   LED anode (16,f), cathode (15,f)   cathode jumper (15,j) -> GND rail
 *   GPIO27 -> jumper -> (24,j)   reed cable wire A -> (24,g)   reed cable wire B -> GND rail
 *   DevKit GND -> GND rail,  DevKit 5V -> 5V rail
 */

export const EC = V(4.4, 0, -3.2); // ESP32 board centre (USB toward +x, header J2 toward the breadboard)
export const BC = V(5.5, 0, 2.0); // breadboard centre
const BH = BOARD.h;
const SURF = BH + 0.05;
const ESP_TOP = ESP.y + ESP.pcbT;
const HOUSING_TOP = ESP_TOP + 0.62;
export const PIN_COLORS = { 'J2:IO25': '#6fd07a', 'J2:IO26': '#f2c94c', 'J2:IO27': '#6aa6ff', 'J2:GND': '#c9ccd4', 'J2:5V': '#ff7b6b' };

const hole = (col, row) => V(BC.x + (col - 15.5) * PITCH, BH, BC.z + ROW_Z[row]);
const RAIL_Z = { 'far-minus': -1.9, 'far-plus': -2.154 };
const railHole = (i, name) => V(BC.x - 3.556 + i * PITCH + Math.floor(i / 5) * PITCH, BH, BC.z + RAIL_Z[name]);
const espPin = (name) => pinLocal(name, 'J2').add(EC);
const lerpTo = (cur, target, dt, rate = 12) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
const surf = (h) => V(h.x, SURF, h.z);
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

// the door-sensor mounts
export const FC = V(9.675, 0, -5.5); // refrigerator: body x 8.35..11.0, z -6.7..-4.3
const FR = { hingeX: -1.225, front: 1.2, doorW: 2.25, h: 4.4 };
export const BXC = V(9.5, 0, -5.4); // cardboard box: x 8.2..10.8, z -6.3..-4.5
const BX = { w: 2.6, d: 1.8, h: 1.6 };
export const DOOR_MAX = { fridge: 90, box: 100 };
export const CONTACT_CLOSE_DEG = 5; // the reed contact closes below this angle...
export const CONTACT_OPEN_DEG = 7; // ...and opens again above this one (hysteresis)

function plugAt(hole2) {
  const g = new THREE.Group();
  g.position.set(hole2.x, BH, hole2.z);
  box(g, 0.17, 0.4, 0.17, std('#16161a', 0.6), 0, 0.3, 0);
  cylinderBetween(g, V(0, -0.25, 0), V(0, 0.12, 0), 0.03, std('#cfd0d4', 0.3, 0.95));
  return g;
}

/** A two-wire cable of the sensor: tube from the sensor to a plug in the breadboard. */
function buildCable(points, endHole, color) {
  const root = new THREE.Group();
  const end = V(endHole.x, BH + 0.5, endHole.z);
  const curve = new THREE.CatmullRomCurve3([...points, end.clone().add(V(0, 0.45, 0)), end], false, 'centripetal');
  const wireMat = std(color, 0.5, 0, { emissive: '#000000' });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.04, 8, false), wireMat);
  root.add(tube);
  const plug = plugAt(endHole);
  root.add(plug);
  return { root, curve, tube, plug, wireMat };
}
const cablePiece = (c, delay, dur = 0.8) => {
  const count = c.tube.geometry.index.count;
  return {
    delay, dur,
    apply(k) {
      c.tube.visible = k > 0;
      c.tube.geometry.setDrawRange(0, Math.floor((count * clamp01(k * 1.05)) / 3) * 3);
      c.plug.visible = k > 0.93;
    },
  };
};

function labelTexture(text, w, h, bg, fg, size) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `700 ${size}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** TO-92 transistor with the flat face toward +z (E, B, C from left to right). Legs end in the holes e, b, c. */
function buildTransistor(e, b, c) {
  const g = new THREE.Group();
  g.position.set(b.x, BH, b.z);
  const body = std('#151518', 0.5);
  const R = 0.2;
  // rounded back (a full cylinder squashed in z) and a flat front plate
  const round = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.42, 22), body);
  round.scale.z = 0.78;
  round.position.set(0, 0.6, -0.01);
  g.add(round);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), body);
  dome.scale.set(1, 0.7, 0.78);
  dome.position.set(0, 0.81, -0.01);
  g.add(dome);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture('2N3904', 170, 150, '#1b1b20', '#cfd2d8', 38), toneMapped: false }));
  face.position.set(0, 0.66, R * 0.78 + 0.003);
  g.add(face);
  const lead = std('#cfd0d4', 0.3, 0.95);
  for (const h of [e, b, c]) {
    const x = h.x - b.x;
    cylinderBetween(g, V(x, -0.25, 0), V(x, 0.2, 0), 0.022, lead);
    cylinderBetween(g, V(x, 0.2, 0), V(x * 0.55, 0.42, 0), 0.022, lead);
  }
  return { group: g };
}

/** Magnetic buzzer, 12 mm: "+" and "-" pins in the holes given. */
function buildBuzzer(minus, plus) {
  const g = new THREE.Group();
  const cx = (minus.x + plus.x) / 2;
  g.position.set(cx, BH, minus.z);
  const body = std('#0e0e11', 0.45);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.95, 36), body);
  cyl.position.y = 0.475 + 0.02;
  g.add(cyl);
  const topMat = new THREE.MeshStandardMaterial({
    map: labelTexture('+', 256, 256, '#111115', '#e6e6ea', 120), roughness: 0.5, emissive: '#ff8a1a', emissiveIntensity: 0,
  });
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.58, 36), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.97;
  g.add(top);
  const hole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 16), std('#000000', 0.9));
  hole2.position.y = 0.975;
  g.add(hole2);
  const lead = std('#cfd0d4', 0.3, 0.95);
  for (const [h, s] of [[minus, 0], [plus, 1]]) {
    const x = h.x - cx;
    cylinderBetween(g, V(x, -0.25, 0), V(x, 0.1, 0), 0.025, lead);
    void s;
  }
  return { group: g, topMat };
}

export function buildDoorScene() {
  const root = new THREE.Group();

  /* ---------------- ESP32 board and breadboard ---------------- */
  const esp = buildEsp32Board(PIN_COLORS);
  esp.group.position.copy(EC);
  const { group: board, strips } = buildBoard({
    strips: [3, 6, 7, 8, 10, 12, 15, 16, 20, 24].map((c) => [c, 'f']),
    labelCols: [3, 7, 10, 12, 16, 20, 24],
    rails: ['far-minus', 'far-plus'],
  });
  board.position.set(BC.x, 0, BC.z);
  root.add(esp.group, board);
  const S = (col) => strips[`${col}f`];

  /* ---------------- parts on the breadboard ---------------- */
  const resBase = buildResistor({ a: hole(3, 'i'), b: hole(7, 'i'), colors: ['#6b3a1c', '#111111', '#cc2a1a', '#d4af37'] }); // 1 kohm
  const resLed = buildResistor({ a: hole(16, 'i'), b: hole(20, 'i') }); // 330 ohm
  const led = buildLed({ cathode: hole(15, 'f'), anode: hole(16, 'f'), color: '#ff2f2f', emissive: '#ff1a10', coreOff: '#4a0c0c' });
  const tr = buildTransistor(hole(6, 'f'), hole(7, 'f'), hole(8, 'f'));
  const bz = buildBuzzer(hole(10, 'g'), hole(12, 'g'));
  root.add(resBase.group, resLed.group, led.group, tr.group, bz.group);

  /* ---------------- jumpers ---------------- */
  const usedRail = new Set();
  const railNear = (x, name) => {
    let best = -1, bd = 9;
    for (let i = 0; i < 25; i++) {
      if (usedRail.has(`${name}${i}`)) continue;
      const d = Math.abs(railHole(i, name).x - x);
      if (d < bd) { bd = d; best = i; }
    }
    usedRail.add(`${name}${best}`);
    return best;
  };
  const R = {
    emitter: railNear(hole(6, 'j').x, 'far-minus'),
    cathode: railNear(hole(15, 'j').x, 'far-minus'),
    gnd: railNear(8.3, 'far-minus'),
    reedB: railNear(8.85, 'far-minus'),
    buzzPlus: railNear(hole(12, 'j').x, 'far-plus'),
    v5: railNear(9.0, 'far-plus'),
  };
  const wireIO25 = buildJumperAt(espPin('IO25'), HOUSING_TOP, hole(3, 'j'), '#2fae5a', 0.35, 0.235);
  const wireIO26 = buildJumperAt(espPin('IO26'), HOUSING_TOP, hole(20, 'j'), '#f0c020', 0.35, 0.235);
  const wireIO27 = buildJumperAt(espPin('IO27'), HOUSING_TOP, hole(24, 'j'), '#3f7be0', 0.35, 0.235);
  const wireGnd = buildJumperAt(espPin('GND'), HOUSING_TOP, railHole(R.gnd, 'far-minus'), '#3b3b44', 0.35, 0.235);
  const wire5v = buildJumperAt(espPin('5V'), HOUSING_TOP, railHole(R.v5, 'far-plus'), '#d62f2f', 0.35, 0.235);
  const jEmitter = buildBoardJumper(hole(6, 'j'), railHole(R.emitter, 'far-minus'), '#3b3b44', 0.4);
  const jCathode = buildBoardJumper(hole(15, 'j'), railHole(R.cathode, 'far-minus'), '#3b3b44', 0.4);
  const jCollector = buildBoardJumper(hole(8, 'j'), hole(10, 'j'), '#8a52d8', 0.4);
  const jBuzzPlus = buildBoardJumper(hole(12, 'j'), railHole(R.buzzPlus, 'far-plus'), '#d62f2f', 0.4);
  root.add(wireIO25.root, wireIO26.root, wireIO27.root, wireGnd.root, wire5v.root, jEmitter.root, jCathode.root, jCollector.root, jBuzzPlus.root);

  /* ---------------- USB cable (leaves toward the back, clear of the swinging door) ---------------- */
  const usb = new THREE.Group();
  const usbEnd = V(EC.x + ESP.len / 2 - 0.3 + 0.22 + 0.375, ESP_TOP + 0.13, EC.z);
  box(usb, 0.7, 0.2, 0.6, std('#1a1a1e', 0.5), usbEnd.x + 0.35, usbEnd.y, usbEnd.z);
  const usbCurve = new THREE.CatmullRomCurve3([
    V(usbEnd.x + 0.7, usbEnd.y, usbEnd.z), V(usbEnd.x + 0.95, 0.5, usbEnd.z - 0.2), V(usbEnd.x + 0.85, 0.3, -3.9),
    V(7.9, 0.16, -4.9), V(7.1, 0.14, -6.1), V(6.4, 0.13, -7.4),
  ], false, 'centripetal');
  usb.add(new THREE.Mesh(new THREE.TubeGeometry(usbCurve, 60, 0.12, 8, false), std('#1d1d22', 0.7)));
  root.add(usb);

  /* ---------------- refrigerator ---------------- */
  const fridge = new THREE.Group();
  fridge.position.copy(FC);
  const white = std('#dde4e8', 0.45, 0.05), steel = std('#aab4bb', 0.35, 0.7);
  box(fridge, 2.65, FR.h, 2.4, white, 0, FR.h / 2, 0); // body x 8.35..11.0
  box(fridge, 2.65, 0.05, 2.4, std('#bcc6cc', 0.5), 0, 0.03, 0);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(FR.hingeX, 0, FR.front);
  fridge.add(doorPivot);
  const doorMat = std('#eef2f4', 0.35, 0.05);
  const doorMesh = box(doorPivot, FR.doorW, FR.h - 0.1, 0.15, doorMat, FR.doorW / 2, FR.h / 2, -0.075 + 0.001);
  const freezerLine = box(doorPivot, FR.doorW, 0.03, 0.02, std('#9aa5ac', 0.5), FR.doorW / 2, FR.h * 0.68, 0.005);
  const handle = box(doorPivot, 0.1, 1.1, 0.1, steel, FR.doorW - 0.2, 2.3, 0.1);
  const handle2 = box(doorPivot, 0.1, 0.7, 0.1, steel, FR.doorW - 0.2, 3.6, 0.1);
  // magnet on a small bracket that reaches in front of the sensor
  const bracket = box(doorPivot, 0.42, 0.9, 0.08, std('#8f98a0', 0.45, 0.4), FR.doorW + 0.19, 2.9, 0.115);
  const magnet = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 22), std('#c9ced4', 0.25, 0.9));
  magnet.rotation.x = Math.PI / 2;
  magnet.position.set(FR.doorW + 0.3, 2.9, 0.065);
  doorPivot.add(magnet);
  const magRed = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), std('#d6453a', 0.5));
  magRed.position.set(FR.doorW + 0.3, 2.9, 0.121);
  doorPivot.add(magRed);
  // sensor on the body, beside the free edge of the door
  const SX = FR.hingeX + FR.doorW + 0.11; // sensor centre x (local)
  const sensorFridge = new THREE.Group();
  sensorFridge.position.set(SX, 2.9, FR.front + 0.085);
  fridge.add(sensorFridge);
  const sensorMat = std('#ececec', 0.5);
  box(sensorFridge, 0.2, 1.0, 0.17, sensorMat, 0, 0, 0);
  const sensorLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#2a3a2a', toneMapped: false }));
  sensorLamp.position.set(0, 0.38, 0.09);
  sensorFridge.add(sensorLamp);
  root.add(fridge);

  /* ---------------- cardboard box ---------------- */
  const cardbox = new THREE.Group();
  cardbox.position.copy(BXC);
  const cardMat = std('#b78a58', 0.85), cardDark = std('#9c7344', 0.85);
  box(cardbox, BX.w, BX.h, BX.d, cardMat, 0, BX.h / 2, 0);
  box(cardbox, BX.w + 0.01, 0.03, 0.03, cardDark, 0, BX.h * 0.5, BX.d / 2 + 0.005);
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, BX.h, -BX.d / 2);
  cardbox.add(lidPivot);
  const lidMesh = box(lidPivot, BX.w + 0.1, 0.07, BX.d + 0.3, std('#c59a66', 0.85), 0, 0.035, (BX.d + 0.3) / 2 + 0.0);
  const lidMagnet = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 22), std('#c9ced4', 0.25, 0.9));
  lidMagnet.position.set(0.85, -0.05, BX.d + 0.12);
  lidPivot.add(lidMagnet);
  const sensorBox = new THREE.Group();
  sensorBox.position.set(0.85, BX.h - 0.2, BX.d / 2 + 0.085);
  cardbox.add(sensorBox);
  box(sensorBox, 0.9 * 0.5, 0.36, 0.17, sensorMat, 0, 0, 0);
  const sensorLamp2 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#2a3a2a', toneMapped: false }));
  sensorLamp2.position.set(0, 0.1, 0.09);
  sensorBox.add(sensorLamp2);
  root.add(cardbox);

  // reed-sensor cables: one pair per mount; both end in the same two breadboard holes
  const holeA = hole(24, 'g');
  const holeB = railHole(R.reedB, 'far-minus');
  const F = (x, y, z) => V(FC.x + x, y, FC.z + z);
  const Bz = (x, y, z) => V(BXC.x + x, y, BXC.z + z);
  const tailA = [V(10.85, 0.1, 0.9), V(10.55, 0.95, 1.3), V(9.6, 1.25, 1.4), V(8.4, 1.25, 1.38)];
  const tailB = [V(10.85, 0.1, 0.25), V(10.4, 0.95, 0.18), V(9.7, 1.25, 0.14), V(9.0, 1.35, 0.1)];
  const cables = {
    fridge: {
      a: buildCable([F(SX - 0.05, 2.4, FR.front + 0.1), F(SX - 0.04, 1.4, FR.front + 0.13), V(FC.x + SX, 0.4, -4.05), V(10.8, 0.08, -3.4), V(10.85, 0.08, -2.0), ...tailA], holeA, '#e6e6e6'),
      b: buildCable([F(SX + 0.05, 2.4, FR.front + 0.1), F(SX + 0.06, 1.4, FR.front + 0.13), V(FC.x + SX + 0.1, 0.4, -4.0), V(10.9, 0.08, -3.4), V(10.95, 0.08, -2.0), ...tailB], holeB, '#8a5a34'),
    },
    box: {
      a: buildCable([Bz(0.8, BX.h - 0.38, BX.d / 2 + 0.1), Bz(0.8, 0.8, BX.d / 2 + 0.13), V(10.3, 0.1, -4.2), V(10.75, 0.08, -3.0), V(10.85, 0.08, -2.0), ...tailA], holeA, '#e6e6e6'),
      b: buildCable([Bz(0.9, BX.h - 0.38, BX.d / 2 + 0.1), Bz(0.9, 0.8, BX.d / 2 + 0.13), V(10.4, 0.1, -4.15), V(10.85, 0.08, -3.0), V(10.95, 0.08, -2.0), ...tailB], holeB, '#8a5a34'),
    },
  };
  for (const k of ['fridge', 'box']) root.add(cables[k].a.root, cables[k].b.root);

  root.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow && o.material.opacity === 1 && o.material.visible !== false) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  /* ---------------- current paths ---------------- */
  const pinTipTop = (name) => V(espPin(name).x, 0.78, espPin(name).z);
  const curvePts = (c, n = 50) => c.getPoints(n);
  const build = () => {
    const pts = [];
    const api = {
      p: (v) => (pts.push(v.clone()), api),
      all: (arr) => (arr.forEach((v) => pts.push(v.clone())), api),
      done: () => new Polyline(pts),
    };
    return api;
  };
  const gndReturn = (b) => {
    const r = railHole(R.emitter, 'far-minus'), g = railHole(R.gnd, 'far-minus');
    return b.p(V(r.x, SURF, r.z)).p(V(g.x, SURF, g.z)).all(curvePts(wireGnd.curve, 60).reverse()).p(pinTipTop('GND'));
  };
  const toGnd = (b, fromRailHole) => {
    const g = railHole(R.gnd, 'far-minus');
    return b.p(V(fromRailHole.x, SURF, fromRailHole.z)).p(V(g.x, SURF, g.z)).all(curvePts(wireGnd.curve, 60).reverse()).p(pinTipTop('GND'));
  };
  void gndReturn;
  const emitterJ = () => curvePts(jEmitter.curve, 30);
  const hCa = { a: hole(15, 'f'), j: hole(15, 'j') };

  const ledPath = (() => {
    const b = build().p(pinTipTop('IO26')).all(curvePts(wireIO26.curve, 60));
    const j20 = hole(20, 'j'), i20 = hole(20, 'i'), i16 = hole(16, 'i'), f16 = hole(16, 'f');
    b.p(surf(j20)).p(surf(i20)).p(V(i20.x, BH + 0.2, i20.z)).p(V((i20.x + i16.x) / 2, BH + 0.2, i20.z)).p(V(i16.x, BH + 0.2, i16.z)).p(surf(i16)).p(surf(f16));
    b.p(V(f16.x, BH + 0.45, f16.z)).p(V((f16.x + hCa.a.x) / 2, BH + 0.85, f16.z)).p(V(hCa.a.x, BH + 0.45, hCa.a.z)).p(surf(hCa.a)).p(surf(hCa.j));
    b.all(curvePts(jCathode.curve, 30));
    return toGnd(b, railHole(R.cathode, 'far-minus')).done();
  })();
  const buzzPath = (() => {
    const b = build().p(pinTipTop('5V')).all(curvePts(wire5v.curve, 60));
    const bp = railHole(R.buzzPlus, 'far-plus'), j12 = hole(12, 'j'), g12 = hole(12, 'g'), g10 = hole(10, 'g'), j10 = hole(10, 'j');
    b.p(V(railHole(R.v5, 'far-plus').x, SURF, railHole(R.v5, 'far-plus').z)).p(V(bp.x, SURF, bp.z)).all(curvePts(jBuzzPlus.curve, 30));
    b.p(surf(j12)).p(surf(g12)).p(V(g12.x, BH + 0.5, g12.z)).p(V((g12.x + g10.x) / 2, BH + 1.0, g12.z)).p(V(g10.x, BH + 0.5, g10.z)).p(surf(g10)).p(surf(j10));
    const j8 = hole(8, 'j'), f8 = hole(8, 'f'), f6 = hole(6, 'f'), j6 = hole(6, 'j');
    b.all(curvePts(jCollector.curve, 24)).p(surf(f8)).p(V(f8.x, BH + 0.5, f8.z)).p(V(f6.x, BH + 0.5, f6.z)).p(surf(f6)).p(surf(j6));
    void j8;
    b.all(emitterJ());
    return toGnd(b, railHole(R.emitter, 'far-minus')).done();
  })();
  const basePath = (() => {
    const b = build().p(pinTipTop('IO25')).all(curvePts(wireIO25.curve, 60));
    const j3 = hole(3, 'j'), i3 = hole(3, 'i'), i7 = hole(7, 'i'), f7 = hole(7, 'f'), f6 = hole(6, 'f'), j6 = hole(6, 'j');
    b.p(surf(j3)).p(surf(i3)).p(V(i3.x, BH + 0.2, i3.z)).p(V((i3.x + i7.x) / 2, BH + 0.2, i3.z)).p(V(i7.x, BH + 0.2, i7.z)).p(surf(i7)).p(surf(f7));
    b.p(V(f7.x, BH + 0.5, f7.z)).p(V(f6.x, BH + 0.5, f6.z)).p(surf(f6)).p(surf(j6)).all(emitterJ());
    return toGnd(b, railHole(R.emitter, 'far-minus')).done();
  })();
  const reedPaths = {};
  for (const k of ['fridge', 'box']) {
    const b = build().p(pinTipTop('IO27')).all(curvePts(wireIO27.curve, 60));
    const j24 = hole(24, 'j'), g24 = hole(24, 'g');
    b.p(surf(j24)).p(surf(g24)).all(curvePts(cables[k].a.curve, 90).reverse());
    b.all(curvePts(cables[k].b.curve, 90));
    reedPaths[k] = toGnd(b, holeB).done();
  }
  const flows = {
    led: new ParticleFlow(ledPath, { count: 110, size: 0.13, color: '#ffc65a', flowSpeed: 0.2 }),
    buzz: new ParticleFlow(buzzPath, { count: 150, size: 0.13, color: '#ff9a4a', flowSpeed: 0.24 }),
    base: new ParticleFlow(basePath, { count: 70, size: 0.1, color: '#7be3a0', flowSpeed: 0.16 }),
    fridge: new ParticleFlow(reedPaths.fridge, { count: 90, size: 0.1, color: '#6fe3ff', flowSpeed: 0.12 }),
    box: new ParticleFlow(reedPaths.box, { count: 80, size: 0.1, color: '#6fe3ff', flowSpeed: 0.12 }),
  };
  root.add(...Object.values(flows).map((f) => f.points));

  /* ---------------- glows ---------------- */
  const glowTex = glowTexture();
  const sprite = (color, order = 9, depthTest = false) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, depthTest }));
    s.renderOrder = order;
    root.add(s);
    return s;
  };
  const lx = (hole(15, 'f').x + hole(16, 'f').x) / 2, ledTop = V(lx, BH + 0.75, hole(15, 'f').z);
  const halo = sprite('#ff3b2a', 0, true);
  halo.position.copy(ledTop);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: glowTex, color: '#ff2a1a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(lx, BH + 0.012, ledTop.z);
  decal.userData.noShadow = true;
  root.add(decal);
  const ledLight = new THREE.PointLight('#ff3020', 0, 9, 2);
  ledLight.position.set(lx, BH + 1.3, ledTop.z + 0.2);
  root.add(ledLight);
  const buzzTop = V(bz.group.position.x, BH + 1.0, bz.group.position.z);
  const buzzGlow = sprite('#ffb04a', 0, true);
  buzzGlow.position.copy(buzzTop);
  const waves = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.66, 40), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(buzzTop.x, BH + 1.02, buzzTop.z);
    m.userData.noShadow = true;
    root.add(m);
    return m;
  });
  const pinGlow = {};
  for (const [k, name, color] of [['reed', 'IO27', '#6aa6ff'], ['led', 'IO26', '#ffcf6b'], ['buzzer', 'IO25', '#6fd07a']]) {
    const s = sprite(color);
    const p = espPin(name);
    s.position.set(p.x, 1.35, p.z);
    s.scale.setScalar(0.75);
    pinGlow[k] = s;
  }
  const sensorPos = F(SX, 2.9, FR.front + 0.1), sensorPosBox = Bz(0.85, BX.h - 0.1, BX.d / 2 + 0.1);
  const contactGlow = sprite('#6fe3ff', 9, false);
  contactGlow.scale.setScalar(0.9);
  // the field: a line between the magnet and the sensor, visible when they are close
  const fieldMat = new THREE.MeshBasicMaterial({ color: '#6fe3ff', transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const field = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), fieldMat);
  field.renderOrder = 9;
  field.userData.noShadow = true;
  root.add(field);

  const ringGeo = new THREE.RingGeometry(0.2, 0.25, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = {};
  for (const [k, name] of [['reed', 'IO27'], ['led', 'IO26'], ['buzzer', 'IO25']]) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const p = espPin(name);
    m.position.set(p.x, ESP_TOP + 0.2, p.z);
    m.renderOrder = 9;
    m.visible = false;
    root.add(m);
    rings[k] = { mesh: m, t: 99, color: '#ffd27a' };
  }

  /* ---------------- pop-in ---------------- */
  const pieces = [scalePiece(esp.group, 0, 0.9, 1.6), scalePiece(board, 0.2, 0.9, 1.6)];
  pieces.push(scalePiece(fridge, 0.5, 0.8, 1.5), scalePiece(cardbox, 0.5, 0.8, 1.5));
  pieces.push(scalePiece(resBase.group, 0.8, 0.5), scalePiece(tr.group, 0.9, 0.5), scalePiece(bz.group, 1.0, 0.5), scalePiece(resLed.group, 1.1, 0.5), scalePiece(led.group, 1.2, 0.5));
  [jEmitter, jCathode, jCollector, jBuzzPlus].forEach((w, k) => pieces.push(boardWirePiece(w, 1.4 + k * 0.1, 0.5)));
  pieces.push(wirePiece(wireGnd, 1.7), wirePiece(wire5v, 1.8), wirePiece(wireIO25, 1.95), wirePiece(wireIO26, 2.1), wirePiece(wireIO27, 2.25));
  for (const k of ['fridge', 'box']) pieces.push(cablePiece(cables[k].a, 2.4), cablePiece(cables[k].b, 2.5));
  pieces.push({ delay: 0.3, dur: 0.6, apply(k) { usb.visible = k > 0.5; } });
  const POP_DURATION = 3.5;
  let popK = 0;

  let mount = 'fridge';
  const hitMeshes = { fridge: [doorMesh, handle, handle2, bracket, magnet], box: [lidMesh, lidMagnet] };
  let lastTp = 0;
  const applyPop = (tp) => {
    lastTp = tp;
    root.visible = tp > 0;
    popK = clamp01((tp - 1.2) / 1.2);
    for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
    // only the chosen mount is shown, whatever the pop-in did
    fridge.visible = fridge.visible && mount === 'fridge';
    cardbox.visible = cardbox.visible && mount === 'box';
    for (const k of ['fridge', 'box']) {
      const show = k === mount;
      cables[k].a.root.visible = show && tp > 2.4;
      cables[k].b.root.visible = show && tp > 2.5;
    }
  };
  const setMount = (m) => {
    mount = m;
    applyPop(lastTp);
  };
  const amber = new THREE.Color('#e0a53a');
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const lv = { gnd: 0, v5: 0 };
  const waveT = [0, 0.33, 0.66];

  const doorAnchors = () => ({ sensor: mount === 'fridge' ? sensorPos : sensorPosBox });

  return {
    root,
    popDuration: POP_DURATION,
    setMount,
    get mount() { return mount; },
    hitMeshes: () => hitMeshes[mount],
    anchors: {
      esp: V(EC.x - 0.6, ESP_TOP + 0.5, EC.z - 0.6),
      pin: { reed: V(espPin('IO27').x, 1.35, espPin('IO27').z), led: V(espPin('IO26').x, 1.35, espPin('IO26').z), buzzer: V(espPin('IO25').x, 1.35, espPin('IO25').z), gnd: V(espPin('GND').x, 1.35, espPin('GND').z), v5: V(espPin('5V').x, 1.35, espPin('5V').z) },
      led: ledTop.clone(),
      buzzer: V(buzzTop.x, BH + 1.25, buzzTop.z),
      transistor: V(hole(7, 'f').x, BH + 1.05, hole(7, 'f').z),
      resBase: V((hole(3, 'i').x + hole(7, 'i').x) / 2, BH + 0.3, hole(3, 'i').z),
      resLed: V((hole(16, 'i').x + hole(20, 'i').x) / 2, BH + 0.3, hole(16, 'i').z),
      sensor: { fridge: sensorPos.clone().add(V(0, 0.2, 0)), box: sensorPosBox.clone().add(V(0, 0.3, 0)) },
      door: { fridge: F(FR.hingeX + FR.doorW * 0.55, 3.9, FR.front + 0.1), box: Bz(0, BX.h + 0.5, 0.2) },
      magnet: { fridge: F(FR.hingeX + FR.doorW + 0.3, 3.5, FR.front + 0.1), box: Bz(0.85, BX.h + 0.2, BX.d + 0.1) },
      board: V(BC.x + BOARD.w / 2 - 0.3, BH, BC.z + BOARD.d / 2 - 0.4),
    },
    /** Door angle (degrees) under the pointer, or null. The ray is intersected with the plane the door moves in. */
    angleFromRay(raycaster, camera) {
      const hit = new THREE.Vector3();
      if (mount === 'fridge') {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.3);
        if (!raycaster.ray.intersectPlane(plane, hit)) return null;
        const hx = FC.x + FR.hingeX, hz = FC.z + FR.front;
        return deg(Math.atan2(hit.z - hz, hit.x - hx));
      }
      const hy = BX.h, hz = BXC.z - BX.d / 2;
      const n = new THREE.Vector3(0, camera.position.y - hy, camera.position.z - hz).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, V(BXC.x, hy, hz));
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return deg(Math.atan2(hit.y - hy, hit.z - hz));
    },
    setPop: applyPop,
    pulse(key, color = '#ffd27a') {
      const r = rings[key];
      if (r) {
        r.t = 0;
        r.color = color;
      }
    },

    /**
     * s: { door (deg), contact (bool, true = closed), reed (0..1 smoothed level of the pin, 1 = HIGH), led (0..1),
     *      buzzer (0..1), input (0..1 pull-up current), base (0..1) }
     */
    update(time, dt, s, camera, viewportH) {
      const uScale = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
      // door / lid
      doorPivot.rotation.y = -rad(mount === 'fridge' ? s.door : 0);
      lidPivot.rotation.x = -rad(mount === 'box' ? s.door : 0);

      // field line and contact glow between the magnet and the sensor
      const mw = (mount === 'fridge' ? magnet : lidMagnet).getWorldPosition(tmpA);
      const sp = mount === 'fridge' ? sensorPos : sensorPosBox;
      tmpB.copy(sp);
      const dist = mw.distanceTo(tmpB);
      field.position.copy(mw).lerp(tmpB, 0.5);
      field.scale.set(1, Math.max(dist, 0.01), 1);
      field.quaternion.setFromUnitVectors(V(0, 1, 0), tmpB.clone().sub(mw).normalize());
      const near = clamp01(1 - (dist - 0.15) / 2.2);
      fieldMat.opacity = (s.contact ? 0.85 : 0.35 * near * near) * popK;
      const lamp = mount === 'fridge' ? sensorLamp : sensorLamp2;
      sensorLamp.material.color.set(s.contact && mount === 'fridge' ? '#5cff8a' : '#3a2a22');
      sensorLamp2.material.color.set(s.contact && mount === 'box' ? '#5cff8a' : '#3a2a22');
      void lamp;
      contactGlow.position.copy(sp).add(V(0, 0, 0.25));
      contactGlow.material.opacity = (s.contact ? 0.8 : 0.0) * popK;
      contactGlow.scale.setScalar(0.9 + 0.05 * Math.sin(time * 6));

      // LED
      const L = s.led;
      led.shellMat.emissiveIntensity = 2.4 * L;
      led.shellMat.opacity = 0.78 + 0.2 * L;
      led.coreMat.color.setRGB(0.29 + 0.71 * L, 0.05 + 0.6 * L, 0.05 + 0.55 * L);
      halo.material.opacity = 0.95 * L;
      halo.scale.setScalar(2.2 + 0.5 * L);
      decal.material.opacity = 0.65 * L;
      ledLight.intensity = 22 * L;
      wireIO26.wireMat.emissive.set('#ffcf6b');
      wireIO26.wireMat.emissiveIntensity = 0.9 * L;
      resLed.bodyMat.emissive.set('#ff7a00');
      resLed.bodyMat.emissiveIntensity = 0.22 * L;
      jCathode.wireMat.emissive.set('#ffb35a');
      jCathode.wireMat.emissiveIntensity = 0.7 * L;
      S(20).opacity = S(16).opacity = S(15).opacity = 0.14 + 0.5 * L;

      // buzzer branch
      const B = s.buzzer;
      bz.topMat.emissiveIntensity = 0.35 * B;
      buzzGlow.material.opacity = 0.75 * B;
      buzzGlow.scale.setScalar(1.8 + 0.4 * B);
      waves.forEach((w, i) => {
        waveT[i] = (waveT[i] + dt * 0.9 * B) % 1;
        const k = waveT[i];
        w.visible = B > 0.05;
        w.scale.setScalar(1 + k * 2.4);
        w.material.opacity = (1 - k) * 0.7 * B;
      });
      for (const c of [3, 7, 6, 8, 10, 12]) S(c).opacity = 0.14 + 0.5 * Math.max(B, s.base);
      wire5v.wireMat.emissive.set('#ff6a5a');
      wire5v.wireMat.emissiveIntensity = 0.8 * B;
      jBuzzPlus.wireMat.emissive.set('#ff6a5a');
      jBuzzPlus.wireMat.emissiveIntensity = 0.7 * B;
      jCollector.wireMat.emissive.set('#b58cff');
      jCollector.wireMat.emissiveIntensity = 0.7 * B;
      wireIO25.wireMat.emissive.set('#7be3a0');
      wireIO25.wireMat.emissiveIntensity = 0.7 * s.base;
      resBase.bodyMat.emissive.set('#7be3a0');
      resBase.bodyMat.emissiveIntensity = 0.18 * s.base;
      jEmitter.wireMat.emissive.set('#ffb35a');
      jEmitter.wireMat.emissiveIntensity = 0.7 * Math.max(B, L);

      // ground return and rails
      const gnd = Math.max(L, B, s.input);
      lv.gnd = lerpTo(lv.gnd, gnd, dt);
      lv.v5 = lerpTo(lv.v5, B, dt);
      wireGnd.wireMat.emissive.set('#ffb35a');
      wireGnd.wireMat.emissiveIntensity = 0.7 * lv.gnd;
      strips['rail:far-minus'].opacity = 0.14 + 0.5 * lv.gnd;
      strips['rail:far-plus'].opacity = 0.14 + 0.5 * lv.v5;
      S(24).opacity = 0.14 + 0.5 * s.input;

      // input: the pin is HIGH (pull-up) until the closed contact joins it to GND
      pinGlow.reed.material.opacity = 0.6 * s.reed * popK;
      pinGlow.led.material.opacity = 0.7 * s.led * popK;
      pinGlow.buzzer.material.opacity = 0.7 * s.buzzer * popK;
      wireIO27.wireMat.emissive.set('#6fe3ff');
      wireIO27.wireMat.emissiveIntensity = 0.7 * s.input;
      for (const k of ['fridge', 'box']) {
        cables[k].a.wireMat.emissive.set('#6fe3ff');
        cables[k].a.wireMat.emissiveIntensity = 0.5 * s.input;
        cables[k].b.wireMat.emissive.set('#6fe3ff');
        cables[k].b.wireMat.emissiveIntensity = 0.5 * s.input;
      }

      for (const r of Object.values(rings)) {
        r.t += dt;
        if (r.t < 0.9) {
          const k = r.t / 0.9;
          r.mesh.visible = true;
          r.mesh.scale.setScalar(0.6 + k * 3.2);
          r.mesh.material.opacity = (1 - k) * 0.9;
          r.mesh.material.color.set(r.color);
        } else r.mesh.visible = false;
      }

      flows.led.update(time, 0, 1, uScale, L > 0.03 ? L : 0);
      flows.buzz.update(time, 0, 1, uScale, B > 0.03 ? B : 0);
      flows.base.update(time, 0, 1, uScale, s.base > 0.03 ? s.base : 0);
      flows.fridge.update(time, 0, 1, uScale, mount === 'fridge' && s.input > 0.03 ? s.input : 0);
      flows.box.update(time, 0, 1, uScale, mount === 'box' && s.input > 0.03 ? s.input : 0);
      void amber;
      void doorAnchors;
      void freezerLine;
      void magRed;
    },
  };
}
