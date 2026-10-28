// New car parts declared to the FIA for a race weekend, team by team, in the teams' own words.
import { carArt } from "./media.js";
import { h, section, teamColor } from "./ui.js";

// what the FIA's "primary reason" wording means, in plain language
const REASONS = [
  [/local load/i, "More grip from this part (downforce)"],
  [/flow condition/i, "Guides the air so other parts work better"],
  [/drag/i, "Less drag on the straights"],
  [/cooling/i, "Keeps the car cool with less drag"],
  [/circuit/i, "Made for this track"],
  [/reliab/i, "Stops something breaking"],
];
function reasonChip(reason) {
  const rel = /reliab/i.test(reason) && !/performance/i.test(reason);
  const short = reason.replace(/^performance\s*[-–]\s*/i, "").trim() || reason;
  const plain = REASONS.filter(([re]) => re.test(reason)).map(([, t]) => t).join("; ");
  return h("span", { class: "upg-why" }, h("span", { class: `chip ${rel ? "warn" : "good"}` }, rel ? "Reliability" : short),
    plain ? h("small", {}, plain) : null);
}

// Teams often declare a package: several parts with one shared reason and description.
// Parts identical in everything are shown as one entry; a description shared with the previous
// entry isn't repeated.
function packaged(updates) {
  const out = [];
  for (const u of updates) {
    const prev = out[out.length - 1];
    if (prev && prev.reason === u.reason && prev.change === u.change && prev.how === u.how) prev.parts.push(u.part);
    else out.push({ ...u, parts: [u.part], sameHow: Boolean(prev && u.how && prev.how === u.how) });
  }
  return out;
}

export function upgradesSection(data, { title = "New parts this weekend", open = 3 } = {}) {
  if (!data?.teams?.length) return null;
  const withParts = data.teams.filter((t) => t.updates.length).sort((a, b) => b.updates.length - a.updates.length);
  const without = data.teams.filter((t) => !t.updates.length).map((t) => t.team);
  const total = withParts.reduce((n, t) => n + t.updates.length, 0);

  const blocks = withParts.map((t, i) => {
    const color = teamColor(t.team);
    return h("details", { class: "upg-team", open: i < open, style: { "--tc": color } },
      h("summary", {},
        carArt(t.team, { color, width: 72, cls: "upg-car" }),
        h("b", {}, t.team),
        h("span", { class: "chip" }, `${t.updates.length} new part${t.updates.length === 1 ? "" : "s"}`)),
      h("ul", { class: "upg-list" }, packaged(t.updates).map((u) => h("li", {},
        h("div", { class: "upg-head" }, h("b", {}, u.parts.join(" and ")), reasonChip(u.reason)),
        h("p", { class: "upg-change" }, u.change),
        u.how ? h("p", { class: "upg-how" }, u.sameHow ? "Part of the same package as above." : u.how) : null))));
  });

  return section([title, "wrench"],
    h("span", {}, "Every weekend teams must tell the FIA about each new part they bring, with what changed and why. This is what they declared, in their own words."),
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      h("span", { class: "chip flag" }, `${total} new part${total === 1 ? "" : "s"}`),
      h("span", { class: "chip" }, `${withParts.length} of ${data.teams.length} teams`)),
    total ? h("div", { class: "upg-teams" }, blocks) : h("p", { class: "muted" }, "No team declared new parts for this race."),
    without.length && total ? h("p", { class: "small muted" }, `No new parts: ${without.join(", ")}.`) : null,
    h("p", { class: "small muted" }, "Green is about speed, amber about reliability. ",
      h("a", { href: data.source, target: "_blank", rel: "noopener" }, "Source: FIA document")));
}
