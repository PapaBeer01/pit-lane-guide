// Small helpers shared by every page: DOM building, data loading, formatting, glossary, motion.
import { icon } from "./icons.js";
import { picImg, pics } from "./pics.js";

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === null || sv === undefined) continue;
        if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const cache = new Map();
export async function load(path) {
  if (window.__DATA__ && path in window.__DATA__) return window.__DATA__[path];
  if (window.__DATA__) return null;
  if (cache.has(path)) return cache.get(path);
  const p = fetch(`data/${path}`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  cache.set(path, p);
  return p;
}

// ---------- season context ----------
export const ctx = { season: null, drivers: {}, override: {} };
// Official 2026 team colours (supplied by the site owner); data colours are the fallback
export const TEAM_COLORS = {
  "Red Bull Racing": "#4570C0", Ferrari: "#D52E37", Mercedes: "#75F1D3", McLaren: "#EF8733",
  "Aston Martin": "#4B9774", Alpine: "#479FE2", Williams: "#3267D4", "Racing Bulls": "#7091F8",
  "Haas F1 Team": "#DFE1E2", Audi: "#EB4526", Cadillac: "#AAAADD",
};
// Deep side of the team-colour cards, where the team colour alone is too pale to carry it
export const TEAM_DEEP = { Mercedes: "#1F7471" };
export function driver(code) {
  const base = ctx.drivers[code] || { code, name: code, team: "", color: "#8A929C", last: code };
  const o = ctx.override[code];
  const d = o ? { ...base, ...o } : base;
  const c = TEAM_COLORS[d.team];
  return c ? { ...d, color: c } : d;
}
// A race page shows teams as they were that weekend: a substitute or a driver who has since
// moved keeps that weekend's team and colour. The router clears this on every page change.
export function useSessionTeams(...sessions) {
  for (const s of sessions) {
    for (const r of s?.results || []) {
      if (r.team) ctx.override[r.code] = { team: r.team, color: r.color || (ctx.drivers[r.code] || {}).color || "#8A929C" };
    }
  }
}
export function clearSessionTeams() { ctx.override = {}; }
// "Racing Bulls (rounds 1–11), Red Bull Racing (12–14), Racing Bulls (15–18)" for drivers who switched
export function stintText(code) {
  const st = ctx.drivers[code]?.stints || [];
  if (st.length < 2) return null;
  const span = (s) => (s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`);
  return st.map((s, i) => `${s.team} (${i === 0 ? (s.from === s.to ? "round " : "rounds ") : ""}${span(s)})`).join(", ");
}
// drivers who count as "on the grid" here: that weekend's entry, or the current line-up
function pool() {
  const o = Object.keys(ctx.override);
  return o.length ? o : Object.values(ctx.drivers).filter((d) => d.current !== false).map((d) => d.code);
}
export function teamColor(team) {
  const c = pool().find((x) => driver(x).team === team);
  return c ? driver(c).color : "#8A929C";
}
export function teammates(code) {
  const t = driver(code).team;
  const order = Object.keys(ctx.drivers);
  const mates = new Set([code, ...pool().filter((c) => driver(c).team === t)]);
  return [...mates].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
// Second driver of a team gets a dashed line so teammates are never told apart by colour alone
export function isSecondDriver(code) {
  const mates = teammates(code);
  return mates.length > 1 && mates.indexOf(code) === 1;
}

// The team's mark beside a driver code: the uploaded team logo if there is one, else a dot in team colour
export function teamMark(code, { size = 16 } = {}) {
  const d = driver(code);
  const src = pics.icons[d.team] || pics.teams[d.team];      // icon-only mark first: clearer when small
  if (src) {
    const im = picImg(src, "", "team-mark", null);
    im.setAttribute("aria-hidden", "true");
    im.style.setProperty("--sz", `${size}px`);
    im.title = d.team;
    return im;
  }
  return h("i", { class: "team-dot", style: { background: d.color, boxShadow: `0 0 8px ${d.color}` }, "aria-hidden": "true" });
}
export const teamLogoSrc = (code) => pics.icons[driver(code).team] || pics.teams[driver(code).team] || null;

export function driverTag(code, { full = false } = {}) {
  const d = driver(code);
  return h("span", { class: "driver" },
    teamMark(code),
    code, full ? h("span", { class: "full" }, d.name) : null);
}

// ---------- events and sessions ----------
export const SESSION_LABEL = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", SQ: "Sprint Qualifying", S: "Sprint", Q: "Qualifying", R: "Grand Prix" };
export const SESSION_SHORT = { FP1: "FP1", FP2: "FP2", FP3: "FP3", SQ: "Sprint Quali", S: "Sprint", Q: "Quali", R: "Race" };

export function eventDone(ev) { return ev.sessions.every((s) => s.done); }
// The weekend happening now or next, by the calendar: a weekend counts as over 3 hours after its
// last session starts. (Not "first weekend with missing data": an old round still loading isn't next.)
export function nextEvent(now = Date.now()) {
  const evs = ctx.season?.events || [];
  const over = (e) => {
    const starts = e.sessions.map((s) => Date.parse(s.start)).filter((t) => !Number.isNaN(t));
    return starts.length && now > Math.max(...starts) + 3 * 3600e3;
  };
  return evs.find((e) => !over(e)) || evs[evs.length - 1];
}
export function lastCompleted() {
  return [...(ctx.season?.events || [])].reverse().find((e) => e.sessions.some((s) => s.done && (s.key === "R")));
}
export function eventByRound(r) { return (ctx.season?.events || []).find((e) => e.round === Number(r)); }

// ---------- formatting ----------
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function localTime(iso, opts = {}) {
  if (!iso) return "Time to be confirmed";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...opts }).format(d);
}
export function localDate(iso) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));
}
// The viewer's time zone by name and offset, e.g. "WAT, GMT+1" or "West Africa Time, GMT+1",
// so visitors anywhere can see which zone the times are in.
export function tzName() {
  try {
    const part = (style) => new Intl.DateTimeFormat(undefined, { timeZoneName: style }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    const isOffset = (v) => !v || /^(GMT|UTC)([+-]|$)/.test(v);
    const offset = part("shortOffset") || part("short");
    const name = !isOffset(part("short")) ? part("short") : !isOffset(part("long")) ? part("long") : null;
    return name && offset && name !== offset ? `${name}, ${offset}` : offset || name || tz;
  } catch { return tz; }
}
export function countdown(iso, now = Date.now()) {
  const ms = new Date(iso) - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 864e5), hrs = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  if (d > 0) return `${d}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${m}m`;
  return `${m}m`;
}
export function lapTime(s) {
  if (s === null || s === undefined) return "–";
  const m = Math.floor(s / 60), sec = s - m * 60;
  return m ? `${m}:${sec.toFixed(3).padStart(6, "0")}` : sec.toFixed(3);
}
export function pct(p, digits = 0) {
  if (p === null || p === undefined) return "–";
  const v = p * 100;
  if (v > 0 && v < 1) return "<1%";
  if (v < 100 && v > 99) return ">99%";
  return `${v.toFixed(digits)}%`;
}
export function ordinal(n) { return `P${n}`; }

// ---------- small visual pieces ----------
// On a slow connection or with data saver on, skip heavy effects and extra downloads
const conn = navigator.connection || {};
export const liteMode = () => Boolean(conn.saveData) || ["slow-2g", "2g"].includes(conn.effectiveType);
export const reducedMotion = () => liteMode() || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Bars grow from zero once they're on screen; numbers count up alongside
const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    io.unobserve(el);
    if (el.dataset.w) el.style.width = el.dataset.w;
    if (el.dataset.count) countUp(el, Number(el.dataset.count), el.dataset.fmt);
  }
}, { rootMargin: "0px", threshold: 0 }) : null;
function watch(el) { if (io && !reducedMotion()) io.observe(el); else { if (el.dataset.w) el.style.width = el.dataset.w; } return el; }

export function countUp(el, target, fmt = "pct") {
  const show = (v) => { el.textContent = fmt === "pct" ? pct(v) : fmt === "int" ? Math.round(v) : v.toFixed(1); };
  if (reducedMotion()) return show(target);
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    show(target * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export function animatedNumber(value, fmt = "pct", cls = "") {
  const el = h("span", { class: cls, "data-count": value, "data-fmt": fmt }, fmt === "pct" ? pct(value) : fmt === "int" ? Math.round(value) : value.toFixed(1));
  if (io && !reducedMotion()) { el.textContent = fmt === "pct" ? "0%" : "0"; io.observe(el); }
  return el;
}

export function probBar(p, top = false) {
  const bar = h("i", { "data-w": `${Math.max(0, Math.min(1, p || 0)) * 100}%` });
  return h("span", { class: `prob${top ? " top" : ""}` },
    h("span", { class: "prob-bar", "aria-hidden": "true" }, watch(bar)), pct(p));
}
export function meter(p, color) {
  const bar = h("i", { "data-w": `${Math.max(0, Math.min(1, p || 0)) * 100}%`, style: { background: color } });
  return h("span", { class: "meter", "aria-hidden": "true" }, watch(bar));
}

// Countdown that ticks every second while it's on the page
export function liveCountdown(iso) {
  const el = h("span", { class: "countdown", role: "timer" });
  const tick = () => {
    const ms = new Date(iso) - Date.now();
    if (ms <= 0) { el.replaceChildren(h("span", { class: "live-dot" }), " Under way"); return false; }
    const d = Math.floor(ms / 864e5), hr = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), sec = Math.floor((ms % 6e4) / 1e3);
    const units = d > 0 ? [[d, "d"], [hr, "h"], [m, "m"]] : [[hr, "h"], [m, "m"], [sec, "s"]];
    el.replaceChildren(...units.map(([v, u]) => h("span", { class: "cd-unit" }, String(v).padStart(2, "0"), h("small", {}, u))));
    el.setAttribute("aria-label", `${d ? `${d} days ` : ""}${hr} hours ${m} minutes`);
    return true;
  };
  tick();
  const id = setInterval(() => { if (!el.isConnected && el.dataset.mounted) { clearInterval(id); return; } if (el.isConnected) el.dataset.mounted = "1"; if (!tick()) clearInterval(id); }, 1000);
  return el;
}

export function noteList(notes, ic = "sparkle") {
  return h("ul", { class: "notes" }, notes.map((n) => h("li", {}, icon(ic, { size: 16 }), h("span", {}, n))));
}

// Predicted range on a 1..n scale, with predicted spot and optional actual result
export function rangeBar(lo, hi, pred, n, actual) {
  const x = (v) => `${((v - 1) / Math.max(1, n - 1)) * 100}%`;
  const label = `Likely P${lo} to P${hi}, predicted P${pred}` + (actual ? `, finished P${actual}` : "");
  return h("span", { class: "range", role: "img", "aria-label": label, title: label },
    h("span", { class: "track" }),
    h("span", { class: "span", style: { left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` } }),
    h("span", { class: "dot", style: { left: x(pred) } }),
    actual ? h("span", { class: "act", style: { left: x(actual) } }) : null);
}
// A tyre marker with its letter: the uploaded tyre picture if there is one, else our coloured ring
export function tyreDot(c, extra = {}) {
  const name = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" }[c] || "Unknown";
  if (pics.tyres[c]) {
    const im = picImg(pics.tyres[c], `${name} tyre`, "tyre-pic", null);
    im.title = name;
    return im;
  }
  return h("span", { class: `tyre-dot t-${c}`, ...extra }, c);
}
export function tyre(c) {
  const name = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" }[c] || "Unknown";
  if (pics.tyres[c]) { const im = picImg(pics.tyres[c], `${name} tyre`, "tyre-pic small", null); im.title = `${name} tyre`; return im; }
  return h("span", { class: "tyre", style: { "--c": `var(--tyre-${c})` }, title: `${name} tyre`, "aria-label": `${name} tyre` });
}

// ---------- glossary: tap a dotted term to get a plain explanation ----------
export const GLOSSARY = {
  pole: ["Pole position", "First place on the starting grid, earned by setting the fastest lap in qualifying."],
  grid: ["Starting grid", "The order cars line up in for the start, two by two. It comes from qualifying, minus any penalties."],
  quali: ["Qualifying", "A one-hour session in three parts (Q1, Q2, Q3). The slowest cars drop out after Q1 and Q2; the last ten fight for pole in Q3."],
  sprint: ["Sprint", "A short race of about 100 km on some weekends, with no pit stop needed. The top eight score points."],
  undercut: ["Undercut", "Pitting before the car ahead. Fresh tyres are faster, so you can gain enough time to come out in front once they stop."],
  sc: ["Safety car", "A car that leads the field slowly after a crash or danger on track. Gaps shrink, so leaders lose their advantage."],
  dnf: ["DNF", "Did not finish: a car that retired from the race, through a crash or a technical failure."],
  compound: ["Tyre compounds", "Soft (red) is fastest but wears quickly, medium (yellow) is in between, hard (white) is slowest but lasts longest. Green and blue are for rain."],
  deg: ["Tyre degradation", "Tyres lose grip as they wear, so lap times slowly get worse during a stint."],
  stint: ["Stint", "The laps a driver does on one set of tyres, between pit stops."],
  longrun: ["Long run", "In practice, several laps in a row with more fuel, used to judge race pace rather than one-lap speed."],
  fastest: ["Fastest lap", "The quickest single lap of the race. Since 2025 it no longer earns a bonus point, but it shows who had the pace."],
  range: ["Predicted range", "Where we think a driver will most likely end up. In 6 out of 10 simulations they finish inside this range."],
  penalty: ["Grid penalty", "A drop down the starting grid, often for using too many engine parts or for an offence in an earlier session."],
};
let openPop = null;
export function term(key, text) {
  const btn = h("button", { class: "term", type: "button", "aria-haspopup": "dialog" }, text || GLOSSARY[key][0]);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    closePop();
    const [title, body] = GLOSSARY[key];
    const pop = h("div", { class: "pop", role: "dialog", "aria-label": title }, h("h3", {}, title), h("p", {}, body));
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 32);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(16, Math.min(r.left, window.innerWidth - w - 16))}px`;
    const below = r.bottom + 8;
    pop.style.top = `${below + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 8 : below}px`;
    openPop = pop;
  });
  return btn;
}
export function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
document.addEventListener("click", closePop);
window.addEventListener("scroll", closePop, { passive: true });

export function section(title, intro, ...body) {
  let ic = null;
  if (Array.isArray(title)) [title, ic] = title;
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", {}, ic ? icon(ic, { size: 24 }) : null, title), intro ? h("p", { class: "muted" }, intro) : null),
    ...body);
}
export function empty(text, action) {
  return h("div", { class: "panel empty" }, h("p", {}, text), action || null);
}
