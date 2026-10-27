// Turn charts into a picture (PNG) on the phone itself: no server, nothing extra downloaded.
// Charts are redrawn off-screen at a fixed size so every picture looks the same on any phone,
// then painted onto a canvas with a title, a key and the site's name.
import { h } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const CARD_W = 600;         // layout width in CSS pixels (phone-like, so text stays readable)
const SCALE = 3;            // output is 1800 px wide: sharp on any screen, fine for WhatsApp/X
const PAD = 28;
const SITE = "papabeer01.github.io/pit-lane-guide";
const FONTS = [
  ["Atkinson Hyperlegible", 400, "atkinson-hyperlegible-latin-400-normal.woff2"],
  ["Atkinson Hyperlegible", 700, "atkinson-hyperlegible-latin-700-normal.woff2"],
  ["Big Shoulders Display", 800, "big-shoulders-display-latin-800-normal.woff2"],
];
const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
  "stroke-linejoin", "stroke-opacity", "opacity", "font-family", "font-size", "font-weight", "display", "visibility"];

const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- fonts embedded in the SVG (an SVG drawn as an image can't see the page's fonts) ----------
let fontCss = null;
function embeddedFonts() {
  fontCss ??= Promise.all(FONTS.map(async ([family, weight, file]) => {
    try {
      const blob = await (await fetch(new URL(`../fonts/${file}`, import.meta.url))).blob();
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob); });
      return `@font-face{font-family:"${family}";font-weight:${weight};src:url(${data}) format("woff2")}`;
    } catch { return ""; }        // offline without the font cached: falls back to a system font
  })).then((rules) => rules.join(""));
  return fontCss;
}

/** Copy the browser's final styles onto a clone so it renders the same outside the page. */
function inlineStyles(live, clone, textScale) {
  const pairs = [[live, clone], ...[...live.querySelectorAll("*")].map((el, i) => [el, clone.querySelectorAll("*")[i]])];
  for (const [src, dst] of pairs) {
    const cs = getComputedStyle(src);
    let style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    if (src.classList?.contains("draw")) style += `;stroke-dasharray:${src.getAttribute("stroke-dasharray") || "none"};stroke-dashoffset:0`;
    if (src.tagName === "text") style += `;font-size:${parseFloat(cs.fontSize) * textScale}px`;
    dst.setAttribute("style", style);
    dst.removeAttribute("class");
  }
}

async function svgToImage(svg, width, height, textScale = 1) {
  const clone = svg.cloneNode(true);
  inlineStyles(svg, clone, textScale);
  clone.setAttribute("xmlns", NS);
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);
  const style = document.createElementNS(NS, "style");
  style.textContent = await embeddedFonts();
  clone.prepend(style);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await img.decode();
  return img;
}

/** Render something off-screen at a fixed width and hand back its <svg>. */
export async function offscreen(width, build) {
  const box = h("div", { "aria-hidden": "true", style: { position: "fixed", left: "-10000px", top: "0", width: `${width}px` } });
  document.body.append(box);
  try {
    box.append(build());
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const svg = box.querySelector("svg");
    const vb = svg.viewBox.baseVal;
    const w = Math.min(width, vb.width || width);
    const img = await svgToImage(svg, w, w * (vb.height / vb.width), 1.12);
    return { img, w, h: w * (vb.height / vb.width) };
  } finally { box.remove(); }
}

// ---------- canvas helpers ----------
function wrapText(ctx, text, maxW) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
function font(weight, size, family) { return `${weight} ${size}px "${family}", system-ui, sans-serif`; }

/**
 * Build the picture.
 * title: [{ text, color? }]  (one line, display font)
 * subtitle, headline: strings
 * legend: [{ color, dash, text }]
 * blocks: [{ label, note?, render: (width) => Promise<{img, w, h}>, center? }]
 */
export async function makeImage({ title, subtitle, headline, legend = [], blocks }) {
  await Promise.all([
    document.fonts.load(font(800, 44, "Big Shoulders Display")),
    document.fonts.load(font(700, 16, "Atkinson Hyperlegible")),
    document.fonts.load(font(400, 15, "Atkinson Hyperlegible")),
  ]);
  const inner = CARD_W - PAD * 2;
  const rendered = await Promise.all(blocks.map((b) => b.render(inner)));

  // measure first (canvas height depends on wrapped text), then draw
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font(700, 17, "Atkinson Hyperlegible");
  const headLines = headline ? wrapText(measure, headline, inner) : [];
  measure.font = font(400, 15, "Atkinson Hyperlegible");
  const subLines = subtitle ? wrapText(measure, subtitle, inner) : [];
  const noteLines = blocks.map((b) => (b.note ? wrapText(measure, b.note, inner) : []));

  let H = PAD + 46 + subLines.length * 21 + (headLines.length ? 10 + headLines.length * 24 : 0) + (legend.length ? 30 : 0) + 8;
  rendered.forEach((r, i) => { H += 18 + 26 + noteLines[i].length * 20 + 8 + r.h; });
  H += 24 + 52 + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * SCALE;
  canvas.height = Math.ceil(H * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = tok("--ground");
  ctx.fillRect(0, 0, CARD_W, H);
  ctx.fillStyle = tok("--flag");
  ctx.fillRect(0, 0, CARD_W, 5);                    // the yellow strip the site uses for highlights

  let y = PAD;
  ctx.textBaseline = "alphabetic";
  // title, each part in its own colour (driver codes in team colours)
  ctx.font = font(800, 44, "Big Shoulders Display");
  let x = PAD;
  y += 40;
  for (const part of title) {
    ctx.fillStyle = part.color || tok("--ink");
    ctx.fillText(part.text, x, y);
    x += ctx.measureText(part.text).width;
  }
  y += 6;
  ctx.font = font(400, 15, "Atkinson Hyperlegible");
  ctx.fillStyle = tok("--muted");
  for (const l of subLines) { y += 21; ctx.fillText(l, PAD, y); }
  if (headLines.length) {
    y += 10;
    ctx.font = font(700, 17, "Atkinson Hyperlegible");
    ctx.fillStyle = tok("--ink");
    for (const l of headLines) { y += 24; ctx.fillText(l, PAD, y); }
  }
  if (legend.length) {
    y += 30;
    ctx.font = font(700, 14, "Atkinson Hyperlegible");
    x = PAD;
    for (const item of legend) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 3;
      ctx.setLineDash(item.dash ? [6, 4] : []);
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 22, y - 5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tok("--ink-2");
      ctx.fillText(item.text, x + 30, y);
      x += 30 + ctx.measureText(item.text).width + 22;
    }
  }
  y += 8;

  rendered.forEach((r, i) => {
    const b = blocks[i];
    y += 18 + 26;
    ctx.font = font(800, 24, "Big Shoulders Display");
    ctx.fillStyle = tok("--ink");
    ctx.fillText(b.label, PAD, y);
    ctx.font = font(400, 14, "Atkinson Hyperlegible");
    ctx.fillStyle = tok("--muted");
    for (const l of noteLines[i]) { y += 20; ctx.fillText(l, PAD, y); }
    y += 8;
    ctx.drawImage(r.img, b.center ? PAD + (inner - r.w) / 2 : PAD, y, r.w, r.h);
    y += r.h;
  });

  // footer: site name and an honest data credit
  y += 24;
  ctx.fillStyle = tok("--line-strong");
  ctx.fillRect(PAD, y, inner, 1);
  y += 30;
  ctx.font = font(800, 22, "Big Shoulders Display");
  ctx.fillStyle = tok("--ink");
  ctx.fillText("Pit Lane Guide", PAD, y);
  ctx.font = font(400, 13, "Atkinson Hyperlegible");
  ctx.fillStyle = tok("--muted");
  ctx.textAlign = "right";
  ctx.fillText(SITE, CARD_W - PAD, y);
  ctx.fillText("Unofficial fan site. Timing data: Formula 1, via FastF1.", CARD_W - PAD, y + 18);
  ctx.textAlign = "left";

  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("Image could not be made"))), "image/png"));
}

export const canShareFiles = () => {
  try { return !!navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] }); } catch { return false; }
};

/** Save to the phone (download), or open the share sheet (WhatsApp, X, Photos...). */
export async function deliver(blob, filename, mode = "download") {
  if (mode === "share" && canShareFiles()) {
    try {
      await navigator.share({ files: [new File([blob], filename, { type: "image/png" })], title: filename.replace(/\.png$/, "") });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";   // closed the share sheet: nothing to do
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, style: { display: "none" } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "saved";
}

/** A button that makes the picture when tapped and shows what happened. */
export function imageButton({ label, iconEl, make, filename, mode = "download", compact = false }) {
  const text = h("span", {}, label);
  const btn = h("button", {
    type: "button", class: compact ? "icon-btn save-ic" : "tab", "aria-label": compact ? label : null, title: label,
    onclick: async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      text.textContent = compact ? "" : "Making image…";
      btn.setAttribute("aria-busy", "true");
      try {
        const result = await deliver(await make(), filename(), mode);
        text.textContent = compact ? "" : result === "shared" ? "Shared" : result === "saved" ? "Saved" : label;
      } catch {
        text.textContent = compact ? "" : "Couldn't make the image. Try again";
      } finally {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        setTimeout(() => { text.textContent = compact ? "" : label; }, 2500);
      }
    },
  }, iconEl, compact ? null : text);
  return btn;
}
