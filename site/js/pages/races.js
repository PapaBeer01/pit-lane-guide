import { icon } from "../icons.js";
import { ctx, driverTag, eventDone, h, load, localDate, nextEvent } from "../ui.js";

export const title = () => "Races";

export default async function races() {
  const evs = ctx.season.events;
  const next = nextEvent();
  const winners = Object.fromEntries(await Promise.all(evs.filter((e) => e.sessions.find((s) => s.key === "R" && s.done))
    .map(async (e) => {
      const r = await load(`events/${e.round}/R.json`);
      return [e.round, r?.results.find((x) => x.pos === 1)?.code];
    })));
  const rows = evs.map((e) => {
    const race = e.sessions.find((s) => s.key === "R");
    const isNext = next && e.round === next.round && !eventDone(e);
    return h("a", {
      href: `#/race/${e.round}`, class: "panel",
      style: { display: "grid", gridTemplateColumns: "2.4em 1fr auto", gap: "4px 12px", alignItems: "center", textDecoration: "none", color: "inherit", boxShadow: isNext ? "0 0 0 2px var(--flag), 0 0 24px rgba(255,196,0,.25)" : null, opacity: eventDone(e) || isNext ? 1 : 0.72 },
    },
      h("span", { style: { font: "800 1.8rem/1 var(--font-display)", color: isNext ? "var(--flag)" : "var(--muted)", transform: "skewX(-8deg)" } }, e.round),
      h("span", { style: { display: "grid", gap: "2px" } },
        h("span", { style: { fontWeight: 700 } }, e.name),
        h("span", { class: "small muted" }, `${e.location}, ${race ? localDate(race.start) : ""}`)),
      h("span", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" } },
        e.format === "sprint" ? h("span", { class: "chip best" }, icon("bolt", { size: 12 }), "Sprint") : null,
        isNext ? h("span", { class: "chip flag" }, icon("flag", { size: 12 }), "Next") : null,
        winners[e.round] ? h("span", { class: "small", style: { display: "inline-flex", gap: "6px", alignItems: "center" } }, h("span", { style: { color: "var(--flag)" } }, icon("trophy", { size: 15 })), driverTag(winners[e.round])) : null));
  });
  return h("div", { style: { display: "grid", gap: "16px" } },
    h("h1", {}, `${ctx.season.year} season`),
    h("p", { class: "muted" }, `${evs.length} rounds. Tap a race for results, lap charts, tyre strategies and how our predictions did.`),
    h("div", { style: { display: "grid", gap: "8px" } }, rows));
}
