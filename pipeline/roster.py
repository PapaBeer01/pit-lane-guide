"""Who is on the grid now, who raced earlier in the season, and who only drove on Fridays.

Built from the published session files, so substitutions are handled as they happened, e.g.
a reserve standing in for one team while that team's regular driver moved up to cover an
injury at another. Fields added to each driver in season.json:

  team, color    the team they last raced for (Friday-practice teams only if they never raced)
  teams          every team they raced for this season, in order
  race_rounds    rounds where they took part in qualifying, a sprint or the race
  stints         [{team, from, to}] in order, e.g. Racing Bulls 1-11, Red Bull 12-14, Racing Bulls 15-18
  current        in the most recent race weekend's line-up
"""
from __future__ import annotations

from . import config
from .store import read_json

RACE_KEYS = ("SQ", "S", "Q", "R")
ALL_KEYS = ("FP1", "FP2", "FP3", "SQ", "S", "Q", "R")


def build_roster(drivers: dict[str, dict], data_dir=None) -> dict[str, dict]:
    data_dir = data_dir or config.DATA_DIR
    events_dir = data_dir / "events"
    rounds = sorted(int(p.name) for p in events_dir.iterdir() if p.name.isdigit()) if events_dir.exists() else []
    out = {c: {**d} for c, d in drivers.items()}
    raced: dict[str, list[int]] = {}
    round_team: dict[str, dict[int, str]] = {}               # code -> round -> team raced for
    race_team: dict[str, tuple[str, str | None]] = {}       # latest (team, colour) in a race session
    teams: dict[str, list[str]] = {}
    latest_lineup: list[str] = []
    for rnd in rounds:
        lineup_here: list[str] = []
        for key in ALL_KEYS:
            sess = read_json(events_dir / str(rnd) / f"{key}.json")
            if not sess:
                continue
            for r in sess.get("results", []):
                code = r["code"]
                d = out.setdefault(code, {"code": code, "name": code, "team": r.get("team") or "", "color": r.get("color") or "#888888"})
                team = r.get("team") or d.get("team") or ""
                if key in RACE_KEYS:
                    if rnd not in raced.setdefault(code, []):
                        raced[code].append(rnd)
                    race_team[code] = (team, r.get("color") or d.get("color"))
                    if team:
                        round_team.setdefault(code, {})[rnd] = team
                    if team and team not in teams.setdefault(code, []):
                        teams[code].append(team)
            if key in RACE_KEYS and sess.get("results"):
                lineup_here = [r["code"] for r in sess["results"]]
        if lineup_here:
            latest_lineup = lineup_here
    for code, d in out.items():
        if code in race_team:
            d["team"], d["color"] = race_team[code][0] or d.get("team", ""), race_team[code][1] or d.get("color")
        d["teams"] = teams.get(code, [])
        d["race_rounds"] = raced.get(code, [])
        d["current"] = code in latest_lineup
        stints: list[dict] = []
        for rnd, team in sorted(round_team.get(code, {}).items()):
            if stints and stints[-1]["team"] == team:
                stints[-1]["to"] = rnd
            else:
                stints.append({"team": team, "from": rnd, "to": rnd})
        d["stints"] = stints
    return out
