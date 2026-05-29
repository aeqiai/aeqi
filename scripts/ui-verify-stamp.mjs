#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const stampPath = path.join(root, ".aeqi", "ui-verify-stamp.json");
const uiDist = path.join(root, "apps/ui/dist");
const stampVersion = 1;

const args = new Set(process.argv.slice(2));
const quiet = args.has("--quiet");

function log(message) {
  if (!quiet) console.log(message);
}

function gitFiles(paths) {
  const result = spawnSync("git", ["ls-files", "-z", "--", ...paths], {
    cwd: root,
    encoding: "buffer",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString("utf8") || "git ls-files failed");
  }
  return result.stdout.toString("utf8").split("\0").filter(Boolean).sort();
}

function fileHash(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    const abs = path.join(root, file);
    hash.update(file);
    hash.update("\0");
    hash.update(existsSync(abs) ? readFileSync(abs) : "<deleted>");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function walkFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = path.join(prefix, name);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...walkFiles(abs, rel));
    } else if (stat.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function sourceHash() {
  const files = gitFiles([
    ".husky/pre-commit",
    "apps/ui",
    "package.json",
    "package-lock.json",
    "packages/tokens",
    "packages/web-shared",
    "scripts/ui-deploy.sh",
    "scripts/ui-verify-stamp.mjs",
  ]);
  for (const file of ["scripts/ui-verify-stamp.mjs"]) {
    if (existsSync(path.join(root, file)) && !files.includes(file)) {
      files.push(file);
    }
  }
  return fileHash(files.sort());
}

function distHash() {
  if (!existsSync(path.join(uiDist, "index.html"))) return null;
  return fileHash(
    walkFiles(uiDist).map((file) => path.join("apps/ui/dist", file)),
  );
}

function readStamp() {
  if (!existsSync(stampPath)) return null;
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function currentStamp() {
  const dist = distHash();
  if (!dist)
    throw new Error(
      "apps/ui/dist/index.html is missing; run npm --prefix apps/ui run build",
    );
  return {
    version: stampVersion,
    sourceHash: sourceHash(),
    distHash: dist,
    verifiedAt: new Date().toISOString(),
  };
}

function checkStamp() {
  const stamp = readStamp();
  if (!stamp || stamp.version !== stampVersion) return false;
  return stamp.sourceHash === sourceHash() && stamp.distHash === distHash();
}

if (args.has("--clear")) {
  rmSync(stampPath, { force: true });
  log("ui verify stamp cleared");
} else if (args.has("--write")) {
  const stamp = currentStamp();
  mkdirSync(path.dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  log(`ui verify stamp wrote ${stamp.sourceHash.slice(0, 12)}`);
} else if (args.has("--check")) {
  if (checkStamp()) {
    log("ui verify stamp matches source and dist");
  } else {
    log("ui verify stamp missing or stale");
    process.exit(1);
  }
} else if (args.has("--hash")) {
  console.log(sourceHash());
} else {
  console.error(
    "usage: ui-verify-stamp.mjs --clear|--write|--check|--hash [--quiet]",
  );
  process.exit(2);
}
