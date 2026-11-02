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
