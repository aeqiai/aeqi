#!/usr/bin/env node
/**
 * Design-system hygiene check — fail when hand-rolled Tailwind drift is
 * staged into apps/ui.
 *
 * Mirror of aeqi-landing/scripts/hygiene-check.mjs. The landing repo had a
 * 158-site drift sweep on 2026-04-28 (text-black/N → text-ink-* tokens) and
 * shipped this static check to keep drift from reappearing. This is the
 * same shield for the app side. apps/ui is already Tailwind-free in
 * practice (zero matches today) so this fires only on intentional or
 * accidental new introductions.
 *
 * Rules — same as the landing version:
 *   1. New occurrences of `text-black/\d+` are forbidden — use the
 *      semantic ink tokens defined in src/styles/primitives.css
 *      (--text-primary / --text / --text-secondary / --text-muted /
 *      --text-disabled), or the canonical --color-ink-* if working
 *      with package tokens directly.
 *   2. New occurrences of `border-black/\[?0\.0[346]\]?` are forbidden —
 *      use border-border / border-divider (or the equivalent semantic
 *      class in primitives.css).
 *   3. New occurrences of `bg-black/\[?0\.0[34]\]?` are forbidden —
 *      use bg-hover / bg-divider.
 *
 * Exceptions:
 *   - Heavier overrides (e.g. border-black/[0.08], /10, /15, /20) remain
 *     legal — they're intentional emphasis, not drift.
 *   - Hover states with no canonical equivalent (e.g. hover:text-black/95)
 *     remain legal until the ink scale grows a hover tier.
 *   - Existing instances are grandfathered in; this check only fires when
 *     a NEW file or NEW addition introduces drift relative to git HEAD.
 *
 * Run manually:
 *   node apps/ui/scripts/hygiene-check.mjs            # working tree
 *   node apps/ui/scripts/hygiene-check.mjs --staged   # git diff --cached
 *
 * Wired into .husky/pre-commit before the existing apps/ui check + lint +
 * test steps. Exits 0 on clean, 1 on drift introduced.
 */

import { execSync } from "node:child_process";

const STAGED = process.argv.includes("--staged");

const FORBIDDEN_PATTERNS = [
  {
    pattern: /\btext-black\/\d+/g,
    message:
      "Use semantic text tokens from primitives.css (--text-primary / --text-secondary / --text-muted / --text-disabled) or text-ink-* utility tokens",
  },
  {
    pattern: /\bborder-black\/\[?0\.0[346]\]?/g,
    message: "Use border-border (0.06) or border-divider (0.04) instead",
  },
  {
    pattern: /\bbg-black\/\[?0\.0[34]\]?/g,
    message: "Use bg-hover (0.03) or bg-divider (0.04) instead",
  },
];

function changedLines() {
  const cmd = STAGED
    ? "git diff --cached --unified=0 -- 'apps/ui/src/**/*.tsx' 'apps/ui/src/**/*.ts' 'apps/ui/src/**/*.css'"
    : "git diff --unified=0 -- 'apps/ui/src/**/*.tsx' 'apps/ui/src/**/*.ts' 'apps/ui/src/**/*.css'";
  const diff = execSync(cmd, { encoding: "utf-8" });
  const out = [];
  let file = null;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ b/")) file = raw.slice(6);
    else if (raw.startsWith("+") && !raw.startsWith("+++")) {
      out.push({ file, line: raw.slice(1) });
    }
  }
  return out;
}

function main() {
  const added = changedLines();
  const violations = [];

  for (const { file, line } of added) {
    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      const matches = line.match(pattern);
      if (matches) {
        for (const m of matches) {
          violations.push({ file, line: line.trim(), match: m, message });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log("✓ apps/ui design-system hygiene clean");
    process.exit(0);
  }

  console.error(`✗ apps/ui design-system hygiene: ${violations.length} drift introduction(s)`);
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.match} — ${v.message}`);
    console.error(`    ${v.line.length > 100 ? v.line.slice(0, 100) + "…" : v.line}`);
    console.error("");
  }
  console.error("If the override is genuinely intentional (heavier emphasis,");
  console.error("hover with no canonical tier), reach for a heavier value");
  console.error("(e.g. border-black/[0.08]+, hover:text-black/95) — those are legal.");
  process.exit(1);
}

main();
