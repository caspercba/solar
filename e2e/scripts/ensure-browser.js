#!/usr/bin/env node
/**
 * Install the Playwright Chromium browser (and OS deps when possible) at
 * runtime — no baked image is assumed. Tries the full `--with-deps` install
 * first (needs root/sudo, e.g. CI runners and the factory sandbox); falls
 * back to a browser-only install when that's unavailable, leaving shared
 * library setup to `fetch-deps.js`.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("npx playwright install --with-deps chromium");
} catch {
  console.warn("[ensure-browser] --with-deps install failed (likely no root) — installing browser only");
  run("npx playwright install chromium");
}
