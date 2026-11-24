import * as THREE from 'three';
import { piSilkTexture, chipTexture } from './textures.js';

/*
 * Raspberry Pi 5, modelled from the reference photo. Local axes: +x toward the USB/Ethernet end, -z toward the
 * GPIO header edge, +z toward the USB-C / micro-HDMI edge. 1 unit = 1 cm (board 8.5 x 5.6).
 *
 * Positions follow the order and spacing visible in the photo, not a datasheet: USB-C, two micro-HDMI ports and two
 * small white connectors along the front edge; two flat camera/display connectors and a 4-pin header between them
 * and the Ethernet jack; USB (black), USB 3 (blue) and Ethernet along the right end; the PCIe flat connector on the
 * left edge; the metal wireless shield, RAM, silver SoC spreader and RP1 chip in the middle; a 4-pin fan connector
 * near the back right corner. Silkscreen only contains text that is readable in the photo.
 *
 * The model is built from a few dozen meshes plus two instanced groups (GPIO pins, small SMD parts), so it stays cheap.
 */
export function buildPiModel(k) {
  const { std, roundedSlab, box, PI_CENTER, PI_Y, PCB_T, HEADER_X, HEADER_H, PITCH } = k;
  const g = new THREE.Group();
  g.position.copy(PI_CENTER);
  const b = new THREE.Group();
  b.position.y = PI_Y;
  g.add(b);
  const y0 = PCB_T;

  /* ---------- materials ---------- */
  const mask = new THREE.MeshPhysicalMaterial({ color: '#1e8c4b', roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const shiny = { envMapIntensity: 2.6 }; // metals need a strong reflection to read as metal in this soft studio light
  const steel = std('#d6d9df', 0.3, 1, shiny);
  const steelDark = std('#aeb3bb', 0.34, 1, shiny);
  const tin = std('#cfd2d8', 0.4, 1, shiny);
  const black = std('#0e0e11', 0.5, 0.1);
  const darkHole = std('#050506', 0.9, 0);
  const plastic = std('#17171a', 0.55, 0);
  const gold = std('#eec45c', 0.3, 1, shiny);
  const white = std('#eeeae0', 0.5, 0);
  const beige = std('#d9ccaa', 0.55, 0);
  const blue = std('#2a62d8', 0.45, 0);

  /* ---------- helpers ---------- */
  const rr = (w, h, r, cx = 0, cy = 0) => {
    const s = new THREE.Shape();
    const x = cx - w / 2, y = cy - h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };
  const poly = (pts) => {
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
    return s;
  };
  /** Hollow metal shell: outline with holes, extruded `depth` along +z (then oriented by the caller). */
  const shellGeo = (outer, holes, depth) => {
    outer.holes.push(...holes.map((h) => new THREE.Path(h.getPoints())));
    return new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 6 });
  };
  const add = (geo, mat, x, y, z, parent = b) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  /** Port facing +x (USB / Ethernet): `faceX` is the open face, `len` the full length of the connector into the board. */
  const portX = ({ faceX, zc, w, h, holes, depth, len, plates = [], shell = steel }) => {
    const geo = shellGeo(rr(w, h, 0.05, 0, h / 2), holes, depth);
    geo.rotateY(Math.PI / 2); // extrusion runs along +x
    add(geo, shell, faceX - depth, y0, zc);
    add(new THREE.BoxGeometry(len - depth, h, w), shell, faceX - depth - (len - depth) / 2, y0 + h / 2, zc);
    // dark floor at the bottom of each opening, so the mouths read as deep holes
    for (const p of plates) add(new THREE.BoxGeometry(0.02, p.hh, p.hw), darkHole, faceX - depth + 0.012, y0 + p.cy, zc);
  };
  /** Port facing +z (USB-C / micro-HDMI). */
  const portZ = ({ faceZ, xc, w, h, holes, depth, len, plates = [], shell = steel }) => {
    const geo = shellGeo(rr(w, h, 0.05, 0, h / 2), holes, depth);
    add(geo, shell, xc, y0, faceZ - depth);
    add(new THREE.BoxGeometry(w, h, len - depth), shell, xc, y0 + h / 2, faceZ - depth - (len - depth) / 2);
    for (const p of plates) add(new THREE.BoxGeometry(p.hw, p.hh, 0.02), darkHole, xc, y0 + p.cy, faceZ - depth + 0.012);
  };

  /* ---------- PCB ---------- */
  add(roundedSlab(8.5, 5.6, PCB_T, 0.3), mask, 0, 0, 0);
  const silk = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 5.6),
    new THREE.MeshStandardMaterial({
      map: piSilkTexture(HEADER_X), transparent: true, roughness: 0.55,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }),
  );
  silk.rotation.x = -Math.PI / 2;
  silk.position.y = PCB_T + 0.002;
  silk.userData.noShadow = true;
  b.add(silk);

  /* ---------- chips ---------- */
  const chip = (kind, w, d, h, x, z, base = 0) => {
    const top = new THREE.MeshStandardMaterial({ map: chipTexture(kind), roughness: kind === 'soc' ? 0.3 : 0.55, metalness: kind === 'soc' ? 0.85 : 0.05 });
    const side = kind === 'soc' ? steelDark : black;
    const m = add(new THREE.BoxGeometry(w, h, d), [side, side, top, side, side, side], x, y0 + base + h / 2, z);
    return m;
  };
  // wireless module shield (metal can with a lower frame)
  add(new THREE.BoxGeometry(1.32, 0.05, 1.17), steelDark, -2.85, y0 + 0.025, -1.55);
  add(new THREE.BoxGeometry(1.25, 0.13, 1.1), tin, -2.85, y0 + 0.115, -1.55);
  for (const [dx, dz] of [[-0.3, -0.25], [0.3, 0.25], [0.3, -0.25], [-0.3, 0.25]]) {
    add(new THREE.SphereGeometry(0.035, 8, 6), steelDark, -2.85 + dx, y0 + 0.18, -1.55 + dz);
  }
  chip('ram', 1.5, 1.05, 0.09, -0.55, -0.6); // RAM
  add(new THREE.BoxGeometry(2.3, 0.04, 1.9), plastic, -0.5, y0 + 0.02, 0.7); // SoC substrate
  chip('soc', 2.0, 1.6, 0.15, -0.5, 0.7, 0.04); // BCM2712 under the heat spreader
  chip('rp1', 1.05, 1.05, 0.08, 2.0, 0.05); // RP1 I/O chip with logo
  chip('small', 0.55, 0.5, 0.07, 1.15, -1.45);
  chip('small', 0.45, 0.45, 0.07, 1.15, 1.05);
  chip('small', 0.6, 0.6, 0.07, -3.25, 1.5); // power management area near USB-C
  chip('small', 0.4, 0.4, 0.07, -2.45, 1.45);

  /* ---------- small SMD parts (instanced) ---------- */
  const zones = [
    [-3.95, -1.3, 1.15, 2.05, 30], [-2.35, -1.62, -0.1, 1.1, 10], [-3.4, -2.3, -0.8, 0.1, 10],
    [0.62, 1.1, 0.2, 1.8, 10], [0.3, 1.2, -1.5, -1.2, 8], [1.55, 2.5, 0.75, 1.25, 4],
  ];
  const total = zones.reduce((n, z) => n + z[4], 0);
  const smd = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('#ffffff', 0.55, 0.15), total);
  const palette = ['#c4ab7c', '#2b2b30', '#b9bcc2', '#d1b46a', '#46464d'].map((c) => new THREE.Color(c));
  const mtx = new THREE.Matrix4(), rot = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let n = 0;
  for (const [x0, x1, z0, z1, count] of zones) {
    for (let i = 0; i < count; i++) {
      const horizontal = rnd() > 0.5;
      const len = 0.11 + rnd() * 0.07, wid = 0.06 + rnd() * 0.04, hh = 0.04 + rnd() * 0.03;
      sc.set(horizontal ? len : wid, hh, horizontal ? wid : len);
      ps.set(x0 + rnd() * (x1 - x0), y0 + hh / 2, z0 + rnd() * (z1 - z0));
      mtx.compose(ps, rot, sc);
      smd.setMatrixAt(n, mtx);
      smd.setColorAt(n, palette[Math.floor(rnd() * palette.length)]);
      n++;
    }
  }
  b.add(smd);
  for (const [x, z] of [[-2.9, 1.62], [-2.4, 1.1], [-1.9, 1.65]]) add(new THREE.BoxGeometry(0.34, 0.14, 0.34), black, x, y0 + 0.07, z); // inductors

  /* ---------- GPIO header: plastic base + gold pins ---------- */
  const hx = HEADER_X, hz = -2.35;
  add(new THREE.BoxGeometry(5.18, HEADER_H, 0.51), plastic, hx, y0 + HEADER_H / 2, hz);
  add(new THREE.BoxGeometry(5.22, 0.03, 0.55), black, hx, y0 + HEADER_H + 0.005, hz); // top lip
  const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.064, 0.45, 0.064), gold, 40);
  const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.046, 0.07, 4, 1), gold, 40);
  const m4 = new THREE.Matrix4(), tipRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  for (let i = 1; i <= 40; i++) {
    const c = Math.floor((i - 1) / 2);
    const x = hx - 2.413 + c * PITCH, z = hz + (i % 2 ? 0.127 : -0.127);
    m4.setPosition(x, y0 + HEADER_H + 0.225, z);
    pins.setMatrixAt(i - 1, m4);
    m4.compose(new THREE.Vector3(x, y0 + HEADER_H + 0.485, z), tipRot, new THREE.Vector3(1, 1, 1));
    tips.setMatrixAt(i - 1, m4);
  }
  b.add(pins, tips);

  /* ---------- small connectors ---------- */
  const jst = (x, z, w, d, pinsN) => {
    add(new THREE.BoxGeometry(w, 0.22, d), white, x, y0 + 0.11, z);
    add(new THREE.BoxGeometry(w - 0.1, 0.03, d - 0.12), darkHole, x, y0 + 0.225, z);
    for (let i = 0; i < pinsN; i++) add(new THREE.BoxGeometry(0.03, 0.04, 0.1), gold, x + (i - (pinsN - 1) / 2) * 0.1, y0 + 0.24, z);
  };
  jst(2.38, -2.25, 0.46, 0.45, 4); // fan connector, near the back right corner
  jst(-2.4, 2.45, 0.46, 0.38, 2); // white connector between USB-C and the first micro-HDMI
  jst(-0.98, 2.45, 0.5, 0.38, 3); // white connector between the two micro-HDMI ports

  // flat-cable connectors: PCIe on the left edge, two camera/display connectors near the front edge
  const ffc = (x, z, w, len, alongZ) => {
    const sx = alongZ ? w : len, sz = alongZ ? len : w;
    add(new THREE.BoxGeometry(sx, 0.16, sz), white, x, y0 + 0.08, z);
    add(new THREE.BoxGeometry(alongZ ? w * 0.55 : len * 0.92, 0.07, alongZ ? len * 0.92 : w * 0.55), beige, x + (alongZ ? w * 0.12 : 0), y0 + 0.19, z);
    add(new THREE.BoxGeometry(alongZ ? w * 0.2 : len * 0.8, 0.02, alongZ ? len * 0.8 : w * 0.2), darkHole, x - (alongZ ? w * 0.36 : 0), y0 + 0.165, z);
  };
  ffc(-3.78, -0.2, 0.6, 1.4, true);
  ffc(0.95, 2.0, 0.4, 1.3, true);
  ffc(1.5, 2.0, 0.4, 1.3, true);

  // 4-pin header next to the Ethernet jack
  add(new THREE.BoxGeometry(0.54, 0.2, 0.54), plastic, 2.0, y0 + 0.1, 1.05);
  for (const [dx, dz] of [[-0.127, -0.127], [0.127, -0.127], [-0.127, 0.127], [0.127, 0.127]]) {
    add(new THREE.BoxGeometry(0.06, 0.4, 0.06), gold, 2.0 + dx, y0 + 0.3, 1.05 + dz);
  }

  /* ---------- USB-C and micro-HDMI (front edge) ---------- */
  portZ({
    faceZ: 2.93, xc: -3.13, w: 0.9, h: 0.33, depth: 0.5, len: 0.75, shell: steel,
    holes: [rr(0.7, 0.17, 0.08, 0, 0.165)], plates: [{ cy: 0.165, hw: 0.68, hh: 0.15 }],
  });
  add(new THREE.BoxGeometry(0.5, 0.04, 0.4), black, -3.13, y0 + 0.165, 2.72); // tongue
  for (const x of [-1.65, -0.3]) {
    portZ({
      faceZ: 2.9, xc: x, w: 0.66, h: 0.3, depth: 0.42, len: 0.55, shell: steelDark,
      holes: [poly([[-0.27, 0.215], [0.27, 0.215], [0.27, 0.12], [0.2, 0.065], [-0.2, 0.065], [-0.27, 0.12]])],
      plates: [{ cy: 0.14, hw: 0.5, hh: 0.14 }],
    });
    add(new THREE.BoxGeometry(0.4, 0.035, 0.3), black, x, y0 + 0.14, 2.62);
    add(new THREE.BoxGeometry(0.32, 0.01, 0.1), gold, x, y0 + 0.16, 2.72);
  }

  /* ---------- USB, USB 3 and Ethernet (right end) ---------- */
  const faceX = 4.35;
  const stackHoles = [rr(1.2, 0.5, 0.04, 0, -0.375 + 0.775), rr(1.2, 0.5, 0.04, 0, 0.375 + 0.775)];
  const stack = (zc, tongueMat) => {
    portX({ faceX, zc, w: 1.45, h: 1.55, depth: 0.95, len: 1.75, holes: stackHoles, shell: steel, plates: [{ cy: 0.4, hw: 1.18, hh: 0.48 }, { cy: 1.15, hw: 1.18, hh: 0.48 }] });
    for (const yc of [0.4, 1.15]) {
      add(new THREE.BoxGeometry(0.75, 0.06, 1.0), tongueMat, faceX - 0.52, y0 + yc, zc);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.22, 0.012, 0.07), gold, faceX - 0.2, y0 + yc + 0.035, zc - 0.22 + i * 0.145);
    }
    add(new THREE.BoxGeometry(1.2, 0.03, 0.35), steelDark, faceX - 0.9, y0 + 1.57, zc); // top tab
  };
  stack(-1.9, std('#18181b', 0.5)); // USB (black tongues)
  stack(-0.1, blue); // USB 3 (blue tongues)

  const ethHole = poly([[-0.6, 0.18], [-0.6, 0.98], [-0.15, 0.98], [-0.15, 1.1], [0.15, 1.1], [0.15, 0.98], [0.6, 0.98], [0.6, 0.18]]);
  portX({ faceX, zc: 1.77, w: 1.6, h: 1.35, depth: 1.25, len: 2.1, holes: [ethHole], shell: steel, plates: [{ cy: 0.64, hw: 1.18, hh: 0.9 }] });
  for (let i = 0; i < 8; i++) add(new THREE.BoxGeometry(0.5, 0.02, 0.04), gold, faceX - 0.65, y0 + 0.95, 1.77 - 0.385 + i * 0.11);
  add(new THREE.BoxGeometry(1.3, 0.03, 0.9), steelDark, faceX - 1.0, y0 + 1.36, 1.77); // label area

  /* ---------- standoffs ---------- */
  const brass = std('#a07a2f', 0.4, 0.9);
  for (const [x, z] of [[-3.9, -2.45], [1.9, -2.45], [-3.9, 2.45], [1.9, 2.45]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, PI_Y, 12), brass);
    s.position.set(x, PI_Y / 2, z);
    g.add(s);
  }
  return g;
}
