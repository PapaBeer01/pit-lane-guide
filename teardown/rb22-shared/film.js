// The RB22 teardown film: the car (car.js) on the pale studio (stage.js) under the overlay (console.js), running
// Verstappen's Mexico qualifying lap in real time from the start line. An operator watches the wings open on the
// main straight, isolates the power unit as he brakes for turn 1 (the MGU-K turns from deploying to harvesting),
// explodes the car, opens the steering wheel, then puts it all back. A pure function of t.
import {runSim} from 'teardown-kit/runtime.js';
import {createConsole, drawScreen, CAMS} from './console.js';
import {stateAt} from './kin.js';
import {createStage, loadReal} from './stage.js';

export const SCRIPT = [
  {t: 0, cam: 'open'},
  {t: 3.6, cam: 'front', sys: 'aero'},
  {t: 9.0, cam: 'pu', sys: 'pu'},
  {t: 15.5, cam: 'hero', sys: 'all', explode: [0, 1, 1.6]},
  {t: 21.0, cam: 'cockpit', sys: 'wheel', explode: [1, 0, 0.6]},
  {t: 27.5, cam: 'garage', sys: 'all', garage: [0, 1, 1.4]},
  {t: 32.5, cam: 'hero', sys: 'all', garage: [1, 0, 1.0]},
];
export const DURATION = 36;
export const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: 'RB22', subtitle: 'Teardown'}, director: {enabled: false}, watermark: ''};
const D2R = Math.PI / 180;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
export const LAP_START = 0;          // lap time at film t = 0: the start line, flat out down the main straight

// ------------------------------------------------------------ views, each a function of u (seconds since it came on)
export const VIEW_FN = {
  open: (u) => {
    const k = smoother(u / 3.8);
    return {tx: 1.75, ty: 0.42, tz: 0, az: 18 + 40 * k, el: 14 + 8 * k, d: 12.5 - 1.6 * k, sx: 0, sy: 10};
  },
  hero: (u) => ({tx: 1.75, ty: 0.45, tz: 0, az: 52 + 3 * u, el: 21, d: 10.6, sx: 0, sy: 10}),
  side: (u) => ({tx: 1.75, ty: 0.42, tz: 0, az: 90 - 2 * u, el: 6, d: 10.2, sx: 0, sy: 20}),
  top: (u) => ({tx: 1.75, ty: 0.3, tz: 0, az: 90, el: 84, d: 11.5 - 0.1 * u, sx: 0, sy: 0}),
  front: (u) => ({tx: 3.4, ty: 0.32, tz: 0.1, az: 55 + 3 * u, el: 19, d: 6.8, sx: 0, sy: 10}),
  rear: (u) => ({tx: -0.2, ty: 0.6, tz: 0, az: 140 - 3 * u, el: 18, d: 5.8, sx: 0, sy: 10}),
  pu: (u) => ({tx: 0.75, ty: 0.38, tz: 0.05, az: 34 + 4 * u, el: 28, d: 4.6, sx: 0, sy: 10}),
  cockpit: (u) => ({tx: 2.39, ty: 0.62, tz: 0, az: -90 + 4 * Math.sin(u * 0.6), el: 22, d: 0.95, sx: 0, sy: -10}),
  // straight on at the nose, a little above: like the garage photo with the covers off
  garage: (u) => ({tx: 2.2, ty: 0.48, tz: 0, az: 80 + 2.5 * u, el: 14, d: 7.4, sx: 0, sy: 10}),
  exploded: (u) => ({tx: 1.75, ty: 0.7, tz: 0, az: 48 + 3 * u, el: 25, d: 14.2, sx: 0, sy: 10}),
};
const VIEWS = SCRIPT.filter((e) => e.cam).map((e) => [e.t, e.cam]);
export function blend(a, b, k, backOff = true) {
  const o = {};
  for (const key in b) o[key] = key === 'az' ? a.az + ((((b.az - a.az + 540) % 360) - 180) * k) : a[key] + (b[key] - a[key]) * k;
  const swing = Math.min(1, Math.abs(((b.az - a.az + 540) % 360) - 180) / 90);
  if (backOff) o.d += Math.max(0, Math.max(a.d, b.d) * 0.25 + 1.2 * swing) * Math.sin(Math.PI * k);
  return o;
}
// explode amount at film time t, from the script's [from, to, seconds] moves
export const explodeAt = (t) => {
  let e = 0;
  for (const ev of SCRIPT) if (ev.explode && t >= ev.t) e = ev.explode[0] + (ev.explode[1] - ev.explode[0]) * ss(ev.t, ev.t + ev.explode[2], t);
  return e;
};
export const garageAt = (t) => {
  let g = 0;
  for (const ev of SCRIPT) if (ev.garage && t >= ev.t) g = ev.garage[0] + (ev.garage[1] - ev.garage[0]) * ss(ev.t, ev.t + ev.garage[2], t);
  return g;
};
export const sysAt = (t) => SCRIPT.filter((e) => e.sys && e.t <= t).pop()?.sys ?? 'all';
// a hero view widens to fit the car once it's exploded
const viewWithExplode = (name, u, ex) => {
  const v = VIEW_FN[name](u);
  if (name === 'hero' || name === 'open') {
    const w = VIEW_FN.exploded(u);
    return blend(v, w, ex, false);
  }
  return v;
};
export const camAt = (t) => {
  let i = 0;
  while (i < VIEWS.length - 1 && VIEWS[i + 1][0] <= t) i++;
  const ex = explodeAt(t);
  const view = (k) => viewWithExplode(VIEWS[k][1], t - VIEWS[k][0], ex);
  const cur = view(i);
  if (i === 0) return cur;
  const k = ss(VIEWS[i][0], VIEWS[i][0] + 1.7, t);
  if (k >= 1) return cur;
  return blend(view(i - 1), cur, k);
};
export const camName = (t) => {
  const v = VIEWS.filter(([t0]) => t0 <= t).pop()[1];
  return v === 'open' ? 'hero' : v === 'pu' ? 'hero' : v;
};

// ------------------------------------------------------------ the operator's pointer: to each button it presses
const REST = [[860, 470], [720, 420], [930, 520], [780, 390]];
export function makeCursor(ui) {
  const EV = [];
  for (const e of SCRIPT.filter((x) => x.t > 0)) {
    // press the system first, then the camera / teardown a beat later
    if (e.sys) EV.push({t: e.t, spot: ui.spots[e.sys]});
    if (e.explode) EV.push({t: e.t + 0.55, spot: ui.spots[e.explode[1] ? 'exploded' : 'assembled']});
    else if (e.garage) EV.push({t: e.t + 0.55, spot: ui.spots[e.garage[1] ? 'garage' : 'assembled']});
    else if (e.cam && CAMS.includes(e.cam)) EV.push({t: e.t + 0.55, spot: ui.spots[e.cam]});
  }
  const WP = [[0, 980, 640]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.2, ...e.spot]);
    WP.push([e.t + 0.18, ...e.spot]);
    if (!EV[i + 1] || EV[i + 1].t - e.t > 1.5) WP.push([e.t + 1.5, ...REST[i % REST.length]]);
  });
  WP.sort((a, b) => a[0] - b[0]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const k = ss(t0, t1, t);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let rx = 0;
    let ry = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + 0.1) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [rx, ry] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX: rx, ringY: ry};
  };
}

// ------------------------------------------------------------ callouts: which parts are named in which view
const CALLS = {
  hero: [['frontwing', 'Front wing', '2 ACTIVE FLAPS', [1050, 640]], ['halo', 'Halo', 'TITANIUM', [880, 170]], ['rearwing', 'Rear wing', '3 ACTIVE ELEMENTS', [470, 170]], ['pushrod', 'Push-rod suspension', 'FRONT AND REAR', [1130, 470]]],
  exploded: [['ice', 'V6 engine', '1.6 L · 15,000 RPM', [760, 120]], ['mguk', 'MGU-K', '350 kW', [1130, 300]], ['battery', 'Energy store', '4 MJ WINDOW', [1120, 610]], ['turbo', 'Turbocharger', 'NO MGU-H', [440, 150]], ['floor', 'Floor', 'FLATTER IN 2026', [600, 735]], ['gearbox', 'Gearbox', '8 SPEEDS', [380, 330]]],
  front: [['frontwing', 'Active flaps', 'OPEN ON STRAIGHTS', [1040, 210]], ['wheelF', 'Front tyre', '280 MM WIDE', [1010, 640]]],
  rear: [['rearwing', 'Rear wing', 'ELEMENTS FLATTEN', [1010, 200]], ['diffuser', 'Diffuser', '', [1010, 640]]],
  pu: [['ice', 'V6 · 90° banks', '≈ 400 kW (EST.)', [1000, 170]], ['mguk', 'MGU-K', 'DEPLOYS / HARVESTS', [1020, 560]], ['battery', 'Energy store', 'UNDER THE FUEL CELL', [460, 640]], ['turbo', 'Turbocharger', 'COMPRESSOR + TURBINE', [430, 230]], ['ce', 'Control electronics', '', [470, 470]]],
  cockpit: [],
  side: [['airbox', 'Airbox', 'ENGINE BREATHES HERE', [880, 190]], ['radiator', 'Sidepod', 'SHRINK-WRAPPED', [880, 640]]],
  top: [['radiator', 'Radiators', 'IN EACH SIDEPOD', [1060, 260]], ['fuel', 'Fuel cell', '100% SUSTAINABLE FUEL', [1060, 620]]],
  susp: [['pushrod', 'Push-rod', 'TO THE ROCKER', [1080, 220]], ['brake', 'Carbon brake', '≈ 1,000 °C', [1080, 620]], ['gearbox', 'Rear pickups', 'ON THE GEARBOX', [430, 230]]],
  cooling: [['radiator', 'Radiator', 'ENGINE + BATTERY HEAT', [1080, 220]]],
  garage: [['pushrod', 'Push-rod to rocker', 'FRONT SUSPENSION', [1060, 190]], ['drum', 'Brake duct drum', 'WHEELS OFF', [1080, 640]], ['sis', 'Side-impact tube', 'RED END CAP', [440, 200]], ['halo', 'Halo', 'TITANIUM', [760, 120]]],
};
export function makeConsoleFrame(ui, st) {
  return (t, {s, cam, sys, explode, garage = 0, cursor, since, live}) => {
    const vis = ss(1.2, 1.9, since) * (live && !live.callouts ? 0 : 1);
    const key = garage > 0.5 && explode < 0.5 && sys === 'all' ? 'garage' : cam === 'cockpit' || sys === 'wheel' ? 'cockpit' : sys === 'susp' || sys === 'cooling' || sys === 'pu' ? sys : explode > 0.6 && cam === 'hero' ? 'exploded' : cam;
    const list = CALLS[key] || [];
    const callouts = list.map(([a, name, sub, label]) => {
      const at = st.project(st.car.anchor(a));
      return {name, sub, at, label, o: at ? vis : 0, left: at && at[0] < label[0] - 40 ? false : at ? at[0] < label[0] : false, col: a === 'mguk' ? (s.kw >= 0 ? '#e98a00' : '#12a8c0') : null};
    });
    ui.update(s, {
      cam, sys, explode, garage, callouts, cursor,
      paused: live ? live.paused : false,
      playText: live ? live.playText : 'REAL TIME',
      playK: live ? live.playK : 1,
    });
  };
}

export function makeFilm() {
  return async ({canvas, capture}) => {
    const st = createStage({canvas, real: await loadReal()});
    const resize = () => st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const ui = createConsole(document.getElementById('app'));
    const cursorAt = makeCursor(ui);
    const frame = makeConsoleFrame(ui, st);
    return {
      resize,
      render(t) {
        const s = stateAt(LAP_START + t);
        const c = camAt(t);
        const ex = explodeAt(t);
        const gar = garageAt(t);
        const sys = sysAt(t);
        const t0 = VIEWS.filter(([a]) => a <= t).pop()[0];
        const solo = sys === 'all' ? null : sys;
        // isolation waits for the camera to settle, so the move reads before the car turns to glass
        const soloOn = solo && t - SCRIPT.filter((e) => e.sys && e.t <= t).pop().t > 0.6 ? solo : null;
        st.frame(s, {...c, az: c.az * D2R, el: c.el * D2R}, {explode: ex, garage: gar, solo: soloOn, drawScreen});
        frame(t, {s, cam: VIEWS.filter(([a]) => a <= t).pop()[1] === 'pu' ? 'hero' : camName(t), sys, explode: ex, garage: gar, cursor: cursorAt(t), since: t - t0});
        return {};
      },
    };
  };
}
export const run = () => runSim(DEFAULTS, makeFilm());
