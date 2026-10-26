"""Race pace report for a finished race or sprint, for the site.

- pace: each driver's race pace as seconds per lap off the quickest, from the same long-run fit the
  model uses (corrected for tyre compound, tyre age and fuel burn), shown next to where they finished
- stints: per tyre set, the average clean lap and how fast that set wore out (seconds per lap)
- clean lap times per driver for the lap-time chart (pit laps, out laps, lap 1 and neutralised laps removed)
"""
from __future__ import annotations

import numpy as np

from .features import _clean_runs, fit_long_runs

FUEL_PER_LAP = 0.03        # seconds a lap gets quicker as fuel burns off; added back to show true tyre wear


def race_pace_report(sess: dict) -> dict | None:
    fit = fit_long_runs(sess, min_laps=3)
    if not fit:
        return None
    ref = fit["ref"]
    res = {r["code"]: r for r in sess.get("results", [])}
    pace = []
    for code, g in fit["gaps"].items():
        r = res.get(code, {})
        pace.append({"code": code, "gap": round(g / 100 * ref, 3), "pos": r.get("pos"),
                     "finished": (r.get("class") or "").isdigit()})
    pace.sort(key=lambda x: x["gap"])
    for i, p in enumerate(pace, 1):
        p["rank"] = i

    stints, laps_out = {}, {}
    for code, d in (sess.get("laps") or {}).items():
        clean = set(i for run in _clean_runs(d, True) for i in run)
        laps_out[code] = [[d["n"][i], d["t"][i]] for i in sorted(clean) if d["t"][i]]
        rows, cur = [], None
        for i in range(len(d["n"])):
            if i in clean:
                # a new tyre set starts after every pit stop (cur is reset there) or on a compound change
                if not cur or cur["c"] != d["c"][i]:
                    cur = {"c": d["c"][i], "start": d["n"][i], "t": [], "life": []}
                    rows.append(cur)
                cur["t"].append(d["t"][i])
                cur["life"].append(d["l"][i] or 0)
            elif d["pi"][i]:
                cur = None
        out = []
        for s in rows:
            if len(s["t"]) < 3:
                continue
            t = np.array(s["t"])
            keep = t <= np.median(t) * 1.03          # drop laps lost in traffic
            t, life = t[keep], np.array(s["life"])[keep]
            slope = float(np.polyfit(life, t, 1)[0]) + FUEL_PER_LAP if len(t) >= 4 and np.ptp(life) > 0 else None
            out.append({"c": s["c"], "from": s["start"], "laps": int(len(t)), "avg": round(float(t.mean()), 3),
                        "wear": round(slope, 3) if slope is not None else None})
        if out:
            stints[code] = out
    fastest_pace = pace[0]["code"] if pace else None
    winner = next((r["code"] for r in sess.get("results", []) if r.get("pos") == 1), None)
    return {"round": sess["round"], "key": sess["key"], "ref_lap": round(ref, 3), "pace": pace,
            "stints": stints, "laps": laps_out, "fastest_pace": fastest_pace, "winner": winner,
            "note": "Pace is corrected for tyre type, tyre age and fuel burn, using only clean laps "
                    "(no pit laps, out laps, lap 1 or safety-car laps)."}
