"""Reading and writing the published JSON files safely."""
from __future__ import annotations

import json
import os
from pathlib import Path

from .export import clean_float

# Timestamps that change on every run. A file whose only change is one of these is
# left alone, so the repository only gets a commit when something real changed.
VOLATILE_KEYS = {"updated", "made_at", "fetched", "exported_at"}


def _strip(data):
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k not in VOLATILE_KEYS}
    return data


def write_json(path: Path, data, compact: bool = True) -> bool:
    """Write atomically (a crash mid-write never leaves a half-written file).

    Returns False and leaves the file untouched when nothing but timestamps changed.
    """
    data = clean_float(data)
    existing = read_json(path)
    if existing is not None and _strip(existing) == _strip(json.loads(json.dumps(data))):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)
    return True


def read_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default
