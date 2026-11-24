import * as THREE from 'three';
import { coverTexture, pageEdgeTexture } from './textures.js';

export const PW = 11, PD = 14, PT = 0.9, CT = 0.18;
const LEAF_Y = 0.03; // above the page plane and the ribbon, so nothing intersects the turning leaf
const SEG = 32;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * The book: fixed right half, hinged cover (opens/closes) and a single page "leaf" that turns between
 * spreads. The pages shown on the left and right are textures swapped by the lesson system.
 *
 * Turning forward: the leaf starts on the right showing the old right page (front) and lands on the left
 * showing the new left page (back). The new right page is already under it.
 * Turning backward is the same animation reversed.
 */
export function buildBook(initialPages) {
  const root = new THREE.Group();
  const coverMat = new THREE.MeshStandardMaterial({ color: '#17294f', roughness: 0.6, metalness: 0.05 });
  const edge = new THREE.MeshStandardMaterial({ map: pageEdgeTexture(), roughness: 0.9 });
  const top = new THREE.MeshStandardMaterial({ color: '#f3ebd6', roughness: 0.9 });
  const pageMats = [edge, edge, top, top, edge, edge];
  const pageGeo = new THREE.BoxGeometry(PW, PT, PD);
  const coverGeo = new THREE.BoxGeometry(PW + 0.25, CT, PD + 0.4);

  const mesh = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const pagePlane = (tex, x, parent) => {
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.003, 0);
    m.receiveShadow = true;
    parent.add(m);
    return mat;
  };

  // fixed right half
  mesh(pageGeo, pageMats, PW / 2, -PT / 2, 0, root);
  mesh(coverGeo, coverMat, (PW + 0.25) / 2, -PT - CT / 2, 0, root);
  const rightMat = pagePlane(initialPages.right, PW / 2, root);

  // hinged left half: front cover + pages, pivoting around the spine
  const hinge = new THREE.Group();
  root.add(hinge);
  mesh(pageGeo, pageMats, -PW / 2, -PT / 2, 0, hinge);
  mesh(coverGeo, coverMat, -(PW + 0.25) / 2, -PT - CT / 2, 0, hinge);
  const leftMat = pagePlane(initialPages.left, -PW / 2, hinge);
  const artMat = new THREE.MeshStandardMaterial({ map: coverTexture(), roughness: 0.55, metalness: 0.1 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(PW + 0.25, PD + 0.4), artMat);
  art.rotation.x = Math.PI / 2; // faces down while open, up when closed
  art.position.set(-(PW + 0.25) / 2, -PT - CT - 0.003, 0);
  hinge.add(art);

  // spine: visible only while the book is closed
  const spineH = 2 * (PT + CT);
  const spineGeo = new THREE.BoxGeometry(0.22, spineH, PD + 0.4);
  spineGeo.translate(0, spineH / 2, 0);
  const spine = mesh(spineGeo, coverMat, -0.11, -PT - CT, 0, root);

  // ribbon bookmark
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 3.2), new THREE.MeshStandardMaterial({ color: '#b5432a', roughness: 0.7 }));
  ribbon.position.set(0.55, 0.01, 7.3);
  ribbon.receiveShadow = true;
  root.add(ribbon);

  /* ---------------- page leaf ---------------- */
  const sheetGeo = (flipU) => {
    const g = new THREE.PlaneGeometry(PW, PD, SEG, 1);
    if (flipU) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
    return g;
  };
  const frontGeo = sheetGeo(false);
  const backGeo = sheetGeo(true);
  const frontMat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.FrontSide, shadowSide: THREE.DoubleSide });
  const backMat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.BackSide });
  const leaf = new THREE.Group();
  const front = new THREE.Mesh(frontGeo, frontMat);
  const back = new THREE.Mesh(backGeo, backMat);
  front.castShadow = true;
  front.receiveShadow = true;
  back.receiveShadow = true;
  front.frustumCulled = back.frustumCulled = false;
  leaf.add(front, back);
  leaf.visible = false;
  root.add(leaf);

  const pts = new Array(SEG + 1).fill(0).map(() => [0, 0]);
  function pose(phi0, dir) {
    // the tip lags behind the turning edge, which gives the leaf a soft curl
    const bend = 0.8 * Math.sin(phi0) * (dir > 0 ? -1 : 1);
    const seg = PW / SEG;
    let x = 0, y = 0;
    pts[0][0] = 0;
    pts[0][1] = 0;
    for (let i = 1; i <= SEG; i++) {
      const phi = phi0 + bend * ((i - 0.5) / SEG);
      x += seg * Math.cos(phi);
      y += seg * Math.sin(phi);
      pts[i][0] = x;
      pts[i][1] = y;
    }
    for (const g of [frontGeo, backGeo]) {
      const p = g.attributes.position;
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i <= SEG; i++) p.setXYZ(row * (SEG + 1) + i, pts[i][0], LEAF_Y + pts[i][1], row === 0 ? -PD / 2 : PD / 2);
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }
  }

  /* ---------------- curled page corners (invitation to turn the page) ---------------- */
  // A triangular patch of the page corner is rolled up around a fold line: curved front (back of the paper),
  // a flat "under" triangle where the corner used to lie, and real shadows from the scene light.
  const EAR_N = 14;
  const earFlapMat = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.75, side: THREE.DoubleSide });
  const earUnderMat = new THREE.MeshStandardMaterial({ color: '#bfb28f', roughness: 0.95 });
  const vid = (i, j) => i * (EAR_N + 1) - ((i * (i - 1)) >> 1) + j; // index of grid point (i, j), i + j <= EAR_N
  function makeEar(sx) {
    const count = ((EAR_N + 1) * (EAR_N + 2)) >> 1;
    const index = [];
    for (let i = 0; i < EAR_N; i++) {
      for (let j = 0; j < EAR_N - i; j++) {
        index.push(vid(i, j), vid(i + 1, j), vid(i, j + 1));
        if (j < EAR_N - i - 1) index.push(vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1));
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    fg.setIndex(index);
    const flap = new THREE.Mesh(fg, earFlapMat);
    flap.castShadow = true;
    flap.receiveShadow = true;
    flap.frustumCulled = false;
    const ug = new THREE.BufferGeometry();
    ug.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    ug.setIndex([0, 1, 2]);
    const under = new THREE.Mesh(ug, earUnderMat);
    under.receiveShadow = true;
    under.frustumCulled = false;
    flap.visible = under.visible = false;
    root.add(under, flap);
    return { sx, flap, under, amt: 0, target: 0, vid };
  }
  const ears = { next: makeEar(1), prev: makeEar(-1) };
  const SQ2 = Math.SQRT2;
  function poseEar(ear, s) {
    const rho = Math.max(0.05, s * 0.3); // roll radius grows with the lift
    const pos = ear.flap.geometry.attributes.position;
    const X = (a) => ear.sx * (PW - a), Z = (b) => PD / 2 - b;
    for (let i = 0; i <= EAR_N; i++) {
      for (let j = 0; j <= EAR_N - i; j++) {
        const a = (i / EAR_N) * s, b = (j / EAR_N) * s;
        const d = (s - (a + b)) / SQ2; // distance from the fold line, toward the corner
        const fa = a + d / SQ2, fb = b + d / SQ2; // foot of the perpendicular on the fold line
        const th = d / rho;
        let r, h;
        if (th <= Math.PI) {
          r = rho * Math.sin(th);
          h = rho * (1 - Math.cos(th));
        } else {
          r = -(d - Math.PI * rho);
          h = 2 * rho;
        }
        pos.setXYZ(vid(i, j), X(fa - r / SQ2), 0.014 + h, Z(fb - r / SQ2));
      }
    }
    pos.needsUpdate = true;
    ear.flap.geometry.computeVertexNormals();
    const u = ear.under.geometry.attributes.position;
    u.setXYZ(0, X(0), 0.012, Z(0));
    u.setXYZ(1, X(s), 0.012, Z(0));
    u.setXYZ(2, X(0), 0.012, Z(s));
    u.needsUpdate = true;
    ear.under.geometry.computeVertexNormals();
  }
  let turning = null;
  const setMap = (mat, tex) => {
    mat.map = tex;
    mat.needsUpdate = true;
  };

  return {
    root,
    setProgress(p) {
      const e = easeInOutCubic(p);
      hinge.rotation.z = -Math.PI * (1 - e);
      spine.scale.y = Math.max(0.0001, 1 - smoothstep(0, 0.3, e));
    },
    /** Cover art (texture drawn for the underside, see textures.js) and cover / spine color of another book. */
    setCover(tex, color) {
      artMat.map = tex;
      artMat.needsUpdate = true;
      coverMat.color.set(color);
    },
    /** Show the pages of one spread without animation. */
    setPages(pages) {
      setMap(leftMat, pages.left);
      setMap(rightMat, pages.right);
    },
    /** dir > 0: next page (right to left). dir < 0: previous page. from/to: { left, right } textures. */
    startTurn(dir, from, to) {
      turning = { dir, to };
      if (dir > 0) {
        setMap(frontMat, from.right);
        setMap(backMat, to.left);
        setMap(rightMat, to.right);
        setMap(leftMat, from.left);
      } else {
        setMap(backMat, from.left);
        setMap(frontMat, to.right);
        setMap(leftMat, to.left);
        setMap(rightMat, from.right);
      }
      leaf.visible = true;
      this.setTurn(0);
    },
    /** t in 0..1 */
    setTurn(t) {
      if (!turning) return;
      const e = easeInOutSine(clamp(t, 0, 1));
      pose(turning.dir > 0 ? Math.PI * e : Math.PI * (1 - e), turning.dir);
    },
    endTurn() {
      if (!turning) return;
      this.setPages(turning.to);
      leaf.visible = false;
      turning = null;
    },
    /** Targets 0..1 for the corner hints (0 hidden, 1 fully lifted). */
    setEars(next, prev) {
      ears.next.target = next;
      ears.prev.target = prev;
    },
    /** Smooths the hints and adds a small "lift and settle" motion. time in seconds. */
    updateEars(dt, time) {
      for (const [name, ear] of Object.entries(ears)) {
        ear.amt += (ear.target - ear.amt) * (1 - Math.exp(-dt * 10));
        const show = ear.amt > 0.02;
        ear.under.visible = ear.flap.visible = show;
        if (!show) continue;
        const breath = 0.5 + 0.5 * Math.sin(time * 2.1 + (name === 'prev' ? 1.7 : 0));
        const calm = ear.target >= 0.99 ? 0.05 : 0.16; // quieter while hovered
        poseEar(ear, 2.7 * ear.amt * (1 - calm + calm * 2 * breath));
      }
    },    get turning() {
      return !!turning;
    },
  };
}
