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


def test_predicted_order_follows_the_chances():
    """28 Oct: VER had a higher win and podium chance than HAM but sat below him, because the
    order used average position, which VER's bigger retirement risk pulls down."""
    from model.predict import _order
    rows = [{"code": "HAM", "avg": 5.71, "lo": 2, "hi": 6, "p_win": 0.137, "p_podium": 0.446, "p_points": 0.866},
            {"code": "VER", "avg": 5.87, "lo": 1, "hi": 7, "p_win": 0.212, "p_podium": 0.538, "p_points": 0.826},
            {"code": "ALB", "avg": 12.0, "lo": 9, "hi": 15, "p_win": 0.0, "p_podium": 0.0, "p_points": 0.30},
            {"code": "GAS", "avg": 11.0, "lo": 8, "hi": 14, "p_win": 0.0, "p_podium": 0.0, "p_points": 0.30}]
    out = _order(rows, ("p_win", "p_podium", "p_points"))
    assert [r["code"] for r in out] == ["VER", "HAM", "GAS", "ALB"]     # ties fall back to average position
    assert [r["pred"] for r in out] == [1, 2, 3, 4]
    assert all(r["lo"] <= r["pred"] <= r["hi"] for r in out)


def test_raw_simulations_are_saved_with_the_inputs(tmp_path):
    import gzip
    import json

    import numpy as np

    from model.sims import write_sims
    rng = np.random.default_rng(0)
    codes = ["AAA", "BBB", "CCC"]
    pos = np.array([rng.permutation(3) + 1 for _ in range(50)])
    raw = {"pos": pos, "grid": pos, "dnf": pos == 3, "fastest": np.zeros(50, dtype=int), "pace": rng.normal(size=(50, 3)),
           "sc": rng.random(50) < .5, "vsc": rng.random(50) < .5, "red": rng.random(50) < .1,
           "inputs": {"codes": codes, "lap_ref": 90.0, "rain": 0.1, "drivers": {c: {"team": "T"} for c in codes}}}
    pred = {"round": 3, "target": "R", "target_name": "Grand Prix", "kind": "race", "made_at": "x", "made_after": "Q"}
    write_sims(pred, raw, data_dir=tmp_path)
    rows = gzip.decompress((tmp_path / "sims" / "3" / "R.csv.gz").read_bytes()).decode().splitlines()
    assert len(rows) == 51 and rows[0].startswith("sim,safety_car,virtual_safety_car,red_flag,fastest_lap,AAA_grid")
    detail = json.loads((tmp_path / "sims" / "3" / "R_detail.json").read_text())
    assert all(abs(sum(v) - 1) < 1e-6 for v in detail["position_chances"].values())
    before = (tmp_path / "sims" / "3" / "R.csv.gz").stat().st_mtime_ns
    write_sims(pred, raw, data_dir=tmp_path)                       # same data: file untouched
    assert (tmp_path / "sims" / "3" / "R.csv.gz").stat().st_mtime_ns == before


def test_closest_simulation_prefers_the_front_of_the_order(tmp_path):
    import json

    import numpy as np

    from model.sims import compare_with_reality, write_sims
    codes = ["AAA", "BBB", "CCC", "DDD"]
    pos = np.array([[2, 1, 3, 4],     # sim 1: 2 places right, but not the winner
                    [1, 2, 4, 3],     # sim 2: front two right
                    [1, 3, 2, 4]])    # sim 3: winner and last right
    raw = {"pos": pos, "gap": np.zeros((3, 4)), "bad": np.zeros((3, 4), dtype=bool),
           "inputs": {"codes": codes, "lap_ref": 90.0, "rain": 0, "drivers": {c: {} for c in codes}}}
    pred = {"round": 1, "target": "Q", "target_name": "Qualifying", "kind": "qualifying", "made_at": "x", "made_after": "FP3"}
    write_sims(pred, raw, data_dir=tmp_path)
    session = {"results": [{"code": c, "pos": i + 1} for i, c in enumerate(codes)]}
    compare_with_reality(1, "Q", session, data_dir=tmp_path)
    v = json.loads((tmp_path / "sims" / "1" / "Q_detail.json").read_text())["vs_real"]
    assert v["best_sim"] == 2 and v["best_exact_from_front"] == 2
    assert v["share"]["winner"] == round(2 / 3, 4) and v["share"]["full"] == 0


def test_season_rate_odds_and_sprint_scaling(sample_dir):
    from model.track import LONG_RUN, season_rates, sprint_odds
    assert season_rates([]) == pytest.approx(LONG_RUN)           # no races yet: long-run average
    many = season_rates([{"vsc": 1}] * 30)
    assert many["vsc"] > 0.85 and many["sc"] < LONG_RUN["sc"]     # follows the season once there's evidence
    assert sprint_odds(0.5) < 0.5 and sprint_odds(0.0) == 0.0
    p = load(sample_dir, "predictions", "18", "R.json")
    for k in ("sc", "vsc", "red"):
        assert 0 < p["odds"][k] < 1
    assert p["track"]["season_rate"] and p["track"]["track_only"]
    sprints = [load(f.parent, f.name) for f in sample_dir.joinpath("predictions").glob("*/S.json")]
    for s in sprints:                                             # sprint odds are scaled down from the track's
        assert s["odds"]["sc"] < s["track"]["sc_prob"]


def test_tuned_params_load_and_stay_in_range():
    from model import predict as P
    from model.tune import GRID
    params = P._load_params()
    assert set(params) == set(P.DEFAULT_PARAMS)
    for k, v in params.items():
        lo, hi = min(GRID[k]), max(GRID[k])
        assert lo * P.DEFAULT_PARAMS[k] - 1e-9 <= v <= hi * P.DEFAULT_PARAMS[k] + 1e-9
