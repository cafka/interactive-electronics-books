import * as THREE from 'three';
import {
  V, clamp01, std, box, cylinderBetween, BOARD, PITCH, ROW_Z, Polyline,
  buildBoard, buildResistor, buildLed, buildJumperAt, buildBoardJumper,
} from '../../circuit.js';
import { ParticleFlow } from '../../circuit2.js';
import { scalePiece, wirePiece, boardWirePiece } from '../../popin.js';
import { glowTexture } from '../../textures.js';
import { buildEsp32Board, pinLocal, ESP } from './board.js';
import { EC, BC, buildCable, cablePiece, labelTexture } from './scene.js';

/*
 * Chapter 2 scene: ESP32-DevKitC and the same half-size breadboard as chapter 1, now with a soil sensor, a pump
 * switched by a MOSFET, a status LED and a button, plus the water side: tank, pump, hose, pot with soil and a plant.
 * Units are centimetres; y = 0 is the page. The pot, the tank and the sensor are drawn smaller than real ones, so the
 * whole circuit fits on the page (the board and the electronic parts are at real size).
 *
 * Breadboard map (far half = rows f..j, row j nearest the ESP32; far-minus is the GND rail, far-plus the 5V rail):
 *   3V3  -> jumper -> (2,j)     sensor VCC wire (2,g)
 *   IO34 -> jumper -> (6,j)     sensor AOUT wire (6,g)     100 kohm (6,i)-(9,i)    jumper (9,j) -> GND rail    sensor GND wire (9,g)
 *   IO25 -> jumper -> (11,j)    100 ohm (11,i)-(15,i)      MOSFET G=(15,f) D=(16,f) S=(17,f)
 *   10 kohm (15,h)-(19,h)       jumper (19,j) -> GND rail  jumper (17,j) -> GND rail (source)
 *   diode anode (16,i), cathode (20,i)   jumper (20,j) -> 5V rail   pump "-" wire (16,j)   pump "+" wire -> 5V rail
 *   470 uF capacitor: "+" leg in the 5V rail, "-" leg in the GND rail
 *   IO26 -> jumper -> (22,j)    330 ohm (22,i)-(26,i)      LED anode (26,f), cathode (25,f)    jumper (25,j) -> GND rail
 *   IO27 -> jumper -> (28,j)    button legs (28,g) (28,i) (30,g) (30,i)    jumper (30,j) -> GND rail
 *   ESP32 GND -> GND rail,  ESP32 5V -> 5V rail
 */

const BH = BOARD.h;
const SURF = BH + 0.05;
const ESP_TOP = ESP.y + ESP.pcbT;
const HOUSING_TOP = ESP_TOP + 0.62;
export const PIN_COLORS = {
  'J2:3V3': '#8fd3ff', 'J2:IO34': '#c58cff', 'J2:IO25': '#6fd07a', 'J2:IO26': '#f2c94c', 'J2:IO27': '#6aa6ff', 'J2:GND': '#c9ccd4', 'J2:5V': '#ff7b6b',
};

const hole = (col, row) => V(BC.x + (col - 15.5) * PITCH, BH, BC.z + ROW_Z[row]);
const RAIL_Z = { 'far-minus': -1.9, 'far-plus': -2.154 };
const railHole = (i, name) => V(BC.x - 3.556 + i * PITCH + Math.floor(i / 5) * PITCH, BH, BC.z + RAIL_Z[name]);
const espPin = (name) => pinLocal(name, 'J2').add(EC);
const lerpTo = (cur, target, dt, rate = 12) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
const surf = (h) => V(h.x, SURF, h.z);
const rad = (d) => (d * Math.PI) / 180;

// the water side
export const TK = V(9.85, 0, -2.45); // tank centre
const TKD = { w: 2.5, d: 1.7, h: 1.7 };
const WATER_MAX = 1.5; // height of a full tank
export const PT = V(9.55, 0, -5.25); // pot centre (kept inside the page edge, x <= 10.7, z >= -6.4)
const POT = { top: 1.15, bottom: 0.85, h: 2.0, y: 0.1 };
const SOIL_TOP = 1.9;
const SENSOR_AT = V(PT.x + 0.7, 0, PT.z + 0.15);
const HOSE_END = V(PT.x - 0.45, 2.15, PT.z + 0.35);
const PUMP_AT = V(TK.x + 0.1, 0.4, TK.z);

const DRY_SOIL = new THREE.Color('#cdb27d');
const WET_SOIL = new THREE.Color('#33231a');
const LEAF_OK = new THREE.Color('#3f9b48');
const LEAF_DRY = new THREE.Color('#a2943c');
const LEAF_WET = new THREE.Color('#2c6f69');

const rod = (parent, a, b, r, mat) => cylinderBetween(parent, a, b, r, mat);

/** TO-220 MOSFET, flat printed face toward +z. Legs end in the holes g, d, s (left to right). */
function buildMosfet(g, d, s) {
  const grp = new THREE.Group();
  grp.position.set(d.x, BH, d.z);
  const black = std('#17171a', 0.55);
  box(grp, 1.0, 0.9, 0.4, black, 0, 0.55 + 0.45, 0);
  box(grp, 1.0, 1.35, 0.09, std('#aeb4bb', 0.3, 0.85), 0, 0.55 + 0.675 + 0.1, -0.245); // metal tab behind the body
  const hole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 16), std('#2a2c30', 0.9));
  hole2.rotation.x = Math.PI / 2;
  hole2.position.set(0, 1.85, -0.245);
  grp.add(hole2);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.5), new THREE.MeshBasicMaterial({ map: labelTexture('IRLZ44N', 320, 180, '#1b1b20', '#d3d6dc', 62), toneMapped: false }));
  face.position.set(0, 1.0, 0.203);
  grp.add(face);
  const lead = std('#cfd0d4', 0.3, 0.95);
  for (const h of [g, d, s]) {
    const x = h.x - d.x;
    rod(grp, V(x, -0.25, 0), V(x, 0.58, 0), 0.03, lead);
  }
  return { group: grp };
}

/** Axial diode (DO-41 size): cathode band toward the cathode hole. */
function buildDiode({ anode, cathode }) {
  const g = new THREE.Group();
  g.position.set((anode.x + cathode.x) / 2, BH, anode.z);
  const half = (cathode.x - anode.x) / 2;
  const lead = std('#cfd0d4', 0.3, 0.95);
  const bodyMat = std('#1f2125', 0.35, 0.1);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.52, 20), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.2;
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.07, 20), std('#d9dce1', 0.4, 0.4));
  band.rotation.z = Math.PI / 2;
  band.position.set(0.19, 0.2, 0);
  g.add(band);
  for (const s of [-1, 1]) {
    rod(g, V(s * half, -0.25, 0), V(s * half, 0.2, 0), 0.022, lead);
    rod(g, V(s * half, 0.2, 0), V(s * 0.26, 0.2, 0), 0.022, lead);
  }
  return { group: g, bodyMat };
}

/** Radial electrolytic capacitor straddling the two rails: "-" leg in minus, "+" leg in plus. */
function buildCapacitor(minus, plus) {
  const g = new THREE.Group();
  g.position.set(minus.x, BH, (minus.z + plus.z) / 2);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 28), std('#12306a', 0.4, 0.15));
  can.position.y = 0.3 + 0.5;
  g.add(can);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.03, 28), std('#9ba3ad', 0.35, 0.8));
  top.position.y = 1.31;
  g.add(top);
  const dz = (minus.z - plus.z) / 2; // "-" side
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.8, 0.02), std('#dfe5ee', 0.5));
  stripe.position.set(0, 0.3 + 0.5, Math.sign(dz) * 0.335);
  g.add(stripe);
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.022), std('#12306a', 0.5));
    m.position.set(0, 0.55 + k * 0.22, Math.sign(dz) * 0.347);
    g.add(m);
  }
  const lead = std('#cfd0d4', 0.3, 0.95);
  rod(g, V(0, -0.25, dz), V(0, 0.32, dz), 0.025, lead);
  rod(g, V(0, -0.25, -dz), V(0, 0.32, -dz), 0.025, lead);
  return { group: g };
}

/** 6 mm tactile switch whose legs go in (c1,g), (c1,i), (c2,g), (c2,i). The cap moves down when pressed. */
function buildTact(c1, c2) {
  const g = new THREE.Group();
  const a = hole(c1, 'g'), b = hole(c2, 'i');
  g.position.set((a.x + b.x) / 2, BH, (a.z + b.z) / 2);
  const dx = (b.x - a.x) / 2, dz = (b.z - a.z) / 2;
  const base = box(g, 0.66, 0.36, 0.66, std('#202226', 0.55), 0, 0.28, 0);
  box(g, 0.5, 0.025, 0.5, std('#9aa0a8', 0.3, 0.85), 0, 0.465, 0);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 24), std('#d24a3a', 0.45));
  cap.position.y = 0.58;
  g.add(cap);
  const lead = std('#cfd0d4', 0.3, 0.95);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(g, V(sx * dx, -0.25, sz * dz), V(sx * dx, 0.14, sz * dz), 0.025, lead);
  cap.userData.hit = 'button';
  base.userData.hit = 'button';
  return { group: g, cap, base, capY: 0.58 };
}

/** Capacitive soil moisture sensor v1.2 (simplified): a long board, the electronics at the top, a 3-pin connector. */
function buildSensor() {
  const g = new THREE.Group();
  g.position.copy(SENSOR_AT);
  const pcb = std('#1d4f34', 0.5);
  const bladeMat = pcb;
  const blade = box(g, 0.72, 3.0, 0.06, bladeMat, 0, 1.85, 0);
  blade.userData.hit = 'sensor';
  // the sensing electrodes: two long copper-coloured combs on the buried part
  for (const x of [-0.19, 0.19]) box(g, 0.2, 1.4, 0.012, std('#b6894a', 0.4, 0.6), x, 1.1, 0.036);
  // a white line where the soil should reach
  box(g, 0.72, 0.03, 0.013, std('#eef0e8', 0.5), 0, 1.9, 0.035);
  // electronics at the top and the 3-pin connector
  box(g, 0.5, 0.34, 0.08, std('#15171a', 0.5), 0, 2.85, 0.07);
  box(g, 0.26, 0.2, 0.08, std('#c8cbd0', 0.4, 0.5), 0, 2.45, 0.07);
  const jst = box(g, 0.46, 0.3, 0.26, std('#f1f1ea', 0.55), 0, 3.28, 0.1);
  jst.userData.hit = 'sensor';
  // a translucent box around the buried part: the electric field that the sensor "feels"
  const fieldMat = new THREE.MeshBasicMaterial({ color: '#6fe3ff', transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false });
  const field = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.55, 0.5), fieldMat);
  field.position.set(0, 1.1, 0.02);
  field.userData.noShadow = true;
  g.add(field);
  return { group: g, blade, jst, fieldMat, bladeMat };
}

/** Small submersible pump: body, inlet strainer, outlet nozzle and a rotor that spins. */
function buildPump() {
  const g = new THREE.Group();
  g.position.copy(PUMP_AT);
  const bodyMat = std('#2a2e36', 0.45, 0.2);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.95, 28), bodyMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.12, 28), std('#c9ced4', 0.35, 0.7));
  cap.rotation.z = Math.PI / 2;
  cap.position.x = 0.44;
  g.add(cap);
  const rotor = new THREE.Group();
  rotor.position.x = 0.5;
  for (let k = 0; k < 4; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.07), std('#8fc8e8', 0.4));
    blade.rotation.x = (k * Math.PI) / 4;
    rotor.add(blade);
  }
  g.add(rotor);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 14), std('#d9dde2', 0.4, 0.2));
  nozzle.position.set(-0.05, 0.42, 0);
  g.add(nozzle);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), glowMat);
  glow.userData.noShadow = true;
  g.add(glow);
  return { group: g, rotor, bodyMat, glowMat };
}

/** A small plant: stem and leaves that droop when the soil is dry. */
function buildPlant() {
  const g = new THREE.Group();
  g.position.set(PT.x - 0.1, SOIL_TOP, PT.z - 0.35);
  const stemMat = std('#4f8a3a', 0.6);
  rod(g, V(0, 0, 0), V(0, 0.95, 0), 0.05, stemMat);
  const leafMat = new THREE.MeshStandardMaterial({ color: LEAF_OK, roughness: 0.55 });
  const leaves = [];
  const n = 6;
  for (let k = 0; k < n; k++) {
    const pivot = new THREE.Group();
    pivot.position.y = 0.95 - (k % 2) * 0.22;
    pivot.rotation.y = (k / n) * Math.PI * 2 + 0.4;
    const tilt = new THREE.Group();
    pivot.add(tilt);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), leafMat);
    leaf.scale.set(0.5, 0.045, 0.24);
    leaf.position.x = 0.46;
    tilt.add(leaf);
    g.add(pivot);
    leaves.push(tilt);
  }
  return { group: g, leaves, leafMat };
}

export function buildPlantScene() {
  const root = new THREE.Group();

  /* ---------------- ESP32 board and breadboard ---------------- */
  const esp = buildEsp32Board(PIN_COLORS);
  esp.group.position.copy(EC);
  const colsF = [2, 6, 9, 11, 15, 16, 17, 19, 20, 22, 25, 26, 28, 30];
  const { group: board, strips } = buildBoard({
    strips: colsF.map((c) => [c, 'f']),
    labelCols: [2, 6, 9, 11, 15, 16, 17, 19, 20, 22, 25, 26, 28, 30],
    rails: ['far-minus', 'far-plus'],
  });
  board.position.set(BC.x, 0, BC.z);
  root.add(esp.group, board);
  const S = (col) => strips[`${col}f`];

  /* ---------------- parts on the breadboard ---------------- */
  const BR = '#6b3a1c', BK = '#111111', RD = '#cc2a1a', OR = '#ff8a1a', YL = '#e8c61a', GD = '#d4af37';
  const r100k = buildResistor({ a: hole(6, 'i'), b: hole(9, 'i'), colors: [BR, BK, YL, GD] });
  const r100 = buildResistor({ a: hole(11, 'i'), b: hole(15, 'i'), colors: [BR, BK, BR, GD] });
  const r10k = buildResistor({ a: hole(15, 'h'), b: hole(19, 'h'), colors: [BR, BK, OR, GD] });
  const r330 = buildResistor({ a: hole(22, 'i'), b: hole(26, 'i'), colors: [OR, OR, BR, GD] });
  const led = buildLed({ cathode: hole(25, 'f'), anode: hole(26, 'f'), color: '#3ddc6a', emissive: '#16e04a', coreOff: '#0e3d1a' });
  const fet = buildMosfet(hole(15, 'f'), hole(16, 'f'), hole(17, 'f'));
  const diode = buildDiode({ anode: hole(16, 'i'), cathode: hole(20, 'i') });
  const tact = buildTact(28, 30);
  root.add(r100k.group, r100.group, r10k.group, r330.group, led.group, fet.group, diode.group, tact.group);

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
    capMinus: railNear(2.45, 'far-minus'),
    capPlus: railNear(2.45, 'far-plus'),
    pullEnd: railNear(hole(9, 'j').x, 'far-minus'),
    source: railNear(hole(17, 'j').x, 'far-minus'),
    gatePull: railNear(hole(19, 'j').x, 'far-minus'),
    ledK: railNear(hole(25, 'j').x, 'far-minus'),
    btn: railNear(hole(30, 'j').x, 'far-minus'),
    gnd: railNear(5.2, 'far-minus'),
    v5diode: railNear(hole(20, 'j').x, 'far-plus'),
    v5: railNear(6.9, 'far-plus'),
    pumpPlus: railNear(8.0, 'far-plus'),
  };
  const w3v3 = buildJumperAt(espPin('3V3'), HOUSING_TOP, hole(2, 'j'), '#e8942a', 0.5, 0.235);
  const wAout = buildJumperAt(espPin('IO34'), HOUSING_TOP, hole(6, 'j'), '#a56ae0', 0.7, 0.235);
  const wGate = buildJumperAt(espPin('IO25'), HOUSING_TOP, hole(11, 'j'), '#2fae5a', 0.35, 0.235);
  const wLed = buildJumperAt(espPin('IO26'), HOUSING_TOP, hole(22, 'j'), '#f0c020', 0.6, 0.235);
  const wBtn = buildJumperAt(espPin('IO27'), HOUSING_TOP, hole(28, 'j'), '#3f7be0', 0.95, 0.235);
  const wGnd = buildJumperAt(espPin('GND'), HOUSING_TOP, railHole(R.gnd, 'far-minus'), '#3b3b44', 0.35, 0.235);
  const w5v = buildJumperAt(espPin('5V'), HOUSING_TOP, railHole(R.v5, 'far-plus'), '#d62f2f', 0.35, 0.235);
  const jPull = buildBoardJumper(hole(9, 'j'), railHole(R.pullEnd, 'far-minus'), '#3b3b44', 0.4);
  const jSource = buildBoardJumper(hole(17, 'j'), railHole(R.source, 'far-minus'), '#3b3b44', 0.4);
  const jGateP = buildBoardJumper(hole(19, 'j'), railHole(R.gatePull, 'far-minus'), '#3b3b44', 0.4);
  const jLedK = buildBoardJumper(hole(25, 'j'), railHole(R.ledK, 'far-minus'), '#3b3b44', 0.4);
  const jBtn = buildBoardJumper(hole(30, 'j'), railHole(R.btn, 'far-minus'), '#3b3b44', 0.4);
  const jV5 = buildBoardJumper(hole(20, 'j'), railHole(R.v5diode, 'far-plus'), '#d62f2f', 0.4);
  const cap = buildCapacitor(railHole(R.capMinus, 'far-minus'), railHole(R.capPlus, 'far-plus'));
  root.add(w3v3.root, wAout.root, wGate.root, wLed.root, wBtn.root, wGnd.root, w5v.root);
  root.add(jPull.root, jSource.root, jGateP.root, jLedK.root, jBtn.root, jV5.root, cap.group);

  /* ---------------- USB cable ---------------- */
  const usb = new THREE.Group();
  const usbEnd = V(EC.x + ESP.len / 2 - 0.3 + 0.22 + 0.375, ESP_TOP + 0.13, EC.z);
  box(usb, 0.7, 0.2, 0.6, std('#1a1a1e', 0.5), usbEnd.x + 0.35, usbEnd.y, usbEnd.z);
  const usbCurve = new THREE.CatmullRomCurve3([
    V(usbEnd.x + 0.7, usbEnd.y, usbEnd.z), V(usbEnd.x + 0.95, 0.5, usbEnd.z - 0.2), V(usbEnd.x + 0.6, 0.25, -3.9),
    V(7.7, 0.15, -4.9), V(7.0, 0.14, -6.1), V(6.3, 0.13, -7.4),
  ], false, 'centripetal');
  usb.add(new THREE.Mesh(new THREE.TubeGeometry(usbCurve, 60, 0.12, 8, false), std('#1d1d22', 0.7)));
  root.add(usb);

  /* ---------------- tank, pump and hose ---------------- */
  const tank = new THREE.Group();
  tank.position.copy(TK);
  const glass = new THREE.MeshStandardMaterial({ color: '#a9d3e6', transparent: true, opacity: 0.17, roughness: 0.15, depthWrite: false, side: THREE.DoubleSide });
  const rim = std('#8fb2c0', 0.4);
  box(tank, TKD.w, 0.06, TKD.d, std('#9fc3d2', 0.4), 0, 0.03, 0);
  box(tank, TKD.w, TKD.h, 0.04, glass, 0, TKD.h / 2 + 0.03, TKD.d / 2);
  box(tank, TKD.w, TKD.h, 0.04, glass, 0, TKD.h / 2 + 0.03, -TKD.d / 2);
  box(tank, 0.04, TKD.h, TKD.d, glass, TKD.w / 2, TKD.h / 2 + 0.03, 0);
  box(tank, 0.04, TKD.h, TKD.d, glass, -TKD.w / 2, TKD.h / 2 + 0.03, 0);
  for (const z of [-1, 1]) box(tank, TKD.w + 0.04, 0.05, 0.06, rim, 0, TKD.h + 0.03, z * TKD.d / 2);
  for (const x of [-1, 1]) box(tank, 0.06, 0.05, TKD.d, rim, x * TKD.w / 2, TKD.h + 0.03, 0);
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2f86d6', transparent: true, opacity: 0.58, roughness: 0.1, depthWrite: false });
  const water = new THREE.Mesh(new THREE.BoxGeometry(TKD.w - 0.1, 1, TKD.d - 0.1), waterMat);
  water.userData.noShadow = true;
  tank.add(water);
  const pump = buildPump();
  root.add(tank, pump.group);

  const hosePts = [
    V(PUMP_AT.x - 0.05, 0.9, PUMP_AT.z), V(PUMP_AT.x - 0.1, 1.5, PUMP_AT.z - 0.1), V(PUMP_AT.x - 0.1, 2.15, PUMP_AT.z - 0.35),
    V(9.7, 2.5, -3.5), V(9.4, 2.55, -4.2), V(HOSE_END.x, 2.45, HOSE_END.z - 0.1), V(HOSE_END.x, HOSE_END.y, HOSE_END.z),
  ];
  const hoseCurve = new THREE.CatmullRomCurve3(hosePts, false, 'centripetal');
  const hoseMat = new THREE.MeshStandardMaterial({ color: '#d7edf5', transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false });
  const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 90, 0.075, 10, false), hoseMat);
  hose.userData.noShadow = true;
  root.add(hose);

  /* ---------------- pot, soil, plant and sensor ---------------- */
  const pot = new THREE.Group();
  pot.position.copy(PT);
  const potWall = new THREE.MeshStandardMaterial({ color: '#d7ebf1', transparent: true, opacity: 0.2, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const potBody = new THREE.Mesh(new THREE.CylinderGeometry(POT.top, POT.bottom, POT.h, 40, 1, true), potWall);
  potBody.position.y = POT.y + POT.h / 2;
  potBody.userData.noShadow = true;
  pot.add(potBody);
  const potRim = new THREE.Mesh(new THREE.TorusGeometry(POT.top, 0.055, 10, 40), std('#c98563', 0.55));
  potRim.rotation.x = Math.PI / 2;
  potRim.position.y = POT.y + POT.h;
  pot.add(potRim);
  const potBase = new THREE.Mesh(new THREE.CylinderGeometry(POT.bottom, POT.bottom - 0.03, 0.08, 40), std('#c98563', 0.55));
  potBase.position.y = POT.y + 0.04;
  pot.add(potBase);
  const soilMat = new THREE.MeshStandardMaterial({ color: DRY_SOIL, roughness: 0.95 });
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(POT.top - 0.1 - (POT.top - POT.bottom) * 0.04, POT.bottom - 0.08, SOIL_TOP - POT.y - 0.08, 36), soilMat);
  soil.position.y = POT.y + 0.08 + (SOIL_TOP - POT.y - 0.08) / 2;
  pot.add(soil);
  const wetMat = new THREE.MeshBasicMaterial({ color: '#150d08', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const wetPatch = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), wetMat);
  wetPatch.rotation.x = -Math.PI / 2;
  wetPatch.position.set(HOSE_END.x - PT.x, SOIL_TOP + 0.01, HOSE_END.z - PT.z);
  wetPatch.userData.noShadow = true;
  pot.add(wetPatch);
  const drip = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 28), new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  drip.rotation.x = -Math.PI / 2;
  drip.position.copy(wetPatch.position).add(V(0, 0.01, 0));
  drip.userData.noShadow = true;
  pot.add(drip);
  const plant = buildPlant();
  const sensor = buildSensor();
  root.add(pot, plant.group, sensor.group);

  /* ---------------- cables ---------------- */
  const sensorTop = V(SENSOR_AT.x, 3.35, SENSOR_AT.z + 0.1);
  const farRoute = (endHole, dx, dz) => [
    sensorTop.clone().add(V(dx, 0, dz)), V(sensorTop.x + 0.35 + dx, 3.0, sensorTop.z + 0.7), V(11.05 + dx, 2.6, -3.6), V(11.35 + dx, 2.3, -1.3),
    V(11.0 + dx, 2.0, 1.2), V(10.2, 1.8, 2.6 + dz), V(endHole.x + 3.2, 1.55, 2.95 + dz), V(endHole.x + 0.8, 1.5, 2.9 + dz), V(endHole.x + 0.3, 1.5, 2.55),
  ];
  const holeVcc = hole(2, 'g'), holeAout = hole(6, 'g'), holeSg = hole(9, 'g');
  const cVcc = buildCable(farRoute(holeVcc, 0.0, 0.0), holeVcc, '#d62f2f');
  const cAout = buildCable(farRoute(holeAout, 0.1, 0.12), holeAout, '#e8c61a');
  const cSg = buildCable(farRoute(holeSg, 0.2, 0.24), holeSg, '#2a2a30');
  const holePp = railHole(R.pumpPlus, 'far-plus'), holePm = hole(16, 'j');
  const pumpTail = (endHole, k) => [
    V(PUMP_AT.x - 0.5, 0.42, PUMP_AT.z + (k ? 0.1 : -0.1)), V(PUMP_AT.x - 0.75, 1.2, PUMP_AT.z + (k ? 0.1 : -0.1)),
    V(TK.x - 0.7, 1.95, TK.z + 0.35 + k * 0.12), V(TK.x - 0.95, 1.95, TK.z + 0.95), V(8.2, 1.7, -0.5 + k * 0.1), V(endHole.x + 1.1, 1.5, endHole.z - 0.15),
  ];
  const cPumpPlus = buildCable(pumpTail(holePp, 0), holePp, '#d62f2f');
  const cPumpMinus = buildCable(pumpTail(holePm, 1), holePm, '#2a2a30');
  root.add(cVcc.root, cAout.root, cSg.root, cPumpPlus.root, cPumpMinus.root);

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
  const toGnd = (b, fromRailHole) => {
    const g = railHole(R.gnd, 'far-minus');
    return b.p(V(fromRailHole.x, SURF, fromRailHole.z)).p(V(g.x, SURF, g.z)).all(curvePts(wGnd.curve, 60).reverse()).p(pinTipTop('GND'));
  };
  const above = (h, y = 0.5) => V(h.x, BH + y, h.z);

  const pumpPath = (() => {
    const b = build().p(pinTipTop('5V')).all(curvePts(w5v.curve, 60));
    const v5 = railHole(R.v5, 'far-plus'), pp = railHole(R.pumpPlus, 'far-plus');
    b.p(surf(v5)).p(surf(pp)).all(curvePts(cPumpPlus.curve, 90).reverse());
    b.p(V(PUMP_AT.x - 0.4, 0.42, PUMP_AT.z)).p(V(PUMP_AT.x + 0.4, 0.4, PUMP_AT.z)).p(V(PUMP_AT.x - 0.4, 0.38, PUMP_AT.z - 0.05));
    b.all(curvePts(cPumpMinus.curve, 90));
    const j16 = hole(16, 'j'), f16 = hole(16, 'f'), f17 = hole(17, 'f'), j17 = hole(17, 'j');
    b.p(surf(j16)).p(surf(f16)).p(above(f16)).p(above(f17)).p(surf(f17)).p(surf(j17)).all(curvePts(jSource.curve, 30));
    return toGnd(b, railHole(R.source, 'far-minus')).done();
  })();
  const ledPath = (() => {
    const b = build().p(pinTipTop('IO26')).all(curvePts(wLed.curve, 60));
    const j22 = hole(22, 'j'), i22 = hole(22, 'i'), i26 = hole(26, 'i'), f26 = hole(26, 'f'), f25 = hole(25, 'f'), j25 = hole(25, 'j');
    b.p(surf(j22)).p(surf(i22)).p(V(i22.x, BH + 0.2, i22.z)).p(V((i22.x + i26.x) / 2, BH + 0.2, i22.z)).p(V(i26.x, BH + 0.2, i26.z)).p(surf(i26)).p(surf(f26));
    b.p(V(f26.x, BH + 0.45, f26.z)).p(V((f26.x + f25.x) / 2, BH + 0.85, f26.z)).p(V(f25.x, BH + 0.45, f25.z)).p(surf(f25)).p(surf(j25));
    b.all(curvePts(jLedK.curve, 30));
    return toGnd(b, railHole(R.ledK, 'far-minus')).done();
  })();
  const btnPath = (() => {
    const b = build().p(pinTipTop('IO27')).all(curvePts(wBtn.curve, 60));
    const j28 = hole(28, 'j'), i28 = hole(28, 'i'), i30 = hole(30, 'i'), j30 = hole(30, 'j');
    b.p(surf(j28)).p(surf(i28)).p(above(i28, 0.45)).p(above(i30, 0.45)).p(surf(i30)).p(surf(j30)).all(curvePts(jBtn.curve, 30));
    return toGnd(b, railHole(R.btn, 'far-minus')).done();
  })();
  const sensePath = (() => {
    const b = build().p(pinTipTop('3V3')).all(curvePts(w3v3.curve, 60));
    const j2 = hole(2, 'j'), g2 = hole(2, 'g'), g9 = hole(9, 'g'), j9 = hole(9, 'j');
    b.p(surf(j2)).p(surf(g2)).all(curvePts(cVcc.curve, 120).reverse());
    b.p(V(sensorTop.x, 3.0, sensorTop.z)).p(V(sensorTop.x, 3.2, sensorTop.z));
    b.all(curvePts(cSg.curve, 120)).p(surf(g9)).p(surf(j9)).all(curvePts(jPull.curve, 30));
    return toGnd(b, railHole(R.pullEnd, 'far-minus')).done();
  })();
  const aoutPath = (() => {
    const b = build().p(V(sensorTop.x, 3.2, sensorTop.z)).all(curvePts(cAout.curve, 120));
    const g6 = hole(6, 'g'), j6 = hole(6, 'j');
    b.p(surf(g6)).p(surf(j6)).all(curvePts(wAout.curve, 60).reverse()).p(pinTipTop('IO34'));
    return b.done();
  })();
  const hosePath = new Polyline(hoseCurve.getPoints(70));
  const dripPath = new Polyline([HOSE_END.clone(), V(HOSE_END.x, SOIL_TOP + 0.4, HOSE_END.z), V(HOSE_END.x, SOIL_TOP + 0.03, HOSE_END.z)]);
  const flows = {
    pump: new ParticleFlow(pumpPath, { count: 150, size: 0.13, color: '#ff9a4a', flowSpeed: 0.26 }),
    led: new ParticleFlow(ledPath, { count: 90, size: 0.12, color: '#7dffa0', flowSpeed: 0.2 }),
    btn: new ParticleFlow(btnPath, { count: 80, size: 0.1, color: '#6fe3ff', flowSpeed: 0.14 }),
    sense: new ParticleFlow(sensePath, { count: 100, size: 0.09, color: '#8fd3ff', flowSpeed: 0.1 }),
    aout: new ParticleFlow(aoutPath, { count: 90, size: 0.09, color: '#c58cff', flowSpeed: 0.14 }),
    water: new ParticleFlow(hosePath, { count: 80, size: 0.11, color: '#6cc3ff', flowSpeed: 0.3 }),
    drip: new ParticleFlow(dripPath, { count: 10, size: 0.1, color: '#9fdcff', flowSpeed: 1.4 }),
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
  const lx = (hole(25, 'f').x + hole(26, 'f').x) / 2, ledTop = V(lx, BH + 0.75, hole(25, 'f').z);
  const halo = sprite('#37ff7a', 0, true);
  halo.position.copy(ledTop);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: glowTex, color: '#2aff6a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(lx, BH + 0.012, ledTop.z);
  decal.userData.noShadow = true;
  root.add(decal);
  const ledLight = new THREE.PointLight('#30ff70', 0, 8, 2);
  ledLight.position.set(lx, BH + 1.3, ledTop.z + 0.2);
  root.add(ledLight);
  const pinGlow = {};
  for (const [k, name, color] of [['sensor', 'IO34', '#c58cff'], ['pump', 'IO25', '#6fd07a'], ['led', 'IO26', '#ffcf6b'], ['button', 'IO27', '#6aa6ff']]) {
    const s = sprite(color);
    const p = espPin(name);
    s.position.set(p.x, 1.35, p.z);
    s.scale.setScalar(0.75);
    pinGlow[k] = s;
  }
  const fetGlow = sprite('#ff9a4a', 9, false);
  fetGlow.position.set(hole(16, 'f').x, BH + 1.1, hole(16, 'f').z + 0.3);
  const flyGlow = sprite('#ffb04a', 9, false); // the flyback diode conducting for a moment
  flyGlow.position.set(hole(18, 'i').x, BH + 0.4, hole(18, 'i').z);
  const breakGlow = sprite('#ff3b2a', 9, false); // marks a cable that is off or shorted
  breakGlow.scale.setScalar(0.9);
  const ringGeo = new THREE.RingGeometry(0.2, 0.25, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = {};
  for (const [k, name] of [['sensor', 'IO34'], ['pump', 'IO25'], ['led', 'IO26'], ['button', 'IO27']]) {
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
  pieces.push(scalePiece(tank, 0.4, 0.8, 1.5), scalePiece(pot, 0.5, 0.8, 1.5), scalePiece(plant.group, 0.8, 0.8, 1.2), scalePiece(pump.group, 0.9, 0.6, 1.2), scalePiece(sensor.group, 1.0, 0.7, 1.4));
  pieces.push(scalePiece(r100k.group, 0.8, 0.5), scalePiece(r100.group, 0.85, 0.5), scalePiece(r10k.group, 0.9, 0.5), scalePiece(fet.group, 0.95, 0.5), scalePiece(diode.group, 1.0, 0.5));
  pieces.push(scalePiece(cap.group, 1.05, 0.5), scalePiece(r330.group, 1.1, 0.5), scalePiece(led.group, 1.15, 0.5), scalePiece(tact.group, 1.2, 0.5));
  [jPull, jSource, jGateP, jLedK, jBtn, jV5].forEach((w, k) => pieces.push(boardWirePiece(w, 1.4 + k * 0.08, 0.5)));
  pieces.push(wirePiece(wGnd, 1.75), wirePiece(w5v, 1.8), wirePiece(w3v3, 1.9), wirePiece(wAout, 2.0), wirePiece(wGate, 2.1), wirePiece(wLed, 2.2), wirePiece(wBtn, 2.3));
  for (const [c, d] of [[cVcc, 2.4], [cAout, 2.5], [cSg, 2.6], [cPumpPlus, 2.7], [cPumpMinus, 2.8]]) pieces.push(cablePiece(c, d));
  const hoseCount = hose.geometry.index.count;
  pieces.push({ delay: 0.3, dur: 0.6, apply(k) { usb.visible = k > 0.5; } });
  pieces.push({ delay: 2.6, dur: 0.8, apply(k) { hose.visible = k > 0; hose.geometry.setDrawRange(0, Math.floor((hoseCount * clamp01(k * 1.05)) / 3) * 3); } });
  const POP_DURATION = 3.9;
  let popK = 0;
  const applyPop = (tp) => {
    root.visible = tp > 0;
    popK = clamp01((tp - 1.2) / 1.2);
    for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
  };

  /* ---------------- per-frame state ---------------- */
  const tmp = new THREE.Color();
  const lv = { gnd: 0, v5: 0, v3: 0 };
  let leafTilt = 0.35, leafDry = 0, leafWet = 0, rotorAngle = 0, dripT = 0;
  const hit = [tact.cap, tact.base, sensor.blade, sensor.jst];
  const aoutCount = cAout.tube.geometry.index.count;
  const plugAout = cAout.plug;

  return {
    root,
    popDuration: POP_DURATION,
    setPop: applyPop,
    hitMeshes: () => hit,
    anchors: {
      esp: V(EC.x + 1.2, ESP_TOP + 0.5, EC.z - 1.1), // on the module side, away from the J2 pin labels
      pin: {
        sensor: V(espPin('IO34').x, 1.35, espPin('IO34').z), pump: V(espPin('IO25').x, 1.35, espPin('IO25').z), led: V(espPin('IO26').x, 1.35, espPin('IO26').z),
        button: V(espPin('IO27').x, 1.35, espPin('IO27').z), v3: V(espPin('3V3').x, 1.35, espPin('3V3').z), gnd: V(espPin('GND').x, 1.35, espPin('GND').z), v5: V(espPin('5V').x, 1.35, espPin('5V').z),
      },
      led: ledTop.clone(),
      mosfet: V(hole(16, 'f').x, BH + 2.05, hole(16, 'f').z),
      diode: V(hole(18, 'i').x, BH + 0.45, hole(18, 'i').z),
      cap: V(railHole(R.capMinus, 'far-minus').x, BH + 1.6, railHole(R.capMinus, 'far-minus').z - 0.1),
      button: V(tact.group.position.x, BH + 0.95, tact.group.position.z),
      pull: V((hole(6, 'i').x + hole(9, 'i').x) / 2, BH + 0.3, hole(6, 'i').z),
      gate: V((hole(11, 'i').x + hole(15, 'i').x) / 2, BH + 0.3, hole(11, 'i').z),
      sensor: V(SENSOR_AT.x, 2.2, SENSOR_AT.z + 0.1),
      soil: V(PT.x - 0.1, SOIL_TOP + 0.25, PT.z + 0.9),
      plant: V(PT.x - 0.2, 3.3, PT.z - 0.35),
      pump: V(PUMP_AT.x, 0.9, PUMP_AT.z + 0.4),
      tank: V(TK.x + 0.95, TKD.h + 0.35, TK.z + 0.85),
      hose: V(9.7, 2.6, -3.9),
      board: V(BC.x + BOARD.w / 2 - 0.3, BH, BC.z + BOARD.d / 2 - 0.4),
    },
    pulse(key, color = '#ffd27a') {
      const r = rings[key];
      if (r) {
        r.t = 0;
        r.color = color;
      }
    },

    /**
     * s: { soil (0..100 colour/wetness), surface (0..100 water not yet spread), tank (0..1 level), flow (0..1 water leaving the hose),
     *      gate (0..1 level of the pump pin), pumpI (0..1 pump current), led (0..1), button (0..1 pressed), adc (0..1 reading),
     *      sensorMode ('ok' | 'disconnected' | 'short'), running (bool), dryRun (0..1), stall (0..1), locked (bool) }
     */
    update(time, dt, s, camera, viewportH) {
      const uScale = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));

      // water in the tank
      const h = Math.max(0.001, s.tank * WATER_MAX);
      water.scale.y = h;
      water.position.y = 0.06 + h / 2;
      waterMat.opacity = s.tank > 0.002 ? 0.58 : 0;

      // soil, plant
      tmp.copy(DRY_SOIL).lerp(WET_SOIL, clamp01(s.soil / 85));
      soilMat.color.copy(tmp);
      wetMat.opacity = 0.55 * clamp01(s.surface / 14) * popK;
      const dry = clamp01((40 - s.soil) / 30), over = clamp01((s.soil - 88) / 12);
      leafDry = lerpTo(leafDry, dry, dt, 1.6);
      leafWet = lerpTo(leafWet, over, dt, 1.6);
      leafTilt = lerpTo(leafTilt, 0.38 - 1.55 * leafDry - 0.25 * leafWet, dt, 1.6);
      plant.leafMat.color.copy(LEAF_OK).lerp(LEAF_DRY, leafDry).lerp(LEAF_WET, leafWet);
      plant.leaves.forEach((t, i) => {
        t.rotation.z = leafTilt + Math.sin(time * 0.9 + i) * 0.03;
      });

      // sensor field follows what the sensor "feels"
      sensor.fieldMat.opacity = (0.05 + 0.22 * clamp01(s.soil / 100)) * popK;
      sensor.bladeMat.emissive.set('#6fe3ff');
      sensor.bladeMat.emissiveIntensity = s.running && s.sensorMode === 'ok' ? 0.12 : 0;

      // pump
      const run = s.pumpI;
      rotorAngle += dt * 40 * run * (s.stall > 0.5 ? 0.15 : 1);
      pump.rotor.rotation.x = rotorAngle;
      pump.group.position.x = PUMP_AT.x + Math.sin(time * 90) * 0.004 * run; // y belongs to the pop-in animation
      pump.glowMat.opacity = Math.max(s.dryRun, s.stall) * (0.25 + 0.15 * Math.sin(time * 14)) * popK;
      pump.glowMat.color.set(s.stall > 0.5 ? '#ffb02a' : '#ff3b2a');
      pump.bodyMat.emissive.set('#ff9a4a');
      pump.bodyMat.emissiveIntensity = 0.12 * run;

      // water leaving the hose
      hoseMat.opacity = 0.55;
      dripT += dt;
      const f = clamp01(s.flow);
      drip.material.opacity = 0;
      if (f > 0.05) {
        const k = (dripT * 1.6) % 1; // a ripple spreads on the soil where the water lands
        drip.scale.setScalar(0.5 + k * 3.2);
        drip.material.opacity = (1 - k) * 0.8 * f;
      }

      // LED
      const L = s.led;
      led.shellMat.emissiveIntensity = 2.4 * L;
      led.shellMat.opacity = 0.78 + 0.2 * L;
      led.coreMat.color.setRGB(0.05 + 0.5 * L, 0.24 + 0.76 * L, 0.1 + 0.4 * L);
      halo.material.opacity = 0.95 * L;
      halo.scale.setScalar(2.2 + 0.5 * L);
      decal.material.opacity = 0.6 * L;
      ledLight.intensity = 18 * L;
      wLed.wireMat.emissive.set('#ffcf6b');
      wLed.wireMat.emissiveIntensity = 0.9 * L;
      r330.bodyMat.emissive.set('#ff7a00');
      r330.bodyMat.emissiveIntensity = 0.22 * L;
      jLedK.wireMat.emissive.set('#ffb35a');
      jLedK.wireMat.emissiveIntensity = 0.7 * L;
      S(22).opacity = S(26).opacity = S(25).opacity = 0.14 + 0.5 * L;

      // button: the cap goes down
      tact.cap.position.y = tact.capY - 0.09 * s.button;
      wBtn.wireMat.emissive.set('#6fe3ff');
      wBtn.wireMat.emissiveIntensity = 0.7 * s.button;
      jBtn.wireMat.emissive.set('#ffb35a');
      jBtn.wireMat.emissiveIntensity = 0.7 * s.button;
      S(28).opacity = S(30).opacity = 0.14 + 0.5 * s.button;

      // pump circuit: the gate is a voltage (little current), the pump branch carries the current
      const G = s.gate, P = s.pumpI;
      wGate.wireMat.emissive.set('#7be3a0');
      wGate.wireMat.emissiveIntensity = 0.7 * G;
      r100.bodyMat.emissive.set('#7be3a0');
      r100.bodyMat.emissiveIntensity = 0.16 * G;
      for (const c of [11, 15]) S(c).opacity = 0.14 + 0.5 * G;
      S(16).opacity = S(17).opacity = 0.14 + 0.5 * P;
      S(20).opacity = 0.14 + 0.5 * P;
      S(19).opacity = 0.14 + 0.5 * Math.max(P, 0.0);
      w5v.wireMat.emissive.set('#ff6a5a');
      w5v.wireMat.emissiveIntensity = 0.8 * P;
      jV5.wireMat.emissive.set('#ff6a5a');
      jV5.wireMat.emissiveIntensity = 0.5 * P;
      jSource.wireMat.emissive.set('#ffb35a');
      jSource.wireMat.emissiveIntensity = 0.7 * P;
      cPumpPlus.wireMat.emissive.set('#ff6a5a');
      cPumpPlus.wireMat.emissiveIntensity = 0.6 * P;
      cPumpMinus.wireMat.emissive.set('#ffb35a');
      cPumpMinus.wireMat.emissiveIntensity = 0.6 * P;
      fetGlow.material.opacity = 0.55 * G * popK;
      fetGlow.scale.setScalar(1.1);
      // the diode carries the coil current only for a moment after the MOSFET opens (s.flyback decays from 1 to 0)
      const F = clamp01(s.flyback || 0);
      diode.bodyMat.emissive.set('#ff9a4a');
      diode.bodyMat.emissiveIntensity = 1.4 * F;
      flyGlow.material.opacity = 0.9 * F * popK;
      flyGlow.scale.setScalar(0.8 + 0.6 * F);
      jV5.wireMat.emissiveIntensity = Math.max(jV5.wireMat.emissiveIntensity, 0.7 * F);
      cPumpMinus.wireMat.emissiveIntensity = Math.max(cPumpMinus.wireMat.emissiveIntensity, 0.6 * F);
      cPumpPlus.wireMat.emissiveIntensity = Math.max(cPumpPlus.wireMat.emissiveIntensity, 0.6 * F);
      S(16).opacity = Math.max(S(16).opacity, 0.14 + 0.5 * F);
      S(20).opacity = Math.max(S(20).opacity, 0.14 + 0.5 * F);

      // sensor circuit
      const sensing = s.running ? 1 : 0;
      const ok = s.sensorMode === 'ok';
      lv.v3 = lerpTo(lv.v3, sensing, dt);
      w3v3.wireMat.emissive.set('#8fd3ff');
      w3v3.wireMat.emissiveIntensity = 0.55 * lv.v3;
      cVcc.wireMat.emissive.set('#8fd3ff');
      cVcc.wireMat.emissiveIntensity = 0.4 * lv.v3;
      cSg.wireMat.emissive.set('#8fd3ff');
      cSg.wireMat.emissiveIntensity = 0.3 * lv.v3;
      S(2).opacity = 0.14 + 0.5 * lv.v3;
      const aout = ok && s.running ? 0.35 + 0.65 * s.adc : 0;
      wAout.wireMat.emissive.set('#c58cff');
      wAout.wireMat.emissiveIntensity = 0.8 * aout;
      cAout.wireMat.emissive.set(s.sensorMode === 'short' ? '#ff3b2a' : '#c58cff');
      cAout.wireMat.emissiveIntensity = s.sensorMode === 'short' ? 0.9 : 0.6 * aout;
      S(6).opacity = 0.14 + 0.5 * aout;
      // a cable that is off: the wire stops short of the hole and the plug is gone
      const off = s.sensorMode === 'disconnected';
      // (the pop-in animation resets both of these on every frame, so only the "off" case needs to be forced here)
      if (off) {
        cAout.tube.geometry.setDrawRange(0, Math.floor((aoutCount * 0.9) / 3) * 3);
        plugAout.visible = false;
      }
      breakGlow.position.copy(cAout.curve.getPoint(off ? 0.9 : 1));
      breakGlow.material.opacity = (off || s.sensorMode === 'short' ? 0.8 + 0.2 * Math.sin(time * 8) : 0) * popK;

      // grounds and rails
      const gnd = Math.max(L, P, s.button, lv.v3 * 0.5);
      lv.gnd = lerpTo(lv.gnd, gnd, dt);
      lv.v5 = lerpTo(lv.v5, P, dt);
      wGnd.wireMat.emissive.set('#ffb35a');
      wGnd.wireMat.emissiveIntensity = 0.7 * lv.gnd;
      strips['rail:far-minus'].opacity = 0.14 + 0.5 * lv.gnd;
      strips['rail:far-plus'].opacity = 0.14 + 0.5 * lv.v5;
      S(9).opacity = 0.14 + 0.5 * lv.v3;

      pinGlow.sensor.material.opacity = 0.6 * aout * popK;
      pinGlow.pump.material.opacity = 0.7 * G * popK;
      pinGlow.led.material.opacity = 0.7 * L * popK;
      pinGlow.button.material.opacity = 0.6 * (1 - s.button) * (s.running ? 1 : 0) * popK; // the pin sits HIGH until the button joins it to GND

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

      flows.pump.update(time, 0, 1, uScale, P > 0.03 ? P : 0);
      flows.led.update(time, 0, 1, uScale, L > 0.03 ? L : 0);
      flows.btn.update(time, 0, 1, uScale, s.button > 0.03 ? s.button : 0);
      flows.sense.update(time, 0, 1, uScale, lv.v3 > 0.03 ? 0.7 * lv.v3 : 0);
      flows.aout.update(time, 0, 1, uScale, aout > 0.03 ? aout : 0);
      flows.water.update(time, 0, 1, uScale, f > 0.03 ? f : 0);
      flows.drip.update(time, 0, 1, uScale, f > 0.03 ? f : 0);
      void ESP_TOP;
    },
  };
}
