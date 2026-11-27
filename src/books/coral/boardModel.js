import * as THREE from 'three';

/*
 * The Coral Dev Board Micro from Google's official CAD model (google-coral/mechanicals, dev_board_micro/
 * "Dev Board Micro.step", Apache-2.0; licence in model/LICENSE-coral-mechanicals.txt). It was converted offline with
 * OpenCascade (occt-import-js): tessellated, positions quantized to 1/900 mm, bodies grouped by board part and colour.
 * The CAD model has no printed markings and its colours are CAD defaults; the PCB green, the metal shield and the
 * LED lenses are retouched to look like the official photos. Geometry and positions are untouched.
 *
 * Frame (millimetres): x across the board, y along it (USB-C at -y), z up from the top face of the PCB.
 */
export const MODEL_URL = 'src/books/coral/model/';

/** Where the parts the chapter talks about are, in board millimetres (measured from the converted model). */
export const PART_MM = {
  lens: [0, 21.5, 3.46], // optical centre: apex of the "OP FOV" field-of-view solid of the CAD model
  camera: [0, 21.5, 2.0],
  ledCam: [0, 26.0, 0.34], // green Camera LED, above the camera
  ledTpu: [0, 17.0, 0.34], // white Edge TPU LED, between the camera and the shield
  ledUser: [2.87, 2.0, 0.34], // green User LED, near the centre, right of the user button
  ledStatus: [10.91, -23.41, 0.34], // orange Status LED
  button: [0, 2.0, 1.2],
  tpu: [3.06, 10.51, 0.75], // Coral Edge TPU under the metal shield
  mcu: [-2.99, -16.22, 1.52], // NXP i.MX RT1176 (Cortex-M7 + Cortex-M4), BGA 14 x 14 mm
  usb: [0, -33.0, -0.5],
  mic: [10.0, 22.5, 0.5], // PDM microphone: the "mic" bodies of the CAD model (x 8.5..11.5, y 20.5..24.5 mm)
};
/** Footprint sizes (mm) for the highlight outlines. */
export const PART_SIZE_MM = {
  camera: [8.5, 8.5], ledCam: [1.7, 0.8], ledUser: [0.8, 1.7], ledTpu: [1.62, 0.8], tpu: [15, 10], mcu: [14, 14], mic: [3, 4], ledStatus: [0.8, 1.6],
};

const RETOUCH = {
  pcb: () => ({ color: '#0e7a3e', roughness: 0.55, metalness: 0.05 }),
  tpu: (c) => (c[0] > 120 ? { color: '#c9ccd1', roughness: 0.32, metalness: 0.85 } : null),
};
const LED_PARTS = ['ledCam', 'ledUser', 'ledTpu', 'ledStatus'];

export async function loadBoardModel() {
  const [meta, buf] = await Promise.all([
    fetch(`${MODEL_URL}dev_board_micro.json`).then((r) => {
      if (!r.ok) throw new Error(`model metadata: HTTP ${r.status}`);
      return r.json();
    }),
    fetch(`${MODEL_URL}dev_board_micro.bin`).then((r) => {
      if (!r.ok) throw new Error(`model data: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const P = new Int16Array(buf, 0, meta.vertices * 3);
  const N = new Int8Array(buf, meta.normalsOffset, meta.vertices * 3);
  const X = new Uint32Array(buf, meta.indicesOffset, meta.indices);
  const root = new THREE.Group();
  root.name = 'Coral Dev Board Micro (official CAD model)';
  const parts = {}; // part -> [mesh]
  const materials = {}; // part -> [material]
  for (const g of meta.groups) {
    const pos = new Float32Array(g.vCount * 3), nor = new Float32Array(g.vCount * 3);
    for (let k = 0; k < g.vCount * 3; k++) {
      pos[k] = P[g.vStart * 3 + k] / meta.scale;
      nor[k] = N[g.vStart * 3 + k] / 127;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(X.slice(g.iStart, g.iStart + g.iCount), 1));
    geo.computeBoundingSphere();
    const c = g.color;
    const isLed = LED_PARTS.includes(g.part);
    const look = isLed
      ? { color: '#eef2ea', roughness: 0.25, metalness: 0, emissive: '#000000' }
      : RETOUCH[g.part]?.(c) || { color: new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace), roughness: 0.55, metalness: c[0] === c[1] && c[1] === c[2] && c[0] > 120 ? 0.6 : 0.1 };
    const mat = new THREE.MeshStandardMaterial(look);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = g.part;
    mesh.userData.part = g.part;
    mesh.castShadow = ['pcb', 'camera', 'tpu', 'mcu', 'usb'].includes(g.part); // the small parts add no visible shadow
    mesh.receiveShadow = true;
    root.add(mesh);
    (parts[g.part] ??= []).push(mesh);
    (materials[g.part] ??= []).push(mat);
  }
  return { root, parts, materials, meta };
}
