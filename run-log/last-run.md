# Last update run with news

- WARP: success
- Update step: success
- published=0
- backlog=0
- history_loaded=0
- history_left=0
- more=false

## Problems

- F1's servers blocked this request (HTTP 403, before checking the sign-in) for round 20 FP3. Nothing was loaded this run. F1 appears to block GitHub's own servers (FastF1 issue #988); the workflow's Cloudflare WARP step should route around this, so check whether that step connected.
- upgrades_found=0
