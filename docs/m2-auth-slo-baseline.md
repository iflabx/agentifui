# M2 Auth SLO Baseline Report

- Generated At: 2026-02-18T13:21:46.494Z
- Started At: 2026-02-18T13:21:13.015Z
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
| auth.get-session            |   66.52 |   73.79 |   73.79 |        0.00 | 200:20              | yes  |
| auth.request-password-reset |   71.00 |   72.12 |   72.12 |        0.00 | 200:20              | yes  |
| auth.sign-in.sso.start      |   75.11 |  108.56 |  108.56 |        0.00 | 200:20              | yes  |
| legacy.sso.login.redirect   |  178.60 |  181.46 |  181.46 |        0.00 | 307:20              | yes  |
