#!/usr/bin/env node
/**
 * Install the Playwright Chromium browser (and OS deps when possible) at
 * runtime — no baked image is assumed. Tries the full `--with-deps` install
 * first (needs root/sudo, e.g. CI runners and the factory sandbox); falls
 * back to a browser-only install when that's unavailable, leaving shared
 * library setup to `fetch-deps.js`.
 *
 * Skips download when a usable Chromium is already present (Playwright cache
 * or system package) — needed in sandboxes that cannot reach cdn.playwright.dev.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function hasBundledChromium() {
  try {
    const { chromium } = require("playwright-core");
    const exe = chromium.executablePath();
    return Boolean(exe && fs.existsSync(exe));
  } catch {
    return false;
  }
}

function hasSystemChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  }
  return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].some((p) =>
    fs.existsSync(p),
  );
}

if (hasBundledChromium()) {
  console.log("[ensure-browser] Playwright Chromium already installed — skipping download");
  process.exit(0);
}

if (hasSystemChromium()) {
  console.log(
    "[ensure-browser] System Chromium found — skipping Playwright download (playwright.config.js will use executablePath fallback)",
  );
  process.exit(0);
}

try {
  run("npx playwright install --with-deps chromium");
} catch {
  console.warn("[ensure-browser] --with-deps install failed (likely no root) — installing browser only");
  run("npx playwright install chromium");
}
