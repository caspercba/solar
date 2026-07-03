import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const localLibDir = path.join(__dirname, ".deps", "lib");
const localFontDir = path.join(__dirname, ".deps", "share", "fonts");
const bundledFontsConf = path.join(__dirname, "fonts", "fonts.conf");
const runtimeFontsConf = path.join(__dirname, ".deps", "fonts.conf");

const MOCK_PORT = Number(process.env.MOCK_WORKER_PORT) || 8790;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3456;

const launchEnv = {};
if (fs.existsSync(localLibDir)) {
  launchEnv.LD_LIBRARY_PATH = [localLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
}
if (fs.existsSync(localFontDir)) {
  const template = fs.readFileSync(bundledFontsConf, "utf8");
  fs.mkdirSync(path.dirname(runtimeFontsConf), { recursive: true });
  fs.writeFileSync(runtimeFontsConf, template.replace("FONT_DIR_PLACEHOLDER", localFontDir));
  launchEnv.FONTCONFIG_FILE = runtimeFontsConf;
}
const hasLaunchEnv = Object.keys(launchEnv).length > 0;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(hasLaunchEnv ? { env: launchEnv } : {}),
      args: ["--headless=old", "--disable-gpu", "--no-sandbox"],
    },
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: [
    {
      command: `node fixtures/mock-worker.js`,
      cwd: __dirname,
      url: `http://127.0.0.1:${MOCK_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npx serve -l ${FRONTEND_PORT} ${repoRoot}`,
      cwd: __dirname,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
