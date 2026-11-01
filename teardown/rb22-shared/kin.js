// The RB22's lap, the one input everything moves from. Max Verstappen's qualifying lap at the 2026 Mexico City GP
// (1:16.692, P4), from F1's timing data every 10 m: speed, throttle, brake, gear and position. Lap time t (seconds)
// gives the distance, and from it every pose and readout: wheel spin, steering, ride, active aero, the MGU-K's
// deployment and harvest, the battery. No three.js in here.
//
// Measured: speed, throttle, brake, gear, the line round the track. Worked out from the 2026 technical rules:
// MGU-K power and its taper with speed, harvest, active aero modes. Estimated (marked est. on screen): engine rpm
// (ratios fitted so 8th tops out at 11,800 rpm) and ICE power (≈400 kW at full throttle).
import LAP from './lap.json';

// ------------------------------------------------------------ the car, in metres (2026 rules unless noted)
export const CAR = {
  wheelbase: 3.4,          // maximum, Art. C 3.? (down 200 mm from 2025)
  width: 1.9,              // maximum (down 100 mm)
  tyreD: 0.706,            // 18-inch rims; 2026 tyres ≈705-710 mm
  frontTyreW: 0.28,        // 25 mm narrower than 2025
  rearTyreW: 0.375,        // 30 mm narrower than 2025
  trackF: 1.62,            // centre to centre, from the 1,900 mm width
  trackR: 1.525,
  mass: 768,               // kg minimum with driver (RB22 listed at 770)
};
export const R_WHEEL = CAR.tyreD / 2;
export const PU = {
  name: 'Red Bull Ford DM01',
  ice: 400,                // kW, ≈ (est.)
  mguk: 350,               // kW maximum, triple 2025's 120
  rpmMax: 15000,           // rules limit
  harvestMJ: 8.5,          // per lap maximum
  battMJ: 4,               // usable state-of-charge window
};

// ------------------------------------------------------------ the lap: time along the distance
const N = LAP.d.length;
const D = LAP.d;
const V = LAP.v.map((v) => v / 3.6);           // m/s
// time at each sample: dt = ds / mean speed, then scaled so the sum is the official lap time
const T = new Float64Array(N + 1);
for (let i = 1; i < N; i++) T[i] = T[i - 1] + (D[i] - D[i - 1]) / Math.max(5, (V[i] + V[i - 1]) / 2);
const LAP_LEN = 4304;                          // m, Autódromo Hermanos Rodríguez
T[N] = T[N - 1] + (LAP_LEN - D[N - 1]) / Math.max(5, (V[N - 1] + V[0]) / 2);
const KT = LAP.time / T[N];
for (let i = 0; i <= N; i++) T[i] *= KT;
export const LAP_TIME = LAP.time;
export const SOURCE = LAP.source;
export const LAP_D = LAP_LEN;

// index and fraction for lap time t (wraps)
const at = (t) => {
  const u = ((t % LAP_TIME) + LAP_TIME) % LAP_TIME;
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (T[m] <= u) lo = m;
    else hi = m;
  }
  const f = (u - T[lo]) / (T[lo + 1] - T[lo]);
  return [lo, f, Math.floor(t / LAP_TIME)];
};
const nxt = (i) => (i + 1) % N;
const lerpArr = (arr, i, f) => arr[i] + (arr[nxt(i)] - arr[i]) * f;

// ------------------------------------------------------------ the line: heading and curvature from x, y (decimetres)
const X = LAP.x.map((v) => v / 10);
const Y = LAP.y.map((v) => v / 10);
const HEAD = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const a = (i - 1 + N) % N;
  const b = nxt(i);
  HEAD[i] = Math.atan2(Y[b] - Y[a], X[b] - X[a]);
}
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// curvature (1/m), smoothed over ±3 samples so GPS noise doesn't twitch the steering
const KAPPA = new Float64Array(N);
for (let i = 0; i < N; i++) {
  let s = 0;
  for (let k = -3; k <= 3; k++) {
    const j = (i + k + N) % N;
    const ds = Math.max(1, Math.hypot(X[nxt(j)] - X[j], Y[nxt(j)] - Y[j]));
    s += wrapA(HEAD[nxt(j)] - HEAD[j]) / ds;
  }
  KAPPA[i] = s / 7;
}

// ------------------------------------------------------------ gears and rpm (estimated)
const RATIO = {};
for (let g = 1; g <= 8; g++) {
  let vmax = 0;
  for (let i = 0; i < N; i++) if (LAP.g[i] === g) vmax = Math.max(vmax, V[i]);
  RATIO[g] = vmax ? (11800 / 60) * 2 * Math.PI * R_WHEEL / vmax : 0;
}
// gears never used on this lap get a ratio between their neighbours
for (let g = 1; g <= 8; g++) if (!RATIO[g]) RATIO[g] = (RATIO[g - 1] || RATIO[g + 1] * 1.25) / 1.18;

// ------------------------------------------------------------ active aero: straight mode on the straights
// The rules let drivers open both wings in marked zones on straights. Here: flat out, above 230 km/h and on a line
// that barely bends; the wings take ~0.35 s to move (tabulated once below).
const ZONE = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  let bend = 0;
  for (let k = -4; k <= 6; k++) bend = Math.max(bend, Math.abs(KAPPA[(i + k + N) % N]));
  ZONE[i] = LAP.thr[i] >= 98 && LAP.v[i] >= 230 && bend < 1 / 450 ? 1 : 0;
}
// fill single-sample gaps
for (let i = 0; i < N; i++) if (!ZONE[i] && ZONE[(i - 1 + N) % N] && ZONE[nxt(i)]) ZONE[i] = 1;

// ------------------------------------------------------------ energy: MGU-K deploy and harvest, the battery
// Deployment: up to 350 kW, tapering with speed (≈ 1800 − 5·v kW, v in km/h: full to 290 km/h, none from 360).
// Harvest: up to 350 kW under braking, a little when the throttle is partly closed. The battery's usable window is
// 4 MJ; deployment stops when it's empty, harvest when it's full or the 8.5 MJ lap allowance is used.
export const deployCap = (kmh) => Math.max(0, Math.min(PU.mguk, 1800 - 5 * kmh));
export const SUPERCLIP_KMH = 340;   // (est.) where the taper has left little to deploy
const SUPERCLIP_KW = 120;
const DT = 0.02;
const STEPS = Math.ceil(LAP_TIME / DT) + 2;
const SOC = new Float32Array(STEPS);
const KW = new Float32Array(STEPS);
const AERO = new Float32Array(STEPS);
{
  // two laps so the battery starts the shown lap where a flying lap leaves it
  let soc = 2.6;
  let flap = 0;
  let harvested = 0;
  for (let pass = 0; pass < 2; pass++) {
    harvested = 0;
    for (let s = 0; s < STEPS; s++) {
      const t = s * DT;
      const [i, f] = at(t);
      const kmh = lerpArr(LAP.v, i, f);
      const thr = lerpArr(LAP.thr, i, f) / 100;
      const brk = (f < 0.5 ? LAP.brk[i] : LAP.brk[nxt(i)]) ? 1 : 0;
      let kw = 0;
      if (brk) kw = -PU.mguk * Math.min(1, kmh / 120);
      // super clipping: flat out at the end of a long straight the MGU-K turns round and harvests
      else if (thr > 0.97 && kmh >= SUPERCLIP_KMH) kw = -SUPERCLIP_KW;
      else if (thr > 0.97) kw = deployCap(kmh);
      else if (thr < 0.6) kw = -90 * (1 - thr);
      if (kw > 0 && soc <= 0) kw = 0;
      if (kw < 0 && (soc >= PU.battMJ || harvested >= PU.harvestMJ)) kw = 0;
      soc = Math.min(PU.battMJ, Math.max(0, soc - (kw * DT) / 1000));
      if (kw < 0) harvested += (-kw * DT) / 1000;
      const want = (f < 0.5 ? ZONE[i] : ZONE[nxt(i)]) ? 1 : 0;
      flap += (want - flap) * (1 - Math.exp(-DT / 0.12));
      if (pass === 1) {
        SOC[s] = soc;
        KW[s] = kw;
        AERO[s] = flap;
      }
    }
  }
}
const tab = (arr, t) => {
  const u = ((((t % LAP_TIME) + LAP_TIME) % LAP_TIME) / DT);
  const i = Math.min(STEPS - 2, Math.floor(u));
  return arr[i] + (arr[i + 1] - arr[i]) * (u - i);
};
// energy harvested so far this lap, for the panel
const HARV = new Float32Array(STEPS);
for (let s = 1; s < STEPS; s++) HARV[s] = HARV[s - 1] + Math.max(0, -KW[s]) * DT / 1000;

// ------------------------------------------------------------ the state at lap time t
export function stateAt(t) {
  const [i, f, laps] = at(t);
  const kmh = lerpArr(LAP.v, i, f);
  const v = kmh / 3.6;
  const thr = lerpArr(LAP.thr, i, f);
  const brk = (f < 0.5 ? LAP.brk[i] : LAP.brk[nxt(i)]) ? 1 : 0;
  const gear = f < 0.5 ? LAP.g[i] : LAP.g[nxt(i)];
  const dist = D[i] + (((i + 1 < N ? D[i + 1] : LAP_LEN) - D[i]) * f);
  // wheel angle: distance travelled over the rolling radius, whole laps included so it never jumps
  const spin = (laps * LAP_LEN + dist) / R_WHEEL;
  const kappa = lerpArr(KAPPA, i, f);
  // front wheel angle from the bicycle model: tan δ = wheelbase × curvature
  const steer = Math.atan(CAR.wheelbase * kappa);
  // longitudinal and lateral g from the speed trace and the line
  const j = nxt(i);
  const dv = V[j] - V[i];
  const dtt = T[i + 1] - T[i];
  const glong = dv / dtt / 9.81;
  const glat = (v * v * kappa) / 9.81;
  const rpm = Math.min(PU.rpmMax, (v / (2 * Math.PI * R_WHEEL)) * 60 * (RATIO[gear] || 1));
  const kw = tab(KW, t);
  const flap = tab(AERO, t);
  return {
    t, lapT: ((t % LAP_TIME) + LAP_TIME) % LAP_TIME, dist, kmh, thr, brk, gear, rpm, spin, steer, kappa, glong, glat,
    ice: (PU.ice * thr) / 100,
    kw,
    soc: tab(SOC, t),
    harvested: tab(HARV, t),
    flap,                                  // 0 corner mode … 1 straight mode
    mode: flap > 0.5 ? 'straight' : 'corner',
    // what the energy system is doing, in words for the panels and the steering wheel
    energy: kw > 5 ? 'deploy' : kw < -5 ? (brk ? 'harvest' : thr > 97 ? 'superclip' : 'lift') : 'neutral',
    // the steering wheel turns about 12× the front wheels (est. ratio)
    wheelDeg: Math.max(-170, Math.min(170, Math.atan(CAR.wheelbase * kappa) * 57.2958 * 12)),
    x: lerpArr(X, i, f),
    y: lerpArr(Y, i, f),
    // ride: downforce squats the car with speed², braking dips the nose, cornering rolls it (mm and degrees)
    heave: -0.012 * Math.min(1, (kmh / 330) ** 2) * (1 - 0.45 * flap),
    pitch: Math.max(-1, Math.min(1, glong / 5)) * 0.6,
    roll: Math.max(-1, Math.min(1, glat / 5)) * 0.9,
  };
}

// the whole lap for charts and the map: [distance, km/h, throttle, brake, zone, x, y]
export const TRACE = Array.from({length: N}, (_, i) => [D[i], LAP.v[i], LAP.thr[i], LAP.brk[i], ZONE[i], X[i], Y[i]]);
export const timeAtDist = (d) => {
  let i = 0;
  while (i < N - 1 && D[i + 1] <= d) i++;
  const f = (d - D[i]) / ((i + 1 < N ? D[i + 1] : LAP_LEN) - D[i]);
  return T[i] + (T[i + 1] - T[i]) * Math.max(0, Math.min(1, f));
};
