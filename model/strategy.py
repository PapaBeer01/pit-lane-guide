"""Race strategy: predicts how many stops and which tyre order, with pit-stop windows.

How it works
1. Tyre model per compound: pace difference and wear (seconds lost per lap of tyre age), from this
   weekend's practice long runs and this season's races, falling back to typical values.
2. Every legal plan (at least two different dry compounds, one or two stops) is timed:
   stint time = laps x pace offset + wear x laps(laps+1)/2 + a "cliff" once a tyre passes its usual life,
   plus the pit-lane time loss at this track for each stop. Stint lengths are searched lap by lap.
3. Plans within a few seconds of the best are realistic choices: their time gaps become probabilities,
   blended with how many stops teams actually made here in past races.
4. The pit window is the range of laps where stopping costs less than 2 seconds versus the ideal lap.
"""
from __future__ import annotations

from collections import Counter
from itertools import product

import numpy as np

from .features import COMPOUND_PRIOR, fit_long_runs

TYRE_LIFE = {"S": 18, "M": 28, "H": 40}           # laps before wear speeds up (typical, tuned by data later)
CLIFF = 0.06                                      # extra seconds per lap, per lap past the usual life
SOFTMAX_SECONDS = 5.0                             # plans this much slower are e^-1 as likely
WINDOW_SECONDS = 2.0
MODEL_WEIGHT = 0.6                                # vs history at this track for the number of stops
MIN_STINT = 6
TRACK_POSITION_COST = 6.0                         # seconds per extra stop at a track where overtaking is impossible


def tyre_model(weekend: list[dict], season_races: list[dict]) -> dict:
    """Tyre wear per compound from long runs, weighted by laps of evidence and pulled towards typical
    values (20 laps' worth) while evidence is thin. Pace offsets between compounds use typical values."""
    acc = {c: {"deg": [], "w": []} for c in "SMH"}
    for sess, weight in [(s, 1.0) for s in weekend if s["key"].startswith("FP")] + [(s, 0.6) for s in season_races[-4:]]:
        fit = fit_long_runs(sess)
        if not fit:
            continue
        for c in "SMH":
            if c in fit["deg"] and fit["laps"].get(c, 0) >= 8:
                acc[c]["deg"].append(fit["deg"][c])
                acc[c]["w"].append(weight * fit["laps"][c])
    out = {}
    for c in "SMH":
        prior_off, prior_deg = COMPOUND_PRIOR[c]
        w = np.array(acc[c]["w"])
        if w.sum() > 0:
            deg = float(np.clip((np.sum(w * np.array(acc[c]["deg"])) + prior_deg * 20) / (w.sum() + 20), 0.01, 0.2))
            out[c] = {"offset": prior_off, "deg": round(deg, 4), "source": "data"}
        else:
            out[c] = {"offset": prior_off, "deg": prior_deg, "source": "typical"}
    return out


def _stint_time(tm: dict, c: str, n: np.ndarray) -> np.ndarray:
    over = np.maximum(0, n - TYRE_LIFE[c])
    return n * tm[c]["offset"] + tm[c]["deg"] * n * (n + 1) / 2 + CLIFF * over * (over + 1) / 2


def plan_times(tm: dict, laps: int, pit_loss: float) -> list[dict]:
    plans = []
    for k in (2, 3):
        for seq in product("SMH", repeat=k):
            if len(set(seq)) < 2:
                continue                                   # rules: two different dry compounds
            if k == 2:
                l1 = np.arange(MIN_STINT, laps - MIN_STINT + 1)
                t = _stint_time(tm, seq[0], l1) + _stint_time(tm, seq[1], laps - l1) + pit_loss
                i = int(np.argmin(t))
                ok = l1[t <= t[i] + WINDOW_SECONDS]
                plans.append({"seq": list(seq), "stops": 1, "time": float(t[i]), "stints": [int(l1[i]), int(laps - l1[i])],
                              "windows": [[int(ok.min()), int(ok.max())]]})
            else:
                a = np.arange(MIN_STINT, laps - 2 * MIN_STINT + 1)
                l1, l2 = np.meshgrid(a, a, indexing="ij")
                l3 = laps - l1 - l2
                valid = l3 >= MIN_STINT
                t = np.where(valid, _stint_time(tm, seq[0], l1) + _stint_time(tm, seq[1], l2) + _stint_time(tm, seq[2], np.maximum(l3, 1)) + 2 * pit_loss, np.inf)
                i, j = np.unravel_index(int(np.argmin(t)), t.shape)
                ok = t <= t[i, j] + WINDOW_SECONDS
                s1, s2 = l1[ok], (l1 + l2)[ok]
                plans.append({"seq": list(seq), "stops": 2, "time": float(t[i, j]),
                              "stints": [int(l1[i, j]), int(l2[i, j]), int(l3[i, j])],
                              "windows": [[int(s1.min()), int(s1.max())], [int(s2.min()), int(s2.max())]]})
    return plans


def predict_strategy(weekend: list[dict], season_races: list[dict], track, laps: int, overtake: float = 0.5) -> dict:
    tm = tyre_model(weekend, season_races)
    plans = plan_times(tm, laps, track.pit_loss)
    # every extra stop also risks losing places on track: costs more where overtaking is hard
    for p in plans:
        p["time"] += TRACK_POSITION_COST * overtake * p["stops"]
    best = min(p["time"] for p in plans)
    for p in plans:
        p["delta"] = round(p["time"] - best, 1)
        p["score"] = float(np.exp(-(p["time"] - best) / SOFTMAX_SECONDS))
    tot = sum(p["score"] for p in plans)
    for p in plans:
        p["p_model"] = p["score"] / tot
    hist = track.stops_dist
    hist_seq = dict(track.common_seqs)
    # blend each plan's model chance with how often teams used that tyre order here before
    w = MODEL_WEIGHT if hist_seq else 1.0
    for p in plans:
        h = hist_seq.get("-".join(p["seq"]), 0.0)
        p["prob"] = w * p["p_model"] + (1 - w) * h
    z = sum(p["prob"] for p in plans) or 1
    for p in plans:
        p["prob"] = round(p["prob"] / z, 3)
    # number of stops: also blended with history, then each plan rescaled within its group
    group = {k: sum(p["prob"] for p in plans if p["stops"] == k) for k in (1, 2)}
    stops_p = dict(group)
    if hist:
        h1 = sum(v for k, v in hist.items() if k <= 1)
        stops_p = {1: w * group[1] + (1 - w) * h1, 2: w * group[2] + (1 - w) * (1 - h1)}
    for p in plans:
        p["prob"] = round(p["prob"] / group[p["stops"]] * stops_p[p["stops"]], 3) if group[p["stops"]] else 0
    plans.sort(key=lambda p: -p["prob"])
    top = [{k: p[k] for k in ("seq", "stops", "prob", "delta", "stints", "windows")} for p in plans[:4]]

    notes = []
    if track.sc_prob >= 0.6:
        notes.append(f"A safety car is likely here ({round(track.sc_prob * 100)}% of races): a stop under it costs about half the usual time, so teams keep the window flexible.")
    if not track.pit_loss_known:
        notes.append("No past pit-stop data for this track yet, so a typical pit-lane loss of about 22 seconds is assumed.")
    if all(v["source"] == "typical" for v in tm.values()):
        notes.append("Tyre wear is based on typical values until practice long runs are available.")
    return {
        "laps": laps, "pit_loss": round(track.pit_loss, 1),
        "stops": {str(k): round(v, 3) for k, v in stops_p.items()},
        "plans": top, "tyres": tm, "history": {"stops": hist, "common": track.common_seqs}, "notes": notes,
    }


def actual_strategies(sess: dict) -> dict | None:
    """What teams actually did in a finished race: stops and tyre orders among cars that finished."""
    total = sess.get("total_laps") or max((d["n"][-1] for d in sess.get("laps", {}).values() if d["n"]), default=None)
    if not total:
        return None
    finished = {r["code"] for r in sess.get("results", []) if (r.get("class") or "").isdigit()}
    stops, seqs, per = Counter(), Counter(), {}
    for code, st in (sess.get("stints") or {}).items():
        if code not in finished or not st:
            continue
        seq = [s["c"] for s in st]
        stops[len(st) - 1] += 1
        seqs["-".join(seq)] += 1
        per[code] = {"seq": seq, "stops_at": [s["to"] for s in st[:-1]]}
    n = sum(stops.values())
    if not n:
        return None
    return {"stops": {str(k): round(v / n, 3) for k, v in sorted(stops.items())},
            "common": [(k, round(v / n, 3)) for k, v in seqs.most_common(5)], "drivers": per}
