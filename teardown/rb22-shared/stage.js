// The RB22's stage: a pale studio, a soft shadow on an invisible floor, bright soft boxes for the clear-coated body
// to catch, GTAO kept off the floor. Adapted from the kit's V8 stage, scaled for a 5.6 m car.
// frame(s, cam, ops) poses the car for lap state s and draws one frame.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Pass} from 'three/addons/postprocessing/Pass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {buildCar} from './car.js';
import MODEL from './rb22.glb';
import ENGINE from './engine.glb';
import WHEEL from './wheel.glb';
import FLOOR from './floor.glb';
import FRONTWING from './frontwing.glb';

// The real RB22: "2026 Redbull RB22" by Dave Love (Sketchfab), CC BY 4.0. Wheels and steering wheel split out so
// they turn (MODEL-CREDIT.md). A page that can't load it still shows the code-built car.
export async function loadReal(onProgress = null) {
  const url = String(MODEL).replace(/^url:/, '');
  try {
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url, (e) => onProgress?.(e.total ? e.loaded / e.total : 0, e.loaded));
    // the sticker layers (sponsors, number, wheel decals) carry their cut-out in the texture's alpha, but the export
    // marks them opaque: cut them out so they don't show as white blocks
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (/decal|number|cinture|mirror|clearled/i.test(m.name || '') && m.map) {
          m.alphaTest = 0.5;
          m.transparent = false;
          m.needsUpdate = true;
        }
      }
    });
    return g.scene;
  } catch (e) {
    console.warn('RB22 model unavailable, using the drawn car', e);
    return null;
  }
}

const V3 = THREE.Vector3;
export const BG = {top: '#f3f3f4', mid: '#e9eaec', low: '#e1e2e5'};

// The detailed power unit and steering wheel (Peter Kiss Design, CGTrader). Missing files: drawn parts stay.
export async function loadDetail(onProgress = null) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const one = (u) => loader.loadAsync(String(u).replace(/^url:/, ''), (e) => onProgress?.(e.loaded)).then((g) => g.scene).catch((e) => {
    console.warn('detail model unavailable', u, e);
    return null;
  });
  const [engine, wheel, floor, frontwing] = await Promise.all([one(ENGINE), one(WHEEL), one(FLOOR), one(FRONTWING)]);
  return {engine, wheel, floor, frontwing};
}

export function createStage({canvas, lo = false, real = null, detail = {}}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true;   // trims the car model's own nose where the CAD front wing takes over
  renderer.shadowMap.type = lo ? THREE.BasicShadowMap : THREE.VSMShadowMap;
  const scene = new THREE.Scene();
  {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, BG.top);
    gr.addColorStop(0.55, BG.mid);
    gr.addColorStop(1, BG.low);
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  }
  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.05, 80);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: lo ? 0 : 8}));
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 4, 4);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.7;
  gtao.updateGtaoMaterial({radius: 0.25, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false});
  gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16});
  class Toggle extends Pass {
    constructor(fn) {
      super();
      this.needsSwap = false;
      this.fn = fn;
    }
    render() {
      this.fn();
    }
  }
  composer.addPass(new Toggle(() => (shade.visible = false)));
  composer.addPass(gtao);
  composer.addPass(new Toggle(() => (shade.visible = true)));
  if (lo) gtao.enabled = false;
  composer.addPass(new OutputPass());

  if (lo) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.8;
    pm.dispose();
  } else {
    const env = new THREE.Scene();
    env.background = new THREE.Color('#d9dadd');
    const sb = (w, h, pos, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(1, 1, 1).multiplyScalar(k), side: THREE.DoubleSide}));
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    sb(14, 14, new V3(0, 16, 2), 2.4);
    sb(3, 16, new V3(-14, 5, 7), 3.0);
    sb(3, 16, new V3(14, 5, -5), 2.0);
    sb(20, 2, new V3(0, 2, 16), 1.5);
    const g = new THREE.Mesh(new THREE.CircleGeometry(50, 32), new THREE.MeshBasicMaterial({color: '#c9cacd', side: THREE.DoubleSide}));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -1;
    env.add(g);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  }
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(-2.5, 7, 3.5);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, {left: -4.2, right: 4.2, top: 4.2, bottom: -4.2, near: 1, far: 20});
  sun.shadow.mapSize.set(lo ? 1024 : 4096, lo ? 1024 : 4096);
  sun.shadow.radius = 10;
  sun.shadow.blurSamples = 20;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  sun.target.position.set(1.7, 0, 0);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfd0d3', lo ? 2.0 : 0.75));

  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({color: '#5d636c', opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8}),
  );
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = -0.001;
  shade.receiveShadow = true;
  scene.add(shade);

  const car = buildCar(real, detail);
  scene.add(car.root);

  const size = {w: 1600, h: 900};
  const resize = (w, h, pr) => {
    size.w = w;
    size.h = h;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  // cam: target (tx, ty, tz), azimuth from +z toward +x and elevation in radians, distance in metres, sx/sy screen shift
  const frame = (s, cam, ops = {}) => {
    car.update(s, ops);
    const {tx, ty, tz, az, el, d} = cam;
    camera.position.set(tx + d * Math.cos(el) * Math.sin(az), ty + d * Math.sin(el), tz + d * Math.cos(el) * Math.cos(az));
    camera.lookAt(tx, ty, tz);
    camera.setViewOffset(size.w, size.h, -(cam.sx ?? 0), -(cam.sy ?? 0), size.w, size.h);
    camera.updateMatrixWorld();
    composer.render();
  };
  // the explorer moves the camera itself (OrbitControls): pose the car and draw
  const draw = (s, ops = {}) => {
    car.update(s, ops);
    camera.updateMatrixWorld();
    composer.render();
  };
  const pv = new V3();
  const project = (v) => {
    if (!v) return null;
    pv.copy(v).project(camera);
    if (pv.z > 1) return null;
    return [(pv.x * 0.5 + 0.5) * size.w, (-pv.y * 0.5 + 0.5) * size.h];
  };
  const setQuality = ({samples, ao, shadow}) => {
    if (samples !== undefined) {
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        t.samples = samples;
        t.dispose();
      }
    }
    if (ao !== undefined) gtao.enabled = ao;
    if (shadow !== undefined) {
      sun.shadow.mapSize.set(shadow, shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };
  return {renderer, scene, camera, car, composer, gtao, sun, resize, frame, draw, project, size, setQuality};
}
