// The RB22, built from code in metres: x forward (rear axle at 0, front axle at the 3.4 m wheelbase), y up from the
// ground, z across. Sized from the 2026 rules (1.9 m wide, 706 mm tyres, 280/375 mm tyre widths) and laid out after
// the published RB22 analysis: push-rods front and rear, shrink-wrapped sidepods, a large airbox, three-element
// active wings. No team livery or logos: a dark blue body, carbon, metal.
//
// buildCar() → {root, update(s, ops), anchor(name), parts}. update(s) poses everything from the lap state s
// (kin.js stateAt); ops: {explode 0..1, solo: system key or null, wheelScreen: canvas}.
import * as THREE from 'three';
import {CAR, R_WHEEL} from './kin.js';

const V3 = THREE.Vector3;
const WB = CAR.wheelbase;
export const SYSTEMS = {
  aero: 'Aerodynamics',
  chassis: 'Chassis & bodywork',
  pu: 'Power unit',
  cooling: 'Cooling',
  susp: 'Suspension & brakes',
  wheel: 'Steering wheel',
};

// ------------------------------------------------------------ materials
const M = {
  body: () => new THREE.MeshPhysicalMaterial({color: '#1d2b4f', roughness: 0.42, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25, envMapIntensity: 0.7}),
  carbon: () => new THREE.MeshStandardMaterial({color: '#25272b', roughness: 0.5, metalness: 0.2, envMapIntensity: 0.5}),
  wingAccent: () => new THREE.MeshStandardMaterial({color: '#2c3a63', roughness: 0.45, metalness: 0.15, envMapIntensity: 0.6}),
  metal: () => new THREE.MeshStandardMaterial({color: '#9aa1aa', roughness: 0.45, metalness: 0.8, envMapIntensity: 0.5}),
  dark: () => new THREE.MeshStandardMaterial({color: '#3a3f47', roughness: 0.55, metalness: 0.5, envMapIntensity: 0.5}),
  ti: () => new THREE.MeshStandardMaterial({color: '#6d737c', roughness: 0.5, metalness: 0.7, envMapIntensity: 0.5}),
  tyre: () => new THREE.MeshStandardMaterial({color: '#1b1c1e', roughness: 0.85, metalness: 0}),
  rim: () => new THREE.MeshStandardMaterial({color: '#2a2d33', roughness: 0.45, metalness: 0.7, envMapIntensity: 0.5}),
  stripe: () => new THREE.MeshStandardMaterial({color: '#d6182b', roughness: 0.6}),
  void: () => new THREE.MeshStandardMaterial({color: '#0b0c0e', roughness: 0.9}),
  rad: () => new THREE.MeshStandardMaterial({color: '#b9c0c8', roughness: 0.5, metalness: 0.6, envMapIntensity: 0.5}),
  copper: () => new THREE.MeshStandardMaterial({color: '#b46a3c', roughness: 0.45, metalness: 0.75, envMapIntensity: 0.5}),
  batt: () => new THREE.MeshStandardMaterial({color: '#e7a10f', roughness: 0.55, metalness: 0.1}),
  fuel: () => new THREE.MeshStandardMaterial({color: '#c7c2b4', roughness: 0.8, metalness: 0}),
  disc: () => new THREE.MeshStandardMaterial({color: '#3b3533', roughness: 0.7, metalness: 0.2}),
  caliper: () => new THREE.MeshStandardMaterial({color: '#5b6068', roughness: 0.5, metalness: 0.6}),
  rubber: () => new THREE.MeshStandardMaterial({color: '#2b2d31', roughness: 0.8}),
};

// ------------------------------------------------------------ shape helpers
// a loft through superellipse cross-sections along x: [{x, y, z, w, h, n}] (centre y/z, full width/height, n squareness)
function loft(secs, seg = 28) {
  const pos = [];
  const idx = [];
  const ring = (s) => {
    const n = s.n ?? 3;
    const out = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const si = Math.sin(a);
      const ex = 2 / n;
      out.push([s.x, (s.y ?? 0) + (s.h / 2) * Math.sign(si) * Math.abs(si) ** ex, (s.z ?? 0) + (s.w / 2) * Math.sign(c) * Math.abs(c) ** ex]);
    }
    return out;
  };
  secs.forEach((s) => ring(s).forEach((p) => pos.push(...p)));
  for (let i = 0; i < secs.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  // end caps
  for (const [i, flip] of [[0, true], [secs.length - 1, false]]) {
    const s = secs[i];
    const ci = pos.length / 3;
    pos.push(s.x, s.y ?? 0, s.z ?? 0);
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      if (flip) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// a cambered aerofoil of chord c (along -x from its leading edge at 0), extruded across z over span
function aerofoil(c, span, thick = 0.1, camber = 0.06) {
  const sh = new THREE.Shape();
  const P = 18;
  const top = [];
  const bot = [];
  for (let i = 0; i <= P; i++) {
    const u = i / P;
    const yt = 5 * thick * c * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const yc = camber * c * 4 * u * (1 - u);
    top.push([-u * c, yc + yt]);
    bot.push([-u * c, yc - yt]);
  }
  sh.moveTo(...top[0]);
  top.slice(1).forEach((p) => sh.lineTo(...p));
  bot.reverse().forEach((p) => sh.lineTo(...p));
  const g = new THREE.ExtrudeGeometry(sh, {depth: span, bevelEnabled: false, steps: 1});
  g.translate(0, 0, -span / 2);
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, s = 24) => new THREE.CylinderGeometry(r1, r2, h, s);
function tube(a, b, r = 0.012) {
  const A = new V3(...a);
  const B = new V3(...b);
  const L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, L, 10);
  g.translate(0, L / 2, 0);
  // the cylinder runs along +y: turn +y onto A→B
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

// which way the CAD flaps turn to flatten (checked against side renders)
export let FLAP_DIR = 1;
export const setFlapDir = (d) => (FLAP_DIR = d);

export function buildCar(real = null, detail = {}) {
  const root = new THREE.Group();          // posed by the ride (heave, pitch, roll)
  const parts = [];                         // {mesh or group, sys, name, explode: V3}
  const anchors = {};
  const add = (parent, obj, sys, name, explode = [0, 0, 0]) => {
    parent.add(obj);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.sys = sys;
        o.userData.part = name;
        o.userData.base = o.material;
      }
    });
    const p = {obj, sys, name, ex: new V3(...explode), home: obj.position.clone()};
    parts.push(p);
    return obj;
  };
  const mesh = (g, m) => new THREE.Mesh(g, m);
  const at = (o, x, y, z) => {
    o.position.set(x, y, z);
    return o;
  };

  // ============================================================ chassis: survival cell, nose, cockpit, halo, cover
  const tub = mesh(loft([
    {x: 4.0, y: 0.3, w: 0.12, h: 0.08, n: 2.4},
    {x: 3.8, y: 0.33, w: 0.22, h: 0.15, n: 2.6},
    {x: 3.45, y: 0.4, w: 0.3, h: 0.25, n: 2.8},
    {x: 2.95, y: 0.47, w: 0.42, h: 0.38, n: 3},
    {x: 2.45, y: 0.5, w: 0.56, h: 0.48, n: 3.2},
    {x: 1.95, y: 0.5, w: 0.72, h: 0.55, n: 3.4},
    {x: 1.45, y: 0.47, w: 0.8, h: 0.58, n: 3.6},
    {x: 1.1, y: 0.45, w: 0.78, h: 0.56, n: 3.6},
    {x: 1.0, y: 0.44, w: 0.74, h: 0.52, n: 3.6},
  ], 36), M.body());
  add(root, tub, 'chassis', 'Survival cell');
  // the cockpit opening and the driver's helmet
  const cockpit = mesh(new THREE.CircleGeometry(1, 36), M.void());  // (drawn car only)
  cockpit.scale.set(0.36, 0.2, 1);
  cockpit.rotation.x = -Math.PI / 2;
  add(root, at(cockpit, 1.82, 0.785, 0), 'chassis', 'Cockpit');
  const helmet = mesh(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshStandardMaterial({color: '#e8e9eb', roughness: 0.35, metalness: 0.1}));
  helmet.scale.set(1.1, 0.95, 0.92);
  add(root, at(helmet, 1.66, 0.83, 0), 'chassis', 'Driver', [0, 0.9, 0]);
  const visor = mesh(new THREE.SphereGeometry(0.131, 24, 8, -0.7, 1.4, 1.2, 0.45), M.void());
  visor.scale.copy(helmet.scale);
  helmet.add(visor);
  visor.rotation.y = Math.PI / 2;
  // halo: titanium hoop round the cockpit, one pillar ahead of the driver
  const haloPath = new THREE.CurvePath();
  const hl = [];
  for (let k = 0; k <= 24; k++) {
    const a = Math.PI * (0.12 + (1.76 * k) / 24);
    hl.push(new V3(1.86 + 0.34 * Math.cos(a), 0.94 - 0.05 * Math.max(0, -Math.cos(a)), 0.27 * Math.sin(a)));
  }
  const haloRing = new THREE.CatmullRomCurve3([new V3(1.55, 0.76, 0.33), ...hl, new V3(1.55, 0.76, -0.33)]);
  void haloPath;
  const halo = new THREE.Group();
  halo.add(mesh(new THREE.TubeGeometry(haloRing, 64, 0.022, 10), M.ti()));
  halo.add(mesh(tube([2.2, 0.93, 0], [2.32, 0.76, 0], 0.024), M.ti()));
  add(root, halo, 'chassis', 'Halo', [0, 0.7, 0]);
  anchors.halo = () => halo.localToWorld(new V3(2.2, 0.93, 0));
  // engine cover and airbox above the driver's head, tapering to the gearbox; a shark fin
  const cover = mesh(loft([
    {x: 1.62, y: 0.86, w: 0.24, h: 0.24, n: 2.6},
    {x: 1.35, y: 0.76, w: 0.5, h: 0.5, n: 3},
    {x: 1.05, y: 0.6, w: 0.68, h: 0.66, n: 3.4},
    {x: 0.75, y: 0.5, w: 0.66, h: 0.62, n: 3.4},
    {x: 0.4, y: 0.47, w: 0.5, h: 0.48, n: 3},
    {x: 0.0, y: 0.45, w: 0.26, h: 0.26, n: 2.6},
    {x: -0.32, y: 0.45, w: 0.12, h: 0.1, n: 2.4},
  ]), M.body());
  add(root, cover, 'chassis', 'Engine cover', [0, 1.15, 0]);
  const inlet = mesh(new THREE.CircleGeometry(1, 28), M.void());
  inlet.scale.set(0.085, 0.1, 1);
  inlet.rotation.y = Math.PI / 2;
  add(root, at(inlet, 1.625, 0.88, 0), 'chassis', 'Airbox inlet', [0, 1.15, 0]);
  const fin = mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(1.2, 0.95), new THREE.Vector2(-0.25, 0.62), new THREE.Vector2(-0.25, 0.5), new THREE.Vector2(1.2, 0.75)])), M.body());
  fin.material.side = THREE.DoubleSide;
  add(root, fin, 'chassis', 'Engine cover fin', [0, 1.15, 0]);
  anchors.airbox = () => inlet.getWorldPosition(new V3());
  // fuel cell inside the tub behind the driver (≈ 100 kg of sustainable fuel)
  const fuel = mesh(new THREE.BoxGeometry(0.36, 0.34, 0.5), M.fuel());
  add(root, at(fuel, 1.3, 0.43, 0), 'chassis', 'Fuel cell', [0, 0.45, 0]);
  anchors.fuel = () => fuel.getWorldPosition(new V3());
  // mirrors on the sidepod shoulders
  for (const s of [1, -1]) {
    const mir = new THREE.Group();
    mir.add(at(mesh(box(0.06, 0.05, 0.14), M.body()), 0, 0, 0));
    mir.add(at(mesh(tube([0, -0.02, -s * 0.03], [0.05, -0.12, -s * 0.12], 0.008), M.carbon()), 0, 0, 0));
    add(root, at(mir, 2.05, 0.72, s * 0.52), 'chassis', 'Mirror', [0, 0.3, s * 0.4]);
  }

  // ============================================================ sidepods (bodywork) and cooling inside
  for (const s of [1, -1]) {
    const pod = mesh(loft([
      {x: 2.05, y: 0.42, z: s * 0.5, w: 0.2, h: 0.3, n: 3.5},
      {x: 1.85, y: 0.42, z: s * 0.53, w: 0.3, h: 0.36, n: 3.5},
      {x: 1.4, y: 0.39, z: s * 0.52, w: 0.3, h: 0.36, n: 3.2},
      {x: 0.95, y: 0.32, z: s * 0.46, w: 0.24, h: 0.26, n: 3},
      {x: 0.45, y: 0.24, z: s * 0.36, w: 0.14, h: 0.14, n: 2.6},
      {x: 0.15, y: 0.2, z: s * 0.28, w: 0.06, h: 0.06, n: 2.4},
    ]), M.body());
    add(root, pod, 'chassis', 'Sidepod', [0, 0.1, s * 0.75]);
    const mouth = mesh(new THREE.PlaneGeometry(0.12, 0.25), M.void());
    mouth.rotation.y = Math.PI / 2;
    add(root, at(mouth, 2.056, 0.44, s * 0.5), 'chassis', 'Sidepod inlet', [0, 0.1, s * 0.75]);
    // radiator: a finned block tilted inside the pod
    const rad = new THREE.Group();
    rad.add(mesh(box(0.05, 0.3, 0.2), M.rad()));
    for (let k = -4; k <= 4; k++) rad.add(at(mesh(box(0.056, 0.006, 0.2), M.dark()), 0, k * 0.032, 0));
    rad.rotation.z = -0.5;
    add(root, at(rad, 1.6, 0.4, s * 0.52), 'cooling', 'Radiator', [0, 0.35, s * 0.55]);
    const ic = mesh(box(0.25, 0.12, 0.12), M.rad());
    add(root, at(ic, 1.15, 0.33, s * 0.46), 'cooling', 'Charge-air cooler', [0, 0.3, s * 0.5]);
    if (s === 1) anchors.radiator = () => rad.getWorldPosition(new V3());
    // side impact structure poking through the pod's top (the RB22's signature)
    const sis = mesh(cyl(0.028, 0.028, 0.36, 12), M.carbon());
    sis.rotation.x = Math.PI / 2;
    add(root, at(sis, 1.9, 0.56, s * 0.55), 'chassis', 'Side impact structure', [0, 0.1, s * 0.75]);
    // the tubes end in red-orange caps beside the cockpit (seen in the garage photos)
    const sisCap = mesh(cyl(0.034, 0.034, 0.07, 14), new THREE.MeshStandardMaterial({color: '#e2541f', roughness: 0.5}));
    sisCap.rotation.x = Math.PI / 2;
    add(root, at(sisCap, 1.9, 0.56, s * 0.74), 'chassis', 'Side impact structure', [0, 0.1, s * 0.75]);
    if (s === 1) anchors.sis = () => sisCap.getWorldPosition(new V3());
  }

  // ============================================================ floor, diffuser, plank
  const floorShape = new THREE.Shape();
  floorShape.moveTo(2.85, 0.32);
  floorShape.lineTo(2.55, 0.66);
  floorShape.lineTo(0.35, 0.72);
  floorShape.lineTo(0.0, 0.52);
  floorShape.lineTo(0.0, -0.52);
  floorShape.lineTo(0.35, -0.72);
  floorShape.lineTo(2.55, -0.66);
  floorShape.lineTo(2.85, -0.32);
  floorShape.closePath();
  const floorG = new THREE.ExtrudeGeometry(floorShape, {depth: 0.018, bevelEnabled: false});
  floorG.rotateX(Math.PI / 2);
  const floor = mesh(floorG, M.carbon());
  add(root, at(floor, 0, 0.055, 0), 'aero', 'Floor', [0, -0.42, 0]);
  const plank = mesh(box(2.4, 0.01, 0.3), new THREE.MeshStandardMaterial({color: '#a88b62', roughness: 0.8}));
  add(root, at(plank, 1.45, 0.033, 0), 'aero', 'Plank', [0, -0.5, 0]);
  const diff = new THREE.Group();
  const dG = new THREE.PlaneGeometry(0.6, 1.0);
  const ramp = mesh(dG, M.carbon());
  ramp.material.side = THREE.DoubleSide;
  ramp.rotation.set(-Math.PI / 2, 0, 0);
  ramp.rotateY(0.42);
  ramp.position.set(-0.27, 0.18, 0);
  diff.add(ramp);
  for (const s of [1, -1]) {
    const wall = mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.05), new THREE.Vector2(-0.58, 0.32), new THREE.Vector2(-0.58, 0.05)])), M.carbon());
    wall.material.side = THREE.DoubleSide;
    wall.position.z = s * 0.5;
    diff.add(wall);
  }
  add(root, diff, 'aero', 'Diffuser', [-0.4, -0.25, 0]);
  anchors.floor = () => floor.localToWorld(new V3(1.6, 0, 0.6));
  anchors.diffuser = () => diff.localToWorld(new V3(-0.4, 0.2, 0));

  // ============================================================ front wing: mainplane, two active flaps, endplates
  const fw = new THREE.Group();
  fw.position.set(4.18, 0.09, 0);
  const fwMain = mesh(aerofoil(0.32, 1.56, 0.1, 0.05), M.carbon());
  fw.add(fwMain);
  const fwFlaps = [];
  [[0.17, -0.27, 0.055], [0.14, -0.39, 0.115]].forEach(([c, x, y]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x + c * 0.25, y, 0);
    const f = mesh(aerofoil(c, 1.46, 0.11, 0.07), M.wingAccent());
    f.position.x = c * 0.25;
    pivot.add(f);
    fw.add(pivot);
    fwFlaps.push(pivot);
  });
  for (const s of [1, -1]) {
    const ep = mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0.06, -0.06), new THREE.Vector2(-0.52, -0.06), new THREE.Vector2(-0.6, 0.2), new THREE.Vector2(-0.18, 0.16)])), M.carbon());
    ep.material.side = THREE.DoubleSide;
    ep.position.z = s * 0.78;
    fw.add(ep);
  }
  // supports from the nose
  fw.add(mesh(tube([-0.12, 0.03, 0.06], [-0.2, 0.2, 0.05], 0.01), M.carbon()));
  fw.add(mesh(tube([-0.12, 0.03, -0.06], [-0.2, 0.2, -0.05], 0.01), M.carbon()));
  add(root, fw, 'aero', 'Front wing', [0.75, -0.05, 0]);
  anchors.frontwing = () => fw.localToWorld(new V3(-0.3, 0.1, 0.55));

  // ============================================================ rear wing: three elements, endplates, swan neck
  const rw = new THREE.Group();
  rw.position.set(-0.3, 0.83, 0);
  const rwEls = [];
  [[0.24, 0, 0], [0.16, -0.2, 0.09], [0.13, -0.33, 0.165]].forEach(([c, x, y], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x + c * 0.3, y, 0);
    const e = mesh(aerofoil(c, 0.98, 0.12, 0.08), i ? M.wingAccent() : M.carbon());
    e.position.x = c * 0.3;
    pivot.add(e);
    rw.add(pivot);
    rwEls.push(pivot);
  });
  for (const s of [1, -1]) {
    const ep = mesh(box(0.62, 0.42, 0.012), M.carbon());
    ep.position.set(-0.24, 0.0, s * 0.5);
    rw.add(ep);
  }
  rw.add(mesh(tube([-0.1, 0.0, 0], [0.05, -0.38, 0], 0.016), M.carbon()));
  add(root, rw, 'aero', 'Rear wing', [-0.65, 0.4, 0]);
  anchors.rearwing = () => rw.localToWorld(new V3(-0.25, 0.15, 0.45));

  // ============================================================ power unit: V6, turbo, MGU-K, energy store, CE
  const pu = new THREE.Group();
  // crankcase and the two banks at 90°
  pu.add(at(mesh(box(0.62, 0.2, 0.3), M.dark()), 0.75, 0.22, 0));
  for (const s of [1, -1]) {
    const bank = new THREE.Group();
    bank.add(mesh(box(0.6, 0.26, 0.17), M.dark()));
    const camc = mesh(box(0.6, 0.05, 0.14), M.ti());
    camc.position.y = 0.155;
    bank.add(camc);
    bank.position.set(0.75, 0.38, s * 0.13);
    bank.rotation.x = s * (Math.PI / 4);
    pu.add(bank);
  }
  // inlet plenum in the vee
  pu.add(at(mesh(box(0.56, 0.08, 0.16), M.metal()), 0.75, 0.52, 0));
  const ice = pu;
  add(root, pu, 'pu', 'V6 engine', [0, 0.95, 0]);
  anchors.ice = () => pu.localToWorld(new V3(0.75, 0.5, 0.18));
  // turbocharger behind the engine: compressor and turbine on one shaft (no MGU-H in 2026)
  const turbo = new THREE.Group();
  turbo.position.set(0.32, 0.42, 0);
  const comp = mesh(new THREE.TorusGeometry(0.065, 0.035, 12, 28), M.metal());
  comp.rotation.y = Math.PI / 2;
  comp.position.x = 0.06;
  turbo.add(comp);
  const turb = mesh(new THREE.TorusGeometry(0.06, 0.032, 12, 28), M.copper());
  turb.rotation.y = Math.PI / 2;
  turb.position.x = -0.06;
  turbo.add(turb);
  const shaft = new THREE.Group();
  const sh = mesh(cyl(0.012, 0.012, 0.16, 10), M.metal());
  sh.rotation.z = Math.PI / 2;
  shaft.add(sh);
  for (let k = 0; k < 8; k++) {
    const blade = mesh(box(0.012, 0.05, 0.004), M.metal());
    blade.position.set(0.06, 0, 0);
    const holder = new THREE.Group();
    holder.rotation.x = (k / 8) * Math.PI * 2;
    blade.position.y = 0.03;
    holder.add(blade);
    shaft.add(holder);
  }
  turbo.add(shaft);
  add(root, turbo, 'pu', 'Turbocharger', [-0.1, 1.25, 0]);
  anchors.turbo = () => turbo.localToWorld(new V3(0, 0.05, 0));
  // exhaust from the turbine to the single tailpipe under the rear wing
  const exh = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0.26, 0.42, 0), new V3(0.0, 0.42, 0), new V3(-0.3, 0.4, 0), new V3(-0.42, 0.4, 0)]), 20, 0.035, 12), M.ti());
  add(root, exh, 'pu', 'Exhaust', [-0.1, 1.25, 0]);
  // MGU-K on the engine's left flank: 350 kW, glows amber deploying, cyan harvesting
  const mgukMat = M.copper();
  const mguk = new THREE.Group();
  const mg = mesh(cyl(0.075, 0.075, 0.2, 28), mgukMat);
  mg.rotation.z = Math.PI / 2;
  mguk.add(mg);
  for (const e of [-1, 1]) {
    const cap = mesh(cyl(0.078, 0.078, 0.02, 28), M.ti());
    cap.rotation.z = Math.PI / 2;
    cap.position.x = e * 0.11;
    mguk.add(cap);
  }
  add(root, at(mguk, 0.82, 0.19, 0.25), 'pu', 'MGU-K', [0.2, 0.55, 0.55]);
  anchors.mguk = () => mguk.getWorldPosition(new V3());
  // energy store under the fuel cell, and the control electronics beside it
  const es = mesh(box(0.42, 0.11, 0.56), M.batt());
  add(root, at(es, 1.3, 0.125, 0), 'pu', 'Energy store', [0, -0.15, 0.95]);
  anchors.battery = () => es.getWorldPosition(new V3());
  const ce = mesh(box(0.2, 0.08, 0.2), M.dark());
  add(root, at(ce, 1.0, 0.13, -0.25), 'pu', 'Control electronics', [0.2, -0.1, -0.75]);
  anchors.ce = () => ce.getWorldPosition(new V3());
  // gearbox: 8 forward speeds, the rear suspension hangs off its case
  const gbx = mesh(loft([
    {x: 0.45, y: 0.3, w: 0.28, h: 0.24, n: 3},
    {x: 0.1, y: 0.3, w: 0.24, h: 0.22, n: 3},
    {x: -0.25, y: 0.33, w: 0.16, h: 0.16, n: 3},
  ]), M.ti());
  add(root, gbx, 'pu', 'Gearbox', [-0.35, 0.5, 0]);
  anchors.gearbox = () => gbx.localToWorld(new V3(0.1, 0.42, 0));

  // ============================================================ wheels, uprights, brakes, suspension
  const wheels = [];
  const front = [WB, CAR.trackF / 2, CAR.frontTyreW];
  const rear = [0, CAR.trackR / 2, CAR.rearTyreW];
  for (const [x, zt, w] of [front, rear]) {
    for (const s of [1, -1]) {
      const isF = x > 0;
      const corner = new THREE.Group();     // steers (front)
      corner.position.set(x, R_WHEEL, s * zt);
      const spinner = new THREE.Group();    // turns with the wheel
      // tyre: a lathed rounded profile
      const prof = [];
      const r0 = 0.229;                     // 18-inch rim radius
      for (let k = 0; k <= 16; k++) {
        const a = -Math.PI / 2 + (k / 16) * Math.PI;
        prof.push(new THREE.Vector2(r0 + (R_WHEEL - r0) * (0.55 + 0.45 * Math.cos(a)), (w / 2) * Math.sin(a) * 0.98));
      }
      const tyreG = new THREE.LatheGeometry(prof, 48);
      tyreG.rotateX(Math.PI / 2);
      spinner.add(mesh(tyreG, M.tyre()));
      // compound stripe and sidewall marks: they show the wheel turning (fade out once it blurs)
      const stripeG = new THREE.RingGeometry(R_WHEEL - 0.05, R_WHEEL - 0.04, 48);
      const marks = [];
      for (const side of [1, -1]) {
        const st = mesh(stripeG, M.stripe());
        st.position.z = side * (w / 2 + 0.001);
        if (side < 0) st.rotation.y = Math.PI;
        spinner.add(st);
        for (let k = 0; k < 4; k++) {
          const mk = mesh(box(0.055, 0.012, 0.002), new THREE.MeshStandardMaterial({color: '#e8e8e8', roughness: 0.7, transparent: true}));
          const a = (k / 4) * Math.PI * 2;
          mk.position.set(Math.cos(a) * (R_WHEEL - 0.075), Math.sin(a) * (R_WHEEL - 0.075), side * (w / 2 + 0.003));
          mk.rotation.z = a + Math.PI / 2;
          spinner.add(mk);
          marks.push(mk);
        }
      }
      // rim with a wheel cover (2026 cars run covered rims)
      const rim = mesh(cyl(r0, r0, w * 0.9, 36), M.rim());
      rim.rotation.x = Math.PI / 2;
      spinner.add(rim);
      const coverG = new THREE.CircleGeometry(r0 * 0.98, 36);
      const wcov = mesh(coverG, M.rim());
      wcov.position.z = s * w * 0.46;
      if (s < 0) wcov.rotation.y = Math.PI;
      spinner.add(wcov);
      for (let k = 0; k < 5; k++) {
        const spoke = mesh(box(0.16, 0.022, 0.004), M.metal());
        const a = (k / 5) * Math.PI * 2;
        spoke.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, s * (w * 0.46 + 0.003));
        spoke.rotation.z = a;
        spinner.add(spoke);
        marks.push(spoke);
      }
      corner.add(spinner);
      // brake disc and caliper inside the rim (carbon-carbon, ~1,000 °C)
      const brake = new THREE.Group();
      const disc = mesh(cyl(0.165, 0.165, 0.032, 36), M.disc());
      disc.rotation.x = Math.PI / 2;
      disc.position.z = -s * w * 0.12;
      brake.add(disc);
      const cal = mesh(box(0.1, 0.12, 0.06), M.caliper());
      cal.position.set(isF ? -0.14 : 0.14, 0.04, -s * w * 0.12);
      brake.add(cal);
      corner.add(brake);
      // brake duct drum: the big silver housing round each brake (garage photos)
      const drum = mesh(cyl(0.2, 0.19, w * 0.42, 32, 1, true), new THREE.MeshStandardMaterial({color: '#c3c8ce', roughness: 0.35, metalness: 0.75, envMapIntensity: 0.6, side: THREE.DoubleSide}));
      drum.rotation.x = Math.PI / 2;
      drum.position.z = -s * w * 0.18;
      corner.add(drum);
      if (isF && s === 1) anchors.drum = () => drum.getWorldPosition(new V3());
      const upright = mesh(box(0.08, 0.3, 0.06), M.ti());
      upright.position.z = -s * (w / 2 + 0.03);
      corner.add(upright);
      add(root, corner, 'susp', isF ? 'Front wheel' : 'Rear wheel', [isF ? 0.25 : -0.25, 0, s * 0.95]);
      wheels.push({corner, spinner, isF, s, marks, disc});
      if (isF && s === 1) anchors.wheelF = () => corner.localToWorld(new V3(0, 0.1, s * w * 0.5));
      if (isF && s === 1) anchors.brake = () => corner.localToWorld(new V3(0, 0.0, -s * w * 0.12));
    }
  }
  // wishbones and push-rods: chassis/gearbox pickups to the uprights
  const suspFor = (x, zt, w, pickZ, pickYlo, pickYhi, isF) => {
    const g = new THREE.Group();
    for (const s of [1, -1]) {
      const zu = s * (zt - w / 2 - 0.05);
      const ul = [x, R_WHEEL + 0.13, zu];
      const ll = [x, R_WHEEL - 0.13, zu];
      g.add(mesh(tube([x - 0.22, pickYhi, s * pickZ], ul, 0.011), M.carbon()));
      g.add(mesh(tube([x + 0.18, pickYhi, s * pickZ], ul, 0.011), M.carbon()));
      g.add(mesh(tube([x - 0.24, pickYlo, s * pickZ], ll, 0.011), M.carbon()));
      g.add(mesh(tube([x + 0.2, pickYlo, s * pickZ], ll, 0.011), M.carbon()));
      // push-rod: from the bottom of the upright up to a rocker on top of the bulkhead / gearbox
      const rk = [x - 0.08, pickYhi + 0.09, s * 0.07];
      g.add(mesh(tube([x - 0.02, R_WHEEL - 0.1, zu * 0.97], rk, 0.013), M.metal()));
      g.add(at(mesh(box(0.09, 0.05, 0.07), M.ti()), ...rk));
      // track rod (front steers, rear toe link)
      g.add(mesh(tube([x + (isF ? 0.1 : -0.1), R_WHEEL + 0.02, s * pickZ], [x + (isF ? 0.1 : -0.1), R_WHEEL + 0.02, zu], 0.008), M.carbon()));
      // driveshaft at the rear
      if (!isF) g.add(mesh(tube([0, R_WHEEL, s * 0.13], [0, R_WHEEL, zu], 0.022), M.ti()));
    }
    return g;
  };
  const fs = suspFor(WB, CAR.trackF / 2, CAR.frontTyreW, 0.16, 0.25, 0.47, true);   // nearly flat, as on the car
  add(root, fs, 'susp', 'Front suspension', [0.15, 0, 0]);
  const rs = suspFor(0, CAR.trackR / 2, CAR.rearTyreW, 0.13, 0.24, 0.46, false);
  add(root, rs, 'susp', 'Rear suspension', [-0.15, 0, 0]);
  anchors.pushrod = () => fs.localToWorld(new V3(WB - 0.05, 0.42, 0.45));

  // ============================================================ the steering wheel, in the cockpit
  const sw = new THREE.Group();
  sw.position.set(2.39, 0.62, 0);   // where the real car's wheel sits
  sw.rotation.z = -0.35;          // leans back toward the dash
  const swBody = new THREE.Group();
  swBody.rotation.y = -Math.PI / 2;   // its face (+z) turned to the driver (-x)
  sw.add(swBody);
  const plate = mesh(new THREE.ExtrudeGeometry((() => {
    const p = new THREE.Shape();
    p.moveTo(-0.13, -0.06);
    p.lineTo(0.13, -0.06);
    p.quadraticCurveTo(0.16, -0.06, 0.16, -0.02);
    p.lineTo(0.15, 0.06);
    p.quadraticCurveTo(0.14, 0.085, 0.11, 0.085);
    p.lineTo(-0.11, 0.085);
    p.quadraticCurveTo(-0.14, 0.085, -0.15, 0.06);
    p.lineTo(-0.16, -0.02);
    p.quadraticCurveTo(-0.16, -0.06, -0.13, -0.06);
    return p;
  })(), {depth: 0.025, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2}), M.carbon());
  swBody.add(plate);
  for (const s of [1, -1]) {
    const grip = mesh(new THREE.CapsuleGeometry(0.03, 0.09, 6, 12), M.rubber());
    grip.position.set(s * 0.15, 0.0, 0.01);
    swBody.add(grip);
    // shift paddles behind (right: up, left: down)
    const paddle = mesh(box(0.07, 0.035, 0.006), M.ti());
    paddle.position.set(s * 0.09, 0.04, -0.02);
    swBody.add(paddle);
  }
  // the screen: a canvas the console redraws (gear, speed, battery, mode)
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 128;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({map: screenTex, toneMapped: false}));
  screen.position.set(0, 0.022, 0.0305);
  swBody.add(screen);
  // buttons that light: positions in the wheel's face plane, named for the panel
  const BTN = {
    straight: [-0.085, 0.055, '#3d8fe0'],
    boost: [0.085, 0.055, '#e7a10f'],
    overtake: [0.105, -0.02, '#d6182b'],
    recharge: [-0.105, -0.02, '#2fbf71'],
    radio: [-0.06, -0.04, '#ffffff'],
    limiter: [0.06, -0.04, '#ffffff'],
  };
  const lights = {};
  for (const [k, [x, y, col]] of Object.entries(BTN)) {
    const b = mesh(cyl(0.011, 0.011, 0.008, 16), new THREE.MeshStandardMaterial({color: '#2b2e33', emissive: col, emissiveIntensity: 0, roughness: 0.5}));
    b.rotation.x = Math.PI / 2;
    b.position.set(x, y, 0.031);
    swBody.add(b);
    lights[k] = b;
  }
  // rotary dials (brake balance, differential)
  for (const [x, y] of [[-0.035, -0.035], [0.035, -0.035]]) {
    const d = mesh(cyl(0.014, 0.014, 0.012, 16), M.ti());
    d.rotation.x = Math.PI / 2;
    d.position.set(x, y, 0.033);
    swBody.add(d);
  }
  add(root, sw, 'wheel', 'Steering wheel', [0.35, 0.75, 0]);
  anchors.steering = () => sw.localToWorld(new V3(0, 0, 0));

  // ============================================================ the real car (when loaded)
  // Model axes: nose along +z, up +y, rear axle at z = -1.70. Turned so the nose points down +x with the rear axle
  // at 0 like the drawn car. Its body hides the drawn car until something is taken apart or isolated.
  const realRoot = new THREE.Group();
  let realParts = null;
  if (real) {
    realRoot.rotation.y = Math.PI / 2;
    realRoot.position.set(1.7013, 0.032, 0);
    realRoot.add(real);
    root.add(realRoot);
    const body = real.getObjectByName('f1_2026_rb22') || real.children[0];
    const info = body.userData || {};
    const wheels = ['FL', 'FR', 'RL', 'RR'].map((q) => real.getObjectByName(`wheel_${q}`)).filter(Boolean);
    wheels.forEach((w) => (w.rotation.order = 'ZYX'));
    const steer = real.getObjectByName('steering_wheel');
    const axis = new V3(...(info.steering?.axis || [0, 0.86, -0.5])).normalize();
    const meshes = [];
    real.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        m.envMapIntensity = 0.8;
        m.side = THREE.FrontSide;
      });
      o.userData.base = o.material;
      o.userData.real = true;
      o.userData.inSteer = false;
      meshes.push(o);
    });
    steer?.traverse((o) => (o.userData.inSteer = true));
    // the wheel's own LCD shows the live screen
    let lcd = null;
    steer?.traverse((o) => {
      if (o.isMesh && /LCD/i.test(o.material?.name || '')) lcd = o;
    });
    realParts = {wheels, steer, axis, meshes, lcd, front: wheels.filter((w) => /F/.test(w.name.slice(-2, -1)))};
    anchors.realSteering = () => steer?.getWorldPosition(new V3());
  }
  const glassOf = new Map();
  const glass = (m, op) => {
    if (!glassOf.has(m)) {
      const g = m.clone();
      g.transparent = true;
      g.depthWrite = false;
      if (m.clippingPlanes) g.clippingPlanes = m.clippingPlanes;
      glassOf.set(m, g);
    }
    const g = glassOf.get(m);
    g.opacity = op;
    return g;
  };
  const qSteer = new THREE.Quaternion();

  // ============================================================ detailed parts (real 3D models when loaded)
  // Power unit and steering wheel: 3D models by Peter Kiss Design (CGTrader). The engine replaces the drawn V6, turbo,
  // exhaust, MGU-K, battery and electronics; its systems pull apart in the exploded view. The wheel replaces both the
  // drawn one and the car model's own, and carries the live screen.
  let eng = null;
  let pk = null;
  if (detail.engine) {
    const e = detail.engine;
    const sys = {};
    e.traverse((o) => {
      if (/^sys_/.test(o.name)) sys[o.name.slice(4)] = o;
      if (o.isMesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (/stickers/i.test(m.name) && m.map) {
            m.alphaTest = 0.5;
            m.transparent = false;
          }
          m.envMapIntensity = 0.7;
        }
      }
    });
    const holder = new THREE.Group();
    holder.add(e);
    holder.updateMatrixWorld(true);
    const ctr = (o) => new THREE.Box3().setFromObject(o).getCenter(new V3());
    // battery forward (+x), exhaust to the rear
    const dir = ctr(sys.electric_battery).sub(ctr(sys.exhaust_turbo));
    holder.rotation.y = Math.atan2(dir.z, dir.x);
    holder.updateMatrixWorld(true);
    let bb = new THREE.Box3().setFromObject(holder);
    const sc = 1.7 / (bb.max.x - bb.min.x);
    holder.scale.setScalar(sc);
    holder.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(holder);
    holder.position.set(1.55 - bb.max.x, 0.07 - bb.min.y, -(bb.min.z + bb.max.z) / 2);
    add(root, holder, 'pu', 'Power unit', [0, 0.12, 0]);
    holder.updateMatrixWorld(true);
    // each system's own pull-apart, in car directions (metres), converted into its parent's space
    const SPREAD = {carbon_outside_parts: [0, 0.6, 0], covers: [0, 0.95, 0], exhaust_turbo: [-0.55, 0.25, 0], shape_parts_turbo: [-0.55, 0.25, 0],
      electric_motor: [0.1, -0.05, 0.6], electric_invertor: [0.1, -0.05, -0.6], electric_battery: [0.65, -0.1, 0], engine_block: [0, 0, 0]};
    const moves = [];
    for (const [k, o] of Object.entries(sys)) {
      const w = new V3(...(SPREAD[k] || [0, 0, 0]));
      const inv = new THREE.Matrix4().copy(o.parent.matrixWorld).invert();
      const a = new V3(0, 0, 0).applyMatrix4(inv);
      const b = w.clone().applyMatrix4(inv);
      moves.push({o, home: o.position.clone(), d: b.sub(a)});
    }
    const motorMats = [];
    sys.electric_motor?.traverse((o) => {
      if (!o.isMesh) return;
      o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const c = m.clone();
        motorMats.push(c);
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
      o.userData.base = o.material;
    });
    eng = {holder, sys, moves, motorMats};
    const at = (k) => () => sys[k] && new THREE.Box3().setFromObject(sys[k]).getCenter(new V3());
    anchors.ice = at('engine_block');
    anchors.turbo = at('exhaust_turbo');
    anchors.mguk = at('electric_motor');
    anchors.battery = at('electric_battery');
    anchors.ce = at('electric_invertor');
    for (const p of parts) if (/^(V6 engine|Turbocharger|Exhaust|MGU-K|Energy store|Control electronics)$/.test(p.name)) p.obj.traverse((o) => (o.userData.replaced = true));
  }
  // the front wing and nose from CAD (CATIA STEP): x runs forward from the nose bulkhead (at our front axle line).
  // Its two flaps per side hinge along their own leading edges (hinge_axis in the model) for straight / corner mode.
  // The car model's own nose and wing ahead of the front wheels are clipped away so the two don't overlap.
  let fwing = null;
  const noseClip = new THREE.Plane(new V3(-1, 0, 0), 3.66);
  const noseClipW = new THREE.Plane();
  if (detail.frontwing) {
    const f = detail.frontwing;
    f.rotation.y = Math.PI;
    f.position.x = WB;
    const flaps = [];
    f.traverse((o) => {
      if (o.userData?.hinge_axis) flaps.push({o, base: o.quaternion.clone(), axis: new V3(...o.userData.hinge_axis).normalize(), k: /flap1/.test(o.name) ? 0.2 : 0.3, sign: /L$/.test(o.name) ? 1 : -1});
      if (o.isMesh) {
        o.material.side = THREE.DoubleSide;
        o.material.envMapIntensity = 0.7;
      }
    });
    const g = new THREE.Group();
    g.add(f);
    add(root, g, 'aero', 'Front wing (detailed)', [0.8, -0.05, 0]);
    g.traverse((o) => o.isMesh && (o.userData.frontwing = true));
    fwing = {g, flaps};
    anchors.frontwing = () => new THREE.Box3().setFromObject(g).getCenter(new V3());
    for (const p of parts) if (p.name === 'Front wing') p.obj.traverse((o) => (o.userData.replaced = true));
    if (realParts) {
      const wheelMesh = new Set();
      realParts.wheels.forEach((w) => w.traverse((o) => o.isMesh && wheelMesh.add(o)));
      for (const m of realParts.meshes) {
        if (wheelMesh.has(m) || m.userData.inSteer) continue;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.clippingPlanes = [noseClipW];
        m.userData.clip = true;
      }
    }
  }

  // the floor from CAD (CATIA STEP): x runs back from the front axle, so turn it round onto ours
  if (detail.floor) {
    const f = detail.floor;
    f.rotation.y = Math.PI;
    f.position.x = WB;
    f.traverse((o) => {
      if (!o.isMesh) return;
      o.material.side = THREE.DoubleSide;
      o.material.envMapIntensity = 0.6;
    });
    const fg = new THREE.Group();
    fg.add(f);
    add(root, fg, 'aero', 'Floor (detailed)', [0, -0.55, 0]);
    anchors.floor = () => new THREE.Box3().setFromObject(fg).getCenter(new V3());
    for (const p of parts) if (/^(Floor|Plank|Diffuser)$/.test(p.name)) p.obj.traverse((o) => (o.userData.replaced = true));
  }
  if (detail.wheel && realParts?.steer) {
    const w = detail.wheel;
    real.updateMatrixWorld(true);
    const pos = realParts.steer.getWorldPosition(new V3()).sub(root.position);
    const ax = realParts.axis.clone().transformDirection(realParts.steer.parent.matrixWorld);
    if (ax.x < 0) ax.negate();             // the column points forward, into the dash
    const yA = new V3(0, 1, 0).addScaledVector(ax, -ax.y).normalize();
    const xA = new V3().crossVectors(yA, ax);
    const pivot = new THREE.Group();
    pivot.position.copy(pos);
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, ax));
    const spinG = new THREE.Group();
    const c = new THREE.Box3().setFromObject(w).getCenter(new V3());
    w.position.sub(c);
    spinG.add(w);
    spinG.scale.setScalar(0.88);
    pivot.add(spinG);
    w.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'live_screen' || /live_screen/.test(o.material?.name || '')) o.material = new THREE.MeshBasicMaterial({map: screenTex, toneMapped: false});
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (/stickers/i.test(m.name || '') && m.map) {
          m.alphaTest = 0.4;
          m.transparent = false;
        }
      }
    });
    add(root, pivot, 'wheel', 'Steering wheel (detailed)', [0.35, 0.75, 0]);
    pivot.traverse((o) => o.isMesh && (o.userData.always = true));
    sw.traverse((o) => (o.userData.replaced = true));
    for (const m of realParts.meshes) if (m.userData.inSteer) m.userData.hideReal = true;
    pk = {pivot, spinG};
    anchors.realSteering = () => pivot.getWorldPosition(new V3());
    anchors.steering = anchors.realSteering;
  }

  // ============================================================ posing
  const tmp = new V3();
  // ghost material per original material, made once
  const ghostOf = new Map();
  const ghost = (m) => {
    if (!ghostOf.has(m)) {
      const g = m.clone();
      g.transparent = true;
      g.opacity = 0.07;
      g.depthWrite = false;
      ghostOf.set(m, g);
    }
    return ghostOf.get(m);
  };
  const cool = new THREE.Color('#2fd0e0');
  const warm = new THREE.Color('#ff9a1f');
  const update = (s, ops = {}) => {
    const ex = ops.explode ?? 0;
    const k = ex * ex * (3 - 2 * ex);
    // ride: squat with downforce, pitch under braking/acceleration, roll in corners (lifted off when exploded)
    root.position.y = s.heave * (1 - k) + 0.0;
    root.rotation.z = -(s.pitch * Math.PI / 180) * (1 - k);
    root.rotation.x = (s.roll * Math.PI / 180) * (1 - k);
    for (const p of parts) p.obj.position.copy(tmp.copy(p.home).addScaledVector(p.ex, k));
    // wheels: spin from the distance, front pair steer
    const blur = Math.min(1, Math.max(0, (s.kmh - 25) / 60));
    for (const w of wheels) {
      // in the garage the wheels come off: the brake drums and uprights stay
      w.spinner.visible = !((ops.garage ?? 0) > 0.5 && (ops.explode ?? 0) < 0.5);
      w.spinner.rotation.z = -s.spin;
      if (w.isF) w.corner.rotation.y = s.steer;
      for (const mk of w.marks) {
        mk.visible = blur < 0.98 || ops.still;
        if (mk.material.transparent) mk.material.opacity = 1 - blur * 0.85;
      }
      // carbon discs glow under heavy braking
      w.disc.material.emissive.set('#ff4a12');
      w.disc.material.emissiveIntensity = s.brk ? 0.55 * Math.min(1, s.kmh / 200) : 0;
    }
    // active aero: corner mode (wings closed, flaps steep) ↔ straight mode (flaps flattened)
    const f = s.flap;
    fwFlaps[0].rotation.z = 0.32 - 0.24 * f;
    fwFlaps[1].rotation.z = 0.58 - 0.42 * f;
    rwEls[0].rotation.z = 0.08 - 0.06 * f;
    rwEls[1].rotation.z = 0.38 - 0.3 * f;
    rwEls[2].rotation.z = 0.7 - 0.6 * f;
    // turbo spins with engine speed (shown slowed: the real shaft reaches 150,000 rpm)
    shaft.rotation.x = s.spin * 0.9;
    // MGU-K: amber while deploying, cyan while harvesting
    const e = Math.min(1, Math.abs(s.kw) / 350);
    mgukMat.emissive.copy(s.kw >= 0 ? warm : cool);
    mgukMat.emissiveIntensity = 0.85 * e;
    if (fwing) for (const fl of fwing.flaps) fl.o.quaternion.copy(fl.base).premultiply(new THREE.Quaternion().setFromAxisAngle(fl.axis, FLAP_DIR * fl.sign * fl.k * s.flap));
    if (eng) {
      for (const m of eng.motorMats) {
        m.emissive = m.emissive || new THREE.Color();
        m.emissive.copy(s.kw >= 0 ? warm : cool);
        m.emissiveIntensity = 0.55 * e;
      }
      for (const mv of eng.moves) mv.o.position.copy(mv.home).addScaledVector(mv.d, k);
    }
    // steering wheel: turns with the lap, buttons light with what the car is doing
    swBody.rotation.z = -s.wheelDeg * Math.PI / 180;
    lights.straight.material.emissiveIntensity = s.flap > 0.5 ? 0.9 : 0;
    lights.boost.material.emissiveIntensity = s.energy === 'deploy' ? 0.5 + 0.4 * e : 0;
    lights.recharge.material.emissiveIntensity = ['harvest', 'superclip', 'lift'].includes(s.energy) ? 0.9 * Math.max(0.4, e) : 0;
    lights.overtake.material.emissiveIntensity = 0;
    lights.radio.material.emissiveIntensity = 0;
    lights.limiter.material.emissiveIntensity = 0;
    if (ops.drawScreen) {
      ops.drawScreen(screenCanvas.getContext('2d'), s);
      screenTex.needsUpdate = true;
    }
    // isolate: everything outside the chosen system turns to glass
    // With the real car loaded: assembled it is the real car alone. Taking it apart lifts the real body away and
    // fades it, showing the drawn internals. Isolating a system turns the real car to glass and shows that system.
    const solo = ops.solo || null;
    const R = !!realParts;
    // garage: the real car's covers lifted off, everything inside left where it sits
    const gk = ops.garage ?? 0;
    const lift = Math.max(k, gk * gk * (3 - 2 * gk));
    const realSolid = R && lift < 0.02 && (!solo || solo === 'chassis');
    const drawn = !R || lift > 0.02 || (solo && solo !== 'chassis' && !(solo === 'wheel' && realParts.steer));
    const COVERS = /^(Engine cover|Airbox inlet|Engine cover fin|Sidepod|Sidepod inlet)$/;
    // over the real car only these drawn parts appear (no real model of them yet); bodywork, wheels, floor and the
    // drawn chassis never do. The moving wing flaps show when aero is isolated.
    const KEEP = /^(Fuel cell|Radiator|Charge-air cooler|Gearbox)$/;
    const keepOverReal = (o) => {
      const part = o.userData.part || '';
      if (o.userData.sys === 'pu' && !o.userData.replaced) return true;
      if (KEEP.test(part)) return true;
      if (/^(Front wing|Rear wing)$/.test(part)) return solo === 'aero';
      if (part === 'Floor (detailed)') return solo === 'aero' || k > 0.5;
      if (/suspension/.test(part)) return solo === 'susp' || (gk > 0.5 && k < 0.5);
      return false;
    };
    root.traverse((o) => {
      if (!o.isMesh || !o.userData.base || o.userData.real) return;
      const on = !solo || o.userData.sys === solo;
      o.material = on ? o.userData.base : ghost(o.userData.base);
      o.castShadow = on && drawn;
      // the steering wheel sits deep in the cockpit: for its close-up everything else steps out of the way
      let vis = on || solo !== 'wheel';
      // over the real car, only the isolated system is drawn (the real car is its glass)
      if (R && lift <= 0.02 && solo) vis = on;
      if (gk > 0.5 && k < 0.5 && COVERS.test(o.userData.part || '')) vis = false;
      o.visible = drawn && vis;
      if (R) o.visible = (lift > 0.02 || !!solo) && keepOverReal(o) && (!solo || on);
      if (o.userData.replaced) o.visible = false;
      if (o.userData.frontwing && R) {
        o.visible = !solo || solo === 'aero';
        o.material = o.userData.base;
      }
      if (o.userData.always) {
        o.visible = !solo || solo === 'wheel';
        o.material = o.userData.base;
      }
    });
    if (R) {
      // the real car is the base: covers off turns it to glass where it stands; exploded lifts the glass body up
      realRoot.position.y = 0.032 + 1.45 * k;
      const op = realSolid ? 1 : solo === 'wheel' ? 0 : solo ? 0.16 : Math.max(0.16, 1 - lift * 1.6);
      for (const m of realParts.meshes) {
        const keepSteer = solo === 'wheel' && m.userData.inSteer && lift <= 0.02;
        m.visible = (op > 0.01 || keepSteer) && !m.userData.hideReal;
        if (keepSteer || op >= 0.999) {
          m.material = m.userData.base;
          m.castShadow = true;
        } else {
          m.material = Array.isArray(m.userData.base) ? m.userData.base.map((b) => glass(b, op)) : glass(m.userData.base, op);
          m.castShadow = false;
        }
      }
      for (const w of realParts.wheels) {
        w.rotation.x = s.spin;
        w.rotation.z = realParts.front.includes(w) ? -s.steer : 0;
      }
      if (realParts.steer) {
        qSteer.setFromAxisAngle(realParts.axis, (s.wheelDeg * Math.PI) / 180);
        realParts.steer.quaternion.copy(qSteer);
      }
      if (pk) pk.spinG.rotation.z = -(s.wheelDeg * Math.PI) / 180;
      if (fwing) {
        root.updateWorldMatrix(true, false);
        noseClipW.copy(noseClip).applyMatrix4(root.matrixWorld);
      }
      if (realParts.lcd && realParts.lcd.material.map !== screenTex) {
        const m = realParts.lcd.material.clone();
        m.map = screenTex;
        m.emissive = new THREE.Color('#ffffff');
        m.emissiveMap = screenTex;
        m.emissiveIntensity = 0.9;
        realParts.lcd.material = m;
        realParts.lcd.userData.base = m;
      }
    }
  };
  const anchor = (name) => (anchors[name] ? anchors[name]() : null);
  void ice;
  return {root, parts, update, anchor, wheels, real: !!realParts, BUTTONS: Object.keys(BTN)};
}
