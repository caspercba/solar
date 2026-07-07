#!/bin/sh
set -e

cd /app
echo "[frontend] serving static dashboard on 0.0.0.0:${FRONTEND_PORT:-8080}"
exec npx serve -l "tcp://0.0.0.0:${FRONTEND_PORT:-8080}" .
