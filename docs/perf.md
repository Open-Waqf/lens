# Performance gates

`npm run test:perf` runs `tests/e2e/perf-gates.spec.ts` on the desktop screen. The same
tests run in `npm run check -- --desktop`, in the release, and on GitHub.

| Gate | Threshold |
|---|---|
| PERF-START-001 cold start to camera ready | 2.5 s |
| PERF-OCR-001 OCR of a one-page document | 30 s |
| PERF-SEARCH-001 search across 1,000 documents | 0.5 s |
| PERF-EXPORT-001 backup export of 100 documents | 60 s |
| PERF-RESET-001 erase a 500-document library | 3 s |

Data is seeded straight into IndexedDB and OPFS, and cleared between gates. The report
(`perf-report.json`, `perf-summary.md`) is written to `test-results/perf/`, which git ignores.

These are desktop numbers. Real phone numbers come from `npm run test:android` (OCR time and
memory on the phone).
