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


ROUNDS = (1, 2)


def fake_schedule(year, include_testing=False):
    base = pd.Timestamp("2026-03-06 01:30")
    rows = []
    for rnd in ROUNDS:
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
    import pipeline.update
    monkeypatch.setattr(pipeline.update, "sign_in", lambda: (True, ""))
    monkeypatch.setattr(pipeline.update, "check_access", lambda *a: (True, ""))

    class NoErgast:
        def __init__(self, *a, **k):
            raise ConnectionError("offline test")
    import fastf1.ergast
    monkeypatch.setattr(fastf1.ergast, "Ergast", NoErgast)
    return tmp_path


def test_update_publishes_finished_sessions_and_predicts(fake_env, monkeypatch):
    from pipeline.update import run
    monkeypatch.setattr(config, "MAX_HISTORY_RACES_PER_RUN", 100)   # all track history in one run
    monkeypatch.setattr(config, "MAX_SESSIONS_PER_RUN", 200)
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


def test_sign_in_explains_missing_secrets(monkeypatch):
    from pipeline.update import sign_in
    monkeypatch.delenv("F1_USERNAME", raising=False)
    monkeypatch.delenv("F1_PASSWORD", raising=False)
    ok, msg = sign_in()
    assert not ok and "F1_USERNAME" in msg


def test_missing_f1_login_stops_cleanly(fake_env, monkeypatch):
    import pipeline.update
    from pipeline.update import run
    monkeypatch.setattr(pipeline.update, "sign_in", lambda: (False, "F1 TV sign-in not set up"))
    problems = run(now=datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc), year=2026)
    assert problems == ["F1 TV sign-in not set up"]
    assert not (config.DATA_DIR / "events").exists()
    assert not (config.DATA_DIR / "predictions").exists()          # no empty placeholder predictions


# --- run #4 (Oct 2026): signed in, but every session came back empty, then 500 calls/h ---

def _many_rounds(monkeypatch, n):
    monkeypatch.setitem(fake_schedule.__globals__, "ROUNDS", tuple(range(1, n + 1)))


def _counting_sessions(monkeypatch, make):
    import fastf1
    calls = []

    def get_session(y, r, name):
        calls.append((r, name))
        return make(name)
    monkeypatch.setattr(fastf1, "get_session", get_session)
    return calls


class EmptySession(FakeSession):
    """What FastF1 gives when F1 refuses the data: load() only logs, then the data isn't there."""
    def __getattribute__(self, item):
        if item in ("laps", "results", "race_control_messages"):
            from fastf1.exceptions import DataNotLoadedError
            raise DataNotLoadedError("The data you are trying to access has not been loaded yet. See Session.load")
        return super().__getattribute__(item)


def test_refused_timing_data_stops_before_loading(fake_env, monkeypatch):
    import pipeline.update
    from pipeline.update import run
    calls = _counting_sessions(monkeypatch, lambda name: FakeSession(name, np.random.default_rng(3)))
    monkeypatch.setattr(pipeline.update, "check_access",
                        lambda *a: (False, "Signed in to F1 TV, but F1 refused the timing data (HTTP 401)"))
    problems = run(now=datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc), year=2026)
    assert problems == ["Signed in to F1 TV, but F1 refused the timing data (HTTP 401)"]
    assert calls == []                                            # not one session load attempted
    assert not (config.DATA_DIR / "events").exists()
    assert not (config.DATA_DIR / "predictions").exists()


def test_empty_sessions_stop_the_run_with_one_message(fake_env, monkeypatch):
    from pipeline.update import run
    _many_rounds(monkeypatch, 18)
    calls = _counting_sessions(monkeypatch, lambda name: EmptySession(name, np.random.default_rng(4)))
    problems = run(now=datetime(2026, 10, 27, 6, 0, tzinfo=timezone.utc), year=2026)
    assert len([c for c in calls]) == config.STOP_AFTER_FAILURES   # gave up after two, not ~90
    assert len(problems) == 1
    assert "Stopped loading early" in problems[0] and "came back empty" in problems[0]
    assert "has not been loaded" in problems[0]                   # the real FastF1 error is shown once
    assert not (config.DATA_DIR / "events").exists()
    assert not (config.HISTORY_DIR).exists()                       # track history not attempted either


def test_rate_limit_stops_the_run(fake_env, monkeypatch):
    from fastf1.exceptions import RateLimitExceededError
    from pipeline.update import run
    _many_rounds(monkeypatch, 5)

    class Limited(FakeSession):
        def load(self, **kw):
            raise RateLimitExceededError("any API: 500 calls/h")
    calls = _counting_sessions(monkeypatch, lambda name: Limited(name, np.random.default_rng(5)))
    problems = run(now=datetime(2026, 10, 27, 6, 0, tzinfo=timezone.utc), year=2026)
    assert len(calls) == 1
    assert len(problems) == 1 and "request limit" in problems[0] and "500 calls/h" in problems[0]


def test_backfill_is_spread_over_runs_newest_first(fake_env, monkeypatch):
    from pipeline.update import run
    _many_rounds(monkeypatch, 4)                                   # 20 finished sessions
    monkeypatch.setattr(config, "MAX_SESSIONS_PER_RUN", 10)
    import pipeline.update
    now = datetime(2026, 4, 10, 12, 0, tzinfo=timezone.utc)
    calls = _counting_sessions(monkeypatch, lambda name: FakeSession(name, np.random.default_rng(6)))
    assert run(now=now, year=2026) == []
    assert len(calls) == config.MAX_SESSIONS_PER_RUN
    assert pipeline.update.STATUS == {"published": 10, "backlog": 10}   # tells the workflow to run again
    loaded = {p.parent.name + "/" + p.stem for p in (config.DATA_DIR / "events").glob("*/*.json")
              if p.stem in config.SESSION_MINUTES}
    assert loaded == {f"{r}/{k}" for r in (3, 4) for k in ("FP1", "FP2", "FP3", "Q", "R")}   # newest rounds first
    assert not (config.HISTORY_DIR).exists()                       # season backlog first, track history later
    calls.clear()
    run(now=now, year=2026)
    assert len(calls) == config.MAX_SESSIONS_PER_RUN               # second run finishes the backlog
    assert pipeline.update.STATUS == {"published": 10, "backlog": 0}
    season = read_json(config.DATA_DIR / "season.json")
    assert all(s["done"] for ev in season["events"] for s in ev["sessions"])
    calls.clear()
    run(now=now, year=2026)                                        # nothing new: track history gets the run
    assert 0 < len(calls) <= config.MAX_HISTORY_RACES_PER_RUN and all(n == "Race" for _, n in calls)


def test_check_access_reports_refusal(monkeypatch):
    import fastf1
    from fastf1.req import Cache
    from pipeline.update import check_access

    class Resp:
        status_code = 401

    class S:
        api_path = "/static/2026/2026-03-08_Test_Grand_Prix/2026-03-08_Race/"
    seen = []
    monkeypatch.setattr(fastf1, "get_session", lambda *a: S())
    monkeypatch.setattr(Cache, "requests_get", classmethod(lambda cls, url, **k: seen.append(url) or Resp()))
    ok, msg = check_access(2026, {"round": 1}, {"key": "R", "ff_name": "Race"})
    assert not ok and "HTTP 401" in msg and "round 1 R" in msg and "subscription" in msg
    Resp.status_code = 403
    ok, msg = check_access(2026, {"round": 1}, {"key": "R", "ff_name": "Race"})
    assert not ok and "blocked" in msg and "subscription" not in msg
    assert seen[0] == "https://livetiming.formula1.com/static/2026/2026-03-08_Test_Grand_Prix/2026-03-08_Race/SessionInfo.jsonStream"
    Resp.status_code = 200
    assert check_access(2026, {"round": 1}, {"key": "R", "ff_name": "Race"}) == (True, "")


def test_track_history_gives_up_without_burning_tries(tmp_path, monkeypatch):
    import fastf1
    from pipeline import track_history
    monkeypatch.setattr(config, "HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(fastf1, "get_event_schedule", fake_schedule)
    calls = _counting_sessions(monkeypatch, lambda name: EmptySession(name, np.random.default_rng(7)))
    track_history.fetch_track_history(deadline=float("inf"))
    assert len(calls) == 2
    data = read_json(config.HISTORY_DIR / "track_2018.json")
    assert [r.get("tries") for r in data["races"]] == [1]          # only the first counts as a failed try


def test_stand_in_drivers_dont_raise_the_expected_field(fake_env):
    """Run 27 Oct: 27 drivers seen in the season (reserves in FP1) made 22-car sessions fail the check."""
    from pipeline.update import run
    seen = [{"code": c, "name": c, "team": "T", "color": "#aa0000"} for c in CODES + [f"R{i}" for i in range(7)]]
    write_json(config.DATA_DIR / "season.json", {"sample": False, "year": 2026, "events": [], "drivers": seen})
    problems = run(now=datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc), year=2026)
    assert problems == []
    assert (config.DATA_DIR / "events" / "1" / "R.json").exists()


def test_short_field_is_still_caught_once_a_grid_is_known(fake_env, monkeypatch):
    import fastf1
    from pipeline.update import run
    run(now=datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc), year=2026)       # round 1: 20 cars

    class Short(FakeSession):
        def __init__(self, name, rng):
            super().__init__(name, rng)
            self.results = self.results.iloc[:12]                              # half the field missing
    monkeypatch.setattr(fastf1, "get_session", lambda y, r, name: Short(name, np.random.default_rng(9)))
    problems = run(now=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc), year=2026)
    assert any("only 12 drivers" in p and "expected about 20" in p for p in problems)


# --- mid-season driver changes (e.g. an injury: a driver moves up, a reserve fills his seat) ---

def _swap_session(name, rnd, rng, rename: dict, team: dict):
    """FakeSession where some cars have a different driver (rename old->new) or team (code->team)."""
    s = FakeSession(name, rng)
    s.laps["Driver"] = s.laps["Driver"].replace(rename)
    for col in ("Abbreviation", "FullName", "FirstName", "LastName"):
        s.results[col] = s.results[col].replace(rename)
    for code, t in team.items():
        s.results.loc[s.results["Abbreviation"] == code, "TeamName"] = t
    return s


def test_injury_swap_and_friday_reserve(fake_env, monkeypatch):
    """Round 1: a reserve (FPR) drives D09's car in FP1 only.
    Round 2: D03 (Team 1) is injured; D05 moves up from Team 2 to Team 1; reserve RSV takes D05's Team 2 seat."""
    import fastf1
    from pipeline.update import run
    _many_rounds(monkeypatch, 3)

    def get_session(y, rnd, name):
        rng = np.random.default_rng(rnd * 10 + len(name))
        if rnd == 1:
            return _swap_session(name, rnd, rng, {"D09": "FPR"} if name == "Practice 1" else {}, {})
        if rnd == 2:      # D03's car (Team 1) now driven by D05; D05's old car (Team 2) by RSV
            return _swap_session(name, rnd, rng, {"D03": "D05", "D05": "RSV"}, {})
        return FakeSession(name, rng)

    monkeypatch.setattr(fastf1, "get_session", get_session)
    monkeypatch.setattr(config, "MAX_SESSIONS_PER_RUN", 200)
    assert run(now=datetime(2026, 3, 16, 12, 0, tzinfo=timezone.utc), year=2026) == []   # rounds 1-2 done

    roster = {d["code"]: d for d in read_json(config.DATA_DIR / "season.json")["drivers"]}
    assert roster["FPR"]["race_rounds"] == [] and roster["FPR"]["current"] is False      # Friday only
    assert roster["D03"]["race_rounds"] == [1] and roster["D03"]["current"] is False     # injured
    assert roster["D05"]["teams"] == ["Team 2", "Team 1"] and roster["D05"]["team"] == "Team 1"
    assert roster["RSV"]["teams"] == ["Team 2"] and roster["RSV"]["current"] is True
    assert sum(d["current"] for d in roster.values()) == 20

    # constructors' points stay with the team they were scored for
    st = read_json(config.DATA_DIR / "standings.json")
    teams = {t["team"]: t["points"] for t in st["teams"]}
    assert teams["Team 1"] == 15 + 12 + 12 + 15          # D03 r1, D04 r1+r2, D05 r2
    assert teams["Team 2"] == 10 + 8 + 8 + 10            # D05 r1, D06 r1+r2, RSV r2
    d05 = next(d for d in st["drivers"] if d["code"] == "D05")
    assert d05["points"] == 25 and d05["teams"] == ["Team 2", "Team 1"]

    # next race's predictions: the real line-up, not the injured driver or the Friday reserve
    pred = read_json(config.DATA_DIR / "predictions" / "3" / "Q.json")
    codes = {d["code"] for d in pred["drivers"]}
    assert len(codes) == 20 and {"RSV", "D05"} <= codes and not ({"D03", "FPR"} & codes)

    # teammate battles compare whoever shared the garage that weekend
    summary = {d["code"]: d for d in read_json(config.DATA_DIR / "summary.json")["drivers"]}
    assert summary["D04"]["quali_vs_mate"] == [0, 2]      # behind D03 in r1 and D05 in r2
    assert summary["D04"]["mate"] == "D05"
    assert summary["RSV"]["mate"] == "D06"


def test_next_race_is_by_calendar_while_old_rounds_load(fake_env, monkeypatch):
    """27 Oct: round 1 still loading made the site and model treat Melbourne as the next race."""
    import fastf1
    from pipeline.update import run
    _many_rounds(monkeypatch, 3)
    now = datetime(2026, 3, 16, 12, 0, tzinfo=timezone.utc)          # rounds 1-2 over, round 3 next

    def get_session(y, rnd, name):                                     # round 1 isn't available yet
        return EmptySession(name, np.random.default_rng(1)) if rnd == 1 else FakeSession(name, np.random.default_rng(rnd))
    monkeypatch.setattr(fastf1, "get_session", get_session)
    monkeypatch.setattr(config, "STOP_AFTER_FAILURES", 99)
    monkeypatch.setattr(config, "MAX_SESSIONS_PER_RUN", 200)
    run(now=now, year=2026)
    assert (config.DATA_DIR / "predictions" / "3" / "Q.json").exists()              # the real next race
    assert not read_json(config.DATA_DIR / "predictions" / "3" / "Q.json")["frozen"]
    assert read_json(config.DATA_DIR / "standings.json")["races_left"] == 1
    early = read_json(config.DATA_DIR / "predictions" / "2" / "Q.json")
    assert early["backfilled"] and early["inputs"] == 3              # only round 2's own practice so far

    # round 1 arrives later: round 2's backtest is re-made with it; the live round-3 prediction is
    # re-made too (not started yet), and frozen live predictions would never change
    monkeypatch.setattr(fastf1, "get_session", lambda y, r, name: FakeSession(name, np.random.default_rng(r)))
    run(now=now, year=2026)
    assert read_json(config.DATA_DIR / "predictions" / "2" / "Q.json")["inputs"] == 3 + 5   # plus round 1's five
