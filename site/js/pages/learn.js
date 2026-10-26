import { icon } from "../icons.js";
import { h, tyre } from "../ui.js";

export const title = () => "Learn F1";

const P = (...t) => h("p", {}, ...t);

const ICONS = {"How a race weekend works": "calendar", "Qualifying: the knockout": "timer", "Tyres and why they matter": "tyre", "Pit stops, the undercut and the overcut": "wrench", "Safety cars, virtual safety cars and red flags": "alert", "How points work": "trophy", "Grid penalties": "down", "What changed in 2026": "bolt", "Reading the charts on this site": "compare", "How our predictions work": "gauge"};

const TOPICS = [
  ["How a race weekend works", () => [
    P("Most weekends run over three days. Friday has two one-hour practice sessions, where teams test set-ups and tyres. Saturday has a final practice, then qualifying, which decides the starting order. Sunday is the Grand Prix itself, usually about 305 km, roughly an hour and a half."),
    P("Sprint weekends swap most of the practice for a second, shorter competition. There's one practice on Friday, then Sprint Qualifying. Saturday has the Sprint (about 100 km, no pit stop needed) followed by qualifying for the main race. Sunday is the Grand Prix as usual."),
    P("This site updates after every session, so predictions get sharper as the weekend goes on."),
  ]],
  ["Qualifying: the knockout", () => [
    P("Qualifying is three short sessions back to back. In Q1 every car runs and the slowest six are knocked out. In Q2 the next slowest six go. The last ten fight it out in Q3 for pole position, first place on the grid."),
    P("Drivers usually do an out-lap to warm the tyres, one flat-out lap, then come back in. Tracks get faster as rubber builds up, so the best laps tend to come right at the end of each part."),
  ]],
  ["Tyres and why they matter", () => [
    h("ul", { class: "notes" },
      h("li", {}, tyre("S"), " Soft (red): fastest, but wears out quickly."),
      h("li", {}, tyre("M"), " Medium (yellow): a balance of speed and life."),
      h("li", {}, tyre("H"), " Hard (white): slowest, but lasts the longest."),
      h("li", {}, tyre("I"), " Intermediate (green) and ", tyre("W"), " Wet (blue): for a damp or soaking track.")),
    P("In a dry race every driver has to use at least two different dry compounds, so everyone makes at least one pit stop. As tyres wear they lose grip and lap times creep up. This is called degradation, and managing it is a big part of race strategy."),
  ]],
  ["Pit stops, the undercut and the overcut", () => [
    P("A pit stop to change tyres takes two to three seconds once the car is stopped, but driving through the slower pit lane costs around 20 seconds in total."),
    P("The undercut: stop before the rival ahead. Your fresh tyres are faster, so by the time they stop, you may have gained enough to come out in front. The overcut is the opposite: stay out longer, hoping clean air and a lighter car let you build a gap."),
    P("A safety car is the best time to stop, because the whole field is going slowly and a stop costs far less time."),
  ]],
  ["Safety cars, virtual safety cars and red flags", () => [
    P("After a crash or debris, a safety car comes out and leads the field slowly. Cars bunch up behind it, so a leader's 10-second gap can vanish in a lap. That's why safety cars can turn a race upside down."),
    P("A virtual safety car is a lighter version: no car on track, but every driver must slow to a set speed. A red flag stops the session completely, usually for a big crash or heavy rain."),
  ]],
  ["How points work", () => [
    P("In a Grand Prix the top ten score: 25, 18, 15, 12, 10, 8, 6, 4, 2 and 1. In a Sprint the top eight score 8 down to 1. There's no longer a bonus point for the fastest lap."),
    P("There are two championships: drivers, and teams (both drivers' points added together). The teams' result decides prize money, so the midfield fights hard over every point."),
  ]],
  ["Grid penalties", () => [
    P("Drivers can be sent down the starting grid, for example for using more engine parts than allowed in a season or for an offence in an earlier session. That's why the starting grid sometimes differs from the qualifying result."),
  ]],
  ["What changed in 2026", () => [
    P("2026 brought the biggest rule change in years. The cars are smaller and lighter. The engines get roughly half their power from electricity and run on fully sustainable fuel."),
    P("Wings can now move: they flatten on the straights for speed and close up in the corners for grip. The old DRS overtaking flap has been replaced by an extra burst of electric power for a car that's close behind."),
    P("Because everything changed at once, older seasons tell us little about which car is fastest now. Our predictions lean almost entirely on 2026 data."),
  ]],
  ["Reading the charts on this site", () => [
    P("Likely range: the grey bar shows where a driver will probably finish, and the dot is our single best guess. When a session is over, a yellow mark shows where they actually ended up."),
    P("Lap by lap: each line is a driver's position on every lap. A line going up means places gained."),
    P("Tyre strategy: each bar is one driver's race, split into coloured blocks for each set of tyres."),
    P("Compare: overlays two drivers' fastest laps. Dips in the speed line are corners; the track map is coloured by whoever was quicker in each part."),
  ]],
  ["How our predictions work", () => [
    P("We start from each driver's form this season, with recent races counting most. Every session of the weekend then adds evidence. Practice counts for a little, since teams hide their true pace with different fuel loads, while Sprint results count for a lot."),
    P("Then we simulate the session thousands of times. Each run includes random swings in pace, how hard the track is to overtake on, the chance of safety cars, the weather forecast, and retirement risk based on each team's reliability this year. The share of runs a driver wins becomes their win chance."),
    P("Seasons before 2026 count for very little: only for things that don't depend on the car, like how often a track has safety cars or how a driver copes with rain."),
    P("Predictions are locked when each session starts and scored afterwards, misses included, on the accuracy page."),
    h("p", {}, h("a", { href: "#/accuracy" }, "See how accurate we've been")),
  ]],
];

export default async function learn() {
  return h("div", { style: { display: "grid", gap: "20px" } },
    h("div", { style: { display: "grid", gap: "8px" } },
      h("h1", {}, "New to F1? Start here"),
      h("p", { class: "muted" }, "Short explanations of everything you'll see on this site. Open any topic.")),
    h("div", { style: { display: "grid", gap: "8px" } },
      TOPICS.map(([t, body], i) => h("details", { class: "explain", open: i === 0 ? true : null },
        h("summary", {}, h("span", { class: "lead" }, icon(ICONS[t] || "help", { size: 20 })), t, h("span", { class: "chev" }, icon("chevron", { size: 18 }))),
        h("div", { class: "body" }, body())))));
}
