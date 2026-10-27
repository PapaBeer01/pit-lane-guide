"""Builds every model output the site reads:

  predictions/<round>/<target>.json   predictions (frozen once the session starts)
  predictions/index.json              list of predictions
  accuracy.json                       scorecard of frozen predictions vs results
  standings.json                      championship tables and points progression
  reliability.json                    team reliability table
"""
from __future__ import annotations

from datetime import datetime, timezone

from pipeline import config
from pipeline.history import load_history
from pipeline.track_history import load_track_history
from pipeline.store import read_json, write_json

from .data import SeasonData
from .features import one_lap_gaps, race_pace_gaps
from .form import Form
from .pace import practice_pace_report, race_pace_report
from .predict import predict
from .reliability import Reliability
from .score import score


def _start(ev, key):
    s = next((s for s in ev["sessions"] if s["key"] == key), None)
    if not s or not s.get("start"):
        return None
    return datetime.fromisoformat(s["start"].replace("Z", "+00:00"))


def build_standings(data: SeasonData, now: datetime | None = None) -> dict:
    drivers, teams, rounds = {}, {}, []
    for ev in data.events:
        keys = [k for k in data.done_keys(ev) if k in config.RACE_SESSIONS]
        if not keys:
            continue
        rounds.append({"round": ev["round"], "name": ev["name"], "location": ev["location"]})
        for key in keys:
            for r in data.session(ev["round"], key)["results"]:
                code = r["code"]
                pts = r.get("points") or 0
                d = drivers.setdefault(code, {"code": code, "points": 0, "wins": 0, "podiums": 0, "sprint_wins": 0,
                                              "team": data.team_of(code), "by_round": {},
                                              "teams": (data.drivers.get(code) or {}).get("teams") or [data.team_of(code)]})
                d["points"] += pts
                d["by_round"][ev["round"]] = d["by_round"].get(ev["round"], 0) + pts
                if key == "R" and r.get("pos") == 1 and (r.get("class") or "1").isdigit():
                    d["wins"] += 1
                if key == "S" and r.get("pos") == 1:
                    d["sprint_wins"] += 1
                if key == "R" and r.get("pos") and r["pos"] <= 3 and (r.get("class") or "").isdigit():
                    d["podiums"] += 1
                team = data.team_at(code, ev["round"])          # points stay with the team they were scored for
                t = teams.setdefault(team, {"team": team, "points": 0, "by_round": {}})
                t["points"] += pts
                t["by_round"][ev["round"]] = t["by_round"].get(ev["round"], 0) + pts

    def progress(x):
        acc, out = 0, []
        for r in rounds:
            acc += x["by_round"].get(r["round"], 0)
            out.append(acc)
        x["progress"] = out
        x.pop("by_round")
        return x

    d_rows = sorted((progress(d) for d in drivers.values()), key=lambda d: (-d["points"], -d["wins"]))
    t_rows = sorted((progress(t) for t in teams.values()), key=lambda t: -t["points"])
    nxt = config.next_event(data.events, now or datetime.now(timezone.utc))
    remaining = [e for e in data.events if nxt and e["round"] >= nxt["round"]]
    max_left = sum(25 + (8 if e["format"] == "sprint" else 0) for e in remaining)
    leader = d_rows[0]["points"] if d_rows else 0
    for d in d_rows:
        d["in_contention"] = d["points"] + max_left >= leader
    return {"rounds": rounds, "drivers": d_rows, "teams": t_rows, "points_left": max_left,
            "races_left": len(remaining)}


TRAIT_SHRINK = 3            # rounds' worth of "balanced" mixed in, so one odd weekend doesn't label anyone
TRAIT_LINE = 0.08           # % of lap time: beyond this a driver counts as stronger on one day


def sunday_trait(data: SeasonData, code: str) -> dict | None:
    """Racer or qualifier? From Grands Prix this season.

    - gained: average places gained from the grid to the flag (classified finishes, pit-lane starts left out)
    - race_vs_mate: finished ahead of the teammate / behind (both classified)
    - delta: race-pace gap to the teammate minus the qualifying gap to the teammate, in % of lap time,
      shrunk towards 0. Same car, so this isolates the driver: negative = relatively stronger in races.
    """
    gained, ahead, behind, deltas = [], 0, 0, []
    for ev in data.events:
        rnd = ev["round"]
        r, q = data.session(rnd, "R"), data.session(rnd, "Q")
        if not r:
            continue
        res = {x["code"]: x for x in r.get("results", [])}
        me = res.get(code)
        if not me:
            continue
        done = lambda x: (x.get("class") or "").isdigit()          # noqa: E731
        if done(me) and me.get("grid") and me.get("pos"):
            gained.append(me["grid"] - me["pos"])
        team = data.team_at(code, rnd)
        mates = [c for c in res if c != code and data.team_at(c, rnd) == team]
        if not mates:
            continue
        mate = res[mates[0]]
        if done(me) and done(mate) and me.get("pos") and mate.get("pos"):
            ahead, behind = ahead + (me["pos"] < mate["pos"]), behind + (me["pos"] > mate["pos"])
        if q:
            qg, rg = one_lap_gaps(q), race_pace_gaps(r)
            if all(c in qg and c in rg for c in (code, mate["code"])):
                deltas.append((rg[code] - rg[mate["code"]]) - (qg[code] - qg[mate["code"]]))
    if not gained and not deltas:
        return None
    delta = sum(deltas) / (len(deltas) + TRAIT_SHRINK) if deltas else 0.0
    label = "sunday" if delta <= -TRAIT_LINE else "saturday" if delta >= TRAIT_LINE else "balanced"
    return {"gained": round(sum(gained) / len(gained), 1) if gained else None, "races": len(gained),
            "race_vs_mate": [ahead, behind], "delta": round(delta, 3), "rounds": len(deltas), "label": label}


def build_summary(data: SeasonData) -> dict:
    """One small file with every weekend's headline facts and each driver's season log.

    Lets the Races, Drivers and home pages show a whole season from a single download,
    which matters on slow mobile connections.
    """
    events, drivers = [], {c: {"code": c, "log": []} for c in data.drivers}
    for ev in data.events:
        done = set(data.done_keys(ev))
        if not done:
            continue
        row = {"round": ev["round"]}
        sess = {k: data.session(ev["round"], k) for k in done}
        if "R" in sess:
            res = sess["R"]["results"]
            row["podium"] = [r["code"] for r in res if r.get("pos") and r["pos"] <= 3 and (r.get("class") or "").isdigit()]
            row["podium_grid"] = [next((r.get("grid") for r in res if r["code"] == c), None) for c in row["podium"]]
            row["fastest"] = (sess["R"].get("fastest") or {}).get("code")
            row["sc"] = (sess["R"].get("flags") or {}).get("sc", 0)
            row["wet"] = bool((sess["R"].get("weather") or {}).get("rain"))
            row["dnfs"] = sum(1 for r in res if not (r.get("class") or "").isdigit())
        if "Q" in sess:
            row["pole"] = next((r["code"] for r in sess["Q"]["results"] if r.get("pos") == 1), None)
        if "S" in sess:
            row["sprint_winner"] = next((r["code"] for r in sess["S"]["results"] if r.get("pos") == 1), None)
        events.append(row)
        for code, d in drivers.items():
            entry = {"round": ev["round"]}
            for k in ("Q", "S", "R"):
                if k in sess:
                    r = next((x for x in sess[k]["results"] if x["code"] == code), None)
                    if r:
                        finished = (r.get("class") or "").isdigit() if k != "Q" else True
                        entry[k.lower()] = r.get("pos") if finished else None
                        if k in ("S", "R"):
                            entry["pts"] = entry.get("pts", 0) + (r.get("points") or 0)
                            if not finished:
                                entry[f"{k.lower()}_out"] = True
            d["log"].append(entry)
    for d in drivers.values():
        log = d["log"]
        qs = [e["q"] for e in log if e.get("q")]
        rs = [e["r"] for e in log if e.get("r")]
        # teammate battle, round by round: whoever shared the car's garage that weekend counts,
        # so a substitute's or a mid-season mover's rounds are compared with the right teammate
        pairs, mate = [], None
        for e in log:
            if not e.get("q"):
                continue
            team = data.team_at(d["code"], e["round"])
            q = data.session(e["round"], "Q")
            for r in (q or {}).get("results", []):
                if r["code"] != d["code"] and r.get("pos") and data.team_at(r["code"], e["round"]) == team:
                    pairs.append((e["q"], r["pos"]))
                    mate = r["code"]
        both = len(pairs)
        ahead = sum(1 for a, b in pairs if a < b)
        d.update({
            "wins": sum(1 for e in log if e.get("r") == 1), "podiums": sum(1 for e in log if e.get("r") and e["r"] <= 3),
            "poles": sum(1 for e in log if e.get("q") == 1), "dnfs": sum(1 for e in log if e.get("r_out")),
            "best": min(rs) if rs else None, "avg_q": round(sum(qs) / len(qs), 1) if qs else None,
            "avg_r": round(sum(rs) / len(rs), 1) if rs else None, "points": sum(e.get("pts", 0) for e in log),
            "mate": mate, "quali_vs_mate": [ahead, both - ahead] if both else None,
            "trait": sunday_trait(data, d["code"]),
        })
    return {"events": events, "drivers": list(drivers.values())}


def _inputs(data: SeasonData, ev: dict, target: str) -> int:
    """How many sessions a prediction for `target` could draw on (changes while old rounds load)."""
    past, weekend = data.before(ev, target)
    return len(past) + len(weekend)


def run_model(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    data = SeasonData()
    if not data.events:
        return ["Model: no season data yet"]
    history = load_history()
    # sample previews keep their simulated track history next to the data folder
    track_history = load_track_history(config.DATA_DIR.parent / "history-sample" if data.sample else None)
    problems: list[str] = []
    out_dir = config.DATA_DIR / "predictions"
    index, scores = [], []
    next_ev = config.next_event(data.events, now)

    # no drivers or results yet (first run, or data not downloadable): never publish empty predictions
    has_data = bool(data.entry_list()) and any(data.done_keys(e) for e in data.events)
    if not has_data:
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)
        return problems          # nothing to predict yet; not an error

    for ev in data.events:
        targets = [s["key"] for s in ev["sessions"] if s["key"] in config.PREDICTION_TARGETS]
        done = set(data.done_keys(ev))
        for target in targets:
            path = out_dir / str(ev["round"]) / f"{target}.json"
            existing = read_json(path)
            start = _start(ev, target)
            started = target in done or (start is not None and now >= start)
            pred = existing
            try:
                if started:
                    if existing and not existing.get("frozen"):
                        existing["frozen"] = True
                        write_json(path, existing)
                    elif not existing or (existing.get("backfilled") and existing.get("inputs") != _inputs(data, ev, target)):
                        # a backtest, made only with data from before this session. Re-made while the
                        # season's older sessions are still loading; real (live) predictions are never changed.
                        pred = predict(data, ev, target, rain_prob=None, now=now, history=history, track_history=track_history)
                        pred.update({"frozen": True, "backfilled": True, "inputs": _inputs(data, ev, target)})
                        write_json(path, pred)
                elif next_ev and ev["round"] == next_ev["round"]:
                    fc = data.forecast(ev["round"]) or {}
                    rain = ((fc.get("sessions") or {}).get(target) or {}).get("rain_prob")
                    pred = predict(data, ev, target, rain_prob=rain, now=now, history=history, track_history=track_history)
                    if fc.get("sessions", {}).get(target):
                        pred["forecast"] = fc["sessions"][target]
                    write_json(path, pred)
                else:
                    continue
            except Exception as e:  # never let one prediction take the site down
                problems.append(f"Model round {ev['round']} {target}: {e}")
                continue
            if pred:
                index.append({"round": ev["round"], "target": target, "made_after": pred["made_after"],
                              "frozen": pred["frozen"], "backfilled": pred.get("backfilled", False)})
                if target in done:
                    s = score(pred, data.session(ev["round"], target))
                    if s:
                        scores.append(s)

    write_json(out_dir / "index.json", {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "items": index})

    def agg(rows):
        if not rows:
            return None
        n = len(rows)
        return {
            "sessions": n,
            "in_range": round(sum(r["in_range"] for r in rows) / n, 3),
            "mae": round(sum(r["mae"] for r in rows) / n, 2),
            "pick_rate": round(sum(r["pick_correct"] for r in rows) / n, 3),
            "top3_hits": round(sum(r["top3_hits"] for r in rows) / n, 2),
        }

    live = [s for s in scores if not s["backfilled"]]
    write_json(config.DATA_DIR / "accuracy.json", {
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": data.sample,
        "overall": {"live": agg(live), "backtest": agg([s for s in scores if s["backfilled"]]),
                    "qualifying": agg([s for s in scores if s["kind"] == "qualifying"]),
                    "race": agg([s for s in scores if s["kind"] == "race"])},
        "sessions": scores,
    })
    write_json(config.DATA_DIR / "standings.json", {**build_standings(data, now), "sample": data.sample})

    past = []
    for ev in data.events:
        for k in data.done_keys(ev):
            past.append((ev["round"], k, data.session(ev["round"], k)))
    current = next_ev["round"] if next_ev else (data.events[-1]["round"] + 1)
    rel = Reliability(past, current, data.team_of, history)
    form = Form(past, current, data.team_of)
    write_json(config.DATA_DIR / "form.json", {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": data.sample,
                                              **form.to_json(data.entry_list())})
    for ev in data.events:
        for k in data.done_keys(ev):
            report = race_pace_report if k in config.RACE_SESSIONS else practice_pace_report if k.startswith("FP") else None
            rep = report(data.session(ev["round"], k)) if report else None
            if rep:
                write_json(config.DATA_DIR / "events" / str(ev["round"]) / f"{k}_pace.json", rep)
    write_json(config.DATA_DIR / "summary.json", {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": data.sample,
                                                 **build_summary(data)})
    write_json(config.DATA_DIR / "reliability.json", {
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": data.sample,
        "teams": rel.table(), "grid_risk_per_race": round(1 - (1 - rel.grid_mech) ** 57, 4),
        "log": {t: [{"round": r, "session": k, "code": c, "cause": cause} for r, k, c, cause in v]
                for t, v in rel.log.items()},
    })
    return problems
