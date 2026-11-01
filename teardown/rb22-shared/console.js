// The RB22 teardown's overlay. Fixed 1600 x 900 CSS layout over the car: title and speed top left, the lap map and
// power flow down the left, transport bottom left; active aero, the speed trace and the system card down the right;
// camera / teardown / system buttons bottom right; callouts with thin leaders into the car. update(s) redraws every
// live part from the frame's lap state, so nothing on screen can disagree with the car.
import {LAP_D, LAP_TIME, PU, SOURCE, TRACE, deployCap} from './kin.js';

export const C = {ink: '#16181b', mute: '#80858c', faint: '#c9ccd0', line: '#e1e3e6', panel: 'rgba(248,248,249,.95)', red: '#d6182b', blue: '#2f7fd8', amber: '#e98a00', cyan: '#12a8c0', green: '#1f9e5a'};
export const CAMS = ['hero', 'side', 'top', 'front', 'rear', 'cockpit'];
export const BUILD = ['assembled', 'garage', 'exploded'];
export const SYS = ['all', 'aero', 'pu', 'chassis', 'cooling', 'susp', 'wheel'];
const SYS_LABEL = {all: 'WHOLE CAR', aero: 'AERO', pu: 'POWER UNIT', chassis: 'CHASSIS', cooling: 'COOLING', susp: 'SUSPENSION', wheel: 'STEERING WHEEL'};

// what each system is, in a few honest lines (sources: 2026 FIA rules, Red Bull's RB22 page, launch analysis)
export const CARDS = {
  garage: ['In the garage', 'Covers off, the way the mechanics see it between sessions: wheels off, bodywork lifted, everything inside still bolted in place.', ['Push-rods run up to rockers on top of the chassis', 'Big silver drums duct air to the brakes', 'Side-impact tubes with red caps beside the cockpit']],
  all: ['The RB22', 'Red Bull’s 2026 car: the first with its own engine, built with Ford. Narrower, shorter and about 30 kg lighter than 2025 cars, with wings that move.', ['3,400 mm wheelbase · 1,900 mm wide', '768 kg minimum with driver', 'Push-rod suspension front and rear']],
  aero: ['Active aerodynamics', 'Both wings have flaps that flatten on the straights (straight mode) and close for corners. No DRS: every driver can use it, in marked zones.', ['Front wing: 2 moving flaps', 'Rear wing: 3 moving elements', 'Flatter floor: much less ground effect']],
  pu: ['Red Bull Ford DM01', 'A 1.6 L V6 turbo plus an electric motor-generator that now makes almost half the power. No MGU-H any more.', ['ICE ≈ 400 kW · MGU-K 350 kW', '15,000 rpm limit · 90° V · 24 valves', 'Up to 8.5 MJ harvested a lap']],
  chassis: ['Survival cell & bodywork', 'The carbon tub protects the driver and holds the fuel. The RB22’s sidepods are tightly wrapped, with the side-impact tube showing through.', ['Halo: titanium, takes ~12 t', 'Fuel cell behind the driver', 'Large airbox above the head']],
  cooling: ['Cooling', 'Radiators in the sidepods take heat from the engine, the battery and the charge air. Bigger electrics in 2026 means more heat to shed.', ['Radiators angled in each pod', 'Charge-air coolers for the turbo', 'Hot air out over the engine cover']],
  susp: ['Suspension & brakes', 'Wishbones hold each wheel; a push-rod carries the load up to springs and dampers inside the car. Carbon brakes glow at about 1,000 °C.', ['Push-rod front and rear', '18-inch wheels, 706 mm tyres', 'Rear brakes share work with the MGU-K']],
  wheel: ['Steering wheel', 'The driver runs the car from here: active aero, energy modes, radio, pit limiter. The screen shows gear, speed and battery.', ['Illustrative layout: real one isn’t public', 'Turns ≈ 12× the front wheels (est.)', 'Paddles: right up, left down']],
};
// the steering wheel's lit buttons, with what lights them
export const WHEEL_KEYS = [
  ['straight', 'STRAIGHT MODE', C.blue, 'Opens both wings in a marked zone'],
  ['boost', 'BOOST', C.amber, 'Full electric deployment on demand'],
  ['recharge', 'RECHARGE', C.green, 'Harvest map: braking, lift-off, clipping'],
  ['overtake', 'OVERTAKE', C.red, '+0.5 MJ when within 1 s of the car ahead'],
  ['radio', 'RADIO', '#8b8f95', 'Talk to the engineer'],
  ['limiter', 'PIT LIMITER', '#8b8f95', 'Holds pit-lane speed'],
];

const CSS = `
#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.ui{position:absolute;inset:0;pointer-events:none}
.pn{position:absolute;background:${C.panel};border:1px solid ${C.line};box-shadow:0 1px 2px rgba(20,22,26,.04)}
.cp{font-size:9.6px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap}
.mu{color:${C.mute}}
.tb{position:absolute;height:20px;padding:0 7px;display:flex;align-items:center;justify-content:center;font-size:8.8px;font-weight:600;letter-spacing:.9px;text-transform:uppercase;border:1px solid ${C.line};background:#fff;color:${C.ink};white-space:nowrap}
.tb.on{background:${C.ink};color:#fff;border-color:${C.ink}}
.call{position:absolute;white-space:nowrap}
.call b{display:block;font-size:11.5px;font-weight:600}
.call span{display:block;font-size:8.6px;font-weight:500;letter-spacing:1.4px;color:${C.mute};text-transform:uppercase;margin-top:2px}
.cur{position:absolute;left:0;top:0;z-index:50;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.ring{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid ${C.red};opacity:0;z-index:49}
.bar{position:absolute;height:7px;background:#e6e7e9}
.bar i{position:absolute;top:0;bottom:0;display:block}
.facts{font-size:10.5px;line-height:1.5;color:${C.ink}}
.facts li{list-style:none;padding-left:11px;position:relative}
.facts li:before{content:'';position:absolute;left:0;top:7px;width:5px;height:2px;background:${C.red}}
.wk{display:flex;align-items:center;gap:8px;height:22px;font-size:9.4px;font-weight:600;letter-spacing:1px}
.wk i{width:11px;height:11px;border-radius:50%;border:1.5px solid currentColor;flex:none;transition:background .15s}
.wk small{display:block;font-weight:500;letter-spacing:.3px;color:${C.mute};font-size:9px;text-transform:none}
`;
const el = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h.trim();
  return d.firstElementChild;
};
const fmt = (n, d = 0) => n.toLocaleString('en-GB', {minimumFractionDigits: d, maximumFractionDigits: d});

export function createConsole(app) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const ui = el(`<div class="ui"></div>`);
  app.appendChild(ui);
  const add = (h) => {
    const n = el(h);
    ui.appendChild(n);
    return n;
  };
  const btn = {};
  const spots = {};

  // ------------------------------------------------------------ title, speed, gear
  add(`<div style="position:absolute;left:35px;top:33px;width:43px;height:3px;background:${C.red}"></div>`);
  add(`<div style="position:absolute;left:35px;top:42px;font-size:30px;font-weight:800;letter-spacing:0;font-family:'Bricolage Display',Inter,sans-serif">RB22 <span style="color:${C.red}">·</span> Teardown</div>`);
  add(`<div class="cp" style="position:absolute;left:35px;top:81px;font-weight:500;font-size:9.2px;letter-spacing:1.5px">RED BULL FORD DM01 &nbsp;•&nbsp; 1.6 L V6 TURBO + 350 kW MGU-K &nbsp;•&nbsp; 2026 RULES</div>`);
  const kmh = add(`<div style="position:absolute;left:33px;top:100px;font-size:62px;font-weight:800;letter-spacing:-1px;font-family:'Bricolage Display',Inter,sans-serif;color:${C.red};line-height:1"></div>`);
  add(`<div class="cp" style="position:absolute;left:36px;top:160px;font-weight:500">KM/H</div>`);
  const gear = add(`<div style="position:absolute;left:190px;top:100px;width:56px;height:56px;border:1.5px solid ${C.ink};display:grid;place-items:center;font-size:34px;font-weight:800"></div>`);
  add(`<div class="cp" style="position:absolute;left:190px;top:160px;font-weight:500">GEAR</div>`);
  const rpm = add(`<div class="cp mu" style="position:absolute;left:35px;top:178px;font-weight:500;font-size:9px"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:35px;top:196px;font-size:8.6px;font-weight:500">THROTTLE</div>`);
  add(`<div class="bar" style="left:98px;top:198px;width:184px"></div>`);
  const thr = add(`<div style="position:absolute;left:98px;top:198px;height:7px;background:${C.green}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:35px;top:212px;font-size:8.6px;font-weight:500">BRAKE</div>`);
  add(`<div class="bar" style="left:98px;top:214px;width:184px"></div>`);
  const brk = add(`<div style="position:absolute;left:98px;top:214px;height:7px;background:${C.red}"></div>`);

  // ------------------------------------------------------------ the lap map
  add(`<div class="pn" style="left:35px;top:240px;width:247px;height:212px"></div>`);
  add(`<div class="cp" style="position:absolute;left:46px;top:252px;font-weight:700">THE LAP</div>`);
  const lapT = add(`<div class="cp mu" style="position:absolute;right:${1600 - 271}px;top:252px;font-weight:500"></div>`);
  const xs = TRACE.map((r) => r[5]);
  const ys = TRACE.map((r) => r[6]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sc = Math.min(210 / (x1 - x0), 130 / (y1 - y0));
  const mx = (x) => 113 - ((x0 + x1) / 2 - x) * sc;
  const my = (y) => 72 + ((y0 + y1) / 2 - y) * sc;
  let segs = '';
  for (let i = 0; i < TRACE.length; i++) {
    const a = TRACE[i];
    const b = TRACE[(i + 1) % TRACE.length];
    segs += `<line x1="${mx(a[5]).toFixed(1)}" y1="${my(a[6]).toFixed(1)}" x2="${mx(b[5]).toFixed(1)}" y2="${my(b[6]).toFixed(1)}" stroke="${a[4] ? C.blue : C.ink}" stroke-width="${a[4] ? 3 : 2}" stroke-linecap="round"/>`;
  }
  add(`<svg style="position:absolute;left:46px;top:268px" width="226" height="148">${segs}</svg>`);
  const dot = add(`<div style="position:absolute;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:${C.red};border:2px solid #fff;box-shadow:0 0 0 1px ${C.red}"></div>`);
  add(`<div style="position:absolute;left:46px;top:420px;font-size:9.4px;color:${C.mute};line-height:1.35;width:226px;white-space:normal"><b style="color:${C.blue}">Blue</b>: straight-mode zones on this lap. Verstappen, Mexico City qualifying, 1:16.692</div>`);

  // ------------------------------------------------------------ power flow and the battery
  add(`<div class="pn" style="left:35px;top:460px;width:247px;height:250px"></div>`);
  add(`<div class="cp" style="position:absolute;left:46px;top:472px;font-weight:700">POWER</div>`);
  const eState = add(`<div class="cp" style="position:absolute;right:${1600 - 271}px;top:472px;font-weight:700"></div>`);
  const row = (y, label) => {
    add(`<div class="cp mu" style="position:absolute;left:46px;top:${y}px;font-weight:500;font-size:9px">${label}</div>`);
    const v = add(`<div class="cp" style="position:absolute;right:${1600 - 271}px;top:${y}px;font-weight:700;font-size:9.4px"></div>`);
    add(`<div class="bar" style="left:46px;top:${y + 16}px;width:225px"></div>`);
    return v;
  };
  const iceV = row(494, 'ENGINE (ICE, est.)');
  const iceF = add(`<div style="position:absolute;left:46px;top:510px;height:7px;background:${C.ink}"></div>`);
  const kV = row(530, 'MGU-K  ← harvest · deploy →');
  add(`<div style="position:absolute;left:158px;top:543px;width:1px;height:13px;background:${C.ink}"></div>`);
  const kF = add(`<div style="position:absolute;top:546px;height:7px"></div>`);
  const totV = add(`<div style="position:absolute;left:46px;top:566px;font-size:30px;font-weight:800;letter-spacing:-1.2px;line-height:1"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:46px;top:598px;font-weight:500;font-size:8.6px">kW TO THE REAR WHEELS (est.)</div>`);
  const socV = row(618, 'BATTERY  (4 MJ WINDOW)');
  const socF = add(`<div style="position:absolute;left:46px;top:634px;height:7px;background:${C.green}"></div>`);
  const harvV = row(654, 'HARVESTED THIS LAP');
  const harvF = add(`<div style="position:absolute;left:46px;top:670px;height:7px;background:${C.cyan}"></div>`);
  add(`<div style="position:absolute;left:46px;top:684px;font-size:9px;color:${C.mute}">Deploy tapers above 290 km/h: ≈ 1800 − 5·v kW</div>`);

  // ------------------------------------------------------------ transport
  add(`<div class="pn" style="left:35px;top:774px;width:259px;height:111px"></div>`);
  btn.pause = add(`<div class="tb" style="left:45px;top:782px;width:99px;height:26px;background:${C.red};color:#fff;border-color:${C.red};font-size:9.6px"></div>`);
  btn.back = add(`<div class="tb" style="left:149px;top:782px;width:66px;height:26px;font-size:9.6px">−1 S</div>`);
  btn.fwd = add(`<div class="tb" style="left:219px;top:782px;width:66px;height:26px;font-size:9.6px">+1 S</div>`);
  add(`<div class="cp" style="position:absolute;left:45px;top:818px;font-weight:500">LAP</div>`);
  const lapVal = add(`<div class="cp" style="position:absolute;right:${1600 - 284}px;top:818px;font-weight:700"></div>`);
  const SL = {x: 46, w: 238};
  add(`<div style="position:absolute;left:${SL.x}px;top:836px;width:${SL.w}px;height:2px;background:#e1e3e6"></div>`);
  const lapKnob = add(`<div style="position:absolute;top:831px;width:9px;height:11px;margin-left:-4.5px;background:${C.red}"></div>`);
  add(`<div class="cp" style="position:absolute;left:45px;top:851px;font-weight:500">PLAYBACK</div>`);
  const playVal = add(`<div class="cp" style="position:absolute;right:${1600 - 284}px;top:851px;font-weight:700"></div>`);
  add(`<div style="position:absolute;left:${SL.x}px;top:869px;width:${SL.w}px;height:2px;background:#e1e3e6"></div>`);
  const playKnob = add(`<div style="position:absolute;top:864px;width:9px;height:11px;margin-left:-4.5px;background:${C.red}"></div>`);

  // ------------------------------------------------------------ active aero
  add(`<div class="pn" style="left:1318px;top:36px;width:245px;height:176px"></div>`);
  add(`<div class="cp" style="position:absolute;left:1329px;top:47px;font-weight:700">ACTIVE AERO</div>`);
  add(`<div class="cp mu" style="position:absolute;right:${1600 - 1552}px;top:47px;font-weight:500">BOTH WINGS</div>`);
  const mode = add(`<div style="position:absolute;left:1329px;top:61px;font-size:27px;font-weight:800;font-family:'Bricolage Display',Inter,sans-serif"></div>`);
  const modeSub = add(`<div style="position:absolute;left:1329px;top:94px;font-size:9.6px;color:${C.mute};width:222px;white-space:normal;line-height:1.35"></div>`);
  const wings = add(`<svg style="position:absolute;left:1329px;top:126px" width="222" height="78"></svg>`);

  // ------------------------------------------------------------ speed trace
  add(`<div class="pn" style="left:1318px;top:220px;width:245px;height:170px"></div>`);
  add(`<div class="cp" style="position:absolute;left:1329px;top:231px;font-weight:700">SPEED TRACE</div>`);
  add(`<div class="cp mu" style="position:absolute;right:${1600 - 1552}px;top:231px;font-weight:500">DRAG TO SCRUB</div>`);
  const TR = {x: 1329, y: 250, w: 222, h: 120};
  const tx = (d) => (d / LAP_D) * TR.w;
  const ty = (v) => TR.h - 14 - ((v - 50) / 310) * (TR.h - 24);
  let tp = '';
  let zones = '';
  let brakes = '';
  TRACE.forEach((r, i) => {
    tp += `${i ? 'L' : 'M'}${tx(r[0]).toFixed(1)} ${ty(r[1]).toFixed(1)}`;
    if (r[4]) zones += `<rect x="${tx(r[0]).toFixed(1)}" y="0" width="${(TR.w * 10 / LAP_D + 0.4).toFixed(1)}" height="${TR.h - 12}" fill="${C.blue}" opacity=".12"/>`;
    if (r[3]) brakes += `<rect x="${tx(r[0]).toFixed(1)}" y="${TR.h - 8}" width="${(TR.w * 10 / LAP_D + 0.4).toFixed(1)}" height="5" fill="${C.red}"/>`;
  });
  add(`<svg style="position:absolute;left:${TR.x}px;top:${TR.y}px" width="${TR.w}" height="${TR.h}">${zones}${brakes}
    <path d="${tp}" fill="none" stroke="${C.ink}" stroke-width="1.4"/>
    ${[100, 200, 300].map((v) => `<text x="${TR.w - 2}" y="${ty(v) - 2}" font-size="8" fill="${C.mute}" text-anchor="end" font-family="JetBrains Mono">${v}</text>`).join('')}</svg>`);
  const cursorLine = add(`<div style="position:absolute;top:${TR.y}px;width:1.5px;height:${TR.h - 12}px;background:${C.red}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:1329px;top:372px;font-size:8.4px;font-weight:500"><i style="display:inline-block;width:10px;height:5px;background:${C.red};margin-right:4px"></i>BRAKING &nbsp;<i style="display:inline-block;width:10px;height:7px;background:${C.blue};opacity:.3;margin-right:4px"></i>STRAIGHT MODE</div>`);

  // ------------------------------------------------------------ the system card (or the steering wheel guide)
  add(`<div class="pn" style="left:1318px;top:398px;width:245px;height:294px"></div>`);
  const cardK = add(`<div class="cp mu" style="position:absolute;left:1329px;top:410px;font-weight:500"></div>`);
  const cardT = add(`<div style="position:absolute;left:1329px;top:426px;font-size:17px;font-weight:800;width:224px;white-space:normal;line-height:1.15"></div>`);
  const cardB = add(`<div style="position:absolute;left:1329px;top:452px;width:224px;font-size:10.5px;line-height:1.5;white-space:normal"></div>`);
  const cardL = add(`<ul class="facts" style="position:absolute;left:1329px;top:560px;width:224px;margin:0;padding:0"></ul>`);
  const wheelList = add(`<div style="position:absolute;left:1329px;top:528px;width:224px;display:none"></div>`);
  const wk = {};
  for (const [k, name, col, sub] of WHEEL_KEYS) {
    const r = el(`<div class="wk" style="color:${col}"><i></i><div style="color:${C.ink}">${name}<small>${sub}</small></div></div>`);
    r.style.height = '27px';
    wheelList.appendChild(r);
    wk[k] = {dot: r.querySelector('i'), col};
  }

  // ------------------------------------------------------------ camera, teardown, systems
  add(`<div class="pn" style="left:1296px;top:700px;width:268px;height:185px"></div>`);
  const group = (title, keys, y, labels) => {
    add(`<div class="cp mu" style="position:absolute;left:1305px;top:${y}px;font-weight:500">${title}</div>`);
    let x = 1305;
    let yy = y + 15;
    keys.forEach((k) => {
      const w = Math.round(labels[k].length * 6.2 + 14);
      if (x + w > 1556) {
        x = 1305;
        yy += 23;
      }
      btn[k] = add(`<div class="tb" style="left:${x}px;top:${yy}px;width:${w}px">${labels[k]}</div>`);
      spots[k] = [x + w / 2, yy + 10];
      x += w + 4;
    });
    return yy;
  };
  const L = {...Object.fromEntries([...CAMS, ...BUILD].map((k) => [k, k.toUpperCase()])), ...SYS_LABEL};
  group('CAMERA', CAMS, 707, L);
  group('TEARDOWN', BUILD, 772, L);
  group('SYSTEMS', SYS, 814, L);
  spots.pause = [94, 795];

  // ------------------------------------------------------------ callouts
  const callLayer = add(`<div style="position:absolute;inset:0"></div>`);
  const leaders = add(`<svg style="position:absolute;left:0;top:0;overflow:visible" width="1600" height="900"></svg>`);
  add(`<div class="cp mu" style="position:absolute;left:800px;top:878px;transform:translateX(-50%);font-size:8.4px;font-weight:500">DRAG TO ORBIT · SCROLL TO ZOOM · H HIDES THE PANELS · ${SOURCE.split(' (')[0].toUpperCase()}</div>`);
  // the 3D model's licence (CC BY 4.0) asks for this credit wherever it's shown
  add(`<a href="https://skfb.ly/pOvxI" target="_blank" rel="noopener" style="position:absolute;left:800px;top:864px;transform:translateX(-50%);font-size:8.4px;color:${C.mute};pointer-events:auto;white-space:nowrap">Car model: “2026 Redbull RB22” by Dave Love (Sketchfab), CC BY 4.0</a>`);
  const cur = add(`<svg class="cur" width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 20 L7 15.5 L10.5 23 L13.5 21.6 L10 14.5 L17 14.5 Z" fill="#fff" stroke="#16181b" stroke-width="1.5" stroke-linejoin="round"/></svg>`);
  const ring = add(`<div class="ring"></div>`);

  const lapKnobAt = (k) => [SL.x + k * SL.w, 836];
  const playKnobAt = (k) => [SL.x + k * SL.w, 869];

  // ------------------------------------------------------------ redraw from one frame's state
  const set = (n, v) => {
    if (n._v !== v) {
      n._v = v;
      n.innerHTML = v;
    }
  };
  const update = (s, o) => {
    set(kmh, fmt(s.kmh));
    set(gear, String(s.gear));
    set(rpm, `≈ ${fmt(Math.round(s.rpm / 50) * 50)} RPM (est.) &nbsp;·&nbsp; ${s.glong >= 0 ? '+' : ''}${s.glong.toFixed(1)} G LONG &nbsp;·&nbsp; ${Math.abs(s.glat).toFixed(1)} G LAT`);
    thr.style.width = `${(184 * s.thr) / 100}px`;
    brk.style.width = `${184 * s.brk}px`;
    set(lapT, `${s.lapT.toFixed(1)} / ${LAP_TIME.toFixed(1)} S`);
    dot.style.left = `${46 + mx(s.x)}px`;
    dot.style.top = `${268 + my(s.y)}px`;
    // power
    const st = {deploy: ['DEPLOYING', C.amber], harvest: ['HARVESTING · BRAKES', C.cyan], superclip: ['SUPER CLIPPING', C.cyan], lift: ['LIFT-OFF REGEN', C.cyan], neutral: ['HOLDING', C.mute]}[s.energy];
    set(eState, `<span style="color:${st[1]}">${st[0]}</span>`);
    set(iceV, `${fmt(s.ice)} kW`);
    iceF.style.width = `${(225 * s.ice) / PU.ice}px`;
    set(kV, `${s.kw > 0 ? '+' : ''}${fmt(s.kw)} kW`);
    const kw = Math.max(-350, Math.min(350, s.kw));
    kF.style.left = `${kw >= 0 ? 158 : 158 + (112 * kw) / 350}px`;
    kF.style.width = `${(112 * Math.abs(kw)) / 350}px`;
    kF.style.background = kw >= 0 ? C.amber : C.cyan;
    set(totV, `${fmt(Math.max(0, s.ice + Math.max(0, s.kw)))} <span style="font-size:13px;font-weight:600;letter-spacing:0">kW</span>`);
    set(socV, `${s.soc.toFixed(2)} MJ`);
    socF.style.width = `${(225 * s.soc) / PU.battMJ}px`;
    set(harvV, `${s.harvested.toFixed(2)} / ${PU.harvestMJ} MJ`);
    harvF.style.width = `${(225 * Math.min(1, s.harvested / PU.harvestMJ))}px`;
    // aero
    const open = s.flap > 0.5;
    set(mode, `<span style="color:${open ? C.blue : C.ink}">${open ? 'STRAIGHT MODE' : 'CORNER MODE'}</span>`);
    set(modeSub, open ? `Flaps flattened: less drag, more top speed. MGU-K can give ${fmt(deployCap(s.kmh))} kW at this speed.` : s.brk ? 'Closed for braking: full downforce for the corner.' : 'Wings closed: full downforce for grip in the corners.');
    const wing = (cx, cy, angles, label) => {
      let g = `<text x="${cx - 30}" y="${cy + 30}" font-size="8" fill="${C.mute}" font-family="Inter" letter-spacing="1.2">${label}</text>`;
      angles.forEach(([dx, dy, len, a, main]) => {
        const r = (a * Math.PI) / 180;
        g += `<line x1="${cx + dx}" y1="${cy + dy}" x2="${(cx + dx - Math.cos(r) * len).toFixed(1)}" y2="${(cy + dy - Math.sin(r) * len).toFixed(1)}" stroke="${main ? C.ink : open ? C.blue : C.ink}" stroke-width="${main ? 4 : 3.2}" stroke-linecap="round"/>`;
      });
      return g;
    };
    const f = s.flap;
    const deg = (rad) => (rad * 180) / Math.PI;
    wings.innerHTML =
      wing(70, 30, [[0, 10, 50, deg(0.02), 1], [-36, -2, 26, deg(0.32 - 0.24 * f) * 1.6, 0], [-52, -14, 20, deg(0.58 - 0.42 * f) * 1.6, 0]], 'FRONT') +
      wing(190, 30, [[0, 10, 34, deg(0.08 - 0.06 * f) * 1.6, 1], [-26, -2, 24, deg(0.38 - 0.3 * f) * 1.6, 0], [-44, -14, 20, deg(0.7 - 0.6 * f) * 1.6, 0]], 'REAR');
    // trace cursor
    cursorLine.style.left = `${TR.x + tx(s.dist)}px`;
    // system card
    const sys = o.sys || 'all';
    const card = sys === 'all' && (o.garage ?? 0) >= 0.5 && o.explode < 0.5 ? CARDS.garage : CARDS[sys];
    set(cardK, sys === 'all' ? 'THE CAR' : 'SYSTEM');
    set(cardT, card[0]);
    set(cardB, card[1]);
    if (sys === 'wheel') {
      cardL.style.display = 'none';
      wheelList.style.display = '';
      const lit = {straight: s.flap > 0.5, boost: s.energy === 'deploy', recharge: ['harvest', 'superclip', 'lift'].includes(s.energy), overtake: false, radio: false, limiter: false};
      for (const [k, w] of Object.entries(wk)) w.dot.style.background = lit[k] ? w.col : 'transparent';
    } else {
      cardL.style.display = '';
      wheelList.style.display = 'none';
      set(cardL, card[2].map((t) => `<li>${t}</li>`).join(''));
    }
    // transport
    set(btn.pause, o.paused ? '▶ &nbsp;PLAY' : '❚❚ &nbsp;PAUSE');
    set(lapVal, `${s.lapT.toFixed(1)} S · ${fmt(s.dist)} M`);
    lapKnob.style.left = `${lapKnobAt(s.lapT / LAP_TIME)[0]}px`;
    set(playVal, o.playText);
    playKnob.style.left = `${playKnobAt(o.playK)[0]}px`;
    // toggles
    for (const k of CAMS) btn[k].classList.toggle('on', o.cam === k);
    btn.assembled.classList.toggle('on', o.explode < 0.5 && (o.garage ?? 0) < 0.5);
    btn.garage.classList.toggle('on', o.explode < 0.5 && (o.garage ?? 0) >= 0.5);
    btn.exploded.classList.toggle('on', o.explode >= 0.5);
    for (const k of SYS) btn[k].classList.toggle('on', (o.sys || 'all') === k);
    // callouts: label boxes placed where the frame says, leaders to the projected part
    let lines = '';
    let html = '';
    for (const c of o.callouts || []) {
      if (!c.at || c.o <= 0.01) continue;
      const [lx, ly] = c.label;
      const [ax, ay] = c.at;
      const ex = lx + (c.left ? 0 : 0);
      lines += `<line x1="${ex}" y1="${ly + 7}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="${C.ink}" stroke-width=".8" opacity="${(c.o * 0.7).toFixed(2)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.6" fill="${c.col || C.red}" opacity="${c.o.toFixed(2)}"/>`;
      html += `<div class="call" style="left:${c.left ? lx - 200 : lx + 6}px;top:${ly}px;opacity:${c.o.toFixed(2)};${c.left ? 'width:194px;text-align:right' : ''}"><b>${c.name}</b><span>${c.sub}</span></div>`;
    }
    leaders.innerHTML = lines;
    if (callLayer._v !== html) {
      callLayer._v = html;
      callLayer.innerHTML = html;
    }
    // operator cursor
    const cu = o.cursor || {x: -99, y: -99};
    cur.style.transform = `translate(${cu.x - 2}px, ${cu.y - 2}px) scale(${cu.press ? 0.9 : 1})`;
    ring.style.left = `${cu.ringX ?? 0}px`;
    ring.style.top = `${cu.ringY ?? 0}px`;
    ring.style.opacity = String(cu.ring || 0);
    ring.style.transform = `scale(${1 + (1 - (cu.ring || 0)) * 0.8})`;
  };
  return {root: ui, btn, spots, update, lapKnobAt, playKnobAt, TR};
}

// the steering wheel's own screen: drawn into its canvas texture each frame
export function drawScreen(g, s) {
  const W = 256;
  const H = 128;
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, W, H);
  // rev lights across the top
  const n = 15;
  const lit = Math.round(Math.min(1, Math.max(0, (s.rpm - 7000) / 4800)) * n);
  for (let i = 0; i < n; i++) {
    g.fillStyle = i < lit ? (i < 5 ? '#2fbf71' : i < 10 ? '#e7303a' : '#4c8cf0') : '#1a1d22';
    g.fillRect(12 + i * 15.5, 6, 11, 7);
  }
  g.fillStyle = '#ffffff';
  g.font = '800 64px Inter, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(s.gear), W / 2, 66);
  g.font = '700 26px Inter, sans-serif';
  g.textAlign = 'left';
  g.fillText(String(Math.round(s.kmh)), 14, 52);
  g.font = '600 11px Inter, sans-serif';
  g.fillStyle = '#9aa1aa';
  g.fillText('KM/H', 14, 74);
  g.textAlign = 'right';
  g.fillStyle = s.flap > 0.5 ? '#4c8cf0' : '#9aa1aa';
  g.font = '700 13px Inter, sans-serif';
  g.fillText(s.flap > 0.5 ? 'STRAIGHT' : 'CORNER', W - 14, 50);
  g.fillStyle = s.kw > 5 ? '#f0a020' : s.kw < -5 ? '#2fd0e0' : '#9aa1aa';
  g.fillText(s.kw > 5 ? 'DEPLOY' : s.kw < -5 ? 'HARVEST' : '—', W - 14, 70);
  // battery
  g.fillStyle = '#1a1d22';
  g.fillRect(14, 100, W - 28, 14);
  g.fillStyle = '#2fbf71';
  g.fillRect(14, 100, ((W - 28) * s.soc) / 4, 14);
  g.fillStyle = '#ffffff';
  g.font = '700 10px Inter, sans-serif';
  g.textAlign = 'left';
  g.fillText(`BATT ${s.soc.toFixed(1)} MJ`, 18, 108);
}
