// Owner-supplied pictures (driver photos, helmets, team logos, cars) with the site's own drawings as fallback.
// site/img/manifest.json lists what exists, so a missing picture never costs a request or shows a broken image.
import { avatar, helmet, teamBadge } from "./avatars.js";
import { carSvg } from "./car.js";
import { loadPics, picImg, pics } from "./pics.js";
import { driver, reducedMotion } from "./ui.js";

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

// Uploaded cars taking turns: in the logo at the top (one fades into the next every few seconds)
// and on the loading screen (a different car each time). Falls back to our drawn car.
const carList = () => Object.entries(pics.cars);
let nextCar = 0;

export function brandCars() {
  const list = carList();
  if (!list.length) return null;
  const box = document.createElement("span");
  box.className = "brand-cars";
  box.setAttribute("aria-hidden", "true");
  let i = Math.floor(Math.random() * list.length);
  // pictures are fetched one at a time, just before their turn, to keep data use low
  const imgs = list.map(() => { const im = picImg("", "", ""); im.removeAttribute("src"); im.loading = "eager"; box.append(im); return im; });
  const ready = (k) => { if (!imgs[k].src) imgs[k].src = list[k][1]; };
  ready(i);
  imgs[i].classList.add("on");
  if (!reducedMotion() && list.length > 1) {
    ready((i + 1) % imgs.length);
    setInterval(() => {
      if (document.hidden) return;
      imgs[i].classList.remove("on");
      i = (i + 1) % imgs.length;
      imgs[i].classList.add("on");
      ready((i + 1) % imgs.length);
    }, 3500);
  }
  return box;
}

export function loaderCar() {
  const list = carList();
  if (!list.length) return carSvg({ color: "var(--flag)", tyre: "var(--tyre-S)", width: 180 });
  const [team, src] = list[nextCar++ % list.length];
  const im = picImg(src, `${team} car`, "loader-car", null);
  im.loading = "eager";
  return im;
}
