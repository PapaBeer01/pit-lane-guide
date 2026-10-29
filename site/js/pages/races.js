import { face } from "../media.js";
import { icon } from "../icons.js";
import { flag, trackOutline, tracks } from "../visuals.js";
import { ctx, driver, eventDone, h, load, localDate, nextEvent } from "../ui.js";

export const title = () => "Races";

// The season as a wall of track posters: every circuit's real shape, flag, dates and winner
export default async function races() {
  const evs = ctx.season.events;
  const next = nextEvent();
  // two small downloads for the whole season (instead of a file per race)
  const [summary, shapes] = await Promise.all([load("summary.json"), tracks()]);
  const winners = Object.fromEntries((summary?.events || []).filter((e) => e.podium?.length).map((e) => [e.round, e.podium[0]]));
  const cards = evs.map((e, i) => {
    const race = e.sessions.find((s) => s.key === "R");
    const first = e.sessions[0];
    const isNext = next && e.round === next.round && !eventDone(e);
    const done = eventDone(e);
    const w = winners[e.round];
    return h("a", {
      href: `#/race/${e.round}`, class: `cal-card${isNext ? " next" : ""}${done ? " done" : ""}`,
      style: { animationDelay: `${Math.min(i, 16) * 30}ms` },
      "aria-label": `Round ${e.round}, ${e.name}, ${race ? localDate(race.start) : ""}${w ? `, won by ${w}` : ""}`,
    },
      h("span", { class: "cal-top" },
        h("span", { class: "flag-emoji", "aria-hidden": "true" }, flag(e.country)),
        h("span", { class: "cal-name" }, h("b", {}, e.location), h("small", {}, first && race ? `${localDate(first.start)} – ${localDate(race.start)}` : "")),
        h("span", { class: "cal-round" }, e.round)),
      h("span", { class: "cal-track" }, trackOutline(shapes[String(e.round)], { cls: "track-art small", glow: isNext, draw: false, label: `${e.location} track`, team: w ? driver(w).team : null, carSize: 13 })
        || h("span", { class: "cal-notrack muted small" }, "Track map after first session")),
      h("span", { class: "cal-foot" },
        e.format === "sprint" ? h("span", { class: "chip best" }, icon("bolt", { size: 12 }), "Sprint") : null,
        isNext ? h("span", { class: "chip flag" }, icon("flag", { size: 12 }), "Next") : null,
        w ? h("span", { class: "cal-win" }, icon("trophy", { size: 14 }), face(w, { size: 26 }), w) : null));
  });
  return h("div", { style: { display: "grid", gap: "16px" } },
    h("h1", {}, `${ctx.season.year} season`),
    h("p", { class: "muted" }, `${evs.length} rounds. Tap a race for results, lap charts, tyre strategies and how our predictions did.`),
    h("div", { class: "cal-grid" }, cards));
}
