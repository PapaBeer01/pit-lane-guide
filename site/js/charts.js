// Hand-built SVG charts: thin marks, recessive axes, a hover layer on every chart.
import { h, driver, isSecondDriver } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/**
 * Line chart.
 * series: [{ id, name, color, dash, width, points: [[x, y], ...] }]
 * opts: { height, xLabel, yLabel, yFmt, xFmt, invertY, yMin, yMax, xMin, xMax, tooltip(x, nearest) -> Node|string,
 *         onHover(x|null), labels: true (direct-label line ends), highlight, still (no animation: for saved images) }
 */
export function lineChart(series, opts = {}) {
  const wrap = h("div", { class: "chart-wrap" });
  const tip = h("div", { class: "tooltip", role: "status" });
  wrap.append(tip);
  let hoverX = null;
  let firstDraw = !opts.still && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const api = { el: wrap, setHover: (x) => { hoverX = x; draw(); } };

  function draw() {
    wrap.querySelector("svg")?.remove();
    const W = Math.max(280, wrap.clientWidth || 600);
    const H = opts.height || 260;
    const m = { t: 12, r: opts.labels ? 52 : 14, b: 30, l: 44 };
    const all = series.flatMap((se) => se.points.filter((p) => p[1] !== null && p[1] !== undefined));
    if (!all.length) return;
    const xMin = opts.xMin ?? Math.min(...all.map((p) => p[0]));
    const xMax = opts.xMax ?? Math.max(...all.map((p) => p[0]));
    let yMin = opts.yMin ?? Math.min(...all.map((p) => p[1]));
    let yMax = opts.yMax ?? Math.max(...all.map((p) => p[1]));
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const x = (v) => m.l + ((v - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
    const y = (v) => opts.invertY
      ? m.t + ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b)
      : H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": opts.aria || "Chart" });

    const grid = s("g", { class: "grid" });
    const yt = opts.yTicks || niceTicks(yMin, yMax, 4);
    for (const t of yt) {
      grid.append(s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
      const tx = s("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" });
      tx.textContent = opts.yFmt ? opts.yFmt(t) : t;
      grid.append(tx);
    }
    for (const t of opts.xTicks || niceTicks(xMin, xMax, Math.max(3, Math.floor(W / 110)))) {
      const tx = s("text", { x: x(t), y: H - 10, "text-anchor": "middle" });
      tx.textContent = opts.xFmt ? opts.xFmt(t) : t;
      grid.append(tx);
    }
    if (opts.xLabel) {
      const tx = s("text", { x: W - m.r, y: H - 10, "text-anchor": "end", class: "label" });
      tx.textContent = opts.xLabel;
      grid.append(tx);
    }
    if (opts.zero !== undefined) grid.append(s("line", { x1: m.l, x2: W - m.r, y1: y(opts.zero), y2: y(opts.zero), stroke: "var(--line-strong)" }));
    svg.append(grid);

    const lines = s("g");
    const endLabels = [];
    for (const se of series) {
      let d = "", pen = false;
      for (const [px, py] of se.points) {
        if (py === null || py === undefined) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(px).toFixed(1)},${y(py).toFixed(1)}`;
        pen = true;
      }
      const dim = opts.highlight && opts.highlight !== se.id;
      lines.append(s("path", {
        d, fill: "none", stroke: se.color, "stroke-width": se.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": se.dash ? "6 4" : null, opacity: dim ? 0.18 : 1, "data-anim": se.dash ? null : "1",
      }));
      if (opts.labels && se.points.length) {
        const last = [...se.points].reverse().find((p) => p[1] !== null);
        if (last && !dim) endLabels.push({ x: x(last[0]) + 6, y: y(last[1]) + 4, text: se.name, color: se.color });
      }
    }
    // keep end labels at least 14px apart so they never overlap
    endLabels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < endLabels.length; i++) endLabels[i].y = Math.max(endLabels[i].y, endLabels[i - 1].y + 14);
    for (const l of endLabels) {
      const tx = s("text", { x: l.x, y: l.y, class: "label" });
      tx.textContent = l.text;
      lines.append(tx);
    }
    svg.append(lines);

    // hover layer
    if (hoverX !== null && hoverX >= xMin && hoverX <= xMax) {
      svg.append(s("line", { x1: x(hoverX), x2: x(hoverX), y1: m.t, y2: H - m.b, stroke: "var(--ink-2)", "stroke-width": 1 }));
      for (const se of series) {
        const p = nearest(se.points, hoverX);
        if (p && p[1] !== null && (!opts.highlight || opts.highlight === se.id)) {
          svg.append(s("circle", { cx: x(p[0]), cy: y(p[1]), r: 4.5, fill: se.color, stroke: "var(--surface)", "stroke-width": 2 }));
        }
      }
    }
    const hit = s("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent", style: "touch-action: pan-y" });
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      const xv = xMin + ((px - m.l) / (W - m.l - m.r)) * (xMax - xMin);
      hoverX = Math.max(xMin, Math.min(xMax, xv));
      draw();
      opts.onHover?.(hoverX);
      if (opts.tooltip) {
        const content = opts.tooltip(hoverX);
        tip.replaceChildren(content instanceof Node ? content : h("span", { html: content }));
        tip.style.display = "block";
        const left = (x(hoverX) / W) * wrap.clientWidth;
        tip.style.left = `${Math.min(Math.max(0, left + 12), wrap.clientWidth - tip.offsetWidth)}px`;
        tip.style.top = `${m.t}px`;
      }
    };
    const leave = () => { hoverX = null; tip.style.display = "none"; draw(); opts.onHover?.(null); };
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchstart", move, { passive: true });
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", leave);
    svg.append(hit);
    wrap.prepend(svg);
    if (firstDraw && wrap.isConnected) {
      firstDraw = false;
      svg.querySelectorAll("path[data-anim]").forEach((p) => {
        const len = Math.ceil(p.getTotalLength());
        p.style.setProperty("--len", len);
        p.classList.add("draw");
      });
    }
  }
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(wrap);
  return api;
}

function nearest(points, xv) {
  let best = null, bd = Infinity;
  for (const p of points) {
    const d = Math.abs(p[0] - xv);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function driverSeries(code, points, extra = {}) {
  const d = driver(code);
  return { id: code, name: code, color: d.color, dash: isSecondDriver(code), points, ...extra };
}

export function legend(codes) {
  return h("div", { class: "legend" }, codes.map((c) => {
    const d = driver(c);
    return h("span", {}, h("i", { class: isSecondDriver(c) ? "dash" : "", style: { background: d.color, "--c": d.color } }), c);
  }));
}

/** Horizontal bars: gap to fastest. rows: [{code, value, label}] */
export function gapBars(rows, { unit = "s", max } = {}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0.001);
  const list = h("div", { style: { display: "grid", gap: "6px" }, role: "list" });
  for (const r of rows) {
    const d = driver(r.code);
    list.append(h("div", { role: "listitem", style: { display: "grid", gridTemplateColumns: "56px 1fr 70px", alignItems: "center", gap: "10px" } },
      h("span", { class: "driver" }, h("i", { class: "team-dot", style: { background: d.color } }), r.code),
      h("span", { style: { height: "12px", background: "var(--surface-2)", borderRadius: "4px", position: "relative" } },
        h("i", { style: { position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: d.color, borderRadius: "0 4px 4px 0", display: "block" } })),
      h("span", { class: "small", style: { textAlign: "right" } }, r.label ?? (r.value === 0 ? "Fastest" : `+${r.value.toFixed(3)}${unit}`))));
  }
  return list;
}

/** Tyre strategy: one bar per driver, segments coloured by compound. */
export function stintChart(order, stints, totalLaps) {
  const rows = h("div", { style: { display: "grid", gap: "5px" } });
  const name = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" };
  for (const code of order) {
    const st = stints[code] || [];
    const bar = h("div", { style: { position: "relative", height: "16px" } });
    for (const x of st) {
      const left = ((x.from - 1) / totalLaps) * 100, width = ((x.to - x.from + 1) / totalLaps) * 100;
      bar.append(h("span", {
        title: `${code}: ${name[x.c] || "Unknown"} tyres, laps ${x.from}–${x.to}`,
        style: { position: "absolute", left: `${left}%`, width: `calc(${width}% - 2px)`, top: 0, bottom: 0, borderRadius: "4px",
          background: `var(--tyre-${x.c})`, border: x.c === "H" ? "1px solid var(--line-strong)" : "0" },
      }));
    }
    rows.append(h("div", { style: { display: "grid", gridTemplateColumns: "48px 1fr", gap: "10px", alignItems: "center" } },
      h("span", { class: "small", style: { fontWeight: 700 } }, code), bar));
  }
  const key = h("div", { class: "legend", style: { marginTop: "10px" } },
    ["S", "M", "H", "I", "W"].map((c) => h("span", {}, h("i", { style: { background: `var(--tyre-${c})`, height: "10px", width: "18px", borderRadius: "3px", border: c === "H" ? "1px solid var(--line-strong)" : "0" } }), name[c])));
  return h("div", {}, rows, key);
}

/**
 * Track map. circuit: {x, y, d, corners}; colourAt(dist) -> colour; marker distance optional.
 */
export function trackMap(circuit, { colourAt, marker = null, size = 320, aria = "Track map" } = {}) {
  const xs = circuit.x, ys = circuit.y;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, hgt = maxY - minY;
  const pad = 30;
  const scale = (size - pad * 2) / Math.max(w, hgt);
  const W = w * scale + pad * 2, H = hgt * scale + pad * 2;
  const px = (v) => (v - minX) * scale + pad, py = (v) => H - ((v - minY) * scale + pad);
  const svg = s("svg", { viewBox: `0 0 ${W.toFixed(0)} ${H.toFixed(0)}`, class: "chart", role: "img", "aria-label": aria, style: `max-width:${size}px;margin:auto` });
  let outline = "";
  xs.forEach((x, i) => { outline += `${i ? "L" : "M"}${px(x).toFixed(1)},${py(ys[i]).toFixed(1)}`; });
  svg.append(s("path", { d: outline + "Z", fill: "none", stroke: "var(--line-strong)", "stroke-width": 9, "stroke-linejoin": "round" }));
  if (colourAt) {
    for (let i = 1; i < xs.length; i++) {
      svg.append(s("line", { x1: px(xs[i - 1]), y1: py(ys[i - 1]), x2: px(xs[i]), y2: py(ys[i]), stroke: colourAt(circuit.d[i]), "stroke-width": 5, "stroke-linecap": "round" }));
    }
  }
  for (const c of circuit.corners || []) {
    const a = ((c.angle || 0) * Math.PI) / 180;
    const cx = px(c.x) + Math.cos(a) * 14, cy = py(c.y) - Math.sin(a) * 14;
    const t = s("text", { x: cx, y: cy + 4, "text-anchor": "middle", style: "font-size:10px;font-weight:700", fill: "var(--muted)" });
    t.textContent = c.n;
    svg.append(t);
  }
  // start / finish
  svg.append(s("circle", { cx: px(xs[0]), cy: py(ys[0]), r: 5, fill: "var(--surface)", stroke: "var(--ink)", "stroke-width": 2 }));
  const dot = s("circle", { r: 7, fill: "var(--flag)", stroke: "var(--ink)", "stroke-width": 2, style: "display:none" });
  svg.append(dot);
  const api = {
    el: svg,
    setMarker(dist) {
      if (dist === null || dist === undefined) { dot.style.display = "none"; return; }
      let i = circuit.d.findIndex((v) => v >= dist);
      if (i < 0) i = circuit.d.length - 1;
      dot.setAttribute("cx", px(xs[i])); dot.setAttribute("cy", py(ys[i]));
      dot.style.display = "";
    },
  };
  if (marker !== null) api.setMarker(marker);
  return api;
}
