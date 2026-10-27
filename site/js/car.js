// Our own open-wheel race car, side view, drawn as inline SVG (no download, no team livery):
// body in any colour, separate wheel groups so CSS can spin them, a tyre-compound stripe.
let uid = 0;

/**
 * carSvg({ color, tyre, width, cls, label })
 * color: body colour; tyre: sidewall stripe colour (defaults to medium yellow);
 * label: accessible name, or null for decorative.
 */
export function carSvg({ color = "var(--flag)", tyre = "var(--tyre-M)", width = 240, cls = "", label = null } = {}) {
  const id = `car${++uid}`;
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  const wheel = (cx) => `
    <g class="wheel">
      <circle cx="${cx}" cy="41" r="13" fill="#0b0c0f"/>
      <circle cx="${cx}" cy="41" r="10.2" fill="none" stroke="${tyre}" stroke-width="1.6"/>
      <circle cx="${cx}" cy="41" r="6.4" fill="#2b3038"/>
      <path d="M${cx - 6} ${41}h12M${cx} ${35}v12M${cx - 4.2} ${36.8}l8.4 8.4M${cx + 4.2} ${36.8}l-8.4 8.4" stroke="#6b7480" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="41" r="1.8" fill="#c9ced6"/>
    </g>`;
  const svg = `
<svg class="car ${cls}" viewBox="0 0 244 60" width="${width}" height="${(width * 60) / 244}" ${a11y}>
  <defs>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".35"/>
    </linearGradient>
  </defs>
  <ellipse class="car-shadow" cx="122" cy="55.5" rx="112" ry="3" fill="#000" opacity=".4"/>
  <!-- rear wing: endplate, main plane, pillar -->
  <path d="M6 9h26l-1 7H7z" fill="${color}"/>
  <path d="M6 9h26l-1 7H7z" fill="url(#${id}-body)"/>
  <rect x="6" y="9" width="4" height="27" rx="1" fill="var(--carbon, #3b434f)"/>
  <rect x="22" y="15" width="3" height="20" fill="var(--carbon, #3b434f)"/>
  <!-- floor and plank -->
  <path d="M28 44h150l6 3H30z" fill="var(--carbon, #3b434f)"/>
  <!-- body: gearbox, engine cover with fin, airbox, cockpit, sidepod, nose -->
  <path d="M24 37 L40 34 L62 31 L80 18 Q84 13 92 13 L98 14 L103 23 L132 25 L152 30 L192 36 L230 40.5 Q234 42 230 43.5 L192 45 L150 44.5 L62 45.5 L30 44 Z" fill="${color}"/>
  <path d="M24 37 L40 34 L62 31 L80 18 Q84 13 92 13 L98 14 L103 23 L132 25 L152 30 L192 36 L230 40.5 Q234 42 230 43.5 L192 45 L150 44.5 L62 45.5 L30 44 Z" fill="url(#${id}-body)"/>
  <!-- shark fin -->
  <path d="M44 33 L62 20 L66 21 L62 31 Z" fill="${color}" opacity=".85"/>
  <!-- sidepod inlet shadow and number panel -->
  <path d="M120 33 L150 32 L150 40 L118 41 Q114 37 120 33Z" fill="#000" opacity=".28"/>
  <!-- cockpit opening, driver helmet, halo -->
  <path d="M101 23 L131 25 L133 29 L104 28 Z" fill="#0b0c0f"/>
  <circle cx="114" cy="22.5" r="5.2" fill="#f4f5f7"/>
  <path d="M110 21.5h8.5v2.4h-8.5z" fill="#0b0c0f"/>
  <path d="M99 26 Q114 10 134 26" fill="none" stroke="var(--carbon, #3b434f)" stroke-width="2.6" stroke-linecap="round"/>
  <!-- front wing: elements and endplate -->
  <path d="M190 46.5 L240 46.5 L240 51 L188 51 Z" fill="var(--carbon, #3b434f)"/>
  <path d="M196 44 L238 44.5 L238 46.5 L194 46.5 Z" fill="${color}"/>
  <rect x="235" y="38" width="5" height="13" rx="1" fill="var(--carbon, #3b434f)"/>
  ${wheel(44)}
  ${wheel(182)}
</svg>`;
  const tpl = document.createElement("template");
  tpl.innerHTML = svg.trim();
  return tpl.content.firstElementChild;
}

/** The small white car used next to the site name. */
export function brandCar() {
  return carSvg({ color: "#f4f5f7", tyre: "var(--flag)", width: 62, cls: "brand-car" });
}
