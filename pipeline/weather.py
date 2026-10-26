"""Weather forecast for upcoming sessions from Open-Meteo (free, no API key).

Open-Meteo's free tier is for non-commercial use; see https://open-meteo.com.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import requests

URL = "https://api.open-meteo.com/v1/forecast"


def fetch_forecast(lat: float, lon: float, session_starts: dict[str, str]) -> dict | None:
    """Return {session_key: {rain_prob, rain_mm, temp, wind}} for sessions within 16 days."""
    params = {
        "latitude": lat, "longitude": lon,
        "hourly": "temperature_2m,precipitation_probability,precipitation,wind_speed_10m",
        "timezone": "UTC", "forecast_days": 16,
    }
    r = requests.get(URL, params=params, timeout=20)
    r.raise_for_status()
    h = r.json().get("hourly") or {}
    times = h.get("time") or []
    index = {t: i for i, t in enumerate(times)}
    out = {}
    for key, start in session_starts.items():
        dt = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(timezone.utc)
        # take the worst hour across the session (start and the next hour)
        probs, rains, temps, winds = [], [], [], []
        for offset in (0, 1):
            stamp = dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=offset)
            i = index.get(stamp.strftime("%Y-%m-%dT%H:00"))
            if i is None:
                continue
            probs.append(h["precipitation_probability"][i])
            rains.append(h["precipitation"][i])
            temps.append(h["temperature_2m"][i])
            winds.append(h["wind_speed_10m"][i])
        probs = [p for p in probs if p is not None]
        if not probs:
            continue
        out[key] = {
            "rain_prob": max(probs) / 100.0,
            "rain_mm": max(x for x in rains if x is not None) if any(x is not None for x in rains) else None,
            "temp": temps[0],
            "wind": winds[0],
        }
    return {"source": "Open-Meteo", "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M"),
            "sessions": out} if out else None
