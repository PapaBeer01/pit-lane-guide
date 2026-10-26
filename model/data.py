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

    def team_of(self, code: str, sessions=()) -> str:
        if code in self.drivers:
            return self.drivers[code]["team"]
        return "Unknown"

    def entry_list(self) -> list[str]:
        return list(self.drivers)
