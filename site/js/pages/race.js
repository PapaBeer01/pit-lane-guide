import { gapBars, lineChart, driverSeries } from "../charts.js";
import { icon } from "../icons.js";
import { oddsSection, strategySection } from "../strategy.js";
import { upgradesSection } from "../upgrades.js";
import { driver, driverTag, empty, eventByRound, h, lapTime, load, localTime, noteList, reducedMotion, section, SESSION_LABEL, term, tyre, useSessionTeams } from "../ui.js";
import { predictionTable } from "./home.js";
import { teamArt } from "../media.js";
import { fastestLapCard, podiumCards, posterCard, quickestMap, sessionPicker, speedCard, tracks, tyreBars } from "../visuals.js";

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

  const track = (await tracks())[String(ev.round)];
  const poster = posterCard(ev, track);
  if (!key) return h("div", { class: "race-page" }, poster, empty("Nothing to show yet: this weekend hasn't started and predictions come closer to the time."));
  const picker = sessionPicker(ev, shown, done, key);

  const sess = done.includes(key) ? await load(`events/${ev.round}/${key}.json`) : null;
  useSessionTeams(sess);
  const pred = predicted.has(key) ? await load(`predictions/${ev.round}/${key}.json`) : null;
  const body = h("div", { style: { display: "grid", gap: "28px" } });

  if (sess) {
    const sStart = ev.sessions.find((s) => s.key === key)?.start;
    const w = sess.weather;
    const hero = await load(`events/${ev.round}/${key}_hero.json`);
    const race = key === "R" || key === "S";
    const top = sess.results.find((r) => r.pos === 1);
    const gap = race ? (r) => (r.pos === 1 ? "Leader" : raceTime(r, top))
      : (r) => { if (r.pos === 1) return key === "Q" || key === "SQ" ? "Pole" : "Fastest"; const g = gapTo(r, top); return g === null ? "" : `+${g.toFixed(3)}`; };
    const stage = h("div", { class: "stage" },
      h("div", { class: "stage-main" },
        h("div", { class: "round-pill" },
          h("span", { class: "chip" }, icon("calendar", { size: 14 }), localTime(sStart)),
          w ? h("span", { class: `chip ${w.rain ? "warn" : ""}` }, icon(w.rain ? "rain" : "sun", { size: 14 }), w.rain ? "Wet" : "Dry") : null,
          w ? h("span", { class: "chip" }, icon("thermo", { size: 14 }), `Air ${w.air}°C, track ${w.track}°C`) : null),
        podiumCards(sess.results, gap, { label: race ? "Podium" : key.startsWith("FP") ? "Fastest three" : "Top three" }),
        fastestLapCard(hero?.fastest || sess.fastest),
        h("div", { class: "duo" }, quickestMap(track, hero?.minis), speedCard(hero))),
      h("aside", { class: "stage-side" }, compactResults(sess, gap, race)));
    body.append(stage);
    if (race) {
      body.append(raceStory(sess));
      body.append(section(["Full results", "chequered"], "Starting position, places gained or lost, tyres used and points.", resultsTable(sess)));
      body.append(lapChart(sess));
      const pace = await load(`events/${ev.round}/${key}_pace.json`);
      if (pace) body.append(racePaceSection(pace, sess));
      if (Object.keys(sess.stints || {}).length) {
        const order = sess.results.map((r) => r.code);
        const total = Math.max(...Object.values(sess.laps).map((l) => l.n[l.n.length - 1] || 0));
        body.append(section(["Tyre strategy", "tyre"], h("span", {}, "Each bar is one driver's race. Colours show the ", term("compound", "tyre compound"), "; a new colour means a pit stop."),
          h("div", { class: "panel" }, tyreBars(order, sess.stints, total))));
      }
    } else {
      body.append(section(["Lap times", "chequered"], null, resultsTable(sess)));
      body.append(gapSection(sess));
      if (key.startsWith("FP")) {
        const lr = await load(`events/${ev.round}/${key}_pace.json`);
        if (lr?.pace?.length) body.append(longRunSection(lr));
      }
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
    if (pred.strategy) body.append(strategySection(pred.strategy, { actual: sc?.strategy || null, title: sess ? "Strategy: expected vs actual" : "Race strategy" }));
    if (pred.track) body.append(oddsSection(pred.track, { actual: sess ? (sess.flags || {}) : null }));
  }
  const upg = upgradesSection(await load(`events/${ev.round}/upgrades.json`), { title: "New parts at this race", open: 0 });
  if (upg) body.append(upg);
  return h("div", { class: "race-page" }, picker, poster, body);
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
    head = ["", "Driver", "Q1", "Q2", "Q3", "Gap"];
    row = (r) => {
      const g = gapTo(r, top);
      return [
        h("td", { class: "pos" }, r.pos ?? "–"),
        h("td", {}, driverTag(r.code, { full: true })),
        ...[0, 1, 2].map((i) => h("td", { class: "num" }, r.q?.[i] ? lapTime(r.q[i]) : "")),
        h("td", { class: "num" }, r.pos === 1 ? "Pole" : g !== null && r.pos > 1 ? `+${g.toFixed(3)}` : ""),
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

// Results at a glance: position, team, driver, gap. Leader picked out, retirements faded.
function compactResults(s, gap, race) {
  const out = (r) => race && r.class && !/^\d+$/.test(r.class);
  return h("section", { class: "cr", "aria-label": "Results" },
    h("div", { class: "cr-head" }, h("span", {}, "Pos"), h("span", {}, "Driver"), h("span", {}, race ? "Time" : "Gap")),
    h("ol", { class: "cr-list" }, s.results.map((r, i) => h("li", {
      class: `cr-row${r.pos === 1 ? " p1" : ""}${out(r) ? " out" : ""}`, style: { "--tc": driver(r.code).color, animationDelay: `${Math.min(i, 12) * 25}ms` },
    },
      h("span", { class: "cr-pos" }, out(r) ? "–" : r.pos ?? "–"),
      h("a", { class: "cr-who", href: `#/driver/${r.code}` }, teamArt(driver(r.code).team, { size: 22 }), h("b", {}, r.code), h("small", {}, driver(r.code).last || "")),
      h("span", { class: "cr-gap" }, out(r) ? "Out" : gap(r), s.fastest?.code === r.code ? h("span", { class: "cr-fl", title: "Fastest lap" }, icon("timer", { size: 14 })) : null)))));
}

// Gap to the top: in qualifying, the driver's last part (Q1, Q2 or Q3) against the pole-sitter's time in that same part
function gapTo(r, top) {
  if (!r || !top) return null;
  const q = r.q || [];
  for (let i = q.length - 1; i >= 0; i--) if (q[i] && top.q?.[i]) return q[i] - top.q[i];
  return r.best && top.best ? r.best - top.best : null;
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


// ---------- practice long runs: the laps teams use to rehearse the race ----------
const TYRE_NAME = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" };
function longRunSection(p) {
  const rows = p.pace;
  const worst = Math.max(...rows.map((r) => r.gap), 0.1);
  let showAll = false;
  const list = h("div", { class: "pace-list" });
  const more = h("button", { class: "grid-more", type: "button", style: { color: "var(--ink)", borderColor: "var(--line-strong)" } });
  const fill = () => {
    list.replaceChildren(...(showAll ? rows : rows.slice(0, 10)).map((r) => {
      const w = `${Math.max(2, (1 - r.gap / worst) * 100)}%`;
      const bar = h("i", { style: { width: reducedMotion() ? w : "0%" } });
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = w; }));
      return h("div", { class: `pace-row${r.rank === 1 ? " top" : ""}`, style: { "--tc": driver(r.code).color } },
        h("span", { class: "pace-rank" }, r.rank),
        driverTag(r.code),
        h("span", { class: "pace-track", role: "img", "aria-label": `${r.code}: ${r.gap === 0 ? "quickest" : `${r.gap.toFixed(3)} seconds a lap slower`}` }, bar),
        h("span", { class: "pace-val" },
          r.gap === 0 ? h("b", { style: { color: "var(--purple)" } }, "Quickest") : `+${r.gap.toFixed(3)}s/lap`,
          r.run_laps ? h("small", { style: { display: "inline-flex", gap: "4px", alignItems: "center" } }, tyre(r.run_c), `${r.run_laps}-lap run`) : null));
    }));
    more.hidden = rows.length <= 10;
    more.replaceChildren(icon(showAll ? "up" : "down", { size: 16 }), showAll ? "Show top 10" : `Show all ${rows.length}`);
  };
  more.addEventListener("click", () => { showAll = !showAll; fill(); });
  fill();

  // plain-language takeaways
  const longest = Object.entries(p.runs).flatMap(([code, rs]) => rs.map((r) => ({ code, ...r }))).sort((a, b) => b.laps - a.laps)[0];
  const facts = [`${rows[0].code} was quickest on long runs${rows[1] ? `, ${rows[1].gap.toFixed(3)}s a lap ahead of ${rows[1].code}` : ""}.`];
  if (longest) facts.push(`The longest run was ${longest.code}'s: ${longest.laps} laps on ${(TYRE_NAME[longest.c] || "unknown").toLowerCase()} tyres.`);
  facts.push("Fuel loads and engine settings differ between teams in practice, so small gaps here can flip on Sunday.");

  // lap-by-lap chart of each driver's longest run
  const longestRun = (c) => (p.runs[c] || []).reduce((a, b) => (!a || b.laps > a.laps ? b : a), null);
  const codes = rows.map((r) => r.code).filter((c) => longestRun(c));
  let picked = new Set(codes.slice(0, 3));
  const chartBox = h("div");
  const chips = h("div", { class: "toggle-chips", role: "group", "aria-label": "Drivers on the long-run chart" });
  const draw = () => {
    chips.replaceChildren(...codes.map((c) => h("button", {
      class: "toggle-chip", type: "button", "aria-pressed": String(picked.has(c)), style: { "--tc": driver(c).color },
      onclick: () => { if (picked.has(c)) { if (picked.size > 1) picked.delete(c); } else picked.add(c); draw(); },
    }, h("i"), c)));
    const series = [...picked].map((c) => driverSeries(c, longestRun(c).times.map((t, i) => [i + 1, t])));
    const all = series.flatMap((x) => x.points.map((q) => q[1])).filter((t) => t);
    if (!all.length) { chartBox.replaceChildren(h("p", { class: "muted" }, "No long runs to show.")); return; }
    const chart = lineChart(series, {
      height: 240, yMin: Math.floor(Math.min(...all) * 2) / 2 - 0.2, yMax: Math.ceil(Math.max(...all) * 2) / 2 + 0.2,
      xLabel: "Lap", labels: true, xFmt: (t) => `${t}`,
      yFmt: (t) => lapTime(t).replace(/(\.\d)\d\d$/, "$1"), aria: "Lap times through each chosen driver's longest run",
      tooltip: (x) => {
        const k = Math.round(x);
        const lines = [...picked].map((c) => { const r = longestRun(c); const t = r.times[k - 1]; return t ? `${c}: ${lapTime(t)} (${TYRE_NAME[r.c] || ""})` : null; }).filter(Boolean);
        return `<b>Lap ${k} of the run</b><br>${lines.join("<br>") || "No lap"}`;
      },
    });
    chartBox.replaceChildren(chart.el);
  };
  draw();

  return h("div", { style: { display: "grid", gap: "28px" } },
    section(["Long-run pace", "gauge"], h("span", {}, "Teams rehearse the race in practice by running several laps in a row on one set of tyres. This ranks drivers on those runs, in seconds per lap off the quickest. ", p.note),
      h("div", { class: "callout" }, noteList(facts, "bolt")),
      h("div", { class: "panel", style: { display: "grid", gap: "12px" } }, list, more)),
    section(["Long runs lap by lap", "timer"], "Each line is one driver's longest run. A flat line means the tyres held on; a line rising to the right means they were wearing out. Pick drivers to compare.",
      h("div", { class: "panel", style: { display: "grid", gap: "12px" } }, chips, chartBox)));
}

// ---------- race pace from the actual race ----------
function racePaceSection(p, sess) {
  const rows = p.pace;
  const worst = Math.max(...rows.map((r) => r.gap), 0.1);
  let showAll = false;
  const list = h("div", { class: "pace-list" });
  const more = h("button", { class: "grid-more", type: "button", style: { color: "var(--ink)", borderColor: "var(--line-strong)" } });
  const fill = () => {
    list.replaceChildren(...(showAll ? rows : rows.slice(0, 10)).map((r) => {
      const bar = h("i", { style: { width: reducedMotion() ? `${Math.max(2, (1 - r.gap / worst) * 100)}%` : "0%" } });
      const diff = r.finished && r.pos ? r.rank - r.pos : null;      // > 0: finished higher than pace suggests
      const row = h("div", { class: `pace-row${r.rank === 1 ? " top" : ""}`, style: { "--tc": driver(r.code).color } },
        h("span", { class: "pace-rank" }, r.rank),
        driverTag(r.code),
        h("span", { class: "pace-track", role: "img", "aria-label": `${r.code}: ${r.gap === 0 ? "quickest" : `${r.gap.toFixed(3)} seconds a lap slower`}` }, bar),
        h("span", { class: "pace-val" },
          r.gap === 0 ? h("b", { style: { color: "var(--purple)" } }, "Quickest") : `+${r.gap.toFixed(3)}s/lap`,
          h("small", {}, r.finished ? `Finished P${r.pos}` : "Did not finish",
            diff ? h("span", { class: diff > 0 ? "up" : "down" }, ` ${diff > 0 ? "▲" : "▼"}${Math.abs(diff)}`) : null)));
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${Math.max(2, (1 - r.gap / worst) * 100)}%`; }));
      return row;
    }));
    more.replaceChildren(icon(showAll ? "up" : "down", { size: 16 }), showAll ? "Show top 10" : `Show all ${rows.length}`);
  };
  more.addEventListener("click", () => { showAll = !showAll; fill(); });
  fill();

  // plain-language takeaways
  const facts = [];
  const top = rows[0];
  if (top) {
    facts.push(top.code === p.winner
      ? `${top.code} had the best race pace and won.`
      : `${top.code} had the best race pace but ${top.finished ? `finished P${top.pos}` : "didn't finish"}; ${p.winner} won with the ${ordinalWord(rows.find((r) => r.code === p.winner)?.rank)} best pace.`);
  }
  const over = rows.filter((r) => r.finished && r.pos).map((r) => ({ ...r, d: r.rank - r.pos })).sort((a, b) => b.d - a.d);
  if (over[0] && over[0].d >= 3) facts.push(`${over[0].code} finished P${over[0].pos} with only the ${ordinalWord(over[0].rank)} best pace: strategy, a strong start or track position made the difference.`);
  const under = over[over.length - 1];
  if (under && under.d <= -3) facts.push(`${under.code} had the ${ordinalWord(under.rank)} best pace but finished P${under.pos}: time was lost somewhere else, like a slow stop, traffic or a safety car at the wrong moment.`);

  // lap-time chart: pick drivers
  const codes = rows.map((r) => r.code);
  const finishers = sess.results.filter((r) => /^\d+$/.test(r.class || "")).map((r) => r.code);
  let picked = new Set([...finishers.slice(0, 3), top?.code].filter(Boolean));
  const chartBox = h("div");
  const chips = h("div", { class: "toggle-chips", role: "group", "aria-label": "Drivers on the lap-time chart" });
  const drawChart = () => {
    chips.replaceChildren(...codes.map((c) => h("button", {
      class: "toggle-chip", type: "button", "aria-pressed": String(picked.has(c)), style: { "--tc": driver(c).color },
      onclick: () => { if (picked.has(c)) { if (picked.size > 1) picked.delete(c); } else picked.add(c); drawChart(); },
    }, h("i"), c)));
    const series = [...picked].map((c) => driverSeries(c, (p.laps[c] || []).map(([n, t]) => [n, t])));
    const all = series.flatMap((x) => x.points.map((q) => q[1]));
    if (!all.length) { chartBox.replaceChildren(h("p", { class: "muted" }, "No clean laps to show.")); return; }
    const sorted = [...all].sort((a, b) => a - b);
    const lo = sorted[0], hi = sorted[Math.floor(sorted.length * 0.97)];
    const chart = lineChart(series, {
      height: 260, yMin: Math.floor(lo * 2) / 2 - 0.3, yMax: Math.ceil(hi * 2) / 2 + 0.3, xLabel: "Lap", labels: true,
      yFmt: (t) => lapTime(t).replace(/(\.\d)\d\d$/, "$1"), aria: "Lap times on clean laps for the chosen drivers",
      tooltip: (x) => {
        const lap = Math.round(x);
        const lines = [...picked].map((c) => { const q = (p.laps[c] || []).find((v) => v[0] === lap); return q ? `${c}: ${lapTime(q[1])}` : null; }).filter(Boolean);
        return `<b>Lap ${lap}</b><br>${lines.join("<br>") || "No clean laps"}`;
      },
    });
    chartBox.replaceChildren(chart.el);
  };
  drawChart();

  // stints: average clean lap and wear per tyre set
  const stintCodes = showAllStints(rows, p);
  let allStints = false;
  const stintBox = h("div", { style: { display: "grid", gap: "12px" } });
  const stintMore = h("button", { class: "grid-more", type: "button", style: { color: "var(--ink)", borderColor: "var(--line-strong)" } });
  const drawStints = () => {
    stintBox.replaceChildren(stintList(allStints ? stintCodes : stintCodes.slice(0, 8), p), stintCodes.length > 8 ? stintMore : "");
    stintMore.replaceChildren(icon(allStints ? "up" : "down", { size: 16 }), allStints ? "Show fewer" : `Show all ${stintCodes.length}`);
  };
  stintMore.addEventListener("click", () => { allStints = !allStints; drawStints(); });
  drawStints();

  return racePaceView(p, facts, list, more, chips, chartBox, stintBox);
}

function stintList(codes, p) {
  return h("div", { class: "stint-rows" }, codes.map((code) => h("div", { class: "stint-row" },
    driverTag(code),
    h("div", { class: "stint-cells" }, (p.stints[code] || []).map((st) => h("span", { class: "stint-cell" },
      tyre(st.c), h("b", {}, lapTime(st.avg)), `${st.laps} laps`,
      st.wear !== null && st.wear !== undefined ? h("span", { style: { color: st.wear > 0.08 ? "var(--red)" : st.wear > 0.04 ? "var(--amber)" : "var(--green)" } },
        st.wear <= 0.005 ? "barely wore" : `+${st.wear.toFixed(2)}s/lap wear`) : null))))));
}

function racePaceView(p, facts, list, more, chips, chartBox, stintRows) {
  return h("div", { style: { display: "grid", gap: "28px" } },
    section(["Race pace", "gauge"], h("span", {}, "Who was really quickest over the race distance, in seconds per lap. ", p.note),
      h("div", { class: "callout" }, noteList(facts, "bolt")),
      h("div", { class: "panel", style: { display: "grid", gap: "12px" } }, list, more)),
    section(["Lap times", "timer"], "Pick drivers to compare their lap times through the race. Laps get quicker as fuel burns off and slower as tyres wear; a drop usually means fresh tyres after a stop.",
      h("div", { class: "panel", style: { display: "grid", gap: "12px" } }, chips, chartBox)),
    section(["Pace on each set of tyres", "tyre"], h("span", {}, "Each driver's average clean lap on every tyre set, and how much time the tyres lost per lap as they wore (after allowing for fuel burning off). See ", term("deg", "tyre degradation"), "."),
      h("div", { class: "panel" }, stintRows)));
}

function showAllStints(rows, p) { return rows.map((r) => r.code).filter((c) => p.stints[c]); }
function ordinalWord(n) {
  if (!n) return "";
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
