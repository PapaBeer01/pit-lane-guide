// Owner-supplied pictures (driver photos, team logos, cars) with the site's own drawings as fallback.
// site/img/manifest.json lists what exists, so a missing picture never costs a request or shows a broken image.
import { avatar, helmet, teamBadge } from "./avatars.js";
import { driver } from "./ui.js";

let manifest = { drivers: {}, teams: {}, cars: {} };

export async function loadMedia() {
  if (window.__DATA__) return;
  try {
    const r = await fetch("img/manifest.json", { cache: "no-cache" });
    if (r.ok) manifest = { drivers: {}, teams: {}, cars: {}, ...(await r.json()) };
  } catch { /* no pictures uploaded: drawings everywhere */ }
}

function img(src, alt, cls, size) {
  const el = document.createElement("img");
  el.src = src;
  el.alt = alt;
  el.className = cls;
  el.loading = "lazy";
  el.decoding = "async";
  if (size) el.style.setProperty("--sz", `${size}px`);
  el.addEventListener("load", () => el.classList.add("in"), { once: true });
  return el;
}

export const hasPhoto = (code) => !!manifest.drivers[code];
export const hasLogo = (team) => !!manifest.teams[team];

// Big picture of a driver: photo if supplied, else a large helmet
export function driverArt(code, { size = 150 } = {}) {
  const d = driver(code);
  const src = manifest.drivers[code];
  return src ? img(src, d.name || code, "driver-photo", size) : helmet(code, { size, cls: "art-helmet" });
}

// Round avatar: photo crop if supplied, else helmet badge
export function face(code, { size = 44 } = {}) {
  const src = manifest.drivers[code];
  if (!src) return avatar(code, { size });
  const el = document.createElement("span");
  el.className = "avatar ring photo";
  el.style.setProperty("--tc", driver(code).color || "#8A929C");
  el.style.setProperty("--sz", `${size}px`);
  el.append(img(src, driver(code).name || code, "", null));
  return el;
}

// Team mark: logo if supplied, else our shield badge
export function teamArt(team, { size = 28 } = {}) {
  const src = manifest.teams[team];
  return src ? img(src, `${team} logo`, "team-logo", size) : teamBadge(team, { size });
}

export function carArt(team) {
  const src = manifest.cars[team];
  return src ? img(src, `${team} car`, "car-photo", null) : null;
}
