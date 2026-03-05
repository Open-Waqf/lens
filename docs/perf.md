# Performance Gates (P0-1)

This document defines the automated performance gates used for release checks.

Linked PRD IDs:
- `NFR-PERF-001`
- `AC-1.1`
- `AC-2.1`
- `AC-6.1`
- `TC-VAULT-008`

## Command

```bash
npm run test:perf
```

This runs `tests/e2e/perf-gates.spec.ts` (Desktop Chrome) and enforces thresholds in-test.

## Measured Gates

1. `PERF-START-001` cold start to camera-ready: `<= 2500ms`
2. `PERF-OCR-001` OCR single page: `<= 30000ms`
3. `PERF-SEARCH-001` search on 1,000 docs: `<= 500ms`
4. `PERF-EXPORT-001` export on 100-doc vault: `<= 60000ms`
5. `PERF-RESET-001` nuclear reset on 500-doc vault: `<= 3000ms`

## Data Setup Strategy

- Vault state is seeded directly into IndexedDB (`sahifah-lens`) for deterministic scale tests.
- OPFS files are seeded for export/reset gates.
- Tests run serially and clear DB + OPFS between gates.

## Artifacts

Generated under `artifacts/`:

- `perf-report.json`: machine-readable metrics
- `perf-summary.md`: markdown table summary

`perf-report.json` includes:
- metric name
- samples
- median measured time
- p95 time
- threshold
- pass/fail

## CI

Workflow: `.github/workflows/perf.yml`

CI job:
1. installs dependencies
2. builds app
3. runs `npm run test:perf`
4. uploads `artifacts/perf-report.json` and `artifacts/perf-summary.md`

