#!/usr/bin/env node
/**
 * i18n formatting boundary audit.
 *
 * Feature code should not call raw browser locale APIs directly. Keep locale
 * resolution, formatter caching, fallbacks, and future language policy inside
 * src/lib/i18n.ts so multi-language work has one architectural boundary.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const ALLOWED_FILES = new Set(["apps/ui/src/lib/i18n.ts", "apps/ui/src/test/i18n.test.ts"]);
const EXCLUDED_SUFFIXES = [".stories.tsx", ".test.ts", ".test.tsx"];

const RULES = [
  {
    label: "direct toLocale* call",
    pattern: /\.toLocale(?:String|DateString|TimeString)\s*\(/g,
    guidance: "Use formatDate, formatDateTime, formatShortDate, formatShortTime, or formatInteger.",
  },
  {
    label: "direct Intl formatter",
    pattern: /new\s+Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat)\s*\(/g,
    guidance: "Add a named helper to src/lib/i18n.ts and call that from feature code.",
  },
];

function trackedSourceFiles() {
  const out = execSync("git ls-files --cached -- 'apps/ui/src'", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });

  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .filter((file) => existsSync(path.join(REPO_ROOT, file)))
    .filter((file) => !ALLOWED_FILES.has(file))
    .filter((file) => !EXCLUDED_SUFFIXES.some((suffix) => file.endsWith(suffix)));
}

function audit() {
  const violations = [];

  for (const file of trackedSourceFiles()) {
    const lines = readFileSync(path.join(REPO_ROOT, file), "utf-8").split("\n");
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        for (const match of line.matchAll(rule.pattern)) {
          violations.push({
            file,
            guidance: rule.guidance,
            label: rule.label,
            line: line.trim(),
            lineNumber: index + 1,
            match: match[0],
          });
        }
      }
    });
  }

  return violations;
}

function main() {
  const violations = audit();
  if (violations.length === 0) {
    console.log("✓ apps/ui i18n formatting boundary clean");
    return;
  }

  console.error(`[fail] apps/ui i18n audit found ${violations.length} raw locale formatter(s)`);
  console.error("");
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.lineNumber}`);
    console.error(`    ${violation.match} — ${violation.label}`);
    console.error(`    ${violation.guidance}`);
    console.error(
      `    ${violation.line.length > 120 ? violation.line.slice(0, 120) + "…" : violation.line}`,
    );
    console.error("");
  }
  process.exit(1);
}

main();
