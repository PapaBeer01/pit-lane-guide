"""Day-prefixed live-timing stamps (Mexico City 2026 race) must parse."""
import base64
import datetime
import json
import zlib

import pytest
import requests


def _zip(obj) -> str:
    c = zlib.compressobj(wbits=-15)
    raw = c.compress(json.dumps(obj).encode()) + c.flush()
    return '"' + base64.b64encode(raw).decode() + '"'


def _car_stream(prefix_days: bool) -> bytes:
    lines = []
    for i in range(5):
        stamp = f"1.01:46:2{i}.200" if prefix_days else f"01:46:2{i}.200"
        entry = {"Entries": [{"Utc": f"2026-11-01T21:46:2{i}.2000000Z",
                              "Cars": {"1": {"Channels": {"0": 11000, "2": 300, "3": 7, "4": 100, "5": 0, "45": 0}}}}]}
        lines.append(stamp + _zip(entry))
    return ("﻿" + "\r\n".join(lines) + "\r\n").encode("utf-8")


def _fake(monkeypatch, content: bytes):
    from fastf1.req import Cache

    def fake_request(cls, method, url, **kw):
        r = requests.Response()
        r.status_code = 200
        r._content = content
        r.url = url if isinstance(url, str) else url[0]
        return r
    monkeypatch.setattr(Cache, "_request", classmethod(fake_request))


def test_fold_helpers():
    from pipeline.ff_compat import fold_days_bytes, fold_days_str
    assert fold_days_str("1.01:46:26.2") == "25:46:26.2"
    assert fold_days_str("01:46:26.2") is None
    out = fold_days_bytes(b"\xef\xbb\xbf1.01:46:26.200{}\r\n1.01:46:27.000{}\r\n")
    assert out == b"\xef\xbb\xbf25:46:26.200{}\r\n25:46:27.000{}\r\n"
    normal = b"01:46:26.200{}\r\n"
    assert fold_days_bytes(normal) is normal


def test_to_timedelta_reads_days():
    from pipeline import ff_compat
    ff_compat.apply()
    import fastf1._api as api
    assert api.to_timedelta("1.01:46:26.2") == datetime.timedelta(days=1, hours=1, minutes=46, seconds=26.2)
    assert api.to_timedelta("01:46:26.2") == datetime.timedelta(hours=1, minutes=46, seconds=26.2)
    assert api.to_timedelta("1:23.456") == datetime.timedelta(minutes=1, seconds=23.456)


@pytest.mark.parametrize("prefix_days", [False, True])
def test_car_data_stream_with_day_prefix(monkeypatch, prefix_days):
    from pipeline import ff_compat
    ff_compat.apply()
    import fastf1._api as api
    _fake(monkeypatch, _car_stream(prefix_days))
    data = api.car_data("/static/2026/x/", livedata=None)
    assert len(data["1"]) == 5
    expect = datetime.timedelta(days=1 if prefix_days else 0, hours=1, minutes=46, seconds=20.2)
    assert data["1"]["Time"].iloc[0] == expect
