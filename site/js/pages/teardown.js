// The RB22 teardown: the interactive 3D car (teardown/rb22.html, built with the teardown kit from
// /teardown in the repo) framed with plain-language notes on each system and the steering wheel.
import { icon } from "../icons.js";
import { face, teamArt } from "../media.js";
import { pics, picImg } from "../pics.js";
import { driver, h, section } from "../ui.js";

export const title = () => "RB22 teardown";

const SYSTEMS = [
  ["bolt", "Power unit", "Red Bull Ford DM01: a 1.6-litre V6 turbo (two banks of three cylinders at 90°, 15,000 rpm limit) plus an electric motor-generator, the MGU-K, worth 350 kW. That's almost half the car's power, up from about a fifth in 2025. The MGU-H on the turbo is gone.",
    ["MGU-K harvests under braking, on lift-off and at the end of long straights (“super clipping”)", "Up to 8.5 MJ harvested a lap, stored in a battery under the fuel cell", "Runs on 100% sustainable fuel"]],
  ["compare", "Active aero", "Both wings have flaps that flatten on the straights (straight mode) and snap back for the corners (corner mode). It replaces DRS, and every driver can use it in marked zones, not just the chasing car.",
    ["Front wing: two moving flaps", "Rear wing: three moving elements", "Wings close automatically when the driver brakes or lifts"]],
  ["shield", "Chassis & bodywork", "A carbon survival cell with the fuel cell behind the driver and the titanium halo on top. The RB22's sidepods are wrapped tightly round the radiators, with the side-impact tube showing through the bodywork.",
    ["3,400 mm wheelbase, 1,900 mm wide: shorter and narrower than 2025", "768 kg minimum with the driver (RB22 listed at 770 kg)", "Big airbox above the driver's head"]],
  ["wrench", "Suspension & brakes", "Each wheel hangs on two wishbones. A push-rod carries the load up into springs and dampers inside the car; the RB22 uses push-rods at both ends. Carbon brakes glow at about 1,000 °C, and at the rear the MGU-K does much of the slowing.",
    ["18-inch wheels, tyres about 706 mm tall", "Front tyres 25 mm narrower, rears 30 mm narrower than 2025", "Wheel covers on every rim"]],
];
const WHEEL = [
  ["Straight mode", "Opens both wings in a marked zone; they close on braking or lifting."],
  ["Boost", "Asks for full electric power now, if the battery has the charge."],
  ["Overtake", "Within a second of the car ahead at the detection point: an extra 0.5 MJ on the next lap."],
  ["Recharge", "Picks how hard the car harvests: braking, lift-off, part throttle, clipping."],
  ["Rotary dials", "Brake balance and differential, changed corner by corner."],
  ["Paddles", "Right paddle up a gear, left paddle down; clutch paddles for the start."],
];

// photos of the real car in the garage (supplied by the site owner, who holds the rights)
const PHOTOS = [
  ["front-end", "Front end, covers off: wishbones run almost flat, push-rods climb to rockers on top of the chassis, and big silver drums duct air to the brakes", 1600, 900],
  ["rear-corner", "Side on: the rear corner and its brake drum, the engine bay open, the halo and airbox above the cockpit", 678, 452],
  ["engine-bay", "Behind the cockpit: wiring looms, the side-impact tube's red cap and the airbox, packed tight", 547, 560],
];

export default async function teardown() {
  const rb = "Red Bull Racing";
  const logo = pics.teams?.[rb] ? picImg(pics.teams[rb], `${rb} logo`, "td-logo") : teamArt(rb, { size: 40 });
  const frame = h("div", { class: "td-stage" },
    h("iframe", { src: "teardown/rb22.html", title: "RB22 interactive teardown", loading: "lazy", allow: "fullscreen" }),
    h("a", { class: "td-open", href: "teardown/rb22.html" }, icon("image", { size: 18 }), "Open full screen"));
  const drivers = ["VER", "HAD"].map((c) => h("a", { class: "td-driver", href: `#/driver/${c}` },
    face(c, { size: 52 }), h("span", {}, h("b", {}, driver(c).name || c), h("small", {}, "Races the RB22"))));
  return h("div", { class: "td-page" },
    h("header", { class: "td-hero" },
      h("div", { class: "td-hero-text" },
        h("span", { class: "chip" }, icon("wrench", { size: 14 }), "Car teardown"),
        h("h1", {}, "Inside the RB22"),
        h("p", { class: "lede" }, "Red Bull's 2026 car, taken apart. The model runs Max Verstappen's real qualifying lap from Mexico City: watch the wings open on the straights, the electric motor switch from pushing to harvesting as he brakes, and the steering wheel turn through every corner."),
        h("div", { class: "td-drivers" }, drivers)),
      h("div", { class: "td-badge" }, logo)),
    frame,
    h("p", { class: "muted small td-note" }, "On a phone, turn it sideways or open it full screen (the car is a 4 MB download). Tap any button to take over from the tour; leave it alone and the tour comes back. The parts inside (engine, battery, MGU-K, radiators, suspension) are drawn to the 2026 rules and published RB22 details, simplified. Engine rpm and engine power are estimates."),
    section(["In the garage", "wrench"], "The real RB22 with its covers off. The teardown's garage view is built to match these.",
      h("div", { class: "td-photos" }, PHOTOS.map(([f, cap, w, ht]) => h("figure", { class: `td-photo${w > ht * 1.4 ? " wide" : ""}` },
        h("img", { src: `teardown/photos/${f}.webp`, alt: cap, width: w, height: ht, loading: "lazy", decoding: "async" }),
        h("figcaption", {}, cap))))),
    section(["What's inside", "layers"], "The four systems you can isolate in the teardown, in plain words.",
      h("div", { class: "td-grid" }, SYSTEMS.map(([ic, t, body, facts]) => h("article", { class: "panel td-card" },
        h("h3", {}, icon(ic, { size: 20 }), t), h("p", {}, body),
        h("ul", { class: "td-facts" }, facts.map((f) => h("li", {}, f))))))),
    section(["The steering wheel", "steer"], "Everything the driver changes on the move. Red Bull doesn't publish its exact layout, so the teardown's wheel is illustrative.",
      h("div", { class: "panel td-wheel" }, WHEEL.map(([t, d]) => h("div", { class: "td-key" }, h("b", {}, t), h("span", {}, d))))),
    h("p", { class: "muted small" }, "Car model: ", h("a", { href: "https://skfb.ly/pOvxI", target: "_blank", rel: "noopener" }, "\u201c2026 Redbull RB22\u201d by Dave Love"), " on Sketchfab, licensed CC BY 4.0 (wheels and steering wheel separated so they turn; compressed for the web)."),
    h("p", { class: "muted small" }, "Sources: FIA 2026 technical regulations as reported by Formula1.com and Motor Sport; Red Bull Racing's RB22 page (DM01: 6 cylinders, 1.6 L, 15,000 rpm, 24 valves, 90° V); launch analysis by PlanetF1 and The Race. Lap data: F1 timing via FastF1."));
}
