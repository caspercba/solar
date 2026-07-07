#!/bin/sh
set -e

cd /app

if [ "$API_MODE" = "worker" ]; then
  echo "[api] starting Miniflare Worker (wrangler dev) on 0.0.0.0:${WORKER_PORT:-8787}"
  echo "[api] open mode — no API_TOKEN required for local dev"
  cd worker
  exec npx wrangler dev --ip 0.0.0.0 --port "${WORKER_PORT:-8787}"
fi

echo "[api] starting mock Worker with vendor fixtures on 0.0.0.0:${MOCK_WORKER_PORT:-8787}"
echo "[api] Bearer token: ${MOCK_WORKER_TOKEN:-e2e-test-token}"
export MOCK_WORKER_HOST="${MOCK_WORKER_HOST:-0.0.0.0}"
export MOCK_WORKER_PORT="${MOCK_WORKER_PORT:-8787}"
exec node e2e/fixtures/mock-worker.js
