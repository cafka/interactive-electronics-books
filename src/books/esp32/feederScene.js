import * as THREE from 'three';
import { V, clamp01, std, box, cylinderBetween } from '../../circuit.js';
import { scalePiece } from '../../popin.js';
import { glowTexture } from '../../textures.js';
import { buildEsp32Board, pinLocal, ESP } from './board.js';
import { labelTexture } from './scene.js';

/*
 * Chapter 3 scene: the arm chamber (arm, hopper, plate on a load cell, access door, IR beam, service lid) on the
 * back half of the right page, Pancho outside the access window on the desk, and the electronics on the front half.
 * Units: the page is in centimetres. The electronics are drawn at real size; the mechanism at 1:5.3 (K units per
 * millimetre) so a 310 mm arm fits on the page. The arm is a joint hierarchy turned by the real servo angles of the
 * simulation, the same chain as the forward kinematics: nothing in the arm or the food moves on its own.
 */

export const K = 0.019; // scene units per millimetre for the mechanism
export const A = V(5.5, 0.06, -1.2); // the arm base on the chamber floor
const BOX = { x0: 0.3, x1: 10.85, z0: -6.8, z1: 0.35, h: 4.6 }; // the arm chamber (scene units)

/** Arm frame (mm: x forward, y left, z up) -> scene. Forward is toward the back of the page. */
export const armToScene = (p) => V(A.x + K * p.y, A.y + K * p.z, A.z - K * p.x);

function link(len, w, mat) {
  // a link along -Z from its joint, as two side plates and a spacer (an aluminium bracket look)
  const g = new THREE.Group();
  box(g, w, w * 0.6, len, mat, 0, 0, -len / 2);
  return g;
}
function servoBody(mat) {
  const g = new THREE.Group();
  box(g, 0.42, 0.78, 0.76, mat, 0, 0, 0);
  box(g, 0.42, 0.06, 1.04, mat, 0, 0.12, 0);
  return g;
}

/** Simple low-poly cat (Pancho): orange tabby, sits on the desk. */
function buildCat() {
  const g = new THREE.Group();
  const fur = std('#e08a3a', 0.85), light = std('#f6d2a2', 0.85), dark = std('#9a5422', 0.85);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), fur);
  body.scale.set(1.0, 1.15, 1.35);
  body.position.set(0, 1.15, 0);
  g.add(body);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), light);
  chest.position.set(-0.55, 1.35, 0);
  g.add(chest);
  const head = new THREE.Group();
  head.position.set(-0.7, 2.45, 0);
  g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 14), fur));
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), light);
  muzzle.position.set(-0.55, -0.15, 0);
  head.add(muzzle);
  for (const z of [-0.38, 0.38]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.45, 4), fur);
    ear.position.set(-0.05, 0.68, z);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), std('#2a3d16', 0.3));
    eye.position.set(-0.6, 0.12, z * 0.6);
    head.add(eye);
  }
  for (const k of [0, 1, 2]) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.05, 6, 24, Math.PI), dark);
    stripe.rotation.set(0, Math.PI / 2, 0);
    stripe.position.set(0.25 + k * 0.3, 1.2, 0);
    stripe.scale.set(1, 1.2, 1.4);
    g.add(stripe);
  }
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.9, 0.5, 0.3), V(1.6, 0.4, 0.9), V(1.5, 0.9, 1.5), V(1.0, 1.4, 1.6)]), 24, 0.13, 8, false), fur);
  g.add(tail);
  for (const z of [-0.35, 0.35]) {
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), light);
    paw.scale.set(1.3, 0.6, 1);
    paw.position.set(-0.75, 0.12, z);
    g.add(paw);
  }
  return { group: g, head };
}

/** A generic module board: PCB, a few chips, a header row; returns pin positions by name. */
function moduleBoard({ w, d, color = '#1b4c8c', label, pins, pinSide = 'front', chips = [] }) {
  const g = new THREE.Group();
  box(g, w, 0.16, d, std(color, 0.5), 0, 0.38, 0);
  for (const c of chips) box(g, c[2], 0.1, c[3], std('#111216', 0.5), c[0], 0.51, c[1]);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, d * 0.34), new THREE.MeshBasicMaterial({ map: labelTexture(label, 512, 120, color, '#eef2f8', 54), toneMapped: false }));
  face.rotation.x = -Math.PI / 2;
  face.position.set(0, 0.465, pinSide === 'front' ? -d * 0.22 : d * 0.22);
  g.add(face);
  const out = {};
  const gold = std('#d8b25a', 0.28, 0.95), plastic = std('#0c0c0e', 0.6);
  const n = pins.length, pitch = 0.254;
  const z = pinSide === 'front' ? d / 2 - 0.2 : -d / 2 + 0.2;
  box(g, n * pitch, 0.24, pitch, plastic, 0, 0.58, z);
  pins.forEach((name, i) => {
    const x = (i - (n - 1) / 2) * pitch;
    box(g, 0.06, 0.5, 0.06, gold, x, 0.75, z);
    out[name] = V(x, 1.0, z);
  });
  return { group: g, pins: out };
}

export function buildFeederScene(settings) {
  const s = settings;
  const root = new THREE.Group();
  const glowTex = glowTexture();
  const sprite = (color, scale = 0.8) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, depthTest: false }));
    sp.scale.setScalar(scale);
    sp.renderOrder = 9;
    root.add(sp);
    return sp;
  };

  /* ---------------- chamber ---------------- */
  const chamber = new THREE.Group();
  root.add(chamber);
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.13, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const frame = std('#7c8794', 0.45, 0.6);
  const cw = BOX.x1 - BOX.x0, cd = BOX.z1 - BOX.z0, cx = (BOX.x0 + BOX.x1) / 2, cz = (BOX.z0 + BOX.z1) / 2;
  box(chamber, cw, 0.06, cd, std('#e6e9ec', 0.7), cx, 0.03, cz); // floor (food-safe white plastic)
  const walls = [
    [cw, BOX.h, 0.05, cx, BOX.h / 2, BOX.z0], // back
    [cw, BOX.h, 0.05, cx, BOX.h / 2, BOX.z1], // front
    [0.05, BOX.h, cd, BOX.x0, BOX.h / 2, cz], // left
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = box(chamber, w, h, d, glass, x, y, z);
    m.userData.noShadow = true;
  }
  // right wall with the access window around the plate
  const plateS = armToScene({ x: s.plateR * Math.cos((s.plateAz * Math.PI) / 180), y: s.plateR * Math.sin((s.plateAz * Math.PI) / 180), z: 0 });
  const winZ0 = plateS.z - 1.25, winZ1 = plateS.z + 1.25, winH = 2.1;
  for (const [z0, z1] of [[BOX.z0, winZ0], [winZ1, BOX.z1]]) box(chamber, 0.05, BOX.h, z1 - z0, glass, BOX.x1, BOX.h / 2, (z0 + z1) / 2).userData.noShadow = true;
  box(chamber, 0.05, BOX.h - winH, winZ1 - winZ0, glass, BOX.x1, winH + (BOX.h - winH) / 2, plateS.z).userData.noShadow = true;
  // frame edges
  for (const [x, z] of [[BOX.x0, BOX.z0], [BOX.x1, BOX.z0], [BOX.x0, BOX.z1], [BOX.x1, BOX.z1]]) box(chamber, 0.08, BOX.h, 0.08, frame, x, BOX.h / 2, z);
  for (const z of [BOX.z0, BOX.z1]) box(chamber, cw, 0.08, 0.08, frame, cx, BOX.h, z);
  for (const x of [BOX.x0, BOX.x1]) box(chamber, 0.08, 0.08, cd, frame, x, BOX.h, cz);
  // service lid (hinged at the back), with its switch
  const lidPivot = new THREE.Group();
  lidPivot.position.set(cx, BOX.h, BOX.z0);
  chamber.add(lidPivot);
  const lid = box(lidPivot, cw, 0.05, cd, glass, 0, 0.03, cd / 2);
  lid.userData.noShadow = true;
  const lidSwitch = box(chamber, 0.4, 0.25, 0.3, std('#2b2f36', 0.5), BOX.x0 + 0.5, BOX.h - 0.14, BOX.z1 - 0.3);

  // access door: a flap hinged at the top of the window, on the inside
  const doorPivot = new THREE.Group();
  doorPivot.position.set(BOX.x1 - 0.06, winH, plateS.z);
  chamber.add(doorPivot);
  const doorMat = new THREE.MeshStandardMaterial({ color: '#f2f4f5', roughness: 0.5, transparent: true, opacity: 0.92 });
  const door = box(doorPivot, 0.05, winH - 0.05, winZ1 - winZ0 - 0.06, doorMat, 0, -(winH - 0.05) / 2, 0);
  box(doorPivot, 0.09, 0.12, winZ1 - winZ0 - 0.06, std('#3b9f6b', 0.6), 0, -(winH - 0.08), 0); // soft rubber edge
  const doorServo = servoBody(std('#1d4fa8', 0.5));
  doorServo.scale.setScalar(0.7);
  doorServo.position.set(BOX.x1 - 0.4, winH + 0.35, winZ1 + 0.3);
  chamber.add(doorServo);
  // IR break beam across the outside of the window
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, winZ1 - winZ0 + 0.5, 8), beamMat);
  beam.rotation.x = Math.PI / 2;
  beam.position.set(BOX.x1 + 0.35, 0.9, plateS.z);
  beam.userData.noShadow = true;
  root.add(beam);
  for (const z of [winZ0 - 0.3, winZ1 + 0.3]) box(root, 0.3, 0.6, 0.25, std('#22262d', 0.5), BOX.x1 + 0.35, 0.9, z);

  /* ---------------- hopper ---------------- */
  const hop = armToScene({ x: s.hopperR * Math.cos((s.hopperAz * Math.PI) / 180), y: s.hopperR * Math.sin((s.hopperAz * Math.PI) / 180), z: 0 });
  const hopHalf = 55 * K, hopFloor = 20 * K, hopTop = 140 * K;
  const hopper = new THREE.Group();
  hopper.position.set(hop.x, A.y, hop.z);
  root.add(hopper);
  const hopGlass = new THREE.MeshStandardMaterial({ color: '#e7f0f3', transparent: true, opacity: 0.22, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false });
  for (const [w, d, x, z] of [[hopHalf * 2, 0.04, 0, -hopHalf], [hopHalf * 2, 0.04, 0, hopHalf], [0.04, hopHalf * 2, -hopHalf, 0], [0.04, hopHalf * 2, hopHalf, 0]]) {
    box(hopper, w, hopTop, d, hopGlass, x, hopTop / 2, z).userData.noShadow = true;
  }
  box(hopper, hopHalf * 2, hopFloor, hopHalf * 2, std('#d9dde1', 0.6), 0, hopFloor / 2, 0);
  const kibbleMat = std('#8a5a2b', 0.8);
  const hopFood = box(hopper, hopHalf * 2 - 0.06, 1, hopHalf * 2 - 0.06, kibbleMat, 0, 0, 0);
  const kibbleGeo = new THREE.SphereGeometry(0.075, 6, 5);
  const topKibble = new THREE.InstancedMesh(kibbleGeo, kibbleMat, 60);
  const m4 = new THREE.Matrix4();
  hopper.add(topKibble);

  /* ---------------- plate on the load cell ---------------- */
  const plate = new THREE.Group();
  plate.position.set(plateS.x, A.y, plateS.z);
  root.add(plate);
  const cellMat = std('#b9bec6', 0.35, 0.8);
  box(plate, 1.9, 0.18, 0.32, cellMat, 0, 0.09, 0); // the bar load cell
  box(plate, 0.4, 0.12, 0.5, std('#2d2f34', 0.5), 0.75, 0.24, 0);
  const plateR = 60 * K, plateH = 0.36;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(plateR, plateR * 0.8, plateH, 36, 1, true), std('#e9eef2', 0.25, 0.4));
  dish.material.side = THREE.DoubleSide;
  dish.position.y = 0.3 + plateH / 2;
  plate.add(dish);
  const dishBase = new THREE.Mesh(new THREE.CylinderGeometry(plateR * 0.8, plateR * 0.8, 0.04, 36), std('#e9eef2', 0.25, 0.4));
  dishBase.position.y = 0.32;
  plate.add(dishBase);
  const plateFood = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), kibbleMat);
  plateFood.position.y = 0.34;
  plate.add(plateFood);
  // spilled food on the chamber floor (counted in the mass balance)
  const floorFood = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), kibbleMat);
  floorFood.position.set(A.x + 1.6, 0.06, A.z - 1.5);
  root.add(floorFood);

  /* ---------------- the arm (hierarchy = forward kinematics) ---------------- */
  const alu = std('#c9ced6', 0.35, 0.7), servoMat = std('#1d1f24', 0.55), accent = std('#e8b33b', 0.45);
  const base = new THREE.Group();
  base.position.copy(A);
  root.add(base);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(55 * K * 1.6, 60 * K * 1.7, 0.36, 32), std('#2a2e35', 0.5));
  plinth.position.y = 0.18;
  root.add(plinth);
  plinth.position.set(A.x, A.y + 0.18, A.z);
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(50 * K * 1.4, 50 * K * 1.4, 0.12, 32), accent);
  turntable.position.y = 0.42;
  base.add(turntable);
  const tower = servoBody(servoMat);
  tower.position.set(0, (s.h0 * K) / 2 + 0.2, 0);
  tower.scale.set(1, (s.h0 * K) / 0.9, 1);
  base.add(tower);
  const shoulder = new THREE.Group();
  shoulder.position.y = s.h0 * K;
  base.add(shoulder);
  shoulder.add(link(s.l1 * K, 0.34, alu));
  const elbowServo = servoBody(servoMat);
  elbowServo.scale.setScalar(0.85);
  elbowServo.position.set(0.32, 0, -s.l1 * K);
  shoulder.add(elbowServo);
  const elbow = new THREE.Group();
  elbow.position.z = -s.l1 * K;
  shoulder.add(elbow);
  elbow.add(link(s.l2 * K, 0.28, alu));
  const wristServo = servoBody(servoMat);
  wristServo.scale.setScalar(0.55);
  wristServo.position.set(0.24, 0, -s.l2 * K);
  elbow.add(wristServo);
  const wrist = new THREE.Group();
  wrist.position.z = -s.l2 * K;
  elbow.add(wrist);
  // spoon: a handle to the bowl centre (l3), stainless steel, food safe
  const steel = std('#dfe4ea', 0.2, 0.9);
  box(wrist, 0.1, 0.05, s.l3 * K * 0.7, steel, 0, 0, -s.l3 * K * 0.35);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel);
  bowl.material.side = THREE.DoubleSide;
  bowl.position.z = -s.l3 * K;
  bowl.scale.set(1, 0.55, 1.3);
  wrist.add(bowl);
  const spoonFood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), kibbleMat);
  spoonFood.position.z = -s.l3 * K;
  wrist.add(spoonFood);
  const bowlAnchor = new THREE.Object3D();
  bowlAnchor.position.z = -s.l3 * K;
  wrist.add(bowlAnchor);
  const jointRings = [shoulder, elbow, wrist].map((g) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24), accent);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    return ring;
  });
  void jointRings;

  /* ---------------- falling kibble (only while the world says food is falling) ---------------- */
  const fall = new THREE.InstancedMesh(kibbleGeo, kibbleMat, 14);
  fall.frustumCulled = false;
  root.add(fall);
  let fallT = 0;

  /* ---------------- target, trajectory and reach ---------------- */
  const targetDot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshBasicMaterial({ color: '#56e39f', transparent: true, opacity: 0.85, toneMapped: false, depthTest: false }));
  targetDot.renderOrder = 10;
  root.add(targetDot);
  const TRAIL = 160;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.8, depthTest: false }));
  trail.frustumCulled = false;
  trail.renderOrder = 9;
  root.add(trail);
  const planGeo = new THREE.BufferGeometry();
  planGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
  const plan = new THREE.Line(planGeo, new THREE.LineDashedMaterial({ color: '#56e39f', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9, depthTest: false }));
  plan.frustumCulled = false;
  plan.renderOrder = 9;
  root.add(plan);
  const trailPts = [];
  // reach of the wrist (l1 + l2 around the shoulder) drawn as a ring at shoulder height
  const reach = new THREE.Mesh(new THREE.RingGeometry((s.l1 + s.l2 + s.l3) * K - 0.03, (s.l1 + s.l2 + s.l3) * K, 72), new THREE.MeshBasicMaterial({ color: '#7aa7ff', transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  reach.rotation.x = -Math.PI / 2;
  reach.position.set(A.x, A.y + 0.08, A.z);
  root.add(reach);

  /* ---------------- Pancho ---------------- */
  const cat = buildCat();
  cat.group.scale.setScalar(0.62);
  // the head is at local -x, so with no rotation Pancho faces the window (the chamber is at -x from him)
  root.add(cat.group);
  const CAT_AWAY = V(12.9, -1.08, plateS.z - 3.4), CAT_AT = V(BOX.x1 + 1.25, -1.08, plateS.z);
  cat.group.position.copy(CAT_AWAY);
  // a step for Pancho: the book stands on the desk, so the window is reached from a little box
  box(root, 1.6, 1.08, 2.6, std('#b48a5c', 0.85), BOX.x1 + 1.3, -0.54, plateS.z);

  /* ---------------- electronics (front half, real size) ---------------- */
  const elec = new THREE.Group();
  root.add(elec);
  box(elec, 10.4, 0.06, 5.6, std('#3d4651', 0.7), 5.5, 0.03, 3.9); // a base board for the modules
  const esp = buildEsp32Board({
    'J3:IO21': '#7ad3ff', 'J3:IO22': '#7ad3ff', 'J3:IO19': '#c58cff', 'J3:IO18': '#c58cff', 'J3:IO4': '#ffb020',
    'J2:IO33': '#8bc34a', 'J2:IO27': '#ff6f61', 'J2:IO26': '#9e9e9e', 'J2:IO25': '#f2c230', 'J2:IO13': '#2f7be0',
  });
  const ESP_AT = V(3.0, 0, 5.3);
  esp.group.position.copy(ESP_AT);
  elec.add(esp.group);
  const espPin = (name, header) => pinLocal(name, header).add(ESP_AT);
  const pca = moduleBoard({ w: 6.2, d: 2.5, label: 'PCA9685 · 16-ch PWM', pins: ['GND', 'OE', 'SCL', 'SDA', 'VCC', 'V+'], chips: [[0.6, 0.1, 0.9, 0.9]] });
  pca.group.position.set(7.6, 0, 5.3);
  elec.add(pca.group);
  // five 3-pin servo headers on the PCA9685 (channels 0..4)
  for (let ch = 0; ch < 5; ch++) {
    for (const [k, c] of [[0, '#111'], [1, '#c62828'], [2, '#f2c94c']]) box(pca.group, 0.06, 0.5, 0.06, std(c, 0.4), -2.6 + ch * 0.36, 0.75, -0.9 + k * 0.254);
  }
  const pcaPin = (n) => pca.pins[n].clone().add(pca.group.position);
  const ina = moduleBoard({ w: 2.6, d: 2.1, color: '#6b2fa0', label: 'INA219 · 0x45', pins: ['VCC', 'GND', 'SCL', 'SDA', 'V-', 'V+'] });
  ina.group.position.set(7.4, 0, 2.3);
  elec.add(ina.group);
  const inaPin = (n) => ina.pins[n].clone().add(ina.group.position);
  const hx = moduleBoard({ w: 3.4, d: 2.0, color: '#127a4a', label: 'HX711', pins: ['GND', 'DT', 'SCK', 'VCC'] });
  hx.group.position.set(3.2, 0, 2.3);
  elec.add(hx.group);
  const hxPin = (n) => hx.pins[n].clone().add(hx.group.position);
  // E-stop (latching mushroom) in its yellow box, the 6 V 5 A supply input, the fuse, the button and the LED
  const estop = new THREE.Group();
  estop.position.set(10.0, 0, 2.2);
  elec.add(estop);
  box(estop, 1.6, 1.0, 1.6, std('#f2c230', 0.5), 0, 0.5, 0);
  const mushroom = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 0.45, 28), std('#d32f2f', 0.4));
  mushroom.position.y = 1.25;
  estop.add(mushroom);
  mushroom.userData.hit = 'estop';
  const psu = new THREE.Group();
  psu.position.set(10.2, 0, 5.4);
  elec.add(psu);
  box(psu, 1.2, 0.7, 1.4, std('#22252b', 0.5), 0, 0.35, 0);
  const psuFace = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), new THREE.MeshBasicMaterial({ map: labelTexture('6 V 5 A', 256, 110, '#22252b', '#f3d36b', 60), toneMapped: false }));
  psuFace.rotation.x = -Math.PI / 2;
  psuFace.position.y = 0.71;
  psu.add(psuFace);
  const fuse = box(elec, 0.7, 0.3, 0.3, std('#e0e0e0', 0.3, 0.4), 10.1, 0.15, 3.85);
  const btn = new THREE.Group();
  btn.position.set(0.9, 0, 2.2);
  elec.add(btn);
  box(btn, 0.66, 0.36, 0.66, std('#202226', 0.55), 0, 0.18, 0);
  const btnCap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 20), std('#2f7be0', 0.45));
  btnCap.position.y = 0.45;
  btn.add(btnCap);
  btnCap.userData.hit = 'button';
  const ledMat = new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: '#ff9a00', emissiveIntensity: 0, roughness: 0.2 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), ledMat);
  led.position.set(0.9, 0.35, 3.3);
  elec.add(led);
  const ledGlow = sprite('#ffb020', 1.1);
  ledGlow.position.set(0.9, 0.5, 3.3);
  const cap1000 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 24), std('#12306a', 0.4, 0.15));
  cap1000.position.set(10.45, 0.6, 6.4);
  elec.add(cap1000);

  /* ---------------- wires (visible connections; colours as in the wiring table) ---------------- */
  const wires = [];
  const wire = (a, b, color, lift = 0.6, via = null) => {
    const pts = [a.clone(), a.clone().add(V(0, lift, 0))];
    if (via) via.forEach((p) => pts.push(p.clone()));
    pts.push(b.clone().add(V(0, lift, 0)), b.clone());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const mat = std(color, 0.45, 0, { emissive: '#000000' });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.04, 6, false), mat);
    elec.add(tube);
    wires.push({ tube, mat, color });
    return { tube, mat };
  };
  const W = {
    sda: wire(espPin('IO21', 'J3'), pcaPin('SDA'), '#2f7be0', 0.7),
    scl: wire(espPin('IO22', 'J3'), pcaPin('SCL'), '#f2c94c', 0.8),
    sda2: wire(pcaPin('SDA'), inaPin('SDA'), '#2f7be0', 0.5),
    scl2: wire(pcaPin('SCL'), inaPin('SCL'), '#f2c94c', 0.6),
    oe: wire(espPin('IO33', 'J2'), pcaPin('OE'), '#8bc34a', 0.9),
    v3: wire(espPin('3V3', 'J2'), pcaPin('VCC'), '#e8942a', 1.0),
    gnd: wire(espPin('GND', 'J3'), pcaPin('GND'), '#3b3b44', 1.1),
    hxDt: wire(espPin('IO19', 'J3'), hxPin('DT'), '#c58cff', 0.7),
    hxSck: wire(espPin('IO18', 'J3'), hxPin('SCK'), '#ff8fb1', 0.8),
    hxV: wire(espPin('3V3', 'J2'), hxPin('VCC'), '#e8942a', 0.9),
    hxG: wire(espPin('GND', 'J2'), hxPin('GND'), '#3b3b44', 1.0),
    vplus: wire(V(10.2, 0.7, 4.7), pcaPin('V+'), '#d62f2f', 0.5, [V(10.1, 0.9, 3.85), V(9.6, 0.9, 3.0), V(8.6, 0.8, 3.4)]),
  };
  // inputs and the LED: E-stop second contact (IO25), button (IO13), LED with its 330 ohm (IO4)
  wire(espPin('IO25', 'J2'), V(9.5, 1.0, 2.2), '#f2c230', 1.6, [V(6.0, 2.2, 6.6), V(9.0, 2.0, 3.0)]);
  wire(espPin('IO13', 'J2'), V(1.2, 0.5, 2.2), '#2f7be0', 1.2, [V(1.6, 1.5, 6.4)]);
  wire(espPin('IO4', 'J3'), V(0.9, 0.4, 3.55), '#ffb020', 0.8);
  // E-stop and current sensor in the servo supply: PSU -> E-stop -> fuse -> INA219 -> PCA9685 V+
  wire(V(10.0, 0.7, 4.7), V(10.0, 1.0, 2.9), '#d62f2f', 0.3);
  wire(inaPin('V-'), V(9.4, 1.0, 2.2), '#d62f2f', 0.4);
  // servo cables from the PCA9685 into the chamber through a grommet in the front wall
  const grommet = V(7.0, 0.4, BOX.z1);
  box(root, 0.6, 0.6, 0.12, std('#111', 0.6), grommet.x, 0.4, grommet.z);
  const servoCable = (target, k) => {
    const start = V(5.1 + k * 0.36, 1.0, 4.4).add(V(0, 0, 0));
    const curve = new THREE.CatmullRomCurve3([start, V(start.x, 1.4, 3.6), V(grommet.x + (k - 2) * 0.08, 0.5, grommet.z + 0.4), V(grommet.x + (k - 2) * 0.08, 0.4, grommet.z - 0.3), target], false, 'centripetal');
    const mat = std('#3a2f26', 0.6, 0, { emissive: '#000000' });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 50, 0.05, 6, false), mat);
    root.add(tube);
    return mat;
  };
  const cableMats = [
    servoCable(V(A.x, 0.4, A.z + 0.4), 0),
    servoCable(V(A.x + 0.2, 0.6, A.z + 0.2), 1),
    servoCable(V(A.x + 0.3, 0.7, A.z), 2),
    servoCable(V(A.x + 0.35, 0.8, A.z - 0.2), 3),
    servoCable(V(BOX.x1 - 0.4, winH + 0.35, winZ1 + 0.3), 4),
  ];
  // load cell, beam and lid cables
  const lcCable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([hxPin('GND').add(V(0, 0, -0.5)), V(3.2, 0.5, 1.0), V(6.5, 0.3, BOX.z1 + 0.2), V(8.6, 0.12, BOX.z1 - 0.5), V(plateS.x + 0.9, 0.2, plateS.z + 0.4)]), 60, 0.05, 6, false), std('#e0e0e0', 0.5));
  root.add(lcCable);
  const beamCable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([espPin('IO27', 'J2').add(V(0, 0.4, 0)), V(4.2, 1.2, 3.3), V(9.0, 0.6, 1.2), V(BOX.x1 + 0.35, 0.6, winZ1 + 0.3)]), 60, 0.035, 6, false), std('#ff6f61', 0.5));
  root.add(beamCable);
  const lidCable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([espPin('IO26', 'J2').add(V(0, 0.4, 0)), V(2.0, 1.4, 3.0), V(BOX.x0 + 0.6, 2.4, BOX.z1 + 0.25), V(BOX.x0 + 0.5, BOX.h - 0.14, BOX.z1 - 0.15)]), 60, 0.035, 6, false), std('#9e9e9e', 0.5));
  root.add(lidCable);

  root.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow && o.material.opacity === 1) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  /* ---------------- pop-in ---------------- */
  const pieces = [scalePiece(chamber, 0, 0.9, 1.4), scalePiece(elec, 0.2, 0.9, 1.4), scalePiece(hopper, 0.5, 0.7, 1.2), scalePiece(plate, 0.6, 0.7, 1.2), scalePiece(base, 0.8, 0.8, 1.2), scalePiece(cat.group, 1.4, 0.8, 1.0)];
  const POP_DURATION = 2.4;
  let popK = 0;
  const applyPop = (tp) => {
    root.visible = tp > 0;
    popK = clamp01((tp - 1.2) / 1.2);
    for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
  };
  const hit = [mushroom, btnCap, cat.group.children[0]];
  cat.group.children[0].userData.hit = 'cat';
  const tmp = new THREE.Vector3();
  const spoonAt = new THREE.Vector3(), shoulderAt = new THREE.Vector3();
  const CAT_LABEL = V(0.2, 1.5, 0);
  const catAt = cat.group.position.clone().add(CAT_LABEL);
  const D2R = Math.PI / 180;

  return {
    root,
    popDuration: POP_DURATION,
    setPop: applyPop,
    hitMeshes: () => hit,
    anchors: {
      esp: V(ESP_AT.x, 1.1, ESP_AT.z + 1.4),
      pca: V(7.6, 1.3, 5.3),
      ina: V(7.4, 1.2, 2.3),
      hx: V(3.2, 1.1, 2.3),
      estop: V(10.0, 1.8, 2.2),
      psu: V(10.2, 1.0, 5.4),
      button: V(0.9, 0.8, 2.2),
      led: V(0.9, 0.7, 3.3),
      hopper: V(hop.x, hopTop + 0.4, hop.z),
      plate: V(plateS.x - 0.4, 1.0, plateS.z),
      door: V(BOX.x1, winH + 0.2, plateS.z - 1.0),
      beam: V(BOX.x1 + 0.35, 1.3, winZ0 - 0.3),
      lid: V(BOX.x0 + 0.5, BOX.h + 0.2, BOX.z1 - 0.3),
      cat: catAt, // follows Pancho
      base: V(A.x - 0.9, 0.7, A.z + 0.6),
      spoon: spoonAt, // follows the bowl (updated every frame)
      shoulderAt,
    },
    /** Every frame. st: { q (4 joint deg), door (servo deg), hopperG, spoonG, plateG, floorG, flows, cat, lid, estop,
     *  led (0..1), button (0..1), target {x,y,z} mm or null, plan [{x,y,z}] mm, outputs (bool), current (0..1), fault (bool) } */
    update(time, dt, st) {
      // the arm: the same chain as forward(): base yaw, then three pitches
      base.rotation.y = -st.q[0] * D2R;
      shoulder.rotation.x = st.q[1] * D2R;
      elbow.rotation.x = st.q[2] * D2R;
      wrist.rotation.x = st.q[3] * D2R;
      // the door flap swings up into the chamber as it opens (servo 100 = closed, 10 = open)
      const openK = clamp01((s.doorClosedDeg - st.door) / (s.doorClosedDeg - s.doorOpenDeg));
      doorPivot.rotation.z = -openK * 1.45; // negative: the flap swings up into the chamber, not out at the cat
      lidPivot.rotation.x = st.lid ? -1.1 : 0;
      lidSwitch.material.color.set(st.lid ? '#c0392b' : '#2b2f36');
      // food: sizes from the masses of the physical model
      const lvl = Math.max(0.001, (st.hopperG / 800) * 120 * K);
      hopFood.scale.y = lvl;
      hopFood.position.y = hopFloor + lvl / 2;
      hopFood.visible = st.hopperG > 0.5;
      for (let i = 0; i < 60; i++) {
        const show = st.hopperG > 1 && i < Math.min(60, st.hopperG / 6);
        const x = ((i * 37) % 19) / 19 - 0.5, z = ((i * 53) % 17) / 17 - 0.5;
        m4.makeTranslation(x * hopHalf * 1.8, hopFloor + lvl + 0.03, z * hopHalf * 1.8);
        if (!show) m4.makeScale(0, 0, 0);
        topKibble.setMatrixAt(i, m4);
      }
      topKibble.instanceMatrix.needsUpdate = true;
      const sp = Math.min(1, st.spoonG / 12);
      spoonFood.visible = st.spoonG > 0.05;
      spoonFood.scale.set(0.3 + 0.7 * sp, 0.3 + 0.7 * sp, 0.4 + 0.9 * sp);
      const pf = Math.min(1, st.plateG / 60);
      plateFood.visible = st.plateG > 0.1;
      plateFood.scale.set(plateR * 0.75 * Math.sqrt(pf + 0.05), 0.04 + 0.32 * pf, plateR * 0.75 * Math.sqrt(pf + 0.05));
      floorFood.visible = st.floorG > 0.05;
      floorFood.scale.setScalar(0.1 + 0.08 * Math.sqrt(st.floorG));
      floorFood.scale.y = 0.05 + 0.02 * Math.sqrt(st.floorG);
      // a stream of kibble under the bowl, only while food really falls out of the spoon
      const out = st.flows.toPlate + st.flows.toHopper + st.flows.toFloor;
      root.updateMatrixWorld();
      bowlAnchor.getWorldPosition(tmp);
      spoonAt.copy(tmp);
      shoulder.getWorldPosition(shoulderAt);
      fallT += dt;
      for (let i = 0; i < 14; i++) {
        const k = ((fallT * 1.6 + i / 14) % 1);
        const y = tmp.y - k * (tmp.y - 0.4);
        m4.makeTranslation(tmp.x + Math.sin(i * 7.1) * 0.08, y, tmp.z + Math.cos(i * 3.3) * 0.08);
        if (out < 0.5 || i > out) m4.makeScale(0, 0, 0);
        fall.setMatrixAt(i, m4);
      }
      fall.instanceMatrix.needsUpdate = true;
      // target and trajectory
      if (st.target) {
        targetDot.visible = true;
        targetDot.position.copy(armToScene(st.target));
      } else targetDot.visible = false;
      trailPts.push(tmp.clone());
      if (trailPts.length > TRAIL) trailPts.shift();
      const tp = trailGeo.attributes.position;
      for (let i = 0; i < TRAIL; i++) {
        const p = trailPts[Math.min(i, trailPts.length - 1)] || tmp;
        tp.setXYZ(i, p.x, p.y, p.z);
      }
      tp.needsUpdate = true;
      const pp = planGeo.attributes.position;
      const planPts = st.plan || [];
      for (let i = 0; i < 40; i++) {
        const p = planPts.length ? armToScene(planPts[Math.min(i, planPts.length - 1)]) : tmp;
        pp.setXYZ(i, p.x, p.y, p.z);
      }
      pp.needsUpdate = true;
      plan.computeLineDistances();
      plan.visible = planPts.length > 1;
      reach.material.opacity = st.showReach ? 0.5 : 0;
      // beam, cat, E-stop, button, LED
      beamMat.opacity = (st.cat ? 0.95 : 0.25) * popK;
      beamMat.color.set(st.cat ? '#ff2a2a' : '#ff6b6b');
      const catTarget = st.cat ? CAT_AT : CAT_AWAY;
      cat.group.position.lerp(catTarget, 1 - Math.exp(-dt * 3));
      catAt.copy(cat.group.position).add(CAT_LABEL);
      cat.head.rotation.z = Math.sin(time * 1.3) * 0.08;
      mushroom.position.y = st.estop ? 1.1 : 1.25;
      btnCap.position.y = 0.45 - 0.08 * st.button;
      ledMat.emissiveIntensity = 2 * st.led;
      ledGlow.material.opacity = 0.8 * st.led * popK;
      // wires glow when they carry something: I2C while outputs are on, the servo supply with the current
      for (const k of ['sda', 'scl', 'sda2', 'scl2']) {
        W[k].mat.emissive.set('#7ad3ff');
        W[k].mat.emissiveIntensity = st.outputs ? 0.35 + 0.25 * Math.sin(time * 9) : 0;
      }
      W.vplus.mat.emissive.set('#ff6a5a');
      W.vplus.mat.emissiveIntensity = 0.9 * st.current;
      W.oe.mat.emissive.set('#b6ff6a');
      W.oe.mat.emissiveIntensity = st.outputs ? 0.6 : 0;
      cableMats.forEach((m, k) => {
        m.emissive.set('#ffb35a');
        m.emissiveIntensity = (k < 4 ? st.armDriven : st.outputs) ? 0.35 * Math.max(0.3, st.current) : 0;
      });
      void fuse;
    },
  };
}
