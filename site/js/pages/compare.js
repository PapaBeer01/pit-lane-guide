import { lineChart, stintChart, trackMap } from "../charts.js";
import { avatar, helmet } from "../avatars.js";
import { icon } from "../icons.js";
import { canShareFiles, imageButton, makeImage, offscreen } from "../snapshot.js";
import { ctx, driver, empty, h, lapTime, load, noteList, section, SESSION_LABEL, term, tyre } from "../ui.js";

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
  const avail = sess.results.map((r) => r.code);
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

  const hasTel = sess.telemetry.includes(a) && sess.telemetry.includes(b);
  const [ta, tb, circuit] = hasTel ? await Promise.all([
    load(`events/${ev.round}/tel/${key}_${a}.json`), load(`events/${ev.round}/tel/${key}_${b}.json`), load(`events/${ev.round}/circuit.json`)]) : [null, null, null];
  const race = key === "R" || key === "S";
  const view = h("div", { style: { display: "grid", gap: "24px" } },
    h("div", { style: { display: "grid", gap: "8px" } },
      h("h1", {}, race ? "Who won the battle?" : "Why was one driver faster?"),
      h("p", { class: "muted" }, race
        ? "Pick two drivers to see their whole race side by side: where they finished, how the gap changed lap by lap, their pit stops and tyres, then their fastest laps overlaid."
        : "Pick two drivers and overlay their fastest laps. You'll see where each one braked, accelerated and carried more speed through the corners.")),
    controls);

  const colA = driver(a).color;
  const colB = driver(b).team === driver(a).team ? NEUTRAL : driver(b).color;
  const dashB = driver(b).team === driver(a).team;
  const resA = sess.results.find((r) => r.code === a), resB = sess.results.find((r) => r.code === b);
  const finished = (r) => /^\d+$/.test(r?.class || "") || (!race && r?.pos);
  const sub = (r, t) => race ? (finished(r) ? `Finished P${r.pos}` : `Out on lap ${r.laps}`) : r?.pos ? `P${r.pos}, ${lapTime(t?.time ?? r.best)}` : lapTime(t?.time ?? r?.best);
  view.append(h("div", { class: "duel", style: { "--a": colA, "--b": colB } },
    h("a", { href: `#/driver/${a}`, class: "duel-side a" }, helmet(a, { size: 110 }), h("b", {}, driver(a).last), h("span", { class: "muted small" }, sub(resA, ta))),
    h("span", { class: "duel-vs" }, "vs"),
    h("a", { href: `#/driver/${b}`, class: "duel-side b" }, helmet(b, { size: 110, cls: "flip" }), h("b", {}, driver(b).last), h("span", { class: "muted small" }, sub(resB, tb)))));

  if (race) view.append(...raceBattle(sess, a, b, colA, colB, dashB));
  else if (key === "Q" || key === "SQ") view.append(qualiBattle(sess, a, b));
  if (!hasTel) { view.append(empty("Lap telemetry for one of these drivers isn't available for this session.")); return view; }

  // align driver 2 onto driver 1's distance grid; build time-at-distance for both
  const d = ta.d;
  const vb = interp(d, tb.d, tb.v), thrB = interp(d, tb.d, tb.thr), brkB = interp(d, tb.d, tb.brk);
  const tA = cumTime(d, ta.v, ta.time), tB = cumTime(d, vb, tb.time);
  const delta = d.map((_, i) => tB[i] - tA[i]);       // > 0: driver 1 ahead
  const corners = circuit?.corners || [];

  const insights = buildInsights({ a, b, d, ta, vb, brkB, delta, corners });
  const overall = tb.time - ta.time;
  const headline = h("div", { class: "callout" },
    h("p", { style: { fontWeight: 700, display: "flex", gap: "8px", alignItems: "center" } }, icon("timer", { size: 20 }), Math.abs(overall) < 0.0005 ? `${a} and ${b} were dead level.`
      : `${overall > 0 ? a : b} was ${Math.abs(overall).toFixed(3)}s faster (${lapTime(Math.min(ta.time, tb.time))} vs ${lapTime(Math.max(ta.time, tb.time))}).`),
    noteList(insights, "bolt"));

  const keyLegend = h("div", { class: "legend" },
    h("span", {}, h("i", { style: { background: colA } }), `${a} ${driver(a).last}`),
    h("span", {}, h("i", { class: dashB ? "dash" : "", style: { background: colB, "--c": colB } }), `${b} ${driver(b).last}`));

  const mapOpts = {
    colourAt: (dist) => segWinner(dist, d, delta) === "a" ? colA : colB,
    aria: `Track map coloured by who was faster in each section`,
  };
  const map = circuit ? trackMap(circuit, mapOpts) : null;

  let speed, gap, thr;
  const sA = { id: a, name: a, color: colA, points: d.map((x, i) => [x, ta.v[i]]) };
  const sB = { id: b, name: b, color: colB, dash: dashB, points: d.map((x, i) => [x, vb[i]]) };
  const km = (x) => `${(x / 1000).toFixed(1)}`;
  const speedSeries = [sA, sB];
  const speedOpts = { height: 240, xFmt: km, xLabel: "km", yFmt: (t) => `${t}`, aria: "Speed around the lap in km/h" };
  const gapSeries = [{ id: "gap", name: "gap", color: "var(--ink)", points: d.map((x, i) => [x, delta[i]]) }];
  const gapOpts = { height: 150, xFmt: km, zero: 0, yFmt: (t) => `${t > 0 ? "+" : ""}${t.toFixed(2)}`, aria: `Time gap between ${a} and ${b}` };
  const thrSeries = [
    { id: a, name: a, color: colA, points: d.map((x, i) => [x, ta.thr[i]]) },
    { id: b, name: b, color: colB, dash: dashB, points: d.map((x, i) => [x, thrB[i]]) }];
  const thrOpts = { height: 120, yMin: 0, yMax: 100, yTicks: [0, 100], yFmt: (t) => `${t}%`, xFmt: km, aria: "Throttle use around the lap" };
  speed = lineChart(speedSeries, {
    ...speedOpts,
    onHover: (x) => { map?.setMarker(x); gap.setHover(x); thr.setHover(x); },
    tooltip: (x) => {
      const i = idx(d, x);
      const c = nearestCorner(corners, x);
      return `<b>${c ? `Near turn ${c.n}` : `${(x / 1000).toFixed(2)} km`}</b><br>${a}: ${ta.v[i]} km/h, gear ${ta.g[i]}<br>${b}: ${Math.round(vb[i])} km/h<br>${delta[i] >= 0 ? a : b} ahead by ${Math.abs(delta[i]).toFixed(3)}s`;
    },
  });
  gap = lineChart(gapSeries, {
    ...gapOpts,
    onHover: (x) => { map?.setMarker(x); speed.setHover(x); thr.setHover(x); },
    tooltip: (x) => { const i = idx(d, x); return `<b>${delta[i] >= 0 ? a : b} ahead</b><br>by ${Math.abs(delta[i]).toFixed(3)}s`; },
  });
  thr = lineChart(thrSeries, {
    ...thrOpts,
    onHover: (x) => { map?.setMarker(x); speed.setHover(x); gap.setHover(x); },
  });

  // ---- saving as pictures: each chart is redrawn off-screen at a fixed size, so it looks the same on any phone ----
  const notes = {
    speed: "Dips are corners: the lower the dip, the slower the corner.",
    map: "Each part of the track takes the colour of the driver who was quicker through it.",
    gap: `Above the line, ${a} is ahead; below it, ${b} is. A steep slope shows where time was won or lost.`,
    thr: "100% is flat out. Getting back on the throttle earlier out of a corner is often where lap time comes from.",
  };
  const blocks = {
    speed: { label: "Speed (km/h)", note: notes.speed, render: (w) => offscreen(w, () => lineChart(speedSeries, { ...speedOpts, still: true }).el) },
    gap: { label: "The gap, metre by metre (seconds)", note: notes.gap, render: (w) => offscreen(w, () => lineChart(gapSeries, { ...gapOpts, still: true }).el) },
    thr: { label: "Throttle", note: notes.thr, render: (w) => offscreen(w, () => lineChart(thrSeries, { ...thrOpts, still: true }).el) },
    map: circuit ? { label: "Who was faster where", note: notes.map, center: true, render: (w) => offscreen(Math.min(w, 340), () => trackMap(circuit, { ...mapOpts, size: 340 }).el) } : null,
  };
  const overallText = headline.querySelector("p").textContent;
  const slug = (t) => t.toLowerCase().replace("grand prix", "gp").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = (what) => () => `${slug(`${ev.name} ${SESSION_LABEL[key]}`)}-${a}-vs-${b}${what ? `-${what}` : ""}.png`;
  const picture = (parts) => () => makeImage({
    title: [{ text: a, color: colA }, { text: "  vs  " }, { text: b, color: colB }],
    subtitle: `${ev.name}, ${SESSION_LABEL[key]}: fastest laps compared`,
    headline: overallText,
    legend: [{ color: colA, text: `${a} ${driver(a).last}` }, { color: colB, dash: dashB, text: `${b} ${driver(b).last}` }],
    blocks: parts.map((k) => blocks[k]).filter(Boolean),
  });
  const all = ["speed", "gap", "thr", "map"];
  const saveRow = h("div", { class: "save-row" },
    imageButton({ label: "Download image", iconEl: icon("download", { size: 18 }), make: picture(all), filename: file("") }),
    canShareFiles() ? imageButton({ label: "Share image", iconEl: icon("share", { size: 18 }), make: picture(all), filename: file(""), mode: "share" }) : null);
  const saveOne = (k, what) => imageButton({ label: `Download the ${what} chart as an image`, iconEl: icon("download", { size: 20 }), make: picture([k]), filename: file(k), compact: true });
  const withSave = (sec, k, what) => { sec.querySelector(".section-head h2").append(saveOne(k, what)); return sec; };

  view.append(h("div", { class: "section-head" }, h("h2", {}, icon("gauge", { size: 24 }), "Fastest laps compared"),
    h("p", { class: "muted" }, race ? "Each driver's single quickest lap of the race, on top of each other." : "Each driver's quickest lap of the session, on top of each other.")), headline,
    h("div", { style: { display: "grid", gap: "6px" } }, saveRow,
      h("p", { class: "small muted" }, "Makes one picture with all four charts, ready for WhatsApp or X. Each chart also has its own download button.")));
  view.append(h("div", { class: "split" },
    withSave(section(["Speed", "gauge"], `${notes.speed} Drag or hover to move along the lap.`,
      h("div", { class: "panel", style: { display: "grid", gap: "10px" } }, keyLegend, speed.el)), "speed", "speed"),
    map ? withSave(section(["Who was faster where", "pin"], notes.map,
      h("div", { class: "panel" }, map.el, h("div", { style: { marginTop: "8px" } }, keyLegend.cloneNode(true)))), "map", "track map")
      : section(["Who was faster where", "pin"], notes.map, h("div", { class: "panel" }, h("p", { class: "muted" }, "Track map not available.")))));
  view.append(withSave(section(["The gap, metre by metre", "compare"], notes.gap,
    h("div", { class: "panel" }, gap.el)), "gap", "gap"));
  view.append(withSave(section(["Throttle", "bolt"], h("span", {}, notes.thr),
    h("div", { class: "panel" }, thr.el)), "thr", "throttle"));
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


// ---------- race head-to-head ----------
function cleanLaps(L) {
  const out = [];
  for (let i = 0; i < L.n.length; i++) {
    if (L.t[i] && L.n[i] > 1 && !L.pi[i] && !L.po[i] && (!L.ts[i] || /^1+$/.test(L.ts[i]))) out.push(L.t[i]);
  }
  return out;
}
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function raceBattle(sess, a, b, colA, colB, dashB) {
  const A = sess.laps[a], B = sess.laps[b];
  const rA = sess.results.find((r) => r.code === a), rB = sess.results.find((r) => r.code === b);
  const done = (r) => /^\d+$/.test(r.class || "");
  // gap on every lap both completed: session clock at the end of the lap (or summed lap times as a fallback)
  const clock = (L) => {
    if (L.st && L.st.some((v) => v !== null)) return Object.fromEntries(L.n.map((n, i) => [n, L.st[i]]));
    let acc = 0; return Object.fromEntries(L.n.map((n, i) => [n, (acc += L.t[i] || 0)]));
  };
  const cA = clock(A), cB = clock(B);
  const laps = A.n.filter((n) => n in cB && cA[n] !== null && cB[n] !== null);
  const gap = laps.map((n) => [n, +(cB[n] - cA[n]).toFixed(3)]);               // > 0: a ahead
  const pitA = A.n.filter((n, i) => A.pi[i]), pitB = B.n.filter((n, i) => B.pi[i]);
  const sc = A.n.filter((n, i) => /4/.test(A.ts[i] || ""));

  // headline facts
  const facts = [];
  const ahead = done(rA) && done(rB) ? (rA.pos < rB.pos ? a : b) : done(rA) ? a : done(rB) ? b : null;
  if (ahead) {
    const last = gap[gap.length - 1];
    const lapsDown = Math.abs((rA.laps || 0) - (rB.laps || 0));
    facts.push(done(rA) && done(rB)
      ? `${ahead} finished ahead, P${Math.min(rA.pos, rB.pos)} to P${Math.max(rA.pos, rB.pos)}, ${lapsDown ? `a lap${lapsDown > 1 ? "s" : ""} clear` : `by ${Math.abs(last?.[1] ?? 0).toFixed(1)}s`}.`
      : `${ahead} finished; ${ahead === a ? b : a} retired on lap ${(ahead === a ? rB : rA).laps}.`);
  }
  for (const r of [rA, rB]) {
    if (r.grid && done(r)) {
      const ch = r.grid - r.pos;
      facts.push(ch > 0 ? `${r.code} gained ${ch} place${ch > 1 ? "s" : ""} from P${r.grid} on the grid.` : ch < 0 ? `${r.code} lost ${-ch} place${ch < -1 ? "s" : ""} from P${r.grid} on the grid.` : `${r.code} finished where they started, P${r.grid}.`);
    }
  }
  const pA = median(cleanLaps(A)), pB = median(cleanLaps(B));
  if (pA && pB) {
    const d = pB - pA;
    facts.push(Math.abs(d) < 0.03 ? "Their race pace on clean laps was almost identical." : `On clean laps ${d > 0 ? a : b} was ${Math.abs(d).toFixed(2)}s a lap quicker (typical lap ${lapTime(Math.min(pA, pB))}).`);
  }
  const stops = (code, pits) => {
    const st = sess.stints?.[code] || [];
    return pits.length ? `${code} stopped ${pits.length === 1 ? "once" : `${pits.length} times`}, on lap${pits.length > 1 ? "s" : ""} ${pits.join(" and ")} (${st.map((x) => x.c).join(" → ")}).` : `${code} didn't stop.`;
  };
  facts.push(stops(a, pitA), stops(b, pitB));
  // biggest swing over 3 laps, with the likely reason
  let swing = null;
  for (let i = 3; i < gap.length; i++) {
    const d = gap[i][1] - gap[i - 3][1];
    if (!swing || Math.abs(d) > Math.abs(swing.d)) swing = { from: gap[i - 3][0], to: gap[i][0], d };
  }
  if (swing && Math.abs(swing.d) > 1.5) {
    const inRange = (xs) => xs.some((n) => n > swing.from - 1 && n <= swing.to);
    const who = swing.d > 0 ? a : b;
    const why = inRange(pitA) || inRange(pitB) ? "around the pit stops" : inRange(sc) ? "around a safety car" : "on track";
    facts.push(`The biggest swing came on laps ${swing.from}–${swing.to}, ${why}: ${who} gained ${Math.abs(swing.d).toFixed(1)}s.`);
  }

  const card = (r, c) => {
    const won = ahead === r.code;
    return h("div", { class: `battle-card${won ? " win" : ""}`, style: { "--tc": driver(r.code).color } },
      h("div", { class: "who-row" }, avatar(r.code, { size: 40 }), h("b", {}, r.code)),
      h("span", { class: "battle-pos" }, done(r) ? `P${r.pos}` : "DNF"),
      h("span", { class: "battle-line" }, icon("flag", { size: 14 }), r.grid ? `Started P${r.grid}` : "Start unknown",
        r.grid && done(r) && r.grid !== r.pos ? h("span", { class: `chip ${r.grid > r.pos ? "good" : "bad"}` }, `${r.grid > r.pos ? "▲" : "▼"}${Math.abs(r.grid - r.pos)}`) : null),
      h("span", { class: "battle-line" }, icon("tyre", { size: 14 }), (sess.stints?.[r.code] || []).map((x) => tyre(x.c)),
        `${Math.max(0, (sess.stints?.[r.code] || []).length - 1)} stop${(sess.stints?.[r.code] || []).length - 1 === 1 ? "" : "s"}`),
      r.points ? h("span", { class: "battle-line" }, icon("trophy", { size: 14 }), `${r.points} points`) : null);
  };

  const gapChart = lineChart([{ id: "gap", name: "gap", color: "var(--ink)", points: gap }], {
    height: 220, zero: 0, xLabel: "Lap", yFmt: (t) => `${t > 0 ? "+" : ""}${t.toFixed(0)}s`, aria: `Gap between ${a} and ${b} on every lap`,
    tooltip: (x) => {
      const p = gap.reduce((m, q) => (Math.abs(q[0] - x) < Math.abs(m[0] - x) ? q : m), gap[0]);
      const notes = [pitA.includes(p[0]) ? `${a} pitted` : "", pitB.includes(p[0]) ? `${b} pitted` : "", sc.includes(p[0]) ? "Safety car" : ""].filter(Boolean).join(", ");
      return `<b>Lap ${p[0]}</b><br>${p[1] >= 0 ? a : b} ahead by ${Math.abs(p[1]).toFixed(1)}s${notes ? `<br><span class="muted">${notes}</span>` : ""}`;
    },
  });
  const posChart = lineChart([
    { id: a, name: a, color: colA, points: A.n.map((n, i) => [n, A.p[i]]) },
    { id: b, name: b, color: colB, dash: dashB, points: B.n.map((n, i) => [n, B.p[i]]) }], {
    height: 200, invertY: true, yMin: 1, yMax: sess.results.length, yTicks: [1, 5, 10, 15, 20].filter((t) => t <= sess.results.length),
    yFmt: (t) => `P${t}`, xLabel: "Lap", labels: true, aria: `Positions of ${a} and ${b} on every lap`,
  });
  const total = Math.max(A.n[A.n.length - 1] || 0, B.n[B.n.length - 1] || 0);
  return [
    h("div", { class: "battle" }, card(rA, colA), card(rB, colB)),
    h("div", { class: "callout" }, noteList(facts, "chevron")),
    section(["The gap, lap by lap", "compare"], `Above the line ${a} is ahead, below it ${b} is. Jumps usually mean a pit stop or a safety car.`,
      h("div", { class: "panel" }, gapChart.el, pitMarks(pitA, pitB, a, b, colA, colB))),
    section(["Positions", "chequered"], "Where each of them ran on every lap.", h("div", { class: "panel" }, posChart.el)),
    section(["Tyres and pit stops", "tyre"], h("span", {}, "Each bar is one driver's race, coloured by ", term("compound", "tyre compound"), "."),
      h("div", { class: "panel" }, stintChart([a, b], sess.stints || {}, total))),
  ];
}

function pitMarks(pitA, pitB, a, b, colA, colB) {
  return h("div", { class: "legend", style: { marginTop: "8px" } },
    h("span", {}, icon("wrench", { size: 14 }), `${a} pitted: ${pitA.length ? pitA.map((n) => `lap ${n}`).join(", ") : "no stops"}`),
    h("span", {}, icon("wrench", { size: 14 }), `${b} pitted: ${pitB.length ? pitB.map((n) => `lap ${n}`).join(", ") : "no stops"}`));
}

function qualiBattle(sess, a, b) {
  const rA = sess.results.find((r) => r.code === a), rB = sess.results.find((r) => r.code === b);
  const rows = ["Q1", "Q2", "Q3"].map((name, i) => {
    const x = rA.q?.[i], y = rB.q?.[i];
    const diff = x && y ? y - x : null;
    return h("tr", {},
      h("td", {}, name),
      h("td", { class: "num", style: { fontWeight: diff !== null && diff > 0 ? 700 : 400 } }, x ? lapTime(x) : "Out"),
      h("td", { class: "num", style: { fontWeight: diff !== null && diff < 0 ? 700 : 400 } }, y ? lapTime(y) : "Out"),
      h("td", { class: "num" }, diff === null ? "" : `${diff > 0 ? a : b} by ${Math.abs(diff).toFixed(3)}s`));
  });
  const better = rA.pos && rB.pos ? (rA.pos < rB.pos ? a : b) : null;
  return section(["Qualifying battle", "timer"], better ? `${better} out-qualified ${better === a ? b : a}: P${Math.min(rA.pos, rB.pos)} vs P${Math.max(rA.pos, rB.pos)}. Each part of qualifying knocks out the slowest cars.` : null,
    h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, ["Part", a, b, "Quicker"].map((t, i) => h("th", { class: i ? "num" : "" }, t)))),
      h("tbody", {}, rows))));
}
