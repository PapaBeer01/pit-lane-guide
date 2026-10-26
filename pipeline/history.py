"""Pre-2026 race results (previous regulations), fetched once.

Only used, at low weight, for things that carry over between regulation eras:
how much grid position matters at a track, safety-car and incident rates, and
driver traits. Never for car pace.
"""
from __future__ import annotations

import time

from . import config
from .store import read_json, write_json

YEARS = (2022, 2023, 2024, 2025)


def fetch_history(years=YEARS) -> list[str]:
    """Download missing seasons. Returns a list of problems (empty if fine)."""
    from fastf1.ergast import Ergast

    problems = []
    erg = Ergast(result_type="pandas", auto_cast=True)
    for year in years:
        path = config.HISTORY_DIR / f"results_{year}.json"
        if read_json(path):
            continue
        try:
            sched = erg.get_race_schedule(season=year)
            races = []
            for _, ev in sched.iterrows():
                rnd = int(ev["round"])
                resp = erg.get_race_results(season=year, round=rnd)
                time.sleep(0.4)   # be polite to the free API
                if not resp.content:
                    continue
                df = resp.content[0]
                races.append({
                    "round": rnd,
                    "circuit_id": str(ev.get("circuitId")),
                    "results": [{
                        "code": str(r.get("driverCode") or r.get("driverId")),
                        "driver_id": str(r.get("driverId")),
                        "team": str(r.get("constructorName")),
                        "grid": int(r["grid"]) if r.get("grid") == r.get("grid") else None,
                        "pos": int(r["position"]) if r.get("position") == r.get("position") else None,
                        "status": str(r.get("status")),
                        "laps": int(r["laps"]) if r.get("laps") == r.get("laps") else None,
                    } for _, r in df.iterrows()],
                })
            write_json(path, {"year": year, "races": races})
        except Exception as e:  # network or API problem: try again next run
            problems.append(f"History {year}: {e}")
    return problems


def load_history() -> list[dict]:
    out = []
    for year in YEARS:
        d = read_json(config.HISTORY_DIR / f"results_{year}.json")
        if d:
            out.append(d)
    return out
