import * as THREE from 'three';
import { V, std, roundedSlab, box, cylinderBetween } from '../../circuit.js';

/*
 * ESP32-DevKitC V4 with an ESP32-WROOM-32E (Espressif part ESP32-DevKitC-32E): 38 pins in two rows of 19, rows
 * 25.4 mm apart, board about 54.4 x 27.9 mm. Micro-USB at one short end, the module (with the PCB antenna) at the
 * other. This is a simplified model: it keeps the recognizable parts (module, antenna, USB, EN and BOOT buttons,
 * UART bridge, power LED, both header rows) and the pin order of the real board.
 *
 * Local frame: x runs along the board (antenna at -x, USB at +x), z across it, y up. Header J2 (the "left" row when
 * the USB is at the bottom and the antenna on top) is at +z. In the scene J2 faces the breadboard.
 * Pin order, antenna side first (same order as the DevKitC V4 pin layout):
 */
export const J2 = ['3V3', 'EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'SD2', 'SD3', 'CMD', '5V'];
export const J3 = ['GND', 'IO23', 'IO22', 'TX', 'RX', 'IO21', 'GND', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'SD1', 'SD0', 'CLK'];
/** What each silkscreen name is: the GPIO number (or a power / control pin). */
export const GPIO_OF = { VP: 36, VN: 39, TX: 1, RX: 3, SD2: 9, SD3: 10, CMD: 11, SD1: 8, SD0: 7, CLK: 6 };

export const ESP = { len: 5.44, wid: 2.79, pitch: 0.254, rowZ: 1.27, y: 0.3, pcbT: 0.16 };
const TOP = ESP.y + ESP.pcbT; // top face of the PCB

/** Header pin tip in the board's local frame. */
export function pinLocal(name, header = null) {
  let side = header, i;
  if (!side) {
    i = J2.indexOf(name);
    side = 'J2';
    if (i < 0) {
      i = J3.indexOf(name);
      side = 'J3';
    }
  } else i = (side === 'J2' ? J2 : J3).indexOf(name);
  if (i < 0) throw new Error(`Unknown ESP32 pin ${name}`);
  return V((i - 9) * ESP.pitch, TOP + 0.13, side === 'J2' ? ESP.rowZ : -ESP.rowZ);
}
/** Pin names that need to be told apart (they exist on both rows). */
export const pinIndexOf = (header, name) => (header === 'J2' ? J2 : J3).indexOf(name);

const canvasTex = (c) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
};
let silkCache = null;

/** White silkscreen with the pin names. `used` marks the pins the chapter wires (name -> color). */
function silkTexture(used) {
  const key = JSON.stringify(used);
  if (silkCache && silkCache.key === key) return silkCache.tex;
  const PX = 300; // pixels per cm
  const [c, ctx] = mk(Math.round(ESP.len * PX), Math.round(ESP.wid * PX));
  const X = (x) => (x + ESP.len / 2) * PX;
  const Z = (z) => (z + ESP.wid / 2) * PX;
  ctx.textBaseline = 'middle';
  const draw = (list, header) => {
    list.forEach((name, i) => {
      const x = (i - 9) * ESP.pitch;
      const z = header === 'J2' ? ESP.rowZ : -ESP.rowZ;
      const color = used[`${header}:${name}`];
      ctx.save();
      ctx.translate(X(x), Z(z));
      ctx.rotate(header === 'J2' ? -Math.PI / 2 : Math.PI / 2); // text runs from the pin toward the middle of the board
      ctx.font = `700 ${0.2 * PX}px "Segoe UI", Arial, sans-serif`;
      const w = ctx.measureText(name).width;
      const off = 0.2 * PX;
      if (color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(off - 0.05 * PX, -0.115 * PX, w + 0.1 * PX, 0.23 * PX, 0.04 * PX);
        ctx.fill();
        ctx.fillStyle = '#0b0b0b';
      } else ctx.fillStyle = '#e8e8e8';
      ctx.textAlign = 'left';
      ctx.fillText(name, off, 0);
      ctx.restore();
    });
  };
  draw(J2, 'J2');
  draw(J3, 'J3');
  // small marks: board name near the middle, and the pin-1 style notes
  ctx.fillStyle = '#e8e8e8';
  ctx.font = `700 ${0.19 * PX}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('ESP32-DevKitC', X(0.35), Z(0));
  ctx.font = `600 ${0.14 * PX}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText('EN', X(1.9), Z(0.72 + 0.34));
  ctx.fillText('BOOT', X(1.9), Z(-0.72 - 0.34));
  const tex = canvasTex(c);
  silkCache = { key, tex };
  return tex;
}

let moduleTex = null;
function moduleTexture() {
  if (moduleTex) return moduleTex;
  const PX = 400;
  const [c, ctx] = mk(Math.round(2.55 * PX), Math.round(1.8 * PX)); // 25.5 x 18 mm: antenna part (6.5 mm) then the shield
  const aw = 0.65 * PX;
  // antenna area: PCB with the meandered trace
  ctx.fillStyle = '#e8ecee';
  ctx.fillRect(0, 0, aw, c.height);
  ctx.strokeStyle = '#b08a35';
  ctx.lineWidth = 0.05 * PX;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let up = true;
  ctx.moveTo(aw - 0.05 * PX, 0.1 * PX);
  for (let y = 0.1 * PX; y < c.height - 0.1 * PX; y += 0.2 * PX) {
    ctx.lineTo(up ? 0.08 * PX : aw - 0.08 * PX, y);
    ctx.lineTo(up ? 0.08 * PX : aw - 0.08 * PX, y + 0.1 * PX);
    up = !up;
  }
  ctx.stroke();
  // shield: brushed metal with markings
  const g = ctx.createLinearGradient(aw, 0, c.width, c.height);
  g.addColorStop(0, '#cfd3d8');
  g.addColorStop(0.5, '#e6e8ec');
  g.addColorStop(1, '#bfc4ca');
  ctx.fillStyle = g;
  ctx.fillRect(aw, 0, c.width - aw, c.height);
  ctx.fillStyle = '#2b2f36';
  ctx.textAlign = 'center';
  ctx.font = `700 ${0.2 * PX}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText('ESP32-WROOM-32E', aw + (c.width - aw) / 2, c.height * 0.4);
  ctx.font = `600 ${0.15 * PX}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText('16 MB flash · 2.4 GHz Wi-Fi + BT', aw + (c.width - aw) / 2, c.height * 0.58);
  ctx.fillStyle = '#707782';
  ctx.fillRect(aw + 0.12 * PX, c.height * 0.76, 0.3 * PX, 0.3 * PX);
  moduleTex = canvasTex(c);
  return moduleTex;
}

/**
 * @param used  map 'J2:IO25' -> highlight color for the pins that the chapter uses
 */
export function buildEsp32Board(used = {}) {
  const g = new THREE.Group();
  const pcbMat = std('#15181d', 0.55, 0.05);
  const pcb = new THREE.Mesh(roundedSlab(ESP.len, ESP.wid, ESP.pcbT, 0.14), pcbMat);
  pcb.position.y = ESP.y;
  g.add(pcb);

  // silkscreen
  const silk = new THREE.Mesh(
    new THREE.PlaneGeometry(ESP.len, ESP.wid),
    new THREE.MeshBasicMaterial({ map: silkTexture(used), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, toneMapped: false }),
  );
  silk.rotation.x = -Math.PI / 2;
  silk.position.y = TOP + 0.003;
  silk.userData.noShadow = true;
  g.add(silk);

  // WROOM-32E module: 18 x 25.5 x 3.1 mm, antenna end slightly past the board edge
  const modLen = 2.55, modW = 1.8, modH = 0.31;
  const modX = -ESP.len / 2 - 0.07 + modLen / 2;
  const mod = new THREE.Group();
  mod.position.set(modX, TOP, 0);
  g.add(mod);
  const antPcb = box(mod, 0.65, 0.06, modW, std('#e8ecee', 0.6), -modLen / 2 + 0.325, 0.03, 0);
  const shieldLen = modLen - 0.65;
  const shield = box(mod, shieldLen, modH - 0.06, modW, std('#c5c9cf', 0.3, 0.85), -modLen / 2 + 0.65 + shieldLen / 2, 0.06 + (modH - 0.06) / 2, 0);
  const modTop = new THREE.Mesh(
    new THREE.PlaneGeometry(modLen, modW),
    new THREE.MeshBasicMaterial({ map: moduleTexture(), transparent: true, polygonOffset: true, polygonOffsetFactor: -1, toneMapped: false }),
  );
  modTop.rotation.x = -Math.PI / 2;
  modTop.position.set(0, modH + 0.002, 0);
  modTop.userData.noShadow = true;
  // the texture puts the antenna on its left (u = 0): that is -x, as the plane's local x is the board's x
  mod.add(modTop);
  void antPcb;
  void shield;

  // micro-USB connector at +x (slightly overhanging), with its opening
  const usb = new THREE.Group();
  usb.position.set(ESP.len / 2 - 0.3, TOP, 0);
  g.add(usb);
  const metal = std('#b9bec6', 0.3, 0.9);
  box(usb, 0.75, 0.26, 0.78, metal, 0.22, 0.13, 0);
  box(usb, 0.06, 0.1, 0.5, std('#07080a', 0.9), 0.62, 0.13, 0);
  box(usb, 0.5, 0.02, 0.72, std('#2a2d33', 0.6), 0.1, 0.27, 0);

  // EN and BOOT buttons next to the USB connector (BOOT on the J3 side)
  for (const [z, label] of [[0.72, 'en'], [-0.72, 'boot']]) {
    const bx = 1.95;
    box(g, 0.4, 0.07, 0.4, std('#c0c4ca', 0.35, 0.8), bx, TOP + 0.035, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 18), std(label === 'en' ? '#2b2d33' : '#2b2d33', 0.6));
    cap.position.set(bx, TOP + 0.12, z);
    g.add(cap);
  }
  // CP2102 UART bridge, 3.3 V regulator, power LED, a few SMD parts
  box(g, 0.5, 0.09, 0.5, std('#0a0b0d', 0.5), 1.25, TOP + 0.045, 0.05);
  box(g, 0.65, 0.12, 0.34, std('#0a0b0d', 0.5), 0.62, TOP + 0.06, -0.2);
  box(g, 0.2, 0.05, 0.14, std('#ff3b2a', 0.4, 0, { emissive: '#ff1a10', emissiveIntensity: 0.5 }), 1.55, TOP + 0.025, 0.2);
  const cap = std('#a88f5a', 0.5, 0.2);
  [[0.15, 0.45], [0.4, 0.5], [0.9, 0.45], [0.95, -0.55], [1.6, -0.2], [-0.2, 0.4], [-0.35, -0.45]].forEach(([x, z]) => box(g, 0.17, 0.07, 0.1, cap, x, TOP + 0.035, z));

  // header rows: black plastic under the board, gold stubs on top
  const plastic = std('#0c0c0e', 0.6);
  const gold = std('#d8b25a', 0.28, 0.95);
  for (const side of [1, -1]) {
    const z = side * ESP.rowZ;
    box(g, ESP.pitch * 19, 0.25, ESP.pitch, plastic, 0, ESP.y - 0.125, z);
    for (let i = 0; i < 19; i++) {
      const x = (i - 9) * ESP.pitch;
      box(g, 0.055, 0.17, 0.055, gold, x, TOP + 0.085, z);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.006, 14), gold);
      ring.position.set(x, TOP + 0.004, z);
      g.add(ring);
      cylinderBetween(g, V(x, ESP.y - 0.22, z), V(x, ESP.y - 0.02, z), 0.025, gold);
    }
  }
  g.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { group: g, topY: TOP };
}
