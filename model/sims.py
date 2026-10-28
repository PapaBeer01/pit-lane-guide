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
