# M2 Auth SLO Baseline Report

- Generated At: 2026-02-18T04:01:52.469Z
- Started At: 2026-02-18T04:01:17.115Z
- App Base: http://127.0.0.1:3314
- Request Count (per case): 20
- Concurrency: 1
- Warm-up Count (per case, excluded): 2

## Thresholds

- p95 <= 300ms
- p99 <= 800ms
- 5xx rate < 0.3%

## Results

| Case                        | p95(ms) | p99(ms) | max(ms) | 5xx rate(%) | status distribution | Pass |
| --------------------------- | ------: | ------: | ------: | ----------: | ------------------- | ---- |
| auth.get-session            |   70.90 |   73.21 |   73.21 |        0.00 | 200:20              | yes  |
| auth.request-password-reset |  110.37 |  119.00 |  119.00 |        0.00 | 200:20              | yes  |
| auth.sign-in.sso.start      |  167.63 |  174.13 |  174.13 |        0.00 | 200:20              | yes  |
| legacy.sso.login.redirect   |  188.74 |  205.41 |  205.41 |        0.00 | 307:20              | yes  |
