"""Turn FastF1 DataFrames into compact JSON-ready dicts.

These functions take plain pandas objects (not a live FastF1 session), so they
can be tested without network access.
"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd

from . import config

COMPOUND_CODE = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "I", "WET": "W"}


def _sec(v) -> float | None:
    """Timedelta / number -> seconds rounded to ms, or None."""
    if v is None:
        return None
    if isinstance(v, pd.Timedelta):
        return None if pd.isna(v) else round(v.total_seconds(), 3)
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (np.timedelta64,)):
        return round(pd.Timedelta(v).total_seconds(), 3)
    return round(float(v), 3)


def _int(v) -> int | None:
    try:
        if v is None or pd.isna(v):
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


def _num(v, nd=1):
    try:
        if v is None or pd.isna(v):
            return None
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


def drivers_from_results(results: pd.DataFrame) -> list[dict]:
    out = []
    for _, r in results.iterrows():
        color = str(r.get("TeamColor") or "").strip()
        if color and not color.startswith("#"):
            color = "#" + color
        out.append({
            "code": str(r["Abbreviation"]),
            "num": str(r.get("DriverNumber") or "") or None,
            "first": str(r.get("FirstName") or ""),
            "last": str(r.get("LastName") or ""),
            "name": str(r.get("FullName") or r["Abbreviation"]),
            "team": str(r.get("TeamName") or ""),
            "color": color or "#888888",
            "country": str(r.get("CountryCode") or "") or None,
        })
    return out


def _color(v) -> str | None:
    c = str(v or "").strip()
    if not c or c.lower() == "nan":
        return None
    return c if c.startswith("#") else "#" + c


def export_results(results: pd.DataFrame, key: str, laps: pd.DataFrame | None = None) -> list[dict]:
    """Classification for one session."""
    best = {}
    if laps is not None and len(laps):
        valid = laps[laps["LapTime"].notna()]
        if "Deleted" in valid:
            valid = valid[valid["Deleted"].fillna(False) != True]  # noqa: E712
        for code, g in valid.groupby("Driver"):
            best[code] = _sec(g["LapTime"].min())
        lap_counts = laps.groupby("Driver")["LapNumber"].max().to_dict()
    else:
        lap_counts = {}

    rows = []
    for _, r in results.iterrows():
        code = str(r["Abbreviation"])
        q = [_sec(r.get(c)) for c in ("Q1", "Q2", "Q3")] if key in config.QUALI_SESSIONS else None
        laps_done = _int(r.get("Laps")) if "Laps" in results else None
        if laps_done is None:
            laps_done = _int(lap_counts.get(code))
        rows.append({
            "code": code,
            "pos": _int(r.get("Position")),
            "class": str(r.get("ClassifiedPosition") or "") or None,
            "grid": _int(r.get("GridPosition")) if key in config.RACE_SESSIONS else None,
            "status": str(r.get("Status") or "") or None,
            "time": _sec(r.get("Time")),
            "points": _num(r.get("Points"), 1) if key in config.RACE_SESSIONS else None,
            "q": q,
            "best": best.get(code),
            "laps": laps_done,
            # the team this driver drove for in this session (substitutes and mid-season moves)
            "team": str(r.get("TeamName") or "") or None,
            "color": _color(r.get("TeamColor")),
        })
    # Practice sessions have no official position: order by best lap
    if key.startswith("FP"):
        rows.sort(key=lambda x: (x["best"] is None, x["best"] or 0))
        for i, row in enumerate(rows, 1):
            row["pos"] = i if row["best"] is not None else None
    else:
        rows.sort(key=lambda x: (x["pos"] is None, x["pos"] or 0))
    return rows


def export_laps(laps: pd.DataFrame) -> tuple[dict, dict, dict]:
    """Per-driver lap arrays, stints and best sectors.

    Returns (laps_by_driver, stints_by_driver, best_sectors_by_driver).
    Lap arrays are aligned: index i is the driver's i-th recorded lap.
    """
    by_driver, stints, best_sectors = {}, {}, {}
    if laps is None or not len(laps):
        return by_driver, stints, best_sectors
    for code, g in laps.sort_values("LapNumber").groupby("Driver"):
        g = g.reset_index(drop=True)
        deleted = g["Deleted"].fillna(False).astype(bool) if "Deleted" in g else pd.Series(False, index=g.index)
        accurate = g["IsAccurate"].fillna(False).astype(bool) if "IsAccurate" in g else pd.Series(True, index=g.index)
        by_driver[code] = {
            "n": [_int(v) for v in g["LapNumber"]],
            "t": [_sec(v) for v in g["LapTime"]],
            "c": [COMPOUND_CODE.get(str(v).upper(), "?") for v in g.get("Compound", pd.Series([None] * len(g)))],
            "l": [_int(v) for v in g.get("TyreLife", pd.Series([None] * len(g)))],
            "p": [_int(v) for v in g.get("Position", pd.Series([None] * len(g)))],
            "pi": [int(pd.notna(v)) for v in g.get("PitInTime", pd.Series([None] * len(g)))],
            "po": [int(pd.notna(v)) for v in g.get("PitOutTime", pd.Series([None] * len(g)))],
            "ok": [int(a and not d) for a, d in zip(accurate, deleted)],
            "ts": [str(v) if pd.notna(v) else "" for v in g.get("TrackStatus", pd.Series([None] * len(g)))],
            # session clock when the lap ended: gives the true gap between two cars on any lap
            "st": [_sec(v) for v in g.get("Time", pd.Series([None] * len(g)))],
        }
        # stints
        st = []
        if "Stint" in g:
            for s, sg in g.groupby("Stint"):
                comp = str(sg["Compound"].iloc[0]).upper() if "Compound" in sg else "UNKNOWN"
                fresh = bool(sg["FreshTyre"].iloc[0]) if "FreshTyre" in sg and pd.notna(sg["FreshTyre"].iloc[0]) else None
                st.append({
                    "c": COMPOUND_CODE.get(comp, "?"),
                    "from": _int(sg["LapNumber"].min()),
                    "to": _int(sg["LapNumber"].max()),
                    "new": fresh,
                    "age": _int(sg["TyreLife"].iloc[0]) if "TyreLife" in sg else None,
                })
        stints[code] = st
        # best sectors (theoretical best lap = sum of these)
        secs = []
        for c in ("Sector1Time", "Sector2Time", "Sector3Time"):
            if c in g:
                valid = g.loc[~deleted, c].dropna()
                secs.append(_sec(valid.min()) if len(valid) else None)
            else:
                secs.append(None)
        best_sectors[code] = secs
    return by_driver, stints, best_sectors


def export_weather(weather: pd.DataFrame | None) -> dict | None:
    if weather is None or not len(weather):
        return None
    return {
        "air": _num(weather["AirTemp"].mean()) if "AirTemp" in weather else None,
        "track": _num(weather["TrackTemp"].mean()) if "TrackTemp" in weather else None,
        "rain": bool(weather["Rainfall"].astype(bool).any()) if "Rainfall" in weather else None,
        "wind": _num(weather["WindSpeed"].mean()) if "WindSpeed" in weather else None,
        "humidity": _num(weather["Humidity"].mean(), 0) if "Humidity" in weather else None,
    }


def track_status_flags(track_status: pd.DataFrame | None) -> dict:
    """Count safety cars (4), virtual safety cars (6/7) and red flags (5)."""
    if track_status is None or not len(track_status) or "Status" not in track_status:
        return {"sc": 0, "vsc": 0, "red": 0}
    s = track_status["Status"].astype(str)
    return {"sc": int((s == "4").sum()), "vsc": int((s == "6").sum()), "red": int((s == "5").sum())}


_CODE_RE = re.compile(r"\(([A-Z]{3})\)")
INCIDENT_WORDS = ("INCIDENT", "COLLISION", "CRASH", "SPUN", "STOPPED", "CONTACT")


def incident_mentions(messages: pd.DataFrame | None) -> dict:
    """Drivers mentioned in race-control incident messages, with the lap.

    Used to tell crashes apart from technical retirements when the official
    status only says "Retired".
    """
    out: dict[str, list[int]] = {}
    if messages is None or not len(messages) or "Message" not in messages:
        return out
    for _, m in messages.iterrows():
        text = str(m.get("Message") or "").upper()
        if not any(w in text for w in INCIDENT_WORDS):
            continue
        lap = _int(m.get("Lap"))
        for code in _CODE_RE.findall(text):
            out.setdefault(code, []).append(lap if lap is not None else -1)
    return out


def export_telemetry(tel: pd.DataFrame, lap_number: int | None, lap_time: float | None,
                     step: int = config.TELEMETRY_STEP_M) -> dict | None:
    """Resample one lap of telemetry onto a fixed distance grid."""
    if tel is None or not len(tel) or "Distance" not in tel:
        return None
    tel = tel.dropna(subset=["Distance"]).sort_values("Distance")
    d = tel["Distance"].to_numpy(dtype=float)
    if len(d) < 10 or d[-1] < 500:
        return None
    grid = np.arange(0, d[-1], step)

    def interp(col, nd=0):
        if col not in tel:
            return None
        y = tel[col].astype(float).to_numpy()
        v = np.interp(grid, d, y)
        return [round(float(x), nd) if nd else int(round(float(x))) for x in v]

    return {
        "lap": lap_number,
        "time": lap_time,
        "d": [int(x) for x in grid],
        "v": interp("Speed"),
        "thr": interp("Throttle"),
        "brk": interp("Brake"),
        "g": interp("nGear"),
        "x": interp("X"),
        "y": interp("Y"),
    }


def export_circuit(tel: pd.DataFrame, corners: pd.DataFrame | None, rotation: float | None) -> dict | None:
    """Track outline from a reference lap plus corner markers."""
    t = export_telemetry(tel, None, None, step=20)
    if not t:
        return None
    out = {"x": t["x"], "y": t["y"], "d": t["d"], "rotation": _num(rotation, 1) or 0.0, "corners": []}
    if corners is not None and len(corners):
        for _, c in corners.iterrows():
            out["corners"].append({
                "n": f"{_int(c.get('Number'))}{c.get('Letter') or ''}",
                "x": _num(c.get("X"), 0), "y": _num(c.get("Y"), 0),
                "d": _num(c.get("Distance"), 0), "angle": _num(c.get("Angle"), 0),
            })
    return out


def session_payload(*, round_no: int, key: str, start: str | None, results: pd.DataFrame,
                    laps: pd.DataFrame | None, weather: pd.DataFrame | None,
                    track_status: pd.DataFrame | None, messages: pd.DataFrame | None,
                    total_laps: int | None = None, sample: bool = False) -> dict:
    lap_data, stints, best_sectors = export_laps(laps)
    res = export_results(results, key, laps)
    fastest = None
    timed = [(r["best"], r["code"]) for r in res if r["best"]]
    if timed:
        t, code = min(timed)
        lap_no = None
        if code in lap_data:
            arr = lap_data[code]
            for n, lt in zip(arr["n"], arr["t"]):
                if lt is not None and abs(lt - t) < 1e-6:
                    lap_no = n
                    break
        fastest = {"code": code, "time": t, "lap": lap_no}
    return {
        "round": round_no,
        "key": key,
        "name": config.SESSION_NAMES[key],
        "start": start,
        "sample": sample,
        "total_laps": total_laps,
        "weather": export_weather(weather),
        "flags": track_status_flags(track_status),
        "incidents": incident_mentions(messages),
        "results": res,
        "laps": lap_data,
        "stints": stints,
        "best_sectors": best_sectors,
        "fastest": fastest,
        "telemetry": [],
    }


def clean_float(o):
    """Recursively replace NaN/inf with None so the JSON is valid."""
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {k: clean_float(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean_float(v) for v in o]
    return o
