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
