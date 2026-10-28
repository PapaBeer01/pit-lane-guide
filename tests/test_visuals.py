"""Site pictures built from saved data, and owner-supplied photos/logos."""
import json

from pipeline import config, images, visuals


def _lap(v):
    n = len(v)
    return {"d": [i * 10 for i in range(n)], "v": v, "x": list(range(n)), "y": [0] * n, "thr": [100] * n}


def test_minis_pick_the_quicker_driver_in_each_part():
    fast_first = _lap([300] * 50 + [100] * 50)
    fast_second = _lap([100] * 50 + [300] * 50)
    out = visuals.minis({"AAA": fast_first, "BBB": fast_second}, n=4)
    assert out == [0, 0, 1, 1]


def test_tyre_on_lap_counts_age_from_stint_start():
    st = [{"c": "S", "from": 1, "to": 20, "new": True, "age": 1}, {"c": "H", "from": 21, "to": 56, "new": False, "age": 4}]
    assert visuals.tyre_on_lap(st, 30) == {"c": "H", "age": 13, "new": False}
    assert visuals.tyre_on_lap(st, 99) is None


def test_outline_fits_box_and_turns():
    circ = {"x": [0, 100, 100, 0] * 5, "y": [0, 0, 50, 50] * 5, "d": list(range(20)), "rotation": 90}
    o = visuals.outline(circ, n=20)
    assert max(o["p"][0::2]) <= 100 and max(o["p"][1::2]) <= 100
    assert o["w"] < o["h"]          # a wide box turned a quarter is tall


def test_images_match_names_and_write_manifest(tmp_path, monkeypatch):
    from PIL import Image
    data = tmp_path / "data"
    data.mkdir()
    (data / "season.json").write_text(json.dumps({"drivers": [
        {"code": "VER", "name": "Max Verstappen", "last": "Verstappen", "num": "3", "team": "Red Bull Racing"},
        {"code": "LEC", "name": "Charles Leclerc", "last": "Leclerc", "num": "16", "team": "Ferrari"}]}))
    monkeypatch.setattr(config, "DATA_DIR", data)
    src = tmp_path / "images"
    for sub, name in (("drivers", "verstappen.jpg"), ("drivers", "16.png"), ("teams", "redbull.png"), ("cars", "unknown-team.png")):
        (src / sub).mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (1200, 900), "red").save(src / sub / name)
    r = images.build(src, tmp_path / "out")
    m = json.loads((tmp_path / "out" / "manifest.json").read_text())
    assert set(m["drivers"]) == {"VER", "LEC"}
    assert m["teams"]["Red Bull Racing"].startswith("img/teams/red-bull-racing.webp")
    assert r["unmatched"] == ["cars/unknown-team.png"]
    with Image.open(tmp_path / "out" / "drivers" / "VER.webp") as im:
        assert max(im.size) <= images.SIZE["drivers"][0]
