"""Car upgrades from the FIA's "Car Presentation Submissions" document, published each race weekend.

Every team lists the parts it brings that are new for that event: the part, the main reason
(performance, with the aerodynamic aim, or reliability), what changed in shape, and a short
description in the team's own words. FastF1 has no car or upgrade data, so this is the source.

    python -m pipeline.upgrades            # fetch this season's documents that are missing

Writes site/data/events/<round>/upgrades.json:
    {"round", "event", "source", "teams": [{"team", "updates": [{"part", "reason", "change", "how"}]}]}
Teams with "no updates" are listed with an empty list. The document is published around the start
of practice 1; before that the file simply doesn't exist yet.
"""
from __future__ import annotations

import io
import logging
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone

from . import config
from .store import read_json, write_json

log = logging.getLogger("pipeline")
BASE = "https://www.fia.com/system/files/decision-document"
MAX_PER_RUN = 6                 # older weekends are back-filled a few at a time (2-3 MB each)

# FIA team names -> the names FastF1 uses for the same teams (checked in order)
TEAM_KEYS = [
    ("racing bulls", "Racing Bulls"), ("red bull", "Red Bull Racing"), ("mclaren", "McLaren"),
    ("mercedes", "Mercedes"), ("ferrari", "Ferrari"), ("williams", "Williams"), ("aston martin", "Aston Martin"),
    ("haas", "Haas F1 Team"), ("audi", "Audi"), ("sauber", "Audi"), ("alpine", "Alpine"), ("cadillac", "Cadillac"),
]


def team_name(raw: str, known: list[str] | None = None) -> str:
    low = raw.lower()
    for key, name in TEAM_KEYS:
        if key in low:
            if known:
                # use the exact spelling the site already has, when there is one
                match = next((k for k in known if key.split()[0] in k.lower()), None)
                return match or name
            return name
    return raw.strip()


def slug(event_name: str) -> str:
    s = unicodedata.normalize("NFKD", event_name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def urls(year: int, event_name: str) -> list[str]:
    s = slug(event_name)
    return [f"{BASE}/{year}_{s}_-_car_presentation_submissions.pdf",
            f"{BASE}/{year}_{s}_-_car_presentation_submissions_0.pdf"]


def _clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"(\w)- (\w)", r"\1-\2", text)       # words split at a line break
    return text


FIELDS = ["num", "part", "reason", "change", "how"]


def parse(pdf_bytes: bytes, known_teams: list[str] | None = None) -> list[dict]:
    """Teams and their updated parts, in document order."""
    import pdfplumber

    teams: list[dict] = []
    current = None
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            head = next((i for i, l in enumerate(lines) if l.lower().startswith("car presentation")), None)
            if head is not None and head + 1 < len(lines) and "submissions" not in lines[head].lower():
                current = {"team": team_name(lines[head + 1], known_teams), "updates": []}
                teams.append(current)
            if current is None:
                continue
            for table in page.find_tables():
                current["updates"] += _read_table(page, table)
    merged: dict[str, dict] = {}
    for t in teams:                    # a team heading repeated over two pages: one entry
        if t["team"] in merged:
            merged[t["team"]]["updates"] += t["updates"]
        else:
            merged[t["team"]] = t
    for t in merged.values():
        t["updates"] = [{k: _clean(u.get(k, "")) for k in ("part", "reason", "change", "how")} for u in t["updates"]]
        t["updates"] = [u for u in t["updates"] if u["part"] or u["how"]]
    return list(merged.values())


def _column_edges(table) -> list[float] | None:
    """Left edges of the part, reason, change and description columns, from the table's ruling lines."""
    xs = sorted({round(c[0]) for c in table.cells})
    groups: list[list[int]] = []
    for x in xs:
        if groups and x - groups[-1][-1] <= 8:
            groups[-1].append(x)
        else:
            groups.append([x])
    edges = [g[0] for g in groups]
    return edges[1:5] if len(edges) >= 5 else None


def _read_table(page, table) -> list[dict]:
    """One update table, read cell by cell. A cell can be merged over several parts (one reason or
    one description shared by a package of parts); its text goes to every part it spans."""
    edges = _column_edges(table)
    if not edges:
        return []                       # not an update table (one-column copies of merged cells, cover page)

    def field(x0: float) -> str:
        return FIELDS[sum(1 for e in edges if x0 >= e - 2)]

    cells = []
    for bbox in table.cells:
        # strictly inside the cell, widened a little so letters touching the cell edge aren't cut off
        box = (max(page.bbox[0], bbox[0] - 1.5), bbox[1], min(page.bbox[2], bbox[2] + 1.5), bbox[3])
        text = (page.within_bbox(box).extract_text() or "").strip()
        if text:
            cells.append((bbox, field(bbox[0]), text))
    # each numbered cell in the first column starts one part; everything above the first is the header
    items = sorted(((b, int(t)) for b, f, t in cells if f == "num" and t.isdigit()), key=lambda x: x[0][1])
    if not items:
        return []
    header_bottom = items[0][0][1]
    out = [{"part": "", "reason": "", "change": "", "how": ""} for _ in items]
    for bbox, f, text in sorted(cells, key=lambda c: (c[0][1], c[0][0])):
        if f == "num" or bbox[1] < header_bottom - 1:
            continue
        for k, (ib, _) in enumerate(items):
            overlap = min(bbox[3], ib[3]) - max(bbox[1], ib[1])
            if overlap > 3 and text not in out[k][f]:
                out[k][f] = f"{out[k][f]} {text}".strip()
    return out


def fetch(year: int, ev: dict, known_teams: list[str]) -> dict | None:
    import requests
    for url in urls(year, ev["name"]):
        try:
            r = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0 (The Pit Lane fan site)"})
        except requests.RequestException as e:
            log.warning("Upgrades %s: %s", ev["name"], e)
            return None
        if r.status_code == 200 and r.content[:4] == b"%PDF":
            teams = parse(r.content, known_teams)
            if not teams:
                log.warning("Upgrades %s: document found but no teams read", ev["name"])
                return None
            return {"round": ev["round"], "event": ev["name"], "source": url, "teams": teams}
    return None                        # not published yet


def run(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    season = read_json(config.DATA_DIR / "season.json", {}) or {}
    if season.get("sample") or not season.get("events"):
        return []
    year = season.get("year", config.SEASON)
    known = sorted({d["team"] for d in season.get("drivers", []) if d.get("team")})
    tried = 0
    found = []
    # newest first: this weekend's document matters most, older ones fill in a few per run
    for ev in sorted(season["events"], key=lambda e: -e["round"]):
        starts = [s["start"] for s in ev["sessions"] if s.get("start")]
        if not starts:
            continue
        first = datetime.fromisoformat(min(starts).replace("Z", "+00:00"))
        if now < first - timedelta(hours=6):
            continue                   # published around the start of practice 1
        path = config.DATA_DIR / "events" / str(ev["round"]) / "upgrades.json"
        if path.exists():
            continue
        if tried >= MAX_PER_RUN:
            break
        tried += 1
        data = fetch(year, ev, known)
        if data:
            write_json(path, data)
            found.append(ev["round"])
            log.info("Upgrades for round %s: %d teams", ev["round"], len(data["teams"]))
    return [f"upgrades_found={len(found)}"]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    print("\n".join(run()))
    sys.exit(0)
