"""Form / trouble record: how each driver and team has fared, session by session.

For every past weekend we mark each session:
  Practice:   "ok" or "issue"  (lost running: under half the field's typical laps)
  Qualifying: "ok", "under"    (finished 5+ places below the pace that weekend's practice showed)
              or "notime"      (no lap time set)
  Sprint/GP:  "ok", "tech" (technical retirement), "crash" (incident) or "dnf" (other)

Recency-weighted rates of these become model inputs:
  - quali_fail: chance a driver has a bad qualifying session (used in the simulations)
  - fp_issue:   how often a team loses practice running (raises its reliability risk)
"""
from __future__ import annotations

import numpy as np

from pipeline import config

from .features import one_lap_gaps
from .reliability import classify

QUALI_UNDER_PLACES = 5
PRIOR_QUALI_FAIL = 0.08       # typical share of bad qualifying sessions
PRIOR_FP_ISSUE = 0.05
SHRINK = 4.0                  # sessions' worth of evidence for the prior


def _fp_status(sess: dict) -> dict[str, str]:
    laps = {c: len(d["n"]) for c, d in (sess.get("laps") or {}).items()}
    for r in sess.get("results", []):
        laps.setdefault(r["code"], 0)
    if not laps:
        return {}
    med = float(np.median(list(laps.values())))
    return {c: ("issue" if med and n < 0.5 * med else "ok") for c, n in laps.items()}


def _quali_status(sess: dict, practice: list[dict]) -> dict[str, str]:
    expected = {}
    if practice:
        acc: dict[str, list[float]] = {}
        for s in practice:
            for c, g in one_lap_gaps(s).items():
                acc.setdefault(c, []).append(g)
        avg = {c: float(np.mean(v)) for c, v in acc.items()}
        for i, c in enumerate(sorted(avg, key=avg.get), 1):
            expected[c] = i
    out = {}
    for r in sess.get("results", []):
        times = [t for t in (r.get("q") or []) if t]
        if not times:
            out[r["code"]] = "notime"
        elif r.get("pos") and r["code"] in expected and r["pos"] - expected[r["code"]] >= QUALI_UNDER_PLACES:
            out[r["code"]] = "under"
        else:
            out[r["code"]] = "ok"
    return out


def _race_status(sess: dict) -> dict[str, str]:
    inc = sess.get("incidents") or {}
    out = {}
    for r in sess.get("results", []):
        cause = classify(r, inc)
        out[r["code"]] = {"finished": "ok", "mech": "tech", "incident": "crash", "exclude": "dnf"}[cause]
    return out


class Form:
    def __init__(self, past: list[tuple[int, str, dict]], current_round: int, team_of):
        """team_of(code, round=None): the team in that round (None: their team now)."""
        self.team_of = team_of
        by_round: dict[int, dict[str, dict]] = {}
        for rnd, key, sess in past:
            by_round.setdefault(rnd, {})[key] = sess

        self.events: list[dict] = []          # [{round, sessions: {key: {code: status}}, results: {...}}]
        q_fail: dict[str, list[tuple[int, float]]] = {}
        fp_issue: dict[str, list[tuple[int, float]]] = {}
        team_q: dict[str, list[tuple[int, float]]] = {}       # team-level qualifying trouble (both cars)
        for rnd in sorted(by_round):
            sessions = by_round[rnd]
            marks: dict[str, dict[str, str]] = {}
            practice_so_far = []
            for key in ("FP1", "FP2", "FP3", "SQ", "S", "Q", "R"):
                sess = sessions.get(key)
                if not sess:
                    continue
                if key.startswith("FP"):
                    marks[key] = _fp_status(sess)
                    practice_so_far.append(sess)
                    for c, st in marks[key].items():
                        fp_issue.setdefault(team_of(c, rnd), []).append((rnd, 1.0 if st == "issue" else 0.0))
                elif key in config.QUALI_SESSIONS:
                    marks[key] = _quali_status(sess, practice_so_far)
                    for c, st in marks[key].items():
                        q_fail.setdefault(c, []).append((rnd, 0.0 if st == "ok" else 1.0))
                        team_q.setdefault(team_of(c, rnd), []).append((rnd, 0.0 if st == "ok" else 1.0))
                else:
                    marks[key] = _race_status(sess)
            positions = {k: {r["code"]: r.get("pos") for r in s.get("results", [])}
                         for k, s in sessions.items() if k in ("SQ", "S", "Q", "R")}
            self.events.append({"round": rnd, "marks": marks, "positions": positions})

        def rate(obs, prior):
            if not obs:
                return prior
            w = np.array([config.RECENCY_DECAY ** max(0, current_round - r - 1) for r, _ in obs])
            x = np.array([v for _, v in obs])
            return float((np.sum(w * x) + prior * SHRINK) / (np.sum(w) + SHRINK))

        all_q = [v for obs in q_fail.values() for v in obs]
        self.grid_quali_fail = rate(all_q, PRIOR_QUALI_FAIL) if all_q else PRIOR_QUALI_FAIL
        self.quali_fail_driver = {c: rate(obs, self.grid_quali_fail) for c, obs in q_fail.items()}
        all_fp = [v for obs in fp_issue.values() for v in obs]
        self.grid_fp_issue = rate(all_fp, PRIOR_FP_ISSUE) if all_fp else PRIOR_FP_ISSUE
        self.fp_issue_team = {t: rate(obs, self.grid_fp_issue) for t, obs in fp_issue.items()}
        self.quali_fail_team = {t: rate(obs, self.grid_quali_fail) for t, obs in team_q.items()}

    def quali_fail(self, code: str) -> float:
        """Chance of a bad qualifying: 60% the driver's own record, 40% the team's."""
        d = self.quali_fail_driver.get(code, self.grid_quali_fail)
        t = self.quali_fail_team.get(self.team_of(code), self.grid_quali_fail)
        return 0.6 * d + 0.4 * t

    def fp_issue_factor(self, team: str) -> float:
        """Multiplier on technical-retirement risk from how often the team loses practice running."""
        rel = self.fp_issue_team.get(team, self.grid_fp_issue) / max(self.grid_fp_issue, 1e-6)
        return float(np.clip(1 + 0.5 * (rel - 1), 0.8, 1.5))

    def to_json(self, codes: list[str], last_n: int = 6) -> dict:
        recent = self.events[-last_n:]
        drivers = []
        for c in codes:
            row = []
            for ev in recent:
                row.append({
                    "round": ev["round"],
                    "s": {k: m.get(c) for k, m in ev["marks"].items() if m.get(c)},
                    "q": ev["positions"].get("Q", {}).get(c),
                    "r": ev["positions"].get("R", {}).get(c),
                })
            drivers.append({"code": c, "team": self.team_of(c), "events": row,
                            "quali_fail": round(self.quali_fail(c), 3)})
        teams = [{"team": t, "fp_issue": round(v, 3), "quali_fail": round(self.quali_fail_team.get(t, self.grid_quali_fail), 3)}
                 for t, v in sorted(self.fp_issue_team.items(), key=lambda kv: -kv[1])]
        return {"rounds": [e["round"] for e in recent], "drivers": drivers, "teams": teams,
                "grid": {"quali_fail": round(self.grid_quali_fail, 3), "fp_issue": round(self.grid_fp_issue, 3)}}
