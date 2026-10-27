"""Loads published session files and answers "what was known before session X?"."""
from __future__ import annotations

from functools import lru_cache

from pipeline import config
from pipeline.store import read_json


class SeasonData:
    def __init__(self, data_dir=None):
        data_dir = data_dir or config.DATA_DIR
        self.dir = data_dir
        self.season = read_json(data_dir / "season.json", {}) or {}
        self.events = sorted(self.season.get("events", []), key=lambda e: e["round"])
        self.drivers = {d["code"]: d for d in self.season.get("drivers", [])}
        self.sample = bool(self.season.get("sample"))

    @lru_cache(maxsize=None)
    def session(self, rnd: int, key: str) -> dict | None:
        return read_json(self.dir / "events" / str(rnd) / f"{key}.json")

    def forecast(self, rnd: int) -> dict | None:
        return read_json(self.dir / "events" / str(rnd) / "forecast.json")

    def event(self, rnd: int) -> dict:
        return next(e for e in self.events if e["round"] == rnd)

    def done_keys(self, ev: dict) -> list[str]:
        return [s["key"] for s in ev["sessions"] if s.get("done") and self.session(ev["round"], s["key"])]

    def before(self, ev: dict, target: str) -> tuple[list[tuple[int, str, dict]], list[tuple[int, str, dict]]]:
        """Sessions known before `target` starts: (earlier events, this weekend)."""
        past = []
        for e in self.events:
            if e["round"] >= ev["round"]:
                break
            for k in self.done_keys(e):
                past.append((e["round"], k, self.session(e["round"], k)))
        weekend = []
        for s in ev["sessions"]:
            if s["key"] == target:
                break
            if s.get("done") and self.session(ev["round"], s["key"]):
                weekend.append((ev["round"], s["key"], self.session(ev["round"], s["key"])))
        return past, weekend

    # ---- who drove for whom, round by round (substitutes, injuries, mid-season moves) ----
    ORDER = ("R", "Q", "S", "SQ", "FP3", "FP2", "FP1")      # the race weekend's main sessions decide

    @lru_cache(maxsize=None)
    def _round_teams(self, rnd: int) -> dict[str, str]:
        out: dict[str, str] = {}
        for key in reversed(self.ORDER):                      # main sessions applied last, so they win
            sess = self.session(rnd, key)
            for r in (sess or {}).get("results", []):
                if r.get("team"):
                    out[r["code"]] = r["team"]
        return out

    def team_at(self, code: str, rnd: int) -> str:
        """The team `code` drove for in round `rnd` (falls back to their latest team)."""
        return self._round_teams(rnd).get(code) or self.team_of(code)

    def team_of(self, code: str, rnd: int | None = None) -> str:
        if rnd is not None:
            return self.team_at(code, rnd)
        if code in self.drivers:
            return self.drivers[code]["team"]
        return "Unknown"

    def race_lineup(self, ev: dict, target: str | None = None) -> list[str]:
        """The drivers taking part in this race weekend, as known before `target` starts.

        Starts from the last race weekend's qualifying and race entries, then follows this
        weekend's sessions. Friday practice 1 is skipped because teams lend cars to reserve
        drivers there; FP2 onwards shows who is really racing (e.g. a substitute for an injured driver).
        """
        lineup: list[str] = []
        for e in self.events:
            if e["round"] >= ev["round"]:
                break
            for key in ("SQ", "S", "Q", "R"):
                sess = self.session(e["round"], key) if key in self.done_keys(e) else None
                if sess and sess.get("results"):
                    lineup = [r["code"] for r in sess["results"]]
        for s in ev["sessions"]:
            if s["key"] == target:
                break
            if s["key"] == "FP1" or not s.get("done"):
                continue
            sess = self.session(ev["round"], s["key"])
            if sess and sess.get("results"):
                lineup = [r["code"] for r in sess["results"]]
        return lineup

    def entry_list(self) -> list[str]:
        """Current race drivers (season.json marks them); everyone seen if that isn't known yet."""
        current = [c for c, d in self.drivers.items() if d.get("current")]
        return current or list(self.drivers)
