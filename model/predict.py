"""Predictions for one target session (SQ, S, Q or R) using only data known beforehand.

Method (v1):
1. Season form: each driver's 2026 one-lap and race pace, recent rounds weighted more.
   Pre-2026 car pace is never used (new regulations).
2. This weekend: every finished session adds evidence, each with its own noise level
   (practice is noisy, sprint sessions are strong evidence).
3. Form and weekend evidence are combined (precision-weighted), giving each driver an
   expected pace and an uncertainty.
4. Monte Carlo: thousands of simulated sessions with random pace, grid effects, safety
   cars, rain and retirements give positions ranges and probabilities.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np

from pipeline import config

from .features import one_lap_gaps, practice_laps, race_pace_gaps, reference_lap
from .form import Form
from .strategy import predict_strategy
from .track import TrackModel
from .reliability import Reliability

MODEL_VERSION = "1.2"

# How noisy each session is as evidence, in % of lap time (smaller = trusted more)
ONE_LAP_NOISE = {"FP1": 0.50, "FP2": 0.42, "FP3": 0.34, "SQ": 0.18, "Q": 0.15, "S": 0.40, "R": 0.45}
RACE_NOISE = {"FP1": 0.50, "FP2": 0.36, "FP3": 0.55, "SQ": 0.38, "Q": 0.34, "S": 0.20}
FORM_BASE_SD = 0.30         # how much a car's pace varies track to track
EXEC_SD = 0.11              # lap-to-lap execution noise in a qualifying session
NEW_DRIVER_SD = 0.8
BAD_SESSION_PENALTY = (0.5, 1.4)   # % lap time lost in a bad qualifying (mistake, traffic, problem)


def _weighted_form(past, current_round, extractor, keys) -> dict[str, tuple[float, float]]:
    vals: dict[str, list[tuple[float, float]]] = {}
    for rnd, key, sess in past:
        if key not in keys:
            continue
        w = config.RECENCY_DECAY ** max(0, current_round - rnd - 1)
        for code, g in extractor(sess).items():
            vals.setdefault(code, []).append((g, w))
    out = {}
    for code, xs in vals.items():
        g = np.array([x[0] for x in xs])
        w = np.array([x[1] for x in xs])
        mu = float(np.sum(g * w) / np.sum(w))
        n_eff = float(np.sum(w) ** 2 / np.sum(w ** 2))
        spread = float(np.sqrt(np.sum(w * (g - mu) ** 2) / np.sum(w))) if len(g) > 1 else FORM_BASE_SD
        sd = math.sqrt(FORM_BASE_SD ** 2 + (spread ** 2) / max(n_eff, 1) + 0.05 ** 2)
        out[code] = (mu, sd)
    return out


def _fill_missing(prior: dict, codes: list[str], team_of) -> dict:
    """Drivers with no 2026 data start from their teammate (or the midfield) with wide uncertainty."""
    mids = sorted(v[0] for v in prior.values())
    mid = mids[len(mids) // 2] if mids else 1.0
    out = dict(prior)
    for c in codes:
        if c in out:
            continue
        mates = [prior[o][0] for o in prior if team_of(o) == team_of(c)]
        out[c] = ((mates[0] + 0.1) if mates else mid, NEW_DRIVER_SD)
    return out


def _combine(prior: dict, evidence: list[tuple[dict, float]]) -> dict[str, tuple[float, float]]:
    out = {}
    for code, (mu0, sd0) in prior.items():
        prec = 1 / sd0 ** 2
        acc = mu0 * prec
        for gaps, sd in evidence:
            if code in gaps:
                # each session is relative to its own fastest car: re-centre on the field
                p = 1 / sd ** 2
                prec += p
                acc += gaps[code] * p
        out[code] = (acc / prec, math.sqrt(1 / prec))
    return out


def _recentre(gaps: dict, prior: dict) -> dict:
    """Shift a session's gaps so its average matches the prior average for the same drivers."""
    common = [c for c in gaps if c in prior]
    if len(common) < 5:
        return gaps
    shift = np.mean([prior[c][0] for c in common]) - np.mean([gaps[c] for c in common])
    return {c: g + shift for c, g in gaps.items()}


def _rank(samples: np.ndarray) -> np.ndarray:
    """samples: sims x drivers (lower = better). Returns positions 1..n."""
    order = np.argsort(samples, axis=1)
    pos = np.empty_like(order)
    rows = np.arange(samples.shape[0])[:, None]
    pos[rows, order] = np.arange(1, samples.shape[1] + 1)
    return pos


def _summary(pos: np.ndarray, codes: list[str]) -> list[dict]:
    rows = []
    for j, c in enumerate(codes):
        p = pos[:, j]
        rows.append({
            "code": c,
            "pred": float(np.mean(p)),
            "lo": int(np.percentile(p, 20)),
            "hi": int(np.ceil(np.percentile(p, 80))),
        })
    # predicted order = by mean position; "pred" becomes that order's slot
    rows.sort(key=lambda r: r["pred"])
    for i, r in enumerate(rows, 1):
        r["avg"] = round(r["pred"], 2)
        r["pred"] = i
        r["lo"] = min(r["lo"], i)
        r["hi"] = max(r["hi"], i)
    return rows


def _quali_samples(rng, codes, post, form, sims, exec_sd):
    mu = np.array([post[c][0] for c in codes])
    sd = np.array([math.sqrt(post[c][1] ** 2 + exec_sd ** 2) for c in codes])
    samples = rng.normal(mu, sd, size=(sims, len(codes)))
    # trouble record: each driver's chance of a bad session, from past weekends
    p_fail = np.array([form.quali_fail(c) for c in codes])
    bad = rng.random((sims, len(codes))) < p_fail
    return samples + bad * rng.uniform(*BAD_SESSION_PENALTY, size=(sims, len(codes)))


def this_season_at_track(data, ev: dict) -> list[dict]:
    """Earlier races this season at the same circuit, in track-history format."""
    from pipeline.track_history import norm_location
    out = []
    for e in data.events:
        if e["round"] >= ev["round"] or norm_location(e["location"]) != norm_location(ev["location"]):
            continue
        r = data.session(e["round"], "R") if "R" in data.done_keys(e) else None
        if not r:
            continue
        f = r.get("flags") or {}
        out.append({"year": data.season.get("year", config.SEASON), "key": norm_location(e["location"]),
                    "flags": {"sc": f.get("sc", 0), "vsc": f.get("vsc", 0), "red": f.get("red", 0), "sc_laps": []},
                    "total_laps": r.get("total_laps"),
                    "stints": {c: [[s["c"], s["from"], s["to"]] for s in st] for c, st in (r.get("stints") or {}).items()}})
    return out


def predict(data, ev: dict, target: str, *, rain_prob: float | None, now: datetime,
            history=(), track_history=(), sims: int = config.SIMULATIONS, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed or (ev["round"] * 100 + config.PREDICTION_TARGETS.index(target)))
    past, weekend = data.before(ev, target)
    weekend_sessions = [s for _, _, s in weekend]
    codes = data.entry_list() or sorted({r["code"] for _, _, s in past[-1:] for r in s["results"]})
    team_of = data.team_of
    rnd = ev["round"]
    traits = config.track_traits(ev["location"])
    rain = 0.12 if rain_prob is None else float(rain_prob)
    track = TrackModel(ev, list(track_history), data.season.get("year", config.SEASON), this_season_at_track(data, ev))

    # ---- one-lap pace (qualifying) ----
    q_prior = _fill_missing(_weighted_form(past, rnd, one_lap_gaps, config.QUALI_SESSIONS), codes, team_of)
    q_evidence = []
    for _, key, sess in weekend:
        if key in ONE_LAP_NOISE and key not in config.RACE_SESSIONS:
            q_evidence.append((_recentre(one_lap_gaps(sess), q_prior), ONE_LAP_NOISE[key]))
    q_post = _combine(q_prior, q_evidence)

    # ---- race pace ----
    r_form = _weighted_form(past, rnd, race_pace_gaps, config.RACE_SESSIONS)
    r_prior = _fill_missing(r_form or {c: q_post[c] for c in codes}, codes, team_of)
    r_evidence = []
    for _, key, sess in weekend:
        if key in RACE_NOISE:
            g = race_pace_gaps(sess) if key not in config.QUALI_SESSIONS else one_lap_gaps(sess)
            if g:
                r_evidence.append((_recentre(g, r_prior), RACE_NOISE[key]))
    r_post = _combine(r_prior, r_evidence)

    used = [k for _, k, _ in weekend]
    notes = []
    extra = {}
    if used:
        notes.append(f"Uses this season's form plus {', '.join(config.SESSION_NAMES[k] for k in used)} from this weekend.")
    else:
        notes.append("Made before the weekend started, from this season's form only. Expect it to sharpen after practice.")
    if rain >= 0.3:
        notes.append(f"Rain chance around {round(rain * 100)}%, so the ranges are wider than usual.")

    form = Form(past, rnd, team_of)
    troubled = [c for c in codes if form.quali_fail(c) >= max(0.15, 1.8 * form.grid_quali_fail)]

    lap_ref = reference_lap(weekend_sessions) or reference_lap([s for _, _, s in past[-3:]]) or 90.0
    n = len(codes)
    wet_boost = 1 + 1.8 * rain

    if target in config.QUALI_SESSIONS:
        pos = _rank(_quali_samples(rng, codes, q_post, form, sims, EXEC_SD * wet_boost))
        rows = _summary(pos, codes)
        idx = {c: j for j, c in enumerate(codes)}
        for r in rows:
            p = pos[:, idx[r["code"]]]
            r.update({"p_pole": round(float(np.mean(p == 1)), 3), "p_top3": round(float(np.mean(p <= 3)), 3),
                      "p_top10": round(float(np.mean(p <= 10)), 3)})
        kind = "qualifying"
        if troubled:
            notes.append(f"Recent qualifying trouble for {', '.join(troubled)}: their ranges allow for another bad session.")
    else:
        sprint = target == "S"
        quali_key = "SQ" if sprint else "Q"
        quali_done = next((s for _, k, s in weekend if k == quali_key), None)
        laps = None
        prev_race = next((s for _, k, s in weekend if k in config.RACE_SESSIONS and s.get("total_laps")), None)
        if prev_race and not sprint:
            laps = int(round(prev_race["total_laps"] * 3))
        if not laps and track.total_laps:
            laps = round(track.total_laps / 3) if sprint else track.total_laps
        laps = laps or int(round((100_000 if sprint else 305_000) / (lap_ref * 57.0)))
        idx = {c: j for j, c in enumerate(codes)}

        if quali_done:
            order = [r["code"] for r in quali_done["results"] if r["pos"]]
            grid = np.array([order.index(c) + 1 if c in order else n for c in codes])
            grid = np.tile(grid, (sims, 1))
            notes.append("Grid taken from the actual qualifying result (late grid penalties may still change it).")
        else:
            grid = _rank(_quali_samples(rng, codes, q_post, form, sims, EXEC_SD * wet_boost))

        mu = np.array([r_post[c][0] for c in codes])
        sd = np.array([r_post[c][1] for c in codes])
        pace = rng.normal(mu, sd, size=(sims, n))                       # % gap per lap
        # neutralisations from this track's history: a safety car bunches the field up most,
        # a virtual safety car a little, and a red flag lets everyone change tyres and restart close together
        dist = 0.35 if sprint else 1.0
        sc_happens = rng.random(sims) < track.sc_prob * dist
        vsc_happens = rng.random(sims) < track.vsc_prob * dist
        red_happens = rng.random(sims) < track.red_prob * dist
        compress = np.where(sc_happens, 0.6, 1.0) * np.where(vsc_happens, 0.9, 1.0) * np.where(red_happens, 0.55, 1.0)
        pace_cost = pace / 100 * lap_ref * laps * compress[:, None]     # seconds over the race
        slot_cost = 0.3 + 3.2 * traits["overtake"] ** 2                 # seconds per grid slot
        spread = (5 + 6 * track.sc_prob + 4 * track.red_prob) * math.sqrt(laps / 57) * wet_boost
        noise = rng.normal(0, spread, size=(sims, n)) + np.where(red_happens, 1.0, 0.0)[:, None] * rng.normal(0, 4, size=(sims, n))
        total = pace_cost + slot_cost * (grid - 1) + noise

        # retirements
        rel = Reliability([p for p in past], rnd, team_of, history)
        fp_laps = practice_laps(weekend_sessions)
        med = float(np.median(list(fp_laps.values()))) if fp_laps else 0
        issues = {c for c in codes if med and fp_laps.get(c, 0) < 0.5 * med}
        p_dnf = np.array([rel.dnf_prob(c, laps, traits["street"], rain, c in issues,
                                       mech_factor=form.fp_issue_factor(team_of(c))) for c in codes])
        dnf = rng.random((sims, n)) < p_dnf
        total = np.where(dnf, 1e6 + rng.random((sims, n)), total)
        pos = _rank(total)

        # fastest lap: among finishers, best single lap = pace + lap noise (fresh-tyre stops add randomness)
        lap_best = pace + rng.normal(0, 0.28 * wet_boost, size=(sims, n))
        lap_best = np.where(dnf, np.inf, lap_best)
        fl = np.argmin(lap_best, axis=1)

        rows = _summary(pos, codes)
        for r in rows:
            j = idx[r["code"]]
            p = pos[:, j]
            r.update({
                "p_win": round(float(np.mean(p == 1)), 3),
                "p_podium": round(float(np.mean(p <= 3)), 3),
                "p_points": round(float(np.mean(p <= (8 if sprint else 10))), 3),
                "p_finish": round(float(1 - p_dnf[j]), 3),
                "p_fastest": round(float(np.mean(fl == j)), 3),
                "grid": round(float(np.mean(grid[:, j])), 1),
            })
        if issues:
            names = ", ".join(sorted(issues))
            notes.append(f"Lost practice running ({names}): a small extra reliability risk is applied.")
        ot = traits["overtake"]
        if ot >= 0.7:
            notes.append(f"{ev['location']} is hard to overtake at, so grid position matters a lot.")
        elif ot <= 0.35:
            notes.append(f"{ev['location']} is relatively easy to overtake at, so fast cars can recover from a poor grid slot.")
        src = f"from {track.to_json()['races']} past races here" if track.past else "a typical value (no past races here yet)"
        notes.append(f"Safety car chance about {round(track.sc_prob * 100)}%, virtual safety car {round(track.vsc_prob * 100)}%, "
                     f"red flag {round(track.red_prob * 100)}% ({src}). Any of these can shuffle the order.")
        kind = "race"
        extra["track"] = track.to_json()
        if not sprint:
            season_races = [s_ for _, k, s_ in past if k == "R"]
            extra["strategy"] = predict_strategy(weekend_sessions, season_races, track, laps, traits["overtake"])

    return {
        "round": rnd, "target": target, "target_name": config.SESSION_NAMES[target], "kind": kind,
        "made_after": used[-1] if used else "pre-weekend",
        "made_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "frozen": False, "backfilled": False, "sample": data.sample,
        "rain_prob": round(rain, 2) if rain_prob is not None else None,
        "drivers": rows, "notes": notes, **extra,
        "model": {"version": MODEL_VERSION, "sims": sims},
    }
