"""Scores a frozen prediction against what actually happened."""
from __future__ import annotations

import numpy as np


def score(pred: dict, actual: dict) -> dict | None:
    res = [r for r in actual.get("results", []) if r.get("pos")]
    if not res:
        return None
    pos = {r["code"]: r["pos"] for r in res}
    finished = {r["code"]: (r.get("class") or "").isdigit() for r in actual["results"]}
    rows = [d for d in pred["drivers"] if d["code"] in pos]
    if not rows:
        return None
    in_range = np.mean([d["lo"] <= pos[d["code"]] <= d["hi"] for d in rows])
    mae = np.mean([abs(d["pred"] - pos[d["code"]]) for d in rows])
    exact = np.mean([d["pred"] == pos[d["code"]] for d in rows])
    top_field = "p_pole" if pred["kind"] == "qualifying" else "p_win"
    pick = max(rows, key=lambda d: d.get(top_field, 0))
    winner = min(pos, key=pos.get)
    pred_top3 = {d["code"] for d in sorted(rows, key=lambda d: d["pred"])[:3]}
    act_top3 = {c for c, p in pos.items() if p <= 3}
    out = {
        "round": pred["round"], "target": pred["target"], "target_name": pred["target_name"],
        "kind": pred["kind"], "made_after": pred["made_after"], "made_at": pred["made_at"],
        "backfilled": pred.get("backfilled", False),
        "in_range": round(float(in_range), 3), "exact": round(float(exact), 3), "mae": round(float(mae), 2),
        "pick": pick["code"], "pick_prob": pick.get(top_field), "actual_first": winner,
        "pick_correct": pick["code"] == winner,
        "pick_actual_pos": pos.get(pick["code"]),
        "top3_hits": len(pred_top3 & act_top3),
        "winner_pred_pos": next((d["pred"] for d in rows if d["code"] == winner), None),
    }
    if pred["kind"] == "race":
        fin = [d for d in rows if d["code"] in finished]
        out["finish_brier"] = round(float(np.mean([(d["p_finish"] - finished[d["code"]]) ** 2 for d in fin])), 3)
        out["expected_dnfs"] = round(float(sum(1 - d["p_finish"] for d in rows)), 1)
        out["actual_dnfs"] = sum(1 for d in fin if not finished[d["code"]])
        fl = (actual.get("fastest") or {}).get("code")
        fl_pick = max(rows, key=lambda d: d.get("p_fastest", 0))["code"]
        out["fastest_pick"] = fl_pick
        out["fastest_actual"] = fl
        out["fastest_correct"] = fl is not None and fl == fl_pick
    if pred.get("strategy"):
        from .strategy import actual_strategies
        act = actual_strategies(actual)
        if act:
            ps = pred["strategy"]
            pred_stops = int(max(ps["stops"], key=ps["stops"].get))
            act_stops = int(max(act["stops"], key=act["stops"].get))
            # the most likely plan with the most likely number of stops, so the two always agree
            same = [pl for pl in ps["plans"] if pl["stops"] == pred_stops] or ps["plans"]
            pred_seq = "-".join(same[0]["seq"]) if same else None
            act_seq = act["common"][0][0] if act["common"] else None
            out["strategy"] = {"pred_stops": pred_stops, "actual_stops": act_stops, "stops_right": pred_stops == act_stops,
                               "pred_seq": pred_seq, "actual_seq": act_seq, "seq_right": pred_seq == act_seq,
                               "actual": {"stops": act["stops"], "common": act["common"]}}
    if pred.get("track"):
        f = actual.get("flags") or {}
        o = pred.get("odds") or {k: pred["track"][f"{k}_prob"] for k in ("sc", "vsc", "red")}   # older predictions
        out["neutralisation"] = {"sc_prob": o["sc"], "sc": f.get("sc", 0),
                                 "vsc_prob": o["vsc"], "vsc": f.get("vsc", 0),
                                 "red_prob": o["red"], "red": f.get("red", 0)}
    out["note"] = explain(out, actual)
    return out


def explain(s: dict, actual: dict) -> str:
    """One or two plain sentences on how it went."""
    what = "pole" if s["kind"] == "qualifying" else "the win"
    if s["pick_correct"]:
        first = f"Called it: {s['pick']} was the favourite for {what} and delivered."
    else:
        where = f"P{s['pick_actual_pos']}" if s.get("pick_actual_pos") else "outside the order"
        wp = s.get("winner_pred_pos")
        first = (f"Favourite {s['pick']} finished {where}; {s['actual_first']} took {what}"
                 + (f" after being predicted P{wp}." if wp else "."))
    reasons = []
    w = actual.get("weather") or {}
    flags = actual.get("flags") or {}
    if w.get("rain"):
        reasons.append("rain played a part")
    if flags.get("sc") or flags.get("red"):
        reasons.append("safety cars or red flags shuffled the order" if s["kind"] == "race" else "a red flag disrupted the session")
    if s["kind"] == "race" and s.get("actual_dnfs", 0) >= s.get("expected_dnfs", 0) + 2:
        reasons.append("more retirements than expected")
    second = f" {int(round(s['in_range'] * 100))}% of drivers landed inside their predicted range"
    second += f" ({', '.join(reasons)})." if reasons else "."
    return first + second
