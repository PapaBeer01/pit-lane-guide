import { icon } from "./icons.js";
import { loadMedia, loaderCar } from "./media.js";
import { awaitingResults, clearDataCache, clearSessionTeams, ctx, h, load, localTime, nextEvent, reducedMotion } from "./ui.js";

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
  teardown: () => import("./pages/teardown.js"),
  data: () => import("./pages/data.js"),          // Data room: not in the menus
};
// The menu: one button, one grouped drop-down. Learn topics link straight to their explainer
// (#/learn/<topic>); their titles match the TOPICS list in pages/learn.js.
export const LEARN_TOPICS = [
  ["How a race weekend works", "calendar"], ["Qualifying: the knockout", "timer"], ["Tyres and why they matter", "tyre"],
  ["Pit stops, the undercut and the overcut", "wrench"], ["Safety cars, virtual safety cars and red flags", "alert"],
  ["How points work", "trophy"], ["Grid penalties", "down"], ["What changed in 2026", "bolt"],
  ["Reading the charts on this site", "compare"],
];
export const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function menuGroups() {
  const ev = nextEvent();
  return [
    ["This weekend", [
      ["", "This weekend", "flag", "Countdown, predictions, schedule"],
      ev ? [`race/${ev.round}`, `Race centre`, "chequered", ev.name] : null,
    ]],
    ["Season", [
      ["races", "Races", "calendar", "Every round, results and reports"],
      ["standings", "Standings", "trophy", "Drivers' and teams' points"],
      ["drivers", "Drivers", "helmet", "Profiles and season records"],
      ["compare", "Compare", "compare", "Any two drivers, head to head"],
      ["form", "Form guide", "pulse", "Who's running cleanly, who isn't"],
    ]],
    ["Our predictions", [
      [`learn/${slug("How our predictions work")}`, "How they work", "gauge", "The model in plain words"],
      ["accuracy", "How accurate they are", "target", "Every prediction, scored"],
    ]],
    ["Learn F1", [
      ["teardown", "RB22 teardown", "wrench", "Take this year's Red Bull apart in 3D"],
      ["learn", "New to F1? Start here", "book", "All the explainers on one page"],
      ...LEARN_TOPICS.map(([t, ic]) => [`learn/${slug(t)}`, t, ic]),
    ]],
  ].map(([g, items]) => [g, items.filter(Boolean)]);
}
// which menu entry a page belongs to
const navFor = { race: "races", driver: "drivers" };

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "", args: parts.slice(1), query: new URLSearchParams(query) };
}

let menu;
function buildMenu() {
  const btn = h("button", { class: "menu-btn", type: "button", "aria-expanded": "false", "aria-controls": "site-menu", "aria-haspopup": "true" },
    icon("menu", { size: 20 }), h("span", { class: "menu-current" }, "Menu"), h("span", { class: "chev" }, icon("chevron", { size: 16 })));
  const panel = h("div", { class: "menu-panel", id: "site-menu", hidden: true, role: "dialog", "aria-label": "Site menu" });
  const fill = () => panel.replaceChildren(...menuGroups().map(([g, items]) =>
    h("div", { class: `menu-group${g === "Learn F1" ? " learn" : ""}` },
      h("h2", {}, g),
      h("ul", {}, items.map(([r, label, ic, sub]) => h("li", {},
        h("a", { href: `#/${r}`, "data-route": r }, icon(ic, { size: 18 }),
          h("span", {}, h("b", {}, label), sub ? h("small", {}, sub) : null))))))));
  const open = (yes) => {
    if (yes) fill();
    panel.hidden = !yes;
    btn.setAttribute("aria-expanded", String(yes));
    document.documentElement.classList.toggle("menu-open", yes);
    if (yes) (panel.querySelector('[aria-current="page"]') || panel.querySelector("a"))?.focus({ preventScroll: true });
    if (yes) mark();
  };
  btn.addEventListener("click", () => open(panel.hidden));
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) open(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { open(false); btn.focus(); } });
  document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) open(false); });
  const mark = () => {
    const raw = location.hash.replace(/^#\/?/, "").split("?")[0];
    const r = parse(), base = r.name in navFor ? navFor[r.name] : r.name;
    let current = null;
    panel.querySelectorAll("a").forEach((a) => {
      const hit = a.dataset.route === raw || (!panel.querySelector(`a[data-route="${CSS.escape(raw)}"]`) && a.dataset.route === base);
      if (hit && !current) { a.setAttribute("aria-current", "page"); current = a; } else a.removeAttribute("aria-current");
    });
    btn.querySelector(".menu-current").textContent = current ? current.querySelector("b").textContent : "Menu";
  };
  menu = { open, mark, fill };
  return h("div", { class: "menu" }, btn, panel);
}

function buildChrome() {
  // the logo stays the chequered flag from index.html
  document.getElementById("nav").replaceChildren(buildMenu());
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
  document.getElementById("actions").replaceChildren(themeBtn);
}

async function render() {
  const app = document.getElementById("app");
  clearSessionTeams();
  const route = parse();
  const loader = routes[route.name] || routes[""];
  menu?.fill();
  menu?.mark();
  // show a skeleton if the page takes more than a moment (slow mobile data)
  // on a slow connection, a car runs on the spot over a moving track until the page arrives
  const slow = setTimeout(() => app.replaceChildren(h("div", { class: "pit-loader", role: "status" },
    h("div", { class: "loader-road" }, loaderCar()),
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
  window.addEventListener("hashchange", () => {
    // explainer links scroll to their topic, so don't jump back to the top for those
    if (!location.hash.startsWith("#/learn/")) window.scrollTo({ top: 0 });
    render();
  });
  render();
  watchForResults();
}

// While a session is on or its results are on the way, check for new data every minute and
// redraw the page when it arrives, so nobody has to keep refreshing after the chequered flag.
function watchForResults() {
  if (window.__DATA__) return;
  const check = async () => {
    if (document.hidden || !awaitingResults()) return;
    const fresh = await fetch("data/season.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!fresh || fresh.updated === ctx.season.updated) return;
    clearDataCache();
    ctx.season = fresh;
    ctx.drivers = Object.fromEntries(fresh.drivers.map((d) => [d.code, d]));
    document.getElementById("updated").textContent = `Data last changed ${localTime(fresh.updated)}.`;
    const y = window.scrollY;
    await render();
    window.scrollTo({ top: y });
    const t = h("div", { class: "toast", role: "status" }, icon("check", { size: 16 }), "New results are in");
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  };
  setInterval(check, 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}
start();
