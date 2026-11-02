// Engine sound, made in the browser from the lap's own numbers: no recordings. Every frame takes the same state the
// car moves from (kin.js stateAt: rpm, gear, throttle, speed, MGU-K power) and feeds a small engine model running
// sample by sample in an AudioWorklet:
//
//   firing      a 1.6 L V6 fires every 120° of crank, 3 times a turn (≈ 550 a second at 11,000 rpm). Each firing is
//               a pressure pulse: a sharp attack decaying over ~1 ms, its size set by throttle, with small
//               cylinder-to-cylinder and cycle-to-cycle differences (real combustion is never identical).
//   exhaust     each bank's pulses ring down its own pipe: a tuned delay line with damped feedback, the main source of
//               the rasp. Two banks, two slightly different lengths, panned a little apart.
//   body        a soft clipper, then a low-pass that opens with throttle: hard and bright on the power, dull and
//               popping off it (fuel cut, with the odd backfire at high revs).
//   turbo       intake hiss and a faint whistle that follow boost.
//   MGU-K       the electric motor's whine while it deploys, pitched with road speed.
//   road        wind and tyre roar growing with the square of speed.
// Gear changes: a short ignition cut on upshifts, a blip on downshifts (rpm itself comes from kin.js).
//
// Browsers only start sound after a tap, so this stays silent until enable() is called from a click.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// tunable from outside (the offline renderer tries variations). These defaults are setting "A, balanced", picked by
// ear over a cleaner and a rougher one (2 Nov 2026).
export const TUNE = {
  decayMs: 0.7,          // pulse length
  pipeHz: [520, 700],    // tuned pipe resonances, bank 1 and 2
  feedback: 0.55,        // pipe ring
  bright: 0.55,          // how much throttle opens the tone
  drive: 2.2,            // soft-clip drive
  rough: 1.0,            // combustion noise inside each pulse (0 clean … 1.5 very rough)
  jitter: 0.012,         // firing-time wobble, fraction of a firing interval
  spread: 0.22,          // cycle-to-cycle pulse size variation
  sameBanks: 0,          // 1: both banks through one pipe (stronger firing note), 0: two pipes
};

const worklet = (T) => `
class Engine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name: 'rpm', defaultValue: 4000, minValue: 0, maxValue: 16000, automationRate: 'k-rate'},
      {name: 'thr', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate'},
      {name: 'speed', defaultValue: 0, minValue: 0, maxValue: 120, automationRate: 'k-rate'},
      {name: 'deploy', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate'},
      {name: 'cut', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate'},
    ];
  }
  constructor(options) {
    super();
    const sr = sampleRate;
    this.sr = sr;
    // recording mode: slices of a real engine, re-pitched by rpm (granular). Without them, the pulse model below.
    const gr = (options && options.processorOptions && options.processorOptions.grains) || null;
    this.grains = gr && gr.length ? gr : null;
    this.voices = [];
    this.spawn = 0;
    this.grainLen = Math.round(0.05 * sr);
    this.hop = Math.round(this.grainLen / 4);
    this.lpG = 0; this.hpG = 0; this.hpGx = 0;
    this.phase = 0;
    this.fireN = 0;
    this.env = [0, 0];
    this.decay = Math.exp(-1 / (${T.decayMs / 1000} * sr));
    this.cylGain = [1.0, 0.93, 1.06, 0.97, 1.04, 0.95];
    this.pipeLen = [Math.round(sr / ${T.pipeHz[0]}), Math.round(sr / ${T.pipeHz[1]})];
    this.pipe = [new Float32Array(4096), new Float32Array(4096)];
    this.pw = [0, 0];
    this.lpPipe = [0, 0];
    this.lpOut = [0, 0];
    this.hp = [0, 0]; this.hpx = [0, 0];
    this.whPh = 0; this.mkPh = 0;
    this.wind = 0; this.hiss = 0;
    this.pop = 0;
    this.seed = 12345;
    this.rpmS = 4000; this.thrS = 0;
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 * 2 - 1; }
  process(inputs, outputs, p) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const sr = this.sr;
    const rpmT = p.rpm[0], thrT = p.thr[0], v = p.speed[0], dep = p.deploy[0], cut = p.cut[0];
    for (let i = 0; i < L.length; i++) {
      this.rpmS += (rpmT - this.rpmS) * 0.002;
      this.thrS += (thrT - this.thrS) * 0.004;
      const rpm = this.rpmS, thr = this.thrS;
      if (this.grains) {
        // a new 50 ms fragment every 12.5 ms, from a random spot in a random slice, read at the speed that puts its
        // harmonics where this rpm puts them (spacing = half the firing rate = rpm / 40)
        if (--this.spawn <= 0) {
          this.spawn = this.hop;
          const gi = (this.rnd() * 0.5 + 0.5) * this.grains.length | 0;
          const g = this.grains[Math.min(gi, this.grains.length - 1)];
          const rate = (rpm / 40) / g.f0 * (g.sr / sr);
          const span = this.grainLen * rate + 2;
          const start = (this.rnd() * 0.5 + 0.5) * Math.max(1, g.data.length - span);
          this.voices.push({g, pos: start, rate, age: 0});
        }
        let e = 0;
        for (let k = this.voices.length - 1; k >= 0; k--) {
          const vo = this.voices[k];
          const j = vo.pos | 0, fr = vo.pos - j, d = vo.g.data;
          const smp = d[j] + (d[j + 1] - d[j]) * fr;
          const w = 0.5 - 0.5 * Math.cos(6.2832 * vo.age / this.grainLen);
          e += smp * w;
          vo.pos += vo.rate;
          if (++vo.age >= this.grainLen) this.voices.splice(k, 1);
        }
        e *= 0.5 * cut;
        // off throttle: quieter and darker; on it: full and bright
        const level = 0.22 + 0.78 * Math.pow(thr, 0.7);
        const kk = 0.12 + ${T.bright} * thr + rpm / 50000;
        this.lpG += (e - this.lpG) * Math.min(0.97, kk);
        const eng = Math.tanh(this.lpG * level * 3.2) * 0.8 + (this.pop * this.rnd() * 0.5);
        if (thr < 0.15 && rpm > 8000 && this.rnd() > 0.9994) this.pop = 0.8;
        this.pop *= 0.996;
        this.hiss += (this.rnd() - this.hiss) * 0.6;
        const turbo = this.hiss * 0.03 * thr;
        this.mkPh += (260 + v * 38) / sr;
        const mguk = Math.sin(this.mkPh * 6.2832) * 0.025 * dep;
        this.wind += (this.rnd() - this.wind) * 0.05;
        const road = this.wind * Math.min(1, (v / 95) * (v / 95)) * 0.4;
        L[i] = R[i] = (eng * 0.6 + turbo + mguk + road) * 0.9;
        continue;
      }
      this.phase += (rpm / 60) * 3 / sr * (1 + this.rnd() * ${T.jitter});
      if (this.phase >= 1) {
        this.phase -= 1;
        const cyl = this.fireN++ % 6;
        const bank = ${T.sameBanks} ? 0 : cyl % 2;
        const a = (0.18 + 0.82 * Math.pow(thr, 0.8)) * this.cylGain[cyl] * (1 + this.rnd() * ${T.spread}) * cut;
        if (thr < 0.15 && rpm > 8000 && this.rnd() > 0.93) this.pop = 0.9 + this.rnd() * 0.3;
        this.env[bank] += a;
      }
      let sL = 0, sR = 0;
      for (let b = 0; b < 2; b++) {
        const e = this.env[b];
        this.env[b] *= this.decay;
        const x = e * (1 - ${T.rough / 2} + ${T.rough} * this.rnd()) + (b === 0 ? this.pop * this.rnd() : 0);
        const len = this.pipeLen[b];
        const w = this.pw[b];
        const rd = (w - len + 4096) & 4095;
        this.lpPipe[b] += (this.pipe[b][rd] - this.lpPipe[b]) * 0.45;
        const y = x - ${T.feedback} * this.lpPipe[b];
        this.pipe[b][w] = y;
        this.pw[b] = (w + 1) & 4095;
        const hpOut = y - this.hpx[b] + 0.995 * this.hp[b];
        this.hpx[b] = y; this.hp[b] = hpOut;
        const k = 0.18 + ${T.bright} * thr + rpm / 60000;
        this.lpOut[b] += (hpOut - this.lpOut[b]) * Math.min(0.95, k);
        const s = Math.tanh(this.lpOut[b] * ${T.drive});
        if (b === 0) { sL += s * 0.8; sR += s * 0.55; } else { sL += s * 0.55; sR += s * 0.8; }
      }
      this.pop *= 0.996;
      this.hiss += (this.rnd() - this.hiss) * 0.6;
      this.whPh += (2200 + rpm * 0.3) / sr;
      const turbo = this.hiss * 0.05 * thr + Math.sin(this.whPh * 6.2832) * 0.012 * thr;
      this.mkPh += (260 + v * 38) / sr;
      const mguk = Math.sin(this.mkPh * 6.2832) * 0.035 * dep;
      this.wind += (this.rnd() - this.wind) * 0.05;
      const road = this.wind * Math.min(1, (v / 95) * (v / 95)) * 0.5;
      const common = turbo + mguk + road;
      L[i] = (sL * 0.55 + common) * 0.9;
      R[i] = (sR * 0.55 + common) * 0.9;
    }
    return true;
  }
}
registerProcessor('rb22-engine', Engine);
`;

// opts.ctx: an AudioContext to use (an OfflineAudioContext renders a lap to a file); opts.now: its clock, when the
// renderer schedules ahead of time
export function createEngineSound(opts = {}) {
  let ctx = opts.ctx || null;
  const now = opts.now || (() => ctx.currentTime);
  const tune = {...TUNE, ...(opts.tune || {})};
  let node = null;
  let master = null;
  let ready = null;              // promise: worklet loaded and node made
  let on = false;
  let lastGear = 0;

  const build = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (!ctx.audioWorklet) return null;
    const url = URL.createObjectURL(new Blob([worklet(tune)], {type: 'application/javascript'}));
    ready = ctx.audioWorklet.addModule(url).then(() => {
      const grains = (opts.grains || []).map((g) => {
        const bin = atob(g.pcm);
        const i16 = new Int16Array(bin.length / 2);
        for (let k = 0; k < i16.length; k++) i16[k] = bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8);
        return {f0: g.f0, sr: g.sr, data: Float32Array.from(i16, (v) => v / 32768)};
      });
      node = new AudioWorkletNode(ctx, 'rb22-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {grains}});
      master = ctx.createGain();
      master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();    // keeps peaks polite on phone speakers
      comp.threshold.value = -12;
      comp.ratio.value = 3;
      node.connect(master).connect(comp).connect(ctx.destination);
      return true;
    }).catch(() => false);
    return ready;
  };

  const P = (name) => node.parameters.get(name);
  const to = (param, v, tc = 0.03) => param.setTargetAtTime(v, now(), tc);

  return {
    get on() { return on; },
    get ready() { return ready; },
    // call from a click or tap
    enable() {
      if (!ready && !build()) return false;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});   // an offline context has no resume
      on = true;
      return true;
    },
    disable() {
      on = false;
      if (master) to(master.gain, 0, 0.05);
    },
    toggle() { return on ? (this.disable(), false) : this.enable(); },

    // s: kin.js state. rate: playback speed (1 real time). running: false while paused or not driving.
    update(s, {rate = 1, running = true} = {}) {
      if (!node) return;
      if (!on || !running || !s) {
        to(master.gain, 0, 0.06);
        return;
      }
      to(P('rpm'), clamp(s.rpm || 0, 3500, 15000), 0.01);
      to(P('thr'), clamp((s.thr ?? 0) / 100, 0, 1), 0.015);
      to(P('speed'), clamp((s.kmh || 0) / 3.6, 0, 120), 0.05);
      to(P('deploy'), clamp((s.kw || 0) / 350, 0, 1), 0.06);
      // gear change: a short ignition cut up, a blip down
      if (lastGear && s.gear !== lastGear) {
        const c = P('cut');
        const t = now();
        c.cancelScheduledValues(t);
        c.setValueAtTime(s.gear > lastGear ? 0.15 : 1.5, t);
        c.setTargetAtTime(1, t + 0.03, 0.02);
      }
      lastGear = s.gear;
      to(master.gain, rate >= 1 ? 0.9 : 0.4 + rate * 0.5, 0.08);
    },
  };
}
