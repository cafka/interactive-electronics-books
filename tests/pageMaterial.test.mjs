// The book pages' material (src/pageMaterial.js): calibration against the scene lights, and the shader changes it
// makes to three.js's Lambert material (the chunks it replaces must exist, or the pages would silently fall back to
// a plain lit material).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// "three" is an import map entry in the page; in Node, map it to the vendored file
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(new URL('../vendor/three.module.js', import.meta.url).href)}, shortCircuit: true };
  return next(spec, ctx);
}`));
const THREE = await import('three');
const { calibratePaper, createPageMaterial, paperSettings } = await import('../src/pageMaterial.js');

/** The lights of src/main.js, read from its source so the test follows any change there. */
function sceneLikeMain() {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const scene = new THREE.Scene();
  const hemi = src.match(/new THREE\.HemisphereLight\('([^']+)', '([^']+)', ([\d.]+)\)/);
  scene.add(new THREE.HemisphereLight(hemi[1], hemi[2], Number(hemi[3])));
  for (const [, name, color, intensity] of src.matchAll(/const (\w+) = new THREE\.DirectionalLight\('([^']+)', ([\d.]+)\)/g)) {
    const l = new THREE.DirectionalLight(color, Number(intensity));
    const p = src.match(new RegExp(`${name}\\.position\\.set\\(([-\\d.]+), ([-\\d.]+), ([-\\d.]+)\\)`));
    l.position.set(Number(p[1]), Number(p[2]), Number(p[3]));
    scene.add(l);
  }
  return scene;
}

test('calibration: the light a flat page receives, as the Lambert shader adds it up', () => {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.position.set(0, 10, 0); // straight above the page
  scene.add(sun);
  assert.ok(Math.abs(calibratePaper(scene) - 3 / Math.PI) < 1e-6);
  sun.position.set(10, 10, 0); // 45 degrees
  assert.ok(Math.abs(calibratePaper(scene) - (3 * Math.SQRT1_2) / Math.PI) < 1e-6);
  scene.add(new THREE.HemisphereLight('#ffffff', '#000000', 1)); // sky straight up: all sky
  assert.ok(Math.abs(calibratePaper(scene) - (3 * Math.SQRT1_2 + 1) / Math.PI) < 1e-6);
  const r = calibratePaper(sceneLikeMain());
  assert.ok(r > 0.3 && r < 3, `the book's own lights give a sensible reference (${r})`);
  assert.equal(paperSettings.ref, r);
});

test('the page material: unlit print colours (no tone mapping), shadows kept, shader chunks replaced', () => {
  const tex = new THREE.Texture();
  const mat = createPageMaterial({ map: tex, side: THREE.BackSide });
  assert.ok(mat.isMeshLambertMaterial, 'Lambert: no specular sheen and no environment reflection on the paper');
  assert.equal(mat.toneMapped, false);
  assert.equal(mat.map, tex);
  assert.equal(mat.side, THREE.BackSide);
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, vertexShader: THREE.ShaderLib.lambert.vertexShader };
  for (const chunk of ['#include <common>', '#include <map_fragment>', '#include <opaque_fragment>']) assert.ok(shader.fragmentShader.includes(chunk), `three.js still has ${chunk}`);
  mat.onBeforeCompile(shader);
  assert.ok(!shader.fragmentShader.includes('#include <opaque_fragment>') && !shader.fragmentShader.includes('#include <map_fragment>'));
  assert.match(shader.fragmentShader, /texture2D\( map, vMapUv, uPaperBias \)/);
  assert.match(shader.fragmentShader, /gl_FragColor = vec4\( diffuseColor\.rgb \* shade, diffuseColor\.a \)/);
  assert.ok(shader.fragmentShader.includes('#include <shadowmap_pars_fragment>'), 'shadows are still received');
  for (const u of ['uPaperRef', 'uPaperShade', 'uPaperBias']) assert.ok(u in shader.uniforms, u);
  assert.ok(paperSettings.shade > 0 && paperSettings.shade < 1);
  assert.ok(paperSettings.bias <= 0 && paperSettings.bias >= -1);
});

test('the book uses the page material for every printed page and for both faces of the turning leaf', () => {
  const src = readFileSync(new URL('../src/book.js', import.meta.url), 'utf8');
  assert.equal((src.match(/createPageMaterial\(/g) || []).length, 3, 'page planes (left and right) and the two leaf faces');
  assert.ok(!/MeshStandardMaterial\(\{ map: tex/.test(src));
  assert.ok(/calibratePaper\(scene\)/.test(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')));
});
