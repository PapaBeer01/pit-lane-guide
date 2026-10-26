import { icon } from "../icons.js";
import { driver, driverTag, empty, eventByRound, h, load, meter, pct, section, SESSION_LABEL, teamColor } from "../ui.js";

export const title = () => "Form guide";

// what each session status means, and how it is drawn
const MARK = {
  ok: ["ok", "check", "Clean session"],
  issue: ["warn", "wrench", "Lost practice running"],
  under: ["warn", "down", "Qualified well below their practice pace"],
  notime: ["bad", "x", "No qualifying lap time"],
  tech: ["bad", "wrench", "Technical retirement"],
  crash: ["bad", "crash", "Crashed out"],
  dnf: ["bad", "x", "Did not finish or was excluded"],
};
const ORDER = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"];

export default async function formPage() {
  const [form, standings, rel] = await Promise.all([load("form.json"), load("standings.json"), load("reliability.json")]);
  if (!form || !form.rounds.length) return empty("The form guide starts after the first race weekend.");
  const order = (standings?.drivers || []).map((d) => d.code);
  const drivers = [...form.drivers].sort((a, b) => (order.indexOf(a.code) + 99 * (order.indexOf(a.code) < 0)) - (order.indexOf(b.code) + 99 * (order.indexOf(b.code) < 0)));
  const cols = form.rounds.length;
  const maxFail = Math.max(...drivers.map((d) => d.quali_fail), 0.2);

  const head = h("div", { class: "form-row head", style: { "--cols": cols } },
    h("span", {}, "Driver"),
    form.rounds.map((r) => h("span", { title: eventByRound(r)?.name }, eventByRound(r)?.location.split(" ")[0] || `R${r}`)),
    h("span", {}, "Bad quali chance"));

  const rows = drivers.map((d) => h("div", { class: "form-row", style: { "--cols": cols } },
    h("span", { style: { display: "grid", gap: "2px" } }, driverTag(d.code), h("span", { class: "small muted" }, driver(d.code).team)),
    d.events.map((ev) => cell(ev)),
    h("span", { class: "risk-cell" },
      h("span", { style: { fontWeight: 700, color: d.quali_fail >= 1.8 * form.grid.quali_fail ? "var(--amber)" : "var(--ink-2)" } }, pct(d.quali_fail)),
      meter(d.quali_fail / maxFail, d.quali_fail >= 1.8 * form.grid.quali_fail ? "var(--amber)" : "var(--muted)"))));

  const key = h("div", { class: "form-key" },
    Object.entries(MARK).map(([k, [cls, ic, label]]) => h("span", {}, h("span", { class: `mark ${cls}` }, icon(ic, { size: 11 })), label)));

  const relByTeam = Object.fromEntries((rel?.teams || []).map((t) => [t.team, t]));
  const maxFp = Math.max(...form.teams.map((t) => t.fp_issue), 0.1);
  const teamTable = h("div", { class: "panel-flush scroll-x" }, h("table", { class: "data" },
    h("thead", {}, h("tr", {}, ["Team", "Practice trouble", "Bad qualifying", "Technical retirements"].map((t, i) => h("th", { scope: "col", class: i === 3 ? "num" : "" }, t)))),
    h("tbody", {}, form.teams.map((t) => h("tr", {},
      h("td", {}, h("span", { class: "driver" }, h("i", { class: "team-dot", style: { background: teamColor(t.team), boxShadow: `0 0 8px ${teamColor(t.team)}` } }), t.team)),
      h("td", {}, h("span", { style: { display: "grid", gridTemplateColumns: "90px auto", gap: "8px", alignItems: "center" } }, meter(t.fp_issue / maxFp, "var(--amber)"), pct(t.fp_issue))),
      h("td", {}, h("span", { style: { display: "grid", gridTemplateColumns: "90px auto", gap: "8px", alignItems: "center" } }, meter(t.quali_fail / maxFail, "var(--purple)"), pct(t.quali_fail))),
      h("td", { class: "num" }, relByTeam[t.team]?.tech_dnfs ?? "–"))))));

  return h("div", { style: { display: "grid", gap: "30px" } },
    h("div", { style: { display: "grid", gap: "8px" } },
      h("h1", {}, "Form guide"),
      h("p", { class: "muted" }, "Who's been running cleanly and who keeps hitting trouble, session by session over the last few weekends. Our predictions use this: a driver who often has a bad qualifying gets a matching chance of another one in every simulation, and teams that keep losing practice running carry a little more retirement risk.")),
    section(["Last six weekends", "pulse"], "Each box is one weekend: a mark per session, then the qualifying (Q) and race (R) result. Purple means a win or pole.",
      key, h("div", { class: "panel-flush scroll-x" }, head, rows)),
    section(["Team trouble record", "wrench"], `How often each team has lost practice running or had a bad qualifying, with recent weekends counting most. Grid averages: ${pct(form.grid.fp_issue)} of practice sessions and ${pct(form.grid.quali_fail)} of qualifying sessions.`,
      teamTable));
}

function cell(ev) {
  const keys = ORDER.filter((k) => ev.s[k]);
  if (!keys.length) return h("span", { class: "form-cell empty-cell" }, "–");
  const marks = keys.map((k) => {
    const [cls, ic, label] = MARK[ev.s[k]] || MARK.ok;
    return h("span", { class: `mark ${cls}`, title: `${SESSION_LABEL[k]}: ${label}` }, icon(ic, { size: 11, label: `${SESSION_LABEL[k]}: ${label}` }));
  });
  const res = (lab, p) => p ? h("span", {}, lab, h("b", { class: p === 1 ? "win" : "" }, p)) : null;
  return h("span", { class: "form-cell", title: eventByRound(ev.round)?.name },
    h("span", { class: "marks" }, marks),
    h("span", { class: "res" }, res("Q", ev.q), res("R", ev.r)));
}
