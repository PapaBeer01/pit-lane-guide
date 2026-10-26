"""Pipeline tests that run without network: FastF1-shaped DataFrames in, JSON out."""
import pandas as pd
import pytest

from pipeline.checks import check_session
from pipeline.export import export_laps, export_results, export_telemetry, incident_mentions, session_payload

td = pd.Timedelta


def fake_results(n=4):
    codes = ["AAA", "BBB", "CCC", "DDD"][:n]
    return pd.DataFrame({
        "DriverNumber": [str(i + 1) for i in range(n)], "Abbreviation": codes,
        "FullName": [f"Driver {c}" for c in codes], "FirstName": codes, "LastName": codes,
        "TeamName": ["Team A", "Team A", "Team B", "Team B"][:n], "TeamColor": ["ff0000", "ff0000", "00ff00", "00ff00"][:n],
        "CountryCode": ["GBR"] * n,
        "Position": [1.0, 2.0, 3.0, float("nan")][:n], "ClassifiedPosition": ["1", "2", "3", "R"][:n],
        "GridPosition": [2.0, 1.0, 3.0, 4.0][:n],
        "Q1": [td(seconds=80.1)] * n, "Q2": [td(seconds=79.9)] * n, "Q3": [pd.NaT] * n,
        "Time": [td(seconds=5400), td(seconds=3.2), td(seconds=10.5), pd.NaT][:n],
        "Status": ["Finished", "Finished", "+1 Lap", "Retired"][:n], "Points": [25.0, 18.0, 15.0, 0.0][:n],
        "Laps": [3.0, 3.0, 2.0, 1.0][:n],
    })


def fake_laps():
    rows = []
    for code, base in (("AAA", 80.0), ("BBB", 80.3), ("CCC", 80.9), ("DDD", 81.2)):
        for lap in (1, 2, 3):
            rows.append({
                "Driver": code, "LapNumber": float(lap), "LapTime": td(seconds=base + lap * 0.1),
                "Stint": 1.0, "Compound": "MEDIUM", "TyreLife": float(lap), "FreshTyre": True,
                "Position": 1.0, "PitInTime": pd.NaT, "PitOutTime": td(seconds=1) if lap == 1 else pd.NaT,
                "Sector1Time": td(seconds=25), "Sector2Time": td(seconds=30), "Sector3Time": td(seconds=base - 55),
                "IsAccurate": True, "Deleted": False, "TrackStatus": "1",
            })
    return pd.DataFrame(rows)


def test_results_race_fields():
    res = export_results(fake_results(), "R", fake_laps())
    assert [r["code"] for r in res][:3] == ["AAA", "BBB", "CCC"]
    assert res[0]["points"] == 25.0 and res[0]["grid"] == 2
    assert res[-1]["pos"] is None and res[-1]["status"] == "Retired"
    assert res[0]["best"] == pytest.approx(80.1)


def test_practice_is_ordered_by_best_lap():
    res = export_results(fake_results(), "FP1", fake_laps())
    assert [r["pos"] for r in res] == [1, 2, 3, 4]
    assert res[0]["points"] is None


def test_laps_and_stints():
    laps, stints, best = export_laps(fake_laps())
    assert laps["AAA"]["t"] == [80.1, 80.2, 80.3]
    assert laps["AAA"]["c"] == ["M", "M", "M"]
    assert laps["AAA"]["po"] == [1, 0, 0]
    assert stints["AAA"] == [{"c": "M", "from": 1, "to": 3, "new": True, "age": 1}]
    assert best["AAA"] == [25.0, 30.0, 25.0]


def test_incident_mentions():
    msgs = pd.DataFrame({"Message": ["CAR 4 (AAA) AND 1 (BBB) INCIDENT NOTED", "DRS ENABLED"], "Lap": [12, 13]})
    assert incident_mentions(msgs) == {"AAA": [12], "BBB": [12]}


def test_telemetry_resampling():
    tel = pd.DataFrame({"Distance": [0, 1000, 2000, 3000], "Speed": [100, 300, 120, 250], "Throttle": [100] * 4,
                        "Brake": [0, 0, 1, 0], "nGear": [3, 8, 4, 7], "X": [0, 10, 20, 30], "Y": [0, 5, 0, -5]})
    tel = pd.concat([tel] * 4).sort_values("Distance")  # enough rows
    out = export_telemetry(tel, 5, 80.0, step=500)
    assert out["d"][:3] == [0, 500, 1000]
    assert out["v"][1] == 200


def payload(key="R"):
    return session_payload(round_no=1, key=key, start="2026-03-08T04:00:00Z", results=fake_results(),
                           laps=fake_laps(), weather=None, track_status=None, messages=None)


def test_checks_pass_on_good_data():
    assert check_session(payload(), expected_drivers=4) == []


def test_checks_catch_missing_drivers():
    problems = check_session(payload(), expected_drivers=22)
    assert any("only 4 drivers" in p for p in problems)


def test_checks_catch_missing_winner():
    p = payload()
    for r in p["results"]:
        r["pos"] = None if r["pos"] == 1 else r["pos"]
    assert any("P1" in x for x in check_session(p, 4))


def test_checks_catch_impossible_laps():
    p = payload()
    p["laps"]["AAA"]["t"][1] = 12.0
    assert any("impossible" in x for x in check_session(p, 4))
