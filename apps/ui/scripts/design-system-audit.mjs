#!/usr/bin/env node
/**
 * Design-system audit ratchet.
 *
 * The dashboard still has legacy surfaces that predate the primitive library.
 * This script records that debt as a baseline and fails when a change adds
 * more drift. Lower counts are always allowed; raising the baseline requires
 * an explicit `npm run design-system:update-baseline`.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(UI_ROOT, "../..");
const BASELINE_PATH = path.join(UI_ROOT, "scripts/design-system-baseline.json");

const EXCLUDED_PREFIXES = [
  "apps/ui/src/components/ui/",
  "apps/ui/src/test/",
  "apps/ui/src/styles/primitives.css",
];

const EXCLUDED_SUFFIXES = [".stories.tsx", ".test.ts", ".test.tsx"];

const RULES = [
  {
    key: "rawButton",
    label: "raw <button>",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /<button\b/g,
    guidance: "Use Button, IconButton, CardTrigger, TabTrigger, Menu, or a routed Link.",
  },
  {
    key: "rawInput",
    label: "raw <input>",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /<input\b/g,
    guidance: "Use Input, Combobox, Select, or a dedicated primitive variant.",
  },
  {
    key: "rawSelect",
    label: "raw <select>",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /<select\b/g,
    guidance: "Use Select or Combobox.",
  },
  {
    key: "rawTextarea",
    label: "raw <textarea>",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /<textarea\b/g,
    guidance: "Use Textarea.",
  },
  {
    key: "inlineStyle",
    label: "inline style object",
    applies: (file) => file.endsWith(".tsx"),
    pattern: /style=\{\{/g,
    guidance: "Move stable styling into primitives, CSS modules, or tokenized surface CSS.",
  },
  {
    key: "windowLocation",
    label: "window.location navigation",
    applies: (file) => file.endsWith(".ts") || file.endsWith(".tsx"),
    pattern: /window\.location\.(?:href|assign)\b/g,
    guidance: "Use React Router navigation inside the SPA, or isolate external redirects.",
  },
  {
    key: "literalHex",
    label: "literal hex color",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /(?<![\w-])#[0-9a-fA-F]{3,8}\b/g,
    guidance: "Use tokens from packages/tokens or src/styles/primitives.css.",
  },
  {
    key: "literalRgb",
    label: "literal rgb/rgba color",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /\brgba?\(/g,
    guidance: "Use semantic color, border, shadow, and state tokens.",
  },
  {
    key: "borderLeft",
    label: "border-left styling",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /\bborder-left(?:-color)?\s*:/g,
    guidance: "Use selected backgrounds, Badge, StatusRow, or a state dot instead of stripes.",
  },
  {
    key: "linearGradient",
    label: "linear-gradient",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /\blinear-gradient\(/g,
    guidance: "Use the graphite/paper elevation ladder; gradients need a primitive-level reason.",
  },
  {
    key: "backdropFilter",
    label: "backdrop-filter",
    applies: (file) => file.endsWith(".css") || file.endsWith(".tsx"),
    pattern: /\b-?backdrop-filter\s*:/g,
    guidance: "Avoid glassmorphism; use Modal/Popover elevation tokens.",
  },
];

function trackedSourceFiles() {
  const out = execSync(
    "git ls-files -- 'apps/ui/src/**/*.ts' 'apps/ui/src/**/*.tsx' 'apps/ui/src/**/*.css'",
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !EXCLUDED_SUFFIXES.some((suffix) => file.endsWith(suffix)));
}

function countMatches(content, pattern) {
  pattern.lastIndex = 0;
  return [...content.matchAll(pattern)].length;
}

function topFiles(files) {
  return Object.entries(files)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([file, count]) => ({ file, count }));
}

function auditDrift() {
  const result = Object.fromEntries(
    RULES.map((rule) => [rule.key, { label: rule.label, count: 0, files: {} }]),
  );

  for (const file of trackedSourceFiles()) {
    const content = readFileSync(path.join(REPO_ROOT, file), "utf-8");
    for (const rule of RULES) {
      if (!rule.applies(file)) continue;
      const count = countMatches(content, rule.pattern);
      if (count === 0) continue;
      result[rule.key].count += count;
      result[rule.key].files[file] = count;
    }
  }

  return Object.fromEntries(
    RULES.map((rule) => [
      rule.key,
      {
        label: rule.label,
        count: result[rule.key].count,
        topFiles: topFiles(result[rule.key].files),
      },
    ]),
  );
}

function exportedPrimitiveModules() {
  const index = readFileSync(path.join(UI_ROOT, "src/components/ui/index.ts"), "utf-8");
  const modules = new Set();
  for (const match of index.matchAll(/export\s+\{[^}]+\}\s+from\s+["']\.\/([^"']+)["']/g)) {
    modules.add(match[1]);
  }
  return [...modules].sort();
}

function missingPrimitiveStories() {
  return exportedPrimitiveModules().filter((moduleName) => {
    const story = path.join(UI_ROOT, `src/components/ui/${moduleName}.stories.tsx`);
    return !existsSync(story);
  });
}

function currentSnapshot() {
  return {
    version: 1,
    rules: auditDrift(),
  };
}

function writeBaseline(snapshot) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Updated ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
}

function designDebtLeaderboard(snapshot, limit = 5) {
  return Object.entries(snapshot.rules)
    .flatMap(([key, ruleResult]) => {
      const rule = RULES.find((entry) => entry.key === key);
      return ruleResult.topFiles.map((entry) => ({
        ruleLabel: ruleResult.label,
        file: entry.file,
        count: entry.count,
        guidance: rule?.guidance ?? "",
      }));
    })
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, limit);
}

function printDebtLeaderboard(snapshot) {
  const rows = designDebtLeaderboard(snapshot);
  if (rows.length === 0) return;
  console.log("");
  console.log("Top design debt targets:");
  for (const row of rows) {
    console.log(`  - ${row.file}: ${row.count} ${row.ruleLabel}. ${row.guidance}`);
  }
}

function main() {
  const snapshot = currentSnapshot();
  const missingStories = missingPrimitiveStories();

  if (UPDATE_BASELINE) {
    writeBaseline(snapshot);
    if (missingStories.length > 0) {
      console.warn(`Missing primitive stories: ${missingStories.join(", ")}`);
    }
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error("No design-system baseline found.");
    console.error("Run `npm run design-system:update-baseline` after reviewing current drift.");
    process.exit(1);
  }

  const failures = [];
  const improvements = [];

  for (const rule of RULES) {
    const current = snapshot.rules[rule.key].count;
    const allowed = baseline.rules?.[rule.key]?.count;
    if (typeof allowed !== "number") {
      failures.push(`${rule.label}: missing baseline entry`);
      continue;
    }
    if (current > allowed) {
      failures.push(`${rule.label}: ${current} > baseline ${allowed}. ${rule.guidance}`);
    } else if (current < allowed) {
      improvements.push(`${rule.label}: ${current} < baseline ${allowed}`);
    }
  }

  for (const moduleName of missingStories) {
    failures.push(
      `Primitive ${moduleName} is exported from components/ui but has no Storybook story.`,
    );
  }

  if (failures.length > 0) {
    console.error("[fail] apps/ui design-system audit failed");
    console.error("");
    for (const failure of failures) console.error(`  - ${failure}`);
    printDebtLeaderboard(snapshot);
    console.error("");
    console.error("Reduce the drift, use primitives, or update the baseline only as part of");
    console.error("a deliberate design-system migration reviewed with the changed call sites.");
    process.exit(1);
  }

  console.log("[ok] apps/ui design-system audit clean");
  for (const improvement of improvements) console.log(`  improved: ${improvement}`);
  printDebtLeaderboard(snapshot);
}

main();
