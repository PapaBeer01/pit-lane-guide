"""Model tests on a generated sample season in a temporary folder (never touches site/data)."""
import json

import pytest

from pipeline import config


@pytest.fixture(scope="module")
def sample_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    old = config.DATA_DIR
    config.DATA_DIR = d
    try:
        from model.run import run_model
        from pipeline.sample import generate
        now = generate()
        problems = run_model(now=now)
        assert problems == []
        yield d
    finally:
        config.DATA_DIR = old


def load(d, *parts):
    return json.loads((d.joinpath(*parts)).read_text())


def test_probabilities_are_valid(sample_dir):
    p = load(sample_dir, "predictions", "18", "R.json")
    assert len(p["drivers"]) == 22
    assert sum(d["p_win"] for d in p["drivers"]) == pytest.approx(1.0, abs=0.01)
    assert sum(d["p_podium"] for d in p["drivers"]) == pytest.approx(3.0, abs=0.05)
    assert sum(d["p_fastest"] for d in p["drivers"]) == pytest.approx(1.0, abs=0.01)
    for d in p["drivers"]:
        assert 0 <= d["p_finish"] <= 1
        assert d["lo"] <= d["pred"] <= d["hi"]
    assert sorted(d["pred"] for d in p["drivers"]) == list(range(1, 23))


def test_qualifying_prediction(sample_dir):
    q = load(sample_dir, "predictions", "18", "Q.json")
    assert sum(d["p_pole"] for d in q["drivers"]) == pytest.approx(1.0, abs=0.01)
    assert sum(d["p_top10"] for d in q["drivers"]) == pytest.approx(10.0, abs=0.1)


def test_upcoming_predictions_not_frozen_past_ones_frozen(sample_dir):
    assert load(sample_dir, "predictions", "18", "R.json")["frozen"] is False
    assert load(sample_dir, "predictions", "17", "R.json")["frozen"] is True


def test_no_future_data_leaks_into_backtests(sample_dir):
    from model.data import SeasonData
    data = SeasonData(sample_dir)
    ev = data.event(10)
    past, weekend = data.before(ev, "Q")
    assert all(r < 10 for r, _, _ in past)
    assert [k for _, k, _ in weekend] == ["FP1", "FP2", "FP3"]


def test_accuracy_is_reasonable(sample_dir):
    a = load(sample_dir, "accuracy.json")
    assert a["overall"]["qualifying"]["in_range"] > 0.5
    assert a["overall"]["race"]["in_range"] > 0.5
    assert all(s["note"] for s in a["sessions"])


def test_standings_add_up(sample_dir):
    s = load(sample_dir, "standings.json")
    assert s["drivers"][0]["points"] >= s["drivers"][1]["points"]
    assert sum(d["points"] for d in s["drivers"]) == pytest.approx(sum(t["points"] for t in s["teams"]))


def test_reliability_classification():
    from model.reliability import classify
    assert classify({"code": "AAA", "status": "Finished", "class": "1", "laps": 57}, {}) == "finished"
    assert classify({"code": "AAA", "status": "+1 Lap", "class": "12", "laps": 56}, {}) == "finished"
    assert classify({"code": "AAA", "status": "Disqualified", "class": "D", "laps": 57}, {}) == "exclude"
    assert classify({"code": "AAA", "status": "Collision", "class": "R", "laps": 3}, {}) == "incident"
    assert classify({"code": "AAA", "status": "Retired", "class": "R", "laps": 30}, {"AAA": [30]}) == "incident"
    assert classify({"code": "AAA", "status": "Retired", "class": "R", "laps": 30}, {}) == "mech"


def test_form_record(sample_dir):
    f = load(sample_dir, "form.json")
    assert len(f["drivers"]) == 22 and len(f["rounds"]) == 6
    ok = {"ok", "issue", "under", "notime", "tech", "crash", "dnf"}
    for d in f["drivers"]:
        assert 0 < d["quali_fail"] < 1
        for ev in d["events"]:
            assert set(ev["s"].values()) <= ok


def test_quali_status_flags_underperformance():
    from model.form import _quali_status
    practice = [{"key": "FP3", "results": [{"code": c, "best": 80 + i * 0.1} for i, c in enumerate("ABCDEFGH")],
                 "best_sectors": {}}]
    quali = {"key": "Q", "results": [{"code": c, "pos": p, "q": [80.0, None, None]} for c, p in
                                     zip("BCDEFGHA", range(1, 9))]}
    quali["results"][-1]["q"] = [80.0, None, None]
    st = _quali_status(quali, practice)
    assert st["A"] == "under"            # quickest in practice, last in qualifying
    assert st["B"] == "ok"


def test_strategy_and_track_odds(sample_dir):
    p = load(sample_dir, "predictions", "18", "R.json")
    st, tr = p["strategy"], p["track"]
    assert abs(sum(st["stops"].values()) - 1) < 0.01
    for plan in st["plans"]:
        assert sum(plan["stints"]) == st["laps"]
        assert len(set(plan["seq"])) >= 2                # two different dry compounds
        assert len(plan["windows"]) == plan["stops"]
    for k in ("sc_prob", "vsc_prob", "red_prob"):
        assert 0 < tr[k] < 1
    acc = load(sample_dir, "accuracy.json")
    s = [x["strategy"] for x in acc["sessions"] if x.get("strategy")]
    assert s and all(len(x["pred_seq"].split("-")) - 1 == x["pred_stops"] for x in s)


def test_flags_from_messages():
    import pandas as pd
    from pipeline.track_history import flags_from_messages
    msgs = pd.DataFrame({"Message": ["SAFETY CAR DEPLOYED", "VIRTUAL SAFETY CAR DEPLOYED", "RED FLAG", "TRACK CLEAR"],
                         "Category": ["SafetyCar", "SafetyCar", "Flag", "Flag"], "Flag": [None, None, "RED", "CLEAR"],
                         "Scope": [None, None, "Track", "Track"], "Lap": [1, 20, 30, 31]})
    f = flags_from_messages(msgs)
    assert (f["sc"], f["vsc"], f["red"]) == (1, 1, 1) and f["sc_laps"] == [1]


def test_strategy_planner_prefers_one_stop_with_hard_tyres():
    from model.strategy import plan_times
    tm = {"S": {"offset": 0.0, "deg": 0.12}, "M": {"offset": 0.45, "deg": 0.05}, "H": {"offset": 0.85, "deg": 0.02}}
    plans = sorted(plan_times(tm, 57, 23.0), key=lambda p: p["time"])
    assert plans[0]["stops"] == 1 and "H" in plans[0]["seq"]


def test_race_pace_report(sample_dir):
    p = load(sample_dir, "events", "17", "R_pace.json")
    gaps = [r["gap"] for r in p["pace"]]
    assert gaps[0] == 0 and gaps == sorted(gaps)
    assert [r["rank"] for r in p["pace"]] == list(range(1, len(gaps) + 1))
    for stints in p["stints"].values():
        assert all(s["laps"] >= 3 and s["c"] in "SMHIW" for s in stints)


def test_practice_long_runs_ignore_the_unreliable_accurate_flag():
    """Austin FP2 2026: Norris's 8-lap run on hards was mostly flagged 'not accurate'."""
    from model.pace import practice_pace_report

    def driver(base, run_ok):
        # out lap, push lap, cool-down, then a long run of 8 laps, then in lap
        t = [None, base - 5, base + 60] + [base + 0.1 * i for i in range(8)] + [base + 25]
        n = list(range(1, len(t) + 1))
        return {"n": n, "t": t, "c": ["H"] * len(t), "l": n, "p": [None] * len(t),
                "pi": [0] * (len(t) - 1) + [1], "po": [1] + [0] * (len(t) - 1),
                "ok": [0, 1, 1] + run_ok + [0], "ts": ["1"] * len(t), "st": [0.0] * len(t)}
    laps = {"AAA": driver(100.0, [0] * 8), "BBB": driver(100.5, [1, 0, 1, 0, 1, 0, 1, 0]), "CCC": driver(101.0, [1] * 8)}
    sess = {"round": 1, "key": "FP2", "laps": laps, "results": []}
    rep = practice_pace_report(sess)
    assert [p["code"] for p in rep["pace"]] == ["AAA", "BBB", "CCC"]
    assert all(p["run_laps"] == 8 for p in rep["pace"])          # cool-down lap ends the run, not the flag
    assert abs(rep["pace"][1]["gap"] - 0.5) < 0.05


def test_sunday_trait_compares_with_the_teammate():
    from model.run import sunday_trait

    class Data:
        events = [{"round": r} for r in range(1, 7)]

        def team_at(self, code, rnd):
            return "T"

        def session(self, rnd, key):
            res = [{"code": "RAC", "pos": 1, "grid": 2, "class": "1", "best": 90.3, "q": [90.3]},
                   {"code": "QUA", "pos": 2, "grid": 1, "class": "2", "best": 90.0, "q": [90.0]}]
            if key == "Q":
                return {"key": "Q", "results": res}
            return {"key": "R", "results": res, "laps": {}}
    import model.run as run
    # race pace: RAC 0.3% quicker than QUA on Sundays although 0.3% slower in qualifying
    orig = run.race_pace_gaps
    run.race_pace_gaps = lambda s: {"RAC": 0.0, "QUA": 0.3}
    try:
        t_rac, t_qua = sunday_trait(Data(), "RAC"), sunday_trait(Data(), "QUA")
    finally:
        run.race_pace_gaps = orig
    assert t_rac["label"] == "sunday" and t_qua["label"] == "saturday"
    assert t_rac["gained"] == 1.0 and t_rac["race_vs_mate"] == [6, 0]
    assert t_rac["delta"] == -t_qua["delta"]
