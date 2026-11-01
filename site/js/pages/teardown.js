// Inside a 2026 F1 car: the interactive 3D explorer (teardown/explore.html) on a real car model, used as an
// example of this season's cars, with the full data view (teardown/rb22.html), garage photos and plain-language notes.
// Both 3D pages are built with the teardown kit from /teardown in the repo.
import { icon } from "../icons.js";
import { h, section } from "../ui.js";

export const title = () => "Inside a 2026 F1 car";

// photos of the example car in the garage (supplied by the site owner, who holds the rights)
const PHOTOS = [
  ["front-end", "Front end, covers off: wishbones run almost flat, push-rods climb to rockers on top of the chassis, and big silver drums duct air to the brakes", 1600, 900],
  ["rear-corner", "Side on: a rear corner and its brake drum, the engine bay open, the halo and airbox above the cockpit", 678, 452],
  ["engine-bay", "Behind the cockpit: wiring looms, the side-impact tube's red cap and the airbox, packed tight", 547, 560],
];

const SYSTEMS = [
  ["bolt", "Power unit", "Every team uses the same recipe: a 1.6-litre V6 turbo (up to 15,000 rpm, about 400 kW) plus an electric motor-generator, the MGU-K, worth 350 kW. That's almost half the car's power, up from about a fifth in 2025. The MGU-H on the turbo is gone.",
    ["The MGU-K recharges the battery under braking, when the driver lifts off, and at the end of long straights (“super clipping”)", "Up to 8.5 MJ harvested a lap", "Runs on 100% sustainable fuel"]],
  ["compare", "Active aero", "Both wings have flaps that flatten on the straights (straight mode) and snap back for the corners (corner mode). It replaces DRS, and every driver can use it in marked zones, not just the chasing car.",
    ["Front wing: two moving flaps", "Rear wing: three moving elements", "Wings close automatically when the driver brakes or lifts"]],
  ["shield", "Chassis & bodywork", "A carbon survival cell with the fuel tank behind the driver and the titanium halo on top. Sidepods wrap round the radiators; their shape is where teams' cars differ most.",
    ["3,400 mm wheelbase, 1,900 mm wide: shorter and narrower than 2025", "768 kg minimum with the driver", "Crash structures front, rear and either side of the cockpit"]],
  ["wrench", "Suspension & brakes", "Each wheel hangs on two wishbones; a rod carries the load into springs and dampers inside the car (our example uses push-rods at both ends). Carbon brakes glow at about 1,000 °C, and at the rear the MGU-K does much of the slowing.",
    ["18-inch wheels, tyres about 70 cm tall", "Front tyres 25 mm narrower, rears 30 mm narrower than 2025", "Covers on every wheel"]],
];

export default async function teardown() {
  const stage = h("div", { class: "td-stage" },
    h("iframe", { src: "teardown/explore.html", title: "Interactive 3D model of a 2026 F1 car", loading: "lazy", allow: "fullscreen" }),
    h("a", { class: "td-open", href: "teardown/explore.html" }, icon("image", { size: 18 }), "Full screen"));
  return h("div", { class: "td-page" },
    h("header", { class: "td-hero" },
      h("span", { class: "chip" }, icon("wrench", { size: 14 }), "Learn F1"),
      h("h1", {}, "Inside a 2026 F1 car"),
      h("p", { class: "lede" }, "Spin it, zoom in, take the covers off or blow it apart, and tap the dots to see what every part does. Press “Drive a lap” to watch it work through a real qualifying lap: wheels, steering, moving wings and the electric motor."),
      h("p", { class: "muted small" }, "Every 2026 car follows the same rules, so this works as a guide to all of them. Our example car is Red Bull's RB22, because a detailed 3D model of it is available to share.")),
    stage,
    h("p", { class: "muted small td-note" }, "The car is a 4 MB download, so give it a moment on mobile data. Prefer numbers? The ", h("a", { href: "teardown/rb22.html" }, "full data view"), " has live power, battery and speed panels for the same lap (best on a computer or a phone turned sideways)."),
    section(["What's inside", "layers"], "The main systems of every 2026 car, in plain words.",
      h("div", { class: "td-grid" }, SYSTEMS.map(([ic, t, body, facts]) => h("article", { class: "panel td-card" },
        h("h3", {}, icon(ic, { size: 20 }), t), h("p", {}, body),
        h("ul", { class: "td-facts" }, facts.map((f) => h("li", {}, f))))))),
    section(["In the garage", "wrench"], "A real 2026 car with its covers off. The “Covers off” view is built to match.",
      h("div", { class: "td-photos" }, PHOTOS.map(([f, cap, w, ht]) => h("figure", { class: `td-photo${w > ht * 1.4 ? " wide" : ""}` },
        h("img", { src: `teardown/photos/${f}.webp`, alt: cap, width: w, height: ht, loading: "lazy", decoding: "async" }),
        h("figcaption", {}, cap))))),
    section(["The steering wheel", "steer"], "Around 25 buttons and dials. Tap “Steering wheel” in the 3D view to go through them one by one on a real F1 wheel.",
      h("figure", { class: "td-photo" },
        h("img", { src: "teardown/photos/steering-wheel.webp", alt: "A Formula 1 steering wheel: screen, shift lights, buttons and rotary dials", width: 1400, height: 1399, loading: "lazy", decoding: "async", style: { maxWidth: "520px", margin: "0 auto" } }))),
    h("p", { class: "muted small" }, "3D car: ", h("a", { href: "https://skfb.ly/pOvxI", target: "_blank", rel: "noopener" }, "“2026 Redbull RB22” by Dave Love"), " on Sketchfab, licensed CC BY 4.0 (wheels and steering wheel separated so they turn; compressed for the web). The parts inside are drawn to the 2026 rules, simplified. Lap: Max Verstappen's 2026 Mexico City qualifying lap from F1 timing data. Sources: FIA 2026 technical regulations as reported by Formula1.com and Motor Sport; Red Bull Racing's RB22 page; PlanetF1 and The Race launch analysis."));
}
