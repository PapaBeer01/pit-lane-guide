"""Shared settings for the data pipeline and the prediction model."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "site"
DATA_DIR = SITE_DIR / "data"
HISTORY_DIR = ROOT / "history"          # pre-2026 results (low weight), not published
CACHE_DIR = ROOT / ".fastf1-cache"

# The season to follow. Change once a year (or set the F1_SEASON variable in the workflow).
SEASON = int(os.environ.get("F1_SEASON", "2026"))
CURRENT_ERA_START = 2026                 # new regulations start here

# FastF1 session names -> our short keys
SESSION_KEYS = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Sprint": "S",
    "Qualifying": "Q",
    "Race": "R",
}
SESSION_NAMES = {
    "FP1": "Practice 1", "FP2": "Practice 2", "FP3": "Practice 3",
    "SQ": "Sprint Qualifying", "S": "Sprint", "Q": "Qualifying", "R": "Grand Prix",
}
# Typical session length in minutes, used to decide when data should be ready
SESSION_MINUTES = {"FP1": 60, "FP2": 60, "FP3": 60, "SQ": 45, "S": 60, "Q": 60, "R": 120}
READY_AFTER_MINUTES = 30                 # wait this long after a session ends before loading
MAX_RUN_MINUTES = 35                     # stop starting new downloads after this; the next run continues
SESSION_SCHEMA = 2                       # bump when session files gain fields: older files are re-loaded
EVENT_OVER_HOURS = 3                     # a weekend counts as over this long after its last session starts


def next_event(events: list[dict], now):
    """The race weekend happening now or next, by the calendar (not by which data has loaded:
    an old round still loading must never be shown as the next race)."""
    from datetime import datetime, timedelta
    for ev in sorted(events, key=lambda e: e["round"]):
        starts = [s["start"] for s in ev["sessions"] if s.get("start")]
        if not starts:
            continue
        last = datetime.fromisoformat(max(starts).replace("Z", "+00:00"))
        if now < last + timedelta(hours=EVENT_OVER_HOURS):
            return ev
    return None


MAX_SESSIONS_PER_RUN = 25                # ~12-15 calls each, under FastF1's 500 calls/h; the rest go to the next run
STOP_AFTER_FAILURES = 2                  # this many overdue sessions empty in a row: stop the run
MAX_HISTORY_RACES_PER_RUN = 8            # past races for track history per run

QUALI_SESSIONS = ("SQ", "Q")
RACE_SESSIONS = ("S", "R")
PREDICTION_TARGETS = ("SQ", "S", "Q", "R")

# Telemetry is exported for every driver's fastest lap in these sessions
TELEMETRY_SESSIONS = ("FP1", "FP2", "FP3", "SQ", "S", "Q", "R")
TELEMETRY_STEP_M = 10                    # resample telemetry every 10 metres

# Data checks
LAP_TIME_MIN_S = 50
LAP_TIME_MAX_S = 200
MIN_DRIVER_SHARE = 0.9                   # share of the entry list that must be in results

# Points (used for standings when computed locally)
RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]

# ---- Model settings (see project spec: f1-prediction-spec.md) ----
PRE_ERA_WEIGHT = 0.2                     # weight of pre-2026 seasons (driver/track traits only)
RECENCY_DECAY = 0.85                     # per-round decay for 2026 form
SIMULATIONS = 4000

# Power-unit suppliers for 2026 (teams sharing a supplier share part of the reliability risk).
# Unknown teams fall back to their own name.
PU_SUPPLIER = {
    "Mercedes": "Mercedes", "McLaren": "Mercedes", "Williams": "Mercedes", "Alpine": "Mercedes",
    "Ferrari": "Ferrari", "Haas F1 Team": "Ferrari", "Haas": "Ferrari", "Cadillac": "Ferrari",
    "Red Bull Racing": "Red Bull Ford", "Racing Bulls": "Red Bull Ford",
    "Aston Martin": "Honda", "Audi": "Audi",
}

# Starting values for track traits. Pre-2026 results (low weight) refine these when available.
#   overtake: 0 = easy to pass, 1 = nearly impossible (how much grid position matters)
#   street:   street circuit (higher incident risk)
#   sc:       chance of at least one safety car in a race
TRACK_TRAITS = {
    "Melbourne": {"overtake": 0.50, "street": True, "sc": 0.65},
    "Shanghai": {"overtake": 0.40, "street": False, "sc": 0.45},
    "Suzuka": {"overtake": 0.65, "street": False, "sc": 0.40},
    "Miami": {"overtake": 0.45, "street": True, "sc": 0.55},
    "Montréal": {"overtake": 0.40, "street": True, "sc": 0.70},
    "Montreal": {"overtake": 0.40, "street": True, "sc": 0.70},
    "Monaco": {"overtake": 0.95, "street": True, "sc": 0.60},
    "Barcelona": {"overtake": 0.60, "street": False, "sc": 0.30},
    "Spielberg": {"overtake": 0.35, "street": False, "sc": 0.40},
    "Silverstone": {"overtake": 0.45, "street": False, "sc": 0.50},
    "Spa-Francorchamps": {"overtake": 0.30, "street": False, "sc": 0.45},
    "Budapest": {"overtake": 0.75, "street": False, "sc": 0.35},
    "Zandvoort": {"overtake": 0.75, "street": False, "sc": 0.50},
    "Monza": {"overtake": 0.30, "street": False, "sc": 0.40},
    "Madrid": {"overtake": 0.50, "street": True, "sc": 0.60},
    "Baku": {"overtake": 0.35, "street": True, "sc": 0.75},
    "Marina Bay": {"overtake": 0.80, "street": True, "sc": 0.85},
    "Singapore": {"overtake": 0.80, "street": True, "sc": 0.85},
    "Austin": {"overtake": 0.45, "street": False, "sc": 0.45},
    "Mexico City": {"overtake": 0.50, "street": False, "sc": 0.45},
    "São Paulo": {"overtake": 0.35, "street": False, "sc": 0.65},
    "Las Vegas": {"overtake": 0.35, "street": True, "sc": 0.55},
    "Lusail": {"overtake": 0.50, "street": False, "sc": 0.45},
    "Yas Island": {"overtake": 0.55, "street": False, "sc": 0.35},
    "Yas Marina": {"overtake": 0.55, "street": False, "sc": 0.35},
}
DEFAULT_TRACK = {"overtake": 0.5, "street": False, "sc": 0.5}


def track_traits(location: str) -> dict:
    return {**DEFAULT_TRACK, **TRACK_TRAITS.get(location, {})}
