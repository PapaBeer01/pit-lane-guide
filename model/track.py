"""What past races at a circuit tell us: safety-car, VSC and red-flag odds, pit-stop cost, usual strategies.

Each past season counts less the older it is (recency decay per year), and the estimate is pulled
towards a sensible starting value until there are a few races of evidence. 2026 races at the same
track count fully.
"""
from __future__ import annotations

from collections import Counter

import numpy as np

from pipeline import config
from pipeline.track_history import norm_location

YEAR_DECAY = 0.85
PRIOR_RACES = 2.0                  # how many races' worth of weight the starting value gets
PRE_ERA_FLAGS = 0.6                # pre-2026 races for SC/VSC/red odds (mostly a property of the track)
PRE_ERA_STRATEGY = 0.4             # pre-2026 races for stops and tyre orders (2026 brought new tyres)
PRIOR = {"vsc": 0.35, "red": 0.12}
DEFAULT_PIT_LOSS = 22.0


class TrackModel:
    def __init__(self, ev: dict, history: list[dict], season_year: int, this_season: list[dict] = ()):
        """this_season: earlier 2026 races at the same track, in history format (they count fully)."""
        self.key = norm_location(ev["location"])
        traits = config.track_traits(ev["location"])
        races = [r for r in history if r.get("key") == self.key] + list(this_season)
        self.past = sorted(races, key=lambda r: r["year"])
        def era(r, pre):
            return 1.0 if r["year"] >= config.CURRENT_ERA_START else pre
        w = np.array([YEAR_DECAY ** max(0, season_year - 1 - r["year"]) * era(r, PRE_ERA_FLAGS) for r in self.past]) if self.past else np.array([])

        def rate(field, prior):
            if not len(self.past):
                return prior
            hit = np.array([1.0 if r["flags"].get(field, 0) > 0 else 0.0 for r in self.past])
            return float((np.sum(w * hit) + prior * PRIOR_RACES) / (np.sum(w) + PRIOR_RACES))

        self.sc_prob = rate("sc", traits["sc"])
        self.vsc_prob = rate("vsc", PRIOR["vsc"])
        self.red_prob = rate("red", PRIOR["red"])
        if len(self.past):
            self.sc_expected = float(np.sum(w * np.array([r["flags"].get("sc", 0) for r in self.past])) / np.sum(w))
            sc_laps = [l for r in self.past for l in r["flags"].get("sc_laps", []) if l is not None]
            self.first_lap_share = (sum(1 for l in sc_laps if l <= 2) / len(sc_laps)) if sc_laps else None
        else:
            self.sc_expected, self.first_lap_share = self.sc_prob, None
        losses = [r["pit_loss"] for r in self.past if r.get("pit_loss")]
        self.pit_loss = float(np.median(losses)) if losses else DEFAULT_PIT_LOSS
        self.pit_loss_known = bool(losses)
        laps = [r["total_laps"] for r in self.past if r.get("total_laps")]
        self.total_laps = int(np.median(laps)) if laps else None

        # how many stops and which tyre orders teams used here (finishers who ran most of the race)
        stops, seqs = Counter(), Counter()
        for r in self.past:
            if not r.get("stints") or not r.get("total_laps"):
                continue
            yw = YEAR_DECAY ** max(0, season_year - 1 - r["year"]) * era(r, PRE_ERA_STRATEGY)
            for st in r["stints"].values():
                if not st or st[-1][2] < 0.9 * r["total_laps"]:
                    continue
                dry = [s[0] for s in st if s[0] in "SMH"]
                if len(dry) != len(st):
                    continue                     # wet races don't tell us about dry strategy
                stops[len(st) - 1] += yw
                seqs["-".join(dry)] += yw
        tot = sum(stops.values())
        self.stops_dist = {int(k): round(v / tot, 3) for k, v in sorted(stops.items())} if tot else {}
        tseq = sum(seqs.values())
        self.common_seqs = [(k, round(v / tseq, 3)) for k, v in seqs.most_common(5)] if tseq else []

    def to_json(self) -> dict:
        years = []
        for r in self.past[-8:]:
            f = r["flags"]
            row = {"year": r["year"], "sc": f.get("sc", 0), "vsc": f.get("vsc", 0), "red": f.get("red", 0),
                   "sc_laps": f.get("sc_laps", [])}
            if r.get("stints") and r.get("total_laps"):
                n = [len(s) - 1 for s in r["stints"].values() if s and s[-1][2] >= 0.9 * r["total_laps"]]
                if n:
                    row["stops"] = round(float(np.mean(n)), 1)
            years.append(row)
        return {
            "key": self.key, "races": len(self.past),
            "sc_prob": round(self.sc_prob, 3), "vsc_prob": round(self.vsc_prob, 3), "red_prob": round(self.red_prob, 3),
            "sc_expected": round(self.sc_expected, 2),
            "first_lap_share": round(self.first_lap_share, 2) if self.first_lap_share is not None else None,
            "pit_loss": round(self.pit_loss, 1), "pit_loss_known": self.pit_loss_known,
            "stops_dist": self.stops_dist, "common_seqs": self.common_seqs, "years": years,
        }
