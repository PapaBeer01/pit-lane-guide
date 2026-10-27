"""Which data routes work from here? A one-off check, run by .github/workflows/probe.yml.

    python -m pipeline.probe <label>      e.g. "direct" or "warp"

Asks for the latest finished 2026 race in several ways and appends a table to
probe-results.md (and the run summary). Only status codes, row counts and the
network's owner are written: never the token, the login or any personal data
(this repo and its logs are public).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "probe-results.md"
TIMEOUT = 20
LIVETIMING = "https://livetiming.formula1.com"
MIRROR = "https://livetiming-mirror.fastf1.dev"
OPENF1 = "https://api.openf1.org/v1"
UA = {"User-Agent": "pit-lane-guide probe (github.com/PapaBeer01/pit-lane-guide)"}


def _get(url, **kw):
    try:
        r = requests.get(url, timeout=TIMEOUT, headers={**UA, **kw.pop("headers", {})}, **kw)
        return r, ""
    except Exception as e:
        return None, f"{type(e).__name__}"


def _edge(r) -> str:
    """Who answered: CloudFront's own block page vs F1's sign-in check."""
    if r is None:
        return ""
    bits = [r.headers.get("x-cache", ""), r.headers.get("server", "")]
    if b"Request blocked" in r.content[:2000]:
        bits.append("'Request blocked' page")
    return "; ".join(b for b in bits if b)


def network() -> str:
    r, err = _get("https://ipinfo.io/json")
    if r is None or r.status_code != 200:
        return f"unknown ({err or r.status_code})"
    d = r.json()
    return f"{d.get('org', '?')} ({d.get('country', '?')})"


def latest_race(year: int) -> tuple[str, str]:
    """(label, api_path) of the latest finished race, from FastF1's schedule."""
    import fastf1
    sched = fastf1.get_event_schedule(year, include_testing=False)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    done = sched[sched["Session5DateUtc"] < now]
    ev = done.iloc[-1]
    path = fastf1.get_session(year, int(ev["RoundNumber"]), "Race").api_path
    return f"{year} round {int(ev['RoundNumber'])} {ev['EventName']} race", path


def token() -> str | None:
    if not os.environ.get("F1_USERNAME"):
        return None
    try:
        from fastf1.internals.f1account import get_token, set_auth_method
        set_auth_method("password")
        return get_token().value          # reuses the stored token if the job already signed in
    except Exception:
        return None


def row(check, r, err="", note=""):
    status = str(r.status_code) if r is not None else f"no answer ({err})"
    return f"| {check} | {status} | {note or _edge(r)} |"


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "direct"
    rows = []
    try:
        race, path = latest_race(2026)
    except Exception as e:
        race, path = f"schedule failed ({type(e).__name__})", None
    tok = token()
    auth = {"Authorization": f"Bearer {tok}"} if tok else {}

    if path:
        url = f"{LIVETIMING}{path}SessionInfo.jsonStream"
        rows.append(row("F1 archive, no token", *_get(url)))
        if tok:
            rows.append(row("F1 archive, with your token", *_get(url, headers=auth)))
            r, err = _get(f"{LIVETIMING}{path}TimingData.jsonStream", headers=auth)
            rows.append(row("F1 archive lap timing, with token", r, err,
                            f"{len(r.content) // 1024} KB" if r is not None and r.status_code == 200 else ""))
        else:
            rows.append("| F1 archive, with your token | skipped | F1 sign-in failed or not set up |")
        rows.append(row("FastF1 mirror", *_get(f"{MIRROR}{path}SessionInfo.jsonStream")))

    neg = f"{LIVETIMING}/signalrcore/negotiate?negotiateVersion=1"
    for name, h in (("Live feed sign-up, no token", {}), ("Live feed sign-up, with token", auth)):
        if h is auth and not tok:
            continue
        try:
            r = requests.post(neg, headers={**UA, **h}, timeout=TIMEOUT)
            rows.append(row(name, r))
        except Exception as e:
            rows.append(row(name, None, type(e).__name__))

    r, err = _get(f"{OPENF1}/sessions", params={"year": 2026, "session_name": "Race"})
    if r is not None and r.status_code == 200:
        races = [s for s in r.json() if s.get("date_end", "") < datetime.now(timezone.utc).isoformat()]
        last = races[-1] if races else None
        note = f"{len(races)} finished races; latest {last['location']} {last['date_start'][:10]}" if last else "no races"
        rows.append(row("OpenF1 2026 races", r, note=note))
        if last:
            for ep in ("laps", "stints", "session_result", "race_control"):
                r2, err2 = _get(f"{OPENF1}/{ep}", params={"session_key": last["session_key"]})
                n = len(r2.json()) if r2 is not None and r2.status_code == 200 else 0
                rows.append(row(f"OpenF1 {ep} (latest race)", r2, err2, f"{n} rows"))
    else:
        rows.append(row("OpenF1 2026 races", r, err))

    r, err = _get("https://api.jolpi.ca/ergast/f1/2026/last/results.json")
    n = 0
    if r is not None and r.status_code == 200:
        races = r.json()["MRData"]["RaceTable"]["Races"]
        n = f"round {races[0]['round']}, {len(races[0]['Results'])} results" if races else "no results"
    rows.append(row("Jolpica results (latest)", r, err, str(n)))

    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    block = "\n".join([f"## Route: {label}", "", f"{when}. Network: {network()}. Race: {race}.", "",
                       "| Check | HTTP | Notes |", "|---|---|---|", *rows, ""])
    print(block)
    with RESULTS.open("a") as f:
        f.write(block + "\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(block + "\n")


if __name__ == "__main__":
    main()
