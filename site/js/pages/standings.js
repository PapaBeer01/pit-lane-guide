import { legend, lineChart, driverSeries } from "../charts.js";
import { avatar, teamBadge } from "../avatars.js";
import { icon } from "../icons.js";
import { animatedNumber, driver, driverTag, empty, h, load, pct, section, stintText, term } from "../ui.js";

export const title = () => "Standings";

export default async function standings() {
  const st = await load("standings.json");
  const rel = await load("reliability.json");
  if (!st || !st.drivers.length) return empty("Standings appear after the first race.");
  const [lead, second] = st.drivers;
  const contenders = st.drivers.filter((d) => d.in_contention);
  const view = h("div", { style: { display: "grid", gap: "28px" } }, h("h1", {}, "Championship standings"));

  view.append(h("div", { class: "tiles" },
    h("div", { class: "tile", style: { "--k": "var(--flag)" } }, icon("trophy", { size: 22 }), h("span", { class: "k" }, "Leader"), h("a", { class: "who-row", href: `#/driver/${lead.code}`, style: { color: "inherit", textDecoration: "none", fontWeight: 700 } }, avatar(lead.code, { size: 40 }), driver(lead.code).name), h("span", {}, animatedNumber(lead.points, "int", "v"), h("span", { class: "small muted" }, " points"))),
    h("div", { class: "tile", style: { "--k": "var(--purple)" } }, icon("target", { size: 22 }), h("span", { class: "k" }, "Lead over P2"), animatedNumber(lead.points - second.points, "int", "v")),
    h("div", { class: "tile", style: { "--k": "var(--green)" } }, icon("flag", { size: 22 }), h("span", { class: "k" }, "Races left"), animatedNumber(st.races_left, "int", "v")),
    h("div", { class: "tile", style: { "--k": "var(--amber)" } }, icon("sparkle", { size: 22 }), h("span", { class: "k" }, "Still in the title fight"), animatedNumber(contenders.length, "int", "v"))));
  view.append(h("div", { class: "callout" },
    h("p", {}, driverTag(lead.code, { full: true }), ` leads by ${lead.points - second.points} points with ${st.races_left} ${st.races_left === 1 ? "race" : "races"} to go. `,
      `Up to ${st.points_left} points are still available per driver. `,
      contenders.length > 1 ? `${contenders.length} drivers can still mathematically win the title.` : "The title is decided.")));

  const top = st.drivers.slice(0, 6).map((d) => d.code);
  const rounds = st.rounds;
  const chart = lineChart(top.map((c) => driverSeries(c, st.drivers.find((d) => d.code === c).progress.map((p, i) => [i + 1, p]))), {
    height: 300, xMin: 1, xMax: rounds.length, labels: true, xFmt: (t) => (Number.isInteger(t) ? t : ""), xLabel: "Round",
    aria: "Points over the season for the top six drivers",
    tooltip: (x) => {
      const i = Math.round(x) - 1;
      const rows = top.map((c) => [c, st.drivers.find((d) => d.code === c).progress[i]]).sort((p, q) => q[1] - p[1]);
      return `<b>After ${rounds[i]?.location || `round ${i + 1}`}</b><br>${rows.map(([c, p]) => `${c}: ${p}`).join("<br>")}`;
    },
  });
  view.append(section(["How the points built up", "compare"], "The top six drivers' running totals, race by race.",
    h("div", { class: "panel", style: { display: "grid", gap: "10px" } }, legend(top), chart.el)));

  view.append(h("a", { class: "callout meet-link", href: "#/drivers" },
    h("span", { class: "meet-helmets" }, st.drivers.slice(0, 5).map((d) => avatar(d.code, { size: 38 }))),
    h("span", {}, h("b", {}, "Meet the grid"), h("span", { class: "small muted", style: { display: "block" } }, "Every driver's season, form and teammate battle")),
    icon("chevron", { size: 20 })));
  view.append(section(["Drivers", "steer"], h("span", {}, "Races give 25, 18, 15, 12, 10, 8, 6, 4, 2 and 1 points to the top ten; ", term("sprint", "sprints"), " give 8 down to 1 for the top eight."),
    h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, ["", "Driver", "Team", "Points", "Wins", "Podiums"].map((t, i) => h("th", { scope: "col", class: i > 2 ? "num" : "" }, t)))),
      h("tbody", {}, st.drivers.map((d, i) => h("tr", { class: i === 0 ? "p1" : "" },
        h("td", { class: "pos" }, i + 1),
        h("td", {}, h("a", { class: "who-row", href: `#/driver/${d.code}`, style: { color: "inherit", textDecoration: "none" } }, avatar(d.code, { size: 34, ring: false }), driverTag(d.code, { full: true }))),
        h("td", {}, stintText(d.code) || driver(d.code).team),
        h("td", { class: "num", style: { fontWeight: 700 } }, d.points), h("td", { class: "num" }, d.wins), h("td", { class: "num" }, d.podiums))))))));

  view.append(section(["Teams", "layers"], "Every point scored in each team's cars, including by stand-in drivers. Points stay with the team they were scored for when a driver moves.",
    h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, ["", "Team", "Points"].map((t, i) => h("th", { scope: "col", class: i > 1 ? "num" : "" }, t)))),
      h("tbody", {}, st.teams.map((t, i) => h("tr", {},
        h("td", { class: "pos" }, i + 1),
        h("td", {}, h("span", { class: "driver" }, teamBadge(t.team, { size: 24 }), t.team)),
        h("td", { class: "num", style: { fontWeight: 700 } }, t.points))))))));

  if (rel?.teams?.length) {
    const label = { Strong: "chip good", Average: "chip", Concern: "chip bad" };
    view.append(section(["Reliability", "shield"], h("span", {}, "How often each team's cars have stopped with a technical problem this season (crashes aren't counted). New 2026 engines make this matter more than usual. Each team's figure is pulled towards the grid average until there are enough races to trust it. A ", term("dnf", "DNF"), " costs a whole race of points."),
      h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
        h("thead", {}, h("tr", {}, ["Team", "Engine", "Technical retirements", "Risk per race", ""].map((t, i) => h("th", { scope: "col", class: i > 1 && i < 4 ? "num" : "" }, t)))),
        h("tbody", {}, rel.teams.map((t) => h("tr", {},
          h("td", {}, h("span", { class: "driver" }, teamBadge(t.team, { size: 24 }), t.team)),
          h("td", {}, t.pu),
          h("td", { class: "num" }, t.tech_dnfs),
          h("td", { class: "num" }, pct(t.risk_per_race, 1)),
          h("td", {}, h("span", { class: label[t.label] }, icon(t.label === "Concern" ? "alert" : t.label === "Strong" ? "shield" : "check", { size: 13 }), t.label === "Concern" ? "Above average risk" : t.label === "Strong" ? "Below average risk" : "About average"))))))),
      h("p", { class: "small muted" }, `Grid average: about ${pct(rel.grid_risk_per_race, 1)} chance per car, per race, of a technical retirement.`)));
  }
  return view;
}
