"""Provisional race statuses before Ergast has results."""
import pandas as pd

from pipeline.export import fill_race_status


def _laps():
    rows = []
    for drv, n, step in (("VER", 3, 80), ("HAM", 3, 81), ("ALB", 2, 125), ("STR", 1, 80)):
        for i in range(1, n + 1):
            rows.append({"Driver": drv, "LapNumber": i, "Time": pd.Timedelta(seconds=i * step)})
    return pd.DataFrame(rows)


def _results(status=""):
    return pd.DataFrame({"Abbreviation": ["VER", "HAM", "ALB", "STR", "BOT"],
                         "Position": [1, 2, 3, 4, None], "Status": [status] * 5})


OVER = pd.DataFrame({"Status": ["Started", "Finished", "Finalised"]})


def test_statuses_from_timing_once_race_is_over():
    out = fill_race_status(_results(), _laps(), OVER)
    assert list(out["Status"]) == ["Finished", "Finished", "Lapped", "Retired", "Did not start"]


def test_left_blank_while_race_is_running():
    out = fill_race_status(_results(), _laps(), pd.DataFrame({"Status": ["Started"]}))
    assert list(out["Status"]) == [""] * 5


def test_official_statuses_are_kept():
    res = _results("+1 Lap")
    assert fill_race_status(res, _laps(), OVER) is res


def test_quali_tie_settled_by_knockout_order():
    from pipeline.export import settle_quali_ties
    rows = [{"code": "HAD", "pos": 7, "class": "7.0", "q": [77.4, 77.0, 76.9]},
            {"code": "LIN", "pos": 8, "class": "8.0", "q": [78.2, 77.1, 77.117]},
            {"code": "LAW", "pos": 8, "class": "8.0", "q": [78.1, 77.2, 77.029]},
            {"code": "GAS", "pos": 10, "class": "10.0", "q": [78.2, 77.3, 77.153]}]
    settle_quali_ties(rows)
    assert {r["code"]: r["pos"] for r in rows} == {"HAD": 7, "LAW": 8, "LIN": 9, "GAS": 10}
    assert next(r for r in rows if r["code"] == "LIN")["class"] == "9"


def test_quali_tie_left_alone_when_next_slot_is_taken():
    from pipeline.export import settle_quali_ties
    rows = [{"code": "A", "pos": 8, "q": [1, 1, 77.0]}, {"code": "B", "pos": 8, "q": [1, 1, 77.1]},
            {"code": "C", "pos": 9, "q": [1, 1, 77.2]}]
    settle_quali_ties(rows)
    assert [r["pos"] for r in rows] == [8, 8, 9]


def test_quali_tie_uses_best_lap_when_segment_times_missing():
    from pipeline.export import settle_quali_ties
    rows = [{"code": "LIN", "pos": 8, "q": None, "best": 77.117},
            {"code": "LAW", "pos": 8, "q": [None, None, None], "best": 77.029}]
    settle_quali_ties(rows)
    assert {r["code"]: r["pos"] for r in rows} == {"LAW": 8, "LIN": 9}
