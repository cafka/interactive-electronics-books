import * as THREE from 'three';
import {
  V, clamp01, BOARD, PI_CENTER, PI_Y, PCB_T, HEADER_H, holePos, railPos, pinPos, Polyline,
  buildPi, buildBoard, buildResistor, buildLed, buildJumper, buildBoardJumper,
} from './circuit.js';
import { buildButton, ParticleFlow, BTN_TRAVEL } from './circuit2.js';
import { scalePiece, wirePiece, boardWirePiece } from './popin.js';
import { glowTexture } from './textures.js';
import { PINS } from './traffic.js';

/*
 * Chapter 4 scene: three LED branches that read like a traffic light (red, yellow, green from left to right), each with
 * its own 330 ohm resistor, plus the four-leg push button of chapter 2. Everything comes from the shared parts:
 * buildPi, buildBoard, buildResistor, buildLed, buildJumper, buildBoardJumper, buildButton and ParticleFlow.
 *
 * Wiring (breadboard column / row; "a" is the row nearest the Pi):
 *   branch k:  Pi pin -> jumper -> column c0+5 (row a) -> 330 ohm (row c) -> column c0+1 -> LED anode (row e)
 *              LED cathode column c0 (row e) -> short jumper from row a to the GND rail ("-", nearest the Pi)
 *   GND rail   -> jumper -> Pi pin 6
 *   button     legs in columns 24 and 27 (rows e and f). Pi pin 16 -> column 24, row a. Pi pin 14 -> column 24, row i.
 */

const BH = BOARD.h;
const SURF = BH + 0.05;
const GND_RAIL_HOLE = 3; // rail hole where the Pi GND wire (pin 6) lands

const BRANCHES = [
  { id: 'red', c0: 2, rail: 0, wire: '#e03a3a', glow: '#ff3b2a', led: { color: '#ff2f2f', emissive: '#ff1a10', coreOff: '#4a0c0c' } },
  { id: 'yellow', c0: 9, rail: 7, wire: '#f0c020', glow: '#ffc21a', led: { color: '#ffcc22', emissive: '#ffb000', coreOff: '#4a3a08' } },
  { id: 'green', c0: 16, rail: 12, wire: '#2fae5a', glow: '#39ff7a', led: { color: '#35e06a', emissive: '#18c04a', coreOff: '#0c3a1a' } },
];

const lerpTo = (cur, target, dt, rate = 12) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
const surf = (h) => V(h.x, SURF, h.z);

export function buildTrafficCircuit() {
  const root = new THREE.Group();
  const pi = buildPi();
  const { group: board, strips } = buildBoard({
    strips: [...BRANCHES.flatMap((b) => [[b.c0, 'n'], [b.c0 + 1, 'n'], [b.c0 + 5, 'n']]), [24, 'n'], [27, 'n'], [24, 'f'], [27, 'f']],
    labelCols: [2, 7, 9, 14, 16, 21, 24, 27],
    rails: ['near-minus'],
  });
  const button = buildButton();
  const gndWire = buildJumper(PINS.gnd[0], railPos(GND_RAIL_HOLE), '#3b3b44', 0.35, 0.235);
  const btnWire = buildJumper(PINS.button.pin, holePos(24, 'a'), '#3f7be0', 0.4, 0.235);
  const btnGndWire = buildJumper(PINS.gnd[1], holePos(24, 'i'), '#7a5a40', 0.6, 0.235);
  root.add(pi, board, button.group, gndWire.root, btnWire.root, btnGndWire.root);

  const parts = BRANCHES.map((b) => {
    const resistor = buildResistor({ a: holePos(b.c0 + 1, 'c'), b: holePos(b.c0 + 5, 'c') });
    const led = buildLed({ cathode: holePos(b.c0, 'e'), anode: holePos(b.c0 + 1, 'e'), ...b.led });
    const wire = buildJumper(PINS[b.id].pin, holePos(b.c0 + 5, 'a'), b.wire, 0.35, 0.235);
    const railWire = buildBoardJumper(holePos(b.c0, 'a'), railPos(b.rail), '#3b3b44', 0.4);
    root.add(resistor.group, led.group, wire.root, railWire.root);
    const lx = (holePos(b.c0, 'e').x + holePos(b.c0 + 1, 'e').x) / 2;
    const ledTop = V(lx, BH + 0.75, holePos(b.c0, 'e').z);
    return { ...b, resistor, led, wire, railWire, lx, ledTop };
  });

  root.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow && o.material.opacity === 1 && o.material.visible !== false) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  /* ---- current paths: pin -> wire -> resistor -> LED -> rail jumper -> GND rail -> GND wire -> pin 6 ---- */
  const pin6 = pinPos(PINS.gnd[0]);
  const ledPath = (p) => {
    const pin = pinPos(PINS[p.id].pin);
    const pts = [];
    const push = (v) => pts.push(v.clone());
    push(V(pin.x, 0.78, pin.z));
    p.wire.curve.getPoints(60).forEach(push);
    const hInA = holePos(p.c0 + 5, 'a'), hInC = holePos(p.c0 + 5, 'c'), hAnC = holePos(p.c0 + 1, 'c');
    const hAnE = holePos(p.c0 + 1, 'e'), hCaE = holePos(p.c0, 'e'), hCaA = holePos(p.c0, 'a');
    push(surf(hInA));
    push(surf(hInC));
    push(V(hInC.x, BH + 0.2, hInC.z));
    push(V((hInC.x + hAnC.x) / 2, BH + 0.2, hInC.z));
    push(V(hAnC.x, BH + 0.2, hAnC.z));
    push(surf(hAnC));
    push(surf(hAnE));
    push(V(hAnE.x, BH + 0.45, hAnE.z));
    push(V(p.lx, BH + 0.85, hAnE.z));
    push(V(hCaE.x, BH + 0.45, hCaE.z));
    push(surf(hCaE));
    push(surf(hCaA));
    p.railWire.curve.getPoints(30).forEach(push);
    const r = railPos(p.rail), g = railPos(GND_RAIL_HOLE);
    push(V(r.x, SURF, r.z));
    push(V(g.x, SURF, g.z));
    gndWire.curve.getPoints(60).reverse().forEach(push); // back along the GND wire to pin 6
    push(V(pin6.x, 0.78, pin6.z));
    return new Polyline(pts);
  };
  const flows = parts.map((p) => new ParticleFlow(ledPath(p), { count: 120, size: 0.13, color: '#ffc65a', flowSpeed: 0.2 }));

  // pull-up current while the button is held: GPIO23 -> button -> GND (pin 14)
  const inPath = (() => {
    const pts = [];
    const push = (v) => pts.push(v.clone());
    const c = button.center;
    const pinB = pinPos(PINS.button.pin), pinG = pinPos(PINS.gnd[1]);
    const h24a = holePos(24, 'a'), h24e = holePos(24, 'e'), h24f = holePos(24, 'f'), h24i = holePos(24, 'i');
    push(V(pinB.x, 0.78, pinB.z));
    btnWire.curve.getPoints(60).forEach(push);
    push(surf(h24a));
    push(surf(h24e));
    push(V(h24e.x, BH + 0.14, h24e.z));
    push(V(c.x, BH + 0.14, h24e.z));
    push(V(c.x, BH + 0.14, c.z + 0.2));
    push(V(c.x, BH + 0.165, c.z));
    push(V(c.x, BH + 0.14, c.z - 0.2));
    push(V(c.x, BH + 0.14, h24f.z));
    push(V(h24f.x, BH + 0.14, h24f.z));
    push(surf(h24f));
    push(surf(h24i));
    btnGndWire.curve.getPoints(60).reverse().forEach(push);
    push(V(pinG.x, 0.78, pinG.z));
    return new Polyline(pts);
  })();
  const inFlow = new ParticleFlow(inPath, { count: 60, size: 0.1, color: '#6fe3ff', flowSpeed: 0.17 });
  root.add(...flows.map((f) => f.points), inFlow.points);

  /* ---- glows: one halo and one board decal per LED, one shared point light that follows the lit LED ---- */
  const glowTex = glowTexture();
  const sprite = (color, order = 9, depthTest = false) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, depthTest,
    }));
    s.renderOrder = order;
    root.add(s);
    return s;
  };
  const decalGeo = new THREE.PlaneGeometry(3, 3);
  parts.forEach((p) => {
    p.halo = sprite(p.glow, 0, true);
    p.halo.position.copy(p.ledTop);
    p.decal = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
      map: glowTex, color: p.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, toneMapped: false,
    }));
    p.decal.rotation.x = -Math.PI / 2;
    p.decal.position.set(p.lx, BH + 0.012, p.ledTop.z);
    p.decal.userData.noShadow = true;
    root.add(p.decal);
    p.coreOn = new THREE.Color(p.led.color).lerp(new THREE.Color('#ffffff'), 0.55);
    p.coreOffColor = new THREE.Color(p.led.coreOff);
    p.color = new THREE.Color(p.glow);
  });
  const ledLight = new THREE.PointLight('#ff3020', 0, 9, 2);
  ledLight.position.set(parts[0].lx, BH + 1.3, parts[0].ledTop.z + 0.2);
  root.add(ledLight);

  const pinGlow = {};
  for (const key of ['red', 'yellow', 'green', 'button']) {
    const pin = pinPos(PINS[key].pin);
    const s = sprite('#ffb23a');
    s.position.set(pin.x, 1.5, pin.z);
    s.scale.setScalar(0.75);
    pinGlow[key] = s;
  }
  const btnGlow = sprite('#6fe3ff');
  btnGlow.position.set(button.center.x, BH + 0.45, button.center.z);
  btnGlow.scale.setScalar(1.6);

  const ringGeo = new THREE.RingGeometry(0.2, 0.25, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = {};
  for (const key of ['red', 'yellow', 'green', 'button']) {
    const pin = pinPos(PINS[key].pin);
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: '#ffd27a', transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    m.position.set(pin.x, PI_Y + PCB_T + HEADER_H + 0.02, pin.z);
    m.renderOrder = 9;
    m.visible = false;
    root.add(m);
    rings[key] = { mesh: m, t: 99, color: '#ffd27a' };
  }

  /* ---- pop-in ---- */
  const pieces = [scalePiece(pi, 0.0, 0.9, 1.6), scalePiece(board, 0.2, 0.9, 1.6)];
  parts.forEach((p, k) => {
    pieces.push(scalePiece(p.resistor.group, 0.7 + k * 0.1, 0.6), scalePiece(p.led.group, 1.0 + k * 0.1, 0.6));
  });
  pieces.push(scalePiece(button.group, 1.3, 0.7));
  parts.forEach((p, k) => pieces.push(boardWirePiece(p.railWire, 1.5 + k * 0.1, 0.5)));
  pieces.push(wirePiece(gndWire, 1.8), ...parts.map((p, k) => wirePiece(p.wire, 1.95 + k * 0.15)), wirePiece(btnWire, 2.4), wirePiece(btnGndWire, 2.55));
  const POP_DURATION = 3.5;
  let popK = 0;

  const amber = new THREE.Color('#e0a53a'), blue = new THREE.Color('#4d7cff');
  const lv = { gnd: 0 };
  const BTN = button.center;
  const pinTop = (key) => V(pinPos(PINS[key].pin).x, 1.5, pinPos(PINS[key].pin).z);

  return {
    root,
    hit: button.hit,
    popDuration: POP_DURATION,
    anchors: {
      led: Object.fromEntries(parts.map((p) => [p.id, p.ledTop.clone()])),
      resistor: Object.fromEntries(parts.map((p) => [p.id, V((holePos(p.c0 + 1, 'c').x + holePos(p.c0 + 5, 'c').x) / 2, BH + 0.2, holePos(p.c0 + 5, 'c').z)])),
      pin: Object.fromEntries([...['red', 'yellow', 'green', 'button'].map((k) => [k, pinTop(k)]), ['gnd6', pinPos(PINS.gnd[0])], ['gnd14', pinPos(PINS.gnd[1])]]),
      pi: V(PI_CENTER.x + 3.4, PI_Y + 1.8, PI_CENTER.z + 1.95),
      board: V(5.5 + BOARD.w / 2 - 0.3, BH, -3.3 - BOARD.d / 2 + 0.4),
      button: V(BTN.x, BH + 0.78, BTN.z),
      rail: V(railPos(GND_RAIL_HOLE).x, BH + 0.1, railPos(GND_RAIL_HOLE).z),
      pedestrian: V(parts[1].lx, BH + 3.1, parts[1].ledTop.z),
    },

    setPop(tp) {
      root.visible = tp > 0;
      popK = clamp01((tp - 1.2) / 1.2);
      for (const p of pieces) p.apply(clamp01((tp - p.delay) / p.dur));
    },

    pulse(key, color = '#ffd27a') {
      const r = rings[key];
      if (r) {
        r.t = 0;
        r.color = color;
      }
    },

    /**
     * s: { levels: {red, yellow, green} 0..1 LED brightness, pins: {red, yellow, green, button} 0..1 smoothed pin level
     *      (button: 1 = HIGH = released), plunger 0..1, input 0..1 (pull-up current while pressed) }
     */
    update(time, dt, s, camera, viewportH) {
      const uScale = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));

      button.moving.position.y = -BTN_TRAVEL * s.plunger;
      button.capMat.emissiveIntensity = 0.45 * s.plunger;
      button.bridgeMat.emissiveIntensity = 0.5 * s.input;
      button.barA.color.copy(blue).lerp(amber, s.pins.button);
      button.barA.emissive.copy(button.barA.color);
      button.barA.emissiveIntensity = 0.25 + 0.5 * s.input;
      button.barB.emissiveIntensity = 0.25 + 0.5 * s.input;

      let max = 0, best = null;
      for (const p of parts) {
        const L = s.levels[p.id];
        if (L > max) {
          max = L;
          best = p;
        }
        p.led.shellMat.emissiveIntensity = 2.4 * L;
        p.led.shellMat.opacity = 0.78 + 0.2 * L;
        p.led.coreMat.color.copy(p.coreOffColor).lerp(p.coreOn, L);
        p.wire.wireMat.emissive.set(p.glow);
        p.wire.wireMat.emissiveIntensity = 0.9 * L;
        p.railWire.wireMat.emissive.set(p.glow);
        p.railWire.wireMat.emissiveIntensity = 0.7 * L;
        p.resistor.bodyMat.emissive.set('#ff7a00');
        p.resistor.bodyMat.emissiveIntensity = 0.22 * L;
        for (const col of [p.c0, p.c0 + 1, p.c0 + 5]) strips[col].opacity = 0.14 + 0.5 * L;
        p.halo.material.opacity = 0.95 * L;
        p.halo.scale.setScalar(2.2 + 0.5 * L + 0.05 * Math.sin(time * 9) * L);
        p.decal.material.opacity = 0.65 * L;
        pinGlow[p.id].material.opacity = 0.7 * s.pins[p.id] * popK;
      }
      lv.gnd = lerpTo(lv.gnd, max, dt);
      gndWire.wireMat.emissive.set('#ffb35a');
      gndWire.wireMat.emissiveIntensity = 0.7 * lv.gnd;
      strips['rail:near-minus'].opacity = 0.14 + 0.5 * lv.gnd;
      if (best) {
        ledLight.color.copy(best.color);
        ledLight.position.set(best.lx, BH + 1.3, best.ledTop.z + 0.2);
      }
      ledLight.intensity = 22 * max;

      // the button input: the pin is HIGH (pull-up) until the pressed contact joins it to GND
      pinGlow.button.material.opacity = 0.55 * s.pins.button * popK;
      btnGlow.material.opacity = 0.7 * (s.plunger > 0.5 ? 1 : 0) * popK;
      btnWire.wireMat.emissive.set('#6fe3ff');
      btnWire.wireMat.emissiveIntensity = 0.7 * s.input;
      btnGndWire.wireMat.emissive.set('#6fe3ff');
      btnGndWire.wireMat.emissiveIntensity = 0.7 * s.input;
      for (const [col, side] of [[24, 'n'], [27, 'n'], [24, 'f'], [27, 'f']]) strips[side === 'n' ? col : col + 'f'].opacity = 0.14 + 0.5 * s.input;

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

      parts.forEach((p, k) => flows[k].update(time, 0, 1, uScale, s.levels[p.id] > 0.03 ? s.levels[p.id] : 0));
      inFlow.update(time, 0, 1, uScale, s.input > 0.03 ? s.input : 0);
    },
  };
}
