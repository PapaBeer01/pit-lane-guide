"""Small files for the site's picture-led parts, built from data we already have (no downloads).

- events/<r>/circuit.json for rounds that missed one (built from saved fastest-lap telemetry)
- tracks.json: every round's track outline, turned the usual way up and shrunk to a few KB,
  for the race posters and the season calendar
- events/<r>/<session>_hero.json: the big numbers on a session page (fastest lap with its tyre,
  top speed, full-throttle share) and which of the top three was quickest in each part of the lap
"""
from __future__ import annotations

import logging
import math

from . import config
from .store import read_json, write_json

log = logging.getLogger(__name__)

MINIS = 24                # track map split into this many parts for "who was quickest where"
OUTLINE_POINTS = 110      # points per track outline in tracks.json
FULL_THROTTLE = 98        # % pedal counted as flat out
TEL_ORDER = ("Q", "SQ", "R", "S", "FP3", "FP2", "FP1")


def _events_dir():
    return config.DATA_DIR / "events"


def _tel(rnd: int, key: str, code: str) -> dict | None:
    t = read_json(_events_dir() / str(rnd) / "tel" / f"{key}_{code}.json")
    return t if t and t.get("d") and t.get("v") and t.get("x") else None


def circuit_from_telemetry(rnd: int) -> dict | None:
    """A track outline from the quickest saved lap of the weekend (no corner numbers or rotation)."""
    base = _events_dir() / str(rnd)
    for key in TEL_ORDER:
        sess = read_json(base / f"{key}.json")
        if not sess or not sess.get("telemetry"):
            continue
        timed = [r for r in sess.get("results", []) if r.get("code") in sess["telemetry"]]
        timed.sort(key=lambda r: (r.get("pos") or 99))
        for r in timed:
            t = _tel(rnd, key, r["code"])
            if t:
                step = 2 if len(t["d"]) > 1 and t["d"][1] - t["d"][0] < 20 else 1
                return {"x": t["x"][::step], "y": t["y"][::step], "d": t["d"][::step],
                        "rotation": 0.0, "corners": [], "source": f"{key} {r['code']}"}
    return None


def fill_circuits(events: list[dict]) -> int:
    """Write circuit.json for finished rounds that don't have one. Returns how many were added."""
    added = 0
    for ev in events:
        path = _events_dir() / str(ev["round"]) / "circuit.json"
        if path.exists():
            continue
        circ = circuit_from_telemetry(int(ev["round"]))
        if circ and write_json(path, circ):
            added += 1
    return added


def fetch_future_circuits(events: list[dict], year: int, *, max_tracks: int = 3) -> int:
    """Track outlines for coming rounds from last season's qualifying at the same venue (needs F1 data access)."""
    missing = [ev for ev in events if not (_events_dir() / str(ev["round"]) / "circuit.json").exists()]
    if not missing:
        return 0
    import fastf1
    from .export import export_circuit
    from .track_history import norm_location
    done = 0
    for back in (1, 2):
        try:
            sched = fastf1.get_event_schedule(year - back, include_testing=False)
        except Exception as e:
            log.warning("Schedule %s for track maps: %s", year - back, e)
            continue
        by_loc = {norm_location(str(r["Location"])): int(r["RoundNumber"]) for _, r in sched.iterrows()}
        for ev in list(missing):
            if done >= max_tracks:
                return done
            old = by_loc.get(norm_location(ev["location"]))
            if not old:
                continue
            try:
                s = fastf1.get_session(year - back, old, "Q")
                s.load(laps=True, telemetry=True, weather=False, messages=False)
                info = s.get_circuit_info()
                circ = export_circuit(s.laps.pick_fastest().get_telemetry(), info.corners if info else None,
                                      info.rotation if info else None)
                if circ:
                    circ["source"] = f"{year - back} qualifying"
                    write_json(_events_dir() / str(ev["round"]) / "circuit.json", circ)
                    missing.remove(ev)
                    done += 1
            except Exception as e:
                log.warning("Track map for round %s from %s: %s", ev["round"], year - back, e)
    return done


def outline(circ: dict, n: int = OUTLINE_POINTS) -> dict | None:
    """Rotate the usual way up (FastF1's circuit rotation), fit into a 0-100 box, keep n points."""
    xs, ys = circ.get("x") or [], circ.get("y") or []
    if len(xs) < 10:
        return None
    a = (circ.get("rotation") or 0) / 180 * math.pi
    pts = [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)) for x, y in zip(xs, ys)]
    step = max(1, len(pts) // n)
    pts = pts[::step]
    minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
    miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
    span = max(maxx - minx, maxy - miny) or 1
    w, h = (maxx - minx) / span * 100, (maxy - miny) / span * 100
    # y flipped: screen y grows downwards
    flat = []
    for x, y in pts:
        flat += [round((x - minx) / span * 100, 1), round((maxy - y) / span * 100, 1)]
    return {"w": round(w, 1), "h": round(h, 1), "p": flat, "turns": len(circ.get("corners") or []) or None,
            "length": int(circ["d"][-1]) if circ.get("d") else None}


def write_tracks(events: list[dict]) -> bool:
    out = {}
    for ev in events:
        circ = read_json(_events_dir() / str(ev["round"]) / "circuit.json")
        o = outline(circ) if circ else None
        if o:
            out[str(ev["round"])] = o
    return write_json(config.DATA_DIR / "tracks.json", {"tracks": out})


def _cum_time(t: dict) -> tuple[list[float], list[float]]:
    """Cumulative time (s) along the lap from speed samples, and each sample's share of the lap."""
    d, v = t["d"], t["v"]
    total = d[-1] or 1
    cum, acc = [0.0], 0.0
    for i in range(1, len(d)):
        sp = max(5.0, (v[i] + v[i - 1]) / 2) / 3.6
        acc += (d[i] - d[i - 1]) / sp
        cum.append(acc)
    return [x / total for x in d], cum


def _at(frac: list[float], cum: list[float], f: float) -> float:
    lo, hi = 0, len(frac) - 1
    if f <= frac[0]:
        return cum[0]
    if f >= frac[-1]:
        return cum[-1]
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if frac[mid] <= f:
            lo = mid
        else:
            hi = mid
    k = (f - frac[lo]) / ((frac[hi] - frac[lo]) or 1)
    return cum[lo] + k * (cum[hi] - cum[lo])


def minis(tels: dict[str, dict], n: int = MINIS) -> list[int]:
    """Index (into tels' order) of the driver quickest through each of n equal parts of the lap."""
    codes = list(tels)
    prof = {c: _cum_time(tels[c]) for c in codes}
    out = []
    for i in range(n):
        a, b = i / n, (i + 1) / n
        times = [_at(*prof[c], b) - _at(*prof[c], a) for c in codes]
        out.append(times.index(min(times)))
    return out


def tyre_on_lap(stints: list[dict], lap: int | None) -> dict | None:
    for st in stints or []:
        if lap and st.get("from") and st.get("to") and st["from"] <= lap <= st["to"]:
            age = (st.get("age") or 1) + lap - st["from"]
            return {"c": st.get("c"), "age": age, "new": bool(st.get("new"))}
    return None


def hero(rnd: int, key: str) -> dict | None:
    sess = read_json(_events_dir() / str(rnd) / f"{key}.json")
    if not sess or not sess.get("results"):
        return None
    out: dict = {"round": rnd, "key": key}
    fl = sess.get("fastest")
    if fl and fl.get("code"):
        out["fastest"] = {**fl, "tyre": tyre_on_lap((sess.get("stints") or {}).get(fl["code"]), fl.get("lap"))}
    tels = {c: t for c in (sess.get("telemetry") or []) if (t := _tel(rnd, key, c))}
    if tels:
        speeds = {c: max(t["v"]) for c, t in tels.items()}
        top = max(speeds, key=speeds.get)
        out["top_speed"] = {"code": top, "kmh": int(speeds[top]), "mph": int(round(speeds[top] * 0.621371))}
        out["speeds"] = dict(sorted(speeds.items(), key=lambda kv: -kv[1]))
        ref = fl["code"] if fl and fl.get("code") in tels else top
        thr = [x for x in tels[ref].get("thr") or [] if x is not None]
        if thr:
            out["throttle"] = {"code": ref, "full": round(sum(1 for x in thr if x >= FULL_THROTTLE) / len(thr), 3)}
        order = [r["code"] for r in sorted(sess["results"], key=lambda r: r.get("pos") or 99) if r.get("pos")]
        three = [c for c in order if c in tels][:3]
        if len(three) >= 2:
            out["minis"] = {"codes": three, "fastest": minis({c: tels[c] for c in three})}
    return out


def write_heroes(events: list[dict]) -> int:
    n = 0
    for ev in events:
        for s in ev.get("sessions", []):
            if not s.get("done"):
                continue
            rnd = int(ev["round"])
            src = _events_dir() / str(rnd) / f"{s['key']}.json"
            dst = _events_dir() / str(rnd) / f"{s['key']}_hero.json"
            if not src.exists():
                continue
            if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
                continue
            data = hero(rnd, s["key"])
            if data and write_json(dst, data):
                n += 1
            elif data:
                dst.touch()
    return n


def build(events: list[dict]) -> dict:
    """Everything here works offline from saved files; safe to run every update."""
    filled = fill_circuits(events)
    tracks = write_tracks(events)
    heroes = write_heroes(events)
    return {"circuits_filled": filled, "tracks_changed": tracks, "heroes_written": heroes}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    season = read_json(config.DATA_DIR / "season.json") or {}
    print(build(season.get("events", [])))
