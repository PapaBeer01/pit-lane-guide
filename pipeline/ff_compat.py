"""Work-arounds for F1 live-timing data that FastF1 can't read yet.

Day-prefixed timestamps (Mexico City 2026 race)
-----------------------------------------------
F1's archive normally stamps every stream record with the time since the feed
started, as ``HH:MM:SS.mmm``. When the feed has been open for more than a day
(it was for the 2026 Mexico City race), it writes .NET-style day-prefixed
times instead, such as ``1.01:46:26.200``.

FastF1 3.9.0 can't read that format, in two ways:

* ``to_timedelta`` fails on ``1.01`` as the hour field, so the session
  times inside the timing data come out empty.
* the stream parsers cut every record at a fixed 12 characters
  (``len('00:00:00.000')``), so a 14-character day-prefixed stamp throws off
  every record after it. That gives "Couldn't parse text" and
  "failed to decode N messages", and leaves no laps, car data or positions.

``apply()`` fixes both:

1. Downloaded live-timing streams are rewritten so each leading
   ``D.HH:MM:SS.mmm`` becomes ``HH:MM:SS.mmm`` with the days folded into the
   hours (``1.01:46:26.200`` -> ``25:46:26.200``). That is 12 characters
   again, and FastF1 already reads hours above 24.
2. ``to_timedelta`` is wrapped so day-prefixed values inside a record's JSON
   are read as well.

Both are no-ops for normal data, and calling ``apply()`` more than once is safe.
"""
from __future__ import annotations

import datetime
import re

_applied = False

# a day-prefixed stamp at the start of a stream line (after an optional UTF-8 BOM)
_LINE_STAMP = re.compile(rb"(^|\r\n|\n)(\xef\xbb\xbf)?(\d{1,2})\.(\d{2}):(\d{2}:\d{2}\.\d{3})")
_DAY_PREFIX = re.compile(r"^(-?)(\d+)\.(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$")


def fold_days_bytes(raw: bytes) -> bytes:
    """``1.01:46:26.200`` at a line start -> ``25:46:26.200`` (stays 12 characters)."""
    if not _LINE_STAMP.search(raw):
        return raw

    def sub(m: re.Match) -> bytes:
        hours = int(m.group(3)) * 24 + int(m.group(4))
        if hours > 99:          # would no longer fit the fixed 12-character slice; leave it alone
            return m.group(0)
        return m.group(1) + (m.group(2) or b"") + b"%02d:" % hours + m.group(5)

    return _LINE_STAMP.sub(sub, raw)


def fold_days_str(x: str) -> str | None:
    """``1.01:46:26.2`` -> ``25:46:26.2``; None if ``x`` isn't day-prefixed."""
    m = _DAY_PREFIX.match(x.strip())
    if not m:
        return None
    sign, days, hours, minutes, seconds = m.groups()
    return f"{sign}{int(days) * 24 + int(hours)}:{minutes}:{seconds}"


def apply() -> None:
    global _applied
    if _applied:
        return
    import importlib

    import fastf1.internals.parsing_helpers as ph
    from fastf1.req import Cache

    original_td = ph.to_timedelta

    def to_timedelta(x):
        if isinstance(x, str) and ":" in x and "." in x.split(":", 1)[0]:
            folded = fold_days_str(x)
            if folded is not None:
                neg = folded.startswith("-")
                td = original_td(folded.lstrip("-"))
                return -td if (neg and td is not None) else td
        return original_td(x)

    to_timedelta.__doc__ = original_td.__doc__
    # modules bound the name at import time, so it has to be replaced in each one
    for mod_name, attr in (("fastf1.internals.parsing_helpers", "to_timedelta"),
                           ("fastf1._api", "to_timedelta"),
                           ("fastf1.core", "to_timedelta"),
                           ("fastf1.events", "to_timedelta"),
                           ("fastf1.livetiming.data", "to_timedelta"),
                           ("fastf1.utils", "_to_timedelta")):
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue
        if getattr(mod, attr, None) is original_td:
            setattr(mod, attr, to_timedelta)

    original_get = Cache.requests_get.__func__

    def requests_get(cls, url, **kwargs):
        r = original_get(cls, url, **kwargs)
        try:
            target = r.url or ""
            if "livetiming" in target and target.endswith(".jsonStream") and r.status_code == 200:
                content = r.content
                fixed = fold_days_bytes(content)
                if fixed is not content:
                    r._content = fixed
        except Exception:  # never let the work-around break a download
            pass
        return r

    Cache.requests_get = classmethod(requests_get)
    _applied = True
