// Owner-supplied pictures (driver photos, helmets, team logos, cars) with the site's own drawings as fallback.
// site/img/manifest.json lists what exists, so a missing picture never costs a request or shows a broken image.
import { avatar, helmet, teamBadge } from "./avatars.js";
import { carSvg } from "./car.js";
import { loadPics, picImg, pics } from "./pics.js";
import { driver } from "./ui.js";

export const loadMedia = loadPics;
export const hasPhoto = (code) => !!pics.drivers[code];

// Big picture of a driver: photo if supplied, else their helmet (uploaded or drawn)
export function driverArt(code, { size = 150 } = {}) {
  const src = pics.drivers[code];
  return src ? picImg(src, driver(code).name || code, "driver-photo", null) : helmet(code, { size, cls: "art-helmet" });
}

// Round avatar (avatar() already prefers a photo)
export const face = (code, { size = 44 } = {}) => avatar(code, { size });

// Team mark: logo if supplied, else our shield badge (teamBadge() already prefers a logo)
export const teamArt = (team, { size = 28 } = {}) => teamBadge(team, { size });

// Car: uploaded side-on picture if supplied, else our own drawn car in team colour
export function carArt(team, { color, width = 110, cls = "", label } = {}) {
  const src = pics.cars[team];
  if (!src) return carSvg({ color, width, cls, label });
  const el = picImg(src, label || `${team} car`, `car-photo ${cls}`.trim(), null);
  el.style.width = `${width}px`;
  return el;
}
