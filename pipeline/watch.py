"""Session watcher: gets results onto the site minutes after a session ends.

GitHub runs scheduled jobs late or not at all when it's busy (on 31 Oct 2026 the 20-minute
schedule actually ran every 1.5 to 4.5 hours), so results could sit unpublished for hours.
This job is started around race weekends, waits for the next session to end, then starts an
update run every few minutes until that session's results are on the site.

    python -m pipeline.watch          watch until done (used by .github/workflows/watch.yml)
    python -m pipeline.watch --plan   print what it would wait for, and stop

Only standard-library code and the `git` and `gh` command-line tools: no F1 sign-in needed here.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

from . import config

JOB_MINUTES = 330          # GitHub stops a job after 6 h; hand over to a fresh watcher well before
UPDATE_WORKFLOW = "site.yml"
SELF_WORKFLOW = "watch.yml"


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def session_end(sess: dict) -> datetime:
    return _parse(sess["start"]) + timedelta(minutes=config.SESSION_MINUTES[sess["key"]])


def pending(season: dict, now: datetime) -> list[tuple[dict, dict]]:
    """Sessions worth watching: results not on the site yet, starting within WATCH_LEAD_HOURS
    and not more than WATCH_GIVE_UP_HOURS past their scheduled end. Soonest first."""
    out = []
    for ev in season.get("events", []):
        for s in ev.get("sessions", []):
            if s.get("done") or not s.get("start") or s.get("key") not in config.SESSION_MINUTES:
                continue
            start, end = _parse(s["start"]), session_end(s)
            if start - timedelta(hours=config.WATCH_LEAD_HOURS) <= now <= end + timedelta(hours=config.WATCH_GIVE_UP_HOURS):
                out.append((ev, s))
    return sorted(out, key=lambda p: p[1]["start"])


def next_step(season: dict, now: datetime) -> tuple[str, datetime | None, str]:
    """What to do now: ("done", None, why), ("wait", until, label) or ("update", None, label)."""
    todo = pending(season, now)
    if not todo:
        return "done", None, "no session to watch"
    ev, s = todo[0]
    label = f"Round {ev['round']} {s['key']}"
    ready = session_end(s) + timedelta(minutes=config.READY_AFTER_MINUTES)
    if now < ready:
        return "wait", ready, label
    return "update", None, label


# ---------- talking to git and GitHub ----------
def _run(*cmd: str) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def latest_season() -> dict:
    """season.json as it is on GitHub right now (update runs push new data while we wait)."""
    _run("git", "fetch", "-q", "origin", "main")
    return json.loads(_run("git", "show", "origin/main:site/data/season.json"))


def update_running() -> bool:
    out = _run("gh", "run", "list", "--workflow", UPDATE_WORKFLOW, "--limit", "10", "--json", "status")
    return any(r["status"] in ("queued", "in_progress", "waiting", "pending", "requested") for r in json.loads(out))


def start_update() -> None:
    _run("gh", "workflow", "run", UPDATE_WORKFLOW, "--ref", "main", "-f", "quiet=true")


def hand_over() -> None:
    _run("gh", "workflow", "run", SELF_WORKFLOW, "--ref", "main")


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc):%H:%M:%SZ} {msg}", flush=True)


def watch() -> int:
    began = time.monotonic()
    budget = JOB_MINUTES * 60
    last_label = None
    while True:
        now = datetime.now(timezone.utc)
        try:
            season = latest_season()
        except Exception as e:  # network blip: try again shortly
            log(f"Couldn't read the latest data ({e}); retrying")
            time.sleep(60)
            continue
        action, until, label = next_step(season, now)
        if label != last_label and action != "done":
            log(f"Watching {label}")
            last_label = label
        left = budget - (time.monotonic() - began)
        if action == "done":
            log(f"Finished: {label}")
            return 0
        if left < 120:
            log("Out of time for this job: starting a fresh watcher to carry on")
            hand_over()
            return 0
        if action == "wait":
            secs = (until - now).total_seconds()
            log(f"{label} results expected from {until:%H:%MZ}; waiting")
            time.sleep(max(30, min(secs, 600, left - 90)))   # wake at least every 10 min to re-check
            continue
        if update_running():
            log("An update run is already going; checking again shortly")
        else:
            log(f"Starting an update run for {label}")
            start_update()
        time.sleep(min(config.WATCH_RETRY_MINUTES * 60, max(30, left - 90)))


def main(argv: list[str]) -> int:
    if "--plan" in argv:
        with open(config.ROOT / "site" / "data" / "season.json") as f:
            season = json.load(f)
        now = datetime.now(timezone.utc)
        action, until, label = next_step(season, now)
        print(action, label, f"until {until:%Y-%m-%d %H:%MZ}" if until else "")
        return 0
    return watch()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
