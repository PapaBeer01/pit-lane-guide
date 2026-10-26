"""Retirement (DNF) risk: mechanical per team, incidents per driver and track.

Rules (project spec):
- Mechanical risk uses 2026 data only, recency-weighted, shrunk towards the grid average.
- Teams sharing a power-unit supplier share part of the risk.
- Incident risk per driver may use pre-2026 history at low weight (it follows the driver).
- Street circuits and rain raise incident risk; lost practice running raises mechanical risk.
"""
from __future__ import annotations

import math

from pipeline import config

FINISHED_WORDS = ("finished", "lapped")
EXCLUDE_WORDS = ("disqualified", "did not start", "dns", "withdrew", "withdrawn", "excluded", "not classified - dns")
INCIDENT_WORDS = ("accident", "collision", "crash", "spun", "damage", "puncture", "contact")

DEFAULT_MECH = 0.0009     # per lap, used before any 2026 data exists
DEFAULT_INC = 0.0005
SHRINK_LAPS = 500         # how many laps of evidence it takes to move halfway off the grid average


def classify(result: dict, incidents: dict) -> str:
    """'finished', 'mech', 'incident' or 'exclude'."""
    status = (result.get("status") or "").lower()
    cls = (result.get("class") or "").upper()
    if status.startswith("+") or any(w in status for w in FINISHED_WORDS) or cls.isdigit():
        return "finished"
    # D = disqualified, E = excluded, W = withdrawn, F = failed to qualify: not a reliability event
    if any(w in status for w in EXCLUDE_WORDS) or cls in ("D", "E", "W", "F"):
        return "exclude"
    if any(w in status for w in INCIDENT_WORDS):
        return "incident"
    laps = result.get("laps") or 0
    mentioned = incidents.get(result["code"], [])
    if any(l == -1 or abs(l - laps) <= 2 for l in mentioned):
        return "incident"
    if laps == 0 and not status:
        return "exclude"
    return "mech"


def _hist_classify(status: str) -> str:
    s = (status or "").lower()
    if s == "finished" or s.startswith("+") or "lap" in s:
        return "finished"
    if any(w in s for w in EXCLUDE_WORDS):
        return "exclude"
    if any(w in s for w in INCIDENT_WORDS):
        return "incident"
    return "mech"


class Reliability:
    def __init__(self, past: list[tuple[int, str, dict]], current_round: int, team_of, history=()):
        self.team_of = team_of
        mech_k, mech_e, inc_k, inc_e = {}, {}, {}, {}
        self.log = {}           # team -> list of (round, key, code, cause)
        for rnd, key, sess in past:
            if key not in config.RACE_SESSIONS:
                continue
            w = config.RECENCY_DECAY ** max(0, current_round - rnd - 1)
            inc = sess.get("incidents") or {}
            for r in sess.get("results", []):
                cause = classify(r, inc)
                if cause == "exclude":
                    continue
                team = team_of(r["code"])
                laps = max(1, r.get("laps") or 1)
                mech_e[team] = mech_e.get(team, 0) + w * laps
                inc_e[r["code"]] = inc_e.get(r["code"], 0) + w * laps
                if cause == "mech":
                    mech_k[team] = mech_k.get(team, 0) + w
                    self.log.setdefault(team, []).append((rnd, key, r["code"], "mech"))
                elif cause == "incident":
                    inc_k[r["code"]] = inc_k.get(r["code"], 0) + w
                    self.log.setdefault(team, []).append((rnd, key, r["code"], "incident"))

        # pre-2026 incident history, low weight, follows the driver
        for season in history:
            for race in season.get("races", []):
                for r in race.get("results", []):
                    cause = _hist_classify(r.get("status"))
                    if cause == "exclude":
                        continue
                    code = r.get("code")
                    laps = max(1, r.get("laps") or 1)
                    inc_e[code] = inc_e.get(code, 0) + config.PRE_ERA_WEIGHT * laps * 0.25
                    if cause == "incident":
                        inc_k[code] = inc_k.get(code, 0) + config.PRE_ERA_WEIGHT * 0.25

        tot_e = sum(mech_e.values())
        self.grid_mech = (sum(mech_k.values()) + DEFAULT_MECH * SHRINK_LAPS) / (tot_e + SHRINK_LAPS)
        tot_ie = sum(inc_e.values())
        self.grid_inc = (sum(inc_k.values()) + DEFAULT_INC * SHRINK_LAPS) / (tot_ie + SHRINK_LAPS)
        self.team_mech = {t: (mech_k.get(t, 0) + self.grid_mech * SHRINK_LAPS) / (mech_e[t] + SHRINK_LAPS)
                          for t in mech_e}
        self.driver_inc = {c: (inc_k.get(c, 0) + self.grid_inc * SHRINK_LAPS) / (inc_e[c] + SHRINK_LAPS)
                           for c in inc_e}
        # power-unit groups
        groups: dict[str, list[float]] = {}
        for t, v in self.team_mech.items():
            groups.setdefault(config.PU_SUPPLIER.get(t, t), []).append(v)
        self.pu_mech = {g: sum(v) / len(v) for g, v in groups.items()}
        self.mech_counts = {t: sum(1 for x in self.log.get(t, []) if x[3] == "mech") for t in mech_e}

    def mech_rate(self, team: str) -> float:
        own = self.team_mech.get(team, self.grid_mech)
        pu = self.pu_mech.get(config.PU_SUPPLIER.get(team, team), own)
        return 0.75 * own + 0.25 * pu

    def inc_rate(self, code: str) -> float:
        return self.driver_inc.get(code, self.grid_inc)

    def dnf_prob(self, code: str, laps: int, street: bool, rain_prob: float, practice_issue: bool,
                 mech_factor: float = 1.0) -> float:
        mech = self.mech_rate(self.team_of(code)) * (1.5 if practice_issue else 1.0) * mech_factor
        inc = self.inc_rate(code) * (1.5 if street else 1.0) * (1 + rain_prob)
        return 1 - math.exp(-(mech + inc) * laps)

    def table(self, laps_ref: int = 57) -> list[dict]:
        rows = []
        for team in sorted(self.team_mech):
            p = 1 - math.exp(-self.mech_rate(team) * laps_ref)
            grid = 1 - math.exp(-self.grid_mech * laps_ref)
            label = "Strong" if p < grid * 0.75 else "Concern" if p > grid * 1.35 else "Average"
            rows.append({"team": team, "pu": config.PU_SUPPLIER.get(team, team),
                         "tech_dnfs": self.mech_counts.get(team, 0),
                         "risk_per_race": round(p, 4), "label": label})
        return sorted(rows, key=lambda r: r["risk_per_race"])
