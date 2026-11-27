import * as THREE from 'three';

/*
 * The material of the printed book pages (left page, right page and both faces of the turning leaf), shared by every
 * book and chapter.
 *
 * Why it exists: a lit MeshStandardMaterial multiplied the page by the scene lights (warm key, blue fill, sky), added
 * a specular sheen and the environment reflection, and then the whole image went through ACES filmic tone mapping.
 * The paper turned grey, saturated inks were compressed and dimmed, and thin text lost contrast. "Read page" shows the
 * same page as plain HTML, with none of that.
 *
 * What it does instead:
 *   - The printed colour is shown as painted (no tone mapping, no specular, no environment), so at full light a page
 *     pixel has the same colour as in Read page.
 *   - The light still shapes the paper, but gently: the light a point receives is divided by what an unshadowed
 *     page lying flat receives (calibratePaper), and only part of the difference is kept. Shadows of the 3D parts on
 *     the right page, the shading of the turning leaf and the darker spine side remain; the page never gets
 *     brighter than its print.
 *   - The texture is sampled with a small negative LOD bias. The page is minified a lot in the whole-book view, and
 *     trilinear mipmapping alone blurs thin text; together with anisotropic filtering this keeps it sharper.
 */

/** Shared by every page material, so a change of the scene lights recalibrates all of them. */
const paper = {
  uPaperRef: { value: 1 }, // light (luminance) on an unshadowed flat page, set by calibratePaper()
  uPaperShade: { value: 0.6 }, // 0 = flat print (no shading at all), 1 = full lighting (as a lit material)
  uPaperBias: { value: -0.5 }, // texture LOD bias for the page text
};

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Measures the light an unshadowed page lying flat (normal +y) receives from the scene's lights, as the Lambert
 * shader adds it up (directional, hemisphere and ambient lights; colours are linear). Call it after the lights are
 * set up, and again if they change.
 */
export function calibratePaper(scene) {
  const n = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let e = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isLight || !o.visible) return;
    if (o.isDirectionalLight) {
      dir.subVectors(o.getWorldPosition(a), o.target.getWorldPosition(b)).normalize();
      e += Math.max(0, n.dot(dir)) * o.intensity * lum(o.color);
    } else if (o.isHemisphereLight) {
      dir.copy(o.getWorldPosition(a)).normalize(); // the sky direction (default +y)
      const w = 0.5 * n.dot(dir) + 0.5;
      e += o.intensity * (lum(o.groundColor) * (1 - w) + lum(o.color) * w);
    } else if (o.isAmbientLight) {
      e += o.intensity * lum(o.color);
    }
  });
  paper.uPaperRef.value = Math.max(1e-4, e / Math.PI); // the Lambert BRDF divides by pi
  return paper.uPaperRef.value;
}

/** A material for one printed page. options: any MeshLambertMaterial options (map, side, shadowSide...). */
export function createPageMaterial(options = {}) {
  const mat = new THREE.MeshLambertMaterial({ ...options });
  mat.toneMapped = false; // the print keeps its colours, as in Read page
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, paper);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPaperRef;\nuniform float uPaperShade;\nuniform float uPaperBias;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
	diffuseColor *= texture2D( map, vMapUv, uPaperBias );
#endif`)
      .replace('#include <opaque_fragment>', `{
	// light received here, relative to an unshadowed flat page (1.0), from the lit colour and the print colour
	const vec3 W = vec3( 0.2126, 0.7152, 0.0722 );
	float received = dot( outgoingLight, W ) / max( dot( diffuseColor.rgb, W ), 1e-4 ) / uPaperRef;
	float shade = mix( 1.0, clamp( received, 0.0, 1.0 ), uPaperShade );
	gl_FragColor = vec4( diffuseColor.rgb * shade, diffuseColor.a );
}`);
  };
  mat.customProgramCacheKey = () => 'book-page-v1';
  return mat;
}

/** Test and tuning hook: the shared uniforms' values. */
export const paperSettings = {
  get ref() { return paper.uPaperRef.value; },
  get shade() { return paper.uPaperShade.value; },
  set shade(v) { paper.uPaperShade.value = v; },
  get bias() { return paper.uPaperBias.value; },
  set bias(v) { paper.uPaperBias.value = v; },
};
