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
from pipeline.store import read_json, write_json

from .data import SeasonData
from .form import Form
from .predict import predict
from .reliability import Reliability
from .score import score


def _start(ev, key):
    s = next((s for s in ev["sessions"] if s["key"] == key), None)
    if not s or not s.get("start"):
        return None
    return datetime.fromisoformat(s["start"].replace("Z", "+00:00"))


def build_standings(data: SeasonData) -> dict:
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
                                              "team": data.team_of(code), "by_round": {}})
                d["points"] += pts
                d["by_round"][ev["round"]] = d["by_round"].get(ev["round"], 0) + pts
                if key == "R" and r.get("pos") == 1 and (r.get("class") or "1").isdigit():
                    d["wins"] += 1
                if key == "S" and r.get("pos") == 1:
                    d["sprint_wins"] += 1
                if key == "R" and r.get("pos") and r["pos"] <= 3 and (r.get("class") or "").isdigit():
                    d["podiums"] += 1
                t = teams.setdefault(d["team"], {"team": d["team"], "points": 0, "by_round": {}})
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
    remaining = [e for e in data.events if not all(s.get("done") for s in e["sessions"])]
    max_left = sum(25 + (8 if e["format"] == "sprint" else 0) for e in remaining)
    leader = d_rows[0]["points"] if d_rows else 0
    for d in d_rows:
        d["in_contention"] = d["points"] + max_left >= leader
    return {"rounds": rounds, "drivers": d_rows, "teams": t_rows, "points_left": max_left,
            "races_left": len(remaining)}


def run_model(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    data = SeasonData()
    if not data.events:
        return ["Model: no season data yet"]
    history = load_history()
    problems: list[str] = []
    out_dir = config.DATA_DIR / "predictions"
    index, scores = [], []
    next_ev = next((e for e in data.events if not all(s.get("done") for s in e["sessions"])), None)

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
                    elif not existing:
                        # first time we see this session: a backtest, made with data from before it
                        pred = predict(data, ev, target, rain_prob=None, now=now, history=history)
                        pred.update({"frozen": True, "backfilled": True})
                        write_json(path, pred)
                elif next_ev and ev["round"] == next_ev["round"]:
                    fc = data.forecast(ev["round"]) or {}
                    rain = ((fc.get("sessions") or {}).get(target) or {}).get("rain_prob")
                    pred = predict(data, ev, target, rain_prob=rain, now=now, history=history)
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
    write_json(config.DATA_DIR / "standings.json", {**build_standings(data), "sample": data.sample})

    past = []
    for ev in data.events:
        for k in data.done_keys(ev):
            past.append((ev["round"], k, data.session(ev["round"], k)))
    current = next_ev["round"] if next_ev else (data.events[-1]["round"] + 1)
    rel = Reliability(past, current, data.team_of, history)
    form = Form(past, current, data.team_of)
    write_json(config.DATA_DIR / "form.json", {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": data.sample,
                                              **form.to_json(data.entry_list())})
    write_json(config.DATA_DIR / "reliability.json", {
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": data.sample,
        "teams": rel.table(), "grid_risk_per_race": round(1 - (1 - rel.grid_mech) ** 57, 4),
        "log": {t: [{"round": r, "session": k, "code": c, "cause": cause} for r, k, c, cause in v]
                for t, v in rel.log.items()},
    })
    return problems
