#!/usr/bin/env node
/**
 * Download minimal Debian arm64 runtime libraries for Playwright Chromium
 * when `playwright install-deps` cannot run (no root). Extracts to e2e/.deps/lib.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { path7za } from "7zip-bin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPS_ROOT = path.resolve(__dirname, "..", ".deps");
const LIB_DIR = path.join(DEPS_ROOT, "lib");
const ETC_DIR = path.join(DEPS_ROOT, "etc");
const SHARE_DIR = path.join(DEPS_ROOT, "share");
const MARKER = path.join(DEPS_ROOT, ".ready");

const PACKAGES = [
  "libglib2.0-0",
  "libnspr4",
  "libnss3",
  "libatk1.0-0",
  "libatk-bridge2.0-0",
  "libdbus-1-3",
  "libcups2",
  "libxcb1",
  "libxkbcommon0",
  "libasound2",
  "libgbm1",
  "libx11-6",
  "libxext6",
  "libcairo2",
  "libpango-1.0-0",
  "libxcomposite1",
  "libxdamage1",
  "libxfixes3",
  "libxrandr2",
  "libatspi2.0-0",
  "libexpat1",
  "libfontconfig1",
  "libfreetype6",
  "libpixman-1-0",
  "libpng16-16",
  "libxrender1",
  "libxi6",
  "libxtst6",
  "libdrm2",
  "libwayland-client0",
  "libwayland-server0",
  "libx11-xcb1",
  "libxshmfence1",
  "libxau6",
  "libxdmcp6",
  "libbsd0",
  "libmd0",
  "libffi8",
  "libpcre2-8-0",
  "libmount1",
  "libselinux1",
  "libblkid1",
  "libsystemd0",
  "libgcrypt20",
  "liblz4-1",
  "liblzma5",
  "libzstd1",
  "libgssapi-krb5-2",
  "libkrb5-3",
  "libk5crypto3",
  "libcom-err2",
  "libkrb5support0",
  "libkeyutils1",
  "fonts-dejavu-core",
];

async function resolveDebUrl(pkg) {
  for (const arch of ["arm64", "all"]) {
    const res = await fetch(
      `https://packages.debian.org/bookworm/${arch}/${encodeURIComponent(pkg)}/download`,
    );
    if (!res.ok) continue;
    const html = await res.text();
    const match = html.match(/href="(https?:\/\/[^"]+\/pool\/[^"]+_(?:arm64|all)\.deb)"/);
    if (match) {
      return match[1].replace("http://ftp.us.debian.org/debian/", "http://deb.debian.org/debian/");
    }
  }
  throw new Error(`No deb link for ${pkg}`);
}

function readArEntries(debPath) {
  const buf = fs.readFileSync(debPath);
  if (buf.toString("ascii", 0, 8) !== "!<arch>\n") {
    throw new Error(`Not an ar archive: ${debPath}`);
  }
  const entries = [];
  let offset = 8;
  while (offset + 60 <= buf.length) {
    const header = buf.subarray(offset, offset + 60);
    const name = header.subarray(0, 16).toString("ascii").trim();
    const size = Number.parseInt(header.subarray(48, 58).toString("ascii").trim(), 10);
    offset += 60;
    const data = buf.subarray(offset, offset + size);
    entries.push({ name, data });
    offset += size + (size % 2);
  }
  return entries;
}

function copySharedObject(srcPath, destPath) {
  const stat = fs.lstatSync(srcPath);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(srcPath);
    const resolved = path.resolve(path.dirname(srcPath), target);
    if (fs.existsSync(resolved)) {
      fs.copyFileSync(resolved, destPath);
      return;
    }
  }

  fs.copyFileSync(srcPath, destPath);
  if (fs.statSync(destPath).size >= 128) return;

  const text = fs.readFileSync(destPath, "utf8").trim();
  if (!text || text.includes("\0") || !/^[\w./+-]+$/.test(text)) return;
  const resolved = path.resolve(path.dirname(srcPath), text);
  if (fs.existsSync(resolved)) fs.copyFileSync(resolved, destPath);
}

function extractDeb(debPath, destLib) {
  const work = path.join(DEPS_ROOT, ".extract");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const dataEntry = readArEntries(debPath).find((e) => e.name.startsWith("data.tar"));
  if (!dataEntry) throw new Error(`No data tarball in ${debPath}`);

  const tarPath = path.join(work, dataEntry.name);
  fs.writeFileSync(tarPath, dataEntry.data);
  execSync(`"${path7za}" x -y -o"${work}" "${tarPath}"`, { stdio: "pipe" });

  const innerTar = path.join(work, dataEntry.name.replace(/\.(xz|gz)$/i, ""));
  if (innerTar !== tarPath && fs.existsSync(innerTar)) {
    execSync(`"${path7za}" x -y -o"${work}" "${innerTar}"`, { stdio: "pipe" });
  }

  for (const sub of ["lib/aarch64-linux-gnu", "usr/lib/aarch64-linux-gnu", "lib"]) {
    const src = path.join(work, sub);
    if (!fs.existsSync(src)) continue;
    for (const file of fs.readdirSync(src, { withFileTypes: true })) {
      if (!/\.so/.test(file.name)) continue;
      const srcPath = path.join(src, file.name);
      const destPath = path.join(destLib, file.name);
      copySharedObject(srcPath, destPath);
    }
  }

  for (const etcSub of ["etc"]) {
    const src = path.join(work, etcSub);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, ETC_DIR, { recursive: true, force: true });
  }

  const fontsSrc = path.join(work, "usr/share/fonts");
  if (fs.existsSync(fontsSrc)) {
    fs.cpSync(fontsSrc, path.join(SHARE_DIR, "fonts"), { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.CI) {
    console.log("[fetch-deps] skipped in CI (use playwright install --with-deps)");
    return;
  }
  if (fs.existsSync(MARKER)) {
    console.log("[fetch-deps] already prepared:", LIB_DIR);
    return;
  }

  fs.mkdirSync(LIB_DIR, { recursive: true });

  for (const pkg of PACKAGES) {
    const url = await resolveDebUrl(pkg);
    const debName = path.basename(url);
    const debPath = path.join(DEPS_ROOT, debName);
    if (!fs.existsSync(debPath)) {
      process.stdout.write(`[fetch-deps] downloading ${pkg}…\n`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed ${pkg}: ${res.status}`);
      fs.writeFileSync(debPath, Buffer.from(await res.arrayBuffer()));
    }
    extractDeb(debPath, LIB_DIR);
  }

  fs.writeFileSync(MARKER, new Date().toISOString());
  console.log("[fetch-deps] ready:", LIB_DIR);
}

main().catch((err) => {
  // Best-effort supplement to `playwright install --with-deps` — if the
  // Debian mirror is unreachable (e.g. restricted sandbox network), don't
  // block the test run. Chromium may already have what it needs; if not,
  // Playwright's own launch error will say so.
  console.warn("[fetch-deps] skipped (could not fetch runtime libraries):", err.message || err);
});
