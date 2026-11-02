// The RB22 teardown as a page you drive: the film's car and overlay in real time. Cameras, assembled / exploded,
// a system to isolate (aero, power unit, chassis, cooling, suspension, steering wheel), pause and ±1 s, the lap and
// playback sliders, scrubbing on the speed trace, an orbit you drag, a zoom on the wheel, H to hide the panels.
// Left alone it plays the film's script as an auto tour with the operator's cursor; a click, drag, wheel or key
// hands control to the visitor, 25 s of quiet hands it back.
import {warmComposer} from 'teardown-kit/warm.js';
import {BUILD, CAMS, createConsole, drawScreen, SYS} from './console.js';
import {blend, camAt, camName, DURATION, explodeAt, garageAt, LAP_START, makeConsoleFrame, makeCursor, SCRIPT, sysAt, VIEW_FN} from './film.js';
import {LAP_D, LAP_TIME, stateAt, timeAtDist} from './kin.js';
import {createEngineSound} from './sound.js';
import {createStage, loadDetail, loadGearbox, loadReal} from './stage.js';

const W = 1600;
const H = 900;
const IDLE = 25;
const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const PLAYS = [1 / 8, 1 / 4, 1 / 2, 1];
const playText = (p) => (p >= 1 ? 'REAL TIME' : `1 / ${Math.round(1 / p)} SPEED`);
// pressing a system also picks the camera that shows it best
const SYS_CAM = {garage: 'garage', all: 'hero', aero: 'front', pu: 'pu', chassis: 'side', cooling: 'top', susp: 'front', wheel: 'cockpit'};

const CSS = `
html,body{background:#ecedef;overflow:hidden;margin:0}
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#gl{touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.tb{pointer-events:auto;cursor:pointer}
.tb:hover{filter:brightness(.95)}
.hit{position:absolute;pointer-events:auto;cursor:pointer}
.hit.ew{cursor:ew-resize}
.tourchip{position:absolute;left:800px;top:36px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:22px;padding:0 11px;border:1px solid #e1e3e6;background:rgba(255,255,255,.95);color:#16181b;font:600 8.8px Inter,sans-serif;letter-spacing:1.3px;white-space:nowrap;cursor:pointer;pointer-events:auto}
.tourchip i{display:block;width:6px;height:6px;border-radius:50%;background:#d6182b}
.tourchip.on i{animation:blink 1.2s steps(2) infinite}
.soundchip{left:1090px;transform:none}
.soundchip.on{background:#16181b;color:#fff;border-color:#16181b}
@keyframes blink{50%{opacity:.15}}
.back{position:fixed;left:12px;top:10px;z-index:90;font:700 12px/1 Inter,sans-serif;color:#16181b;background:rgba(255,255,255,.92);border:1px solid #d9dbdf;border-radius:999px;padding:8px 12px;text-decoration:none}
.turn{position:fixed;left:0;right:0;bottom:18px;text-align:center;font:600 12px/1.4 Inter,sans-serif;letter-spacing:.5px;color:#5d636c;display:none;padding:0 16px}
@media (orientation:portrait) and (max-width:820px){.turn{display:block}}
`;

export async function runLive() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = 'Inside a 2026 F1 car: full data view | The Pit Lane';
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  // the car is a ~3.7 MB download: show how far along it is
  const load = document.createElement('div');
  load.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;z-index:95;background:#ecedef;font:600 14px Bricolage Grotesque,Inter,sans-serif;color:#16181b';
  load.innerHTML = '<div style="width:min(320px,80vw);display:grid;gap:10px;text-align:center"><b style="font-size:20px">Wheeling the car into the garage</b><div style="height:6px;background:#d9dbdf;border-radius:3px;overflow:hidden"><i style="display:block;height:100%;width:0;background:#d6182b;transition:width .2s"></i></div><span style="color:#5d636c;font-weight:500">Loading the car: 0 MB of 3.7 MB</span></div>';
  document.body.appendChild(load);
  const bar = load.querySelector('i');
  const txt = load.querySelector('span');
  const got = {car: 0, parts: 0};
  const show = () => {
    const b = got.car + got.parts;
    bar.style.width = `${Math.min(100, Math.round((b / 6.8e6) * 100))}%`;
    txt.textContent = `Loading the car: ${(b / 1e6).toFixed(1)} MB of 6.8 MB`;
  };
  const [real, detail] = await Promise.all([
    loadReal((k, bytes) => { got.car = bytes; show(); }),
    loadDetail((bytes) => { got.parts = Math.max(got.parts, bytes); show(); }),
  ]);
  txt.textContent = 'Warming up the engine';
  const st = createStage({canvas, lo: light, real, detail});
  const ui = createConsole(app);
  const tourCursor = makeCursor(ui);
  const frameConsole = makeConsoleFrame(ui, st);
  const back = document.createElement('a');
  back.className = 'back';
  back.href = '../#/teardown';
  back.textContent = '← The Pit Lane';
  // inside the site's page the menu is already there: no back link
  if (window.self === window.top) document.body.appendChild(back);

  // ------------------------------------------------------------ quality tiers
  const TIERS = [
    {samples: 8, ao: true, shadow: 4096, pr: 2},
    {samples: 4, ao: false, shadow: 2048, pr: 1.5},
    {samples: 0, ao: false, shadow: 1024, pr: 1},
  ];
  let tier = light ? 2 : 0;
  let scale = 1;
  const fit = () => {
    scale = Math.min(innerWidth / W, innerHeight / H);
    app.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    st.resize(W, H, clamp((devicePixelRatio || 1) * scale, 0.75, TIERS[tier].pr));
  };
  const applyTier = () => {
    const {pr, ...q} = TIERS[tier];
    st.setQuality(q);
    fit();
  };
  applyTier();
  addEventListener('resize', fit);
  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / scale, (cy - r.top) / scale];
  };
  const tourChip = document.createElement('div');
  tourChip.className = 'tourchip';
  ui.root.appendChild(tourChip);
  // engine sound from the lap's numbers (sound.js): silent until tapped, as browsers require
  const engine = createEngineSound();
  const soundChip = document.createElement('div');
  soundChip.className = 'tourchip soundchip';
  soundChip.setAttribute('role', 'button');
  const paintSound = () => {
    soundChip.classList.toggle('on', engine.on);
    soundChip.textContent = engine.on ? '♪ ENGINE SOUND ON' : '♪ ENGINE SOUND';
  };
  paintSound();
  ui.root.appendChild(soundChip);
  soundChip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    engine.toggle();
    paintSound();
  });
  const note = document.createElement('div');
  note.className = 'turn';
  note.textContent = 'Turn your phone sideways for the full teardown';
  document.body.appendChild(note);

  // ------------------------------------------------------------ state
  let T = 0;
  let lapT = LAP_START;
  let playI = 3;
  let paused = false;
  let view = 'hero';
  let viewAt = 0;
  let sys = 'all';
  let exTarget = 0;
  let ex = 0;
  let gaTarget = 0;
  let ga = 0;
  let callouts = 1;
  const off = {az: 0, el: 0, k: 1};
  const cam = {...VIEW_FN.open(0)};
  let ring = {t: -9, x: 0, y: 0};
  let hidden = false;
  const pulse = (x, y) => (ring = {t: T, x, y});
  const pulseBtn = (k) => ui.spots[k] && pulse(...ui.spots[k]);

  // ------------------------------------------------------------ the tour
  const AP = {on: true, t0: 0, loop: 0};
  let lastInput = 0;
  const startTour = () => {
    AP.on = true;
    AP.t0 = T;
    AP.loop = 0;
    paused = false;
    playI = 3;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const takeOver = () => {
    lastInput = T;
    if (!AP.on) return;
    AP.on = false;
    const cyc = (T - AP.t0) % DURATION;
    const v = SCRIPT.filter((e) => e.cam && e.t <= cyc).pop();
    view = v.cam === 'open' ? 'hero' : v.cam;
    viewAt = T - (cyc - v.t);
    sys = sysAt(cyc);
    exTarget = explodeAt(cyc) > 0.5 ? 1 : 0;
    gaTarget = garageAt(cyc) > 0.5 ? 1 : 0;
  };
  tourChip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (AP.on) takeOver();
    else startTour();
  });
  addEventListener('pointerdown', (e) => {
    if (e.target !== tourChip && e.target !== soundChip && e.target !== back) takeOver();
  });

  // ------------------------------------------------------------ controls
  const setView = (v) => {
    view = v;
    viewAt = T;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  for (const k of CAMS)
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulseBtn(k);
      if (sys === 'wheel' && k !== 'cockpit') sys = 'all';
      if (k === 'cockpit') {
        sys = 'wheel';
        exTarget = 0;
      }
      setView(k);
    });
  for (const k of BUILD)
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulseBtn(k);
      exTarget = k === 'exploded' ? 1 : 0;
      gaTarget = k === 'garage' ? 1 : 0;
      if ((exTarget || gaTarget) && (view === 'cockpit' || sys === 'wheel')) sys = 'all';
      if (gaTarget) setView('garage');
      else if (exTarget && (view === 'cockpit' || view === 'garage')) setView('hero');
    });
  for (const k of SYS)
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulseBtn(k);
      sys = k;
      if (k === 'wheel') exTarget = 0;
      setView(exTarget && k !== 'wheel' ? 'hero' : SYS_CAM[k]);
    });
  ui.btn.pause.addEventListener('click', () => {
    takeOver();
    pulseBtn('pause');
    paused = !paused;
  });
  for (const [k, d] of [['back', -1], ['fwd', 1]])
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      paused = true;
      lapT += d;
    });
  // sliders: drag along a track [x0..x1] at y
  const slider = (x0, x1, y, h, apply) => {
    const d = document.createElement('div');
    d.className = 'hit ew';
    Object.assign(d.style, {left: `${x0 - 8}px`, top: `${y - h / 2}px`, width: `${x1 - x0 + 16}px`, height: `${h}px`});
    const move = (e) => {
      const [x] = toStage(e.clientX, e.clientY);
      apply(clamp((x - x0) / (x1 - x0), 0, 1));
      lastInput = T;
    };
    d.addEventListener('pointerdown', (e) => {
      takeOver();
      d.setPointerCapture(e.pointerId);
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      move(e);
    });
    ui.root.appendChild(d);
  };
  slider(ui.lapKnobAt(0)[0], ui.lapKnobAt(1)[0], 836, 22, (k) => {
    paused = true;
    lapT = k * LAP_TIME * 0.9999;
  });
  slider(ui.playKnobAt(0)[0], ui.playKnobAt(1)[0], 869, 22, (k) => (playI = Math.round(k * (PLAYS.length - 1))));
  // the speed trace: drag to scrub through the lap by distance
  slider(ui.TR.x, ui.TR.x + ui.TR.w, ui.TR.y + ui.TR.h / 2, ui.TR.h, (k) => {
    paused = true;
    lapT = timeAtDist(k * LAP_D);
  });
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    const v = {1: 'hero', 2: 'side', 3: 'top', 4: 'front', 5: 'rear', 6: 'cockpit'}[key];
    takeOver();
    if (v) ui.btn[v].click();
    else if (key === ' ') paused = !paused;
    else if (key === 'h') hidden = !hidden;
    else if (key === 'e') exTarget = exTarget ? 0 : 1;
    else if (key === 'c') callouts = callouts ? 0 : 1;
    else if (key === 'arrowleft') {
      paused = true;
      lapT -= 0.5;
    } else if (key === 'arrowright') {
      paused = true;
      lapT += 0.5;
    } else return;
    e.preventDefault();
  });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = {x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    off.az += ((e.clientX - drag.x) / scale) * 0.3;
    off.el = clamp(off.el + ((e.clientY - drag.y) / scale) * 0.2, -15, 70);
    drag = {x: e.clientX, y: e.clientY};
    lastInput = T;
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    takeOver();
    off.k = clamp(off.k * Math.exp(e.deltaY * 0.0012), 0.35, 2.2);
  }, {passive: false});

  // ------------------------------------------------------------ the frame
  startTour();
  let last = performance.now();
  const perf = {n: 0, sum: 0, slow: 0, age: 0};
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    T += dt;
    if (tier < TIERS.length - 1) {
      perf.age += dt;
      if (perf.age > 0.6) {
        perf.sum += dt;
        perf.n++;
        if (perf.sum >= 0.5 && perf.n >= 6) {
          perf.slow = perf.sum / perf.n > 0.022 ? perf.slow + 1 : 0;
          perf.sum = 0;
          perf.n = 0;
          if (perf.slow >= (perf.age < 6 ? 1 : 2)) {
            tier++;
            applyTier();
            Object.assign(perf, {age: 0, slow: 0});
          }
        }
      }
    }
    let tgt;
    let cursor;
    let since;
    let solo;
    let camKey;
    if (AP.on) {
      const c = T - AP.t0;
      const loop = Math.floor(c / DURATION);
      const cyc = c - loop * DURATION;
      if (loop > AP.loop) AP.loop = loop;
      lapT = LAP_START + cyc;
      tgt = camAt(cyc);
      ex = explodeAt(cyc);
      ga = garageAt(cyc);
      sys = sysAt(cyc);
      const sEv = SCRIPT.filter((e) => e.sys && e.t <= cyc).pop();
      solo = sys !== 'all' && cyc - sEv.t > 0.6 ? sys : null;
      const v = SCRIPT.filter((e) => e.cam && e.t <= cyc).pop();
      since = cyc - v.t;
      camKey = v.cam === 'pu' || v.cam === 'open' ? 'hero' : camName(cyc);
      cursor = tourCursor(cyc);
    } else {
      if (T - lastInput > IDLE) startTour();
      since = T - viewAt;
      ex += (exTarget - ex) * (1 - Math.exp(-dt / 0.45));
      ga += (gaTarget - ga) * (1 - Math.exp(-dt / 0.45));
      tgt = VIEW_FN[view](since);
      if (view === 'hero') tgt = blend(tgt, VIEW_FN.exploded(since), ex, false);
      tgt.az += off.az;
      tgt.el = clamp(tgt.el + off.el, -10, 85);
      tgt.d *= off.k;
      solo = sys === 'all' ? null : sys;
      camKey = view === 'pu' ? 'hero' : view;
      if (!paused) lapT += dt * PLAYS[playI];
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      cursor = {x: -99, y: -99, press: false, ring: rk, ringX: ring.x, ringY: ring.y};
    }
    lapT = ((lapT % LAP_TIME) + LAP_TIME) % LAP_TIME;
    const k = 1 - Math.exp(-dt / (AP.on ? 0.12 : 0.4));
    cam.az += wrap(tgt.az - cam.az) * k;
    for (const key of ['tx', 'ty', 'tz', 'el', 'd', 'sx', 'sy']) cam[key] += (tgt[key] - cam[key]) * k;
    const s = stateAt(lapT);
    engine.update(s, {rate: AP.on ? 1 : PLAYS[playI], running: (AP.on || !paused) && !document.hidden});
    st.frame(s, {...cam, az: cam.az * D2R, el: cam.el * D2R}, {explode: ex, garage: ga, solo, drawScreen});
    ui.root.style.display = hidden ? 'none' : '';
    frameConsole(T, {
      s, cam: camKey, sys, explode: ex, garage: ga, cursor, since,
      live: {paused, callouts, playText: playText(PLAYS[playI]), playK: playI / (PLAYS.length - 1)},
    });
    if (tourChip.classList.contains('on') !== AP.on || !tourChip.firstChild) {
      tourChip.classList.toggle('on', AP.on);
      tourChip.innerHTML = AP.on ? '<i></i>AUTO TOUR · TAP ANYWHERE TO TAKE OVER' : '▶ RESUME TOUR';
    }
    if (!window.SIM_SHOWN) {
      window.SIM_SHOWN = true;
      dispatchEvent(new Event('simframe'));
    }
    requestAnimationFrame(frame);
  };
  warmComposer(st.renderer, st.composer, st.scene, st.camera).then(() => {
    load.remove();
    loadGearbox().then((g) => g && st.car.addGearbox(g));
    requestAnimationFrame(frame);
  });
  window.LIVE = {st, startTour, takeOver};
}
