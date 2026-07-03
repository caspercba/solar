#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {
  ...process.env,
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "1",
};

const args = ["playwright", "test", ...process.argv.slice(2)];
const result = spawnSync("npx", args, {
  stdio: "inherit",
  env,
  cwd: path.resolve(__dirname, ".."),
});

process.exit(result.status ?? 1);
