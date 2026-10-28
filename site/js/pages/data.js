// Data room: the raw model output behind every prediction, to inspect and download.
// Not linked from the menus (#/data). The site is public, so anyone with the link can open it.
import { icon } from "../icons.js";
import { deliver } from "../snapshot.js";
import { driverTag, empty, eventByRound, h, load, pct, section, SESSION_LABEL } from "../ui.js";

export const title = () => "Data room";

const csvCell = (v) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? "");
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const saveCsv = (rows, name) => deliver(new Blob([toCsv(rows)], { type: "text/csv" }), name);

function button(label, ic, onclick) {
  const b = h("button", { class: "tab", type: "button" }, icon(ic, { size: 16 }), h("span", {}, label));
  b.addEventListener("click", async () => {
    const text = b.querySelector("span");
    b.disabled = true;
    text.textContent = "Preparing…";
    try { await onclick(); text.textContent = "Saved"; } catch { text.textContent = "Couldn't download, try again"; }
    setTimeout(() => { b.disabled = false; text.textContent = label; }, 2500);
  });
  return b;
}

export default async function dataRoom(route) {
  const index = await load("predictions/index.json");
  const items = (index?.items || []).slice().sort((a, b) => b.round - a.round);
  if (!items.length) return empty("No predictions yet.");
  const q = route.query;
  const rounds = [...new Set(items.map((i) => i.round))];
  const rnd = rounds.includes(Number(q.get("r"))) ? Number(q.get("r")) : rounds[0];
  const targets = items.filter((i) => i.round === rnd).map((i) => i.target);
  const target = targets.includes(q.get("s")) ? q.get("s") : (targets.includes("R") ? "R" : targets[0]);
  const item = items.find((i) => i.round === rnd && i.target === target);
  const ev = eventByRound(rnd);
  const base = `data/sims/${rnd}/${target}`;
  const [detail, pred] = await Promise.all([load(`sims/${rnd}/${target}_detail.json`), load(`predictions/${rnd}/${target}.json`)]);

  const go = (r, s) => { location.hash = `#/data?${new URLSearchParams({ r, ...(s ? { s } : {}) })}`; };
  const pick = (label, value, options, onchange) => h("label", { class: "field" }, label,
    h("select", { class: "select", onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value) }, t))));
  const head = h("div", { style: { display: "grid", gap: "8px" } },
    h("h1", {}, "Data room"),
    h("p", { class: "muted" }, "Everything behind each prediction: the numbers the model started from, every driver's chance of every position, and all 4,000 simulated sessions to download. Not linked from the menus; anyone with this link can open it."),
    h("div", { class: "panel", style: { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" } },
      pick("Race", rnd, rounds.map((r) => [r, `${r}. ${(eventByRound(r)?.name || `Round ${r}`).replace(" Grand Prix", "")}`]), (v) => go(v)),
      pick("Session", target, targets.map((t) => [t, SESSION_LABEL[t]]), (v) => go(rnd, v))));

  const view = h("div", { style: { display: "grid", gap: "26px" } }, head);
  view.append(h("div", { class: "round-pill" },
    h("span", { class: "chip" }, `${ev?.name || `Round ${rnd}`}, ${SESSION_LABEL[target]}`),
    h("span", { class: `chip ${item?.backfilled ? "warn" : item?.frozen ? "best" : "good"}` },
      item?.backfilled ? "Backtest (made later, with earlier data only)" : item?.frozen ? "Locked at the session start" : "Live: updates after each session"),
    detail ? h("span", { class: "chip" }, `Made after ${detail.made_after === "pre-weekend" ? "no sessions this weekend" : SESSION_LABEL[detail.made_after] || detail.made_after}`) : null));
  if (!detail) {
    view.append(empty("The raw simulations for this prediction haven't been saved yet. They're added on the next update run."));
    return view;
  }

  const race = detail.kind === "race";
  const order = (pred?.drivers || []).map((d) => d.code).filter((c) => detail.inputs.drivers[c]);
  const codes = order.length ? order : detail.inputs.codes;
  const fname = (what, ext = "csv") => `pit-lane-guide_${rnd}-${(ev?.location || "").toLowerCase().replace(/[^a-z]+/g, "-")}_${target}_${what}.${ext}`;

  // ---- downloads ----
  const rawCsv = async () => {
    const res = await fetch(`${base}.csv.gz`);
    if (!res.ok) throw new Error("missing");
    let blob = await res.blob();
    if ("DecompressionStream" in window) {
      blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
      return deliver(new Blob([blob], { type: "text/csv" }), fname("simulations"));
    }
    return deliver(blob, fname("simulations", "csv.gz"));
  };
  const inputRows = () => {
    const cols = race
      ? ["driver", "team", "one_lap_gap", "one_lap_sd", "race_gap", "race_sd", "bad_quali_chance", "retire_chance", "lost_practice"]
      : ["driver", "team", "one_lap_gap", "one_lap_sd", "race_gap", "race_sd", "bad_quali_chance"];
    return [cols, ...codes.map((c) => { const d = detail.inputs.drivers[c]; return cols.map((k) => (k === "driver" ? c : d[k])); })];
  };
  const posRows = () => {
    const n = codes.length;
    return [["driver", ...Array.from({ length: n }, (_, i) => `P${i + 1}`), ...(race ? ["retired"] : [])],
      ...codes.map((c) => [c, ...detail.position_chances[c], ...(race ? [detail.retired[c]] : [])])];
  };
  view.append(section(["Download", "download"], h("span", {}, "Opens in Excel, Google Sheets or Numbers. The simulations file has one row per simulated ", race ? "race" : "session", ", ",
    detail.sims.toLocaleString(), " rows in all."),
  h("div", { class: "save-row" },
    button(`All ${detail.sims.toLocaleString()} simulations`, "download", rawCsv),
    button("Inputs per driver", "download", () => saveCsv(inputRows(), fname("inputs"))),
    button("Chance of each position", "download", () => saveCsv(posRows(), fname("position-chances"))),
    button("Everything (JSON)", "download", async () => deliver(new Blob([JSON.stringify(detail, null, 1)], { type: "application/json" }), fname("detail", "json")))),
  h("details", { class: "panel" }, h("summary", { style: { cursor: "pointer", fontWeight: 700 } }, "What's in the simulations file"),
    h("ul", { class: "small", style: { margin: "10px 0 0", paddingLeft: "18px", display: "grid", gap: "4px" } },
      race ? [
        h("li", {}, h("b", {}, "safety_car, virtual_safety_car, red_flag: "), "1 if that simulated race had one."),
        h("li", {}, h("b", {}, "fastest_lap: "), "who set the fastest lap."),
        h("li", {}, h("b", {}, "XXX_grid, XXX_pos: "), "the driver's starting slot and finishing position (retirements are placed at the back)."),
        h("li", {}, h("b", {}, "XXX_retired: "), "1 if they didn't finish."),
        h("li", {}, h("b", {}, "XXX_pace_pct: "), "their race pace that time, in % of lap time slower than the quickest (negative = quicker than the model's usual reference)."),
      ] : [
        h("li", {}, h("b", {}, "XXX_pos: "), "qualifying position."),
        h("li", {}, h("b", {}, "XXX_lap_gap_pct: "), "their best lap that time, in % slower than the quickest possible (lower is better)."),
        h("li", {}, h("b", {}, "XXX_bad_session: "), "1 if they had a bad session (mistake, traffic or a problem) in that simulation."),
      ]))));

  // ---- inputs ----
  const fmt = (v, d = 3) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));
  view.append(section(["What the model started from", "gauge"],
    h("span", {}, "Pace is a gap in % of lap time to the quickest (0 = quickest), with its uncertainty (±). Over a ", fmt(detail.inputs.lap_ref, 1), "s lap, 0.1% is about ", fmt(detail.inputs.lap_ref / 1000, 2), "s."),
    h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, ["Driver", "One lap", "Race pace", "Bad quali", ...(race ? ["Retire"] : [])].map((t, i) => h("th", { class: i ? "num" : "" }, t)))),
      h("tbody", {}, codes.map((c) => {
        const d = detail.inputs.drivers[c];
        return h("tr", {}, h("td", {}, driverTag(c)),
          h("td", { class: "num" }, `${fmt(d.one_lap_gap)} ±${fmt(d.one_lap_sd, 2)}`),
          h("td", { class: "num" }, `${fmt(d.race_gap)} ±${fmt(d.race_sd, 2)}`),
          h("td", { class: "num" }, pct(d.bad_quali_chance)),
          race ? h("td", { class: "num" }, pct(d.retire_chance), d.lost_practice ? " ⚠" : "") : null);
      })))),
    race ? h("div", { class: "trait-tiles" },
      tile(detail.inputs.laps, "laps"), tile(`${Number(detail.inputs.slot_cost_s).toFixed(1)}s`, "cost of each grid place"),
      tile(`±${Number(detail.inputs.spread_s).toFixed(1)}s`, "race-to-race luck"), tile(detail.inputs.grid_from, "grid from"),
      tile(pct(detail.neutralised.safety_car), "had a safety car"), tile(pct(detail.neutralised.virtual_safety_car), "had a VSC"),
      tile(pct(detail.neutralised.red_flag), "had a red flag"), tile(pct(detail.inputs.rain), "rain chance used")) : null));

  // ---- after the session: the simulation nearest to what really happened ----
  if (detail.vs_real) view.append(closestSection(detail.vs_real, race, detail.sims));

  // ---- heat map of positions ----
  const n = codes.length;
  const cell = (p) => h("td", { class: "num heat", style: { "--p": Math.min(1, p * 3).toFixed(3) }, title: pct(p, 1) }, p >= 0.005 ? Math.round(p * 100) : "");
  view.append(section(["Chance of each position", "standings"], "Out of every 100 simulations, how many times each driver finished in each place. Darker = more often.",
    h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data heatmap" },
      h("thead", {}, h("tr", {}, h("th", {}, "Driver"), Array.from({ length: n }, (_, i) => h("th", { class: "num" }, `P${i + 1}`)), race ? h("th", { class: "num" }, "Out") : null)),
      h("tbody", {}, codes.map((c) => h("tr", {}, h("td", {}, driverTag(c)), detail.position_chances[c].map(cell), race ? cell(detail.retired[c]) : null)))))));
  return view;
}

function tile(v, label) {
  return h("div", { class: "dc-stat" }, h("b", {}, v ?? "–"), h("small", {}, label));
}

function closestSection(v, race, sims) {
  const pctOf = (x) => (x === 0 ? "none" : x * sims < 1.5 ? `1 in ${sims.toLocaleString()}` : pct(x, x < 0.01 ? 2 : 1));
  const front = v.best_exact_from_front;
  const headline = front >= v.field ? "Every place exactly right."
    : front >= 2 ? `The first ${front} places exactly right, ${v.best_exact} of ${v.field} right overall.`
      : front === 1 ? `The winner right, ${v.best_exact} of ${v.field} places right overall.`
        : `${v.best_exact} of ${v.field} places right, but not the ${race ? "winner" : "pole-sitter"}.`;
  const flag = (f) => [f.sc && "safety car", f.vsc && "VSC", f.red && "red flag"].filter(Boolean).join(", ") || "none";
  const rows = v.real.map((code, i) => {
    const simCode = v.best_order[i];
    const ok = simCode === code;
    return h("tr", { class: ok ? "match" : "" },
      h("td", { class: "pos" }, i + 1),
      h("td", {}, driverTag(code)),
      h("td", {}, simCode ? driverTag(simCode) : "–"),
      h("td", { class: "num" }, ok ? icon("check", { size: 16, label: "Same" }) : ""));
  });
  return section(["Closest simulation to reality", "target"],
    h("span", {}, `Out of ${sims.toLocaleString()} simulations, the one nearest to the real result: right for as long as possible from the front, then the most places right.`),
    h("div", { class: "callout" },
      h("p", { style: { fontWeight: 700, display: "flex", gap: "8px", alignItems: "center" } }, icon("target", { size: 20 }), `Simulation #${v.best_sim}: ${headline}`),
      race && v.best_flags ? h("p", { class: "small muted" }, `Interruptions in that simulation: ${flag(v.best_flags)}. In the real race: ${flag(v.real_flags)}.`) : null),
    h("div", { class: "trait-tiles" },
      tile(pctOf(v.share.winner), race ? "had the right winner" : "had the right pole-sitter"),
      tile(pctOf(v.share.top3), "had the exact top 3"),
      tile(pctOf(v.share.top5), "had the exact top 5"),
      tile(pctOf(v.share.top10), "had the exact top 10"),
      tile(pctOf(v.share.full), "had the whole order"),
      tile(v.avg_exact, "places right on average")),
    h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data closest" },
      h("thead", {}, h("tr", {}, ["", "Real result", `Simulation #${v.best_sim}`, ""].map((t, i) => h("th", { class: i === 3 ? "num" : "" }, t)))),
      h("tbody", {}, rows))));
}
