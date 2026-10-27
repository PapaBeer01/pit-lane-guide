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


def practice_pace_report(sess: dict, min_laps: int = 5) -> dict | None:
    """Long runs in a practice session: the laps teams use to rehearse the race.

    - pace: each driver's long-run pace as seconds per lap off the quickest, from the same fit
      as race pace (corrected for tyre compound and tyre age)
    - runs: every run of `min_laps`+ clean laps: compound, laps, average, wear, and the lap times
    - compounds: how much slower each tyre type was than the quickest, from the same fit
    Practice is noisy (teams run different fuel loads and engine modes), so this is a rough guide.
    """
    fit = fit_long_runs(sess, min_laps=min_laps)
    if not fit:
        return None
    ref = fit["ref"]
    runs: dict[str, list[dict]] = {}
    for code, d in (sess.get("laps") or {}).items():
        for run in _clean_runs(d, False):
            if len(run) < min_laps:
                continue
            t = np.array([d["t"][i] for i in run], dtype=float)
            keep = t <= np.median(t) * 1.04                    # drop laps lost in traffic
            if keep.sum() < min_laps:
                continue
            life = np.array([d["l"][i] or 0 for i in run], dtype=float)
            slope = float(np.polyfit(life[keep], t[keep], 1)[0]) if np.ptp(life[keep]) > 0 else None
            runs.setdefault(code, []).append({
                "c": d["c"][run[0]] or "?", "from": d["n"][run[0]], "laps": int(keep.sum()),
                "avg": round(float(t[keep].mean()), 3), "wear": round(slope, 3) if slope is not None else None,
                "times": [round(float(x), 3) if k else None for x, k in zip(t, keep)],
            })
    pace = []
    for code, g in fit["gaps"].items():
        main = max(runs.get(code, []), key=lambda r: r["laps"], default=None)
        pace.append({"code": code, "gap": round(g / 100 * ref, 3),
                     "run_laps": main["laps"] if main else None, "run_c": main["c"] if main else None})
    pace.sort(key=lambda x: x["gap"])
    for i, p in enumerate(pace, 1):
        p["rank"] = i
    quickest = min(fit["offsets"].values()) if fit["offsets"] else 0
    compounds = {c: {"slower": round(o - quickest, 2), "laps": fit["laps"].get(c, 0)} for c, o in fit["offsets"].items()}
    return {"round": sess["round"], "key": sess["key"], "ref_lap": round(ref, 3), "pace": pace, "runs": runs,
            "compounds": compounds,
            "note": "Uses runs of 5 or more clean laps in a row, corrected for tyre type and tyre age. "
                    "Teams run different fuel loads and engine settings in practice, so treat it as a rough guide."}
