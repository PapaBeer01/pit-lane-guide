# Data route test

## Route: direct

2026-11-02 00:19Z. Network: AS8075 Microsoft Corporation (US). Race: 2026 round 19 Mexico City Grand Prix race.

| Check | HTTP | Notes |
|---|---|---|
| F1 archive, no token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| F1 archive, with your token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| F1 archive lap timing, with token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| FastF1 mirror | 404 | cloudflare |
| Live feed sign-up, no token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| Live feed sign-up, with token | 403 | Error from cloudfront; CloudFront; 'Request blocked' page |
| OpenF1 2026 races | 200 | 21 finished races; latest Mexico City 2026-11-01 |
| OpenF1 laps (latest race) | 200 | 1360 rows |
| OpenF1 stints (latest race) | 200 | 80 rows |
| OpenF1 session_result (latest race) | 200 | 22 rows |
| OpenF1 race_control (latest race) | 200 | 169 rows |
| Jolpica results (latest) | 200 | round 18, 22 results |

## Route: warp

2026-11-02 00:20Z. Network: AS13335 Cloudflare, Inc. (US). Race: 2026 round 19 Mexico City Grand Prix race.

| Check | HTTP | Notes |
|---|---|---|
| F1 archive, no token | 401 | FunctionGeneratedResponse from cloudfront; CloudFront |
| F1 archive, with your token | 200 | Hit from cloudfront; AmazonS3 |
| F1 archive lap timing, with token | 200 | 7119 KB |
| FastF1 mirror | 404 | cloudflare |
| Live feed sign-up, no token | 200 | Miss from cloudfront; Kestrel |
| Live feed sign-up, with token | 200 | Miss from cloudfront; Kestrel |
| OpenF1 2026 races | 200 | 21 finished races; latest Mexico City 2026-11-01 |
| OpenF1 laps (latest race) | 200 | 1360 rows |
| OpenF1 stints (latest race) | 200 | 80 rows |
| OpenF1 session_result (latest race) | 200 | 22 rows |
| OpenF1 race_control (latest race) | 200 | 169 rows |
| Jolpica results (latest) | 200 | round 18, 22 results |

