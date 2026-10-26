"""Runs the real scheduled-update code against a fake FastF1 (no network)."""
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from pipeline import config
from pipeline.store import read_json, write_json

td = pd.Timedelta
CODES = [f"D{i:02d}" for i in range(1, 21)]


class FakeLap(pd.Series):
    @property
    def _constructor(self):
        return FakeLap

    def get_telemetry(self):
        d = np.linspace(0, 5000, 400)
        return pd.DataFrame({"Distance": d, "Speed": 200 + 80 * np.sin(d / 400), "Throttle": 100.0,
                             "Brake": False, "nGear": 7, "X": np.cos(d / 800) * 3000, "Y": np.sin(d / 800) * 2000})


class FakeLaps(pd.DataFrame):
    @property
    def _constructor(self):
        return FakeLaps

    def pick_drivers(self, code):
        return FakeLaps(self[self["Driver"] == code])

    def pick_fastest(self):
        if not len(self):
            return None
        return FakeLap(self.loc[self["LapTime"].idxmin()])


class FakeSession:
    def __init__(self, name, rng):
        self.name = name
        race = name in ("Race", "Sprint")
        n_laps = 20 if race else 8
        rows = []
        for i, c in enumerate(CODES):
            for lap in range(1, n_laps + 1):
                t = 80 + i * 0.05 + rng.normal(0, 0.1) + (0.02 * lap if race else 0)
                rows.append({"Driver": c, "LapNumber": float(lap), "LapTime": td(seconds=t), "Stint": 1.0,
                             "Compound": "MEDIUM", "TyreLife": float(lap), "FreshTyre": True, "Position": float(i + 1),
                             "PitInTime": pd.NaT, "PitOutTime": pd.NaT, "Sector1Time": td(seconds=25),
                             "Sector2Time": td(seconds=30), "Sector3Time": td(seconds=t - 55),
                             "IsAccurate": True, "Deleted": False, "TrackStatus": "1"})
        self.laps = FakeLaps(rows)
        self.results = pd.DataFrame({
            "DriverNumber": [str(i) for i in range(1, 21)], "Abbreviation": CODES, "FullName": CODES,
            "FirstName": CODES, "LastName": CODES, "TeamName": [f"Team {i // 2}" for i in range(20)],
            "TeamColor": ["aa0000"] * 20, "CountryCode": ["GBR"] * 20,
            "Position": [float(i) for i in range(1, 21)] if name != "Practice 1" else [np.nan] * 20,
            "ClassifiedPosition": [str(i) for i in range(1, 21)], "GridPosition": [float(i) for i in range(1, 21)],
            "Q1": [td(seconds=80)] * 20, "Q2": [td(seconds=79.8)] * 20, "Q3": [pd.NaT] * 20,
            "Time": [td(seconds=1600)] + [td(seconds=i) for i in range(1, 20)], "Status": ["Finished"] * 20,
            "Points": [25.0, 18, 15, 12, 10, 8, 6, 4, 2, 1] + [0.0] * 10, "Laps": [20.0] * 20,
        })
        self.weather_data = pd.DataFrame({"AirTemp": [22.0], "TrackTemp": [35.0], "Rainfall": [False], "WindSpeed": [1.0], "Humidity": [50.0]})
        self.track_status = pd.DataFrame({"Status": ["1"]})
        self.race_control_messages = pd.DataFrame({"Message": ["GREEN LIGHT"], "Lap": [1]})
        self.total_laps = 20 if race else None

    def load(self, **kw):
        pass

    def get_circuit_info(self):
        class Info:
            corners = pd.DataFrame({"X": [0.0], "Y": [0.0], "Number": [1], "Letter": [""], "Angle": [0.0], "Distance": [100.0]})
            rotation = 0.0
        return Info()


def fake_schedule(year, include_testing=False):
    base = pd.Timestamp("2026-03-06 01:30")
    rows = []
    for rnd in (1, 2):
        b = base + pd.Timedelta(days=7 * (rnd - 1))
        row = {"RoundNumber": rnd, "EventName": f"Test Grand Prix {rnd}", "OfficialEventName": "", "Country": "Testland",
               "Location": "Melbourne", "EventFormat": "conventional", "EventDate": b + pd.Timedelta(days=2)}
        for i, (name, off) in enumerate((("Practice 1", 0), ("Practice 2", 4), ("Practice 3", 24), ("Qualifying", 28), ("Race", 51)), 1):
            row[f"Session{i}"] = name
            row[f"Session{i}DateUtc"] = b + pd.Timedelta(hours=off)
        rows.append(row)
    return pd.DataFrame(rows)


@pytest.fixture
def fake_env(tmp_path, monkeypatch):
    import fastf1
    import pipeline.history
    rng = np.random.default_rng(1)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(fastf1, "get_event_schedule", fake_schedule)
    monkeypatch.setattr(fastf1, "get_session", lambda y, r, name: FakeSession(name, rng))
    monkeypatch.setattr(fastf1.Cache, "enable_cache", lambda *a, **k: None)
    monkeypatch.setattr(pipeline.history, "fetch_history", lambda *a, **k: [])

    class NoErgast:
        def __init__(self, *a, **k):
            raise ConnectionError("offline test")
    import fastf1.ergast
    monkeypatch.setattr(fastf1.ergast, "Ergast", NoErgast)
    return tmp_path


def test_update_publishes_finished_sessions_and_predicts(fake_env):
    from pipeline.update import run
    # pretend the sample preview is still in place: the first real run must clear it
    write_json(config.DATA_DIR / "season.json", {"sample": True, "year": 2026, "events": [], "drivers": []})
    now = datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)      # round 1 finished, round 2 next
    problems = run(now=now, year=2026)
    assert problems == []
    season = read_json(config.DATA_DIR / "season.json")
    assert season["sample"] is False
    r1 = season["events"][0]
    assert all(s["done"] for s in r1["sessions"])
    assert all(s.get("tel") for s in r1["sessions"])
    assert not any(s["done"] for s in season["events"][1]["sessions"])
    race = read_json(config.DATA_DIR / "events" / "1" / "R.json")
    assert race["results"][0]["code"] == "D01"
    assert race["final"] is False            # re-checked later for penalties
    assert (config.DATA_DIR / "events" / "1" / "tel" / "Q_D05.json").exists()
    assert (config.DATA_DIR / "events" / "1" / "circuit.json").exists()
    # predictions for the next round exist and aren't locked yet
    pred = read_json(config.DATA_DIR / "predictions" / "2" / "R.json")
    assert pred and pred["frozen"] is False and len(pred["drivers"]) == 20
    assert read_json(config.DATA_DIR / "standings.json")["drivers"][0]["points"] == 25

    # a second run with nothing new changes nothing
    before = {p: p.stat().st_mtime_ns for p in config.DATA_DIR.rglob("*.json")}
    run(now=now, year=2026)
    after = {p: p.stat().st_mtime_ns for p in config.DATA_DIR.rglob("*.json")}
    assert before == after

    # next day: the race is re-loaded once to catch late penalties, then marked final
    run(now=datetime(2026, 3, 9, 9, 0, tzinfo=timezone.utc), year=2026)
    assert read_json(config.DATA_DIR / "events" / "1" / "R.json")["final"] is True


def test_bad_session_is_not_published(fake_env, monkeypatch):
    import fastf1
    from pipeline.update import run

    class Broken(FakeSession):
        def __init__(self, name, rng):
            super().__init__(name, rng)
            if name == "Race":
                self.results["Position"] = np.nan          # provisional: no winner yet
    rng = np.random.default_rng(2)
    monkeypatch.setattr(fastf1, "get_session", lambda y, r, name: Broken(name, rng))
    problems = run(now=datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc), year=2026)
    assert any("P1" in p for p in problems)
    assert not (config.DATA_DIR / "events" / "1" / "R.json").exists()
    assert (config.DATA_DIR / "events" / "1" / "Q.json").exists()
