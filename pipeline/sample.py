"""Generate clearly labelled SAMPLE data in the same format the real pipeline writes.

Used to develop and preview the site without access to F1's data servers.
Every file it writes carries "sample": true and the site shows a banner.
Results here are simulated, NOT real race results.

Run with:  python -m pipeline.sample
"""
from __future__ import annotations

import shutil
import zlib
from datetime import datetime, timedelta, timezone

import numpy as np

from . import config
from .store import write_json

SEED = 2026
SAMPLE_NOW = datetime(2026, 10, 26, 18, 0, tzinfo=timezone.utc)

TEAMS = [
    # name, colour, start pace gap %, in-season trend %/round, mechanical risk per lap
    ("Mercedes", "#27F4D2", 0.00, 0.000, 0.0007),
    ("Ferrari", "#E8002D", 0.15, -0.004, 0.0009),
    ("McLaren", "#FF8000", 0.25, -0.010, 0.0006),
    ("Red Bull Racing", "#3671C6", 0.35, -0.006, 0.0012),
    ("Aston Martin", "#229971", 1.05, -0.030, 0.0018),
    ("Alpine", "#FF87BC", 0.90, 0.004, 0.0008),
    ("Williams", "#64C4FF", 0.70, 0.000, 0.0008),
    ("Racing Bulls", "#6692FF", 0.95, 0.002, 0.0012),
    ("Haas F1 Team", "#9AA5B1", 1.00, 0.000, 0.0009),
    ("Audi", "#C9CDD2", 1.20, -0.012, 0.0016),
    ("Cadillac", "#D4AF37", 1.60, -0.010, 0.0015),
]
DRIVERS = [
    # code, first, last, team, skill offset %, incident risk per lap, country
    ("RUS", "George", "Russell", "Mercedes", -0.05, 0.00025, "GBR"),
    ("ANT", "Kimi", "Antonelli", "Mercedes", 0.08, 0.00060, "ITA"),
    ("LEC", "Charles", "Leclerc", "Ferrari", -0.08, 0.00035, "MON"),
    ("HAM", "Lewis", "Hamilton", "Ferrari", 0.04, 0.00025, "GBR"),
    ("NOR", "Lando", "Norris", "McLaren", -0.06, 0.00030, "GBR"),
    ("PIA", "Oscar", "Piastri", "McLaren", -0.03, 0.00030, "AUS"),
    ("VER", "Max", "Verstappen", "Red Bull Racing", -0.15, 0.00030, "NED"),
    ("HAD", "Isack", "Hadjar", "Red Bull Racing", 0.12, 0.00045, "FRA"),
    ("ALO", "Fernando", "Alonso", "Aston Martin", -0.04, 0.00025, "ESP"),
    ("STR", "Lance", "Stroll", "Aston Martin", 0.18, 0.00050, "CAN"),
    ("GAS", "Pierre", "Gasly", "Alpine", 0.00, 0.00035, "FRA"),
    ("COL", "Franco", "Colapinto", "Alpine", 0.14, 0.00060, "ARG"),
    ("ALB", "Alexander", "Albon", "Williams", 0.00, 0.00035, "THA"),
    ("SAI", "Carlos", "Sainz", "Williams", -0.02, 0.00035, "ESP"),
    ("LAW", "Liam", "Lawson", "Racing Bulls", 0.06, 0.00050, "NZL"),
    ("LIN", "Arvid", "Lindblad", "Racing Bulls", 0.12, 0.00060, "GBR"),
    ("OCO", "Esteban", "Ocon", "Haas F1 Team", 0.04, 0.00040, "FRA"),
    ("BEA", "Oliver", "Bearman", "Haas F1 Team", 0.02, 0.00045, "GBR"),
    ("HUL", "Nico", "Hulkenberg", "Audi", 0.00, 0.00030, "GER"),
    ("BOR", "Gabriel", "Bortoleto", "Audi", 0.05, 0.00045, "BRA"),
    ("PER", "Sergio", "Perez", "Cadillac", 0.03, 0.00040, "MEX"),
    ("BOT", "Valtteri", "Bottas", "Cadillac", 0.02, 0.00030, "FIN"),
]
# round, name, country, location, race date (UTC date), sprint?, base lap s, laps, track km, rain chance
CALENDAR = [
    (1, "Australian Grand Prix", "Australia", "Melbourne", "2026-03-08", False, 80.5, 58, 5.28, 0.15),
    (2, "Chinese Grand Prix", "China", "Shanghai", "2026-03-15", True, 94.0, 56, 5.45, 0.15),
    (3, "Japanese Grand Prix", "Japan", "Suzuka", "2026-03-29", False, 90.5, 53, 5.81, 0.30),
    (4, "Miami Grand Prix", "United States", "Miami", "2026-05-03", True, 89.0, 57, 5.41, 0.15),
    (5, "Canadian Grand Prix", "Canada", "Montréal", "2026-05-24", True, 73.0, 70, 4.36, 0.30),
    (6, "Monaco Grand Prix", "Monaco", "Monaco", "2026-06-07", False, 72.0, 78, 3.34, 0.10),
    (7, "Barcelona-Catalunya Grand Prix", "Spain", "Barcelona", "2026-06-14", False, 75.5, 66, 4.66, 0.05),
    (8, "Austrian Grand Prix", "Austria", "Spielberg", "2026-06-28", False, 65.0, 71, 4.32, 0.25),
    (9, "British Grand Prix", "United Kingdom", "Silverstone", "2026-07-05", True, 87.0, 52, 5.89, 0.40),
    (10, "Belgian Grand Prix", "Belgium", "Spa-Francorchamps", "2026-07-19", False, 103.0, 44, 7.00, 0.35),
    (11, "Hungarian Grand Prix", "Hungary", "Budapest", "2026-07-26", False, 77.0, 70, 4.38, 0.10),
    (12, "Dutch Grand Prix", "Netherlands", "Zandvoort", "2026-08-23", True, 71.0, 72, 4.26, 0.25),
    (13, "Italian Grand Prix", "Italy", "Monza", "2026-09-06", False, 80.0, 53, 5.79, 0.10),
    (14, "Spanish Grand Prix", "Spain", "Madrid", "2026-09-13", False, 88.0, 57, 5.47, 0.05),
    (15, "Azerbaijan Grand Prix", "Azerbaijan", "Baku", "2026-09-26", False, 102.0, 51, 6.00, 0.05),
    (16, "Singapore Grand Prix", "Singapore", "Marina Bay", "2026-10-11", True, 91.0, 62, 4.94, 0.30),
    (17, "United States Grand Prix", "United States", "Austin", "2026-10-25", False, 94.0, 56, 5.51, 0.10),
    (18, "Mexico City Grand Prix", "Mexico", "Mexico City", "2026-11-01", False, 77.0, 71, 4.30, 0.15),
    (19, "São Paulo Grand Prix", "Brazil", "São Paulo", "2026-11-08", False, 70.0, 71, 4.31, 0.40),
    (20, "Las Vegas Grand Prix", "United States", "Las Vegas", "2026-11-21", False, 94.0, 50, 6.20, 0.02),
    (21, "Qatar Grand Prix", "Qatar", "Lusail", "2026-11-29", False, 83.0, 57, 5.42, 0.02),
    (22, "Abu Dhabi Grand Prix", "United Arab Emirates", "Yas Island", "2026-12-06", False, 84.0, 58, 5.28, 0.02),
]

DONE_THROUGH = 17               # sample season: Austin just finished, Mexico is next
TELEMETRY_ROUNDS = (15, 16, 17)  # keep the sample small: telemetry only for recent rounds
DEG = {"S": 0.085, "M": 0.055, "H": 0.035, "I": 0.07, "W": 0.05}
COMP_PACE = {"S": 0.0, "M": 0.45, "H": 0.85, "I": 0.0, "W": 0.0}   # seconds slower than soft


def _seed(*parts) -> int:
    """Deterministic seed (Python's hash() changes between runs)."""
    return zlib.crc32("|".join(map(str, parts)).encode())


def team_of(code):
    return next(d[3] for d in DRIVERS if d[0] == code)


class Season:
    def __init__(self):
        self.rng = np.random.default_rng(SEED)
        self.team = {t[0]: t for t in TEAMS}
        self.driver = {d[0]: d for d in DRIVERS}
        self.wet_skill = {d[0]: self.rng.normal(0, 0.15) for d in DRIVERS}

    # ---------- pace ----------
    def team_pace(self, team, rnd):
        t = self.team[team]
        r = np.random.default_rng(_seed(team, rnd))
        return t[2] + t[3] * (rnd - 1) + r.normal(0, 0.08)

    def track_fit(self, team, rnd):
        """How well a car suits this track (shared by every session of the weekend)."""
        r = np.random.default_rng(_seed(team, "fit", rnd))
        return r.normal(0, 0.18)

    def true_gap(self, code, rnd, wet=False):
        team = team_of(code)
        g = self.team_pace(team, rnd) + self.track_fit(team, rnd) + self.driver[code][4]
        if wet:
            g += self.wet_skill[code]
        return g


# ---------------- track shapes and telemetry ----------------

def make_track(rnd, length_m):
    """A plausible circuit: straights joined by rounded corners of varying sharpness."""
    r = np.random.default_rng(1000 + rnd)
    n = int(r.integers(9, 14))
    ang = np.sort(r.uniform(0, 2 * np.pi, n))
    for _ in range(50):                                   # keep corners from bunching up
        gaps = np.diff(np.r_[ang, ang[0] + 2 * np.pi])
        if gaps.min() > 0.25:
            break
        ang = np.sort(r.uniform(0, 2 * np.pi, n))
    rad = r.uniform(0.55, 1.0, n)                         # star-shaped, so it never crosses itself
    ratio = r.uniform(1.1, 1.7)
    vx, vy = rad * np.cos(ang) * ratio, rad * np.sin(ang)
    pts = []
    for i in range(n):
        p0 = np.array([vx[i - 1], vy[i - 1]]); p1 = np.array([vx[i], vy[i]]); p2 = np.array([vx[(i + 1) % n], vy[(i + 1) % n]])
        e_in, e_out = np.linalg.norm(p1 - p0), np.linalg.norm(p2 - p1)
        cut = min(e_in, e_out) * r.uniform(0.08, 0.4)     # small cut = sharp corner
        a = p1 + (p0 - p1) / e_in * cut
        b = p1 + (p2 - p1) / e_out * cut
        t = np.linspace(0, 1, 40)[:, None]
        pts.append((1 - t) ** 2 * a + 2 * (1 - t) * t * p1 + t ** 2 * b)
    xy = np.vstack(pts)
    seg = np.hypot(*np.diff(np.vstack([xy, xy[:1]]), axis=0).T)
    scale = length_m / seg.sum()
    xy, seg = xy * scale, seg * scale
    s = np.r_[0, np.cumsum(seg)]
    loop = np.vstack([xy, xy[:1]])
    grid = np.arange(0, s[-1], 5.0)
    xx, yy = np.interp(grid, s, loop[:, 0]), np.interp(grid, s, loop[:, 1])
    dx, dy = np.gradient(xx), np.gradient(yy)
    ddx, ddy = np.gradient(dx), np.gradient(dy)
    curv = np.abs(dx * ddy - dy * ddx) / np.power(dx * dx + dy * dy, 1.5)
    curv = np.convolve(np.r_[curv[-4:], curv, curv[:4]], np.ones(9) / 9, mode="same")[4:-4]
    corners = []
    m = len(curv)
    peaks = [j for j in range(1, m - 1) if curv[j] >= curv[j - 1] and curv[j] >= curv[j + 1] and curv[j] > 1 / 400]
    for j in peaks:
        if corners and grid[j] - grid[corners[-1]] < 150:
            if curv[j] > curv[corners[-1]]:
                corners[-1] = j
            continue
        corners.append(j)
    return {"d": grid, "x": xx, "y": yy, "curv": curv, "corners": corners}


def speed_profile(track, grip, rng):
    curv = track["curv"]
    ds = 5.0
    a_lat = 42.0 * grip  # lateral grip, m/s^2
    corner_var = np.ones_like(curv)
    for j in track["corners"]:
        lo, hi = max(0, j - 20), min(len(curv), j + 20)
        corner_var[lo:hi] = 1 + rng.normal(0, 0.02)
    vmax = np.minimum(np.sqrt(a_lat * corner_var / np.maximum(curv, 1e-6)), 95.0)
    v = vmax.copy()
    for _ in range(2):  # lap wraps, so iterate twice
        for i in range(1, len(v)):        # acceleration limit
            acc = 13.0 * (1 - v[i - 1] / 98.0) + 1.5
            v[i] = min(v[i], np.sqrt(v[i - 1] ** 2 + 2 * acc * ds))
        v[0] = min(v[0], np.sqrt(v[-1] ** 2 + 2 * 3 * ds))
        for i in range(len(v) - 2, -1, -1):  # braking limit
            v[i] = min(v[i], np.sqrt(v[i + 1] ** 2 + 2 * 46.0 * ds))
    return v, vmax


def telemetry_for(track, gap_pct, lap_time, rng):
    grip = 1 - gap_pct / 100 * 2.2
    v, vmax = speed_profile(track, grip, rng)
    sim_time = float(np.sum(5.0 / v))
    v = v * sim_time / lap_time                     # match the lap time exactly
    dv = np.gradient(v)
    brake = (dv < -0.05).astype(int)
    thr = np.where(brake == 1, 0, np.where(v >= vmax * 0.97 * sim_time / lap_time, np.clip(55 + 45 * (v / v.max()), 0, 100), 100))
    thr = np.clip(thr, 0, 100)
    kmh = v * 3.6
    gears = np.searchsorted([80, 110, 140, 175, 210, 250, 290], kmh) + 1
    step = config.TELEMETRY_STEP_M // 5
    sl = slice(0, None, step)
    return {
        "d": [int(x) for x in track["d"][sl]],
        "v": [int(round(x)) for x in kmh[sl]],
        "thr": [int(round(x)) for x in thr[sl]],
        "brk": [int(x) for x in brake[sl]],
        "g": [int(x) for x in gears[sl]],
        "x": [int(round(x * 10)) for x in track["x"][sl]],
        "y": [int(round(y * 10)) for y in track["y"][sl]],
    }


def circuit_json(track):
    sl = slice(0, None, 4)
    corners = []
    for n, j in enumerate(track["corners"], 1):
        dx = np.gradient(track["x"])[j]
        dy = np.gradient(track["y"])[j]
        ang = float(np.degrees(np.arctan2(dx, -dy)))
        corners.append({"n": str(n), "x": round(float(track["x"][j] * 10)), "y": round(float(track["y"][j] * 10)),
                        "d": round(float(track["d"][j])), "angle": round(ang)})
    return {"x": [int(round(v * 10)) for v in track["x"][sl]], "y": [int(round(v * 10)) for v in track["y"][sl]],
            "d": [int(v) for v in track["d"][sl]], "rotation": 0.0, "corners": corners, "sample": True}


# ---------------- sessions ----------------

def empty_lapset():
    return {"n": [], "t": [], "c": [], "l": [], "p": [], "pi": [], "po": [], "ok": [], "ts": [], "st": []}


def add_lap(ls, n, t, c, life, pos=None, pi=0, po=0, ts="1", st=None):
    ls["n"].append(n)
    ls["t"].append(None if t is None else round(float(t), 3))
    ls["c"].append(c)
    ls["l"].append(int(life))
    ls["p"].append(pos)
    ls["pi"].append(pi)
    ls["po"].append(po)
    ls["ok"].append(1)
    ls["ts"].append(ts)
    ls["st"].append(None if st is None else round(float(st), 3))


def sectors(t, rng):
    w = np.array([0.31, 0.37, 0.32]) + rng.normal(0, 0.004, 3)
    w = w / w.sum()
    return [round(float(t * x), 3) for x in w]


def weather_for(rng, wet, base_air):
    air = round(float(base_air + rng.normal(0, 1.5)), 1)
    return {"air": air, "track": round(air + (6 if wet else 14) + float(rng.normal(0, 2)), 1),
            "rain": bool(wet), "wind": round(float(abs(rng.normal(2.5, 1))), 1),
            "humidity": round(float(85 if wet else rng.uniform(35, 65)))}


def practice(season, ev, key, rng, wet):
    rnd, base = ev[0], ev[6]
    sandbag = {t[0]: rng.normal(0, 0.28) for t in TEAMS}       # hidden fuel loads / engine modes
    evolution = {"FP1": 0.9, "FP2": 0.45, "FP3": 0.2}[key]
    laps, stints, best_sec = {}, {}, {}
    results = []
    for d in DRIVERS:
        code = d[0]
        gap = season.true_gap(code, rnd, wet) + sandbag[team_of(code)]
        ls = empty_lapset()
        st = []
        n = 0
        best = None
        bs = [None, None, None]
        runs = []
        issue = rng.random() < 0.06          # lost running to a technical problem
        n_runs = 2 if issue else (5 if key != "FP3" else 4)
        for r_i in range(n_runs):
            kind = "quali" if (r_i in (1, 3) and not wet) else "long" if r_i == 2 and key != "FP3" else "short"
            comp = "I" if wet else ("S" if kind == "quali" else rng.choice(["M", "H"]))
            runs.append((kind, comp))
        for kind, comp in runs:
            life = 0
            start_n = n + 1
            count = {"quali": 1, "short": 3, "long": int(rng.integers(8, 13))}[kind]
            n += 1
            life += 1
            add_lap(ls, n, base * 1.25 + rng.normal(0, 2), comp, life, po=1)
            for k in range(count):
                n += 1
                life += 1
                fuel = 0.0 if kind == "quali" else (2.2 if kind == "long" else 1.2)
                t = base * (1 + (gap + evolution + fuel) / 100) + COMP_PACE[comp] + DEG[comp] * life
                t += rng.normal(0, 0.12 if kind == "quali" else 0.3) * (2 if wet else 1)
                if wet:
                    t *= 1.11
                add_lap(ls, n, t, comp, life)
                if best is None or t < best:
                    best = t
                for i, s in enumerate(sectors(t, rng)):
                    bs[i] = s if bs[i] is None else min(bs[i], s)
            n += 1
            life += 1
            add_lap(ls, n, base * 1.3 + rng.normal(0, 2), comp, life, pi=1)
            st.append({"c": comp, "from": start_n, "to": n, "new": True, "age": 0})
        laps[code], stints[code], best_sec[code] = ls, st, bs
        results.append({"code": code, "pos": None, "class": None, "grid": None, "status": None, "time": None,
                        "points": None, "q": None, "best": round(best, 3) if best else None, "laps": n})
    results.sort(key=lambda r: r["best"] or 999)
    for i, r in enumerate(results, 1):
        r["pos"] = i
    return results, laps, stints, best_sec


def qualifying(season, ev, key, rng, wet):
    rnd, base = ev[0], ev[6]
    cuts = [22, 16, 10]
    alive = [d[0] for d in DRIVERS]
    times = {c: [None, None, None] for c in alive}
    laps = {c: empty_lapset() for c in alive}
    nlap = {c: 0 for c in alive}
    stints = {c: [] for c in alive}
    bs = {c: [None, None, None] for c in alive}
    order = []
    for part in range(3):
        for c in alive:
            best = None
            for run in range(2):
                comp = "I" if wet else "S"
                start = nlap[c] + 1
                nlap[c] += 1
                add_lap(laps[c], nlap[c], base * 1.3 + rng.normal(0, 2), comp, 1, po=1)
                nlap[c] += 1
                t = base * (1 + (season.true_gap(c, rnd, wet) - 0.15 * part) / 100) + rng.normal(0, 0.1 if not wet else 0.35)
                if wet:
                    t *= 1.11
                if rng.random() < 0.04:           # lap deleted / mistake
                    t += rng.uniform(0.6, 2.5)
                add_lap(laps[c], nlap[c], t, comp, 2)
                for i, s in enumerate(sectors(t, rng)):
                    bs[c][i] = s if bs[c][i] is None else min(bs[c][i], s)
                nlap[c] += 1
                add_lap(laps[c], nlap[c], base * 1.35 + rng.normal(0, 2), comp, 3, pi=1)
                stints[c].append({"c": comp, "from": start, "to": nlap[c], "new": True, "age": 0})
                best = t if best is None else min(best, t)
            times[c][part] = round(float(best), 3)
        ranked = sorted(alive, key=lambda c: times[c][part])
        keep = cuts[part + 1] if part < 2 else 10
        if part < 2:
            order = ranked[keep:] + order
            alive = ranked[:keep]
        else:
            order = ranked + order
    results = []
    for i, c in enumerate(order, 1):
        best = min(t for t in times[c] if t)
        results.append({"code": c, "pos": i, "class": str(i), "grid": None, "status": None, "time": None,
                        "points": None, "q": times[c], "best": best, "laps": nlap[c]})
    return results, laps, stints, bs


def race(season, ev, key, rng, wet, grid_order, rel_state):
    rnd, base, full_laps, location = ev[0], ev[6], ev[7], ev[3]
    sprint = key == "S"
    total = round(full_laps / 3) if sprint else full_laps
    tr = config.track_traits(location)
    codes = list(grid_order)
    # grid penalties (sample: occasional engine penalty)
    grid = codes[:]
    if not sprint:
        for c in codes:
            if rng.random() < 0.03:
                i = grid.index(c)
                grid.insert(min(len(grid) - 1, i + 5), grid.pop(i))
    gap = {c: season.true_gap(c, rnd, wet) * 0.9 + rng.normal(0, 0.12) for c in codes}
    # strategies
    plans = {}
    for c in codes:
        if wet:
            plans[c] = [("I", total)]
        elif sprint:
            plans[c] = [("M", total)]
        else:
            if rng.random() < 0.25:
                a, b = int(total * rng.uniform(0.28, 0.36)), int(total * rng.uniform(0.62, 0.7))
                plans[c] = [("M", a), ("H", b), ("M", total)]
            else:
                first = rng.choice(["M", "H"], p=[0.7, 0.3])
                stop = int(total * (rng.uniform(0.35, 0.48) if first == "M" else rng.uniform(0.52, 0.62)))
                plans[c] = [(first, stop), ("H" if first == "M" else "M", total)]
    cum = {c: i * 0.25 for i, c in enumerate(grid)}
    life = {c: 0 for c in codes}
    stint_i = {c: 0 for c in codes}
    alive = set(codes)
    out_lap = {}
    laps = {c: empty_lapset() for c in codes}
    stints = {c: [] for c in codes}
    stint_start = {c: 1 for c in codes}
    sc_left = 0
    sc_count = 0
    order = grid[:]
    incidents = {}
    status = {}
    pit_loss = 21.5
    mech = rel_state["mech"]
    for lap in range(1, total + 1):
        ts = "4" if sc_left > 0 else "1"
        lap_times = {}
        for c in order:
            if c not in alive:
                continue
            comp = plans[c][stint_i[c]][0]
            life[c] += 1
            fuel = 0.033 * (total - lap)
            t = base * (1 + (gap[c] + 1.2) / 100) + fuel + COMP_PACE[comp] + DEG[comp] * life[c] + rng.normal(0, 0.22)
            if wet:
                t = t * 1.11 + rng.normal(0, 0.4)
            if lap == 1:
                t += 4.0 + order.index(c) * 0.15
            if sc_left > 0:
                t = base * 1.45 + rng.normal(0, 0.3)
            pit = 0
            if stint_i[c] < len(plans[c]) - 1 and lap == plans[c][stint_i[c]][1]:
                cost = pit_loss * (0.55 if sc_left > 0 else 1.0) + rng.normal(0, 0.6)
                t += cost
                pit = 1
            lap_times[c] = (t, comp, pit)
        # safety-car compression
        if sc_left > 0 and ts == "4" and sc_left == 4:
            leader = min((cum[c] for c in alive), default=0)
            for i, c in enumerate([c for c in order if c in alive]):
                cum[c] = leader + i * 0.9
        # retirements
        for c in [c for c in order if c in alive]:
            team = team_of(c)
            p_mech = mech[team]
            p_inc = season.driver[c][5] * (1.6 if tr["street"] else 1.0) * (2.0 if wet else 1.0) * (3 if lap == 1 else 1)
            u = rng.random()
            if u < p_mech:
                alive.discard(c)
                status[c] = ("mech", lap)
            elif u < p_mech + p_inc:
                alive.discard(c)
                status[c] = ("inc", lap)
                incidents.setdefault(c, []).append(lap)
                if sc_left == 0 and rng.random() < 0.6 and lap < total - 2:
                    sc_left = 5
                    sc_count += 1
        if sc_left == 0 and lap > 3 and lap < total - 4 and rng.random() < tr["sc"] / total * 0.5:
            sc_left = 5
            sc_count += 1
        # apply lap, with overtaking difficulty
        new_cum = {}
        prev = None
        for c in order:
            if c not in alive:
                continue
            t, comp, pit = lap_times[c]
            nc = cum[c] + t
            if prev is not None and sc_left == 0 and lap > 1:
                ahead = new_cum[prev]
                if nc < ahead + 0.35 and not pit and not lap_times[prev][2]:
                    adv = (ahead + 0.35) - nc
                    p_pass = min(0.85, adv * (1.25 - tr["overtake"]) * 0.9)
                    if rng.random() > p_pass:
                        nc = ahead + 0.35 + abs(rng.normal(0, 0.1))
            new_cum[c] = nc
            prev = c
        for c, v in new_cum.items():
            cum[c] = v
        order = sorted([c for c in order if c in alive], key=lambda c: cum[c]) + [c for c in order if c not in alive]
        for pos, c in enumerate(order, 1):
            if c not in lap_times or c not in new_cum:
                continue
            t, comp, pit = lap_times[c]
            add_lap(laps[c], lap, t, comp, life[c], pos=pos, pi=pit, po=0, ts=ts, st=3600 + cum[c])
            if pit:
                stints[c].append({"c": comp, "from": stint_start[c], "to": lap, "new": True, "age": 0})
                stint_i[c] += 1
                life[c] = 0
                stint_start[c] = lap + 1
        if sc_left > 0:
            sc_left -= 1
    for c in codes:
        last = laps[c]["n"][-1] if laps[c]["n"] else 0
        comp = plans[c][stint_i[c]][0]
        if last >= stint_start[c]:
            stints[c].append({"c": comp, "from": stint_start[c], "to": last, "new": True, "age": 0})
        # mark out-laps
        for i in range(1, len(laps[c]["n"])):
            if laps[c]["pi"][i - 1]:
                laps[c]["po"][i] = 1
    finishers = sorted([c for c in codes if c not in status], key=lambda c: cum[c])
    dnfs = sorted([c for c in codes if c in status], key=lambda c: -status[c][1])
    winner_time = cum[finishers[0]]
    pts = config.SPRINT_POINTS if sprint else config.RACE_POINTS
    results = []
    for i, c in enumerate(finishers + dnfs, 1):
        done = c not in status
        laps_done = laps[c]["n"][-1] if laps[c]["n"] else 0
        results.append({
            "code": c, "pos": i, "class": str(i) if done else "R",
            "grid": grid.index(c) + 1,
            "status": "Finished" if done else "Retired",
            "time": round(winner_time if i == 1 else cum[c] - winner_time, 3) if done else None,
            "points": float(pts[i - 1]) if done and i <= len(pts) else 0.0,
            "q": None, "best": None, "laps": laps_done,
        })
    for c in codes:
        ts_ = [t for t, s_, p_ in zip(laps[c]["t"], laps[c]["ts"], laps[c]["pi"]) if t and s_ == "1" and not p_]
        for r in results:
            if r["code"] == c:
                r["best"] = round(min(ts_), 3) if ts_ else None
    rel_state["log"].append({k: v for k, v in status.items()})
    flags = {"sc": sc_count, "vsc": 0, "red": 0}
    best_sec = {}
    for c in codes:
        b = next((r["best"] for r in results if r["code"] == c), None)
        best_sec[c] = sectors(b, rng) if b else [None, None, None]
    return results, laps, stints, best_sec, flags, incidents, total


def session_times(race_date: str, sprint: bool):
    d = datetime.fromisoformat(race_date).replace(tzinfo=timezone.utc)
    fri, sat = d - timedelta(days=2), d - timedelta(days=1)
    at = lambda day, h, m: (day.replace(hour=h, minute=m)).strftime("%Y-%m-%dT%H:%M:%SZ")
    if sprint:
        return [("FP1", at(fri, 10, 30)), ("SQ", at(fri, 14, 30)), ("S", at(sat, 10, 0)),
                ("Q", at(sat, 14, 0)), ("R", at(d, 13, 0))]
    return [("FP1", at(fri, 11, 30)), ("FP2", at(fri, 15, 0)), ("FP3", at(sat, 10, 30)),
            ("Q", at(sat, 14, 0)), ("R", at(d, 13, 0))]


# years each 2026 venue was raced at before (sample history only; roughly matches the real calendar)
HISTORY_YEARS = {"Shanghai": (2018, 2019, 2024, 2025), "Miami": (2022, 2023, 2024, 2025), "Madrid": (),
                 "Las Vegas": (2023, 2024, 2025), "Lusail": (2021, 2023, 2024, 2025), "Zandvoort": (2021, 2022, 2023, 2024, 2025),
                 "Melbourne": (2018, 2019, 2022, 2023, 2024, 2025), "Montréal": (2018, 2019, 2022, 2023, 2024, 2025),
                 "Monaco": (2018, 2019, 2021, 2022, 2023, 2024, 2025), "Suzuka": (2018, 2019, 2022, 2023, 2024, 2025),
                 "Marina Bay": (2018, 2019, 2022, 2023, 2024, 2025), "Austin": (2018, 2019, 2021, 2022, 2023, 2024, 2025),
                 "Mexico City": (2018, 2019, 2021, 2022, 2023, 2024, 2025), "São Paulo": (2018, 2019, 2021, 2022, 2023, 2024, 2025)}


def sample_track_history(rng):
    """Simulated past races per venue (SC/VSC/red flags and strategies), labelled as sample data."""
    from .track_history import norm_location
    out = {y: {"year": y, "races": [], "sample": True} for y in range(2018, 2026)}
    for ev in CALENDAR:
        rnd, name, country, location, date, sprint, base, nlaps, km, rain = ev
        tr = config.track_traits(location)
        years = HISTORY_YEARS.get(location, tuple(range(2018, 2026)))
        for y in years:
            sc = int(rng.poisson(tr["sc"] * 1.3)) if rng.random() < tr["sc"] else 0
            race = {"round": rnd, "location": location, "country": country, "key": norm_location(location), "name": name,
                    "flags": {"sc": sc, "vsc": int(rng.random() < 0.35), "red": int(rng.random() < 0.1 + 0.1 * tr["street"]),
                              "sc_laps": sorted(int(rng.integers(1, nlaps)) for _ in range(sc)), "vsc_laps": [], "red_laps": []}}
            if y >= 2022:
                two_stop = rng.random() < (0.25 if tr["overtake"] > 0.6 else 0.55)
                stints = {}
                for i in range(20):
                    if rng.random() < (0.55 if two_stop else 0.2):
                        a, b = sorted(rng.integers(int(nlaps * 0.25), int(nlaps * 0.75), 2))
                        stints[f"D{i:02d}"] = [["M", 1, int(a)], ["H", int(a) + 1, int(b)], ["M", int(b) + 1, nlaps]]
                    else:
                        a = int(rng.integers(int(nlaps * 0.3), int(nlaps * 0.6)))
                        first = rng.choice(["M", "H", "S"], p=[0.65, 0.2, 0.15])
                        stints[f"D{i:02d}"] = [[str(first), 1, a], ["H" if first != "H" else "M", a + 1, nlaps]]
                race.update({"total_laps": nlaps, "stints": stints, "pit_loss": round(float(rng.normal(21 + 3 * tr["street"], 1.2)), 1)})
            out[y]["races"].append(race)
    d = config.DATA_DIR.parent / "history-sample"
    for y, data in out.items():
        write_json(d / f"track_{y}.json", data)


def generate():
    season = Season()
    rng = season.rng
    if config.DATA_DIR.exists():
        shutil.rmtree(config.DATA_DIR)
    config.DATA_DIR.mkdir(parents=True)
    rel_state = {"mech": {t[0]: t[4] for t in TEAMS}, "log": []}
    sample_track_history(np.random.default_rng(SEED + 1))
    events = []
    for ev in CALENDAR:
        rnd, name, country, location, date, sprint, base, nlaps, km, rain = ev
        sessions = session_times(date, sprint)
        done = rnd <= DONE_THROUGH
        events.append({
            "round": rnd, "name": name, "official": "", "country": country, "location": location,
            "format": "sprint" if sprint else "conventional", "date": date + "T00:00:00Z",
            "lat": None, "lon": None, "circuit_id": None,
            "sessions": [{"key": k, "start": s, "done": done} for k, s in sessions],
        })
        if not done:
            continue
        track = make_track(rnd, km * 1000)
        ev_dir = config.DATA_DIR / "events" / str(rnd)
        wet_weekend = rng.random() < rain
        base_air = rng.uniform(18, 31)
        q_order = {}
        for key, start in sessions:
            wet = wet_weekend and key in ("Q", "R") and rng.random() < 0.7
            flags = {"sc": 0, "vsc": 0, "red": 0}
            incidents = {}
            total = None
            if key.startswith("FP"):
                res, laps, stints, bs = practice(season, ev, key, rng, wet)
            elif key in ("SQ", "Q"):
                res, laps, stints, bs = qualifying(season, ev, key, rng, wet)
                q_order[key] = [r["code"] for r in res]
            else:
                grid_from = q_order["SQ" if key == "S" else "Q"]
                res, laps, stints, bs, flags, incidents, total = race(season, ev, key, rng, wet, grid_from, rel_state)
            fastest = None
            timed = [(r["best"], r["code"]) for r in res if r["best"]]
            if timed:
                t, code = min(timed)
                arr = laps[code]
                lap_no = next((n for n, lt in zip(arr["n"], arr["t"]) if lt is not None and abs(lt - t) < 1e-6), None)
                fastest = {"code": code, "time": t, "lap": lap_no}
            payload = {
                "round": rnd, "key": key, "name": config.SESSION_NAMES[key], "start": start, "sample": True,
                "total_laps": total, "weather": weather_for(rng, wet, base_air), "flags": flags,
                "incidents": incidents, "results": res, "laps": laps, "stints": stints, "best_sectors": bs,
                "fastest": fastest, "telemetry": [], "exported_at": SAMPLE_NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "final": True,
            }
            if rnd in TELEMETRY_ROUNDS and key in ("SQ", "Q", "S", "R"):
                for r in res:
                    if not r["best"]:
                        continue
                    lap_no = next((n for n, lt in zip(laps[r["code"]]["n"], laps[r["code"]]["t"])
                                   if lt is not None and abs(lt - r["best"]) < 1e-6), None)
                    tel = telemetry_for(track, season.true_gap(r["code"], rnd, wet), r["best"],
                                        np.random.default_rng(_seed(rnd, key, r["code"])))
                    tel.update({"lap": lap_no, "time": r["best"]})
                    write_json(ev_dir / "tel" / f"{key}_{r['code']}.json", tel)
                    payload["telemetry"].append(r["code"])
                write_json(ev_dir / "circuit.json", circuit_json(track))
            write_json(ev_dir / f"{key}.json", payload)
            next(x for x in events[-1]["sessions"] if x["key"] == key)["tel"] = bool(payload["telemetry"])

    # sample forecast for the next weekend (Mexico City)
    nxt = next(e for e in events if e["round"] == DONE_THROUGH + 1)
    write_json(config.DATA_DIR / "events" / str(nxt["round"]) / "forecast.json", {
        "source": "sample", "fetched": SAMPLE_NOW.strftime("%Y-%m-%dT%H:%M"),
        "sessions": {s["key"]: {"rain_prob": p, "rain_mm": 0.0 if p < 0.3 else 0.6, "temp": t, "wind": 9.0}
                     for s, p, t in zip(nxt["sessions"], (0.05, 0.05, 0.1, 0.2, 0.35), (21, 23, 20, 22, 22))},
    })

    drivers = []
    for d in DRIVERS:
        t = season.team[d[3]]
        drivers.append({"code": d[0], "num": None, "first": d[1], "last": d[2], "name": f"{d[1]} {d[2]}",
                        "team": d[3], "color": t[1], "country": d[6]})
    write_json(config.DATA_DIR / "season.json", {
        "year": 2026, "sample": True, "updated": SAMPLE_NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "events": events, "drivers": drivers,
    }, compact=False)
    return SAMPLE_NOW


def main():
    now = generate()
    from model.run import run_model
    problems = run_model(now=now)
    for p in problems:
        print("problem:", p)
    print("Sample data written to", config.DATA_DIR)


if __name__ == "__main__":
    main()
