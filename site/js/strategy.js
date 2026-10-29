// Shared pieces for race strategy and safety-car odds (used on This weekend and race pages).
import { icon } from "./icons.js";
import { animatedNumber, h, noteList, pct, term, tyreDot } from "./ui.js";

const TYRE_NAME = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" };

// A race drawn as a bar: one block per stint, in tyre colours, with pit stops between
export function planBar(seq, stints, laps) {
  const total = laps || stints.reduce((a, b) => a + b, 0);
  return h("div", { class: "plan-bar", role: "img", "aria-label": seq.map((c, i) => `${TYRE_NAME[c]} for ${stints[i]} laps`).join(", then ") },
    seq.map((c, i) => h("span", { class: `stint t-${c}`, style: { "--w": `${(stints[i] / total) * 100}%`, animationDelay: `${i * 160}ms` } },
      h("b", {}, c), h("small", {}, `${stints[i]}`))));
}

export function strategySection(st, { actual = null, title = "Race strategy" } = {}) {
  const stops = Object.entries(st.stops).sort((a, b) => a[0] - b[0]);
  const best = Math.max(...st.plans.map((p) => p.prob));
  const plans = st.plans.map((p, i) => h("div", { class: `plan${p.prob === best ? " top" : ""}`, style: { animationDelay: `${i * 90}ms` } },
    h("div", { class: "plan-head" },
      h("span", { class: "plan-name" }, p.seq.map((c) => tyreDot(c)), h("span", {}, `${p.stops}-stop`)),
      h("span", { class: "plan-prob" }, animatedNumber(p.prob, "pct"))),
    planBar(p.seq, p.stints, st.laps),
    h("div", { class: "plan-meta" },
      p.windows.map((w, k) => h("span", { class: "chip" }, icon("wrench", { size: 12 }), `Stop ${p.windows.length > 1 ? k + 1 : ""} laps ${w[0]}–${w[1]}`.replace("Stop  ", "Stop "))),
      p.delta > 0.05 ? h("span", { class: "chip" }, icon("timer", { size: 12 }), `${p.delta.toFixed(1)}s slower in theory`) : h("span", { class: "chip best" }, icon("bolt", { size: 12 }), "Fastest in theory"))));

  const hist = st.history?.common?.length
    ? h("div", { class: "hist-seqs" }, h("span", { class: "small muted" }, "Most used here before:"),
      st.history.common.slice(0, 4).map(([seq, share]) => h("span", { class: "chip" },
        seq.split("-").map((c) => tyreDot(c)), pct(share))))
    : null;

  const act = actual ? h("div", { class: "callout", style: { borderLeftColor: actual.stops_right && actual.seq_right ? "var(--green)" : "var(--amber)" } },
    h("p", { style: { fontWeight: 700, display: "flex", gap: "8px", alignItems: "center" } }, icon(actual.seq_right ? "check" : "target", { size: 18 }),
      `What teams actually did: mostly ${actual.actual.common[0][0].split("-").map((c) => TYRE_NAME[c].toLowerCase()).join(" then ")}, ${actual.actual_stops} stop${actual.actual_stops > 1 ? "s" : ""}.`),
    h("p", { class: "small muted" }, `We expected ${actual.pred_seq.split("-").map((c) => TYRE_NAME[c].toLowerCase()).join(" then ")} (${actual.pred_stops} stop${actual.pred_stops > 1 ? "s" : ""}). `,
      `Stops ${actual.stops_right ? "called right" : "missed"}, tyre order ${actual.seq_right ? "called right" : "missed"}.`),
    h("div", { class: "hist-seqs" }, actual.actual.common.slice(0, 4).map(([seq, share]) => h("span", { class: "chip" },
      seq.split("-").map((c) => tyreDot(c)), pct(share))))) : null;

  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", {}, icon("tyre", { size: 24 }), title),
      h("p", { class: "muted" }, "How teams will probably split the race into ", term("stint", "stints"), ". Each stop costs about ",
        h("b", {}, `${st.pit_loss}s`), " in the pit lane here, and every driver must use two different dry ", term("compound", "tyre types"), ".")),
    act,
    h("div", { class: "stops-row" }, stops.map(([k, v]) => h("div", { class: "stop-chance" },
      h("span", { class: "sc-num" }, animatedNumber(v, "pct")), h("span", { class: "muted small" }, `${k} stop${k > 1 ? "s" : ""}`)))),
    h("div", { class: "plans" }, plans),
    hist,
    st.notes?.length ? noteList(st.notes, "sparkle") : null);
}

// Safety car / VSC / red flag odds with the track's history, year by year
export function oddsSection(track, { actual = null } = {}) {
  const dial = (label, p, color, ic, happened) => h("div", { class: "odds", style: { "--k": color, "--p": p } },
    h("div", { class: "odds-ring" }, h("span", { class: "ic-wrap" }, icon(ic, { size: 18 })), h("b", {}, animatedNumber(p, "pct"))),
    h("span", { class: "odds-label" }, label),
    happened !== null && happened !== undefined ? h("span", { class: `chip ${happened ? "warn" : ""}` }, happened ? `Happened: ${happened}` : "Didn't happen") : null);
  const years = (track.years || []).map((y) => h("div", { class: "yr" },
    h("span", { class: "yr-y" }, `'${String(y.year).slice(2)}`),
    h("span", { class: "yr-marks" },
      y.sc ? Array.from({ length: Math.min(3, y.sc) }, () => h("span", { class: "mk sc", title: "Safety car" }, "SC")) : null,
      y.vsc ? h("span", { class: "mk vsc", title: "Virtual safety car" }, "VSC") : null,
      y.red ? h("span", { class: "mk red", title: "Red flag" }, icon("flag", { size: 11 })) : null,
      !y.sc && !y.vsc && !y.red ? h("span", { class: "mk clean", title: "Clean race" }, icon("check", { size: 11 })) : null)));
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", {}, icon("alert", { size: 24 }), "Safety car odds"),
      h("p", { class: "muted" }, track.races
        ? `From ${track.races} past races at this track, recent years counting most. `
        : "No past races at this track yet, so these are typical values. ",
        "A ", term("sc", "safety car"), " bunches everyone up and makes pit stops cheaper, so it can flip a race.")),
    h("div", { class: "panel", style: { display: "grid", gap: "16px" } },
      h("div", { class: "odds-row" },
        dial("Safety car", track.sc_prob, "var(--flag)", "alert", actual ? actual.sc : null),
        dial("Virtual safety car", track.vsc_prob, "var(--amber)", "timer", actual ? actual.vsc : null),
        dial("Red flag", track.red_prob, "var(--red)", "flag", actual ? actual.red : null)),
      years.length ? h("div", { class: "years" }, years) : null,
      track.first_lap_share ? h("p", { class: "small muted" }, `${pct(track.first_lap_share)} of safety cars here came on the opening laps, when the field is bunched up.`) : null));
}
