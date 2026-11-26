import * as THREE from 'three';
import { V, clamp01, std, box } from '../../circuit.js';
import { scalePiece } from '../../popin.js';
import { glowTexture } from '../../textures.js';
import { loadBoardModel, PART_MM, PART_SIZE_MM } from './boardModel.js';
import { BODY_SAMPLES, CORAL, fovFromDiagonal, makePinhole } from './presence.js';

/*
 * Coral chapter 1 scene, on the right page (x 0..11, z -7..7, centimetres).
 *  - The Dev Board Micro from the official CAD model, life size, standing USB-C down as the "Get started" guide says
 *    to hold it, on a small clear stand (the stand and the cable are illustrations). It faces the stage.
 *  - A figure walks along a path from outside the camera's field of view to its centre.
 *  - A panel shows the image the camera would capture. It is rendered from the lens position with the camera's
 *    field of view (110 degrees diagonal, square sensor), the same pinhole geometry the simulated detector uses.
 *  - Overlays (field of view, path, pipeline pulses, highlights) are hidden while the camera image is rendered:
 *    the camera only sees the physical scene.
 */

export const S = 0.1; // scene units (cm) per millimetre: the board is drawn at its real size
const YAW = (145 * Math.PI) / 180; // direction the board faces (from +x toward +z)
export const FACING = V(Math.cos(YAW), 0, Math.sin(YAW));
const UP = V(0, 1, 0);
const RIGHT = new THREE.Vector3().crossVectors(UP, FACING); // board +x as seen from the front (USB down)
const STAND_TOP = 0.28;
const ORIGIN = V(9.0, STAND_TOP + 34.77 * S, -4.0); // board millimetre origin (PCB top face centre)
export const FIGURE_H = 7.0;
const STAGE_DEPTH = 4.5; // distance from the lens to the centre of the stage
const OUT_LATERAL = 6.4; // how far to the side the figure starts (outside the frame)
const ROOM_BG = new THREE.Color('#c9cfd8'); // what the camera sees beyond the desk
const CLIENT_WAIT_TEXT = 'Waiting for Person Detection'; // the text of the official host client

/** Board millimetres -> scene. */
export const boardToWorld = (p) => ORIGIN.clone().addScaledVector(RIGHT, p[0] * S).addScaledVector(UP, p[1] * S).addScaledVector(FACING, p[2] * S);
// the pinhole sits just in front of the lens surface (the CAD lens top is at z = 4.06 mm), so the camera image is
// not taken from inside the lens barrel
export const LENS = boardToWorld([PART_MM.lens[0], PART_MM.lens[1], 4.2]);
export const FOV = fovFromDiagonal(CORAL.camera.diagonalFovDeg);
const CAM_RIGHT = new THREE.Vector3().crossVectors(FACING, UP).normalize();
export const STAGE_IN = V(LENS.x, 0, LENS.z).addScaledVector(FACING, STAGE_DEPTH);
export const STAGE_OUT = STAGE_IN.clone().addScaledVector(CAM_RIGHT, OUT_LATERAL);

function captionTexture(lines, w = 512, h = 96, bg = '#1b2133') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  lines.forEach(([text, size, color, y]) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(text, w / 2, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A simple low-poly person (not to scale with the board: a diorama figure). Feet at y = 0, facing +z. */
function buildFigure() {
  const g = new THREE.Group();
  const H = FIGURE_H;
  const skin = std('#e0b28c', 0.7), shirt = std('#2f8f8a', 0.75), pants = std('#2d3550', 0.8), hair = std('#3b2a22', 0.8), shoe = std('#1d1f24', 0.6);
  const limb = (r, len, mat) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.geometry.translate(0, -len / 2 - r, 0); // pivot at the top
    m.castShadow = true;
    return m;
  };
  const hips = new THREE.Group();
  hips.position.y = 0.47 * H;
  g.add(hips);
  const legs = [-1, 1].map((s) => {
    const leg = limb(0.055 * H, 0.33 * H, pants);
    leg.position.x = s * 0.06 * H;
    hips.add(leg);
    const foot = box(leg, 0.09 * H, 0.04 * H, 0.15 * H, shoe, 0, -0.44 * H, 0.03 * H);
    foot.castShadow = true;
    return leg;
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11 * H, 0.18 * H, 4, 14), shirt);
  torso.scale.set(1, 1, 0.68);
  torso.position.y = 0.66 * H;
  torso.castShadow = true;
  g.add(torso);
  const shoulders = new THREE.Group();
  shoulders.position.y = 0.79 * H;
  g.add(shoulders);
  const arms = [-1, 1].map((s) => {
    const arm = limb(0.04 * H, 0.27 * H, shirt);
    arm.position.x = s * 0.155 * H;
    arm.rotation.z = s * 0.12;
    shoulders.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045 * H, 12, 10), skin);
    hand.position.y = -0.36 * H;
    arm.add(hand);
    return arm;
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075 * H, 20, 16), skin);
  head.position.y = 0.92 * H;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.078 * H, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.copy(head.position);
  cap.rotation.x = -0.25;
  g.add(cap);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * H, 0.035 * H, 0.06 * H, 10), skin);
  neck.position.y = 0.83 * H;
  g.add(neck);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * H, 0.2 * H, H, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = H / 2;
  hit.userData.hit = 'figure';
  g.add(hit);
  return { group: g, legs, arms, hit, head };
}

/** Pose of the posable figure (radians). raise: arm away from the body sideways; bend: elbow; spread: leg sideways; lift: knee forward. */
export const REST_POSE = { raiseL: 0.12, raiseR: 0.12, bendL: 0, bendR: 0, spreadL: 0, spreadR: 0, liftL: 0, liftR: 0, kneeL: 0, kneeR: 0 };
/**
 * The same diorama figure with elbows and knees, and a marker at each of the 17 PoseNet keypoints (chapter 2).
 * The figure faces +z, so its own left side is +x. Keypoint markers follow the joints when the pose changes.
 */
function buildPosableFigure() {
  const g = new THREE.Group();
  const H = FIGURE_H;
  const skin = std('#e0b28c', 0.7), shirt = std('#2f8f8a', 0.75), pants = std('#2d3550', 0.8), hair = std('#3b2a22', 0.8), shoe = std('#1d1f24', 0.6);
  const limb = (r, len, mat) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.geometry.translate(0, -len / 2 - r, 0); // pivot at the top
    m.castShadow = true;
    return m;
  };
  const marker = (parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const kp = []; // KEYPOINTS order
  const hips = new THREE.Group();
  hips.position.y = 0.47 * H;
  g.add(hips);
  // side +1 = the figure's left (+x), -1 = its right
  const leg = (side) => {
    const thigh = new THREE.Group();
    thigh.position.x = side * 0.06 * H;
    hips.add(thigh);
    thigh.add(limb(0.055 * H, 0.12 * H, pants));
    const knee = new THREE.Group();
    knee.position.y = -0.21 * H;
    thigh.add(knee);
    knee.add(limb(0.05 * H, 0.13 * H, pants));
    const ankle = new THREE.Group();
    ankle.position.y = -0.22 * H;
    knee.add(ankle);
    box(ankle, 0.09 * H, 0.04 * H, 0.15 * H, shoe, 0, -0.01 * H, 0.03 * H).castShadow = true;
    return { thigh, knee, ankle };
  };
  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.155 * H, 0.79 * H, 0);
    g.add(shoulder);
    shoulder.add(limb(0.04 * H, 0.1 * H, shirt));
    const elbow = new THREE.Group();
    elbow.position.y = -0.17 * H;
    shoulder.add(elbow);
    elbow.add(limb(0.037 * H, 0.1 * H, skin));
    const wrist = new THREE.Group();
    wrist.position.y = -0.17 * H;
    elbow.add(wrist);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045 * H, 12, 10), skin);
    hand.position.y = -0.02 * H;
    wrist.add(hand);
    return { shoulder, elbow, wrist };
  };
  const legs = { L: leg(1), R: leg(-1) };
  const arms = { L: arm(1), R: arm(-1) };
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11 * H, 0.18 * H, 4, 14), shirt);
  torso.scale.set(1, 1, 0.68);
  torso.position.y = 0.66 * H;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075 * H, 20, 16), skin);
  head.position.y = 0.92 * H;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.078 * H, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.rotation.x = -0.25;
  head.add(cap);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * H, 0.035 * H, 0.06 * H, 10), skin);
  neck.position.y = 0.83 * H;
  g.add(neck);
  // eyes (dark dots) so the face shows which way the figure looks
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011 * H, 8, 6), std('#1d1f24', 0.4));
    eye.position.set(s * 0.028 * H, 0.012 * H, 0.068 * H);
    head.add(eye);
  }
  kp.push(marker(head, 0, -0.005 * H, 0.076 * H)); // NOSE
  kp.push(marker(head, 0.028 * H, 0.012 * H, 0.068 * H), marker(head, -0.028 * H, 0.012 * H, 0.068 * H)); // LEFT_EYE, RIGHT_EYE
  kp.push(marker(head, 0.074 * H, 0, 0), marker(head, -0.074 * H, 0, 0)); // LEFT_EAR, RIGHT_EAR
  kp.push(arms.L.shoulder, arms.R.shoulder, arms.L.elbow, arms.R.elbow, arms.L.wrist, arms.R.wrist);
  kp.push(legs.L.thigh, legs.R.thigh, legs.L.knee, legs.R.knee, legs.L.ankle, legs.R.ankle);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * H, 0.24 * H, H, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = H / 2;
  hit.userData.hit = 'figure';
  g.add(hit);
  const pose = { ...REST_POSE };
  /** p: the pose; swing: walking swing (radians, legs and arms forward / back). */
  const apply = (p, swing = 0) => {
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = arms[side], l = legs[side];
      a.shoulder.rotation.set(-swing * 0.8 * s, 0, s * p[`raise${side}`]);
      a.elbow.rotation.set(0, 0, s * p[`bend${side}`]);
      l.thigh.rotation.set(-p[`lift${side}`] + swing * s, 0, s * p[`spread${side}`]);
      l.knee.rotation.set(p[`knee${side}`], 0, 0);
      l.ankle.rotation.set(-p[`knee${side}`] * 0.5 + p[`lift${side}`] * 0.4, 0, -s * p[`spread${side}`]);
    }
  };
  apply(pose);
  return { group: g, legs, arms, hit, head, keypoints: kp, pose, apply };
}

/**
 * opts (chapter 2; chapter 1 uses the defaults):
 *   posable: a figure with elbows and knees and the 17 keypoint markers (setPose, keypointsWorld, skeleton overlay);
 *   panel: 'camera' (the camera image, rendered continuously) or 'client' (a copy of the official host client
 *     window: black, then the frames the board sends with the pose drawn on them, or "Waiting for Person Detection").
 */
export async function buildPresenceScene(opts = {}) {
  const root = new THREE.Group();
  const overlays = new THREE.Group(); // never seen by the board's camera
  root.add(overlays);
  const glow = glowTexture();
  const sprite = (color, scale) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    sp.scale.setScalar(scale);
    sp.renderOrder = 9;
    overlays.add(sp);
    return sp;
  };

  /* ---------------- board (official CAD model) on a stand ---------------- */
  const model = await loadBoardModel();
  const assembly = new THREE.Group(); // board + stand + cable (pop-in as one piece)
  root.add(assembly);
  const board = model.root;
  board.matrixAutoUpdate = false;
  board.matrix.makeBasis(RIGHT, UP, FACING).scale(V(S, S, S)).setPosition(ORIGIN);
  assembly.add(board);
  const acrylic = new THREE.MeshStandardMaterial({ color: '#dfe9f0', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
  const stand = new THREE.Group(); // local +x = board right, local +z = the direction the board faces
  stand.position.set(ORIGIN.x, 0, ORIGIN.z);
  stand.rotation.y = Math.atan2(FACING.x, FACING.z);
  assembly.add(stand);
  // the base is two blocks with a gap for the USB-C plug, and a clear back plate the board leans on
  const standMat = std('#2b3140', 0.6);
  for (const s of [-1, 1]) box(stand, 1.3, STAND_TOP, 2.2, standMat, s * 1.05, STAND_TOP / 2, -0.25).castShadow = true;
  const back = box(stand, 3.2, 4.4, 0.14, acrylic, 0, STAND_TOP + 2.2, -0.42);
  back.userData.noShadow = true;
  for (const s of [-1, 1]) box(stand, 0.22, 0.9, 0.5, standMat, s * 1.6, STAND_TOP + 0.45, -0.18);
  // USB-C cable: power for the board (the factory demo needs nothing else)
  const plug = boardToWorld([0, -34.77, -0.7]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([plug, plug.clone().add(V(0, -0.15, 0)), V(plug.x + 0.6, 0.12, plug.z - 1.6), V(10.4, 0.1, -6.2), V(11.0, -0.2, -6.9), V(11.6, -1.0, -7.4)]), 60, 0.12, 8, false), std('#2a2d33', 0.55));
  cable.castShadow = true;
  assembly.add(cable);

  /* ---------------- figure on its path ---------------- */
  const posable = !!opts.posable;
  const clientPanel = opts.panel === 'client';
  const fig = posable ? buildPosableFigure() : buildFigure();
  root.add(fig.group);
  const poseGoal = { ...REST_POSE };
  let u = 0; // 0 = outside the frame (start), 1 = centre of the frame
  let walkPhase = 0;
  let poseKey = ''; // changes when the posable figure moves its arms or legs (the camera image is taken again)
  const figurePos = new THREE.Vector3();
  const placeFigure = () => {
    figurePos.lerpVectors(STAGE_OUT, STAGE_IN, u);
    fig.group.position.copy(figurePos);
    fig.group.rotation.y = Math.atan2(LENS.x - figurePos.x, LENS.z - figurePos.z); // faces the board
  };
  placeFigure();
  const figureMatrix = new THREE.Matrix4();
  /** A point of the figure (local, in units of its height) in the scene as [x, y, z], as the detector samples it. */
  const figureWorld = (p) => {
    figureMatrix.makeRotationY(fig.group.rotation.y).setPosition(figurePos);
    return V(p[0] * FIGURE_H, p[1] * FIGURE_H, p[2] * FIGURE_H).applyMatrix4(figureMatrix).toArray();
  };

  // the path on the page: dashed line, "out" and "in" marks
  const pathMat = new THREE.LineDashedMaterial({ color: '#b5432a', dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.85 });
  const pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([STAGE_OUT.clone().setY(0.04), STAGE_IN.clone().setY(0.04)]), pathMat);
  pathLine.computeLineDistances();
  overlays.add(pathLine);
  const ring = (at, color) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.88, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, 0.05, at.z);
    overlays.add(m);
    return m;
  };
  const ringOut = ring(STAGE_OUT, '#8c93b3');
  const ringIn = ring(STAGE_IN, '#2e9e55');

  /* ---------------- field of view of the camera ---------------- */
  const pin = makePinhole([LENS.x, LENS.y, LENS.z], [FACING.x, FACING.y, FACING.z], [0, 1, 0], FOV.vDeg);
  const tanH = Math.tan((FOV.vDeg * Math.PI) / 360);
  const corner = (sx, sy, d) => LENS.clone().addScaledVector(FACING, d).addScaledVector(CAM_RIGHT, sx * d * tanH).addScaledVector(UP, sy * d * tanH);
  const FD = STAGE_DEPTH;
  const cs = [corner(-1, -1, FD), corner(1, -1, FD), corner(1, 1, FD), corner(-1, 1, FD)];
  const fovPts = [];
  for (const c of cs) fovPts.push(LENS, c);
  for (let i = 0; i < 4; i++) fovPts.push(cs[i], cs[(i + 1) % 4]);
  const fovMat = new THREE.LineBasicMaterial({ color: '#3f8fd0', transparent: true, opacity: 0.7 });
  const fovLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fovPts), fovMat);
  overlays.add(fovLines);
  const fovFace = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([cs[0], cs[1], cs[2], cs[0], cs[2], cs[3]]), new THREE.MeshBasicMaterial({ color: '#7ad3ff', transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
  overlays.add(fovFace);
  const fovGroup = [fovLines, fovFace];

  /* ---------------- chapter 2: the pose the client draws, also shown on the figure ---------------- */
  // 19 edges and 17 points, the same colours as the official client (yellow lines, cyan dots with a yellow rim)
  const skel = new THREE.Group();
  skel.visible = false;
  overlays.add(skel);
  const skelPos = new Float32Array(19 * 2 * 3);
  const skelGeo = new THREE.BufferGeometry();
  skelGeo.setAttribute('position', new THREE.BufferAttribute(skelPos, 3));
  const skelLines = new THREE.LineSegments(skelGeo, new THREE.LineBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.95, depthTest: false }));
  skelLines.renderOrder = 12;
  skelLines.frustumCulled = false;
  skel.add(skelLines);
  const dotGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: '#43f0ff', depthTest: false, transparent: true });
  const skelDots = Array.from({ length: 17 }, () => {
    const m = new THREE.Mesh(dotGeo, dotMat);
    m.renderOrder = 13;
    skel.add(m);
    return m;
  });
  const kpWorld = Array.from({ length: 17 }, () => new THREE.Vector3());

  /* ---------------- LEDs, highlights, pipeline route ---------------- */
  const ledMat = (part) => model.materials[part] || [];
  const ledGlow = { ledCam: sprite('#6dff8f', 0.75), ledUser: sprite('#6dff8f', 0.75), ledTpu: sprite('#ffffff', 0.75), ledStatus: sprite('#ffa630', 0.75) };
  for (const k of Object.keys(ledGlow)) ledGlow[k].position.copy(boardToWorld([PART_MM[k][0], PART_MM[k][1], 1.6]));
  const LED_LOOK = { ledCam: ['#c8ffd2', '#2dff63'], ledUser: ['#c8ffd2', '#2dff63'], ledTpu: ['#ffffff', '#f4f6ff'], ledStatus: ['#ffd9a8', '#ff8a1c'] };
  const setLed = (part, on) => {
    for (const m of ledMat(part)) {
      m.color.set(on ? LED_LOOK[part][0] : '#eef2ea');
      m.emissive.set(on ? LED_LOOK[part][1] : '#000000');
      m.emissiveIntensity = on ? (part === 'ledTpu' ? 1.6 : 2.4) : 0;
    }
  };

  // the selected part gets a solid orange frame on the board face (a 1-pixel line is too thin for a 1.7 mm LED)
  const outlineHolder = new THREE.Group();
  outlineHolder.matrixAutoUpdate = false;
  overlays.add(outlineHolder);
  const outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 1, depthTest: false, side: THREE.DoubleSide }));
  outline.renderOrder = 11;
  outlineHolder.add(outline);
  const outlineGlow = sprite('#ffb020', 1.2);
  let selected = null;
  const selectPart = (part) => {
    selected = part;
    if (!part) {
      outline.visible = false;
      outlineGlow.material.opacity = 0;
      return;
    }
    const c = PART_MM[part], s = PART_SIZE_MM[part] || [3, 3], pad = part.startsWith('led') ? 1.4 : 1.0, z = part === 'camera' ? 4.4 : 2.2;
    const w = s[0] / 2 + pad, h = s[1] / 2 + pad, t = part.startsWith('led') ? 0.55 : 0.8; // frame half-sizes and width (mm)
    const shape = new THREE.Shape([V(-w, -h), V(w, -h), V(w, h), V(-w, h)].map((p) => new THREE.Vector2(p.x, p.y)));
    shape.holes.push(new THREE.Path([new THREE.Vector2(-w + t, -h + t), new THREE.Vector2(-w + t, h - t), new THREE.Vector2(w - t, h - t), new THREE.Vector2(w - t, -h + t)]));
    outline.geometry.dispose();
    outline.geometry = new THREE.ShapeGeometry(shape);
    outlineHolder.matrix.makeBasis(RIGHT, UP, FACING).scale(V(S, S, S)).setPosition(boardToWorld([c[0], c[1], z]));
    outlineHolder.matrixWorldNeedsUpdate = true;
    outline.visible = true;
    outlineGlow.position.copy(boardToWorld([c[0], c[1], z + 0.5]));
    outlineGlow.scale.setScalar(Math.max(0.7, Math.max(s[0], s[1]) * S * 1.6));
  };
  selectPart(null);

  // the route of one cycle: lens -> MCU (image) and MCU -> User LED (result), drawn above the components
  const routeZ = 2.4;
  const toMcu = new THREE.CatmullRomCurve3([[0, 21.5, 4.4], [-1.5, 15, routeZ], [-6.5, 4, routeZ], [-5.5, -8, routeZ], [-2.99, -16.22, routeZ]].map(boardToWorld));
  const toLed = new THREE.CatmullRomCurve3([[-2.99, -16.22, routeZ], [1.5, -9, routeZ], [4.6, -3, routeZ], [2.87, 2.0, 1.4]].map(boardToWorld));
  const routeMat = new THREE.LineDashedMaterial({ color: '#7ad3ff', dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.0, depthTest: false });
  const routeLines = [toMcu, toLed].map((c) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(60)), routeMat);
    l.computeLineDistances();
    l.renderOrder = 10;
    overlays.add(l);
    return l;
  });
  // chapter 2: the M7 and the Edge TPU, and the results going out through the USB-C port
  const tpuC = [PART_MM.tpu[0], PART_MM.tpu[1], routeZ];
  const toTpu = new THREE.CatmullRomCurve3([[-2.99, -16.22, routeZ], [-4.2, -6, routeZ], [-1.5, 4.5, routeZ], tpuC].map(boardToWorld));
  const fromTpu = new THREE.CatmullRomCurve3([tpuC, [5.5, 4.0, routeZ], [3.2, -7, routeZ], [-2.99, -16.22, routeZ]].map(boardToWorld));
  const toUsb = new THREE.CatmullRomCurve3([[-2.99, -16.22, routeZ], [-1.5, -24, routeZ], [0, -30.5, routeZ], [0, -34.5, 0.5]].map(boardToWorld));
  const ROUTES = { toMcu, toLed, toTpu, fromTpu, toUsb };
  if (opts.cascade) {
    for (const c of [toTpu, fromTpu, toUsb]) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(60)), routeMat);
      l.computeLineDistances();
      l.renderOrder = 10;
      overlays.add(l);
    }
  }
  const tpuGlow = sprite('#f4f6ff', 2.0);
  tpuGlow.position.copy(boardToWorld([PART_MM.tpu[0], PART_MM.tpu[1], 2.2]));
  const pulse = sprite('#7ad3ff', 0.55);
  const mcuGlow = sprite('#c58cff', 1.6);
  mcuGlow.position.copy(boardToWorld([PART_MM.mcu[0], PART_MM.mcu[1], 2.0]));
  const lensGlow = sprite('#7ad3ff', 1.0);
  lensGlow.position.copy(boardToWorld([0, 21.5, 5.0]));

  /* ---------------- tappable parts (invisible, larger than the tiny LEDs so a finger can hit them) ---------------- */
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hits = [fig.hit];
  const hitParts = [['camera', [9, 9, 6]], ['mcu', [14, 14, 4]], ['tpu', [15, 10, 4]], ['ledCam', [5, 3.2, 4]], ['ledUser', [4, 4.5, 4]]];
  if (opts.cascade) hitParts.push(['ledTpu', [4, 3, 4]], ['ledStatus', [4, 3.2, 4]], ['usb', [10, 6, 4]]);
  for (const [part, size] of hitParts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), hitMat);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(RIGHT, UP, FACING).scale(V(S, S, S)).setPosition(boardToWorld(PART_MM[part]));
    g.add(m);
    m.userData.hit = part;
    assembly.add(g);
    hits.push(m);
  }

  /* ---------------- the camera image panel ---------------- */
  const RT = 256; // drawn at 256 x 256; the sensor gives 324 x 324
  const rt = new THREE.WebGLRenderTarget(RT, RT, { samples: 0 });
  const rt96 = new THREE.WebGLRenderTarget(CORAL.model.inputW, CORAL.model.inputH, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
  const vcam = new THREE.PerspectiveCamera(FOV.vDeg, 1, 0.03, 120);
  vcam.position.copy(LENS);
  vcam.up.set(0, 1, 0);
  vcam.lookAt(LENS.clone().add(FACING));
  vcam.updateMatrixWorld();
  // 96 x 96 grayscale: what the model receives (CameraFormat::kY8), with the light level applied
  const grayMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: rt.texture }, gain: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float gain; varying vec2 vUv; void main() { vec3 c = texture2D(map, vUv).rgb * gain; float y = dot(c, vec3(0.2126, 0.7152, 0.0722)); y = pow(clamp(y, 0.0, 1.0), 1.0 / 2.2); gl_FragColor = vec4(vec3(y), 1.0); }',
    depthTest: false, depthWrite: false,
  });
  const grayScene = new THREE.Scene();
  grayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), grayMat));
  const grayCam = new THREE.Camera();
  const pixels = new Uint8Array(CORAL.model.inputW * CORAL.model.inputH * 4);
  let pixelsFresh = false, lastShot = -1e9, inner = false, wantPixels = false, light = 1;

  const panel = new THREE.Group();
  panel.position.set(9.0, 0, 4.4); // front-right: outside the camera's view, clear of the board and the path
  panel.rotation.y = -0.35;
  root.add(panel);
  const PW = 3.4;
  const panelTilt = new THREE.Group();
  panelTilt.position.y = 0.25;
  panelTilt.rotation.x = -0.38;
  panel.add(panelTilt);
  const frameMat = std('#1b2133', 0.5);
  const frameBox = box(panelTilt, PW + 0.36, PW + 1.3, 0.16, frameMat, 0, (PW + 1.3) / 2, -0.09);
  frameBox.castShadow = true;
  const imgMat = new THREE.MeshBasicMaterial({ map: rt.texture });
  const img = new THREE.Mesh(new THREE.PlaneGeometry(PW, PW), imgMat);
  img.position.set(0, 0.18 + PW / 2, 0.005);
  img.frustumCulled = false;
  panelTilt.add(img);
  // host client mode: the window shows only what the board sends (frames and poses while the M7 runs)
  const rtClient = clientPanel ? new THREE.WebGLRenderTarget(RT, RT, { samples: 0 }) : null;
  let clientFrameWanted = false, clientHasImage = false;
  const clientCanvas = clientPanel ? document.createElement('canvas') : null;
  let clientTex = null, waitMesh = null, blackMesh = null;
  if (clientPanel) {
    imgMat.map = rtClient.texture;
    clientCanvas.width = clientCanvas.height = 324; // the image size the board reports (MSG_TYPE_SETUP: 324 x 324)
    clientTex = new THREE.CanvasTexture(clientCanvas);
    clientTex.colorSpace = THREE.SRGBColorSpace;
    const over = new THREE.Mesh(new THREE.PlaneGeometry(PW, PW), new THREE.MeshBasicMaterial({ map: clientTex, transparent: true, depthWrite: false }));
    over.position.set(0, 0.18 + PW / 2, 0.012);
    over.frustumCulled = false;
    panelTilt.add(over);
    blackMesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PW), new THREE.MeshBasicMaterial({ color: '#000000' }));
    blackMesh.position.set(0, 0.18 + PW / 2, 0.008);
    panelTilt.add(blackMesh);
    waitMesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PW), new THREE.MeshBasicMaterial({ map: captionTexture([[CLIENT_WAIT_TEXT, 30, '#ffffff', 266]], 512, 512, '#000000') }));
    waitMesh.position.set(0, 0.18 + PW / 2, 0.009);
    waitMesh.visible = false;
    panelTilt.add(waitMesh);
  }
  const capTop = new THREE.Mesh(new THREE.PlaneGeometry(PW, 0.62), new THREE.MeshBasicMaterial({ map: captionTexture([[clientPanel ? 'HOST CLIENT WINDOW · SIMULATED' : 'CAMERA IMAGE · SIMULATED', clientPanel ? 27 : 31, '#f3d36b', 56]], 512, 92) }));
  capTop.position.set(0, PW + 0.6, 0.005);
  panelTilt.add(capTop);
  const recDot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 18), new THREE.MeshBasicMaterial({ color: '#ff4a3d' }));
  recDot.position.set(-PW / 2 + 0.22, PW - 0.05, 0.012);
  panelTilt.add(recDot);
  const panelAnchor = new THREE.Object3D();
  panelAnchor.position.set(0, PW + 1.0, 0);
  panelTilt.add(panelAnchor);

  const prevClear = new THREE.Color();
  let shotKey = '';
  img.onBeforeRender = (renderer, scene) => {
    if (inner) return;
    const now = performance.now();
    // a new camera image only when what the camera sees changes (the figure moves or the light changes), at most
    // about 15 times a second, plus one refresh a second; a still scene gives the same image
    const key = `${u.toFixed(4)}|${walkPhase.toFixed(2)}|${light}|${root.visible}|${poseKey}`;
    // the host client copy only renders when the board sends a frame (or the notebook wants the 96 x 96 input)
    if (clientPanel ? !(clientFrameWanted || wantPixels) : now - lastShot < 66 || (key === shotKey && !wantPixels && now - lastShot < 1000)) return;
    shotKey = key;
    lastShot = now;
    inner = true;
    const prevTarget = renderer.getRenderTarget(), prevXr = renderer.xr.enabled, prevShadow = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    overlays.visible = false;
    panel.visible = false;
    renderer.setClearColor(ROOM_BG, 1);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, vcam);
    if (clientPanel && clientFrameWanted) {
      // the frame the board compresses and sends: the same view, kept until the next one arrives
      renderer.setRenderTarget(rtClient);
      renderer.clear();
      renderer.render(scene, vcam);
      clientFrameWanted = false;
      clientHasImage = true;
    }
    grayMat.uniforms.gain.value = light;
    renderer.setRenderTarget(rt96);
    renderer.render(grayScene, grayCam);
    if (wantPixels) {
      renderer.readRenderTargetPixels(rt96, 0, 0, CORAL.model.inputW, CORAL.model.inputH, pixels);
      pixelsFresh = true;
      wantPixels = false;
    }
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.xr.enabled = prevXr;
    overlays.visible = true;
    panel.visible = true;
    inner = false;
  };

  // the assembly was built in scene coordinates: move its origin under the board so its pop-in grows in place
  const A0 = V(ORIGIN.x, 0, ORIGIN.z);
  const shift = new THREE.Matrix4().makeTranslation(-A0.x, -A0.y, -A0.z);
  for (const c of assembly.children) {
    if (!c.matrixAutoUpdate) c.matrix.premultiply(shift);
    else if (c === cable) c.geometry.translate(-A0.x, -A0.y, -A0.z);
    else c.position.sub(A0);
  }
  assembly.position.copy(A0);

  /* ---------------- pop-in ---------------- */
  const pieces = [scalePiece(assembly, 0, 0.9, 1.2), scalePiece(fig.group, 0.5, 0.8, 1.0), scalePiece(panel, 0.8, 0.8, 1.0)];
  const POP = 2.2;
  let popK = 0;
  const applyPop = (tp) => {
    root.visible = tp > 0;
    popK = clamp01((tp - 1.2) / 1.0);
    for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
    overlays.visible = popK > 0.01;
  };
  // the pop-in moves the figure group: keep the figure's real position in placeFigure()
  const figureBaseY = () => fig.group.position.y;

  const figAnchor = new THREE.Vector3();
  const panelWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  return {
    root,
    popDuration: POP,
    setPop: applyPop,
    hitMeshes: () => hits,
    pinhole: pin,
    figureWorld,
    path: { out: STAGE_OUT, in: STAGE_IN },
    get u() {
      return u;
    },
    setU(v, moving) {
      const nu = clamp01(v);
      if (moving && Math.abs(nu - u) > 1e-6) walkPhase += Math.abs(nu - u) * 26;
      u = nu;
      const y = figureBaseY();
      placeFigure();
      fig.group.position.y = y;
    },
    /** Parameter of the path nearest to a scene point (for dragging). */
    uAt(p) {
      const d = STAGE_IN.clone().sub(STAGE_OUT);
      return clamp01(tmp.copy(p).sub(STAGE_OUT).setY(0).dot(d.setY(0)) / d.lengthSq());
    },
    selectPart,
    get selected() {
      return selected;
    },
    /** Posable figure: the 17 keypoints in the scene, [x, y, z] each, in KEYPOINTS order (null for chapter 1). */
    keypointsWorld() {
      if (!posable) return null;
      const keep = fig.group.scale.clone();
      fig.group.scale.set(1, 1, 1); // the real position, not the pop-in animation
      fig.group.updateMatrixWorld(true);
      const out = fig.keypoints.map((o) => o.getWorldPosition(tmp).toArray());
      fig.group.scale.copy(keep);
      fig.group.updateMatrixWorld(true);
      return out;
    },
    /** Posable figure: the pose to move to (missing keys keep their goal). */
    setPose(p) {
      Object.assign(poseGoal, p);
    },
    /** Posable figure: jump to the goal pose at once (tests, page turns). */
    snapPose() {
      Object.assign(fig.pose, poseGoal);
      fig.apply(fig.pose, 0);
    },
    get poseGoal() {
      return { ...poseGoal };
    },
    /** Host client: the board sent a frame; the copy of the window shows it from the next render on. */
    clientFrame() {
      clientFrameWanted = true;
    },
    /**
     * Host client window. mode: 'black' (no frame yet), 'image', 'waiting' (the low power text);
     * points: 17 entries [x, y] in pixels of the 324 x 324 image or null; edges: pairs to draw.
     */
    setClient({ mode, points, edges }) {
      if (!clientPanel) return;
      blackMesh.visible = mode === 'black' || (mode === 'image' && !clientHasImage);
      waitMesh.visible = mode === 'waiting';
      const ctx = clientCanvas.getContext('2d');
      ctx.clearRect(0, 0, 324, 324);
      if (mode === 'image' && points) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2.5;
        for (const [a, b] of edges) {
          if (!points[a] || !points[b]) continue;
          ctx.beginPath();
          ctx.moveTo(points[a][0], points[a][1]);
          ctx.lineTo(points[b][0], points[b][1]);
          ctx.stroke();
        }
        for (const p of points) {
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); // r = 5 px, as update_poses() draws them
          ctx.fillStyle = '#00ffff';
          ctx.fill();
          ctx.strokeStyle = '#ffff00';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      clientTex.needsUpdate = true;
    },
    resetClient() {
      clientHasImage = false;
    },
    setLight(v) {
      light = v;
      imgMat.color.setScalar(v);
    },
    requestPixels() {
      wantPixels = true;
    },
    takePixels() {
      if (!pixelsFresh) return null;
      pixelsFresh = false;
      return pixels;
    },
    anchors: {
      camera: boardToWorld([-6.5, 21.5, 4]),
      ledCam: boardToWorld([0, 26.0, 1]),
      ledUser: boardToWorld([2.87, 2.0, 1]),
      mcu: boardToWorld([-2.99, -16.22, 2]),
      tpu: boardToWorld([3.06, 10.51, 1.2]),
      ledTpu: boardToWorld([PART_MM.ledTpu[0], PART_MM.ledTpu[1], 1]),
      ledStatus: boardToWorld([PART_MM.ledStatus[0], PART_MM.ledStatus[1], 1]),
      usb: boardToWorld([0, -33, 1]),
      board: boardToWorld([12, -10, 0]),
      stand: V(ORIGIN.x + 1.6, 0.5, ORIGIN.z + 1.2),
      panel: panelWorld, // follows the panel (updated every frame)
      figure: figAnchor,
      out: STAGE_OUT.clone().setY(0.1),
    },
    panelAnchor,
    /** Every frame. st: { camLed, userLed, stage, stageK, showFov, scoresOk } */
    update(time, dt, st) {
      // walking: legs and arms swing while the figure moves along the path
      const sw = Math.sin(walkPhase) * 0.55 * (st.walking ? 1 : 0);
      if (posable) {
        // the arms and legs move smoothly toward the chosen pose
        const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
        let moved = 0;
        for (const key of Object.keys(REST_POSE)) {
          const d = poseGoal[key] - fig.pose[key];
          fig.pose[key] += d * k;
          moved += Math.abs(d);
        }
        fig.apply(fig.pose, sw);
        poseKey = moved > 0.002 || sw !== 0 ? Object.values(fig.pose).map((v) => v.toFixed(3)).join(',') + sw.toFixed(2) : poseKey;
      } else {
        fig.legs[0].rotation.x = sw;
        fig.legs[1].rotation.x = -sw;
        fig.arms[0].rotation.x = -sw * 0.8;
        fig.arms[1].rotation.x = sw * 0.8;
      }
      fig.head.rotation.y = Math.sin(time * 0.7) * 0.06;
      figAnchor.copy(fig.group.position).add(V(0, FIGURE_H + 0.4, 0));
      panelAnchor.getWorldPosition(panelWorld);
      setLed('ledCam', st.camLed);
      setLed('ledUser', st.userLed);
      ledGlow.ledCam.material.opacity = (st.camLed ? 0.95 : 0) * popK;
      ledGlow.ledUser.material.opacity = (st.userLed ? 0.95 : 0) * popK;
      if (opts.cascade) {
        setLed('ledTpu', !!st.tpuLed);
        setLed('ledStatus', !!st.statusLed);
        ledGlow.ledTpu.material.opacity = (st.tpuLed ? 0.9 : 0) * popK;
        ledGlow.ledStatus.material.opacity = (st.statusLed ? 0.85 : 0) * popK;
      }
      recDot.visible = st.camLed && Math.sin(time * 5) > -0.2;
      for (const m of fovGroup) m.visible = st.showFov;
      ringIn.material.color.set(st.userLed ? '#2e9e55' : '#8c93b3');
      ringOut.material.opacity = 0.85 * popK;
      // the pipeline: capture glows at the lens, the image travels to the MCU, the MCU infers, the result goes to the LED
      const k = st.stageK;
      routeMat.opacity = (st.showRoute ? 0.85 : 0) * popK;
      if (opts.cascade) {
        // chapter 2: one pulse along a named route, glows on the lens, the MCU (colour = which core) and the Edge TPU
        const on = st.showRoute ? popK : 0;
        lensGlow.material.opacity = (st.lens ? 0.9 * (1 - k * 0.6) : 0) * on;
        mcuGlow.material.color.set(st.mcuColor || '#c58cff');
        mcuGlow.material.opacity = (st.mcuColor ? 0.5 + 0.35 * Math.sin(time * 18) : 0) * on;
        tpuGlow.material.opacity = (st.tpuBusy ? 0.45 + 0.3 * Math.sin(time * 22) : 0) * on;
        const r = st.flow && ROUTES[st.flow.route];
        if (r && on) {
          pulse.position.copy(r.getPoint(Math.min(1, st.flow.k)));
          pulse.material.color.set(st.flow.color || '#7ad3ff');
          pulse.material.opacity = 0.95 * popK;
        } else pulse.material.opacity = 0;
        // the pose on the figure, joined like the client joins it
        skel.visible = !!st.skeleton && popK > 0.5;
        if (skel.visible) {
          const found = st.skeleton;
          fig.group.updateMatrixWorld(true);
          fig.keypoints.forEach((o, i) => o.getWorldPosition(kpWorld[i]));
          let n = 0;
          for (const [a, b] of st.edges) {
            kpWorld[a].toArray(skelPos, n * 3);
            kpWorld[b].toArray(skelPos, n * 3 + 3);
            n += 2;
          }
          skelPos.fill(0, n * 3);
          skelGeo.attributes.position.needsUpdate = true;
          skelGeo.setDrawRange(0, n);
          skelDots.forEach((d, i) => {
            d.visible = found[i];
            d.position.copy(kpWorld[i]);
          });
        }
      } else {
      lensGlow.material.opacity = (st.stage === 'capture' ? 0.9 * (1 - k * 0.6) : 0) * popK * (st.showRoute ? 1 : 0);
      mcuGlow.material.opacity = (st.stage === 'infer' ? 0.55 + 0.35 * Math.sin(time * 18) : 0) * popK * (st.showRoute ? 1 : 0);
      if (st.stage === 'resize' && st.showRoute) {
        pulse.position.copy(toMcu.getPoint(k));
        pulse.material.color.set('#7ad3ff');
        pulse.material.opacity = 0.95 * popK;
      } else if (st.stage === 'decide' && st.showRoute) {
        pulse.position.copy(toLed.getPoint(k));
        pulse.material.color.set(st.decision ? '#6dff8f' : '#9aa0b4');
        pulse.material.opacity = 0.95 * popK;
      } else pulse.material.opacity = 0;
      }
      // highlight of the selected part
      if (selected) {
        const a = 0.55 + 0.45 * Math.sin(time * 4);
        outline.material.opacity = (0.65 + 0.35 * a) * popK;
        outlineGlow.material.opacity = 0.5 * a * popK;
      }
      for (const [part, mats] of Object.entries(model.materials)) {
        if (part.startsWith('led')) continue;
        const on = selected === part;
        for (const m of mats) {
          m.emissive.set(on ? '#ffb020' : '#000000');
          m.emissiveIntensity = on ? 0.25 + 0.2 * Math.sin(time * 4) : 0;
        }
      }
      void dt;
    },
  };
}
