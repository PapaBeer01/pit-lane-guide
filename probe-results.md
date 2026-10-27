# Data route test

## Route: direct

2026-10-27 06:17Z. Network: AS8075 Microsoft Corporation (US). Race: 2026 round 18 United States Grand Prix race.

| Check | HTTP | Notes |
|---|---|---|
| F1 archive, no token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| F1 archive, with your token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| F1 archive lap timing, with token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| FastF1 mirror | 404 | cloudflare |
| Live feed sign-up, no token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| Live feed sign-up, with token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| OpenF1 2026 races | 200 | 20 finished races; latest Austin 2026-10-25 |
| OpenF1 laps (latest race) | 200 | 1166 rows |
| OpenF1 stints (latest race) | 200 | 54 rows |
| OpenF1 session_result (latest race) | 200 | 22 rows |
| OpenF1 race_control (latest race) | 200 | 173 rows |
| Jolpica results (latest) | 200 | round 18, 22 results |

## Route: warp

2026-10-27 06:18Z. Network: AS13335 Cloudflare, Inc. (US). Race: 2026 round 18 United States Grand Prix race.

| Check | HTTP | Notes |
|---|---|---|
| F1 archive, no token | 401 | FunctionGeneratedResponse from cloudfront; CloudFront |
| F1 archive, with your token | 200 | RefreshHit from cloudfront; AmazonS3 |
| F1 archive lap timing, with token | 200 | 5952 KB |
| FastF1 mirror | 404 | cloudflare |
| Live feed sign-up, no token | 200 | Miss from cloudfront; Kestrel |
| Live feed sign-up, with token | 200 | Miss from cloudfront; Kestrel |
| OpenF1 2026 races | 200 | 20 finished races; latest Austin 2026-10-25 |
| OpenF1 laps (latest race) | 200 | 1166 rows |
| OpenF1 stints (latest race) | 200 | 54 rows |
| OpenF1 session_result (latest race) | 200 | 22 rows |
| OpenF1 race_control (latest race) | 200 | 173 rows |
| Jolpica results (latest) | 200 | round 18, 22 results |

