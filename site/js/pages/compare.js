import { lineChart, trackMap } from "../charts.js";
import { helmet } from "../avatars.js";
import { icon } from "../icons.js";
import { ctx, driver, empty, h, lapTime, load, noteList, section, SESSION_LABEL, term } from "../ui.js";

export const title = () => "Compare drivers";
const NEUTRAL = "#8A929C";

export default async function compare(route) {
  const q = route.query;
  const rounds = ctx.season.events.filter((e) => e.sessions.some((s) => s.tel));
  if (!rounds.length) return empty("Driver comparisons appear after the first session with lap data.");
  const ev = rounds.find((e) => e.round === Number(q.get("r"))) || rounds[rounds.length - 1];
  const keys = ev.sessions.filter((s) => s.tel).map((s) => s.key);
  const key = keys.includes(q.get("s")) ? q.get("s") : (keys.includes("Q") ? "Q" : keys[keys.length - 1]);
  const sess = await load(`events/${ev.round}/${key}.json`);
  const avail = sess.results.map((r) => r.code).filter((c) => sess.telemetry.includes(c));
  const a = avail.includes(q.get("a")) ? q.get("a") : avail[0];
  let b = avail.includes(q.get("b")) ? q.get("b") : avail[1];
  if (b === a) b = avail.find((c) => c !== a);

  const go = (patch) => {
    const p = { r: ev.round, s: key, a, b, ...patch };
    if (patch.r && patch.r !== ev.round) { delete p.s; }
    location.hash = `#/compare?${new URLSearchParams(p)}`;
  };
  const pick = (label, value, options, onchange) => h("label", { class: "field" }, label,
    h("select", { class: "select", onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value) }, t))));
  const controls = h("div", { class: "panel", style: { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" } },
    pick("Race", ev.round, rounds.map((e) => [e.round, e.name.replace(" Grand Prix", "")]), (v) => go({ r: Number(v) })),
    pick("Session", key, keys.map((k) => [k, SESSION_LABEL[k]]), (v) => go({ s: v })),
    pick("Driver 1", a, avail.map((c) => [c, `${c}  ${driver(c).name}`]), (v) => go({ a: v })),
    pick("Driver 2", b, avail.map((c) => [c, `${c}  ${driver(c).name}`]), (v) => go({ b: v })));

  const [ta, tb, circuit] = await Promise.all([
    load(`events/${ev.round}/tel/${key}_${a}.json`), load(`events/${ev.round}/tel/${key}_${b}.json`), load(`events/${ev.round}/circuit.json`)]);
  const view = h("div", { style: { display: "grid", gap: "24px" } },
    h("div", { style: { display: "grid", gap: "8px" } },
      h("h1", {}, "Why was one driver faster?"),
      h("p", { class: "muted" }, "Pick two drivers and overlay their fastest laps. You'll see where each one braked, accelerated and carried more speed through the corners.")),
    controls);
  if (!ta || !tb) { view.append(empty("Lap data for one of these drivers is missing for this session.")); return view; }

  const colA = driver(a).color;
  const colB = driver(b).team === driver(a).team ? NEUTRAL : driver(b).color;
  const dashB = driver(b).team === driver(a).team;

  // align driver 2 onto driver 1's distance grid; build time-at-distance for both
  const d = ta.d;
  const vb = interp(d, tb.d, tb.v), thrB = interp(d, tb.d, tb.thr), brkB = interp(d, tb.d, tb.brk);
  const tA = cumTime(d, ta.v, ta.time), tB = cumTime(d, vb, tb.time);
  const delta = d.map((_, i) => tB[i] - tA[i]);       // > 0: driver 1 ahead
  const corners = circuit?.corners || [];

  const insights = buildInsights({ a, b, d, ta, vb, brkB, delta, corners });
  const overall = tb.time - ta.time;
  const duel = h("div", { class: "duel", style: { "--a": colA, "--b": colB } },
    h("a", { href: `#/driver/${a}`, class: "duel-side a" }, helmet(a, { size: 110 }), h("b", {}, driver(a).last), h("span", { class: "muted small" }, lapTime(ta.time))),
    h("span", { class: "duel-vs" }, "vs"),
    h("a", { href: `#/driver/${b}`, class: "duel-side b" }, helmet(b, { size: 110, cls: "flip" }), h("b", {}, driver(b).last), h("span", { class: "muted small" }, lapTime(tb.time))));
  const headline = h("div", { class: "callout" },
    h("p", { style: { fontWeight: 700, display: "flex", gap: "8px", alignItems: "center" } }, icon("timer", { size: 20 }), Math.abs(overall) < 0.0005 ? `${a} and ${b} were dead level.`
      : `${overall > 0 ? a : b} was ${Math.abs(overall).toFixed(3)}s faster (${lapTime(Math.min(ta.time, tb.time))} vs ${lapTime(Math.max(ta.time, tb.time))}).`),
    noteList(insights, "bolt"));

  const keyLegend = h("div", { class: "legend" },
    h("span", {}, h("i", { style: { background: colA } }), `${a} ${driver(a).last}`),
    h("span", {}, h("i", { class: dashB ? "dash" : "", style: { background: colB, "--c": colB } }), `${b} ${driver(b).last}`));

  const map = circuit ? trackMap(circuit, {
    colourAt: (dist) => segWinner(dist, d, delta) === "a" ? colA : colB,
    aria: `Track map coloured by who was faster in each section`,
  }) : null;

  let speed, gap, thr;
  const sA = { id: a, name: a, color: colA, points: d.map((x, i) => [x, ta.v[i]]) };
  const sB = { id: b, name: b, color: colB, dash: dashB, points: d.map((x, i) => [x, vb[i]]) };
  const km = (x) => `${(x / 1000).toFixed(1)}`;
  speed = lineChart([sA, sB], {
    height: 240, xFmt: km, xLabel: "km", yFmt: (t) => `${t}`, aria: "Speed around the lap in km/h",
    onHover: (x) => { map?.setMarker(x); gap.setHover(x); thr.setHover(x); },
    tooltip: (x) => {
      const i = idx(d, x);
      const c = nearestCorner(corners, x);
      return `<b>${c ? `Near turn ${c.n}` : `${(x / 1000).toFixed(2)} km`}</b><br>${a}: ${ta.v[i]} km/h, gear ${ta.g[i]}<br>${b}: ${Math.round(vb[i])} km/h<br>${delta[i] >= 0 ? a : b} ahead by ${Math.abs(delta[i]).toFixed(3)}s`;
    },
  });
  gap = lineChart([{ id: "gap", name: "gap", color: "var(--ink)", points: d.map((x, i) => [x, delta[i]]) }], {
    height: 150, xFmt: km, zero: 0, yFmt: (t) => `${t > 0 ? "+" : ""}${t.toFixed(2)}`, aria: `Time gap between ${a} and ${b}`,
    onHover: (x) => { map?.setMarker(x); speed.setHover(x); thr.setHover(x); },
    tooltip: (x) => { const i = idx(d, x); return `<b>${delta[i] >= 0 ? a : b} ahead</b><br>by ${Math.abs(delta[i]).toFixed(3)}s`; },
  });
  thr = lineChart([
    { id: a, name: a, color: colA, points: d.map((x, i) => [x, ta.thr[i]]) },
    { id: b, name: b, color: colB, dash: dashB, points: d.map((x, i) => [x, thrB[i]]) }], {
    height: 120, yMin: 0, yMax: 100, yTicks: [0, 100], yFmt: (t) => `${t}%`, xFmt: km, aria: "Throttle use around the lap",
    onHover: (x) => { map?.setMarker(x); speed.setHover(x); gap.setHover(x); },
  });

  view.append(duel, headline);
  view.append(h("div", { class: "split" },
    section(["Speed", "gauge"], "Dips are corners: the lower the dip, the slower the corner. Drag or hover to move along the lap.",
      h("div", { class: "panel", style: { display: "grid", gap: "10px" } }, keyLegend, speed.el)),
    section(["Who was faster where", "pin"], "Each part of the track takes the colour of the driver who was quicker through it.",
      h("div", { class: "panel" }, map ? map.el : h("p", { class: "muted" }, "Track map not available."), h("div", { style: { marginTop: "8px" } }, keyLegend.cloneNode(true))))));
  view.append(section(["The gap, metre by metre", "compare"], `Above the line, ${a} is ahead; below it, ${b} is. A steep slope shows where time was won or lost.`,
    h("div", { class: "panel" }, gap.el)));
  view.append(section(["Throttle", "bolt"], h("span", {}, "100% is flat out. Getting back on the throttle earlier out of a corner is often where lap time comes from."),
    h("div", { class: "panel" }, thr.el)));
  view.append(h("p", { class: "small muted" }, "Telemetry is sampled a few times a second, so small differences of a few metres or hundredths can be noise. ",
    term("quali", "How qualifying works")));
  return view;
}

function interp(xs, srcX, srcY) {
  const out = new Array(xs.length);
  let j = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    while (j < srcX.length - 2 && srcX[j + 1] < x) j++;
    const x0 = srcX[j], x1 = srcX[j + 1] ?? x0, y0 = srcY[j], y1 = srcY[j + 1] ?? y0;
    out[i] = x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return out;
}
function cumTime(d, v, total) {
  const t = [0];
  for (let i = 1; i < d.length; i++) t.push(t[i - 1] + (d[i] - d[i - 1]) / Math.max(5, ((v[i] + v[i - 1]) / 2) / 3.6));
  const k = total && t[t.length - 1] ? total / t[t.length - 1] : 1;
  return t.map((x) => x * k);
}
function idx(d, x) { let i = d.findIndex((v) => v >= x); return i < 0 ? d.length - 1 : i; }
function nearestCorner(corners, x, within = 150) {
  let best = null, bd = within;
  for (const c of corners) { const dd = Math.abs((c.d ?? 1e9) - x); if (dd < bd) { bd = dd; best = c; } }
  return best;
}
const SEGMENTS = 24;
function segWinner(dist, d, delta) {
  const L = d[d.length - 1];
  const seg = Math.min(SEGMENTS - 1, Math.floor((dist / L) * SEGMENTS));
  const i0 = idx(d, (seg / SEGMENTS) * L), i1 = idx(d, ((seg + 1) / SEGMENTS) * L);
  return delta[i1] - delta[i0] >= 0 ? "a" : "b";
}

function buildInsights({ a, b, d, ta, vb, brkB, delta, corners }) {
  const out = [];
  // where was time won? compare the change in gap across each corner zone
  const zones = corners.length ? corners.map((c) => ({ n: c.n, from: Math.max(0, c.d - 200), to: c.d + 150 }))
    : Array.from({ length: 8 }, (_, k) => ({ n: null, from: (k / 8) * d[d.length - 1], to: ((k + 1) / 8) * d[d.length - 1] }));
  const gains = zones.map((z) => ({ ...z, g: delta[idx(d, z.to)] - delta[idx(d, z.from)] }));
  const bestA = [...gains].sort((x, y) => y.g - x.g)[0];
  const bestB = [...gains].sort((x, y) => x.g - y.g)[0];
  const where = (z) => (z.n ? `turn ${z.n}` : `the ${(z.from / 1000).toFixed(1)} km mark`);
  if (bestA && bestA.g > 0.01) out.push(`${a}'s biggest gain was around ${where(bestA)}: ${bestA.g.toFixed(3)}s.`);
  if (bestB && bestB.g < -0.01) out.push(`${b}'s biggest gain was around ${where(bestB)}: ${(-bestB.g).toFixed(3)}s.`);
  // braking point at the zone with the biggest swing
  const swing = [...gains].sort((x, y) => Math.abs(y.g) - Math.abs(x.g))[0];
  if (swing?.n) {
    const brakeAt = (brk, from, to) => { for (let i = idx(d, from); i <= idx(d, to); i++) if (brk[i] >= 0.5) return d[i]; return null; };
    const ba = brakeAt(ta.brk, swing.from - 150, swing.to), bb = brakeAt(brkB, swing.from - 150, swing.to);
    if (ba !== null && bb !== null && Math.abs(ba - bb) >= 10) {
      const later = ba > bb ? a : b;
      out.push(`Into turn ${swing.n}, ${later} braked about ${Math.round(Math.abs(ba - bb))} m later.`);
    }
  }
  const topA = Math.max(...ta.v), topB = Math.max(...vb);
  if (Math.abs(topA - topB) >= 2) out.push(`Top speed: ${topA > topB ? a : b} was ${Math.round(Math.abs(topA - topB))} km/h quicker on the straights (${Math.round(Math.max(topA, topB))} km/h).`);
  return out;
}
