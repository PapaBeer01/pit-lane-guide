import { avatar, helmet } from "../avatars.js";
import { icon } from "../icons.js";
import { oddsSection, strategySection } from "../strategy.js";
import { animatedNumber, ctx, driver, driverTag, empty, h, lastCompleted, liveCountdown, load, localTime, nextEvent, noteList, pct, probBar, rangeBar, reducedMotion, section, SESSION_LABEL, term, tzName, useSessionTeams } from "../ui.js";

export const title = () => "This weekend";

export default async function home() {
  const ev = nextEvent();
  if (!ev) return empty("The season calendar isn't available yet.");
  const targets = ev.sessions.filter((s) => ["SQ", "S", "Q", "R"].includes(s.key)).map((s) => s.key);
  const [preds, sessions, forecast, form] = await Promise.all([
    Promise.all(targets.map(async (t) => [t, await load(`predictions/${ev.round}/${t}.json`)])).then(Object.fromEntries),
    Promise.all(ev.sessions.filter((s) => s.done).map(async (s) => [s.key, await load(`events/${ev.round}/${s.key}.json`)])).then(Object.fromEntries),
    load(`events/${ev.round}/forecast.json`),
    load("form.json"),
  ]);
  // this weekend's teams (FP1 left out: teams lend cars to reserve drivers there)
  useSessionTeams(...Object.entries(sessions).filter(([k]) => k !== "FP1").map(([, s]) => s));
  const trouble = Object.fromEntries((form?.drivers || []).map((d) => [d.code, d.quali_fail]));
  const troubleLine = Math.max(0.15, 1.8 * (form?.grid?.quali_fail || 0.08));

  const raceKey = ["S", "R"].find((k) => targets.includes(k) && !sessions[k]) || "R";
  const qualiKey = raceKey === "S" ? "SQ" : "Q";
  const qualiDone = sessions[qualiKey];
  const racePred = preds[raceKey];
  const qualiPred = preds[qualiKey];

  let gridRows, gridKind;
  if (qualiDone) {
    gridRows = qualiDone.results.filter((r) => r.pos).map((r) => ({ code: r.code, sub: driver(r.code).team }));
    gridKind = "actual";
  } else if (qualiPred) {
    gridRows = qualiPred.drivers.map((d) => ({ code: d.code, sub: `${pct(d.p_pole)} pole`, risk: (trouble[d.code] || 0) >= troubleLine }));
    gridKind = "predicted";
  }

  const first = ev.sessions.find((s) => !s.done);
  const grid = gridRows ? startingGrid(gridRows, gridKind, raceKey) : null;

  const hero = h("section", { class: "hero", "aria-labelledby": "ev-title" },
    h("div", { class: "hero-head" },
      h("div", { class: "round-pill" },
        h("span", { class: "chip" }, `Round ${ev.round} of ${ctx.season.events.length}`),
        ev.format === "sprint" ? h("span", { class: "chip best" }, icon("bolt", { size: 14 }), "Sprint weekend") : null),
      h("h1", { id: "ev-title" }, ev.name),
      h("div", { class: "hero-meta" },
        h("span", {}, icon("pin", { size: 18 }), `${ev.location}, ${ev.country}`),
        first ? h("span", {}, icon("timer", { size: 18 }), `${SESSION_LABEL[first.key]} in`, liveCountdown(first.start)) : null)),
    grid ? startLights(grid.el, grid.reveal) : null,
    h("div", { class: "hero-body" },
      grid ? grid.el : null,
      racePred ? favourites(racePred, qualiDone ? null : qualiPred, raceKey) : null));

  const view = h("div", { style: { display: "grid", gap: "34px" } }, hero);
  view.append(predictionsSection(ev, targets, preds, sessions));
  const gp = preds.R;
  if (gp?.strategy && !sessions.R) view.append(strategySection(gp.strategy, { title: "How the race could be won: strategy" }));
  if (gp?.track && !sessions.R) view.append(oddsSection(gp.track));
  view.append(h("div", { class: "split" }, scheduleSection(ev, sessions, forecast), await lastRaceSection()));
  return view;
}

// F1 start sequence: five red lights come on one by one, then go out and the grid rolls in.
function startLights(gridEl, reveal) {
  let seen = false;
  try { seen = sessionStorage.getItem("lights") === "1"; sessionStorage.setItem("lights", "1"); } catch { /* storage blocked: just play it */ }
  if (seen || reducedMotion()) { requestAnimationFrame(reveal); return null; }
  gridEl.classList.add("waiting");
  const lamps = [];
  const cols = Array.from({ length: 5 }, () => {
    const a = h("span", { class: "lamp" }), b = h("span", { class: "lamp" });
    lamps.push([a, b]);
    return h("span", { class: "light-col" }, a, b);
  });
  const caption = h("div", { class: "lights-caption", "aria-live": "polite" }, "");
  const wrap = h("div", { class: "lights-wrap", role: "img", "aria-label": "Start lights", onclick: () => done() },
    h("div", { class: "lights" }, cols), caption);
  let finished = false;
  const timers = [];
  function done() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    lamps.flat().forEach((l) => l.classList.remove("on"));
    caption.textContent = "Lights out and away we go";
    gridEl.classList.remove("waiting");
    reveal();
    setTimeout(() => wrap.classList.add("gone"), 1400);
  }
  lamps.forEach((pair, i) => timers.push(setTimeout(() => pair.forEach((l) => l.classList.add("on")), 500 + i * 550)));
  timers.push(setTimeout(done, 500 + 5 * 550 + 400 + Math.random() * 700));
  return wrap;
}

function startingGrid(rows, kind, raceKey) {
  const slots = h("div", { class: "slots" });
  let showAll = false;
  const wrap = h("div", { class: "grid-wrap" });
  const fill = () => {
    const list = showAll ? rows : rows.slice(0, 10);
    slots.replaceChildren(...list.map((r, i) => {
      const d = driver(r.code);
      return h("div", { class: `slot${i === 0 ? " pole" : ""}`, style: { animationDelay: `${i * 70}ms`, "--tc": d.color }, title: d.name },
        helmet(r.code, { size: 40 }),
        h("span", { class: "p" }, i + 1),
        h("span", { class: "code" }, h("i"), r.code),
        h("span", { class: "sub" }, r.risk ? icon("wrench", { size: 13, label: "Recent qualifying trouble" }) : null, r.sub));
    }));
    btn.replaceChildren(icon(showAll ? "up" : "down", { size: 16 }), showAll ? "Show top 10" : `Show all ${rows.length}`);
    btn.setAttribute("aria-expanded", String(showAll));
  };
  const btn = h("button", { class: "grid-more", type: "button", onclick: () => { wrap.classList.remove("reveal"); showAll = !showAll; fill(); } });
  const label = raceKey === "S" ? "sprint" : "race";
  wrap.append(
    h("div", { class: "grid-title" },
      h("h2", {}, kind === "actual" ? `Starting grid for the ${label}` : `Predicted grid for the ${label}`),
      h("span", {}, kind === "actual" ? "From qualifying" : "From our qualifying prediction")),
    h("div", { class: "startline", "aria-hidden": "true" }),
    slots, btn,
    h("p", { class: "grid-note" }, kind === "actual"
      ? "Late grid penalties can still move drivers back before the start."
      : "Cars line up two by two in qualifying order. A spanner marks a driver with recent qualifying trouble."));
  fill();
  return { el: wrap, reveal: () => wrap.classList.add("reveal") };
}

function favourites(racePred, qualiPred, raceKey) {
  const by = (arr, f) => [...arr].sort((a, b) => b[f] - a[f])[0];
  const win = by(racePred.drivers, "p_win");
  const fl = by(racePred.drivers, "p_fastest");
  const risk = [...racePred.drivers].sort((a, b) => a.p_finish - b.p_finish)[0];
  const cards = [];
  if (qualiPred) {
    const pole = by(qualiPred.drivers, "p_pole");
    cards.push(fav("target", "var(--purple)", h("span", {}, "Favourite for ", term("pole", "pole")), pole.code, pole.p_pole, "chance of pole"));
  }
  cards.push(fav("trophy", "var(--flag)", raceKey === "S" ? "Favourite to win the sprint" : "Favourite to win", win.code, win.p_win, `to win, ${pct(win.p_podium)} podium`));
  cards.push(fav("timer", "var(--green)", h("span", {}, "Likeliest ", term("fastest", "fastest lap")), fl.code, fl.p_fastest, "chance"));
  cards.push(fav("wrench", "var(--red)", h("span", {}, "Highest ", term("dnf", "DNF"), " risk"), risk.code, 1 - risk.p_finish, "chance of not finishing"));
  return section(["Who to watch", "sparkle"], "From thousands of simulated races. Even a favourite usually has less than a coin-flip chance of winning.",
    h("div", { class: "favs" }, cards));
}
function fav(ic, color, what, code, p, how) {
  const d = driver(code);
  return h("div", { class: "fav", style: { "--tc": d.color, "--k": color } },
    h("span", { class: "what" }, icon(ic, { size: 16 }), what),
    h("a", { class: "who", href: `#/driver/${code}`, style: { color: "inherit", textDecoration: "none" } }, avatar(code, { size: 40 }), h("span", {}, d.name)),
    h("span", {}, animatedNumber(p, "pct", "big")),
    h("span", { class: "how" }, how));
}

export function predictionTable(pred, actual) {
  const race = pred.kind === "race";
  const n = pred.drivers.length;
  const pos = actual ? Object.fromEntries(actual.results.filter((r) => r.pos).map((r) => [r.code, r.pos])) : {};
  const cols = race ? ["p_win", "p_podium", "p_points", "p_finish", "p_fastest"] : ["p_pole", "p_top3", "p_top10"];
  const highlight = new Set(["p_win", "p_podium", "p_fastest", "p_pole", "p_top3"]);
  const best = Object.fromEntries(cols.map((c) => [c, Math.max(...pred.drivers.map((d) => d[c]))]));
  const head = race
    ? ["", "Driver", "Likely range", "Win", "Podium", "Points", "Finish", "Fastest lap"]
    : ["", "Driver", "Likely range", "Pole", "Top 3", "Top 10"];
  const table = h("table", { class: "data" },
    h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: i > 2 ? "num" : "", scope: "col" }, t)))),
    h("tbody", {}, pred.drivers.map((d) => h("tr", { class: d.pred === 1 ? "p1" : "" },
      h("td", { class: "pos" }, d.pred),
      h("td", {}, driverTag(d.code)),
      h("td", {}, rangeBar(d.lo, d.hi, d.pred, n, pos[d.code]), h("span", { class: "small muted" }, ` P${d.lo}–P${d.hi}`)),
      ...cols.map((c) => h("td", { class: "num" }, probBar(d[c], highlight.has(c) && d[c] === best[c])))))));
  return h("div", { class: "panel-flush scroll-x" }, table);
}

function predictionsSection(ev, targets, preds, sessions) {
  const available = targets.filter((t) => preds[t]);
  if (!available.length) return section(["Predictions", "gauge"], null, empty("Predictions appear here once the season has enough data. Check back after the first race."));
  let current = available.find((t) => !sessions[t]) || available[available.length - 1];
  const body = h("div", { style: { display: "grid", gap: "14px" } });
  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Session" });
  const tabIcon = { SQ: "bolt", S: "bolt", Q: "timer", R: "chequered" };
  const draw = () => {
    tabs.replaceChildren(...available.map((t) => h("button", {
      class: "tab", role: "tab", type: "button", "aria-selected": String(t === current),
      onclick: () => { current = t; draw(); },
    }, icon(sessions[t] ? "check" : tabIcon[t], { size: 16 }), SESSION_LABEL[t])));
    const p = preds[current];
    const made = p.made_after === "pre-weekend" ? "before the weekend" : `after ${SESSION_LABEL[p.made_after]}`;
    body.replaceChildren(
      h("p", { class: "muted small" },
        `Made ${made}${p.frozen ? ", now locked" : ", updates after each session"}. `,
        sessions[current] ? h("span", {}, "The yellow mark shows where each driver actually finished. ", h("a", { href: `#/race/${ev.round}/${current}` }, "See full results")) : null),
      noteList(p.notes),
      predictionTable(p, sessions[current]));
  };
  draw();
  return section(["Predictions", "gauge"], h("span", {}, "Each driver's ", term("range", "likely range"), " and chances, from this season's form, their trouble record and every session so far this weekend. Purple marks the favourite."), tabs, body);
}

function scheduleSection(ev, sessions, forecast) {
  const next = ev.sessions.find((s) => !s.done);
  const iconFor = { FP1: "steer", FP2: "steer", FP3: "steer", SQ: "bolt", S: "bolt", Q: "timer", R: "chequered" };
  const rows = ev.sessions.map((s) => {
    const fc = forecast?.sessions?.[s.key];
    const state = sessions[s.key] ? "done" : s === next ? "next" : "";
    return h("div", { class: `sched-row ${state}` },
      h("span", { class: "badge" }, icon(state === "done" ? "check" : iconFor[s.key], { size: 18 })),
      h("div", {},
        h("div", { style: { fontWeight: 700 } }, SESSION_LABEL[s.key]),
        h("div", { class: "state" },
          sessions[s.key] ? h("a", { href: `#/race/${ev.round}/${s.key}` }, "See results")
            : fc ? [icon(fc.rain_prob >= 0.3 ? "rain" : "sun", { size: 14 }), `${pct(fc.rain_prob)} rain, ${Math.round(fc.temp)}°C`]
              : "Forecast nearer the time")),
      h("div", { class: "when" }, localTime(s.start)));
  });
  return section(["Weekend schedule", "calendar"], `Times in your time zone (${tzName()}).`,
    h("div", { class: "panel" }, h("div", { class: "schedule" }, rows)));
}

async function lastRaceSection() {
  const ev = lastCompleted();
  const summary = ev ? await load("summary.json") : null;
  const row = summary?.events.find((e) => e.round === ev.round);
  if (!row?.podium?.length) return h("div");
  const order = [1, 0, 2].filter((i) => row.podium[i]);       // P2, P1, P3 like a real podium
  return section(["Last race", "trophy"], null,
    h("div", { class: "panel", style: { display: "grid", gap: "14px" } },
      h("h3", {}, ev.name),
      h("div", { class: "podium" }, order.map((i) => {
        const code = row.podium[i];
        return h("a", { class: `pod p${i + 1}`, href: `#/driver/${code}` },
          avatar(code, { size: i === 0 ? 60 : 48 }),
          h("span", { class: "nm" }, driver(code).last || code, row.podium_grid?.[i] ? h("span", { class: "small muted", style: { display: "block", fontWeight: 400 } }, `from P${row.podium_grid[i]}`) : null),
          h("span", { class: "block" }, i + 1));
      })),
      h("div", { class: "round-pill" },
        row.pole ? h("span", { class: "chip best" }, icon("target", { size: 13 }), `Pole: ${row.pole}`) : null,
        row.fastest ? h("span", { class: "chip" }, icon("timer", { size: 13 }), `Fastest lap: ${row.fastest}`) : null,
        row.sc ? h("span", { class: "chip warn" }, icon("alert", { size: 13 }), `${row.sc} safety car${row.sc > 1 ? "s" : ""}`) : null),
      h("p", {}, h("a", { href: `#/race/${ev.round}/R` }, "Full results, lap chart and tyre strategies"))));
}
