"""Raw simulation output for the Data room: every one of the 4,000 simulated sessions, plus the
numbers the simulation started from.

For each prediction, in site/data/sims/<round>/:
  <target>.csv.gz       one row per simulation. Qualifying: each driver's position, simulated lap
                        gap (% off the best possible lap) and whether they had a bad session.
                        Race: safety car / VSC / red flag that time, fastest-lap driver, and each
                        driver's grid slot, finishing position, retirement and race pace.
  <target>_detail.json  the inputs per driver (pace estimates and their uncertainty, bad-session
                        and retirement chances, track numbers) and each driver's chance of every
                        finishing position.
Files are rewritten only when their content changes, so the repository doesn't grow every run.
"""
from __future__ import annotations

import gzip
import io
import json

import numpy as np

from pipeline import config


def _write_if_changed(path, data: bytes) -> None:
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def _csv(raw: dict, kind: str) -> bytes:
    codes = raw["inputs"]["codes"]
    pos = raw["pos"]
    sims = pos.shape[0]
    head = ["sim"]
    cols = []
    if kind == "qualifying":
        for j, c in enumerate(codes):
            head += [f"{c}_pos", f"{c}_lap_gap_pct", f"{c}_bad_session"]
            cols += [pos[:, j].astype(int), np.round(raw["gap"][:, j], 3), raw["bad"][:, j].astype(int)]
    else:
        head += ["safety_car", "virtual_safety_car", "red_flag", "fastest_lap"]
        cols += [raw["sc"].astype(int), raw["vsc"].astype(int), raw["red"].astype(int),
                 np.array([codes[i] for i in raw["fastest"]])]
        for j, c in enumerate(codes):
            head += [f"{c}_grid", f"{c}_pos", f"{c}_retired", f"{c}_pace_pct"]
            cols += [raw["grid"][:, j].astype(int), pos[:, j].astype(int), raw["dnf"][:, j].astype(int),
                     np.round(raw["pace"][:, j], 3)]
    buf = io.StringIO()
    buf.write(",".join(head) + "\n")
    for i in range(sims):
        buf.write(",".join([str(i + 1)] + [str(col[i]) for col in cols]) + "\n")
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", mtime=0) as gz:      # mtime 0: same data -> same bytes
        gz.write(buf.getvalue().encode())
    return out.getvalue()


def _detail(raw: dict, pred: dict) -> dict:
    codes = raw["inputs"]["codes"]
    pos = raw["pos"]
    n = len(codes)
    chances = {}
    for j, c in enumerate(codes):
        counts = np.bincount(pos[:, j].astype(int), minlength=n + 1)[1:n + 1]
        chances[c] = [round(float(x), 4) for x in counts / pos.shape[0]]
    out = {"round": pred["round"], "target": pred["target"], "target_name": pred["target_name"], "kind": pred["kind"],
           "made_at": pred["made_at"], "made_after": pred["made_after"], "sims": int(pos.shape[0]),
           "inputs": raw["inputs"], "position_chances": chances,
           "notes": {"gaps": "Pace is a gap in % of lap time to the quickest (0 = quickest); sd is its uncertainty.",
                     "position_chances": "Each driver's chance of finishing in P1, P2, ... (index 0 = P1)."}}
    if pred["kind"] == "race":
        out["neutralised"] = {"safety_car": round(float(raw["sc"].mean()), 4),
                              "virtual_safety_car": round(float(raw["vsc"].mean()), 4),
                              "red_flag": round(float(raw["red"].mean()), 4)}
        out["retired"] = {c: round(float(raw["dnf"][:, j].mean()), 4) for j, c in enumerate(codes)}
    return out


def write_sims(pred: dict, raw: dict | None, data_dir=None) -> None:
    if not raw:
        return
    d = (data_dir or config.DATA_DIR) / "sims" / str(pred["round"])
    _write_if_changed(d / f"{pred['target']}.csv.gz", _csv(raw, pred["kind"]))
    _write_if_changed(d / f"{pred['target']}_detail.json",
                      json.dumps(_detail(raw, pred), separators=(",", ":")).encode())


def has_sims(rnd: int, target: str, data_dir=None) -> bool:
    return ((data_dir or config.DATA_DIR) / "sims" / str(rnd) / f"{target}_detail.json").exists()


def _read_csv(path):
    import csv
    rows = list(csv.reader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
    return rows[0], rows[1:]


def compare_with_reality(rnd: int, target: str, session: dict, data_dir=None) -> None:
    """After a session: which simulation came closest to what really happened, and how often the
    simulations got the front of the order exactly right. Added to <target>_detail.json as "vs_real"
    (recomputed if the official result changes, e.g. after a penalty)."""
    d = (data_dir or config.DATA_DIR) / "sims" / str(rnd)
    det_path, csv_path = d / f"{target}_detail.json", d / f"{target}.csv.gz"
    if not (det_path.exists() and csv_path.exists()):
        return
    real = sorted((r for r in session.get("results", []) if r.get("pos")), key=lambda r: r["pos"])
    real_order = [r["code"] for r in real]
    detail = json.loads(det_path.read_text())
    if (detail.get("vs_real") or {}).get("real") == real_order:
        return
    head, rows = _read_csv(csv_path)
    codes = [h[:-4] for h in head if h.endswith("_pos")]
    pos = np.array([[int(r[head.index(f"{c}_pos")]) for c in codes] for r in rows])
    actual = np.array([real_order.index(c) + 1 if c in real_order else 99 for c in codes])
    same = pos == actual
    exact = same.sum(1)

    def front(k):
        idx = [codes.index(c) for c in real_order[:k] if c in codes]
        return float(np.all(same[:, idx], axis=1).mean()) if len(idx) == k else 0.0
    top10 = [codes.index(c) for c in real_order[:10] if c in codes]
    off = np.abs(np.where(actual < 99, pos - actual, 0)).sum(1)
    # closest = right for longest from the front (winner, then P2, ...), then most places right overall
    in_order = [codes.index(c) for c in real_order if c in codes]
    from_front = np.cumprod(same[:, in_order], axis=1).sum(1)
    best = max(range(len(rows)), key=lambda i: (from_front[i], exact[i], -off[i]))
    sim_order = [c for _, c in sorted(zip(pos[best], codes))]
    out = {
        "real": real_order, "best_sim": int(rows[best][0]), "best_order": sim_order,
        "best_exact": int(exact[best]), "field": len(real_order),
        "best_exact_from_front": int(from_front[best]),
        "avg_exact": round(float(exact.mean()), 2),
        "share": {"winner": round(front(1), 4), "top3": round(front(3), 4), "top5": round(front(5), 4),
                  "top10": round(front(10), 4), "full": round(front(len(real_order)), 4)},
    }
    if "safety_car" in head:
        r = rows[best]
        out["best_flags"] = {"sc": int(r[head.index("safety_car")]), "vsc": int(r[head.index("virtual_safety_car")]),
                             "red": int(r[head.index("red_flag")])}
        f = session.get("flags") or {}
        out["real_flags"] = {"sc": int(bool(f.get("sc"))), "vsc": int(bool(f.get("vsc"))), "red": int(bool(f.get("red")))}
    detail["vs_real"] = out
    _write_if_changed(det_path, json.dumps(detail, separators=(",", ":")).encode())
