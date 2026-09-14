# GridVault load test report

Generated: 2026-09-14T16:36:03.953Z
Profile: load (500 patients, ~50,000 ledger entries)
Concurrency: 40 virtual terminals

## AT-901 — latency budgets (NFR-1)

| Endpoint | p50 (ms) | p95 (ms) | max (ms) | Budget (p95) | Failures | Result |
| :-- | --: | --: | --: | --: | --: | :-- |
| Roster (GET /api/patients) | 24.8 | 275.3 | 340.7 | 150 | 0 | FAIL |
| Dossier (GET /api/patients/:id) | 59.3 | 72.3 | 380.4 | 200 | 0 | PASS |
| Vitals write (POST /api/patients/:id/vitals) | 60.5 | 112.8 | 364.5 | 120 | 0 | PASS |

## AT-906 — 40 concurrent writers, 60 s (NFR-3)

- Writes attempted: 46553
- Failed writes: 0
- SQLITE_BUSY surfaced to a client: false
- Result: PASS

## Ledger integrity

- Chain status after load: HEALTHY
- Result: PASS

## Overall: FAIL
