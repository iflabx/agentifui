# M2 Auth SLO Baseline Report

- Generated At: 2026-02-14T18:09:27.895Z
- Started At: 2026-02-14T18:08:54.821Z
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
| auth.get-session            |   68.87 |   74.89 |   74.89 |        0.00 | 200:20              | yes  |
| auth.request-password-reset |   77.41 |   91.44 |   91.44 |        0.00 | 200:20              | yes  |
| auth.sign-in.sso.start      |   70.89 |   82.52 |   82.52 |        0.00 | 200:20              | yes  |
| legacy.sso.login.redirect   |  176.58 |  217.41 |  217.41 |        0.00 | 307:20              | yes  |
