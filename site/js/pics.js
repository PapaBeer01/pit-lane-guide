// Which owner-supplied pictures exist (site/img/manifest.json). Kept in its own tiny module so the
// drawing helpers (avatars.js) and media.js can both ask without importing each other.
export const pics = { drivers: {}, teams: {}, icons: {}, cars: {}, helmets: {} };

export async function loadPics() {
  if (window.__DATA__) return;
  try {
    const r = await fetch("img/manifest.json", { cache: "no-cache" });
    if (r.ok) Object.assign(pics, await r.json());
  } catch { /* nothing uploaded: the site's own drawings everywhere */ }
}

export function picImg(src, alt, cls = "", size = null) {
  const el = document.createElement("img");
  el.src = src;
  el.alt = alt;
  el.className = `pic ${cls}`.trim();
  el.loading = "lazy";
  el.decoding = "async";
  if (size) { el.width = size; el.style.setProperty("--sz", `${size}px`); }
  el.addEventListener("load", () => el.classList.add("in"), { once: true });
  return el;
}
