"""Safety checks run before any session data is published.

If a check fails, the session is not written: the site keeps showing the last
good data and the run is flagged so GitHub sends a failure email.
"""
from __future__ import annotations

from . import config


def check_session(payload: dict, expected_drivers: int | None) -> list[str]:
    problems: list[str] = []
    key = payload["key"]
    res = payload.get("results") or []
    label = f"Round {payload['round']} {key}"

    if not res:
        return [f"{label}: no results yet"]

    if expected_drivers:
        need = int(expected_drivers * config.MIN_DRIVER_SHARE)
        if len(res) < need:
            problems.append(f"{label}: only {len(res)} drivers in results, expected about {expected_drivers}")

    laps = payload.get("laps") or {}
    if not laps:
        problems.append(f"{label}: no lap data")
    else:
        with_time = sum(1 for d in laps.values() if any(t for t in d["t"]))
        if with_time < len(res) * 0.7:
            problems.append(f"{label}: only {with_time} of {len(res)} drivers have a timed lap")
        # very long laps are normal behind a safety car or red flag; only flag impossibly fast ones
        fast = [c for c, d in laps.items() if any(t is not None and t < config.LAP_TIME_MIN_S for t in d["t"])]
        if fast:
            problems.append(f"{label}: impossible lap times for {', '.join(sorted(fast))}")

    if key in config.RACE_SESSIONS or key in config.QUALI_SESSIONS:
        positions = [r["pos"] for r in res if r["pos"] is not None]
        if 1 not in positions:
            problems.append(f"{label}: no driver classified P1 (session may still be provisional)")
        if len(positions) != len(set(positions)):
            problems.append(f"{label}: duplicate positions in results")
    return problems
