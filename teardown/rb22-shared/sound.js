// Engine sound, made in the browser from the lap's own numbers: no recordings. Every frame takes the same state the
// car moves from (kin.js stateAt: rpm, gear, throttle, brake, speed, MGU-K power) and sets a small Web Audio graph:
//
//   V6 note     a 1.6 L V6 fires 3 times per crank turn, so the note is rpm / 60 × 3 Hz (≈ 550 Hz at 11,000 rpm):
//               a sawtooth there, one an octave up, a square at half (the rumble of the two banks), through a soft
//               clipper and a low-pass that opens with throttle, so on the power it rasps and off it it burbles.
//   turbo       a faint high whistle that follows rpm and rises with throttle.
//   MGU-K       the electric motor's whine, only while it deploys, pitched with road speed.
//   gear change a few-millisecond cut on every upshift, a blip on each downshift.
//   lift        crackle from the exhaust when the throttle closes at high rpm.
//   road        wind and tyre noise growing with the square of speed.
//
// Browsers only start sound after a tap, so this stays silent until enable() is called from a click.
// Slowed playback plays the note at true pitch (the engine doesn't slow down; the film does) but quieter.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function noiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;                       // pinkish: softer than white, closer to wind
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099;
    b1 = 0.963 * b1 + w * 0.2965;
    b2 = 0.57 * b2 + w * 1.0527;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
  }
  return buf;
}

function clipCurve(k = 2.2) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

// opts.ctx: an AudioContext to use instead of making one (an OfflineAudioContext renders a lap to a file)
export function createEngineSound(opts = {}) {
  let ctx = opts.ctx || null;
  let g = null;                                      // the graph, built on first enable()
  let on = false;
  let lastGear = 0;
  let lastThr = 100;

  const build = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();     // keeps peaks polite on phone speakers
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // engine: three oscillators → clipper → throttle-driven low-pass → engine gain
    const eng = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve();
    shaper.oversample = '2x';
    const osc = (type, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(shaper);
      o.start();
      return o;
    };
    const fire = osc('sawtooth', 0.55);
    const oct = osc('sawtooth', 0.22);
    const bank = osc('square', 0.3);
    shaper.connect(lp).connect(eng).connect(master);

    // turbo whistle and MGU-K whine: plain sines
    const tone = (type) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gg = ctx.createGain();
      gg.gain.value = 0;
      o.connect(gg).connect(master);
      o.start();
      return [o, gg];
    };
    const [turbo, turboG] = tone('sine');
    const [mguk, mgukG] = tone('sine');

    // noise: one looping buffer feeds the road/wind band and the lift crackle
    const nb = noiseBuffer(ctx);
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    noise.loop = true;
    const road = ctx.createBiquadFilter();
    road.type = 'lowpass';
    road.frequency.value = 900;
    const roadG = ctx.createGain();
    roadG.gain.value = 0;
    noise.connect(road).connect(roadG).connect(master);
    const crack = ctx.createBiquadFilter();
    crack.type = 'bandpass';
    crack.frequency.value = 1800;
    crack.Q.value = 0.9;
    const crackG = ctx.createGain();
    crackG.gain.value = 0;
    noise.connect(crack).connect(crackG).connect(master);
    noise.start();

    g = {master, eng, lp, fire, oct, bank, turbo, turboG, mguk, mgukG, roadG, crackG};
    return true;
  };

  // smooth parameter change; tc in seconds
  const to = (param, v, tc = 0.03) => param.setTargetAtTime(v, ctx.currentTime, tc);

  return {
    get on() { return on; },
    // call from a click or tap
    enable() {
      if (!g && !build()) return false;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});   // an offline context has no resume
      on = true;
      return true;
    },
    disable() {
      on = false;
      if (ctx && g) to(g.master.gain, 0, 0.05);
    },
    toggle() { return on ? (this.disable(), false) : this.enable(); },

    // s: kin.js state. rate: playback speed (1 real time). running: false while paused or not driving.
    update(s, {rate = 1, running = true} = {}) {
      if (!ctx || !g) return;
      if (!on || !running || !s) {
        to(g.master.gain, 0, 0.06);
        return;
      }
      const rpm = clamp(s.rpm || 0, 3500, 15000);
      const thr = clamp((s.thr ?? 0) / 100, 0, 1);
      const v = (s.kmh || 0) / 3.6;
      const f = (rpm / 60) * 3;                       // V6 firing frequency
      to(g.fire.frequency, f, 0.012);
      to(g.oct.frequency, f * 2, 0.012);
      to(g.bank.frequency, f / 2, 0.012);
      // on throttle: bright and loud. Off: darker and quieter, but never silent (engine braking)
      to(g.lp.frequency, 700 + thr * 3800 + rpm * 0.12, 0.03);
      const engGain = 0.16 + thr * 0.5;
      // gear change: a short cut up, a blip down, then back to the throttle's level
      const shifted = lastGear && s.gear !== lastGear;
      if (shifted) {
        g.eng.gain.cancelScheduledValues(ctx.currentTime);
        g.eng.gain.setValueAtTime(s.gear > lastGear ? 0.05 : 0.75, ctx.currentTime);
      }
      lastGear = s.gear;
      to(g.eng.gain, engGain, shifted ? 0.025 : 0.04);
      // turbo: ~ rpm-linked whistle, louder with boost
      to(g.turbo.frequency, 2400 + rpm * 0.32, 0.05);
      to(g.turboG.gain, 0.012 + thr * 0.03, 0.08);
      // MGU-K whine while deploying, pitched with road speed
      const deploy = clamp((s.kw || 0) / 350, 0, 1);
      to(g.mguk.frequency, 300 + v * 42, 0.05);
      to(g.mgukG.gain, deploy * 0.05, 0.08);
      // wind and tyres
      to(g.roadG.gain, clamp((v / 95) ** 2, 0, 1) * 0.22, 0.1);
      // lift crackle: a burst when the throttle snaps shut at high rpm
      if (lastThr > 0.6 && thr < 0.25 && rpm > 8500) {
        const t0 = ctx.currentTime;
        g.crackG.gain.cancelScheduledValues(t0);
        g.crackG.gain.setValueAtTime(0.32, t0);
        g.crackG.gain.setTargetAtTime(0, t0 + 0.04, 0.12);
      }
      lastThr = thr;
      to(g.master.gain, rate >= 1 ? 0.75 : 0.35 + rate * 0.4, 0.08);
    },
  };
}
