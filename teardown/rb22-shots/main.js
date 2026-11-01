// Renders the real RB22 model to transparent PNGs for the site: a side view (loaders, team pages) and a top view
// (the cars that lap the track maps). Run headless; results land in window.SHOTS as data URLs.
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadReal} from '../rb22-shared/stage.js';

const W = 2400;
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
const sun = new THREE.DirectionalLight('#fff', 1.6);
sun.position.set(2, 6, 4);
scene.add(sun, new THREE.HemisphereLight('#fff', '#888', 0.6));
const real = await loadReal();
scene.add(real);
const box = new THREE.Box3().setFromObject(real);
const c = box.getCenter(new THREE.Vector3());
const sz = box.getSize(new THREE.Vector3());
const shot = (dir, up, w, h) => {
  renderer.setSize(w, h, false);
  const span = Math.max(sz.x, sz.y, sz.z) * 0.51;
  const asp = w / h;
  const cam = new THREE.OrthographicCamera(-span, span, span / asp, -span / asp, 0.01, 50);
  cam.up.copy(up);
  cam.position.copy(c).addScaledVector(dir, 10);
  cam.lookAt(c);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
};
// model: nose along +z, up +y. Side: from +x, nose to the right. Top: from above, nose up.
window.SHOTS = {
  side: shot(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), W, Math.round(W * 0.26)),
  top: shot(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), Math.round(W * 0.45), W),
};
window.DONE = true;
