// The circuit in 3D, built from the same lap the car drives (kin.js TRACE: the racing line every 10 m) and the
// corner list from F1's circuit data: tarmac, white edge lines, red-and-white kerbs where the line bends hard,
// gravel outside the tightest corners, numbered corner boards, a chequered start/finish line, grass all round.
// Track metres: x east, y north (decimetres / 10, as kin.js). Scene: X = x, Z = -y, so heading h turns the car
// (nose along +X) by rotation.y = h.
import * as THREE from 'three';
import {LAP_D, TRACE} from './kin.js';

const HALF = 7;          // half track width, metres (Mexico City ≈ 12–15 m)
const KERB = 1.6;        // kerb width
const V3 = THREE.Vector3;

// a smooth closed centreline sampled every ~2 m, with distance, heading and curvature
export function centreline() {
  const raw = TRACE.map((r) => new V3(r[5], 0, -r[6]));
  const curve = new THREE.CatmullRomCurve3(raw, true, 'centripetal');
  const n = Math.round(LAP_D / 2);
  const pts = curve.getSpacedPoints(n);
  pts.pop();
  const N = pts.length;
  const out = pts.map((p, i) => {
    const a = pts[(i - 1 + N) % N];
    const b = pts[(i + 1) % N];
    const t = b.clone().sub(a).setY(0).normalize();
    return {p, t, nrm: new V3(-t.z, 0, t.x), d: (i / N) * LAP_D};   // nrm points left of travel
  });
  for (let i = 0; i < N; i++) {
    const a = out[(i - 3 + N) % N].t;
    const b = out[(i + 3) % N].t;
    out[i].k = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) / 12;   // signed curvature, 1/m
  }
  return out;
}

const ribbon = (cl, off0, off1, y, colorAt) => {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const N = cl.length;
  cl.forEach((c, i) => {
    const a = c.p.clone().addScaledVector(c.nrm, off0);
    const b = c.p.clone().addScaledVector(c.nrm, off1);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    uv.push(off0 / 6, c.d / 6, off1 / 6, c.d / 6);
    const k = colorAt ? colorAt(c, i) : [1, 1, 1];
    col.push(...k, ...k);
    const j = (i + 1) % N;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // which way the ribbon faces depends on the side; flat ground always faces up
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
};
// keep only the stretches where test(c) holds (kerbs, gravel)
const stretches = (cl, test) => {
  const runs = [];
  let cur = null;
  cl.forEach((c, i) => {
    if (test(c)) {
      if (!cur) runs.push((cur = []));
      cur.push(i);
    } else cur = null;
  });
  return runs.filter((r) => r.length > 3);
};
const strip = (cl, run, off0, off1, y, colorAt) => ribbon(run.map((i) => cl[i]), off0, off1, y, colorAt && ((c, j) => colorAt(c, run[j])));
const openRibbon = (g) => {
  // ribbon() closes the loop; for a stretch drop the last joining quad
  const idx = g.getIndex().array;
  g.setIndex(Array.from(idx.slice(0, idx.length - 6)));
  return g;
};

// kerb: separate quads so each 2 m block keeps its own flat colour (no pink blending)
function kerbStrip(cl, run, o0, o1, y, c1, c2) {
  const pos = [];
  const col = [];
  for (let j = 0; j < run.length - 1; j++) {
    const a = cl[run[j]];
    const b = cl[run[j + 1]];
    const A0 = a.p.clone().addScaledVector(a.nrm, o0);
    const A1 = a.p.clone().addScaledVector(a.nrm, o1);
    const B0 = b.p.clone().addScaledVector(b.nrm, o0);
    const B1 = b.p.clone().addScaledVector(b.nrm, o1);
    for (const v of [A0, B0, A1, A1, B0, B1]) pos.push(v.x, y, v.z);
    const c = run[j] % 2 ? c1 : c2;
    for (let k = 0; k < 6; k++) col.push(...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

// a number board: white panel with the corner number, on a post
function board(n) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#d6182b';
  x.lineWidth = 10;
  x.strokeRect(5, 5, 118, 118);
  x.fillStyle = '#16181b';
  x.font = '800 78px "Bricolage Grotesque", Inter, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(n, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshStandardMaterial({map: tex, roughness: 0.6, side: THREE.DoubleSide}));
  panel.position.y = 2.6;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8), new THREE.MeshStandardMaterial({color: '#9aa1aa', metalness: 0.6, roughness: 0.4}));
  post.position.y = 0.8;
  g.add(panel, post);
  return g;
}

// grainy surface textures drawn once (no downloads): tarmac, grass, gravel
function grain(base, spread, n = 9000, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const v = Math.round((r() - 0.5) * spread);
    x.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    x.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// a wall along the lap at a fixed offset (concrete barrier or tyre wall), only where keep(c) holds
function wall(cl, off, h, mat, keep = () => true) {
  const pos = [];
  const N = cl.length;
  for (let i = 0; i < N; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % N];
    if (!keep(a) || !keep(b)) continue;
    const A = a.p.clone().addScaledVector(a.nrm, off);
    const B = b.p.clone().addScaledVector(b.nrm, off);
    pos.push(A.x, 0, A.z, B.x, 0, B.z, A.x, h, A.z, A.x, h, A.z, B.x, 0, B.z, B.x, h, B.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildTrack(corners = []) {
  const cl = centreline();
  const N = cl.length;
  const group = new THREE.Group();
  const lam = (c) => new THREE.MeshStandardMaterial({color: c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide});
  // grass
  const gTex = grain('#58733d', 70);
  gTex.repeat.set(500, 500);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({map: gTex, roughness: 0.95}));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cl.reduce((s, c) => s + c.p.x, 0) / N, -0.25, cl.reduce((s, c) => s + c.p.z, 0) / N);
  grass.receiveShadow = true;
  group.add(grass);
  // gravel traps outside the tightest corners
  const grTex = grain('#c9b28a', 90, 14000);
  const gravelMat = new THREE.MeshStandardMaterial({map: grTex, roughness: 1, side: THREE.DoubleSide});
  for (const run of stretches(cl, (c) => Math.abs(c.k) > 1 / 90)) {
    const side = Math.sign(cl[run[Math.floor(run.length / 2)]].k);       // outside of the turn
    const g = openRibbon(strip(cl, run, -side * (HALF + KERB), -side * (HALF + KERB + 14), -0.1));
    const m = new THREE.Mesh(g, gravelMat);
    m.receiveShadow = true;
    group.add(m);
  }
  // tarmac, slightly darker along the racing line
  const tTex = grain('#3c3f44', 60, 16000);
  const tarmac = new THREE.Mesh(ribbon(cl, -HALF, HALF, 0), new THREE.MeshStandardMaterial({map: tTex, roughness: 0.82, side: THREE.DoubleSide}));
  tarmac.receiveShadow = true;
  group.add(tarmac);
  // white edge lines
  const lineMat = new THREE.MeshStandardMaterial({color: '#e9ebee', roughness: 0.7, side: THREE.DoubleSide});
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(ribbon(cl, s * (HALF - 0.35), s * (HALF - 0.1), 0.04), lineMat);
    m.receiveShadow = true;
    group.add(m);
  }
  // kerbs: red and white blocks, 1.5 m each, on both edges where the line bends hard
  const kerbMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.6, side: THREE.DoubleSide});
  const red = [0.84, 0.09, 0.16];
  const white = [0.95, 0.95, 0.95];
  for (const run of stretches(cl, (c) => Math.abs(c.k) > 1 / 160)) {
    for (const s of [1, -1]) {
      const g = kerbStrip(cl, run, s * HALF, s * (HALF + KERB), 0.05, red, white);
      const m = new THREE.Mesh(g, kerbMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }
  // chequered start/finish line across the track at lap distance 0
  {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    const x = c.getContext('2d');
    for (let i = 0; i < 64; i++) for (let j = 0; j < 8; j++) {
      x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
      x.fillRect(i, j, 1, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    const s0 = cl[0];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 1.8), new THREE.MeshStandardMaterial({map: tex, roughness: 0.7, side: THREE.DoubleSide}));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-s0.t.z, s0.t.x) + Math.PI / 2;
    m.position.set(s0.p.x, 0.05, s0.p.z);
    group.add(m);
  }
  // corner boards on the outside of each corner
  for (const cn of corners) {
    const i = Math.round((((cn.d % LAP_D) + LAP_D) % LAP_D) / LAP_D * N) % N;
    const c = cl[i];
    const side = Math.sign(c.k) || 1;
    const b = board(cn.n);
    b.position.copy(c.p).addScaledVector(c.nrm, -side * (HALF + KERB + 4));
    b.lookAt(c.p.x, 0, c.p.z);
    b.traverse((o) => o.isMesh && (o.castShadow = true));
    group.add(b);
  }
  // concrete barriers along both sides, tyre walls where the corners are tight (real sizes: 1 m and 0.9 m tall)
  const concrete = new THREE.MeshStandardMaterial({color: '#c9ccd0', roughness: 0.9, side: THREE.DoubleSide});
  const tyres = new THREE.MeshStandardMaterial({color: '#1d1e20', roughness: 0.95, side: THREE.DoubleSide});
  const tight = (c) => Math.abs(c.k) > 1 / 90;
  for (const sd of [1, -1]) {
    group.add(wall(cl, sd * (HALF + KERB + 24), 1.0, concrete));
    group.add(wall(cl, sd * (HALF + KERB + 22), 0.9, tyres, (c) => tight(c) && Math.sign(c.k) === -sd));
  }
  return {group, cl};
}

// where the car is and which way it points at lap distance d (metres)
export function poseOnTrack(cl, d) {
  const N = cl.length;
  const u = ((((d % LAP_D) + LAP_D) % LAP_D) / LAP_D) * N;
  const i = Math.floor(u) % N;
  const f = u - Math.floor(u);
  const a = cl[i];
  const b = cl[(i + 1) % N];
  const p = a.p.clone().lerp(b.p, f);
  const t = a.t.clone().lerp(b.t, f).normalize();
  return {p, t, yaw: Math.atan2(-t.z, t.x)};
}
