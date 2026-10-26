import { icon } from "./icons.js";
import { ctx, h, load, localTime } from "./ui.js";

const routes = {
  "": () => import("./pages/home.js"),
  races: () => import("./pages/races.js"),
  race: () => import("./pages/race.js"),
  compare: () => import("./pages/compare.js"),
  form: () => import("./pages/form.js"),
  standings: () => import("./pages/standings.js"),
  learn: () => import("./pages/learn.js"),
  accuracy: () => import("./pages/accuracy.js"),
};
const NAV = [
  ["", "This weekend", "flag"],
  ["races", "Races", "calendar"],
  ["compare", "Compare", "compare"],
  ["form", "Form", "pulse"],
  ["standings", "Standings", "trophy"],
];
const navFor = { race: "races" };

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "", args: parts.slice(1), query: new URLSearchParams(query) };
}

function buildChrome() {
  document.getElementById("nav").replaceChildren(...NAV.map(([r, label, ic]) =>
    h("a", { href: `#/${r}`, "data-route": r }, icon(ic, { size: 20 }), label)));
  const themeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Switch light or dark mode" });
  const paint = () => themeBtn.replaceChildren(icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun", { size: 18 }));
  themeBtn.addEventListener("click", () => {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", light ? "light" : "dark"); } catch { /* storage unavailable: theme lasts this visit */ }
    paint();
    window.dispatchEvent(new Event("themechange"));
  });
  paint();
  document.getElementById("actions").replaceChildren(
    h("a", { class: "icon-btn", href: "#/learn", "aria-label": "Learn F1: explanations for new fans", title: "Learn F1" }, icon("help", { size: 18 })),
    themeBtn);
}

async function render() {
  const app = document.getElementById("app");
  const route = parse();
  const loader = routes[route.name] || routes[""];
  const navName = route.name in navFor ? navFor[route.name] : route.name;
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.route === navName) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  try {
    const mod = await loader();
    const view = await mod.default(route);
    app.classList.remove("enter");
    app.replaceChildren(view);
    void app.offsetWidth;
    app.classList.add("enter");
    document.title = mod.title ? `${mod.title(route)} | Pit Lane Guide` : "Pit Lane Guide";
  } catch (e) {
    console.error(e);
    app.replaceChildren(h("div", { class: "panel empty" },
      h("h2", {}, icon("alert", { size: 24 }), "This page couldn't load"),
      h("p", {}, "The data may still be updating after a session. Try again in a few minutes."),
      h("p", {}, h("a", { href: "#/" }, "Go to this weekend"))));
  }
}

async function start() {
  buildChrome();
  const season = await load("season.json");
  if (!season) {
    document.getElementById("app").replaceChildren(h("div", { class: "panel empty" },
      h("h2", {}, icon("timer", { size: 24 }), "Warming up"),
      h("p", {}, "The first data update hasn't finished yet. This page fills in automatically once it has.")));
    return;
  }
  ctx.season = season;
  ctx.drivers = Object.fromEntries(season.drivers.map((d) => [d.code, d]));
  document.getElementById("sample-strip").hidden = !season.sample;
  document.getElementById("updated").textContent = `Data last changed ${localTime(season.updated)}.`;
  window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0 }); });
  render();
}
start();
