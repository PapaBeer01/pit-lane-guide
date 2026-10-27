"""Scheduled update: fetch any finished sessions, check them, publish, re-run the model.

Run with:  python -m pipeline.update
Exit code is 0 even when some sessions fail checks; problems are written to
pipeline_problems.txt so the workflow can publish the good data first and then
flag the run (which makes GitHub send a failure email).
"""
from __future__ import annotations

import logging
import re
import shutil
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import config
from .checks import check_session
from .export import _sec, drivers_from_results, export_circuit, export_telemetry, session_payload
from .store import read_json, write_json

log = logging.getLogger("pipeline")
PROBLEMS_FILE = config.ROOT / "pipeline_problems.txt"
STATUS_FILE = config.ROOT / "pipeline_status.txt"     # read by the workflow: start another run while sessions wait
STATUS: dict = {}


def _iso(ts) -> str | None:
    if ts is None or pd.isna(ts):
        return None
    ts = pd.Timestamp(ts)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def build_schedule(year: int) -> list[dict]:
    import fastf1

    schedule = fastf1.get_event_schedule(year, include_testing=False)
    coords = {}
    try:
        from fastf1.ergast import Ergast
        sched = Ergast().get_race_schedule(season=year)
        for _, r in sched.iterrows():
            coords[int(r["round"])] = {"lat": float(r["lat"]), "lon": float(r["long"]),
                                       "circuit_id": str(r["circuitId"]), "country": str(r.get("country"))}
    except Exception as e:  # coordinates are only needed for the weather forecast
        log.warning("Could not load circuit coordinates: %s", e)

    events = []
    for _, ev in schedule.iterrows():
        rnd = int(ev["RoundNumber"])
        if rnd <= 0:
            continue
        sessions = []
        for i in range(1, 6):
            name = ev.get(f"Session{i}")
            if not isinstance(name, str) or name not in config.SESSION_KEYS:
                continue
            sessions.append({"key": config.SESSION_KEYS[name], "ff_name": name,
                             "start": _iso(ev.get(f"Session{i}DateUtc"))})
        c = coords.get(rnd, {})
        events.append({
            "round": rnd,
            "name": str(ev["EventName"]),
            "official": str(ev.get("OfficialEventName") or ""),
            "country": str(ev["Country"]),
            "location": str(ev["Location"]),
            "format": "sprint" if "sprint" in str(ev["EventFormat"]) else "conventional",
            "date": _iso(ev.get("EventDate")),
            "lat": c.get("lat"), "lon": c.get("lon"), "circuit_id": c.get("circuit_id"),
            "sessions": sessions,
        })
    return events


def session_due(sess: dict, now: datetime) -> bool:
    if not sess.get("start"):
        return False
    end = _parse(sess["start"]) + timedelta(minutes=config.SESSION_MINUTES[sess["key"]] + config.READY_AFTER_MINUTES)
    return now >= end


def needs_refresh(existing: dict | None, sess: dict, now: datetime) -> bool:
    """Re-load once ~12 h after a session so late penalties/corrections are picked up."""
    if existing is None:
        return True
    if existing.get("schema", 1) < config.SESSION_SCHEMA:
        return True                     # published before files recorded each driver's team: load again
    exported = existing.get("exported_at")
    if not exported or existing.get("final"):
        return False
    end = _parse(sess["start"]) + timedelta(minutes=config.SESSION_MINUTES[sess["key"]])
    return now >= end + timedelta(hours=12)


def export_session(year: int, ev: dict, sess: dict, expected: int | None, now: datetime) -> tuple[dict | None, list[str]]:
    import fastf1

    key = sess["key"]
    s = fastf1.get_session(year, ev["round"], sess["ff_name"])
    s.load(laps=True, telemetry=key in config.TELEMETRY_SESSIONS, weather=True, messages=True)
    total_laps = getattr(s, "total_laps", None)
    payload = session_payload(
        round_no=ev["round"], key=key, start=sess["start"], results=s.results, laps=s.laps,
        weather=s.weather_data, track_status=s.track_status, messages=s.race_control_messages,
        total_laps=int(total_laps) if total_laps else None,
    )
    problems = check_session(payload, expected)
    if problems:
        return None, problems

    ev_dir = config.DATA_DIR / "events" / str(ev["round"])
    if key in config.TELEMETRY_SESSIONS:
        for code in payload["laps"]:
            try:
                lap = s.laps.pick_drivers(code).pick_fastest()
                if lap is None or pd.isna(lap["LapTime"]):
                    continue
                tel = export_telemetry(lap.get_telemetry(), int(lap["LapNumber"]), _sec(lap["LapTime"]))
                if tel:
                    write_json(ev_dir / "tel" / f"{key}_{code}.json", tel)
                    payload["telemetry"].append(code)
            except Exception as e:  # one driver's telemetry missing shouldn't block the session
                log.warning("Telemetry %s %s %s: %s", ev["round"], key, code, e)

        circuit_path = ev_dir / "circuit.json"
        if not circuit_path.exists():
            try:
                ref = s.laps.pick_fastest()
                info = s.get_circuit_info()
                circ = export_circuit(ref.get_telemetry(), info.corners if info else None,
                                      info.rotation if info else None)
                if circ:
                    write_json(circuit_path, circ)
            except Exception as e:
                log.warning("Circuit map %s: %s", ev["round"], e)

    payload["schema"] = config.SESSION_SCHEMA
    payload["exported_at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    payload["final"] = now >= _parse(sess["start"]) + timedelta(hours=12)
    payload["drivers"] = drivers_from_results(s.results)
    return payload, []


def grid_size() -> int:
    """Most cars in any published race or qualifying session so far (0 if none)."""
    best = 0
    for path in (config.DATA_DIR / "events").glob("*/*.json"):
        if path.stem in config.QUALI_SESSIONS + config.RACE_SESSIONS:
            best = max(best, len((read_json(path) or {}).get("results") or []))
    return best


def sign_in() -> tuple[bool, str]:
    """Sign in to F1 TV with the F1_USERNAME / F1_PASSWORD secrets (FastF1 keeps the token for this run)."""
    import os
    if not os.environ.get("F1_USERNAME") or not os.environ.get("F1_PASSWORD"):
        return False, ("F1 TV sign-in not set up: add the F1_USERNAME and F1_PASSWORD secrets to the repository "
                       "(Settings > Secrets and variables > Actions). F1's timing data needs an F1 TV subscription.")
    try:
        from fastf1.internals.f1account import get_token, set_auth_method
        set_auth_method("password")
        get_token()
        return True, ""
    except Exception as e:  # wrong password, no subscription, F1 sign-in page changed
        return False, f"F1 TV sign-in failed ({type(e).__name__}: {e}). Check the F1_USERNAME / F1_PASSWORD secrets and the subscription."


def _subscription_summary() -> str:
    """Non-secret facts from the sign-in token (the run log of a public repo is public)."""
    try:
        from fastf1.internals.f1account import token_manager
        tok = token_manager.get_stored()
        if tok is None:
            return "no token stored"
        claims = tok.claims
        keep = {k: v for k, v in claims.items()
                if re.search(r"subscri|product|status|entitle|tier|plan", k, re.I)
                and not re.search(r"id$|email|name", k, re.I)
                and isinstance(v, (str, int, float, bool)) and "@" not in str(v)}
        exp = datetime.fromtimestamp(tok.expires_at, timezone.utc).strftime("%Y-%m-%d %H:%MZ")
        return f"token expires {exp}; subscription fields: {keep or 'none'}; all claim names: {sorted(claims)}"
    except Exception as e:
        return f"token unreadable ({type(e).__name__})"


def check_access(year: int, ev: dict, sess: dict) -> tuple[bool, str]:
    """One test request for a finished session before loading anything else.

    Signing in can succeed while F1 still refuses the timing data (e.g. a subscription tier
    without it). FastF1 then logs an error per page, signs in again after every refusal and
    tries a mirror, so ~90 sessions quickly use up its 500 calls/h. One request settles it.
    """
    import fastf1
    from fastf1 import _api
    from fastf1.req import Cache
    s = fastf1.get_session(year, ev["round"], sess["ff_name"])
    url = _api.base_url + s.api_path + _api.pages["session_info"]
    r = Cache.requests_get(url)
    log.info("Access check: HTTP %s for round %s %s; %s", r.status_code, ev["round"], sess["key"], _subscription_summary())
    if r.status_code == 403:
        return False, (f"F1's servers blocked this request (HTTP 403, before checking the sign-in) for round "
                       f"{ev['round']} {sess['key']}. Nothing was loaded this run. F1 appears to block GitHub's "
                       f"own servers (FastF1 issue #988); the workflow's Cloudflare WARP step should route around this, so check "
                       f"whether that step connected.")
    if r.status_code == 401:
        return False, (f"Signed in to F1 TV, but F1 refused the timing data (HTTP 401) for round "
                       f"{ev['round']} {sess['key']}. Nothing was loaded this run. The token was rejected: check the "
                       f"subscription. Details: {_subscription_summary()}")
    if r.status_code >= 400:
        log.warning("Access check inconclusive (HTTP %s); loading sessions anyway", r.status_code)
    return True, ""


def _is_rate_limit(e: Exception) -> bool:
    return type(e).__name__ == "RateLimitExceededError" or "calls/h" in str(e)


def run(now: datetime | None = None, year: int = config.SEASON) -> list[str]:
    import fastf1

    now = now or datetime.now(timezone.utc)
    started = time.monotonic()
    config.CACHE_DIR.mkdir(exist_ok=True)
    fastf1.Cache.enable_cache(str(config.CACHE_DIR))
    problems: list[str] = []

    season_path = config.DATA_DIR / "season.json"
    season = read_json(season_path, {}) or {}
    if season.get("sample"):
        # first real run: remove the preview sample data
        log.info("Removing sample data")
        shutil.rmtree(config.DATA_DIR)
        shutil.rmtree(config.DATA_DIR.parent / "history-sample", ignore_errors=True)
        season = {}
    elif season.get("year") and season["year"] != year:
        # new season: keep last season's files in archive/<year>, start fresh
        dest = config.ROOT / "archive" / str(season["year"])
        log.info("New season: archiving %s data to %s", season["year"], dest)
        dest.parent.mkdir(exist_ok=True)
        shutil.move(str(config.DATA_DIR), str(dest))
        season = {}
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        events = build_schedule(year)
    except Exception as e:
        problems.append(f"Schedule: {e}")
        events = season.get("events", [])
    drivers = {d["code"]: d for d in season.get("drivers", [])}
    # Expected field size: the largest grid in sessions already published. Not the number of drivers seen
    # this season: that includes reserves who stood in for one Friday practice (27 by round 18 in 2026).
    expected = grid_size() or None

    # Since October 2026, F1's timing archive needs an F1 TV sign-in. Sign in only when there is
    # something new to download, and stop early with a clear message if it fails.
    have = lambda ev, s: (config.DATA_DIR / "events" / str(ev["round"]) / f"{s['key']}.json").exists()
    due = [(ev, s) for ev in events for s in ev["sessions"]
           if session_due(s, now) and needs_refresh(read_json(config.DATA_DIR / "events" / str(ev["round"]) / f"{s['key']}.json"), s, now)]
    # Backfill is spread over runs: missing sessions before re-loads, newest first (most useful for the next race).
    batch = sorted(due, key=lambda p: (not have(*p), p[1]["start"]), reverse=True)[:config.MAX_SESSIONS_PER_RUN]
    to_load = {(ev["round"], s["key"]) for ev, s in batch}
    if len(due) > len(batch):
        log.info("%d sessions to load; loading the newest %d this run, the rest on later runs", len(due), len(batch))

    access = True
    if due:
        ok, msg = sign_in()
        if ok:
            ev0, s0 = batch[0]
            try:
                ok, msg = check_access(year, ev0, s0)
            except Exception as e:
                if _is_rate_limit(e):
                    ok, msg = False, f"FastF1's request limit is used up ({e}); the next run continues."
                else:
                    log.warning("Access check failed to run (%s: %s); loading sessions anyway", type(e).__name__, e)
        if not ok:
            access = False
            problems.append(msg)

    published = 0
    stopped = None                 # reason the run stopped loading sessions early
    empty_streak: list[str] = []   # overdue sessions that came back empty, in a row
    skipped = 0
    for ev in events:
        ev_dir = config.DATA_DIR / "events" / str(ev["round"])
        for sess in ev["sessions"]:
            path = ev_dir / f"{sess['key']}.json"
            existing = read_json(path)
            sess["done"] = existing is not None
            if (ev["round"], sess["key"]) not in to_load:
                continue
            if not access:
                continue
            if stopped:
                skipped += 1
                continue
            if time.monotonic() - started > config.MAX_RUN_MINUTES * 60:
                log.info("Time budget used; round %s %s will load on the next run", ev["round"], sess["key"])
                skipped += 1
                continue
            label = f"Round {ev['round']} {sess['key']}"
            late = now >= _parse(sess["start"]) + timedelta(hours=6)
            log.info("Loading %s", label)
            try:
                payload, errs = export_session(year, ev, sess, expected, now)
            except Exception as e:
                if _is_rate_limit(e):
                    stopped = f"FastF1's request limit was reached at {label} ({e})"
                    skipped += 1
                    continue
                payload, errs = None, [f"{label}: data not available yet ({type(e).__name__}: {e})"]
                if late:
                    empty_streak.append(label)
                    if len(empty_streak) >= config.STOP_AFTER_FAILURES:
                        stopped = (f"{', '.join(empty_streak)} all came back empty, long after the sessions ended "
                                   f"(first error: {errs[0].split(': ', 1)[1]})")
                        continue
            else:
                empty_streak = []
            if payload:
                for d in payload.pop("drivers"):
                    old = drivers.get(d["code"])
                    if not old or (old.get("as_of") or "") <= sess["start"]:
                        drivers[d["code"]] = {**d, "as_of": sess["start"]}   # newest team/colour wins
                write_json(path, payload)
                published += 1
                expected = max(expected or 0, len(payload["results"]))
                log.info("Published %s", label)
            elif late or existing is not None:
                # Not ready yet is normal for a while after the session; only report if it's been hours
                problems.extend(errs)
            sess["done"] = path.exists()

    if stopped:
        if empty_streak and "came back empty" in stopped:     # one clear message instead of one per session
            problems[:] = [p for p in problems if not any(p.startswith(l + ":") for l in empty_streak)]
        problems.append(f"Stopped loading early: {stopped}. Skipped {skipped} more session(s) to avoid hammering "
                        f"F1's servers; the next run retries. Check the 'Access check' line in the run log.")
    backlog = len(due) - len(batch) + skipped
    if backlog and not stopped:
        log.info("%d sessions left for later runs", backlog)
    STATUS.update(published=published, backlog=backlog)

    for ev in events:
        for sess in ev["sessions"]:
            if sess.get("done"):
                saved = read_json(config.DATA_DIR / "events" / str(ev["round"]) / f"{sess['key']}.json") or {}
                sess["tel"] = bool(saved.get("telemetry"))

    # Weather forecast for the next event
    nxt = next((e for e in events if not all(s.get("done") for s in e["sessions"])), None)
    fc_path = config.DATA_DIR / "events" / str(nxt["round"]) / "forecast.json" if nxt else None
    old_fc = read_json(fc_path) if fc_path else None
    fresh = old_fc and old_fc.get("fetched") and now - datetime.fromisoformat(old_fc["fetched"]).replace(tzinfo=timezone.utc) < timedelta(hours=6)
    if nxt and nxt.get("lat") is not None and not fresh:
        try:
            from .weather import fetch_forecast
            fc = fetch_forecast(nxt["lat"], nxt["lon"],
                                {s["key"]: s["start"] for s in nxt["sessions"] if not s.get("done") and s.get("start")})
            if fc:
                write_json(fc_path, fc)
        except Exception as e:
            log.warning("Forecast unavailable: %s", e)   # not a failure: keep the previous forecast

    # Older seasons (fetched once, low weight): results, then safety cars and strategies per track.
    # Uses whatever time is left in this run; the rest continues next run.
    try:
        from .history import fetch_history
        fetch_history()
    except Exception as e:
        log.warning("History unavailable: %s", e)
    try:
        from .track_history import fetch_track_history
        # shares the per-run request budget with this season's sessions
        room = min(config.MAX_HISTORY_RACES_PER_RUN, config.MAX_SESSIONS_PER_RUN - len(batch))
        if access and not stopped and not backlog and room > 0:
            fetch_track_history(deadline=started + config.MAX_RUN_MINUTES * 60, max_races=room)
    except Exception as e:
        log.warning("Track history unavailable: %s", e)

    for ev in events:
        for s in ev["sessions"]:
            s.pop("ff_name", None)
    from .roster import build_roster
    drivers = build_roster(drivers)          # current line-up, substitutes, Friday-only reserves
    write_json(season_path, {
        "year": year, "sample": False, "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "events": events, "drivers": sorted(drivers.values(), key=lambda d: (d["team"], d["code"])),
    }, compact=False)

    from model.run import run_model
    problems.extend(run_model(now=now))
    return problems


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    problems = run()
    # "more" = sessions are still waiting and this run made progress, so another run is worth starting now
    more = STATUS.get("backlog", 0) > 0 and STATUS.get("published", 0) > 0
    STATUS_FILE.write_text(f"published={STATUS.get('published', 0)}\nbacklog={STATUS.get('backlog', 0)}\nmore={str(more).lower()}\n")
    if problems:
        PROBLEMS_FILE.write_text("\n".join(problems) + "\n")
        for p in problems:
            log.error(p)
    elif PROBLEMS_FILE.exists():
        PROBLEMS_FILE.unlink()
    sys.exit(0)


if __name__ == "__main__":
    main()
