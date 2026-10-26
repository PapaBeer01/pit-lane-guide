import { gapBars, lineChart, driverSeries, stintChart } from "../charts.js";
import { icon } from "../icons.js";
import { driver, driverTag, empty, eventByRound, h, lapTime, load, localTime, noteList, section, SESSION_LABEL, term, tyre } from "../ui.js";
import { predictionTable } from "./home.js";

export const title = (r) => { const ev = eventByRound(r.args[0]); return ev ? ev.name : "Race"; };

export default async function race(route) {
  const ev = eventByRound(route.args[0]);
  if (!ev) return empty("That race isn't on this season's calendar.", h("a", { href: "#/races" }, "See all races"));
  const keys = ev.sessions.map((s) => s.key);
  const done = ev.sessions.filter((s) => s.done).map((s) => s.key);
  const predIndex = await load("predictions/index.json");
  const predicted = new Set((predIndex?.items || []).filter((i) => i.round === ev.round).map((i) => i.target));
  const shown = keys.filter((k) => done.includes(k) || predicted.has(k));
  let key = route.args[1] && shown.includes(route.args[1]) ? route.args[1] : (done[done.length - 1] || shown[0]);

  const head = h("div", { style: { display: "grid", gap: "6px" } },
    h("p", { class: "muted" }, h("a", { href: "#/races" }, "All races"), `, round ${ev.round}`),
    h("h1", {}, ev.name),
    h("p", { class: "muted" }, `${ev.location}, ${ev.country}${ev.format === "sprint" ? ", sprint weekend" : ""}`));
  if (!key) return h("div", { style: { display: "grid", gap: "20px" } }, head, empty("Nothing to show yet: this weekend hasn't started and predictions come closer to the time."));

  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Session" },
    shown.map((k) => h("a", {
      class: "tab", role: "tab", href: `#/race/${ev.round}/${k}`, "aria-selected": String(k === key), style: { textDecoration: "none" },
    }, icon(done.includes(k) ? "check" : "gauge", { size: 15 }), SESSION_LABEL[k], done.includes(k) ? null : h("span", { class: "tag" }, "prediction"))));

  const sess = done.includes(key) ? await load(`events/${ev.round}/${key}.json`) : null;
  const pred = predicted.has(key) ? await load(`predictions/${ev.round}/${key}.json`) : null;
  const body = h("div", { style: { display: "grid", gap: "28px" } });

  if (sess) {
    const sStart = ev.sessions.find((s) => s.key === key)?.start;
    const w = sess.weather;
    body.append(h("div", { class: "round-pill" },
      h("span", { class: "chip" }, icon("calendar", { size: 14 }), localTime(sStart)),
      w ? h("span", { class: `chip ${w.rain ? "warn" : ""}` }, icon(w.rain ? "rain" : "sun", { size: 14 }), w.rain ? "Wet" : "Dry") : null,
      w ? h("span", { class: "chip" }, icon("thermo", { size: 14 }), `Air ${w.air}°C, track ${w.track}°C`) : null));
    if (key === "R" || key === "S") {
      body.append(raceStory(sess));
      body.append(section(["Results", "chequered"], null, resultsTable(sess)));
      body.append(lapChart(sess));
      if (Object.keys(sess.stints || {}).length) {
        const order = sess.results.map((r) => r.code);
        const total = Math.max(...Object.values(sess.laps).map((l) => l.n[l.n.length - 1] || 0));
        body.append(section(["Tyre strategy", "tyre"], h("span", {}, "Each bar is one driver's race. Colours show the ", term("compound", "tyre compound"), "; a new colour means a pit stop."),
          h("div", { class: "panel" }, stintChart(order, sess.stints, total))));
      }
    } else {
      body.append(section(["Results", "chequered"], null, resultsTable(sess)));
      body.append(gapSection(sess));
    }
    if (sess.telemetry?.length) {
      const top = sess.results.filter((r) => r.pos).slice(0, 2).map((r) => r.code);
      body.append(h("div", { class: "callout" },
        h("p", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, icon("compare", { size: 18 }), "Want to see where drivers gained time? ",
          h("a", { href: `#/compare?r=${ev.round}&s=${key}&a=${top[0]}&b=${top[1]}` }, `Compare ${top[0]} and ${top[1]} lap by lap`), ".")));
    }
  }
  if (pred) {
    const acc = await load("accuracy.json");
    const sc = acc?.sessions?.find((x) => x.round === ev.round && x.target === key);
    const made = pred.made_after === "pre-weekend" ? "before the weekend" : `after ${SESSION_LABEL[pred.made_after]}`;
    body.append(section([sess ? "Our prediction vs what happened" : "Our prediction", "gauge"],
      h("span", {}, `Made ${made}. `, pred.backfilled ? "This is a backtest: worked out later, using only data from before the session. " : "",
        sess ? "The yellow mark is where each driver actually finished." : "It updates after each session until this one starts."),
      sc ? h("div", { class: "callout" }, h("p", { style: { display: "flex", gap: "8px" } }, icon(sc.pick_correct ? "check" : "target", { size: 18 }), sc.note)) : null,
      !sess ? noteList(pred.notes) : null,
      predictionTable(pred, sess)));
  }
  requestAnimationFrame(() => tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" }));
  return h("div", { style: { display: "grid", gap: "20px" } }, head, tabs, body);
}


function resultsTable(s) {
  const k = s.key;
  const top = s.results.find((r) => r.pos === 1);
  let head, row;
  if (k === "R" || k === "S") {
    head = ["", "Driver", "Grid", "Time / gap", "Tyres", "Points"];
    row = (r) => {
      const change = r.grid && r.pos && (r.class || "").match(/^\d+$/) ? r.grid - r.pos : null;
      return [
        h("td", { class: "pos" }, (r.class || "").match(/^\d+$/) ? r.pos : "–"),
        h("td", {}, driverTag(r.code, { full: true })),
        h("td", { class: "num" }, r.grid ?? "–", change ? h("span", { class: `small ${change > 0 ? "chip good" : "chip bad"}`, style: { marginLeft: "6px", padding: "0 6px" }, "aria-label": `${change > 0 ? "gained" : "lost"} ${Math.abs(change)} places` }, `${change > 0 ? "▲" : "▼"}${Math.abs(change)}`) : null),
        h("td", { class: "num" }, raceTime(r, top)),
        h("td", {}, h("span", { style: { display: "inline-flex", gap: "3px" } }, (s.stints?.[r.code] || []).map((x) => tyre(x.c)))),
        h("td", { class: "num" }, r.points ? r.points : ""),
      ];
    };
  } else if (k === "Q" || k === "SQ") {
    const pole = top ? Math.min(...(top.q || []).filter(Boolean)) : null;
    head = ["", "Driver", "Q1", "Q2", "Q3", "Gap"];
    row = (r) => {
      const best = Math.min(...(r.q || []).filter(Boolean));
      return [
        h("td", { class: "pos" }, r.pos ?? "–"),
        h("td", {}, driverTag(r.code, { full: true })),
        ...[0, 1, 2].map((i) => h("td", { class: "num" }, r.q?.[i] ? lapTime(r.q[i]) : "")),
        h("td", { class: "num" }, isFinite(best) && pole && r.pos > 1 ? `+${(best - pole).toFixed(3)}` : r.pos === 1 ? "Pole" : ""),
      ];
    };
  } else {
    const best = top?.best;
    head = ["", "Driver", "Best lap", "Gap", "Laps"];
    row = (r) => [
      h("td", { class: "pos" }, r.pos ?? "–"),
      h("td", {}, driverTag(r.code, { full: true })),
      h("td", { class: "num" }, lapTime(r.best)),
      h("td", { class: "num" }, r.best && best && r.pos > 1 ? `+${(r.best - best).toFixed(3)}` : ""),
      h("td", { class: "num" }, r.laps ?? ""),
    ];
  }
  return h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
    h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { scope: "col", class: i > 1 ? "num" : "" }, t)))),
    h("tbody", {}, s.results.map((r) => h("tr", { class: (r.class && !/^\d+$/.test(r.class) && (k === "R" || k === "S")) ? "dnf" : r.pos === 1 ? "p1" : "" }, row(r))))));
}

function raceTime(r, top) {
  if (r.class && !/^\d+$/.test(r.class)) return r.status === "Retired" ? `Out, lap ${r.laps}` : (r.status || "Out");
  if (r.pos === 1) return lapTime(r.time).replace(/^(\d+):/, (m, mm) => `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, "0")}:`);
  if (top && r.laps < top.laps) { const d = top.laps - r.laps; return `+${d} lap${d > 1 ? "s" : ""}`; }
  return r.time !== null && r.time !== undefined ? `+${r.time.toFixed(3)}s` : "";
}

function raceStory(s) {
  const res = s.results;
  const winner = res.find((r) => r.pos === 1);
  const finishers = res.filter((r) => /^\d+$/.test(r.class || ""));
  const gainer = [...finishers].sort((a, b) => (b.grid - b.pos) - (a.grid - a.pos))[0];
  const out = res.filter((r) => r.class && !/^\d+$/.test(r.class));
  const items = [];
  const li = (ic, color, ...kids) => h("li", {}, h("span", { class: "ic", style: { color } }, icon(ic, { size: 16 })), h("span", {}, ...kids));
  if (winner) items.push(li("trophy", "var(--flag)", driverTag(winner.code), ` won from ${winner.grid === 1 ? "pole position" : `P${winner.grid} on the grid`}.`));
  if (gainer && gainer.grid - gainer.pos >= 3) items.push(li("up", "var(--green)", driverTag(gainer.code), ` made up the most places: P${gainer.grid} to P${gainer.pos}.`));
  const f = s.flags || {};
  if (f.sc || f.vsc || f.red) {
    const bits = [];
    if (f.sc) bits.push(`${f.sc} safety car period${f.sc > 1 ? "s" : ""}`);
    if (f.vsc) bits.push(`${f.vsc} virtual safety car${f.vsc > 1 ? "s" : ""}`);
    if (f.red) bits.push("a red flag");
    items.push(li("alert", "var(--amber)", `${bits.join(", ")} bunched the field up. `, term("sc", "What's a safety car?")));
  }
  if (out.length) items.push(li("wrench", "var(--red)", `${out.length} ${out.length === 1 ? "car" : "cars"} didn't finish: `, out.map((r, i) => [i ? ", " : "", driverTag(r.code)])));
  if (s.fastest) items.push(li("timer", "var(--purple)", term("fastest", "Fastest lap"), ": ", driverTag(s.fastest.code), ` with ${lapTime(s.fastest.time)}${s.fastest.lap ? ` on lap ${s.fastest.lap}` : ""}.`));
  return section(["The race in short", "flag"], null, h("div", { class: "panel" }, h("ul", { class: "notes" }, items)));
}

function lapChart(s) {
  const codes = s.results.map((r) => r.code);
  let follow = s.results[0]?.code;
  const holder = h("div");
  const select = h("select", { class: "select", "aria-label": "Follow a driver", onchange: (e) => { follow = e.target.value; draw(); } },
    codes.map((c) => h("option", { value: c }, `${c}  ${driver(c).name}`)));
  const draw = () => {
    const series = codes.map((c) => driverSeries(c, (s.laps[c]?.n || []).map((n, i) => [n, s.laps[c].p[i]]), { width: c === follow ? 3 : 1.5 }));
    // draw the followed driver last so it sits on top
    series.sort((a, b) => (a.id === follow) - (b.id === follow));
    const chart = lineChart(series, {
      height: 340, invertY: true, yMin: 1, yMax: codes.length, yTicks: [1, 5, 10, 15, 20].filter((t) => t <= codes.length),
      yFmt: (t) => `P${t}`, xLabel: "Lap", labels: false, highlight: follow, aria: `Position of ${follow} on every lap`,
      tooltip: (x) => {
        const lap = Math.round(x);
        const order = codes.map((c) => { const L = s.laps[c]; const i = L?.n.indexOf(lap); return i >= 0 ? [c, L.p[i]] : null; })
          .filter((v) => v && v[1]).sort((a, b) => a[1] - b[1]);
        const me = order.find((o) => o[0] === follow);
        return `<b>Lap ${lap}</b><br>${follow}: ${me ? `P${me[1]}` : "out"}<br><span class="muted">Leader: ${order[0]?.[0] || "–"}</span>`;
      },
    });
    holder.replaceChildren(chart.el);
  };
  draw();
  return section(["Lap by lap", "compare"], "How the order changed through the race. Pick a driver to follow; everyone else fades into the background.",
    h("div", { class: "panel", style: { display: "grid", gap: "12px" } }, h("label", { class: "field" }, "Follow a driver", select), holder));
}

function gapSection(s) {
  const rows = s.results.filter((r) => r.best).map((r) => r.best);
  if (!rows.length) return h("div");
  const best = Math.min(...rows);
  const items = s.results.filter((r) => r.best).map((r) => ({ code: r.code, value: r.best - best }));
  const fp = s.key.startsWith("FP");
  return section(["Gap to the fastest lap", "timer"], fp
      ? h("span", {}, "Practice times can mislead: teams carry different fuel loads and test different things. Look at ", term("longrun", "long runs"), " for race pace.")
      : "How far each driver's best lap was from the fastest. Tenths of a second separate whole rows of the grid.",
    h("div", { class: "panel" }, gapBars(items)));
}
