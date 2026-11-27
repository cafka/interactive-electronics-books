import * as THREE from 'three';
import { V, clamp01, std, box } from '../../circuit.js';
import { scalePiece } from '../../popin.js';
import { glowTexture } from '../../textures.js';
import { PART_MM, PART_SIZE_MM } from './boardModel.js';
import { buildBoardOnStand, centreAssembly, boardToWorld, captionTexture, FACING, RIGHT, UP, S } from './presenceScene.js';
import { ACOUSTIC } from './acoustic.js';

/*
 * Coral chapter 3 scene, on the right page (x 0..11, z -7..7, centimetres).
 *  - The Dev Board Micro from the official CAD model, on the same stand as chapters 1 and 2. Its PDM microphone is
 *    the CAD model's own "mic" part, near the camera.
 *  - A sound source (an illustration) in front of the board, near (1 m) or far (4 m), and sound waves when it plays.
 *    Distances are not to scale: the page is about 22 cm wide.
 *  - The path of each 975 ms window: microphone -> MCU (spectrogram) -> Edge TPU (YAMNet) -> MCU -> User LED.
 *  - A panel with the 96 x 64 spectrogram the page computed for the last window.
 */

const NEAR = 3.0, FAR = 6.6; // scene distance from the board for 1 m and 4 m (not to scale)
const MIC = boardToWorld([PART_MM.mic[0], PART_MM.mic[1], 1.2]);
const FRONT = V(MIC.x, 0, MIC.z);

/**
 * Paints a window's features (96 frames x 64 log mel bands) into a 2D context: time left to right, low bands at
 * the bottom, dark blue (quiet) to white (loud), scaled to the window's loudest 14 log units. Shared by the 3D
 * panel and the notebook.
 */
export function paintSpectrogram(c, features, W, H) {
  let lo = Infinity, hi = -Infinity;
  for (const row of features) for (const v of row) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  lo = Math.max(lo, hi - 14);
  const img = c.createImageData(ACOUSTIC.frames, ACOUSTIC.bands);
  for (let t = 0; t < ACOUSTIC.frames; t++) for (let b = 0; b < ACOUSTIC.bands; b++) {
    const v = clamp01((features[t][b] - lo) / (hi - lo || 1));
    const i = ((ACOUSTIC.bands - 1 - b) * ACOUSTIC.frames + t) * 4;
    img.data[i] = Math.round(255 * Math.min(1, v * 1.6));
    img.data[i + 1] = Math.round(255 * Math.max(0, v * 1.4 - 0.45));
    img.data[i + 2] = Math.round(255 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, v * 1.1))) * (v < 0.9 ? 1 : 0.8));
    img.data[i + 3] = 255;
  }
  const tmpC = document.createElement('canvas');
  tmpC.width = ACOUSTIC.frames;
  tmpC.height = ACOUSTIC.bands;
  tmpC.getContext('2d').putImageData(img, 0, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(tmpC, 0, 0, W, H);
}

export async function buildAcousticScene() {
  const root = new THREE.Group();
  const overlays = new THREE.Group();
  root.add(overlays);
  const glow = glowTexture();
  const sprite = (color, scale) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    sp.scale.setScalar(scale);
    sp.renderOrder = 9;
    overlays.add(sp);
    return sp;
  };

  /* ---------------- board on its stand ---------------- */
  const { model, assembly, cable } = await buildBoardOnStand();
  root.add(assembly);

  /* ---------------- sound source (illustration) ---------------- */
  const source = new THREE.Group();
  root.add(source);
  const body = std('#2b3140', 0.55), cone = std('#8c93b3', 0.4), grille = std('#1b2133', 0.7);
  const cab = box(source, 1.1, 1.5, 0.9, body, 0, 0.75, 0);
  cab.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 30), cone);
  ring.position.set(0, 0.85, 0.46);
  source.add(ring);
  const dome = new THREE.Mesh(new THREE.CircleGeometry(0.3, 28), grille);
  dome.position.set(0, 0.85, 0.452);
  source.add(dome);
  const tweeter = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), cone);
  tweeter.position.set(0, 1.3, 0.452);
  source.add(tweeter);
  // a plate above it with the name of the sound playing
  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = 512;
  plateCanvas.height = 128;
  const plateTex = new THREE.CanvasTexture(plateCanvas);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: plateTex, transparent: true }));
  plate.position.set(0, 2.1, 0);
  source.add(plate);
  let plateText = null;
  const drawPlate = (title, sub) => {
    const key = `${title}|${sub}`;
    if (key === plateText) return;
    plateText = key;
    const c = plateCanvas.getContext('2d');
    c.clearRect(0, 0, 512, 128);
    c.fillStyle = 'rgba(27,33,51,0.92)';
    c.beginPath();
    c.roundRect(4, 4, 504, 120, 20);
    c.fill();
    c.textAlign = 'center';
    c.fillStyle = '#f3d36b';
    c.font = '600 26px "Segoe UI", system-ui, sans-serif';
    c.fillText('SOUND SOURCE · SIMULATED', 256, 44);
    c.fillStyle = '#ffffff';
    c.font = '700 34px "Segoe UI", system-ui, sans-serif';
    c.fillText(title, 256, 92);
    if (sub) {
      c.fillStyle = '#b9c3de';
      c.font = '600 20px "Segoe UI", system-ui, sans-serif';
      c.fillText(sub, 256, 116);
    }
    plateTex.needsUpdate = true;
  };
  drawPlate('Silence', '');
  let dist = NEAR, distGoal = NEAR;
  const placeSource = () => {
    const p = FRONT.clone().addScaledVector(FACING, dist);
    source.position.set(p.x, 0, p.z);
    source.rotation.y = Math.atan2(-FACING.x, -FACING.z); // faces the board
  };
  placeSource();

  /* ---------------- sound waves ---------------- */
  // rings on the page around the source, growing toward the board; a sound sends a ring every 120 ms while it lasts
  const waveMat = () => new THREE.MeshBasicMaterial({ color: '#7ad3ff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const waves = Array.from({ length: 18 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), waveMat());
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.06;
    m.visible = false;
    overlays.add(m);
    return { m, t: -1, amp: 0, color: '#7ad3ff' };
  });
  let waveIdx = 0;
  const spawnWave = (amp, color) => {
    const w = waves[waveIdx++ % waves.length];
    w.t = 0;
    w.amp = amp;
    w.m.material.color.set(color);
    w.m.visible = true;
  };
  const playing = []; // { until, amp, color, next }

  /* ---------------- microphone, LEDs, routes ---------------- */
  const micGlow = sprite('#7ad3ff', 0.9);
  micGlow.position.copy(MIC);
  const ledMat = (part) => model.materials[part] || [];
  const LED_LOOK = { ledUser: ['#c8ffd2', '#2dff63'], ledTpu: ['#ffffff', '#f4f6ff'], ledStatus: ['#ffd9a8', '#ff8a1c'] };
  const ledGlow = { ledUser: sprite('#6dff8f', 0.75), ledTpu: sprite('#ffffff', 0.75), ledStatus: sprite('#ffa630', 0.75) };
  for (const k of Object.keys(ledGlow)) ledGlow[k].position.copy(boardToWorld([PART_MM[k][0], PART_MM[k][1], 1.6]));
  const setLed = (part, on) => {
    for (const m of ledMat(part)) {
      m.color.set(on ? LED_LOOK[part][0] : '#eef2ea');
      m.emissive.set(on ? LED_LOOK[part][1] : '#000000');
      m.emissiveIntensity = on ? (part === 'ledTpu' ? 1.6 : 2.4) : 0;
    }
  };
  const routeZ = 2.4;
  const mcuC = [PART_MM.mcu[0], PART_MM.mcu[1], routeZ], tpuC = [PART_MM.tpu[0], PART_MM.tpu[1], routeZ];
  const R = (pts) => new THREE.CatmullRomCurve3(pts.map(boardToWorld));
  const ROUTES = {
    micToMcu: R([[PART_MM.mic[0], PART_MM.mic[1], 1.4], [11.5, 12, routeZ], [9.5, -6, routeZ], [4.5, -14, routeZ], mcuC]),
    toTpu: R([mcuC, [-4.2, -6, routeZ], [-1.5, 4.5, routeZ], tpuC]),
    fromTpu: R([tpuC, [5.5, 4.0, routeZ], [3.2, -7, routeZ], mcuC]),
    toLed: R([mcuC, [1.5, -9, routeZ], [4.6, -3, routeZ], [PART_MM.ledUser[0], PART_MM.ledUser[1], 1.4]]),
  };
  const routeMat = new THREE.LineDashedMaterial({ color: '#7ad3ff', dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0, depthTest: false });
  for (const c of Object.values(ROUTES)) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(60)), routeMat);
    l.computeLineDistances();
    l.renderOrder = 10;
    overlays.add(l);
  }
  const pulses = Array.from({ length: 3 }, () => sprite('#7ad3ff', 0.5));
  const mcuGlow = sprite('#c58cff', 1.6);
  mcuGlow.position.copy(boardToWorld([PART_MM.mcu[0], PART_MM.mcu[1], 2.0]));
  const tpuGlow = sprite('#f4f6ff', 2.0);
  tpuGlow.position.copy(boardToWorld([PART_MM.tpu[0], PART_MM.tpu[1], 2.2]));

  /* ---------------- selection outline (same look as chapter 1) ---------------- */
  const outlineHolder = new THREE.Group();
  outlineHolder.matrixAutoUpdate = false;
  overlays.add(outlineHolder);
  const outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 1, depthTest: false, side: THREE.DoubleSide }));
  outline.renderOrder = 11;
  outlineHolder.add(outline);
  let selected = null;
  const selectPart = (part) => {
    selected = part;
    if (!part || !PART_MM[part]) {
      outline.visible = false;
      return;
    }
    const c = PART_MM[part], s = PART_SIZE_MM[part] || [3, 3], pad = part.startsWith('led') ? 1.4 : 1.0, z = 2.2;
    const w = s[0] / 2 + pad, h = s[1] / 2 + pad, t = part.startsWith('led') ? 0.55 : 0.8;
    const shape = new THREE.Shape([[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes.push(new THREE.Path([[-w + t, -h + t], [-w + t, h - t], [w - t, h - t], [w - t, -h + t]].map(([x, y]) => new THREE.Vector2(x, y))));
    outline.geometry.dispose();
    outline.geometry = new THREE.ShapeGeometry(shape);
    outlineHolder.matrix.makeBasis(RIGHT, UP, FACING).scale(V(S, S, S)).setPosition(boardToWorld([c[0], c[1], z]));
    outlineHolder.matrixWorldNeedsUpdate = true;
    outline.visible = true;
  };
  selectPart(null);

  /* ---------------- tappable parts ---------------- */
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hits = [];
  for (const [part, size] of [['mic', [6, 6, 5]], ['mcu', [14, 14, 4]], ['tpu', [15, 10, 4]], ['ledUser', [4, 4.5, 4]], ['ledTpu', [4, 3, 4]], ['ledStatus', [4, 3.2, 4]]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), hitMat);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(RIGHT, UP, FACING).scale(V(S, S, S)).setPosition(boardToWorld(PART_MM[part]));
    g.add(m);
    m.userData.hit = part;
    assembly.add(g);
    hits.push(m);
  }
  const srcHit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 1.4), hitMat);
  srcHit.position.y = 1.1;
  srcHit.userData.hit = 'source';
  source.add(srcHit);
  hits.push(srcHit);

  /* ---------------- the spectrogram panel ---------------- */
  const panel = new THREE.Group();
  panel.position.set(9.2, 0, 4.0);
  panel.rotation.y = -0.4;
  root.add(panel);
  const PW = 3.6, PH = PW * (ACOUSTIC.bands / ACOUSTIC.frames) + 0.9;
  const tilt = new THREE.Group();
  tilt.position.y = 0.25;
  tilt.rotation.x = -0.38;
  panel.add(tilt);
  box(tilt, PW + 0.36, PH + 0.9, 0.16, std('#1b2133', 0.5), 0, (PH + 0.9) / 2, -0.09).castShadow = true;
  const specCanvas = document.createElement('canvas');
  specCanvas.width = ACOUSTIC.frames * 4;
  specCanvas.height = ACOUSTIC.bands * 4 + 72;
  const specTex = new THREE.CanvasTexture(specCanvas);
  specTex.colorSpace = THREE.SRGBColorSpace;
  specTex.magFilter = THREE.NearestFilter;
  const spec = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: specTex }));
  spec.position.set(0, 0.2 + PH / 2, 0.005);
  tilt.add(spec);
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(PW, 0.62), new THREE.MeshBasicMaterial({ map: captionTexture([['SPECTROGRAM 96 × 64 · COMPUTED IN THE PAGE', 22, '#f3d36b', 56]], 512, 92) }));
  cap.position.set(0, PH + 0.6, 0.005);
  tilt.add(cap);
  const panelAnchor = new THREE.Object3D();
  panelAnchor.position.set(0, PH + 1.0, 0);
  tilt.add(panelAnchor);
  /** Draws a window's features (96 frames x 64 bands, log mel) and the best result under it. */
  const drawSpectrogram = (features, label, color = '#ffffff') => {
    const c = specCanvas.getContext('2d');
    const W = specCanvas.width, Hs = ACOUSTIC.bands * 4;
    c.fillStyle = '#0b1022';
    c.fillRect(0, 0, W, specCanvas.height);
    if (features) paintSpectrogram(c, features, W, Hs);
    c.fillStyle = '#1b2133';
    c.fillRect(0, Hs, W, specCanvas.height - Hs);
    c.textAlign = 'center';
    c.font = '700 30px "Segoe UI", system-ui, sans-serif';
    c.fillStyle = color;
    c.fillText(label, W / 2, Hs + 46);
    specTex.needsUpdate = true;
  };
  drawSpectrogram(null, 'No window analysed yet', '#b9c3de');

  centreAssembly(assembly, cable);

  /* ---------------- pop-in ---------------- */
  const pieces = [scalePiece(assembly, 0, 0.9, 1.2), scalePiece(source, 0.5, 0.8, 1.0), scalePiece(panel, 0.8, 0.8, 1.0)];
  const POP = 2.2;
  let popK = 0;
  const applyPop = (tp) => {
    root.visible = tp > 0;
    popK = clamp01((tp - 1.2) / 1.0);
    for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
    overlays.visible = popK > 0.01;
  };

  const srcAnchor = new THREE.Vector3();
  const panelWorld = new THREE.Vector3();
  let clock = 0;
  return {
    root,
    popDuration: POP,
    setPop: applyPop,
    hitMeshes: () => hits,
    selectPart,
    get selected() {
      return selected;
    },
    /** 1 (near) or 4 (far) metres in the simulation; the scene moves the source between two marks. */
    setDistance(m) {
      distGoal = m <= 1 ? NEAR : FAR;
    },
    /** The source starts a sound: waves for its duration (amp 0..1 sets their strength). */
    emit(label, ms, amp = 1, color = '#7ad3ff') {
      playing.push({ until: clock + ms / 1000, amp, color, next: clock });
      drawPlate(label, '');
    },
    setPlate: drawPlate,
    drawSpectrogram,
    anchors: {
      mic: MIC.clone(),
      mcu: boardToWorld([PART_MM.mcu[0], PART_MM.mcu[1], 2]),
      tpu: boardToWorld([PART_MM.tpu[0], PART_MM.tpu[1], 1.2]),
      ledUser: boardToWorld([PART_MM.ledUser[0], PART_MM.ledUser[1], 1]),
      ledTpu: boardToWorld([PART_MM.ledTpu[0], PART_MM.ledTpu[1], 1]),
      ledStatus: boardToWorld([PART_MM.ledStatus[0], PART_MM.ledStatus[1], 1]),
      source: srcAnchor,
      panel: panelWorld,
    },
    /**
     * Every frame. st: { statusLed, userLed, tpuLed, listening, stage ('features' | 'infer' | 'decide' | null),
     * build ('tpu' | 'cpu'), alert, showWaves, showRoute, background (0..1 level of the room noise) }
     */
    update(time, dt, st) {
      clock += dt;
      dist += (distGoal - dist) * (1 - Math.exp(-dt * 4));
      placeSource();
      srcAnchor.copy(source.position).add(V(0, 2.6, 0));
      panelAnchor.getWorldPosition(panelWorld);
      // waves
      const reach = dist + 0.6;
      for (let i = playing.length - 1; i >= 0; i--) {
        const p = playing[i];
        if (clock > p.until) {
          playing.splice(i, 1);
          continue;
        }
        if (clock >= p.next) {
          spawnWave(p.amp, p.color);
          p.next = clock + 0.12;
        }
      }
      for (const w of waves) {
        if (w.t < 0) continue;
        w.t += dt;
        const k = w.t / 0.7;
        if (k >= 1) {
          w.t = -1;
          w.m.visible = false;
          continue;
        }
        const r = 0.4 + k * reach;
        w.m.position.set(source.position.x, 0.06, source.position.z);
        w.m.scale.setScalar(r);
        w.m.material.opacity = (st.showWaves ? 0.85 : 0) * (1 - k) * Math.min(1, 0.35 + w.amp) * popK;
      }
      // LEDs
      setLed('ledStatus', !!st.statusLed);
      setLed('ledUser', !!st.userLed);
      setLed('ledTpu', !!st.tpuLed);
      ledGlow.ledStatus.material.opacity = (st.statusLed ? 0.85 : 0) * popK;
      ledGlow.ledUser.material.opacity = (st.userLed ? 0.95 : 0) * popK;
      ledGlow.ledTpu.material.opacity = (st.tpuLed ? 0.9 : 0) * popK;
      // microphone: lit while the board is listening
      micGlow.material.opacity = (st.listening ? 0.55 + 0.2 * Math.sin(time * 6) : 0.08) * popK;
      // the path of the window
      const on = st.showRoute ? popK : 0;
      routeMat.opacity = 0.75 * on;
      const flows = [];
      if (st.listening) flows.push({ route: 'micToMcu', k: (time * 0.9) % 1, color: '#7ad3ff' });
      if (st.stage === 'infer' && st.build === 'tpu') flows.push({ route: (time * 1.6) % 2 < 1 ? 'toTpu' : 'fromTpu', k: (time * 1.6) % 1, color: '#c58cff' });
      if (st.stage === 'decide') flows.push({ route: 'toLed', k: Math.min(1, (time * 1.4) % 1), color: st.alert ? '#6dff8f' : '#9aa0b4' });
      pulses.forEach((p, i) => {
        const f = flows[i];
        if (f && on) {
          p.position.copy(ROUTES[f.route].getPoint(f.k));
          p.material.color.set(f.color);
          p.material.opacity = 0.95 * popK;
        } else p.material.opacity = 0;
      });
      mcuGlow.material.opacity = (st.stage === 'features' || (st.stage === 'infer' && st.build === 'cpu') ? 0.5 + 0.35 * Math.sin(time * 18) : 0) * on;
      tpuGlow.material.opacity = (st.stage === 'infer' && st.build === 'tpu' ? 0.45 + 0.3 * Math.sin(time * 22) : 0) * on;
      if (selected) outline.material.opacity = (0.75 + 0.25 * Math.sin(time * 4)) * popK;
    },
  };
}
