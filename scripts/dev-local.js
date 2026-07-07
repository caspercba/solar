#!/usr/bin/env node
/**
 * One-command local dev without Docker.
 * Spawns mock Worker (default) or wrangler dev + static file server.
 *
 * Usage:
 *   npm run dev:local
 *   API_MODE=worker npm run dev:local:worker
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiMode = process.env.API_MODE || "mock";
const workerPort = process.env.WORKER_PORT || "8787";
const frontendPort = process.env.FRONTEND_PORT || "8080";
const mockToken = process.env.MOCK_WORKER_TOKEN || "e2e-test-token";

const children = [];

function run(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    cwd: root,
    ...options,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[dev-local] ${label} stopped (${signal})`);
    } else if (code !== 0 && code !== null) {
      console.error(`[dev-local] ${label} exited with code ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev-local] Solar Dashboard dev stack");
console.log(`[dev-local] Frontend: http://localhost:${frontendPort}`);
console.log(`[dev-local] API:      http://localhost:${workerPort}`);

if (apiMode === "worker") {
  console.log("[dev-local] API mode: wrangler dev (open — no token required)");
  run("worker", "npm", ["run", "dev", "--", "--ip", "0.0.0.0", "--port", workerPort], {
    cwd: path.join(root, "worker"),
  });
} else {
  console.log(`[dev-local] API mode: mock fixtures (token: ${mockToken})`);
  run("mock-worker", "node", ["e2e/fixtures/mock-worker.js"], {
    env: {
      ...process.env,
      MOCK_WORKER_PORT: workerPort,
      MOCK_WORKER_HOST: "127.0.0.1",
      MOCK_WORKER_TOKEN: mockToken,
    },
  });
}

run("frontend", "npx", ["serve", "-l", frontendPort, root], {
  cwd: path.join(root, "e2e"),
});

console.log("[dev-local] Press Ctrl+C to stop");
