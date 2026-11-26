import * as THREE from 'three';
import { buildBook } from './book.js';
import { BOOKS, DEFAULT_BOOK, getBook } from './books/index.js';
import { createShell } from './ui.js';
import { buildReader } from './pageContent.js';
import { measureLeftPage } from './textures.js';
import { buildGuideHtml, guideFileName, printGuide } from './guide.js';

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const PT = 0.9, CT = 0.18;
// the active book (see src/books/): its chapters, runtimes, label sets, page textures and build progress
let LESSONS = [];
let N = 0;

/* ------------------------------------------------------------------ renderer */
const canvas = $('#scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (err) {
  $('#loadError').hidden = false;
  $('#intro').hidden = true;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600);

/* ------------------------------------------------------------------ lights + environment + desk */
// A small procedural studio environment gives metal parts (USB shells, heat spreader) something to reflect.
function buildEnvironment() {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(40, 48, 24);
  const pos = geo.attributes.position, colors = [];
  const top = new THREE.Color('#e8eeff'), mid = new THREE.Color('#b4b9cc'), low = new THREE.Color('#1b1830'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 40;
    if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.7));
    else c.copy(mid).lerp(low, Math.min(1, -y * 1.6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w, h, x, y, z, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity * 0.96, intensity * 0.9), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  panel(26, 14, -18, 26, 16, 5); // key softbox
  panel(18, 10, 24, 12, -10, 2.2); // cool fill
  panel(40, 6, 0, 8, 30, 1.2); // front strip
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.03).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 0.45;

scene.add(new THREE.HemisphereLight('#c3d6ff', '#1d1836', 0.55));
const key = new THREE.DirectionalLight('#fff1d6', 2.6);
key.position.set(-9, 22, 13);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 5, far: 60 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
scene.add(key);
const fill = new THREE.DirectionalLight('#8fb0ff', 0.7);
fill.position.set(14, 10, -6);
scene.add(fill);

const desk = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.45 }));
desk.rotation.x = -Math.PI / 2;
desk.position.y = -PT - CT - 0.01;
desk.receiveShadow = true;
scene.add(desk);

/* ------------------------------------------------------------------ books and lessons */
// shared by every lesson's notebook. Labels start hidden: the reader sees the project first, and clicks a part
// (or "Show labels") to read names.
const options = { slow: true, labels: false };
const env = { options, userView };
const labelsRoot = $('#labels');
const bookStates = new Map(); // book id -> { def, runtimes, labelSets, texCache, pops } (each book is built on first use)
const coverCache = new Map();
let activeDef = null;
let runtimes = [];
let labelSets = [];
let texCache = []; // page textures are built the first time a spread is shown (the left pages are large canvases)
let pops = []; // seconds since each lesson's circuit started building
const pagesOf = (i) => (texCache[i] ??= LESSONS[i].textures());

async function ensureBook(def) {
  let st = bookStates.get(def.id);
  if (st) return st;
  const rts = [];
  for (const lesson of def.lessons) {
    const rt = await lesson.create(env);
    rt.root.visible = false;
    scene.add(rt.root);
    rts.push(rt);
  }
  const sets = rts.map((rt) =>
    rt.labels.map((d) => {
      const el = document.createElement('div');
      el.className = `label ${d.side} hidden ${d.cls || ''}`;
      el.innerHTML = `<i class="dot"></i><div class="tag"><b>${d.title}</b><span class="sub"></span></div>`;
      labelsRoot.appendChild(el);
      return { ...d, el, subEl: el.querySelector('.sub'), last: null };
    }),
  );
  st = { def, runtimes: rts, labelSets: sets, texCache: [], pops: rts.map(() => 0) };
  bookStates.set(def.id, st);
  return st;
}
function useBook(st) {
  activeDef = st.def;
  LESSONS = st.def.lessons;
  N = LESSONS.length;
  runtimes = st.runtimes;
  labelSets = st.labelSets;
  texCache = st.texCache;
  pops = st.pops;
}
/** Folds away the active book's scenes and labels (used when another book is chosen). */
function retireActiveBook() {
  runtimes.forEach((rt, i) => {
    rt.stop();
    pops[i] = 0;
    rt.setPop(0);
    rt.root.visible = false;
  });
  labelSets.flat().forEach((l) => l.el.classList.add('hidden'));
}

const params = new URLSearchParams(location.search);
const startDef = getBook(params.get('book')) || getBook(DEFAULT_BOOK);
useBook(await ensureBook(startDef));
let current = 0;
if (params.has('lesson')) current = clamp(Number(params.get('lesson')) - 1, 0, N - 1) | 0;

const book = buildBook(pagesOf(current));
scene.add(book.root);
function applyBookLook(def) {
  if (!coverCache.has(def.id)) coverCache.set(def.id, def.coverTexture());
  book.setCover(coverCache.get(def.id), def.coverColor);
  $('#introEyebrow').textContent = def.eyebrow;
  $('#scene').setAttribute('aria-label', def.canvasLabel);
  document.title = def.title;
}
applyBookLook(activeDef);
/* ------------------------------------------------------------------ camera rig */
const DEFAULT_FOV = 36;
const rig = {
  target: new THREE.Vector3(), goalTarget: new THREE.Vector3(),
  r: 60, goalR: 60, theta: 0.9, goalTheta: 0.9, phi: 0.5, goalPhi: 0.5, fov: DEFAULT_FOV, goalFov: DEFAULT_FOV,
};
const GLOBAL_VIEWS = {
  closed: { t: [5.6, 0, 0], r: 26, phi: 0.8, theta: 0.35 },
  book: { t: [0, 0, 0.5], r: 25, phi: 0.75, theta: 0, fit: 'book' },
};
const size = { w: 1, h: 1 };
let panelAmt = 0; // 0 notebook hidden .. 1 notebook fully shown (set every frame)
/*
 * Layouts (the same rules are in styles.css):
 *   wide (> 900 px): the notebook is a column on the right (420 px + 16 px margin);
 *   narrow and portrait or square (<= 900 px, width / height <= 4/3): the notebook is a sheet at the bottom;
 *   narrow and landscape (phones turned sideways): a slimmer column on the right, because a bottom sheet would
 *   leave the book a strip of 200 px.
 */
const isNarrow = () => size.w <= 900 && size.w / size.h <= 4 / 3; // bottom sheet layout
const isCompactSide = () => size.w <= 900 && !isNarrow();
const panelW = () => (isCompactSide() ? Math.min(360, size.w * 0.44) + 8 : 436);
const sheetH = () => size.h * 0.52;
let currentViewName = 'closed';

function viewDef(name) {
  return LESSONS[current].views[name] || GLOBAL_VIEWS[name] || LESSONS[current].views[LESSONS[current].defaultView];
}
/**
 * Camera distance multiplier so the view still fits when the free area is narrower than the reference
 * (1.75:1). On portrait screens the width of the whole canvas is what limits the view, because the
 * notebook sheet only covers the bottom of it.
 */
function fitFor(name) {
  const open = name !== 'closed';
  if (isNarrow()) return Math.max(1, (open ? 1.65 : 0.75) / (size.w / size.h));
  const aspect = open ? (size.w - panelW()) / size.h : size.w / size.h;
  return Math.max(1, 1.75 / aspect);
}
/*
 * Views with fit: 'book' (the shared "Whole book" view, and any chapter view that shows the whole project) get the
 * camera distance at which the open book and everything built on it just fill the free area: the window minus the
 * notebook, the camera bar and a small margin. It is recomputed on resize, so the book follows the window size.
 */
const fitCam = new THREE.PerspectiveCamera();
// runtime -> corners of the boxes of each top-level part of its built scene (measured once its pop-in has finished).
// Per-part boxes, not one box for the whole scene: a single box would add empty corners (a "tall part" at the front).
const contentBoxes = new Map();
const fitTmp = new THREE.Vector3();
const boxCorners = (b) => {
  const out = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
};
function measureContent(root) {
  root.updateMatrixWorld(true);
  const pts = [];
  const b = new THREE.Box3();
  for (const child of root.children) {
    if (!child.visible || child.isPoints || child.isSprite) continue; // particles and glows follow the parts
    b.setFromObject(child);
    if (!b.isEmpty() && Number.isFinite(b.min.x)) pts.push(...boxCorners(b));
  }
  return pts;
}
/** The free area for the book (screen px): the window minus the notebook, the top controls and a margin. */
function freeArea() {
  if (isNarrow()) return { l: 8, r: size.w - 8, t: 100, b: size.h - sheetH() - 8 };
  if (isCompactSide()) return { l: 8, r: size.w - panelW() - 8, t: 50, b: size.h - 8 };
  return { l: 16, r: size.w - panelW() - 16, t: 72, b: size.h - 24 };
}
/**
 * Camera target and distance at which the open book and everything built on it are as large as possible inside the
 * free area, and centred in it, horizontally and vertically: a binary search on the distance, then the target is
 * moved in the camera's plane until the projected content is centred, and the distance is searched again.
 */
function fitView(v) {
  const pts = boxCorners(new THREE.Box3(new THREE.Vector3(-11.25, -1.1, -7.25), new THREE.Vector3(11.25, 0.05, 7.25)));
  const cp = runtimes[current] && contentBoxes.get(runtimes[current]);
  if (cp) pts.push(...cp);
  else pts.push(new THREE.Vector3(10, 3.5, -6), new THREE.Vector3(2, 3.5, -6)); // until measured: room for tall parts
  const narrow = isNarrow();
  const ox = narrow ? 0 : panelW() / 2, oy = narrow ? sheetH() / 2 : 0; // the same view offset the frame loop applies
  const area = freeArea();
  fitCam.fov = DEFAULT_FOV;
  fitCam.aspect = size.w / size.h;
  fitCam.near = 0.1;
  fitCam.far = 600;
  fitCam.updateProjectionMatrix();
  const t = new THREE.Vector3(...v.t);
  const bounds = (r) => {
    fitCam.position.set(t.x + r * Math.sin(v.phi) * Math.sin(v.theta), t.y + r * Math.cos(v.phi), t.z + r * Math.sin(v.phi) * Math.cos(v.theta));
    fitCam.lookAt(t);
    fitCam.updateMatrixWorld();
    const b = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    for (const p of pts) {
      fitTmp.copy(p).project(fitCam);
      if (fitTmp.z >= 1) return null;
      const sx = (fitTmp.x * 0.5 + 0.5) * size.w - ox, sy = (-fitTmp.y * 0.5 + 0.5) * size.h - oy;
      b.l = Math.min(b.l, sx);
      b.r = Math.max(b.r, sx);
      b.t = Math.min(b.t, sy);
      b.b = Math.max(b.b, sy);
    }
    return b;
  };
  // fits if the content would fit the area once centred (its size, not its position, decides)
  const fits = (r) => {
    const b = bounds(r);
    return !!b && b.r - b.l <= area.r - area.l && b.b - b.t <= area.b - area.t;
  };
  const search = () => {
    let lo = 4, hi = 220;
    if (!fits(hi)) return hi;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let r = search();
  for (let k = 0; k < 6; k++) {
    const b = bounds(r);
    if (!b) break;
    const dx = (b.l + b.r) / 2 - (area.l + area.r) / 2, dy = (b.t + b.b) / 2 - (area.t + area.b) / 2;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
    const wpp = (2 * r * Math.tan(THREE.MathUtils.degToRad(fitCam.fov / 2))) / size.h; // world units per pixel at the target
    right.setFromMatrixColumn(fitCam.matrixWorld, 0);
    up.setFromMatrixColumn(fitCam.matrixWorld, 1);
    t.addScaledVector(right, dx * wpp).addScaledVector(up, -dy * wpp);
    r = search();
  }
  return { r, t };
}
function setView(name, instant = false) {
  const v = viewDef(name);
  currentViewName = name;
  const fit = fitFor(name);
  rig.goalTarget.set(...v.t);
  if (v.fit === 'book') {
    const f = fitView(v);
    rig.goalTarget.copy(f.t);
    rig.goalR = f.r;
  } else rig.goalR = v.r * fit;
  rig.goalPhi = v.phi;
  rig.goalTheta = v.theta;
  rig.goalFov = DEFAULT_FOV;
  if (instant) {
    rig.target.copy(rig.goalTarget);
    rig.r = rig.goalR;
    rig.phi = rig.goalPhi;
    rig.theta = rig.goalTheta;
    rig.fov = rig.goalFov;
  }
}
function updateRig(dt) {
  const k = 1 - Math.exp(-dt * 4.5);
  rig.target.lerp(rig.goalTarget, k);
  rig.r += (rig.goalR - rig.r) * k;
  rig.theta += (rig.goalTheta - rig.theta) * k;
  rig.phi += (rig.goalPhi - rig.phi) * k;
  rig.fov += (rig.goalFov - rig.fov) * k;
  // far away cameras (the front page view) need a larger near plane to keep depth precision for the thin page layers
  const near = clamp(rig.r * 0.12, 0.1, 30);
  if (Math.abs(camera.fov - rig.fov) > 1e-4 || Math.abs(camera.near - near) > 1e-3) {
    camera.fov = rig.fov;
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  camera.position.set(
    rig.target.x + rig.r * Math.sin(rig.phi) * Math.sin(rig.theta),
    rig.target.y + rig.r * Math.cos(rig.phi),
    rig.target.z + rig.r * Math.sin(rig.phi) * Math.cos(rig.theta),
  );
  camera.lookAt(rig.target);
}

let userTouched = false;
let autoGlide = 0;
/** The view every chapter opens with: the whole open book, centred and as large as the screen allows. */
const ENTRY_VIEW = 'book';
function userView(name) {
  if (name === 'leftpage') return enterLeftPage();
  if (leftView) exitLeftPage();
  // a named view is not a manual camera move: it is framed again when the window changes size
  userTouched = false;
  clearTimeout(autoGlide);
  setView(name);
}

/* ------------------------------------------------------------------ book state */
let bookP = 0;
let bookTarget = 0;
let turn = null; // { from, to, phase: 'retract' | 'flip', t, swapped }
let reading = false; // "Read page" mode: HTML view of the left page, simulation stopped
let expanded = false; // "Expand notebook": the notebook fills the screen; the chapter and its simulation keep going
let readFactor = 0; // 0 normal .. 1 reading (smoothed, drives the notebook slide and render pause)
let leftView = null; // "Left page" camera view (see below)
let leftFactor = 0; // 0 normal .. 1 left page view (smoothed)
let leftHide = 0; // 0 notebook shown .. 1 hidden while in the left page view (smoothed)
const bookIsOpen = () => bookTarget === 1 && bookP > 0.99;

const shell = createShell({
  onPrev: () => goTo(current - 1),
  onNext: () => goTo(current + 1),
  onCloseBook: closeBook,
});

function mountCurrent() {
  const lesson = LESSONS[current];
  shell.setLesson(lesson, current, N, activeDef);
  runtimes[current].mountUI(shell.tabs);
  buildCamBar();
  const body = $('#tabBody');
  body.classList.remove('swap');
  void body.offsetWidth;
  body.classList.add('swap');
  body.scrollTop = 0;
  $('#panel').scrollTop = 0; // narrow screens scroll the whole sheet
}

function openBook() {
  if (bookTarget === 1) return;
  bookTarget = 1;
  $('#intro').classList.add('gone');
  mountCurrent();
  setView(ENTRY_VIEW);
  userTouched = false;
}
function closeBook() {
  if (turn) return;
  if (expanded) setExpanded(false);
  if (leftView) exitLeftPage();
  releaseInput();
  runtimes[current].stop();
  bookTarget = 0;
  clearTimeout(autoGlide);
  $('#intro').classList.remove('gone');
  setView('closed');
}
$('#openBtn').addEventListener('click', openBook);

/* ------------------------------------------------------------------ library of books */
const libraryEl = $('#library');
const libraryBtn = $('#libraryBtn');
const libStatus = $('#libStatus');
let libraryOpen = false;
let choosing = false;

function syncChrome() {
  libraryBtn.hidden = libraryOpen || !!leftView || expanded;
  document.body.classList.toggle('in-library', libraryOpen);
}
for (const def of BOOKS) {
  const card = document.createElement('button');
  card.className = 'lib-card';
  card.dataset.book = def.id;
  card.setAttribute('aria-label', `${def.name}. ${def.blurb} ${def.lessons.length} ${def.lessons.length === 1 ? 'chapter' : 'chapters'}.`);
  const art = document.createElement('canvas');
  art.width = 440;
  art.height = 560;
  art.setAttribute('aria-hidden', 'true');
  const actx = art.getContext('2d');
  actx.scale(0.4, 0.4);
  def.paintCover(actx, 1100, 1400);
  card.appendChild(art);
  card.insertAdjacentHTML('beforeend', `<b>${def.name}</b><span>${def.blurb}</span><small>${def.lessons.length} ${def.lessons.length === 1 ? 'chapter' : 'chapters'}</small>`);
  card.addEventListener('click', () => chooseBook(def.id));
  $('#libCards').appendChild(card);
}

/** Back to the library: the chapter stops, the book closes and the choice is shown again. */
function showLibrary() {
  if (turn || libraryOpen) return;
  if (expanded) setExpanded(false);
  if (leftView) exitLeftPage();
  if (reading) exitReading();
  releaseInput();
  runtimes[current].stop();
  clearTimeout(autoGlide);
  bookTarget = 0;
  setView('closed');
  libraryOpen = true;
  libraryEl.hidden = false;
  libStatus.textContent = '';
  syncChrome();
  document.querySelector(`.lib-card[data-book="${activeDef.id}"]`)?.focus({ preventScroll: true });
}
async function chooseBook(id) {
  const def = getBook(id);
  if (!def || choosing) return;
  choosing = true;
  libStatus.textContent = `Loading ${def.name}…`;
  try {
    const st = await ensureBook(def);
    while (bookP > 0.02) await new Promise((r) => setTimeout(r, 40)); // let the open book finish closing before the cover changes
    if (def !== activeDef) {
      retireActiveBook();
      useBook(st);
      current = 0;
      book.setPages(pagesOf(0));
      applyBookLook(def);
      tagState = { next: '', prev: '' };
      shell.setBusy(false, current, N);
    }
    libraryOpen = false;
    libraryEl.hidden = true;
    libStatus.textContent = '';
    syncChrome();
    // straight to the open book: the reader does not have to open it or move the camera to start reading
    bookTarget = 0;
    openBook();
    $('#readBtn').focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    libStatus.textContent = `Could not load ${def.name}. ${err.message || ''}`;
  } finally {
    choosing = false;
  }
}
libraryBtn.addEventListener('click', showLibrary);

/** Turn to lesson i. Next / Previous buttons, the arrow keys, the page corners and the corner tags all end up here. */
function goTo(i) {
  if (turn || reading || expanded || !bookIsOpen() || i < 0 || i >= N || i === current) return;
  if (leftView) exitLeftPage();
  hoverZone = focusZone = null;
  releaseInput();
  runtimes[current].stop(); // stops the program and every electrical animation of the old lesson
  clearTimeout(autoGlide);
  turn = { from: current, to: i, phase: 'retract', t: 0, swapped: false };
  shell.setBusy(true, current, N);
}

window.addEventListener('keydown', (e) => {
  if (reading) {
    if (e.key === 'Escape') exitReading();
    return;
  }
  if (expanded) {
    if (e.key === 'Escape') setExpanded(false);
    return;
  }
  if (e.key === 'Escape' && leftView) {
    exitLeftPage();
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') goTo(current + 1);
  else if (e.key === 'ArrowLeft') goTo(current - 1);
});

/* ------------------------------------------------------------------ "Read page" mode (HTML) */
const readerEl = $('#reader');
const readerScroll = $('#readerScroll');
let savedView = null;

function enterReading() {
  if (reading || turn || !bookIsOpen()) return;
  if (expanded) setExpanded(false);
  if (leftView) exitLeftPage();
  hoverZone = focusZone = null;
  releaseInput();
  runtimes[current].stop('reading'); // leaves the simulation stopped and coherent; it is not restarted on return
  clearTimeout(autoGlide);
  savedView = {
    name: currentViewName, userTouched,
    t: rig.goalTarget.clone(), r: rig.goalR, phi: rig.goalPhi, theta: rig.goalTheta,
  };
  const lesson = LESSONS[current];
  readerScroll.replaceChildren(buildReader(lesson.pageContent));
  $('#readerTitle').textContent = `Lesson ${lesson.number} · ${lesson.title}`;
  reading = true;
  readerEl.hidden = false;
  document.body.classList.add('reading');
  readerScroll.scrollTop = 0;
  $('#readerBack').focus({ preventScroll: true });
}
function exitReading() {
  if (!reading) return;
  reading = false;
  readerEl.hidden = true;
  document.body.classList.remove('reading');
  if (savedView) {
    // same lesson, same camera as before
    currentViewName = savedView.name;
    rig.goalTarget.copy(savedView.t);
    rig.goalR = savedView.r;
    rig.goalPhi = savedView.phi;
    rig.goalTheta = savedView.theta;
    userTouched = savedView.userTouched;
    savedView = null;
  }
  $('#readBtn').focus({ preventScroll: true });
}
$('#readBtn').addEventListener('click', enterReading);
$('#readerBack').addEventListener('click', exitReading);

/* ------------------------------------------------------------------ "Expand notebook" mode */
// The notebook takes almost the whole screen, with larger text and the full width. Nothing is stopped or remounted:
// the same chapter, page, tab, scroll position and simulation are there when the reader returns to the book.
const expandBtn = $('#expandBtn');
function setExpanded(on) {
  if (expanded === on || (on && (turn || reading || !bookIsOpen()))) return;
  if (on && leftView) exitLeftPage();
  hoverZone = focusZone = null;
  hoverLabel = null;
  selectedLabel = null;
  releaseInput();
  expanded = on;
  document.body.classList.toggle('nb-expanded', on);
  expandBtn.setAttribute('aria-pressed', String(on));
  expandBtn.querySelector('span').textContent = on ? 'Return to book' : 'Expand notebook';
  expandBtn.title = on ? 'Back to the 3D book. The chapter and its simulation are as you left them.' : 'Show the notebook on the whole screen, with larger text. The chapter and its simulation keep their state.';
  syncChrome();
  expandBtn.focus({ preventScroll: true });
}
expandBtn.addEventListener('click', () => setExpanded(!expanded));

/* ------------------------------------------------------------------ "Download experiment guide" */
/** A picture of the 3D book in its current view, cropped to the area the book uses (no notebook). */
function bookSnapshot() {
  try {
    renderer.render(scene, camera);
    // crop to the book and its project (plus a margin), inside the area the book uses
    const a = freeArea(), cb = contentScreenBox(), m = 18;
    const x0 = clamp(cb.l - m, a.l, a.r), x1 = clamp(cb.r + m, a.l, a.r), y0 = clamp(cb.t - m, a.t, a.b), y1 = clamp(cb.b + m, a.t, a.b);
    const box = x1 - x0 > 80 && y1 - y0 > 60 ? { l: x0, t: y0, w: x1 - x0, h: y1 - y0 } : { l: a.l, t: a.t, w: a.r - a.l, h: a.b - a.t };
    const k = renderer.domElement.width / size.w;
    const c = document.createElement('canvas');
    c.width = Math.min(Math.round(box.w * k), 1600);
    c.height = Math.round((c.width * box.h) / box.w);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b2547'; // the canvas is transparent over the page background: paint that background
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(renderer.domElement, box.l * k, box.t * k, box.w * k, box.h * k, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}
/** On-screen box of what the whole-book view frames: the pages and every part built on them. */
function contentScreenBox() {
  const pts = boxCorners(new THREE.Box3(new THREE.Vector3(-11.25, -1.1, -7.25), new THREE.Vector3(11.25, 0.05, 7.25)));
  const cp = contentBoxes.get(runtimes[current]);
  if (cp) pts.push(...cp);
  const c = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
  const v = new THREE.Vector3();
  for (const p of pts) {
    v.copy(p).project(camera);
    if (v.z >= 1) continue;
    const x = (v.x * 0.5 + 0.5) * size.w, y = (-v.y * 0.5 + 0.5) * size.h;
    c.l = Math.min(c.l, x);
    c.r = Math.max(c.r, x);
    c.t = Math.min(c.t, y);
    c.b = Math.max(c.b, y);
  }
  return c;
}
function currentGuide() {
  const lesson = LESSONS[current];
  return { html: buildGuideHtml({ book: activeDef, lesson, tabs: shell.tabs, snapshot: bookSnapshot() }), fileName: guideFileName(activeDef, lesson) };
}
$('#guideBtn').addEventListener('click', async () => {
  const btn = $('#guideBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const g = currentGuide();
    await printGuide(g.html, g.fileName);
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ "Left page" camera view (the 3D page, seen straight on) */
// The camera looks straight down at the left page of the 3D book with a narrow field of view (a "dolly zoom"
// away from the page), so the page appears flat and undistorted, text upright, top of the page at the top.
const LEFT_FOV = 10;
const LEFT_CENTER = [-5.5, 0, 0];
const leftBar = $('#leftBar');
const leftNotebookBtn = $('#leftNotebook');

function leftFraming() {
  const hidden = leftView.notebookHidden;
  const freeW = size.w - (!isNarrow() && !hidden ? panelW() : 0);
  const freeH = size.h - (isNarrow() && !hidden ? sheetH() : 0) - 64; // 64 px reserved for the toolbar
  const tan = Math.tan(THREE.MathUtils.degToRad(LEFT_FOV / 2));
  // visible world height of the whole canvas such that the 11 x 14 page fits the free area with a small margin
  const visH = Math.max((14 * 1.04 * size.h) / freeH, (11 * 1.04 * size.h) / freeW);
  return visH / (2 * tan);
}
function applyLeftFraming() {
  if (!leftView) return;
  rig.goalTarget.set(LEFT_CENTER[0] + leftView.panX, 0, LEFT_CENTER[2] + leftView.panZ);
  rig.goalPhi = 0.002; // straight down (not exactly 0, to keep the camera's up direction well defined)
  rig.goalTheta = 0;
  rig.goalFov = LEFT_FOV;
  rig.goalR = leftFraming() * leftView.zoom;
}
function updateLeftBar() {
  leftNotebookBtn.textContent = leftView && leftView.notebookHidden ? 'Show notebook' : 'Hide notebook';
}
function enterLeftPage() {
  if (leftView || reading || turn || !bookIsOpen()) return;
  if (expanded) setExpanded(false);
  hoverZone = focusZone = null;
  releaseInput();
  clearTimeout(autoGlide);
  leftView = {
    saved: {
      name: currentViewName, userTouched,
      t: rig.goalTarget.clone(), r: rig.goalR, phi: rig.goalPhi, theta: rig.goalTheta, fov: rig.goalFov,
    },
    notebookHidden: true, panX: 0, panZ: 0, zoom: 1,
  };
  userTouched = true;
  leftBar.hidden = false;
  syncChrome();
  updateLeftBar();
  applyLeftFraming();
  $('#leftBack').focus({ preventScroll: true });
}
function exitLeftPage() {
  if (!leftView) return;
  const s = leftView.saved;
  leftView = null;
  leftBar.hidden = true;
  syncChrome();
  currentViewName = s.name;
  rig.goalTarget.copy(s.t);
  rig.goalR = s.r;
  rig.goalPhi = s.phi;
  rig.goalTheta = s.theta;
  rig.goalFov = s.fov;
  userTouched = s.userTouched;
  $('#leftPageBtn').focus({ preventScroll: true });
}
$('#leftPageBtn').addEventListener('click', enterLeftPage);
$('#leftBack').addEventListener('click', exitLeftPage);
// zoom buttons (same range as the mouse wheel): small diagram labels become readable at 2x to 3x
const zoomLeft = (k) => {
  if (!leftView) return;
  leftView.zoom = clamp(leftView.zoom * k, 0.3, 1.2);
  applyLeftFraming();
};
$('#leftZoomIn').addEventListener('click', () => zoomLeft(0.75));
$('#leftZoomOut').addEventListener('click', () => zoomLeft(1 / 0.75));
leftNotebookBtn.addEventListener('click', () => {
  if (!leftView) return;
  leftView.notebookHidden = !leftView.notebookHidden;
  updateLeftBar();
  applyLeftFraming();
});

/* ------------------------------------------------------------------ camera bar: the chapter's views + play / pause */
// Always reachable above the 3D view. It slides away while the user scrolls (wheel zoom or the notebook) and comes
// back on the next pointer move, tap, key press or focus. Play / pause shows only if the chapter runtime offers
// isRunning() / setRunning(on).
const camBar = $('#camBar');
const camViews = $('#camViews');
const camPlay = $('#camPlay');
const leftMask = $('#leftMask');
let camAway = false;
let lastScrollAt = -1e9;
let camState = { view: '', play: '' };
function buildCamBar() {
  camViews.replaceChildren(...LESSONS[current].viewButtons.map(([v, t]) => {
    const b = document.createElement('button');
    b.className = 'cam-btn';
    b.dataset.view = v;
    b.textContent = t;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => userView(v));
    return b;
  }));
  camState = { view: '', play: '' };
}
const camLabels = $('#camLabels');
camLabels.addEventListener('click', () => {
  options.labels = !options.labels;
  selectedLabel = null;
});
camPlay.addEventListener('click', () => {
  const rt = runtimes[current];
  if (!turn && rt.setRunning) rt.setRunning(!rt.isRunning());
});
const hideCamBar = () => {
  lastScrollAt = performance.now();
  if (!camAway) {
    camAway = true;
    camBar.classList.add('away');
  }
};
const showCamBar = (force) => {
  if (camAway && (force === true || performance.now() - lastScrollAt > 600)) {
    camAway = false;
    camBar.classList.remove('away');
  }
};
canvas.addEventListener('wheel', hideCamBar, { passive: true });
$('#tabBody').addEventListener('scroll', hideCamBar, { passive: true });
$('#panel').addEventListener('scroll', hideCamBar, { passive: true });
for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(ev, showCamBar, { passive: true });
camBar.addEventListener('focusin', () => showCamBar(true));

/** Per frame: visibility, position next to the notebook, play label, highlighted view, left page mask. */
function updateCamBar(amt) {
  const show = bookIsOpen() && !reading && !leftView && !turn && !libraryOpen && !expanded;
  if (camBar.hidden === show) camBar.hidden = !show;
  if (camLabels.hidden === show) camLabels.hidden = !show;
  const lm = labelMode(); // kept up to date even while the bar is hidden (page turn, reading)
  if (camState.labels !== lm) {
    camState.labels = lm;
    camLabels.textContent = LABEL_MODE_TEXT[lm];
    camLabels.setAttribute('aria-pressed', String(lm === 'auto'));
    camLabels.title = lm === 'auto' ? 'Hide the names of the parts. You can still click a part to see its name.' : 'Show the names of all the parts. You can also click a single part to see its name.';
    // the notebook's own "Show labels" checkbox (every chapter has one) says the same thing
    for (const box of document.querySelectorAll('#panel input#optLabels')) box.checked = options.labels;
  }
  if (show) {
    camBar.style.right = isNarrow() ? '0px' : `${(panelW() * amt).toFixed(1)}px`;
    const rt = runtimes[current];
    const playing = !!rt.setRunning && rt.isRunning();
    const key = rt.setRunning ? (playing ? 'on' : 'off') : 'none';
    if (camState.play !== key) {
      camState.play = key;
      camPlay.hidden = key === 'none';
      camPlay.textContent = playing ? '❚❚ Pause' : '▶ Play';
      camPlay.setAttribute('aria-pressed', String(playing));
      camPlay.setAttribute('aria-label', playing ? 'Pause the simulation' : 'Play the simulation');
    }
    if (camState.view !== currentViewName) {
      camState.view = currentViewName;
      for (const b of camViews.children) b.setAttribute('aria-pressed', String(b.dataset.view === currentViewName));
    }
  }
  // left page view: cover everything but the left page (x -11..0, z -7..7), so a wide screen does not show the right page
  const mask = !!leftView && leftFactor > 0.6;
  if (leftMask.hidden === mask) leftMask.hidden = !mask;
  if (mask) {
    const a = new THREE.Vector3(-11, 0, -7).project(camera), b = new THREE.Vector3(0, 0, 7).project(camera);
    const x1 = (a.x * 0.5 + 0.5) * size.w, y1 = (-a.y * 0.5 + 0.5) * size.h, x2 = (b.x * 0.5 + 0.5) * size.w, y2 = (-b.y * 0.5 + 0.5) * size.h;
    Object.assign(leftMask.style, {
      left: `${Math.min(x1, x2).toFixed(1)}px`, top: `${Math.min(y1, y2).toFixed(1)}px`,
      width: `${Math.abs(x2 - x1).toFixed(1)}px`, height: `${Math.abs(y2 - y1).toFixed(1)}px`,
    });
  }
}

/* ------------------------------------------------------------------ pointer input: orbit, zoom, 3D controls, page corners */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pagePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02);
const hit = new THREE.Vector3();
const corner = new THREE.Vector3();
let drag = null;
let pressPointer = null;
let pressAt = null; // where and when a press on an interactive 3D part started
let hoverZone = null; // 'next' | 'prev' | null: page-turn zone under the mouse
let focusZone = null; // same, for keyboard focus on a corner tag
const pressSource = () => `mouse:${pressPointer}`;

function setRay(e) {
  ndc.set((e.clientX / size.w) * 2 - 1, -(e.clientY / size.h) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
function pickAt(e) {
  setRay(e);
  return !turn && !reading && !leftView && bookIsOpen() && runtimes[current].pick(raycaster);
}
function releaseInput() {
  runtimes[current].releaseAll();
  pressPointer = null;
  canvas.classList.remove('pressing');
}

/** Screen position of a bottom page corner (x = +11 right page, -11 left page). */
function cornerPx(x) {
  corner.set(x, 0, 7).project(camera);
  return [(corner.x * 0.5 + 0.5) * size.w, (-corner.y * 0.5 + 0.5) * size.h];
}
const canTurnNow = () => !turn && !reading && !leftView && !expanded && bookIsOpen();

/**
 * Page-turn zones: a generous disc around each bottom corner (screen space, so it is easy to hit) plus the outer
 * edge of the page. A direction exists only if there is a next / previous lesson. 3D controls are tested first.
 */
/** True if a pointer is on the disc around a bottom page corner that can turn the page. */
function nearPageCorner(e) {
  const radius = e.pointerType === 'mouse' ? 92 : 112;
  const near = (x) => {
    const [cx, cy] = cornerPx(x);
    return Math.hypot(e.clientX - cx, e.clientY - cy) < radius;
  };
  return (current < N - 1 && near(11)) || (current > 0 && near(-11));
}
function pageZoneAt(e) {
  if (!canTurnNow()) return null;
  const canNext = current < N - 1, canPrev = current > 0;
  const radius = e.pointerType === 'mouse' ? 92 : 112;
  const near = (x) => {
    const [cx, cy] = cornerPx(x);
    return Math.hypot(e.clientX - cx, e.clientY - cy) < radius;
  };
  if (canNext && near(11)) return 'next';
  if (canPrev && near(-11)) return 'prev';
  setRay(e);
  if (raycaster.ray.intersectPlane(pagePlane, hit) && Math.abs(hit.z) <= 7.4) {
    if (canNext && hit.x >= 9.6 && hit.x <= 11.8) return 'next';
    if (canPrev && hit.x <= -9 && hit.x >= -11.8) return 'prev';
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  if (pressPointer === null && pickAt(e)) {
    pressPointer = e.pointerId;
    pressAt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    runtimes[current].pressStart(pressSource());
    canvas.classList.add('pressing');
    return;
  }
  // a press on a page edge becomes a page turn only if it ends as a short click; dragging still moves the camera
  // times come from the events themselves: on a slow device a long frame between press and release must not turn a
  // quick click into a long press
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, zone: pageZoneAt(e), t0: e.timeStamp };
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === pressPointer) {
    // a chapter may let the pointer drag a 3D control (the door of the ESP32 chapter)
    if (runtimes[current].pressMove) {
      setRay(e);
      runtimes[current].pressMove(raycaster, camera);
    }
    return;
  }
  if (!drag || drag.id !== e.pointerId) {
    if (e.pointerType === 'mouse' && !drag) {
      const picked = pickAt(e);
      const part = nearestLabel(e.clientX, e.clientY, 22);
      hoverZone = picked || (part && !nearPageCorner(e)) ? null : pageZoneAt(e);
      hoverLabel = hoverZone ? null : part;
      canvas.classList.toggle('pick', picked);
      canvas.classList.toggle('turn', !!hoverZone);
      canvas.classList.toggle('info', !picked && !hoverZone && !!hoverLabel);
    }
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved > 6) {
    drag.zone = null; // it is a camera drag, not a page click
    hoverZone = null;
  }
  if (drag.moved > 4) {
    userTouched = true;
    clearTimeout(autoGlide);
  }
  if (leftView) {
    // in the front view the camera does not rotate: dragging pans the page (useful once zoomed in)
    const perPx = (2 * rig.goalR * Math.tan(THREE.MathUtils.degToRad(rig.goalFov / 2))) / size.h;
    leftView.panX = clamp(leftView.panX - dx * perPx, -5.5, 5.5);
    leftView.panZ = clamp(leftView.panZ - dy * perPx, -7, 7);
    applyLeftFraming();
    return;
  }
  rig.goalTheta -= dx * 0.006;
  rig.goalPhi = clamp(rig.goalPhi - dy * 0.006, 0.12, 1.45);
});
const endPointer = (e) => {
  if (e.type !== 'lostpointercapture') lastRelease = { type: e.type, press: e.pointerId === pressPointer, drag: !!drag && drag.id === e.pointerId, dt: Math.round(e.timeStamp - (pressAt?.t ?? drag?.t0 ?? e.timeStamp)), moved: drag ? drag.moved : pressAt ? Math.round(Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y)) : null };
  if (e.pointerId === pressPointer) {
    // released anywhere (inside or outside the button), cancelled, or capture lost: the button comes up
    runtimes[current].pressEnd(pressSource());
    pressPointer = null;
    canvas.classList.remove('pressing');
    // a short click on an interactive part (not a drag of it) also shows that part's label, like any other part
    if (e.type === 'pointerup' && pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < 8 && e.timeStamp - pressAt.t < 800) {
      clickLabelAt(e.clientX, e.clientY, e.pointerType);
    }
    pressAt = null;
    return;
  }
  if (drag && drag.id === e.pointerId) {
    const click = e.type === 'pointerup' && drag.moved < 6 && e.timeStamp - drag.t0 < 800;
    const zone = drag.zone;
    if (drag.moved < 5 && bookTarget === 0) openBook();
    drag = null;
    canvas.classList.remove('dragging');
    // a part on the edge of the page wins over the page-turn strip (its label is what the reader asked for);
    // the curled corners always turn the page
    const partHere = click && zone && !nearPageCorner(e) && nearestLabel(e.clientX, e.clientY, e.pointerType === 'mouse' ? 30 : 44);
    if (click && zone && !partHere) {
      hoverZone = null;
      canvas.classList.remove('turn');
      goTo(zone === 'next' ? current + 1 : current - 1);
    } else if (click && bookIsOpen()) {
      // a click on a part shows its label (a second click, or a click elsewhere, hides it again)
      clickLabelAt(e.clientX, e.clientY, e.pointerType);
    }
  }
};
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, endPointer);
canvas.addEventListener('pointerleave', () => {
  if (drag) return;
  hoverZone = null;
  hoverLabel = null;
  canvas.classList.remove('turn', 'pick', 'info');
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  userTouched = true;
  clearTimeout(autoGlide);
  if (leftView) {
    leftView.zoom = clamp(leftView.zoom * Math.exp(e.deltaY * 0.001), 0.3, 1.2);
    applyLeftFraming();
    return;
  }
  rig.goalR = clamp(rig.goalR * Math.exp(e.deltaY * 0.001), 3.5, 48);
}, { passive: false });
canvas.addEventListener('dblclick', () => {
  if (leftView) {
    Object.assign(leftView, { panX: 0, panZ: 0, zoom: 1 });
    applyLeftFraming();
  } else if (bookTarget) {
    userTouched = false;
    setView(ENTRY_VIEW);
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// safety nets: never leave the button pressed
window.addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => document.hidden && releaseInput());
window.addEventListener('pointerup', (e) => e.pointerId === pressPointer && endPointer(e));

/* ------------------------------------------------------------------ page corner tags ("Next" / "Previous") */
// Real buttons: keyboard focusable, large click target, same goTo() as the notebook buttons.
const tags = { next: $('#cornerNext'), prev: $('#cornerPrev') };
for (const [zone, el] of Object.entries(tags)) {
  el.addEventListener('click', () => goTo(zone === 'next' ? current + 1 : current - 1));
  el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && (hoverZone = zone));
  el.addEventListener('pointerleave', () => hoverZone === zone && (hoverZone = null));
  el.addEventListener('focus', () => (focusZone = zone));
  el.addEventListener('blur', () => focusZone === zone && (focusZone = null));
}
let tagState = { next: '', prev: '' };
function updateTags(panelPx, sheetPx) {
  for (const zone of ['next', 'prev']) {
    const el = tags[zone];
    const exists = zone === 'next' ? current < N - 1 : current > 0;
    const visible = exists && canTurnNow();
    const key = visible ? `${current}` : '';
    if (tagState[zone] !== key) {
      tagState[zone] = key;
      el.hidden = !visible;
      if (visible) {
        const target = LESSONS[current + (zone === 'next' ? 1 : -1)];
        el.setAttribute('aria-label', zone === 'next' ? `Next page: Lesson ${target.number}, ${target.title}` : `Previous page: Lesson ${target.number}, ${target.title}`);
      }
    }
    if (!visible) continue;
    const [cx, cy] = cornerPx(zone === 'next' ? 11 : -11);
    // the tag sits just below the corner (on the desk), so the curled corner itself stays fully visible;
    // it is kept on screen and clear of the notebook even when the page corner is out of view
    const x = zone === 'next' ? clamp(cx + 26, 96, size.w - panelPx - 12) : clamp(cx - 26, 12, size.w - 96);
    const y = clamp(cy + 34, 10, size.h - sheetPx - 52);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${zone === 'next' ? '-100%' : '0'}, 0)`;  }
}

/* ------------------------------------------------------------------ labels (one set per lesson, built with the book) */
/*
 * Floating labels (the DOM tags; the printed text on the 3D models is part of their textures and is not touched).
 * Shared by every chapter:
 *   - hidden (the default, "Show labels"): no tag and no dot. A click or tap on a part shows that part's label only;
 *     a click on another part moves it there, a click on empty space hides it. With a mouse, hovering also shows it.
 *   - shown ("Hide labels"): as many labels as fit without overlapping each other, the notebook, the camera bar or
 *     the anchor points of other parts; the rest shrink to their dot.
 * Priority: the order of the chapter's label list; labels marked hideNarrow come last.
 */
const proj = new THREE.Vector3();
const LABEL_MODE_TEXT = { auto: 'Hide labels', off: 'Show labels' };
let selectedLabel = null;
let hoverLabel = null;
let lastLabelClick = null;
let lastRelease = null;
const labelMode = () => (options.labels ? 'auto' : 'off');
const labelsLive = (i) => i === current && !turn && !leftView && !expanded && bookP > 0.99 && pops[i] >= runtimes[i].popDuration - 0.05;
/** A click or tap at a screen point: show the label of the part there, or hide the current one. */
function clickLabelAt(x, y, pointerType) {
  const l = nearestLabel(x, y, pointerType === 'mouse' ? 30 : 44);
  lastLabelClick = { x, y, found: l?.title ?? null, before: selectedLabel?.title ?? null, same: l === selectedLabel };
  selectedLabel = l && l !== selectedLabel ? l : null;
}
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** The label whose anchor is nearest to a screen point (within maxPx), or null. */
function nearestLabel(x, y, maxPx) {
  if (!labelsLive(current)) return null;
  let best = null, bd = maxPx;
  for (const l of labelSets[current]) {
    if (l.sx == null) continue;
    const d = Math.hypot(l.sx - x, l.sy - y);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}
function placeLabel(l, side, collapsed, selected) {
  l.el.classList.remove('hidden');
  l.el.classList.toggle('left', side === 'left');
  l.el.classList.toggle('collapsed', collapsed);
  l.el.classList.toggle('selected', selected);
  l.el.style.zIndex = selected ? '3' : collapsed ? '1' : '2';
  const shift = side === 'left' ? 'translate(calc(-100% + 4.5px), -50%)' : 'translate(-4.5px, -50%)';
  l.el.style.transform = `translate(${l.sx.toFixed(1)}px, ${l.sy.toFixed(1)}px) ${shift}`;
}
function updateLabels() {
  labelSets.forEach((set, i) => {
    if (!labelsLive(i)) {
      for (const l of set) {
        l.el.classList.add('hidden');
        l.sx = null;
      }
      return;
    }
    if (selectedLabel && !set.includes(selectedLabel)) selectedLabel = null;
    if (hoverLabel && !set.includes(hoverLabel)) hoverLabel = null;
    const mode = labelMode();
    const vis = [];
    for (const l of set) {
      proj.copy(l.at).project(camera);
      if (proj.z >= 1 || Math.abs(proj.x) > 1.02 || Math.abs(proj.y) > 1.02) {
        l.el.classList.add('hidden');
        l.sx = null;
        continue;
      }
      l.sx = (proj.x * 0.5 + 0.5) * size.w;
      l.sy = (-proj.y * 0.5 + 0.5) * size.h;
      const sub = typeof l.sub === 'function' ? l.sub() : l.sub;
      if (sub !== l.last) {
        l.subEl.innerHTML = sub;
        if (!l.last || sub.length !== l.last.length) l.w = 0; // remeasure only when the text length changes
        l.last = sub;
      }
      vis.push(l);
    }
    // areas a label must not cover: the notebook, the camera bar, and the anchor points of the other parts
    const blocked = [];
    const tops = [];
    if (!camBar.hidden && !camBar.classList.contains('away')) tops.push(camViews, camPlay);
    if (!camLabels.hidden) tops.push(camLabels, libraryBtn);
    for (const el of tops) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      blocked.push({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
    }
    const nb = isNarrow() ? { x: 0, y: size.h - sheetH() * panelAmt, w: size.w, h: size.h } : { x: size.w - (panelW() + 20) * panelAmt, y: 0, w: size.w, h: size.h };
    if (panelAmt > 0.05) blocked.push(nb);
    const dots = vis.map((l) => ({ l, r: { x: l.sx - 8, y: l.sy - 8, w: 16, h: 16 } }));
    const rank = (l) => (l === selectedLabel ? -2 : l === hoverLabel ? -1 : l.hideNarrow ? 1 : 0);
    const order = vis.map((l, k) => [l, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((a) => a[0]);
    const placed = [];
    for (const l of order) {
      const pinned = l === selectedLabel || l === hoverLabel;
      if (mode === 'off' && !pinned) {
        l.el.classList.add('hidden');
        continue;
      }
      if (!l.w) {
        // measure with the tag laid out (a collapsed tag keeps its size, it is only invisible)
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
      let side = l.side, ok = pinned;
      if (mode === 'auto' && !pinned && !(l.hideNarrow && isNarrow())) {
        for (const s of [l.side, l.side === 'left' ? 'right' : 'left']) {
          const x = s === 'left' ? l.sx - l.w + 4.5 : l.sx - 4.5;
          const r = { x, y: l.sy - l.h / 2, w: l.w, h: l.h };
          const inside = r.x >= 4 && r.y >= 4 && r.x + r.w <= size.w - 4 && r.y + r.h <= size.h - 4;
          if (inside && !placed.some((p) => overlaps(p, r)) && !blocked.some((p) => overlaps(p, r)) && !dots.some((d) => d.l !== l && overlaps(d.r, r))) {
            side = s;
            ok = true;
            placed.push(r);
            break;
          }
        }
      } else if (pinned) {
        const x = side === 'left' ? l.sx - l.w + 4.5 : l.sx - 4.5;
        placed.push({ x, y: l.sy - l.h / 2, w: l.w, h: l.h });
      }
      placeLabel(l, side, !ok, l === selectedLabel);
    }
  });
}

/* ------------------------------------------------------------------ resize */
function resize() {
  size.w = window.innerWidth;
  size.h = window.innerHeight;
  renderer.setSize(size.w, size.h, false);
  camera.aspect = size.w / size.h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  resize();
  if (leftView) applyLeftFraming();
  else if (!userTouched) setView(currentViewName);
});
resize();

/* ------------------------------------------------------------------ debug / test shortcuts (see README) */
const opened = params.has('open');
setView(opened ? params.get('view') || ENTRY_VIEW : 'closed', opened);
if (!opened) {
  rig.r = 55; // fly-in on first load
  rig.theta = 1.0;
} else {
  bookTarget = 1;
  bookP = 1;
  pops[current] = runtimes[current].popDuration + 0.4;
  $('#intro').classList.add('gone');
  userTouched = false;
  mountCurrent();
  if (params.get('led') === 'on') runtimes[current].debugOn();
  if (params.get('press') === '1') runtimes[current].pressStart('debug');
  if (params.get('run') === '1') runtimes[current].runFromQuery('run');
  if (params.get('left') === '1') enterLeftPage();
}
shell.setBusy(false, current, N);
libraryOpen = !opened && !params.has('book');
libraryEl.hidden = !libraryOpen;
syncChrome();
// a link to a book (?book=...) goes straight to its open book, like choosing it in the library
if (!opened && params.has('book')) openBook();

/* ------------------------------------------------------------------ main loop */
const FLIP_SECONDS = 1.6;
let lastCoveredRender = -1e9;
let last = performance.now();
let time = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  bookP = clamp(bookP + (bookTarget ? 1 : -1) * (dt / 2.6), 0, 1);
  book.setProgress(bookP);
  const idle = 1 - smoothstep(0, 0.15, bookP);
  book.root.rotation.y = Math.sin(time * 0.45) * 0.05 * idle;
  book.root.position.y = Math.sin(time * 0.9) * 0.08 * idle;

  // page turn: the circuit folds away, the leaf turns, the new circuit builds up
  if (turn) {
    if (turn.phase === 'retract') {
      if (pops[turn.from] <= 0.0001) {
        turn.phase = 'flip';
        turn.t = 0;
        book.startTurn(turn.to > turn.from ? 1 : -1, pagesOf(turn.from), pagesOf(turn.to));
        setView('book');
      }
    } else {
      turn.t += dt / FLIP_SECONDS;
      book.setTurn(turn.t);
      if (!turn.swapped && turn.t >= 0.5) {
        turn.swapped = true;
        current = turn.to;
        mountCurrent();
      }
      if (turn.t >= 1) {
        book.endTurn();
        turn = null;
        shell.setBusy(false, current, N);
        userTouched = false;
        setView(ENTRY_VIEW);
      }
    }
  }

  const buildAllowed = bookTarget === 1 && bookP > 0.8 && !turn && !reading;
  runtimes.forEach((rt, i) => {
    const goal = buildAllowed && i === current;
    pops[i] = clamp(pops[i] + (goal ? dt : -dt * 4.5), 0, rt.popDuration + 0.4);
    rt.setPop(pops[i]);
    if (pops[i] >= rt.popDuration && !contentBoxes.has(rt)) {
      // the scene is fully built: measure it once, and refit a whole-book view the user has not moved
      contentBoxes.set(rt, measureContent(rt.root));
      if (i === current && !userTouched && !leftView && viewDef(currentViewName).fit) setView(currentViewName);
    }
    if (pops[i] > 0) rt.update(time, dt, camera, renderer.domElement.height);
  });
  runtimes[current].frameUI(now);

  // notebook slides in as the book finishes opening; the scene shifts to stay centred in the free area
  readFactor += ((reading ? 1 : 0) - readFactor) * (1 - Math.exp(-dt * 9));
  leftFactor += ((leftView ? 1 : 0) - leftFactor) * (1 - Math.exp(-dt * 6));
  leftHide += ((leftView && leftView.notebookHidden ? 1 : 0) - leftHide) * (1 - Math.exp(-dt * 7));
  const amt = smoothstep(0.4, 0.95, bookP) * (1 - readFactor) * (1 - leftHide);
  panelAmt = amt;
  const panel = $('#panel');
  panel.style.transform = expanded ? 'none' : `translate${isNarrow() ? 'Y' : 'X'}(calc(${(1 - amt).toFixed(4)} * (100% + 40px)))`;
  panel.style.visibility = amt <= 0.001 && !expanded ? 'hidden' : 'visible';
  const ox = isNarrow() ? 0 : (panelW() * amt) / 2;
  // narrow screens: the notebook is a bottom sheet; in the front view the toolbar also takes 64 px at the top
  const oy = (isNarrow() ? (sheetH() * amt) / 2 : 0) - 32 * leftFactor;
  camera.setViewOffset(size.w, size.h, ox, oy, size.w, size.h);
  leftBar.style.right = isNarrow() ? '0px' : `${(panelW() * amt).toFixed(1)}px`;

  updateRig(dt);
  camera.updateMatrixWorld();
  updateLabels();
  updateCamBar(amt);

  // page corners: a curled corner invites the turn (only in a direction that exists); stronger on hover / focus
  const canTurn = canTurnNow();
  const lift = (zone) => (hoverZone === zone || focusZone === zone ? 1 : 0.6);
  book.setEars(canTurn && current < N - 1 ? lift('next') : 0, canTurn && current > 0 ? lift('prev') : 0);
  book.updateEars(dt, time);
  updateTags(isNarrow() ? 0 : panelW() * amt, isNarrow() ? sheetH() * amt : 0);
  // the reader covers the scene, so skip drawing it; behind the expanded notebook draw it a few times a second only
  // (a chapter may show a picture made while rendering, such as the Coral camera image)
  const covered = (reading && readFactor > 0.98) || (expanded && now - lastCoveredRender < 400);
  if (!covered) {
    if (expanded) lastCoveredRender = now;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for manual experiments in the DevTools console.
window.book3d = {
  setView, openBook, closeBook, goTo, showLibrary, chooseBook, books: BOOKS,
  get runtimes() { return runtimes; },
  get bookId() { return activeDef.id; },
  get libraryOpen() { return libraryOpen; },
  get current() { return current; },
  get turning() { return !!turn; },
  get leftView() { return !!leftView; },
  /** Test helper: pointer and label selection state. */
  get debugPointer() { return { pressPointer, drag: !!drag, selected: selectedLabel?.title ?? null, hover: hoverLabel?.title ?? null, lastLabelClick, lastRelease }; },
  rig,
  enterLeftPage, exitLeftPage, measureLeftPage: (i) => measureLeftPage(LESSONS[i].pageContent),
  setExpanded, get expanded() { return expanded; },
  /** Test helper: the experiment guide of the current chapter as HTML, and the file name the PDF gets. */
  guide: () => currentGuide(),
  get labelsShown() { return options.labels; },
  get selectedLabel() { return selectedLabel?.title ?? null; },
  get viewName() { return currentViewName; },
  /** Test helper: the free area for the book and the layout in use. */
  layout: () => ({ area: freeArea(), content: contentScreenBox(), measured: contentBoxes.has(runtimes[current]), sheet: isNarrow(), compactSide: isCompactSide(), panelW: panelW() }),
  /** Test helper: jump the camera straight to its goals (software rendering is slow, real GPUs glide). */
  snapRig() { rig.target.copy(rig.goalTarget); rig.r = rig.goalR; rig.theta = rig.goalTheta; rig.phi = rig.goalPhi; rig.fov = rig.goalFov; },
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [(v.x * 0.5 + 0.5) * size.w, (-v.y * 0.5 + 0.5) * size.h];
  },
};
