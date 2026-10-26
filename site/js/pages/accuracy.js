import { icon } from "../icons.js";
import { animatedNumber, driverTag, empty, h, load, pct, section, SESSION_LABEL, eventByRound } from "../ui.js";

export const title = () => "Prediction accuracy";

export default async function accuracy() {
  const acc = await load("accuracy.json");
  if (!acc || !acc.sessions.length) return empty("The scorecard starts after the first predicted session has finished.");
  const o = acc.overall;
  const tiles = (a, label) => a ? h("div", { style: { display: "grid", gap: "10px" } },
    h("h3", {}, label),
    h("div", { class: "tiles" },
      tile("target", "var(--green)", animatedNumber(a.in_range, "pct", "v"), "of drivers finished inside their predicted range"),
      tile("compare", "var(--link)", animatedNumber(a.mae, "dec", "v"), "places off, on average"),
      tile("trophy", "var(--purple)", animatedNumber(a.pick_rate, "pct", "v"), "of the time our favourite won"),
      tile("chequered", "var(--flag)", h("span", {}, animatedNumber(a.top3_hits, "dec", "v"), h("span", { class: "small muted" }, " of 3")), "top-three drivers called correctly"))) : null;

  const rows = [...acc.sessions].reverse().map((s) => {
    const ev = eventByRound(s.round);
    return h("tr", {},
      h("td", {}, h("a", { href: `#/race/${s.round}/${s.target}` }, `${ev ? ev.location : `Round ${s.round}`}, ${SESSION_LABEL[s.target]}`),
        s.backfilled ? h("span", { class: "chip", style: { marginLeft: "6px" } }, "Backtest") : null),
      h("td", {}, driverTag(s.pick), h("span", { class: "small muted" }, ` ${pct(s.pick_prob)}`)),
      h("td", {}, driverTag(s.actual_first), " ", s.pick_correct ? h("span", { class: "chip good" }, icon("check", { size: 12 }), "Right") : h("span", { class: "chip" }, icon("x", { size: 12 }), "Missed")),
      h("td", { class: "num" }, pct(s.in_range)),
      h("td", { style: { whiteSpace: "normal", minWidth: "260px" }, class: "small" }, s.note));
  });

  return h("div", { style: { display: "grid", gap: "28px" } },
    h("div", { style: { display: "grid", gap: "8px" } },
      h("h1", {}, "How accurate are our predictions?"),
      h("p", {}, "Every prediction is locked when its session starts, then scored against what actually happened. Misses stay on the record. We aim for roughly 6 to 8 in 10 drivers inside their predicted range. Much higher would mean the ranges are too wide to be useful."),
      o.live ? null : h("p", { class: "muted" }, "So far these are backtests: predictions worked out later, using only the data available before each session. Live predictions are scored here from the next session on.")),
    section(["Overall", "gauge"], null, tiles(o.qualifying, "Qualifying"), tiles(o.race, "Races and sprints")),
    section(["Session by session", "calendar"], "Newest first. Favourite = the driver we gave the best chance of pole or the win.",
      h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
        h("thead", {}, h("tr", {}, ["Session", "Our favourite", "Actual winner", "In range", "What happened"].map((t, i) => h("th", { scope: "col", class: i === 3 ? "num" : "" }, t)))),
        h("tbody", {}, rows)))));
}

function tile(ic, color, v, k) {
  return h("div", { class: "tile", style: { "--k": color } }, icon(ic, { size: 22 }), v, h("div", { class: "k" }, k));
}
