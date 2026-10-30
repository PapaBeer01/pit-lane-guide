"""Backtest tuner: picks the model's noise and weighting settings by how well past predictions
would have scored, without letting a prediction see its own result.

    python -m model.tune            # search, check on held-out rounds, write model/params.json
    python -m model.tune --report   # just score the current settings

How it stays honest
- Every backtest prediction uses only data from before its session (the same rule as the site).
- Settings are chosen on the earlier rounds and then checked on the later rounds they never saw.
  They are adopted only if they also beat the current settings there.
- Each setting may move only within a modest range of its hand-set value, and the result is pulled
  halfway back towards the current value, because one season is a small sample: we want the model
  to stop being systematically too sure / too unsure, not to memorise this year's luck.

Score: the log score of every driver's real position under the predicted chances (a proper scoring
rule: it rewards being confident and right, and punishes being confident and wrong), plus the same
for the pole-sitter / winner.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline import config
from pipeline.history import load_history
from pipeline.track_history import load_track_history

from . import predict as P
from .data import SeasonData

SIMS = 1500
GRID = {   # each setting's allowed values, as multiples of its hand-set (default) value
    "exec_sd": [0.7, 0.85, 1.0, 1.2, 1.4, 1.7],
    "form_base_sd": [0.7, 0.85, 1.0, 1.2, 1.4],
    "recency": [0.82, 0.88, 0.94, 1.0, 1.06, 1.1],      # 0.85 -> 0.70 ... 0.94
    "race_spread": [0.6, 0.75, 0.9, 1.0, 1.15, 1.3],
    "race_pace_sd": [0.6, 0.8, 1.0, 1.25, 1.5],
    "front_luck": [0.4, 0.55, 0.7, 0.85, 1.0],
}
QUALI_KEYS = ("exec_sd", "form_base_sd", "recency")
RACE_KEYS = ("race_spread", "front_luck", "race_pace_sd", "form_base_sd", "recency")
PULL_BACK = 0.5          # final = current + PULL_BACK * (best - current), in log terms
PARAMS_FILE = Path(__file__).with_name("params.json")


def sessions(data: SeasonData) -> list[tuple[dict, str]]:
    out = []
    for ev in data.events:
        done = set(data.done_keys(ev))
        for s in ev["sessions"]:
            k = s["key"]
            if k in config.PREDICTION_TARGETS and k in done:
                out.append((ev, k))
    return out


def session_score(data, ev, target, ctx) -> dict | None:
    pred = P.predict(data, ev, target, rain_prob=None, now=ctx["now"], history=ctx["history"],
                     track_history=ctx["track_history"], sims=SIMS, with_strategy=False)
    raw = pred["_raw"]
    actual = data.session(ev["round"], target)
    res = {r["code"]: r["pos"] for r in actual.get("results", []) if r.get("pos")}
    codes = raw["inputs"]["codes"]
    pos = raw["pos"]
    n = len(codes)
    ll, first = [], None
    for j, c in enumerate(codes):
        if c not in res:
            continue
        p = (np.sum(pos[:, j] == res[c]) + 0.5) / (pos.shape[0] + 0.5 * n)
        ll.append(-math.log(p))
        if res[c] == 1:
            first = -math.log((np.sum(pos[:, j] == 1) + 0.5) / (pos.shape[0] + 0.5 * n))
    if not ll:
        return None
    return {"round": ev["round"], "target": target, "kind": pred["kind"], "pos_ll": float(np.mean(ll)),
            "first_ll": first if first is not None else float(np.mean(ll))}


def evaluate(data, items, ctx, params: dict) -> dict:
    P.PARAMS.clear()
    P.PARAMS.update(params)
    rows = [r for ev, t in items if (r := session_score(data, ev, t, ctx))]
    out = {}
    for kind in ("qualifying", "race"):
        sel = [r for r in rows if r["kind"] == kind]
        if sel:
            out[kind] = {"n": len(sel), "pos_ll": float(np.mean([r["pos_ll"] for r in sel])),
                         "first_ll": float(np.mean([r["first_ll"] for r in sel]))}
    return out


def objective(scores: dict, kind: str) -> float:
    s = scores.get(kind)
    return s["pos_ll"] + 0.25 * s["first_ll"] if s else 0.0


def search(data, items, ctx, start: dict, kind: str, keys) -> dict:
    """Coordinate search: one setting at a time over its allowed values, twice round."""
    best = dict(start)
    best_val = objective(evaluate(data, items, ctx, best), kind)
    for _ in range(2):
        for k in keys:
            for m in GRID[k]:
                trial = dict(best)
                trial[k] = P.DEFAULT_PARAMS[k] * m
                if math.isclose(trial[k], best[k]):
                    continue
                v = objective(evaluate(data, items, ctx, trial), kind)
                if v < best_val - 1e-4:
                    best, best_val = trial, v
                    print(f"  {kind}: {k}={trial[k]:.3f} -> {v:.4f}", flush=True)
    return best


def pull_back(current: dict, best: dict) -> dict:
    return {k: current[k] * math.exp(PULL_BACK * math.log(best[k] / current[k])) for k in current}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--split", type=int, default=12, help="choose on rounds <= split, check on the rest")
    args = ap.parse_args()
    data = SeasonData()
    ctx = {"now": datetime.now(timezone.utc), "history": load_history(), "track_history": load_track_history(None)}
    items = sessions(data)
    current = P._load_params()
    if args.report:
        print(json.dumps(evaluate(data, items, ctx, current), indent=1))
        return
    train = [x for x in items if x[0]["round"] <= args.split]
    test = [x for x in items if x[0]["round"] > args.split]

    found = dict(current)
    for kind, keys in (("qualifying", QUALI_KEYS), ("race", RACE_KEYS)):
        found = search(data, train, ctx, found, kind, keys)
    chosen = pull_back(current, found)

    before, after = evaluate(data, test, ctx, current), evaluate(data, test, ctx, chosen)
    print("held-out rounds", args.split + 1, "+:", "current", before, "tuned", after)
    final = dict(current)
    for kind, keys in (("qualifying", QUALI_KEYS), ("race", RACE_KEYS)):
        if objective(after, kind) < objective(before, kind):
            final.update({k: chosen[k] for k in keys if k not in ("form_base_sd", "recency") or kind == "qualifying"})
        else:
            print(f"  {kind}: tuned settings didn't beat the current ones on held-out rounds; keeping current")
    if final.get("form_base_sd") != current["form_base_sd"] or final.get("recency") != current["recency"]:
        # shared settings: keep only if they don't hurt the races on held-out rounds
        chk = evaluate(data, test, ctx, final)
        if objective(chk, "race") > objective(before, "race") + 1e-3:
            final["form_base_sd"], final["recency"] = current["form_base_sd"], current["recency"]
    full_before, full_after = evaluate(data, items, ctx, current), evaluate(data, items, ctx, final)
    PARAMS_FILE.write_text(json.dumps({
        "tuned_at": ctx["now"].strftime("%Y-%m-%dT%H:%M:%SZ"), "rounds": max(e["round"] for e, _ in items),
        "split": args.split, "params": {k: round(v, 4) for k, v in final.items()},
        "held_out": {"before": before, "after": evaluate(data, test, ctx, final)},
        "all_rounds": {"before": full_before, "after": full_after},
    }, indent=1) + "\n")
    print("wrote", PARAMS_FILE, json.dumps(final))


if __name__ == "__main__":
    main()
