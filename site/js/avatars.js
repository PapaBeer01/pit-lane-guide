// Original illustrated avatars, drawn in the browser so they cost nothing to download.
// helmet(code): a generic racing helmet in the driver's team colour with a per-driver stripe pattern.
// teamBadge(team): a shield in the team colour with short initials. Neither copies any real helmet or logo.
import { picImg, pics } from "./pics.js";
import { driver, teamColor } from "./ui.js";

function hash(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
function hexToRgb(hex) {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v + amt * 255))));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const ACCENTS = ["#FFFFFF", "#11151B", "#FFC400", "#E10600", "#2D7FF9"];

export function helmet(code, { size = 48, cls = "" } = {}) {
  const d = driver(code);
  if (pics.helmets[code]) {                       // uploaded helmet picture
    const span = document.createElement("span");
    span.className = `helmet pic-helmet ${cls}`.trim();
    span.style.setProperty("--tc", d.color || "#8A929C");
    span.append(picImg(pics.helmets[code], `${d.name || code} helmet`, "", size));
    return span;
  }
  const base = d.color || "#8A929C";
  const hsh = hash(code);
  const light = luminance(base) > 0.45;
  let accent = ACCENTS[hsh % ACCENTS.length];
  if (accent.toLowerCase() === base.toLowerCase() || (light && accent === "#FFFFFF") || (!light && accent === "#11151B")) accent = light ? "#11151B" : "#FFFFFF";
  const pattern = (hsh >> 3) % 3;
  const ink = light ? "#11151B" : "#FFFFFF";
  const id = `hm-${code}-${size}`;
  const stripes = [
    `<path d="M10 40 C22 30 40 26 76 27 L76 33 C44 33 26 37 12 46 Z" fill="${accent}"/>`,
    `<path d="M30 10 C34 22 34 38 30 52 L38 52 C42 38 42 22 38 9 Z" fill="${accent}"/><path d="M44 8 C48 20 48 30 46 36 L52 36 C54 28 53 18 50 8 Z" fill="${accent}" opacity=".7"/>`,
    `<path d="M14 26 C28 14 50 10 70 18 L66 22 C50 16 30 19 18 30 Z" fill="${accent}"/><path d="M9 44 C24 42 44 44 76 46 L76 50 C46 49 24 48 10 49 Z" fill="${accent}" opacity=".85"/>`,
  ][pattern];
  const num = d.num || "";
  const svg = `<svg viewBox="0 0 84 60" width="${size}" height="${Math.round(size * 60 / 84)}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(base, 0.12)}"/><stop offset="1" stop-color="${shade(base, -0.18)}"/></linearGradient>
      <clipPath id="${id}c"><path d="M8 44 C8 22 24 8 44 8 C62 8 74 20 76 36 L76 46 C76 50 73 52 69 52 L20 52 C13 52 8 49 8 44 Z"/></clipPath>
    </defs>
    <path d="M8 44 C8 22 24 8 44 8 C62 8 74 20 76 36 L76 46 C76 50 73 52 69 52 L20 52 C13 52 8 49 8 44 Z" fill="url(#${id})"/>
    <g clip-path="url(#${id}c)">${stripes}</g>
    <path d="M45 23 L75 23 C76.5 27 76.5 32 75 36 L48 36 C43 36 41 32.5 42 29 Z" fill="#0B0E12"/>
    <path d="M49 25 L72 25 C73 27 73 28.5 72.6 30 L50 30 Z" fill="#fff" opacity=".22"/>
    <path d="M16 20 C24 13 34 11 42 11" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".35"/>
    <rect x="18" y="49" width="56" height="5" rx="2" fill="${shade(base, -0.3)}"/>
    ${num ? `<text x="27" y="40" font-family="Big Shoulders Display, sans-serif" font-weight="800" font-size="13" fill="${ink}" text-anchor="middle">${num}</text>` : ""}
  </svg>`;
  const span = document.createElement("span");
  span.className = `helmet ${cls}`.trim();
  span.style.setProperty("--tc", base);
  span.innerHTML = svg;
  return span;
}

// Avatar = helmet in a round team-tinted badge
export function avatar(code, { size = 44, ring = true } = {}) {
  const el = document.createElement("span");
  el.className = `avatar${ring ? " ring" : ""}`;
  el.style.setProperty("--tc", driver(code).color || "#8A929C");
  el.style.setProperty("--sz", `${size}px`);
  if (pics.drivers[code]) { el.classList.add("photo"); el.append(picImg(pics.drivers[code], driver(code).name || code)); }
  else el.append(helmet(code, { size: Math.round(size * 0.86) }));
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${driver(code).name || code} helmet illustration`);
  return el;
}

const SHORT = { "Racing Bulls": "RBS", "Red Bull Racing": "RBR", "Haas F1 Team": "HAAS" };
export function initials(team) {
  if (SHORT[team]) return SHORT[team];
  const words = team.replace(/F1 Team/g, "").trim().split(/\s+/);
  if (words.length === 1) return words[0].length <= 4 ? words[0].toUpperCase() : words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
}

export function teamBadge(team, { size = 28 } = {}) {
  if (pics.teams[team]) {                          // uploaded team logo
    const span = document.createElement("span");
    span.className = "team-badge pic-logo";
    span.style.setProperty("--sz", `${size}px`);
    span.append(picImg(pics.teams[team], `${team} logo`, "", size));
    return span;
  }
  const c = teamColor(team);
  const ink = luminance(c) > 0.45 ? "#11151B" : "#FFFFFF";
  const span = document.createElement("span");
  span.className = "team-badge";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 32 36" width="${size}" height="${Math.round(size * 36 / 32)}">
    <path d="M16 1 L30 6 V18 C30 27 23 33 16 35 C9 33 2 27 2 18 V6 Z" fill="${c}"/>
    <path d="M16 1 L30 6 V18 C30 27 23 33 16 35 Z" fill="#000" opacity=".14"/>
    <path d="M16 4 L27 8 V18 C27 25 22 30 16 32" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1"/>
    <text x="16" y="22" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="800" font-size="${initials(team).length > 3 ? 8.5 : initials(team).length > 2 ? 10 : 12}" fill="${ink}">${initials(team)}</text>
  </svg>`;
  return span;
}
