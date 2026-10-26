# Pit Lane Guide

A free, self-updating Formula 1 site for new fans: every session's results, predictions for qualifying, sprints and Grand Prix, a driver-vs-driver lap comparison, a form guide, standings, and an honest accuracy record.

It runs entirely on free GitHub services: **$0 to host, $0 to update**.

## How it works

```
Every 20 min on race weekends (every 6 h otherwise), GitHub Actions:
  1. checks the F1 calendar for sessions that have finished
  2. downloads them with FastF1, runs safety checks, saves compact JSON
  3. re-runs the prediction model, locks predictions for sessions that have started,
     scores finished ones, updates standings, reliability and the form guide
  4. commits the new data and publishes the site to GitHub Pages
```

- **No server.** The site is static files; visitors never wait for FastF1.
- **Safe by default.** A session that fails its checks (missing drivers, no winner yet, impossible lap times) isn't published. The site keeps the last good data and GitHub emails you if the problem lasts more than 6 hours.
- **Late corrections.** Each session is re-loaded once about 12 hours later to pick up penalties.
- **Only real changes are committed**, so the repository stays small.

## Put it online (about 15 minutes, no coding)

1. **Create a free GitHub account** at github.com if you don't have one.
2. **Create a new repository**: click **+ → New repository**, name it (for example `pit-lane-guide`), set it to **Public** (public repositories get unlimited free automation minutes), and click **Create repository**.
3. **Add these files** to the repository. The easiest options:
   - Ask Claude to push them for you (give it the repository name), or
   - Use **Add file → Upload files** and drag in everything from this folder, including the hidden `.github` folder. If your computer hides it, create it on GitHub instead: **Add file → Create new file**, type `.github/workflows/site.yml` as the name, and paste in the contents of that file.
4. **Turn on GitHub Pages**: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Run the first update**: open the **Actions** tab, enable workflows if asked, choose **Update data and publish site**, then click **Run workflow**.
   The first run downloads the season so far. Each run stops starting new downloads after 35 minutes, so it can take two or three runs (they happen automatically every 20 minutes over a race weekend, or click **Run workflow** again).
6. **Visit your site** at `https://<your-username>.github.io/<repository-name>/`.

From then on it updates itself. A free address like this costs nothing; you can add your own domain later in **Settings → Pages** (about $10–15 a year) if you want one.

### Once a year

When a new season starts, open `.github/workflows/site.yml` and change `F1_SEASON: "2026"` to the new year. The previous season's data is moved to `archive/` automatically.

### If the schedule stops

GitHub pauses scheduled workflows in repositories with no activity for 60 days, which can happen over the winter break. If the site stops updating, open **Actions** and click **Enable workflow**.

## Preview locally with sample data

```bash
pip install -r requirements.txt
python -m pipeline.sample          # simulated season, clearly labelled as sample data
python -m http.server -d site 8000 # then open http://localhost:8000
pytest -q                          # 20 tests, no internet needed
```

The first real update deletes the sample data automatically.

## What's inside

| Folder | What it does |
|---|---|
| `pipeline/` | FastF1 download and export (`export.py`), safety checks (`checks.py`), scheduled update (`update.py`), weather (`weather.py`), pre-2026 history (`history.py`), sample data (`sample.py`), settings (`config.py`) |
| `model/` | Pace extraction (`features.py`), predictions and simulation (`predict.py`), form / trouble record (`form.py`), reliability (`reliability.py`), accuracy scoring (`score.py`), orchestration (`run.py`) |
| `site/` | The website (plain HTML, CSS and JavaScript, no build step) and `site/data/` (published JSON) |
| `tests/` | Pipeline, model and full-update tests (the update test uses a fake FastF1, so no internet is needed) |
| `.github/workflows/site.yml` | The schedule that keeps everything updated |

## The prediction model (v1.1)

1. **Season form:** each driver's 2026 one-lap and race pace, recent rounds counting more. Pre-2026 seasons count at low weight, and only for things that carry over between rule sets (track and driver traits), never car pace.
2. **This weekend:** every finished session adds evidence with its own noise level. Practice counts a little (hidden fuel loads), sprint sessions a lot.
3. **Form / trouble record:** each driver's and team's history of lost practice running, bad qualifying sessions and retirements. It gives each driver a matching chance of a bad session in every simulation, and teams that keep losing practice running carry more retirement risk.
4. **Reliability:** technical retirement risk per team (2026 only, shared partly with their engine supplier), crash risk per driver and track, more risk in the rain.
5. **Simulation:** 4,000 simulated sessions per prediction, including grid position cost by track, safety cars and retirements, give each driver a likely range and their chances.

Settings to tune with real data are at the bottom of `pipeline/config.py` and the top of `model/predict.py`. The accuracy page shows whether a change helps.

## Credits and terms

- Data: [FastF1](https://github.com/theOehrly/Fast-F1) (MIT licence) and the jolpica-f1 API. Weather: [Open-Meteo](https://open-meteo.com) (free for non-commercial use).
- Unofficial fan project, not associated with Formula 1 or the FIA. F1, FORMULA ONE and related marks belong to Formula One Licensing B.V. If you ever add ads or charge money, avoid F1 branding and check the data terms first.
