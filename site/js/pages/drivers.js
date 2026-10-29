import { avatar, helmet, teamBadge } from "../avatars.js";
import { carArt, driverArt } from "../media.js";
import { lineChart } from "../charts.js";
import { icon } from "../icons.js";
import { teamMark, animatedNumber, ctx, driver, empty, eventByRound, h, load, nextEvent, pct, probBar, section, stintText, term } from "../ui.js";

export const title = () => "Meet the grid";

// ---------- Meet the grid ----------
export default async function drivers() {
  const [summary, standings] = await Promise.all([load("summary.json"), load("standings.json")]);
  const stats = Object.fromEntries((summary?.drivers || []).map((d) => [d.code, d]));
  const teamOrder = (standings?.teams || []).map((t) => t.team);
  // the current line-up, grouped by team; then anyone who raced earlier (e.g. an injured driver
  // or a substitute) and the reserves who only drove in Friday practice
  const all = ctx.season.drivers;
  const isCurrent = (d) => d.current !== false;
  const raced = (d) => !("race_rounds" in d) || d.race_rounds.length > 0;
  const teams = {};
  for (const d of all.filter(isCurrent)) (teams[d.team] ||= []).push(d.code);
  const ordered = Object.keys(teams).sort((a, b) => (teamOrder.indexOf(a) + 99 * (teamOrder.indexOf(a) < 0)) - (teamOrder.indexOf(b) + 99 * (teamOrder.indexOf(b) < 0)));
  const earlier = all.filter((d) => !isCurrent(d) && raced(d));
  const fridays = all.filter((d) => !isCurrent(d) && !raced(d));

  let i = 0;
  const blocks = ordered.map((team, ti) => h("section", { class: "team-block", style: { "--tc": driver(teams[team][0]).color, "--i": Math.min(ti, 10) } },
    h("div", { class: "team-head" }, teamBadge(team, { size: 30 }), h("h2", {}, team),
      carArt(team, { color: driver(teams[team][0]).color, width: 110, cls: "team-car", label: `${team} car` })),
    h("div", { class: "driver-cards" }, teams[team].map((code) => card(code, stats[code], i++)))));
  const roundsText = (d) => {
    const n = d.race_rounds?.length || 0;
    return `${n} race weekend${n === 1 ? "" : "s"}: ${stintText(d.code) || `${d.team} (rounds ${d.race_rounds.join(", ")})`}`;
  };

  return h("div", { style: { display: "grid", gap: "30px" } },
    h("div", { style: { display: "grid", gap: "8px" } },
      h("h1", {}, "Meet the grid"),
      h("p", { class: "muted" }, `${all.filter(isCurrent).length} drivers in ${ordered.length} teams. Teammates drive the same car, so beating your teammate is the clearest sign of a driver's skill. Tap anyone for their season.`)),
    ...blocks,
    earlier.length ? section(["Also raced this season", "steer"], "Drivers who raced earlier in the year but aren't in the latest line-up, for example after an injury or when a substitute's stint ended.",
      h("div", { class: "driver-cards" }, earlier.map((d) => h("div", { style: { display: "grid", gap: "6px" } },
        card(d.code, stats[d.code], i++), h("p", { class: "small muted" }, roundsText(d)))))) : null,
    fridays.length ? section(["Friday practice only", "wrench"], "Teams must give young or reserve drivers some practice running, so these drivers took over a car for a Friday session.",
      h("div", { class: "panel" }, h("ul", { class: "legend", style: { listStyle: "none", margin: 0, padding: 0 } },
        fridays.map((d) => h("li", {}, teamMark(d.code), `${d.name} (${d.team || "reserve"})`))))) : null,
    h("p", { class: "small muted" }, "Helmets are our own illustrations in team colours, not the drivers' real designs."));
}

function card(code, s, i) {
  const d = driver(code);
  const recent = (s?.log || []).slice(-6);
  return h("a", { class: "driver-card", href: `#/driver/${code}`, style: { "--tc": d.color, animationDelay: `${Math.min(i, 14) * 50}ms` } },
    h("div", { class: "dc-top" },
      avatar(code, { size: 64 }),
      h("div", { class: "dc-name" },
        h("span", { class: "dc-first" }, d.first || ""),
        h("span", { class: "dc-last" }, d.last || d.name),
        h("span", { class: "dc-code" }, code, d.num ? ` #${d.num}` : ""))),
    s ? h("div", { class: "dc-stats" },
      stat("Points", s.points), stat("Best", s.best ? `P${s.best}` : "–"),
      stat("Beat teammate", s.quali_vs_mate ? `${s.quali_vs_mate[0]}–${s.quali_vs_mate[1]}` : "–")) : null,
    recent.length ? h("div", { class: "dc-form", "aria-label": "Last six race finishes" },
      recent.map((e) => {
        const r = e.r;
        const cls = e.r_out ? "out" : r === 1 ? "win" : r && r <= 3 ? "pod" : r && r <= 10 ? "pts" : "none";
        return h("span", { class: `fdot ${cls}`, title: `${eventByRound(e.round)?.location}: ${e.r_out ? "did not finish" : r ? `P${r}` : "no race"}` }, e.r_out ? "×" : r || "–");
      })) : null);
}
function stat(k, v) { return h("span", { class: "dc-stat" }, h("b", {}, v), h("small", {}, k)); }

// ---------- Driver profile ----------
export const profileTitle = (r) => driver(r.args[0]).name || "Driver";

export async function profile(route) {
  const code = route.args[0];
  const d = ctx.drivers[code];
  if (!d) return empty("We couldn't find that driver.", h("a", { href: "#/drivers" }, "See all drivers"));
  const ev = nextEvent();
  const [summary, form, predR, predQ] = await Promise.all([
    load("summary.json"), load("form.json"),
    ev ? load(`predictions/${ev.round}/R.json`) : null, ev ? load(`predictions/${ev.round}/Q.json`) : null]);
  const s = summary?.drivers.find((x) => x.code === code);
  const mate = s?.mate;
  const f = form?.drivers.find((x) => x.code === code);

  const hero = h("section", { class: "profile-hero", style: { "--tc": d.color } },
    h("div", { class: "ph-helmet" }, driverArt(code, { size: 220 })),
    h("div", { class: "ph-text" },
      h("div", { class: "who-row" }, teamBadge(d.team, { size: 26 }), h("span", { class: "muted" }, d.team), d.num ? h("span", { class: "chip" }, `#${d.num}`) : null,
        d.current === false ? h("span", { class: "chip warn" }, d.race_rounds?.length ? "Not in the latest line-up" : "Friday practice only") : null),
      stintText(code) ? h("p", { class: "small muted" }, `This season: ${stintText(code)}. Points stay with the team they were scored for.`) : null,
      h("h1", {}, h("span", { class: "ph-first" }, d.first), " ", d.last),
      h("p", { class: "muted" }, `${code}${d.country ? `, ${d.country}` : ""}`)));

  const view = h("div", { style: { display: "grid", gap: "30px" } },
    h("p", { class: "muted" }, h("a", { href: "#/drivers" }, "All drivers")), hero);
  if (!s) return view;

  view.append(h("div", { class: "tiles" },
    tile("trophy", "var(--flag)", s.points, "points", "int"),
    tile("chequered", "var(--purple)", s.wins, s.wins === 1 ? "win" : "wins", "int"),
    tile("sparkle", "var(--green)", s.podiums, "podiums", "int"),
    tile("target", "var(--link)", s.poles, s.poles === 1 ? "pole" : "poles", "int"),
    tile("timer", "var(--ink-2)", s.avg_q ?? 0, "average qualifying", "dec"),
    tile("wrench", "var(--red)", s.dnfs, s.dnfs === 1 ? "retirement" : "retirements", "int")));

  // season chart: qualifying vs race position per round
  const log = s.log;
  const n = ctx.season.drivers.length;
  const chart = lineChart([
    { id: "q", name: "Quali", color: "var(--purple)", points: log.map((e) => [e.round, e.q ?? null]) },
    { id: "r", name: "Race", color: d.color, points: log.map((e) => [e.round, e.r ?? null]) },
  ], {
    height: 240, invertY: true, yMin: 1, yMax: n, yTicks: [1, 5, 10, 15, 20].filter((t) => t <= n), yFmt: (t) => `P${t}`,
    xFmt: (t) => (Number.isInteger(t) ? t : ""), xLabel: "Round", labels: true, aria: `${d.name}'s qualifying and race positions this season`,
    tooltip: (x) => {
      const e = log.reduce((a, b) => (Math.abs(b.round - x) < Math.abs(a.round - x) ? b : a));
      return `<b>${eventByRound(e.round)?.location || `Round ${e.round}`}</b><br>Qualified ${e.q ? `P${e.q}` : "–"}<br>Finished ${e.r_out ? "did not finish" : e.r ? `P${e.r}` : "–"}`;
    },
  });
  view.append(section(["Season so far", "compare"], "Purple is where they qualified, the team colour is where they finished. Lower on the chart is better.",
    h("div", { class: "panel", style: { display: "grid", gap: "10px" } },
      h("div", { class: "legend" }, h("span", {}, h("i", { style: { background: "var(--purple)" } }), "Qualifying"), h("span", {}, h("i", { style: { background: d.color } }), "Race")),
      chart.el)));

  if (mate && s.quali_vs_mate) {
    const [a, b] = s.quali_vs_mate;
    const total = Math.max(1, a + b);
    view.append(section(["Teammate battle", "steer"], `Same car, so this is the fairest comparison in F1: who out-qualified whom this season.`,
      h("div", { class: "panel h2h", style: { "--a": d.color, "--b": driver(mate).color } },
        h("div", { class: "h2h-side" }, avatar(code, { size: 52 }), h("b", {}, animatedNumber(a, "int")), h("span", {}, code)),
        h("div", { class: "h2h-bar", role: "img", "aria-label": `${code} ahead ${a} times, ${mate} ahead ${b} times` },
          h("i", { class: "a", style: { "--w": `${(a / total) * 100}%` } }), h("i", { class: "b", style: { "--w": `${(b / total) * 100}%` } })),
        h("a", { class: "h2h-side", href: `#/driver/${mate}` }, avatar(mate, { size: 52 }), h("b", {}, animatedNumber(b, "int")), h("span", {}, mate)))));
  }

  if (s.trait) view.append(traitSection(code, s.trait, mate));

  if (predR) {
    const pr = predR.drivers.find((x) => x.code === code);
    const pq = predQ?.drivers.find((x) => x.code === code);
    if (pr) view.append(section([`Next up: ${ev.name}`, "gauge"], h("span", {}, "Our current prediction, with their ", term("range", "likely range"), "."),
      h("div", { class: "panel", style: { display: "grid", gap: "12px" } },
        h("div", { class: "pred-big" },
          pq ? h("div", {}, h("small", {}, "Qualifying"), h("b", {}, `P${pq.pred}`), h("span", { class: "muted small" }, `likely P${pq.lo}–P${pq.hi}`)) : null,
          h("div", {}, h("small", {}, "Race"), h("b", {}, `P${pr.pred}`), h("span", { class: "muted small" }, `likely P${pr.lo}–P${pr.hi}`))),
        h("div", { class: "pred-probs" },
          h("span", {}, "Win", probBar(pr.p_win)), h("span", {}, "Podium", probBar(pr.p_podium)),
          h("span", {}, "Points", probBar(pr.p_points)), h("span", {}, "Finish", probBar(pr.p_finish))),
        f && f.quali_fail >= 0.15 ? h("p", { class: "small", style: { color: "var(--amber)", display: "flex", gap: "6px" } }, icon("wrench", { size: 16 }),
          `Recent qualifying trouble: about a ${pct(f.quali_fail)} chance of another bad session is built in.`) : null)));
  }
  return view;
}

function tile(ic, color, v, k, fmt) {
  return h("div", { class: "tile", style: { "--k": color } }, icon(ic, { size: 22 }), animatedNumber(v, fmt, "v"), h("div", { class: "k" }, k));
}


// ---------- Saturday or Sunday? (racer vs qualifier, compared with the teammate) ----------
export const TRAIT_TEXT = {
  sunday: ["Stronger on Sundays", "good"],
  saturday: ["Stronger on Saturdays", "best"],
  balanced: ["Equally strong both days", ""],
};
function traitSection(code, t, mate) {
  const [label, cls] = TRAIT_TEXT[t.label] || TRAIT_TEXT.balanced;
  const secs = Math.abs(t.delta) * 0.9;            // % of a ~90 s lap, in seconds
  const who = driver(code).last || code, mateName = mate ? driver(mate).last || mate : "their teammate";
  const line = t.label === "balanced"
    ? `Compared with ${mateName}, ${who} is about as strong in races as in qualifying.`
    : t.label === "sunday"
      ? `Compared with ${mateName}, ${who} finds about ${secs.toFixed(2)}s a lap more in races than in qualifying: a racer more than a one-lap specialist.`
      : `Compared with ${mateName}, ${who} is about ${secs.toFixed(2)}s a lap stronger over one lap in qualifying than over a race distance.`;
  const [ahead, behind] = t.race_vs_mate || [0, 0];
  const g = t.gained;
  return section(["Saturday or Sunday?", "bolt"], "Qualifying is one perfect lap on Saturday; the race is a long fight on Sunday. Comparing with the teammate, in the same car, shows which suits the driver better.",
    h("div", { class: "panel", style: { display: "grid", gap: "14px" } },
      h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
        h("span", { class: `chip ${cls}` }, label),
        h("span", { class: "small muted" }, `From ${t.rounds} race weekend${t.rounds === 1 ? "" : "s"} with both drivers' pace`)),
      h("p", {}, line),
      h("div", { class: "trait-tiles" },
        h("div", { class: "dc-stat" }, h("b", { style: { color: g > 0 ? "var(--green)" : g < 0 ? "var(--red)" : "inherit" } }, g === null ? "–" : `${g > 0 ? "+" : ""}${g.toFixed(1)}`), h("small", {}, "places gained per race, grid to flag")),
        h("div", { class: "dc-stat" }, h("b", {}, `${ahead}–${behind}`), h("small", {}, mate ? `finished ahead of ${mate} (both finished)` : "finished ahead of teammate"))),
      h("p", { class: "small muted" }, "Race pace is corrected for tyres and fuel. Early in a season everyone is pulled towards \"equally strong\" until there are enough races to tell.")));
}
