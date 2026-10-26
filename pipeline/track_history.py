"""Past races at each circuit: safety cars, virtual safety cars, red flags and tyre strategies.

Fetched once per past season with FastF1 and stored in history/track_<year>.json:
  - 2018 onwards: race-control messages only (cheap) -> SC / VSC / red-flag counts and laps
  - 2022 onwards: lap data too -> each driver's stints, number of stops, pit-lane time loss

Track behaviour (how often the safety car comes out, how much a pit stop costs, how many
stops teams make) carries over between rule sets, so this is used at low weight per the spec.
"""
from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd

from . import config
from .export import COMPOUND_CODE
from .store import read_json, write_json

log = logging.getLogger("pipeline")
SC_YEARS = tuple(range(2018, 2026))
STRATEGY_YEARS = (2022, 2023, 2024, 2025)


def norm_location(loc: str) -> str:
    """Location names differ slightly between seasons and sources."""
    s = (loc or "").lower().replace("é", "e").replace("ã", "a").replace("-", " ").strip()
    aliases = {"yas marina": "yas island", "abu dhabi": "yas island", "spa": "spa francorchamps", "sakhir": "bahrain",
               "montreal": "montreal", "monte carlo": "monaco", "marina bay": "singapore", "singapore": "singapore",
               "mexico city": "mexico city", "sao paulo": "sao paulo", "interlagos": "sao paulo", "lusail": "lusail",
               "al daayen": "lusail", "spielberg": "spielberg", "budapest": "budapest", "mogyorod": "budapest",
               "barcelona": "barcelona", "montmelo": "barcelona", "melbourne": "melbourne"}
    return aliases.get(s, s)


def flags_from_messages(messages: pd.DataFrame | None) -> dict:
    """Count safety cars, virtual safety cars and red flags, with the lap each started."""
    out = {"sc": 0, "vsc": 0, "red": 0, "sc_laps": [], "vsc_laps": [], "red_laps": []}
    if messages is None or not len(messages):
        return out
    for _, m in messages.iterrows():
        text = str(m.get("Message") or "").upper()
        cat = str(m.get("Category") or "")
        lap = m.get("Lap")
        lap = int(lap) if lap is not None and lap == lap else None
        if "VIRTUAL SAFETY CAR DEPLOYED" in text:
            out["vsc"] += 1
            out["vsc_laps"].append(lap)
        elif "SAFETY CAR DEPLOYED" in text:
            out["sc"] += 1
            out["sc_laps"].append(lap)
        elif (cat == "Flag" and str(m.get("Flag") or "").upper() == "RED" and str(m.get("Scope") or "Track") == "Track") \
                or text.startswith("RED FLAG"):
            out["red"] += 1
            out["red_laps"].append(lap)
    return out


def strategies_from_laps(laps: pd.DataFrame) -> tuple[dict, float | None]:
    """Each driver's stints as [compound, first lap, last lap], plus the typical pit-lane time loss."""
    stints, losses = {}, []
    if laps is None or not len(laps):
        return stints, None
    for code, g in laps.sort_values("LapNumber").groupby("Driver"):
        st = []
        for _, sg in g.groupby("Stint"):
            comp = COMPOUND_CODE.get(str(sg["Compound"].iloc[0]).upper(), "?")
            st.append([comp, int(sg["LapNumber"].min()), int(sg["LapNumber"].max())])
        stints[code] = st
        t = g["LapTime"].dt.total_seconds()
        green = g["TrackStatus"].astype(str).str.fullmatch("1+") if "TrackStatus" in g else pd.Series(True, index=g.index)
        normal = t[green & g["PitInTime"].isna() & g["PitOutTime"].isna()]
        if len(normal) < 5:
            continue
        base = float(normal.median())
        for i in g.index[g["PitInTime"].notna()]:
            nxt = g.index[g.index.get_loc(i) + 1] if g.index.get_loc(i) + 1 < len(g) else None
            if nxt is None or pd.isna(t[i]) or pd.isna(t[nxt]):
                continue
            if not (green[i] and green[nxt]):
                continue            # stops under safety car cost less: leave them out
            loss = t[i] + t[nxt] - 2 * base
            if 10 < loss < 45:
                losses.append(loss)
    return stints, (round(float(np.median(losses)), 1) if losses else None)


def fetch_track_history(deadline: float) -> list[str]:
    """Download any missing past races (resumes across runs). Stops at `deadline` (time.monotonic)."""
    import fastf1

    problems = []
    for year in SC_YEARS:
        path = config.HISTORY_DIR / f"track_{year}.json"
        data = read_json(path, {"year": year, "races": []}) or {"year": year, "races": []}
        # rounds already saved, or tried three times without success
        have = {r["round"] for r in data["races"] if not r.get("missing") or r.get("tries", 0) >= 3}
        try:
            sched = fastf1.get_event_schedule(year, include_testing=False)
        except Exception as e:
            problems.append(f"Track history {year}: {e}")
            continue
        changed = False
        for _, ev in sched.iterrows():
            rnd = int(ev["RoundNumber"])
            if rnd in have:
                continue
            if time.monotonic() > deadline:
                if changed:
                    write_json(path, data)
                return problems
            try:
                s = fastf1.get_session(year, rnd, "Race")
                with_laps = year in STRATEGY_YEARS
                s.load(laps=with_laps, telemetry=False, weather=False, messages=True)
                race = {"round": rnd, "location": str(ev["Location"]), "country": str(ev["Country"]),
                        "key": norm_location(str(ev["Location"])), "name": str(ev["EventName"]),
                        "flags": flags_from_messages(s.race_control_messages)}
                if with_laps:
                    race["total_laps"] = int(s.total_laps) if getattr(s, "total_laps", None) else None
                    race["stints"], race["pit_loss"] = strategies_from_laps(s.laps)
                data["races"] = [r for r in data["races"] if r["round"] != rnd] + [race]
                changed = True
            except Exception as e:
                log.warning("Track history %s round %s: %s", year, rnd, e)
                prev = next((r for r in data["races"] if r["round"] == rnd), None)
                if prev:
                    prev["tries"] = prev.get("tries", 1) + 1
                else:
                    data["races"].append({"round": rnd, "location": str(ev["Location"]), "key": norm_location(str(ev["Location"])),
                                          "name": str(ev["EventName"]), "missing": True, "tries": 1})
                changed = True
        if changed:
            write_json(path, data)
    return problems


def load_track_history(history_dir=None) -> list[dict]:
    d = history_dir or config.HISTORY_DIR
    out = []
    for year in SC_YEARS:
        data = read_json(d / f"track_{year}.json")
        if data:
            for r in data["races"]:
                if not r.get("missing"):
                    out.append({**r, "year": year})
    return out
