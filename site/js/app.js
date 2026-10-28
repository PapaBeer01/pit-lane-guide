import { brandCar, carSvg } from "./car.js";
import { icon } from "./icons.js";
import { loadMedia } from "./media.js";
import { clearSessionTeams, ctx, h, load, localTime, reducedMotion } from "./ui.js";

const routes = {
  "": () => import("./pages/home.js"),
  races: () => import("./pages/races.js"),
  race: () => import("./pages/race.js"),
  compare: () => import("./pages/compare.js"),
  form: () => import("./pages/form.js"),
  drivers: () => import("./pages/drivers.js"),
  driver: () => import("./pages/drivers.js").then((m) => ({ default: m.profile, title: m.profileTitle })),
  standings: () => import("./pages/standings.js"),
  learn: () => import("./pages/learn.js"),
  accuracy: () => import("./pages/accuracy.js"),
  data: () => import("./pages/data.js"),          // Data room: not in the menus
};
const NAV = [
  ["", "This weekend", "flag"],
  ["races", "Races", "calendar"],
  ["compare", "Compare", "compare"],
  ["form", "Form", "pulse"],
  ["standings", "Standings", "trophy"],
];
const navFor = { race: "races", drivers: "standings", driver: "standings" };

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "", args: parts.slice(1), query: new URLSearchParams(query) };
}

function buildChrome() {
  document.querySelector(".brand svg")?.replaceWith(brandCar());
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
  clearSessionTeams();
  const route = parse();
  const loader = routes[route.name] || routes[""];
  const navName = route.name in navFor ? navFor[route.name] : route.name;
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.route === navName) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // show a skeleton if the page takes more than a moment (slow mobile data)
  // on a slow connection, a car runs on the spot over a moving track until the page arrives
  const slow = setTimeout(() => app.replaceChildren(h("div", { class: "pit-loader", role: "status" },
    h("div", { class: "loader-road" }, carSvg({ color: "var(--flag)", tyre: "var(--tyre-S)", width: 180 })),
    h("p", { class: "muted" }, "Loading…"))), 180);
  try {
    const mod = await loader();
    const view = await mod.default(route);
    clearTimeout(slow);
    const swap = () => {
      app.classList.remove("enter");
      app.replaceChildren(view);
      void app.offsetWidth;
      app.classList.add("enter");
    };
    // smooth cross-fade between pages where the browser supports it; shared pieces (the session
    // switch, the race poster) glide into place instead of jumping
    if (document.startViewTransition && !reducedMotion() && app.firstElementChild && !app.querySelector(".pit-loader")) {
      document.documentElement.classList.add("vt");
      const t = document.startViewTransition(swap);
      t.finished.finally(() => document.documentElement.classList.remove("vt"));
      await t.updateCallbackDone;
    } else swap();
    document.title = mod.title ? `${mod.title(route)} | The Pit Lane` : "The Pit Lane";
  } catch (e) {
    clearTimeout(slow);
    console.error(e);
    app.replaceChildren(h("div", { class: "panel empty" },
      h("h2", {}, icon("alert", { size: 24 }), "This page couldn't load"),
      h("p", {}, "The data may still be updating after a session. Try again in a few minutes."),
      h("p", {}, h("a", { href: "#/" }, "Go to this weekend"))));
  }
}

function offlineNotice() {
  if (window.__DATA__) return;                       // single-file preview: everything is already on the page
  const bar = h("div", { class: "offline-bar", role: "status", hidden: navigator.onLine },
    icon("alert", { size: 16 }), "You're offline. Showing the data saved on this phone; it refreshes when you reconnect.");
  document.body.prepend(bar);
  window.addEventListener("offline", () => { bar.hidden = false; });
  window.addEventListener("online", () => { bar.hidden = true; render(); });
}

function registerWorker() {
  if (window.__DATA__ || !("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* site still works without it */ }));
}

async function start() {
  buildChrome();
  offlineNotice();
  registerWorker();
  const [season] = await Promise.all([load("season.json"), loadMedia()]);
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
