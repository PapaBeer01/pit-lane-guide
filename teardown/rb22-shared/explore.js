// The 2026 F1 car explorer: the real RB22 model as an example of this season's cars, to spin, zoom and take apart.
// Phone-first and responsive (unlike the fixed 1600 x 900 console): drag to turn, pinch or scroll to zoom, tap the
// numbered dots to learn what each part does. Three build states (car, covers off, exploded), a "drive a lap" switch
// that runs a real qualifying lap through the car (wheels, steering, energy, active aero), and a steering wheel guide
// on a photo of a real F1 wheel with every control tappable.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {warmComposer} from 'teardown-kit/warm.js';
import {drawScreen} from './console.js';
import {LAP_TIME, stateAt} from './kin.js';
import {buildTrack, poseOnTrack} from './track.js';
import CIRCUIT from './circuit.json';
import {createStage, loadDetail, loadReal} from './stage.js';

// ------------------------------------------------------------ what each dot explains (general to all 2026 cars)
const SPOTS = {
  car: [
    ['frontwing', 'Front wing', 'The first part to meet the air: it decides how air flows round the rest of the car. In 2026 its two top flaps flatten on the straights and close again for corners.', {focus: 1}],
    ['rearwing', 'Rear wing', 'Pushes the rear tyres into the track. Its flaps open on straights to cut drag. This "straight mode" replaced DRS in 2026, and every driver can use it in marked zones.', {focus: 1}],
    ['halo', 'Halo', 'The titanium hoop over the driver’s head, compulsory since 2018. It can take the weight of a double-decker bus.', {photo: ['front-end', 50, 30]}],
    ['airbox', 'Airbox', 'The opening above the driver’s head that feeds air to the engine.', {photo: ['engine-bay', 55, 30]}],
    ['radiator', 'Sidepods', 'They hold the radiators that cool the engine, battery and electronics. Their shape is where the teams’ cars look most different.', {}],
    ['floor', 'Floor', 'Much of the grip comes from air rushing under the car. 2026 floors are flatter, so cars make less downforce and can follow each other more closely.', {}],
    ['wheelF', 'Tyres', 'Pirelli tyres on 18-inch wheels, about 70 cm tall and a little narrower in 2026. Soft, medium and hard for the dry; intermediate and wet for rain.', {}],
    ['realSteering', 'Steering wheel', 'Around 25 buttons and dials. Tap below to go through every one.', {wheel: 1, photo: ['steering-wheel', 50, 45]}],
  ],
  garage: [
    ['pushrod', 'Push-rod suspension', 'Each wheel hangs on two wishbones. A push-rod carries the load up to springs and dampers on top of the chassis.', {photo: ['front-end', 28, 55]}],
    ['drum', 'Brakes', 'Carbon discs glow at around 1,000 °C under the big silver ducts. At the rear, the electric motor does much of the slowing too.', {photo: ['rear-corner', 36, 58]}],
    ['sis', 'Side-impact tubes', 'Crash structures either side of the cockpit that protect the driver in a side hit.', {photo: ['front-end', 72, 58]}],
    ['radiator', 'Radiators', 'Hot water and oil pass through these; air from the sidepod inlets carries the heat away.', {}],
    ['ice', 'Engine', 'Behind the driver: the 1.6-litre V6 turbo. Every 2026 team uses the same size of engine.', {photo: ['engine-bay', 40, 55]}],
  ],
  exploded: [
    ['ice', 'V6 engine', '1.6 litres, six cylinders in two banks, a turbo, up to 15,000 rpm and about 400 kW, running on 100% sustainable fuel.', {solo: 'pu'}],
    ['mguk', 'MGU-K', 'An electric motor-generator on the drivetrain. It adds up to 350 kW (almost half the car’s power in 2026) and recharges the battery under braking.', {solo: 'pu', drive: 1}],
    ['battery', 'Battery', 'The energy store under the fuel tank. Up to 8.5 MJ can be harvested every lap.', {solo: 'pu'}],
    ['turbo', 'Turbocharger', 'Exhaust gas spins a turbine that squeezes more air into the engine. The extra generator on the turbo (MGU-H) was dropped for 2026.', {solo: 'pu'}],
    ['gearbox', 'Gearbox', 'Eight forward gears and one reverse; changes take a few thousandths of a second.', {}],
    ['fuel', 'Fuel tank', 'A tough rubber bag behind the driver holding around 100 kg of fuel. No refuelling during races.', {}],
    ['floor', 'Floor', 'Built from a real CAD model: about 3.4 m long and 1.4 m wide. Much of the grip comes from air rushing under it; 2026 floors are flatter, so cars make less downforce and can follow more closely.', {}],
    ['ce', 'Inverter and electronics', 'Turns the battery\u2019s direct current into the alternating current the MGU-K runs on, and manages the whole hybrid system.', {solo: 'pu'}],
  ],
};
// the steering wheel guide: positions in % of the photo (a real F1 wheel; layouts differ by team)
const WHEEL = [
  [49.7, 33, 'Screen', 'Gear, speed, lap times, battery level, warnings. The driver flicks between pages.'],
  [49.7, 24.2, 'Shift lights', 'Light up as revs rise: all lit means change gear.'],
  [21.1, 28.1, 'N', 'Neutral: takes the car out of gear, for example after a spin.'],
  [78.1, 28.1, 'PIT', 'Pit-lane speed limiter: keeps the car at exactly the pit-lane limit.'],
  [30.5, 37.2, 'RADIO', 'Talk to the race engineer on the pit wall.'],
  [69.3, 37.3, 'FAIL', 'Handles a failed sensor or part: switches to a back-up setting.'],
  [27.3, 30.6, '−10', 'Quick adjust: steps the selected setting down.'],
  [72.1, 30.5, '+1', 'Quick adjust: steps the selected setting up.'],
  [31.7, 46.9, 'BB−', 'Brake balance one step to the rear.'],
  [68, 46.9, 'BB+', 'Brake balance one step to the front.'],
  [68, 51.9, 'REV', 'Reverse gear: every car must have one.'],
  [41.4, 50.1, 'TYRE', 'Tells the car which tyres are fitted, so the electronics adjust.'],
  [58, 50.1, 'STRAT', 'Strategy setting, including the pit-stop mode.'],
  [36.9, 60.7, 'ENGINE', 'Power-unit settings: how hard to push the engine.'],
  [50, 58.7, 'DISP', 'Picks what the screen shows.'],
  [63, 60.6, 'MODE', 'Overall mode: START, RACE, extra push (+, ++), qualifying (Q+), or saving.'],
  [24.8, 44, 'BBAL', 'Thumb wheel for fine brake balance.'],
  [75.6, 44, 'MID', 'Differential in mid-corner: how freely the rear wheels turn at different speeds.'],
  [13.5, 28.5, 'DIFF', 'Differential on corner entry.'],
  [86.5, 28.5, 'TORQ', 'Torque setting: how power comes in on exit.'],
];

const CSS = `
:root{--ink:#16181b;--ink2:#4b5058;--mute:#7a8088;--line:rgba(22,24,27,.1);--acc:#d6182b;--blue:#2f7fd8;--amber:#e98a00;--cyan:#12a8c0;--green:#1f9e5a}
html,body{margin:0;height:100%;background:#ecedef;overflow:hidden;font-family:"Bricolage Grotesque",Inter,system-ui,sans-serif;color:var(--ink);-webkit-tap-highlight-color:transparent}
#app{position:fixed;inset:0}
#gl{position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block}
.xbar{position:absolute;left:12px;right:12px;top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;pointer-events:none}
.xbar>*{pointer-events:auto}
.seg{display:flex;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:12px;padding:3px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.seg button{border:0;background:transparent;font:600 14px/1 inherit;font-family:inherit;color:var(--ink2);padding:9px 12px;border-radius:9px;cursor:pointer;min-height:36px}
.seg button[aria-pressed=true]{background:var(--ink);color:#fff}
.chip{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:12px;padding:6px 10px 6px 6px;font:600 14px/1 inherit;font-family:inherit;color:var(--ink);cursor:pointer;min-height:36px}
.chip i{width:26px;height:26px;border-radius:8px;background:var(--acc);display:grid;place-items:center;color:#fff;font-style:normal;font-size:12px}
.xhud{color:#16181b;position:absolute;left:12px;bottom:12px;display:none;gap:12px;align-items:flex-end;background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:14px;padding:10px 12px;font-variant-numeric:tabular-nums;max-width:calc(100% - 24px);flex-wrap:wrap}
.xhud.on{display:flex}
.xhud b{font:800 28px/1 "Bricolage Display",inherit}
.xhud small{display:block;color:var(--mute);font-size:11px;margin-top:3px}
.xhud .meter{width:84px;height:6px;background:#e3e4e7;border-radius:3px;overflow:hidden;margin-top:6px}
.xhud .meter i{display:block;height:100%;background:var(--green)}
.pin{position:absolute;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2px solid #fff;background:var(--acc);color:#fff;font:700 13px/26px inherit;font-family:inherit;text-align:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25);transition:opacity .2s,transform .15s;padding:0}
.pin:hover,.pin.on{transform:scale(1.15)}
.pin.on{background:var(--ink)}
.sheet{color:#16181b;position:absolute;left:12px;right:12px;bottom:12px;max-width:420px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 16px 14px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
.sheet.on{display:block;animation:up .22s cubic-bezier(.22,1,.36,1)}
@keyframes up{from{opacity:0;transform:translateY(8px)}}
.sheet h2{color:#16181b;margin:0 0 6px;font:800 22px/1.1 "Bricolage Display",inherit}
.sheet .ph{margin:0 0 10px;position:relative}.sheet .ph img{width:100%;height:130px;object-fit:cover;border-radius:10px;display:block}.sheet .ph figcaption{position:absolute;left:8px;bottom:8px;background:rgba(22,24,27,.75);color:#fff;font-size:11px;padding:3px 7px;border-radius:6px}
.sheet p{margin:0 0 12px;color:var(--ink2);font-size:15px;line-height:1.45}
.sheet .xrow{display:flex;gap:8px;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:#f4f5f6;color:var(--ink);font:600 14px/1 inherit;font-family:inherit;padding:10px 12px;border-radius:10px;cursor:pointer}
.btn.pri{background:var(--ink);color:#fff;border-color:var(--ink)}
.x{position:absolute;right:10px;top:10px;width:32px;height:32px;border-radius:50%;border:0;background:#f1f2f4;cursor:pointer;font-size:16px}
.hint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:rgba(22,24,27,.82);color:#fff;font-size:13px;padding:8px 12px;border-radius:999px;white-space:nowrap;pointer-events:none;transition:opacity .4s}
.credit{position:absolute;right:10px;bottom:6px;font-size:10px;color:var(--mute);text-decoration:none}
.wheel{position:fixed;inset:0;background:rgba(236,237,239,.98);display:none;overflow:auto;z-index:20}
.wheel.on{display:block}
.wheel .in{max-width:760px;margin:0 auto;padding:16px}
.wheel h2{font:800 26px/1.1 "Bricolage Display",inherit;margin:4px 0 4px}
.wheel .lede{color:var(--ink2);margin:0 0 12px;font-size:15px}
.wpic{position:relative}
.wpic img{width:100%;height:auto;display:block;border-radius:16px}
.wdot{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:2.5px solid #d6182b;background:rgba(255,255,255,.18);cursor:pointer;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.wdot.on{border-color:#16181b;background:rgba(22,24,27,.25);transform:scale(1.25)}
.winfo{min-height:72px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:12px}
.winfo b{font:800 18px/1.2 "Bricolage Display",inherit;display:block;margin-bottom:4px}
.winfo span{color:var(--ink2)}
.load{position:fixed;inset:0;display:grid;place-items:center;background:#ecedef;z-index:30}
.load div{width:min(320px,80vw);display:grid;gap:10px;text-align:center}
.load b{font:800 20px/1.2 "Bricolage Display",inherit}
.load .t{height:6px;background:#d9dbdf;border-radius:3px;overflow:hidden}
.load .t i{display:block;height:100%;width:0;background:var(--acc);transition:width .2s}
.load span{color:var(--ink2)}
@media (max-width:560px){.seg button{padding:9px 9px;font-size:13px}.sheet{max-width:none}.xhud b{font-size:24px}}
`;

const el = (tag, attrs = {}, html = '') => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};

export async function runExplore() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = 'Inside a 2026 F1 car | The Pit Lane';
  const app = document.getElementById('app');

  // ------------------------------------------------------------ loading the car (~6.8 MB: car, engine, steering wheel)
  const TOTAL = 6.8e6;
  const load = el('div', {class: 'load'}, '<div><b>Wheeling the car into the garage</b><div class="t"><i></i></div><span>Loading the 3D car: 0 of 6.8 MB</span></div>');
  document.body.appendChild(load);
  const got = {car: 0, parts: 0};
  const show = () => {
    const b = got.car + got.parts;
    load.querySelector('i').style.width = `${Math.min(100, Math.round((b / TOTAL) * 100))}%`;
    load.querySelector('span').textContent = `Loading the 3D car: ${(b / 1e6).toFixed(1)} of 6.8 MB`;
  };
  const [real, detail] = await Promise.all([
    loadReal((k, bytes) => { got.car = bytes; show(); }),
    loadDetail((bytes) => { got.parts = Math.max(got.parts, bytes); show(); }),
  ]);
  load.querySelector('span').textContent = 'Warming up';

  const canvas = el('canvas', {id: 'gl', 'aria-label': '3D model of a 2026 F1 car: drag to turn, pinch to zoom'});
  app.appendChild(canvas);
  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  const st = createStage({canvas, lo: light, real, detail});
  if (light) st.setQuality({samples: 0, ao: false, shadow: 1024});
  const cam = st.camera;
  cam.fov = 32;
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(1.75, 0.4, 0);
  const upright = innerWidth < innerHeight;
  cam.position.set(1.75 + (upright ? 7.0 : 6.2), upright ? 3.0 : 2.6, upright ? 6.3 : 5.6);
  const fit = () => {
    const w = app.clientWidth;
    const h = app.clientHeight;
    st.resize(w, h, Math.min(devicePixelRatio || 1, light ? 1.5 : 2));
    // a phone held upright sees the whole car from further back
    cam.fov = w < h ? 48 : 32;
    cam.updateProjectionMatrix();
  };
  fit();
  addEventListener('resize', fit);

  // ------------------------------------------------------------ the chrome
  const bar = el('div', {class: 'xbar'});
  const seg = el('div', {class: 'seg', role: 'group', 'aria-label': 'Take the car apart'});
  const MODES = [['car', 'Car'], ['garage', 'Covers off'], ['exploded', 'Exploded']];
  for (const [k, t] of MODES) seg.appendChild(el('button', {type: 'button', 'data-k': k, 'aria-pressed': k === 'car'}, t));
  const drive = el('button', {class: 'chip', type: 'button', 'aria-pressed': 'false'}, '<i>▶</i><span>Drive a lap</span>');
  const wheelBtn = el('button', {class: 'chip', type: 'button'}, '<i>◎</i><span>Steering wheel</span>');
  // on track: chase, onboard or helicopter camera
  const camSeg = el('div', {class: 'seg', role: 'group', 'aria-label': 'Camera', style: 'display:none'});
  for (const [k, t] of [['chase', 'Chase'], ['onboard', 'Onboard'], ['heli', 'Helicopter']]) camSeg.appendChild(el('button', {type: 'button', 'data-k': k, 'aria-pressed': k === 'chase'}, t));
  bar.append(seg, drive, wheelBtn, camSeg);
  const hud = el('div', {class: 'xhud', 'aria-live': 'off'});
  const sheet = el('div', {class: 'sheet', role: 'dialog', 'aria-live': 'polite'});
  const hint = el('div', {class: 'hint'}, 'Drag to turn · pinch to zoom · tap a dot');
  const credit = el('a', {class: 'credit', href: 'https://skfb.ly/pOvxI', target: '_blank', rel: 'noopener'}, 'Car: “2026 Redbull RB22” by Dave Love (CC BY 4.0) · engine and steering wheel: Peter Kiss Design');
  app.append(bar, hud, sheet, hint, credit);
  setTimeout(() => (hint.style.opacity = '0'), 6000);

  // ------------------------------------------------------------ state
  let mode = 'car';
  let ex = 0;
  let ga = 0;
  let solo = null;
  let driving = false;
  let lapT = 2;
  let focus = null;          // camera target the view glides to
  let pinsFor = null;
  let pins = [];
  let active = null;
  const setMode = (k) => {
    mode = k;
    solo = null;
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    closeSheet();
    const up = app.clientWidth < app.clientHeight;
    focus = {t: new THREE.Vector3(1.75, k === 'exploded' ? 0.55 : 0.4, 0), d: (k === 'exploded' ? 8.5 : 8) * (up ? 1.2 : 1)};
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setMode(b.dataset.k);
  });
  // ------------------------------------------------------------ the circuit (built once, the first time it's needed)
  let track = null;
  let trackCam = 'chase';
  const studio = {bg: st.scene.background, far: cam.far};
  const mount = new THREE.Group();
  st.scene.add(mount);
  st.scene.remove(st.car.root);
  mount.add(st.car.root);
  const shade = st.scene.children.find((o) => o.material?.isShadowMaterial);
  camSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    trackCam = b.dataset.k;
    camSeg.querySelectorAll('button').forEach((n) => n.setAttribute('aria-pressed', String(n === b)));
  });
  const onTrack = () => driving && mode === 'car' && !solo;
  window.EXPLORE = {st, cam, mount, get track() { return track; }, seek: (t) => (lapT = t)};
  let wasOnTrack = false;
  const camDir = new THREE.Vector3(1, 0, 0);
  const enterTrack = (on) => {
    if (on && !track) {
      track = buildTrack(CIRCUIT.corners || []);
      st.scene.add(track.group);
    }
    if (on) camDir.copy(poseOnTrack(track.cl, stateAt(lapT).dist).t);
    if (track) track.group.visible = on;
    if (shade) shade.visible = !on;
    if (on && !studio.sky) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#7fa6cf');
      gr.addColorStop(0.6, '#c3d5e6');
      gr.addColorStop(1, '#dfe6ec');
      g.fillStyle = gr;
      g.fillRect(0, 0, 4, 256);
      studio.sky = new THREE.CanvasTexture(c);
      studio.sky.colorSpace = THREE.SRGBColorSpace;
    }
    st.scene.background = on ? studio.sky : studio.bg;
    st.scene.fog = on ? new THREE.Fog('#dfe6ec', 150, 1100) : null;
    cam.far = on ? 1500 : studio.far;
    cam.near = on ? 0.3 : 0.05;
    cam.updateProjectionMatrix();
    controls.enabled = !on;
    camSeg.style.display = on ? '' : 'none';
    pins.forEach((p) => (p.el.style.display = on ? 'none' : ''));
    Object.assign(st.sun.shadow.camera, on ? {left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 120} : {left: -4.2, right: 4.2, top: 4.2, bottom: -4.2, near: 1, far: 20});
    st.sun.shadow.camera.updateProjectionMatrix();
    if (!on) {
      mount.position.set(0, 0, 0);
      mount.rotation.set(0, 0, 0);
      st.sun.position.set(-2.5, 7, 3.5);
      st.sun.target.position.set(1.7, 0, 0);
      controls.target.set(1.75, 0.4, 0);
      cam.position.set(1.75 + 6.2, 2.6, 5.6);
    }
    wasOnTrack = on;
  };
  drive.addEventListener('click', () => {
    if (!driving && mode === 'car') closeSheet();
    driving = !driving;
    drive.setAttribute('aria-pressed', String(driving));
    drive.querySelector('i').textContent = driving ? '❚❚' : '▶';
    drive.querySelector('span').textContent = driving ? 'Stop' : 'Drive a lap';
    hud.classList.toggle('on', driving);
  });

  // ------------------------------------------------------------ dots on the car
  const buildPins = () => {
    pins.forEach((p) => p.el.remove());
    pins = SPOTS[mode].map(([anchor, title, text, opts], i) => {
      const b = el('button', {class: 'pin', type: 'button', 'aria-label': title}, String(i + 1));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openSheet(i);
      });
      app.insertBefore(b, bar);
      return {el: b, anchor, title, text, opts};
    });
    pinsFor = mode;
  };
  const closeSheet = () => {
    sheet.classList.remove('on');
    if (active !== null) pins[active]?.el.classList.remove('on');
    active = null;
    if (mode !== 'exploded') solo = null;
  };
  const openSheet = (i) => {
    if (active !== null) pins[active]?.el.classList.remove('on');
    active = i;
    const p = pins[i];
    p.el.classList.add('on');
    const acts = [];
    if (p.opts.wheel) acts.push('<button class="btn pri" data-a="wheel">Go through the buttons</button>');
    if (p.opts.solo && solo !== p.opts.solo) acts.push(`<button class="btn" data-a="solo">Show only the power unit</button>`);
    if (p.opts.drive && !driving) acts.push('<button class="btn" data-a="drive">Watch it work on a lap</button>');
    if (p.opts.focus) acts.push('<button class="btn" data-a="drive">Watch the flaps move</button>');
    const ph = p.opts.photo ? `<figure class="ph"><img src="photos/${p.opts.photo[0]}.webp" alt="${p.title} on a real 2026 car" style="object-position:${p.opts.photo[1]}% ${p.opts.photo[2]}%"><figcaption>On the real car</figcaption></figure>` : '';
    sheet.innerHTML = `<button class="x" aria-label="Close">✕</button><h2>${p.title}</h2>${ph}<p>${p.text}</p><div class="xrow">${acts.join('')}</div>`;
    sheet.classList.add('on');
    sheet.querySelector('.x').onclick = closeSheet;
    sheet.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'wheel') openWheel();
      if (a === 'solo') solo = p.opts.solo;
      if (a === 'drive' && !driving) drive.click();
      if (a === 'drive' && p.opts.focus) {
        // jump to the main straight where the wings open
        lapT = 1;
        solo = 'aero';   // the real car turns to glass; the moving flaps show inside it
      }
      b.remove();
    }));
    const at = st.car.anchor(p.anchor);
    if (at) focus = {t: at, d: Math.max(2.4, Math.min(6, cam.position.distanceTo(controls.target) * 0.7))};
  };

  // ------------------------------------------------------------ the steering wheel guide
  const wheel = el('div', {class: 'wheel', role: 'dialog', 'aria-label': 'Steering wheel guide'});
  wheel.innerHTML = `<div class="in"><button class="x" aria-label="Close" style="position:sticky;float:right;top:8px">✕</button>
    <h2>The steering wheel</h2><p class="lede">A real F1 wheel. Tap any button or dial. Every team lays theirs out differently; 2026 wheels also carry controls for straight mode, boost and overtake.</p>
    <div class="wpic"><img src="photos/steering-wheel.webp" alt="A Formula 1 steering wheel with its screen, buttons and rotary dials" width="1400" height="1399"></div>
    <div class="winfo"><b>Tap a red ring</b><span>Each one explains a button, dial or light.</span></div></div>`;
  document.body.appendChild(wheel);
  const pic = wheel.querySelector('.wpic');
  const info = wheel.querySelector('.winfo');
  WHEEL.forEach(([x, y, t, d]) => {
    const b = el('button', {class: 'wdot', type: 'button', 'aria-label': t});
    b.style.left = `${x}%`;
    b.style.top = `${y}%`;
    b.onclick = () => {
      pic.querySelectorAll('.wdot').forEach((n) => n.classList.remove('on'));
      b.classList.add('on');
      info.innerHTML = `<b>${t}</b><span>${d}</span>`;
    };
    pic.appendChild(b);
  });
  const openWheel = () => wheel.classList.add('on');
  wheel.querySelector('.x').onclick = () => wheel.classList.remove('on');
  wheelBtn.addEventListener('click', openWheel);

  // ------------------------------------------------------------ the frame
  const proj = new THREE.Vector3();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (driving) lapT = (lapT + dt) % LAP_TIME;
    const s = stateAt(lapT);
    ex += ((mode === 'exploded' ? 1 : 0) - ex) * (1 - Math.exp(-dt / 0.4));
    ga += ((mode === 'garage' ? 1 : 0) - ga) * (1 - Math.exp(-dt / 0.4));
    if (focus) {
      const k = 1 - Math.exp(-dt / 0.35);
      controls.target.lerp(focus.t, k);
      const dir = cam.position.clone().sub(controls.target);
      const dist = dir.length();
      dir.setLength(dist + (focus.d - dist) * k);
      cam.position.copy(controls.target).add(dir);
      if (controls.target.distanceTo(focus.t) < 0.01 && Math.abs(dist - focus.d) < 0.02) focus = null;
    }
    const tr = onTrack();
    if (tr !== wasOnTrack) enterTrack(tr);
    if (tr) {
      const pose = poseOnTrack(track.cl, s.dist);
      // the car's origin is its rear axle: put the middle of the car on the line
      mount.position.copy(pose.p).addScaledVector(pose.t, -1.7);
      mount.rotation.y = pose.yaw;
      const up = new THREE.Vector3(0, 1, 0);
      // the camera rides with the car; only its direction is smoothed, so it swings gently through corners
      camDir.lerp(pose.t, trackCam === 'onboard' ? 1 : 1 - Math.exp(-dt / 0.35)).normalize();
      let back = 9.5;
      let high = 3.2;
      let ahead = 7;
      if (trackCam === 'onboard') [back, high, ahead] = [0.3, 1.3, 30];   // the T-cam on top of the airbox
      if (trackCam === 'heli') [back, high, ahead] = [26, 32, 10];
      cam.position.copy(pose.p).addScaledVector(camDir, -back).addScaledVector(up, high);
      controls.target.copy(pose.p).addScaledVector(camDir, ahead).addScaledVector(up, trackCam === 'onboard' ? 0.5 : 0.6);
      cam.lookAt(controls.target);
      st.sun.position.copy(pose.p).add(new THREE.Vector3(-25, 60, 35));
      st.sun.target.position.copy(pose.p);
      st.sun.target.updateMatrixWorld();
    } else controls.update();
    st.draw(s, {explode: ex, garage: ga, solo, drawScreen, still: !driving});
    if (pinsFor !== mode && Math.abs((mode === 'exploded' ? 1 : 0) - ex) < 0.05) buildPins();
    // dots follow their parts; hidden behind the camera
    for (const p of tr ? [] : pins) {
      const at = st.car.anchor(p.anchor);
      if (!at) {
        p.el.style.opacity = '0';
        continue;
      }
      proj.copy(at).project(cam);
      const vis = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
      p.el.style.opacity = vis ? '1' : '0';
      p.el.style.pointerEvents = vis ? 'auto' : 'none';
      p.el.style.transform = `translate(${((proj.x + 1) / 2) * app.clientWidth}px, ${((1 - proj.y) / 2) * app.clientHeight}px)`;
    }
    if (driving) {
      const e = {deploy: ['Deploying', 'var(--amber)'], harvest: ['Harvesting', 'var(--cyan)'], superclip: ['Super clipping', 'var(--cyan)'], lift: ['Lift-off regen', 'var(--cyan)'], neutral: ['Holding', 'var(--mute)']}[s.energy];
      hud.innerHTML = `<div><b>${Math.round(s.kmh)}</b><small>km/h · gear ${s.gear}</small></div>
        <div><b style="font-size:16px;color:${s.flap > 0.5 ? 'var(--blue)' : 'var(--ink)'}">${s.flap > 0.5 ? 'Straight mode' : 'Corner mode'}</b><small>active aero</small></div>
        <div><b style="font-size:16px;color:${e[1]}">${e[0]}</b><small>electric motor ${s.kw > 0 ? '+' : ''}${Math.round(s.kw)} kW</small></div>
        <div><small style="margin:0">battery ${s.soc.toFixed(1)} MJ</small><div class="meter"><i style="width:${(s.soc / 4) * 100}%"></i></div></div>`;
    }
    requestAnimationFrame(frame);
  };
  setMode('car');
  await warmComposer(st.renderer, st.composer, st.scene, st.camera);
  load.remove();
  requestAnimationFrame(frame);
}
