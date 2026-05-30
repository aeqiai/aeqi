#!/usr/bin/env node
/**
 * Cross-stack maintainability ratchet.
 *
 * This records broad debt signals that are easy to miss in review: UI megafiles,
 * design-system drift, direct SQLite lock usage, raw error serialization, route
 * parsing duplication, and the root API client size. The current tree must stay
 * at or below the checked-in baseline unless the baseline is deliberately
 * refreshed with --update-baseline.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const JSON_ONLY = process.argv.includes("--json");
const REPORT_ONLY = process.argv.includes("--report");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/maintainability-baseline.json");

const DESIGN_EXCLUDED_PREFIXES = [
  "apps/ui/src/components/ui/",
  "apps/ui/src/test/",
  "apps/ui/src/styles/primitives.css",
];
const DESIGN_EXCLUDED_SUFFIXES = [".stories.tsx", ".test.ts", ".test.tsx"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"];

const DESIGN_RULES = [
  {
    key: "rawButton",
    label: "raw <button>",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /<button\b/g,
  },
  {
    key: "rawInput",
    label: "raw <input>",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /<input\b/g,
  },
  {
    key: "inlineStyle",
    label: "inline style object",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /style=\{\{/g,
  },
  {
    key: "literalHex",
    label: "literal hex color",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /(?<![\w-])#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    key: "literalRgb",
    label: "literal rgb/rgba color",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /\brgba?\(/g,
  },
];

const HOTSPOTS = [
  "apps/ui/src/lib/api.ts",
  "apps/ui/src/styles/layout.css",
  "apps/ui/src/styles/pages.css",
  "apps/ui/src/styles/overview.css",
  "apps/ui/src/styles/roles.css",
];

const MEGAFILE_EXCLUDED_PREFIXES = ["apps/ui/src/solana/generated/"];
const CODE_EXCLUDED_PARTS = ["/tests/", "/test/", "crates/aeqi-test-support/"];

const CODE_RULES = [
  {
    key: "directSqliteLocks",
    label: "direct SQLite locks",
    globs: ["crates/**/*.rs", "aeqi-cli/**/*.rs"],
    patterns: [
      /\bMutex\s*<\s*Connection\s*>/g,
      /\bSharedDb\s*=\s*Arc\s*<\s*Mutex\s*<\s*Connection\s*>/g,
      /\bMutexGuard\s*<[^>]*Connection/g,
      /\.lock\(\)\.expect\([^)]*(?:sqlite|wallet db|conn|connection|db)[^)]*\)/gi,
    ],
  },
  {
    key: "rawErrorSerialization",
    label: "raw error serialization",
    globs: ["crates/aeqi-web/**/*.rs", "crates/aeqi-orchestrator/**/*.rs"],
    patterns: [
      /"error"\s*:\s*[^,\n}]*\.to_string\(\)/g,
      /"error"\s*:\s*format!\(/g,
      /Json\s*\([^)]*error[^)]*to_string\(\)/gs,
    ],
  },
  {
    key: "routeParsingDuplication",
    label: "route parsing duplication",
    globs: ["crates/aeqi-web/**/*.rs", "apps/ui/src/**/*.ts", "apps/ui/src/**/*.tsx"],
    patterns: [
      /\.split\(\s*['"`]\/['"`]\s*\)/g,
      /\.strip_prefix\(\s*['"`]\/api/g,
      /\.trim_start_matches\(\s*['"`]\/api/g,
      /new URLSearchParams\(/g,
    ],
  },
];

function gitLsFiles(args) {
  const output = execSync(`git ls-files --cached -- ${args}`, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  return output.split("\n").filter(Boolean);
}

function trackedFiles(globs) {
  return gitLsFiles(globs.map((glob) => `'${glob}'`).join(" "))
    .filter((file) => existsSync(path.join(REPO_ROOT, file)))
    .sort();
}

function productionFiles(globs) {
  return trackedFiles(globs).filter(
    (file) => !CODE_EXCLUDED_PARTS.some((part) => file.includes(part)),
  );
}

function read(file) {
  return readFileSync(path.join(REPO_ROOT, file), "utf-8");
}

function lineCount(file) {
  if (!existsSync(path.join(REPO_ROOT, file))) return 0;
  const content = read(file);
  if (content.length === 0) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function countMatches(content, pattern) {
  pattern.lastIndex = 0;
  return [...content.matchAll(pattern)].length;
}

function topFiles(files, limit = 8) {
  return Object.entries(files)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([file, count]) => ({ file, count }));
}

function designSourceFiles() {
  return trackedFiles(["apps/ui/src"])
    .filter((file) => SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .filter((file) => !DESIGN_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !DESIGN_EXCLUDED_SUFFIXES.some((suffix) => file.endsWith(suffix)));
}

function designMetrics() {
  const totals = Object.fromEntries(
    DESIGN_RULES.map((rule) => [rule.key, { label: rule.label, count: 0, files: {} }]),
  );

  for (const file of designSourceFiles()) {
    const content = read(file);
    for (const rule of DESIGN_RULES) {
      if (!rule.applies(file)) continue;
      const count = countMatches(content, rule.pattern);
      if (count === 0) continue;
      totals[rule.key].count += count;
      totals[rule.key].files[file] = count;
    }
  }

  return Object.fromEntries(
    DESIGN_RULES.map((rule) => [
      rule.key,
      {
        label: totals[rule.key].label,
        count: totals[rule.key].count,
        topFiles: topFiles(totals[rule.key].files),
      },
    ]),
  );
}

function codeRuleMetrics() {
  return Object.fromEntries(
    CODE_RULES.map((rule) => {
      const files = {};
      let count = 0;
      for (const file of productionFiles(rule.globs)) {
        const content = read(file);
        const fileCount = rule.patterns.reduce((sum, pattern) => sum + countMatches(content, pattern), 0);
        if (fileCount === 0) continue;
        files[file] = fileCount;
        count += fileCount;
      }
      return [
        rule.key,
        {
          label: rule.label,
          count,
          topFiles: topFiles(files),
        },
      ];
    }),
  );
}

function fileSizeMetrics() {
  const hotspotLines = Object.fromEntries(
    HOTSPOTS.map((file) => [
      file,
      {
        label: file,
        count: lineCount(file),
        topFiles: [{ file, count: lineCount(file) }],
      },
    ]),
  );

  const uiFiles = trackedFiles(["apps/ui/src/**/*.ts", "apps/ui/src/**/*.tsx", "apps/ui/src/**/*.css"]);
  const megafileCounts = Object.fromEntries(
    uiFiles
      .filter((file) => !MEGAFILE_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
      .map((file) => ({ file, count: lineCount(file) }))
      .filter((entry) => entry.count >= 600)
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
      .map((entry) => [entry.file, entry]),
  );

  return {
    ...hotspotLines,
    "ui.megafilesOver600": {
      label: "UI files >= 600 lines",
      count: Object.keys(megafileCounts).length,
      topFiles: Object.values(megafileCounts).slice(0, 12),
    },
  };
}

function currentSnapshot() {
  return {
    version: 1,
    generatedBy: "scripts/maintainability-ratchet.mjs",
    metrics: {
      ...fileSizeMetrics(),
      ...designMetrics(),
      ...codeRuleMetrics(),
    },
  };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
}

function writeBaseline(snapshot) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function compare(snapshot, baseline) {
  const failures = [];
  const improvements = [];
  for (const [key, metric] of Object.entries(snapshot.metrics)) {
    const allowed = baseline.metrics?.[key]?.count;
    if (typeof allowed !== "number") {
      failures.push({ key, message: "missing baseline entry", current: metric.count, allowed: null });
    } else if (metric.count > allowed) {
      failures.push({ key, message: `${metric.count} > baseline ${allowed}`, current: metric.count, allowed });
    } else if (metric.count < allowed) {
      improvements.push({ key, message: `${metric.count} < baseline ${allowed}`, current: metric.count, allowed });
    }
  }
  return { failures, improvements };
}

function debtRows(snapshot, limit = 12) {
  const byFile = new Map();
  for (const metric of Object.values(snapshot.metrics)) {
    for (const entry of metric.topFiles ?? []) {
      const existing = byFile.get(entry.file);
      if (!existing) {
        byFile.set(entry.file, {
          file: entry.file,
          count: entry.count,
          labels: new Set([metric.label]),
        });
        continue;
      }
      existing.count = Math.max(existing.count, entry.count);
      existing.labels.add(metric.label);
    }
  }

  return [...byFile.values()]
    .map((row) => ({ ...row, label: [...row.labels].join(", ") }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, limit);
}

function printReport(snapshot, comparison = null) {
  console.log("Maintainability ratchet");
  console.log("");
  for (const [key, metric] of Object.entries(snapshot.metrics)) {
    const allowed = comparison?.baseline?.metrics?.[key]?.count;
    const suffix = typeof allowed === "number" ? ` (baseline ${allowed})` : "";
    console.log(`- ${key}: ${metric.count}${suffix}`);
  }
  console.log("");
  console.log("Top debt targets:");
  for (const row of debtRows(snapshot)) {
    console.log(`- ${row.file}: ${row.count} ${row.label}`);
  }
}

function main() {
  const snapshot = currentSnapshot();

  if (JSON_ONLY) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (UPDATE_BASELINE) {
    writeBaseline(snapshot);
    console.log(`Updated ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
    printReport(snapshot);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error("No maintainability baseline found.");
    console.error("Run `npm run maintainability:update-baseline` after reviewing current debt.");
    process.exit(1);
  }

  const comparison = { ...compare(snapshot, baseline), baseline };
  if (REPORT_ONLY) {
    printReport(snapshot, comparison);
    return;
  }

  if (comparison.failures.length > 0) {
    console.error("[fail] maintainability ratchet failed");
    console.error("");
    for (const failure of comparison.failures) {
      console.error(`- ${failure.key}: ${failure.message}`);
    }
    console.error("");
    printReport(snapshot, comparison);
    process.exit(1);
  }

  console.log("[ok] maintainability ratchet clean");
  for (const improvement of comparison.improvements) {
    console.log(`  improved: ${improvement.key}: ${improvement.message}`);
  }
  if (comparison.improvements.length > 0) {
    console.log("");
  }
  printReport(snapshot, comparison);
}

main();
