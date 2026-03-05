# Security Network Gate

This gate enforces the Open Waqf zero-outbound covenant in CI.

## CI Workflow

Workflow: `.github/workflows/security-network.yml`

The job:
1. builds app
2. starts `mitmproxy`
3. runs security E2E flow matrix (`npm run test:security`)
4. asserts request log with `scripts/network-assert.mjs`

## Security E2E Flow Matrix

Current matrix (via `npm run test:security`):
- `tests/e2e/privacy-network.spec.ts`
  - full path: `scan -> OCR -> save -> search -> export`
- `tests/e2e/offline-core.spec.ts`
  - offline core operations and restore/reset behaviors

## Allowlist Policy

Default CI allowlist:
- `localhost`
- `127.0.0.1`

Configured by workflow env:

```bash
NETWORK_ALLOW_HOSTS=localhost,127.0.0.1
```

Language pack networking tests (if introduced) must be explicit and isolated:
- run in a dedicated job or explicit command
- set `NETWORK_ALLOW_HOSTS` only for the required host(s)
- keep default gate strict (localhost only)

## Local Run

```bash
export MITM_CAPTURE_PATH=/tmp/mitm-requests.jsonl
export E2E_PROXY_SERVER=http://127.0.0.1:8080
nohup mitmdump --listen-host 127.0.0.1 --listen-port 8080 -q -s scripts/mitm_capture.py >/tmp/mitm.log 2>&1 &
MITM_PID=$!
npm run build
npm run test:security
node scripts/network-assert.mjs /tmp/mitm-requests.jsonl --allow-hosts=localhost,127.0.0.1
kill "$MITM_PID"
```

