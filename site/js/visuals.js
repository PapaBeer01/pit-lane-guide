// Picture-led pieces for race pages and the calendar: race posters with the real track shape,
// team-colour podium cards, big-number cards (fastest lap, top speed, throttle), the
// "who was quickest where" track map, chunky tyre-strategy bars and the session picker.
import { icon } from "./icons.js";
import { driverArt, teamArt } from "./media.js";
import { picImg, pics } from "./pics.js";
import { ctx, driver, teamMark, TEAM_DEEP, h, lapTime, load, localDate, reducedMotion, SESSION_SHORT, tyreDot } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
const TYRE_NAME = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" };

// ---------- colour helpers ----------
function rgb(hex) {
  const m = (hex || "#888").replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function isLight(hex) {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42;
}

// ---------- countries: flag and two poster colours ----------
const COUNTRY = {
  Australia: ["AU", "#00247D", "#FFCD00"], China: ["CN", "#DE2910", "#FFDE00"], Japan: ["JP", "#BC002D", "#F4F4F4"],
  "United States": ["US", "#1B3A8C", "#C8102E"], Canada: ["CA", "#D52B1E", "#F4F4F4"], Monaco: ["MC", "#CE1126", "#F4F4F4"],
  Spain: ["ES", "#C60B1E", "#FFC400"], Austria: ["AT", "#C8102E", "#F4F4F4"], "United Kingdom": ["GB", "#012169", "#C8102E"],
  "Great Britain": ["GB", "#012169", "#C8102E"], Belgium: ["BE", "#1A1A1A", "#FDDA24"], Hungary: ["HU", "#CE2939", "#477050"],
  Netherlands: ["NL", "#AE1C28", "#FF7A00"], Italy: ["IT", "#009246", "#CE2B37"], Azerbaijan: ["AZ", "#0092BC", "#E4002B"],
  Bahrain: ["BH", "#CE1126", "#F4F4F4"], Malaysia: ["MY", "#010066", "#CC0001"], Singapore: ["SG", "#EF3340", "#F4F4F4"],
  Mexico: ["MX", "#006847", "#CE1126"], Brazil: ["BR", "#009C3B", "#FFDF00"], Qatar: ["QA", "#8A1538", "#F4F4F4"],
  "United Arab Emirates": ["AE", "#00732F", "#C8102E"], "Saudi Arabia": ["SA", "#006C35", "#F4F4F4"], Portugal: ["PT", "#006600", "#FF0000"],
  France: ["FR", "#0055A4", "#EF4135"], Germany: ["DE", "#1A1A1A", "#DD0000"], Argentina: ["AR", "#74ACDF", "#F4F4F4"],
};
export function flag(country) {
  const iso = COUNTRY[country]?.[0];
  if (!iso) return "";
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
const posterColors = (country) => (COUNTRY[country] || [null, "#3A4350", "#8D97A5"]).slice(1);

// ---------- track outlines (tracks.json: every round, the usual way up, in a 0-100 box) ----------
let tracksP = null;
export function tracks() { tracksP ||= load("tracks.json").then((d) => d?.tracks || {}); return tracksP; }

function pathOf(p) {
  let d = "";
  for (let i = 0; i < p.length; i += 2) d += `${i ? "L" : "M"}${p[i]},${p[i + 1]}`;
  return `${d}Z`;
}

export function trackOutline(t, { cls = "track-art", glow = true, draw = true, label = "Track layout", team = null, carSize = 11, rotate = false } = {}) {
  if (!t) return null;
  const pad = 9;
  const svg = s("svg", { viewBox: `${-pad} ${-pad} ${t.w + pad * 2} ${t.h + pad * 2}`, class: cls, role: "img", "aria-label": label });
  const d = pathOf(t.p);
  const glowEl = glow ? s("path", { d, class: "tr-glow", "pathLength": 1 }) : null;
  if (glowEl) svg.append(glowEl);
  // lap cars: a top view if uploaded (turns naturally), else the side-on picture
  const topOf = (tm) => pics["cars-top"]?.[tm];
  const lapSrc = (tm) => topOf(tm) || pics.cars[tm];
  const carSrc = team && lapSrc(team);
  const animate = draw && !reducedMotion();
  rotate = rotate && animate;
  const line = s("path", { d, class: `tr-line${animate && !carSrc ? " draw" : ""}`, "pathLength": 1 });
  svg.append(line);
  if (!carSrc) {
    svg.append(s("circle", { cx: t.p[0], cy: t.p[1], r: 2.4, class: "tr-start" }));
    return svg;
  }
  // a team car instead of the start dot: it drives one lap, drawing the white line behind it, then parks on the line
  svg.append(s("rect", { x: t.p[0] - 0.6, y: t.p[1] - 3.2, width: 1.2, height: 6.4, class: "tr-startline" }));
  const sizeFor = (top) => (top ? { width: carSize * 1.1, height: carSize * 0.55, x: -carSize * 0.55, y: -carSize * 0.275, preserveAspectRatio: "xMidYMid meet" }
    : { width: carSize, height: carSize * 0.32, x: -carSize / 2, y: -carSize * 0.26, preserveAspectRatio: "xMidYMax meet" });
  let isTop = !!topOf(team);
  const car = s("image", { href: carSrc, class: "tr-car", ...sizeFor(isTop) });
  const holder = s("g", {}, car);
  svg.append(holder);
  const place = (len, total) => {
    const p = line.getPointAtLength(len % total);
    const q = line.getPointAtLength((len + 0.8) % total);
    const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    const flip = !isTop && Math.abs(ang) > 90 ? " scale(1,-1)" : "";   // side views: keep the wheels underneath
    holder.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${ang.toFixed(1)})${flip}`);
  };
  requestAnimationFrame(() => {
    let total;
    try { total = line.getTotalLength(); } catch { return; }
    if (!total) return;
    if (!animate) { place(0, total); return; }
    for (const el of [line, glowEl]) if (el) { el.style.strokeDasharray = "1"; el.style.strokeDashoffset = "1"; }
    const dur = 5200, start = performance.now() + 250;
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
    const step = (now) => {
      const k = Math.max(0, Math.min(1, (now - start) / dur));
      const e = ease(k);
      place(e * total, total);
      for (const el of [line, glowEl]) if (el) el.style.strokeDashoffset = String(1 - e);
      if (k < 1 && svg.isConnected) requestAnimationFrame(step);
      else if (k >= 1) { place(0, total); for (const el of [line, glowEl]) if (el) el.style.strokeDashoffset = "0"; if (rotate) setTimeout(() => nextLap(total), 1400); }
    };
    place(0, total);
    requestAnimationFrame(step);
  });
  // after the first lap, the other teams' cars take turns lapping (paused when off screen or in another tab)
  const others = rotate ? [...new Set([...Object.keys(pics["cars-top"] || {}), ...Object.keys(pics.cars)])].filter((tm) => tm !== team).map((tm) => [tm, lapSrc(tm)]) : [];
  let turn = Math.floor(Math.random() * Math.max(1, others.length));
  let visible = true;
  if (rotate && "IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(svg);
  function nextLap(total) {
    if (!svg.isConnected || !others.length) return;
    if (!visible || document.hidden) { setTimeout(() => nextLap(total), 1000); return; }
    const [tm, src] = others[turn++ % others.length];
    holder.style.opacity = "0";
    setTimeout(() => {
      car.setAttribute("href", src);
      isTop = !!topOf(tm);
      for (const [k, v] of Object.entries(sizeFor(isTop))) car.setAttribute(k, v);
      holder.style.opacity = "1";
      const dur = 6000, start = performance.now() + 150;
      const lap = (now) => {
        if (!svg.isConnected) return;
        const k = Math.max(0, Math.min(1, (now - start) / dur));
        place((k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2) * total, total);
        if (k < 1) requestAnimationFrame(lap); else { place(0, total); setTimeout(() => nextLap(total), 1600); }
      };
      requestAnimationFrame(lap);
    }, 300);
  }
  return svg;
}

// ---------- race poster ----------
export function posterCard(ev, track, { compact = false, team = null } = {}) {
  const [c1, c2] = posterColors(ev.country);
  const words = ev.name.replace(/Grand Prix$/i, "").trim();
  const race = ev.sessions.find((x) => x.key === "R");
  const first = ev.sessions[0];
  const span = first && race ? `${localDate(first.start)} – ${localDate(race.start)}` : race ? localDate(race.start) : "";
  return h("section", { class: `poster${compact ? " compact" : ""}`, style: { "--c1": c1, "--c2": c2 } },
    h("div", { class: "poster-text" },
      h("p", { class: "poster-round" }, h("span", { class: "flag-emoji", "aria-hidden": "true" }, flag(ev.country)),
        `Round ${ev.round} of ${ctx.season?.events?.length || ""}`, ev.format === "sprint" ? h("span", { class: "chip best" }, icon("bolt", { size: 12 }), "Sprint weekend") : null),
      h("h1", { class: "poster-title" }, h("span", { class: "solid" }, words), h("span", { class: "outline" }, "Grand Prix")),
      h("div", { class: "poster-pills" },
        h("span", { class: "pill" }, icon("pin", { size: 14 }), `${ev.location}, ${ev.country}`),
        span ? h("span", { class: "pill light" }, span) : null,
        track?.length ? h("span", { class: "pill" }, `${(track.length / 1000).toFixed(2)} km lap`) : null)),
    h("div", { class: "poster-track" }, trackOutline(track, { label: `${ev.location} track layout`, team, rotate: true })));
}

// ---------- podium cards ----------
export function podiumCards(rows, gapText, { label = "Podium" } = {}) {
  const top = rows.filter((r) => r.pos && r.pos <= 3).sort((a, b) => a.pos - b.pos);
  if (!top.length) return null;
  return h("section", { class: "pod-cards", "aria-label": label }, top.map((r, i) => {
    const d = driver(r.code);
    const c = d.color || "#8A929C";
    const light = isLight(c);
    return h("a", {
      class: `pod-card${light ? " light" : ""}`, href: `#/driver/${r.code}`,
      style: { "--tc": c, "--deep": TEAM_DEEP[d.team] || null, animationDelay: `${i * 90}ms` }, "aria-label": `P${r.pos} ${d.name}, ${d.team}: ${gapText(r)}`,
    },
      h("span", { class: "pc-mark", "aria-hidden": "true" }, teamArt(d.team, { size: 120 })),
      h("span", { class: "pc-art" }, driverArt(r.code, { size: 150 })),
      h("span", { class: "pc-strip" },
        h("b", { class: "pc-code" }, r.code),
        h("span", { class: "pc-name" }, d.last || d.name, h("small", {}, d.team)),
        h("span", { class: "pc-pos" }, `P${r.pos}`),
        h("span", { class: "pc-gap" }, gapText(r))));
  }));
}

// ---------- big numbers ----------
export function fastestLapCard(f) {
  if (!f?.code) return null;
  const d = driver(f.code);
  const t = f.tyre;
  return h("section", { class: "hero-num fl-card" },
    h("div", { class: "hn-head" }, h("span", { class: "hn-title" }, icon("timer", { size: 20 }), "Fastest lap"),
      f.lap ? h("span", { class: "hn-side" }, icon("flag", { size: 16 }), `Lap ${f.lap}`) : null),
    h("p", { class: "hn-big" }, lapTime(f.time)),
    h("div", { class: "hn-row" },
      h("span", { class: "hn-who" }, teamMark(f.code, { size: 22 }), f.code, h("small", {}, d.name)),
      t ? h("span", { class: "hn-tyre" }, tyreDot(t.c), TYRE_NAME[t.c] || "") : null),
    t ? h("div", { class: "hn-foot" },
      h("span", {}, icon(t.new ? "sparkle" : "layers", { size: 16 }), t.new ? "Fresh set of tyres" : "Used tyres"),
      h("span", {}, icon("tyre", { size: 16 }), `Tyres ${t.age} lap${t.age === 1 ? "" : "s"} old`)) : null);
}

function gauge(share) {
  // semicircle from 180° (left) to 0° (right): green part = time flat out
  const R = 80, r = 54, cx = 100, cy = 96;
  const pt = (a, rad) => [cx + Math.cos(a) * rad, cy - Math.sin(a) * rad];
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
    const big = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`;
  };
  const split = Math.PI * (1 - share);
  const needle = s("g", { class: "g-needle", style: `--a:${(share * 180 - 90).toFixed(1)}deg` },
    s("path", { d: `M${cx - 4},${cy} L${cx},${cy - R + 6} L${cx + 4},${cy} Z`, fill: "var(--ink)" }),
    s("circle", { cx, cy, r: 7, fill: "var(--ink)" }));
  return s("svg", { viewBox: "0 0 200 112", class: "gauge", role: "img", "aria-label": `${Math.round(share * 100)}% of the lap at full throttle` },
    s("path", { d: arc(Math.PI, 0), fill: "var(--surface-3)" }),
    s("path", { d: arc(Math.PI, split), fill: "var(--green)", class: "g-fill" }),
    needle);
}

export function speedCard(hero) {
  if (!hero?.top_speed && !hero?.throttle) return null;
  const ts = hero.top_speed, th = hero.throttle;
  return h("section", { class: "hero-num speed-card" },
    th ? h("div", { class: "g-wrap" },
      gauge(th.full),
      h("div", { class: "g-labels" }, h("span", { class: "g-on" }, `${Math.round(th.full * 100)}%`), h("span", { class: "g-off" }, `${100 - Math.round(th.full * 100)}%`)),
      h("p", { class: "g-cap" }, h("b", {}, "Full throttle"), h("small", {}, `Share of ${th.code}'s fastest lap with the pedal flat`))) : null,
    ts ? h("div", { class: "ts" },
      h("span", { class: "ts-label" }, icon("bolt", { size: 18 }), "Top speed"),
      h("p", { class: "ts-big" }, `${ts.kmh}`, h("small", {}, " km/h")),
      h("p", { class: "ts-mph" }, `${ts.mph} mph`),
      h("p", { class: "ts-who" }, teamMark(ts.code, { size: 18 }), ts.code, h("small", {}, " on their fastest lap"))) : null);
}

// ---------- who was quickest where (top three) ----------
export function quickestMap(t, minis) {
  if (!t || !minis?.codes?.length) return null;
  const seen = new Set();
  const colors = minis.codes.map((c) => {
    let col = driver(c).color || "#8A929C";
    if (seen.has(col)) col = `color-mix(in srgb, ${col} 50%, #ffffff)`;
    seen.add(driver(c).color);
    return col;
  });
  const pad = 9;
  const svg = s("svg", { viewBox: `${-pad} ${-pad} ${t.w + pad * 2} ${t.h + pad * 2}`, class: "qmap", role: "img",
    "aria-label": `Track map coloured by who was quickest in each part of the lap: ${minis.codes.join(", ")}` });
  svg.append(s("path", { d: pathOf(t.p), class: "q-base" }));
  const n = t.p.length / 2, k = minis.fastest.length;
  for (let m = 0; m < k; m++) {
    const a = Math.floor((m / k) * n), b = Math.min(n, Math.floor(((m + 1) / k) * n) + 1);
    let d = "";
    for (let i = a; i <= b; i++) { const j = i % n; d += `${i === a ? "M" : "L"}${t.p[j * 2]},${t.p[j * 2 + 1]}`; }
    svg.append(s("path", { d, class: "q-seg", stroke: colors[minis.fastest[m]], style: `animation-delay:${m * 40}ms` }));
  }
  svg.append(s("circle", { cx: t.p[0], cy: t.p[1], r: 2.6, class: "tr-start" }));
  const counts = minis.codes.map((_, i) => minis.fastest.filter((x) => x === i).length);
  return h("section", { class: "panel qmap-card" },
    h("h3", { class: "qm-title" }, icon("pin", { size: 18 }), "Who was quickest where"),
    svg,
    h("div", { class: "qm-key" }, minis.codes.map((c, i) => h("span", {}, h("i", { style: { background: colors[i] } }), teamMark(c, { size: 14 }), h("b", {}, c), `${counts[i]} of ${k} parts`))),
    h("p", { class: "small muted" }, "The lap split into equal parts, coloured by which of the top three was fastest through each one on their best lap."));
}

// Inside a stint bar: the uploaded tyre picture at the start of the bar (when there's room), then the lap count
export function stintLabel(c, laps, share) {
  const pic = pics.tyres[c] && share > 0.11 ? picImg(pics.tyres[c], "", "stint-tyre", null) : null;
  if (pic) pic.setAttribute("aria-hidden", "true");
  return [pic, share > 0.055 ? h("span", { class: "stint-n" }, laps) : null];
}

// ---------- tyre strategy: one thick bar per driver, lap counts inside, tap for details ----------
export function tyreBars(order, stints, totalLaps) {
  const total = totalLaps || Math.max(1, ...order.flatMap((c) => (stints[c] || []).map((x) => x.to)));
  const pop = h("div", { class: "tb-pop", role: "status", hidden: true });
  const wrap = h("div", { class: "tb" });
  let openRow = null;
  const close = () => { pop.hidden = true; openRow?.classList.remove("on"); openRow = null; };
  const rows = order.filter((c) => (stints[c] || []).length).map((code) => {
    const st = stints[code];
    const label = st.map((x) => `${TYRE_NAME[x.c] || "Unknown"} for ${x.to - x.from + 1} laps`).join(", then ");
    const row = h("button", { class: "tb-row", type: "button", "aria-label": `${code}: ${label}` },
      h("span", { class: "tb-code" }, teamMark(code, { size: 14 }), code),
      h("span", { class: "tb-track" }, st.map((x, i) => {
        const laps = x.to - x.from + 1;
        return h("span", {
          class: `tb-stint t-${x.c}`,
          style: { left: `${((x.from - 1) / total) * 100}%`, width: `calc(${(laps / total) * 100}% - 3px)`, animationDelay: `${i * 70}ms` },
        }, stintLabel(x.c, laps, laps / total));
      })));
    const show = () => {
      if (openRow === row) { close(); return; }
      close();
      openRow = row; row.classList.add("on");
      pop.replaceChildren(h("b", {}, `${code}  ${driver(code).name}`),
        ...st.map((x) => h("span", { class: "tb-line" }, tyreDot(x.c),
          h("b", { class: `tb-c t-${x.c}` }, `${TYRE_NAME[x.c] || "Unknown"}: ${x.to - x.from + 1} laps`),
          h("small", {}, `laps ${x.from}–${x.to}${x.new === false ? ", used set" : ""}`))),
        h("small", { class: "muted" }, "Tap a tyre to see what it means."));
      pop.hidden = false;
      const top = row.offsetTop + row.offsetHeight + 6;
      pop.style.top = `${top + pop.offsetHeight > wrap.offsetHeight ? row.offsetTop - pop.offsetHeight - 6 : top}px`;
    };
    row.addEventListener("click", show);
    return row;
  });
  const ticks = [0, Math.round(total / 3), Math.round((total * 2) / 3), total];
  const axis = h("div", { class: "tb-axis", "aria-hidden": "true" }, h("span"),
    h("span", { class: "tb-ticks" }, ticks.map((t) => h("i", { style: { left: `${(t / total) * 100}%` } }, t))));
  wrap.append(...rows, axis, pop);
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  const key = h("div", { class: "legend tb-key" }, ["S", "M", "H", "I", "W"].filter((c) => order.some((code) => (stints[code] || []).some((x) => x.c === c)))
    .map((c) => h("span", {}, tyreDot(c), TYRE_NAME[c])), h("span", { class: "muted" }, "Lap"));
  return h("div", {}, wrap, key);
}

// ---------- session picker: race dropdown + session switch ----------
export function sessionPicker(ev, shown, done, key) {
  const evs = ctx.season?.events || [];
  const sel = h("select", { class: "picker-select", "aria-label": "Choose a race", onchange: (e) => { location.hash = `#/race/${e.target.value}`; } },
    evs.map((e) => h("option", { value: e.round, selected: e.round === ev.round ? true : null }, `${flag(e.country)}  ${e.round}. ${e.name}`)));
  const seg = h("div", { class: "seg", role: "tablist", "aria-label": "Session" },
    shown.map((k) => h("a", { class: "seg-btn", role: "tab", href: `#/race/${ev.round}/${k}`, "aria-selected": String(k === key) },
      SESSION_SHORT[k] || k, done.includes(k) ? null : h("small", {}, "prediction"))));
  requestAnimationFrame(() => seg.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" }));
  return h("div", { class: "picker" }, h("label", { class: "picker-race" }, icon("calendar", { size: 18 }), sel, icon("down", { size: 18 })), seg);
}
