"""Pace signals extracted from one session.

All pace values are a gap in percent to the fastest driver in that session
(0.0 = fastest, 0.5 = half a percent slower). Using percentages makes tracks
of different lengths comparable.
"""
from __future__ import annotations

import numpy as np

QUALI_OUTLIER_PCT = 4.0     # bigger gaps usually mean a problem, not true pace

# Typical tyre behaviour: (seconds slower than soft, seconds lost per lap of tyre age).
# Only weak starting values; the data overrides them when drivers ran several compounds.
COMPOUND_PRIOR = {"S": (0.0, 0.08), "M": (0.45, 0.055), "H": (0.85, 0.035), "I": (0.0, 0.07), "W": (0.0, 0.05)}
PRIOR_WEIGHT_OFFSET = 4.0   # ~16 laps' worth of evidence
PRIOR_WEIGHT_DEG = 15.0


def _green(ts: str) -> bool:
    return ts == "" or set(ts) <= {"1"}


def one_lap_gaps(sess: dict) -> dict[str, float]:
    """Best single-lap pace (qualifying-style)."""
    best = {}
    for r in sess.get("results", []):
        times = []
        if r.get("q"):
            times += [t for t in r["q"] if t]
        if r.get("best"):
            times.append(r["best"])
        if times:
            best[r["code"]] = min(times)
    # theoretical best (best sectors) for practice, which often hides the true lap
    if sess["key"].startswith("FP"):
        for code, secs in (sess.get("best_sectors") or {}).items():
            if secs and all(secs) and code in best:
                best[code] = min(best[code], sum(secs) + 0.25 * (best[code] - sum(secs)))
    if not best:
        return {}
    top = min(best.values())
    gaps = {c: (t / top - 1) * 100 for c, t in best.items()}
    return {c: g for c, g in gaps.items() if g <= QUALI_OUTLIER_PCT}


def _clean_runs(d: dict, race: bool) -> list[list[int]]:
    """Indexes of clean laps, grouped into continuous runs."""
    runs, cur = [], []
    for i in range(len(d["n"])):
        t = d["t"][i]
        clean = (t is not None and d["ok"][i] and not d["pi"][i] and not d["po"][i]
                 and _green(d["ts"][i]) and d["n"][i] > 1)
        if clean:
            cur.append(i)
        else:
            if cur:
                runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return runs


def race_pace_gaps(sess: dict, min_laps: int = 4) -> dict[str, float]:
    """Long-run pace corrected for tyre compound, tyre age and fuel.

    Fits: lap_time = driver + compound + degradation x tyre_age (+ fuel/evolution x lap)
    across all drivers at once, then compares the driver terms.
    """
    race = sess["key"] in ("R", "S")
    rows = []
    for code, d in (sess.get("laps") or {}).items():
        for run in _clean_runs(d, race):
            if len(run) < min_laps:
                continue
            times = [d["t"][i] for i in run]
            med = float(np.median(times))
            for i in run:
                if d["t"][i] <= med * 1.04:           # drop traffic / mistakes
                    rows.append((code, d["c"][i] or "?", d["l"][i] or 0, d["n"][i], d["t"][i]))
    if not rows:
        return {}
    drivers = sorted({r[0] for r in rows})
    counts = {c: sum(1 for r in rows if r[0] == c) for c in drivers}
    drivers = [c for c in drivers if counts[c] >= min_laps]
    rows = [r for r in rows if r[0] in drivers]
    if len(drivers) < 3:
        return {}
    comps = sorted({r[1] for r in rows}, key=lambda c: COMPOUND_PRIOR.get(c, (0, 0))[0])
    di = {c: i for i, c in enumerate(drivers)}
    ci = {c: i for i, c in enumerate(comps)}
    nd, nc = len(drivers), len(comps)
    ncols = nd + (nc - 1) + nc + (1 if race else 0)
    X = np.zeros((len(rows), ncols))
    y = np.zeros(len(rows))
    for k, (code, comp, life, lap, t) in enumerate(rows):
        X[k, di[code]] = 1
        if ci[comp] > 0:
            X[k, nd + ci[comp] - 1] = 1
        X[k, nd + nc - 1 + ci[comp]] = life
        if race:
            X[k, -1] = lap
        y[k] = t
    # Weak starting values for tyre effects: without them, a driver who only ran one compound
    # can't be separated from that compound's effect and the fit returns nonsense.
    prior_rows, prior_y = [], []
    base_off = COMPOUND_PRIOR.get(comps[0], (0, 0.05))[0]
    for c, i in ci.items():
        off, deg = COMPOUND_PRIOR.get(c, (0.4, 0.06))
        if i > 0:
            r = np.zeros(ncols); r[nd + i - 1] = PRIOR_WEIGHT_OFFSET
            prior_rows.append(r); prior_y.append((off - base_off) * PRIOR_WEIGHT_OFFSET)
        r = np.zeros(ncols); r[nd + nc - 1 + i] = PRIOR_WEIGHT_DEG
        prior_rows.append(r); prior_y.append(deg * PRIOR_WEIGHT_DEG)
    if race:
        r = np.zeros(ncols); r[-1] = PRIOR_WEIGHT_DEG
        prior_rows.append(r); prior_y.append(-0.03 * PRIOR_WEIGHT_DEG)
    X = np.vstack([X, np.array(prior_rows)])
    y_all = np.concatenate([y, np.array(prior_y)])
    coef, *_ = np.linalg.lstsq(X, y_all, rcond=None)
    eff = coef[:nd]
    ref = float(np.median(y))
    best = eff.min()
    gaps = {c: float((eff[i] - best) / ref * 100) for c, i in di.items()}
    return {c: g for c, g in gaps.items() if g <= QUALI_OUTLIER_PCT}


def reference_lap(sessions: list[dict]) -> float | None:
    """A typical fast lap at this track (seconds)."""
    for s in reversed(sessions):
        bests = [r["best"] for r in s.get("results", []) if r.get("best")]
        if bests:
            return float(np.median(sorted(bests)[:10]))
    return None


def practice_laps(sessions: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for s in sessions:
        if not s["key"].startswith("FP"):
            continue
        for code, d in (s.get("laps") or {}).items():
            out[code] = out.get(code, 0) + len(d["n"])
    return out
