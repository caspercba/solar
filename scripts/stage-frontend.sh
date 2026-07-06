#!/usr/bin/env bash
# Stage static frontend assets for Cloudflare Pages (no build step).
set -euo pipefail

OUT="${1:-dist}"

rm -rf "$OUT"
mkdir -p "$OUT/icons"

cp index.html app.js style.css manifest.json sw.js "$OUT/"
cp icons/*.png "$OUT/icons/"

echo "Staged frontend in $OUT"
