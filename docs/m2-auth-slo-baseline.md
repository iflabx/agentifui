# M2 Auth SLO Baseline Report

- Generated At: 2026-02-16T07:12:50.221Z
- Started At: 2026-02-16T07:12:18.143Z
- App Base: http://127.0.0.1:3314
- Request Count (per case): 20
- Concurrency: 1
- Warm-up Count (per case, excluded): 2

## Thresholds

- p95 <= 300ms
- p99 <= 800ms
- 5xx rate < 0.3%

## Results

| Case | p95(ms) | p99(ms) | max(ms) | 5xx rate(%) | status distribution | Pass |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| auth.get-session | 72.84 | 73.32 | 73.32 | 0.00 | 200:20 | yes |
| auth.request-password-reset | 63.48 | 65.47 | 65.47 | 0.00 | 200:20 | yes |
| auth.sign-in.sso.start | 60.20 | 70.82 | 70.82 | 0.00 | 200:20 | yes |
| legacy.sso.login.redirect | 188.47 | 252.07 | 252.07 | 0.00 | 307:20 | yes |

