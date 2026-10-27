"""FIA car-upgrade documents: parsing a real one (Austin 2026), names and addresses."""
from datetime import datetime, timezone
from pathlib import Path

from pipeline import config, upgrades
from pipeline.store import read_json, write_json

FIXTURE = Path(__file__).parent / "fixtures" / "fia_upgrades_2026_united_states.pdf"
KNOWN = ["Alpine", "Aston Martin", "Audi", "Cadillac", "Ferrari", "Haas F1 Team", "McLaren", "Mercedes",
         "Racing Bulls", "Red Bull Racing", "Williams"]


def test_parses_every_team_and_part():
    teams = upgrades.parse(FIXTURE.read_bytes(), KNOWN)
    counts = {t["team"]: len(t["updates"]) for t in teams}
    assert counts == {"McLaren": 3, "Mercedes": 0, "Red Bull Racing": 2, "Ferrari": 4, "Williams": 0, "Racing Bulls": 4,
                      "Aston Martin": 0, "Haas F1 Team": 0, "Audi": 3, "Alpine": 2, "Cadillac": 2}
    for t in teams:
        for u in t["updates"]:
            assert u["part"] and u["reason"] and u["change"] and u["how"]
            assert not u["how"].rstrip(".").endswith(("Local Load", "Flow Conditioning"))   # no stray cells glued on


def test_merged_cells_are_shared_by_every_part_they_cover():
    """Ferrari's floor body, floor board and sidepod inlet were one package with one reason and description."""
    fer = next(t for t in upgrades.parse(FIXTURE.read_bytes(), KNOWN) if t["team"] == "Ferrari")
    parts = {u["part"]: u for u in fer["updates"]}
    assert set(parts) == {"Floor Body", "Floor Board", "Sidepod Inlet / Coke", "Diffuser"}
    assert parts["Floor Board"]["reason"] == parts["Floor Body"]["reason"] != ""
    assert parts["Diffuser"]["how"].startswith("Benefitting from improved onset flow quality, the diffuser")


def test_a_description_mentioning_components_is_not_a_header():
    rb = next(t for t in upgrades.parse(FIXTURE.read_bytes(), KNOWN) if t["team"] == "Racing Bulls")
    assert [u["part"] for u in rb["updates"]] == ["Front Wing", "Rear Wing", "Floor Body", "Coke/Engine Cover"]


def test_team_names_and_addresses():
    assert upgrades.team_name("Visa Cash App Racing Bulls", KNOWN) == "Racing Bulls"
    assert upgrades.team_name("Oracle Red Bull Racing", KNOWN) == "Red Bull Racing"
    assert upgrades.team_name("TGR HAAS F1 TEAM", KNOWN) == "Haas F1 Team"
    assert upgrades.slug("São Paulo Grand Prix") == "sao_paulo_grand_prix"
    assert upgrades.urls(2026, "Mexico City Grand Prix")[0].endswith(
        "/2026_mexico_city_grand_prix_-_car_presentation_submissions.pdf")


def test_run_fetches_this_weekend_first_and_skips_future_ones(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    ev = lambda r, day: {"round": r, "name": f"Test {r} Grand Prix", "sessions": [{"key": "FP1", "start": f"2026-10-{day}T18:30:00Z"}]}  # noqa: E731
    write_json(tmp_path / "season.json", {"year": 2026, "events": [ev(1, 10), ev(2, 24), ev(3, 31)], "drivers": []})
    asked = []
    monkeypatch.setattr(upgrades, "fetch", lambda y, e, k: asked.append(e["round"]) or {"round": e["round"], "teams": []})
    upgrades.run(now=datetime(2026, 10, 27, tzinfo=timezone.utc))
    assert asked == [2, 1]                                   # newest first; round 3 hasn't started
    assert read_json(tmp_path / "events" / "2" / "upgrades.json")["round"] == 2
    asked.clear()
    upgrades.run(now=datetime(2026, 10, 27, tzinfo=timezone.utc))
    assert asked == []                                       # saved once, not fetched again
