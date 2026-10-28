"""Driver photos, team logos and car pictures supplied by the site owner.

Put files in the repo's images/ folder (any of .jpg .jpeg .png .webp .svg):
  images/drivers/  named by driver code, surname, full name or car number  (VER.jpg, verstappen.png, 1.webp)
  images/helmets/  named like the driver photos                           (VER.png)
  images/teams/    named by team                                           (ferrari.png, red-bull-racing.svg)
  images/cars/     named by team, like the logos                           (mclaren.png)

This turns them into small web files under site/img/ (built on every run, not saved in the repo)
and writes site/img/manifest.json, which the site reads so it only asks for pictures that exist.
Anything missing keeps the site's own helmet and badge drawings.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import unicodedata
from pathlib import Path

from . import config
from .store import read_json

log = logging.getLogger(__name__)

SRC = config.ROOT / "images"
OUT = config.SITE_DIR / "img"
EXT = {".jpg", ".jpeg", ".png", ".webp", ".svg"}
# longest side in pixels, and WebP quality: photos stay around 15-40 KB on a phone
SIZE = {"drivers": (560, 80), "helmets": (420, 82), "teams": (320, 90), "cars": (1000, 78)}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# older or sponsor names people often use for files
ALIASES = {"racingbulls": {"rb", "vcarb", "visacashapp", "visacashapprb", "alphatauri", "tororosso"},
           "audi": {"sauber", "kicksauber", "stake", "stakef1"}, "mercedes": {"amg", "mercedesamg"},
           "redbullracing": {"redbull", "rbr", "oracleredbull"}, "haasf1team": {"haas", "moneygramhaas"},
           "astonmartin": {"amr", "aramco"}, "alpine": {"bwtalpine"}, "williams": {"atlassianwilliams"},
           "cadillac": {"cadillacf1"}}
TEAM_WORDS = ("f1team", "formula1team", "formulaoneteam", "racing", "team", "scuderia", "f1")


def team_keys(team: str) -> set[str]:
    """Ways a file for this team might be named: 'red-bull-racing', 'redbull', 'ferrari', 'haas'..."""
    n = norm(team)
    keys = {n}
    for w in TEAM_WORDS:
        if n.endswith(w) and len(n) > len(w) + 2:
            keys.add(n[: -len(w)])
        if n.startswith(w) and len(n) > len(w) + 2:
            keys.add(n[len(w):])
    words = [norm(w) for w in re.split(r"\s+", team) if norm(w) not in TEAM_WORDS and norm(w)]
    if words:
        keys.add(words[0] if len(words[0]) > 3 else "".join(words))
        keys.add("".join(words))
    keys |= ALIASES.get(n, set())
    return {k for k in keys if len(k) >= 2}


def driver_keys(d: dict) -> set[str]:
    keys = {norm(d.get("code", ""))}
    if d.get("last"):
        keys.add(norm(d["last"]))
    if d.get("name"):
        keys.add(norm(d["name"]))
    if d.get("num"):
        keys.add(str(d["num"]))
    return {k for k in keys if k}


def match(stem: str, candidates: dict[str, set[str]]) -> str | None:
    """Exact key match first, then the longest key the file name starts with."""
    s = norm(stem)
    exact = [c for c, ks in candidates.items() if s in ks]
    if len(exact) == 1:
        return exact[0]
    best, best_len = None, 0
    for c, ks in candidates.items():
        for k in ks:
            if len(k) >= 4 and (s.startswith(k) or k.startswith(s) and len(s) >= 4) and len(k) > best_len:
                best, best_len = c, len(k)
    return best


def convert(src: Path, dst_dir: Path, name: str, kind: str) -> str:
    """Write a small .webp (or copy an .svg). Returns the published file name."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() == ".svg":
        out = dst_dir / f"{name}.svg"
        shutil.copyfile(src, out)
        return out.name
    from PIL import Image, ImageOps
    side, q = SIZE[kind]
    im = ImageOps.exif_transpose(Image.open(src))
    im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") or "transparency" in im.info else im.convert("RGB")
    if im.mode == "RGBA":
        bbox = im.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()   # trim near-transparent margins
        if bbox:
            im = im.crop(bbox)
    im.thumbnail((side, side), Image.LANCZOS)
    out = dst_dir / f"{name}.webp"
    im.save(out, "WEBP", quality=q, method=6)
    return out.name


def build(src: Path = SRC, out: Path = OUT) -> dict:
    season = read_json(config.DATA_DIR / "season.json") or {}
    drivers = {d["code"]: driver_keys(d) for d in season.get("drivers", [])}
    teams = {}
    for d in season.get("drivers", []):
        for t in [d.get("team"), *(d.get("teams") or [])]:
            if t:
                teams[t] = team_keys(t)
    manifest: dict = {"drivers": {}, "helmets": {}, "teams": {}, "cars": {}}
    unmatched = []
    if out.exists():
        shutil.rmtree(out)
    for kind, cands in (("drivers", drivers), ("helmets", drivers), ("teams", teams), ("cars", teams)):
        folder = src / kind
        if not folder.is_dir():
            continue
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() not in EXT or f.name.startswith("."):
                continue
            who = match(f.stem, cands)
            if not who:
                unmatched.append(f"{kind}/{f.name}")
                continue
            if who in manifest[kind]:
                continue
            try:
                name = convert(f, out / kind, who if kind in ("drivers", "helmets") else slug(who), kind)
            except Exception as e:
                log.warning("Picture %s skipped: %s", f.name, e)
                unmatched.append(f"{kind}/{f.name}")
                continue
            ver = hashlib.md5((out / kind / name).read_bytes()).hexdigest()[:8]
            manifest[kind][who] = f"img/{kind}/{name}?v={ver}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":"), ensure_ascii=False))
    counts = {k: len(v) for k, v in manifest.items()}
    return {**counts, "unmatched": unmatched}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    r = build()
    print(f"Pictures ready: {r['drivers']} drivers, {r['helmets']} helmets, {r['teams']} team logos, {r['cars']} cars.")
    for u in r["unmatched"]:
        print(f"Couldn't tell who this is, rename it: images/{u}")
