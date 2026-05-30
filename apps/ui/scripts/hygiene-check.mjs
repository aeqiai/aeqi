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
 *   4. New `apiRequest("/api/...")` calls are forbidden — apiRequest
 *      already prepends /api; the duplicate prefix 404s.
 *   5. Hand-crafted `/c/<id>` URL literals are forbidden outside the
 *      canonical helpers (lib/entityPath.ts, lib/sessionUrl.ts,
 *      hooks/useNav.ts, components/AppLayout.tsx). Use entityPath() /
 *      entityPathFromId() so on-chain entities resolve to /trust/<addr>.
 *      Sweep landed 2026-05-07 (44 literals across 28 files).
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
 * Wired into scripts/git-hooks/pre-commit before the existing apps/ui check +
 * lint + test steps. Exits 0 on clean, 1 on drift introduced.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const STAGED = process.argv.includes("--staged");
const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

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
  {
    // apiRequest already prepends API_BASE_URL ("/api"), so paths must
    // NOT start with /api/. Calling apiRequest("/api/foo") produces
    // /api/api/foo and 404s. Same trap fixed twice (01aae710, 9f607ce2);
    // catch it before the third occurrence ships.
    pattern: /\bapiRequest[<\w>]*\(\s*["'`]\/api\//g,
    message:
      'apiRequest already prepends /api — drop the /api/ prefix from the path arg (e.g. apiRequest("/architect/draft"), not apiRequest("/api/architect/draft"))',
  },
  {
    // Hand-crafted /c/<id> URL literals bypass the canonical entityPath()
    // resolver, which routes on-chain entities to /trust/<addr> and
    // pending ones to /c/<id>. Drift sweep 2026-05-07 found 44 such
    // literals across 28 files. Catch new ones at the source.
    // Allowed: lib/entityPath.ts (the helper itself), lib/sessionUrl.ts,
    // hooks/useNav.ts, components/AppLayout.tsx (the canonical fallback
    // when entity isn't yet on-chain). Test files are excluded by the
    // diff filter (only src/**/*.{ts,tsx,css} is scanned, but tests
    // under src/test/ still match — the FILE_ALLOWLIST below skips them).
    pattern: /[`'"]\/c\/(?:\$\{|" ?\+|' ?\+)/g,
    message:
      "Hand-crafted /c/<id> URL literal — use entityPath(entity, ...) or entityPathFromId(entities, id, ...) from @/lib/entityPath so on-chain entities resolve to /trust/<addr>",
    allowFiles: new Set([
      "apps/ui/src/lib/entityPath.ts",
      "apps/ui/src/lib/sessionUrl.ts",
      "apps/ui/src/hooks/useNav.ts",
      "apps/ui/src/components/AppLayout.tsx",
    ]),
    skipDirs: ["apps/ui/src/test/"],
  },
];

const GLOBAL_FORBIDDEN_PATTERNS = [
  {
    pattern: /(?=.*\b(?:trust_address|trustAddress|trustId)\b)(?=.*\.toLowerCase\()/,
    message:
      "Do not case-fold trust addresses or trust ids. Solana base58 identifiers are case-sensitive; preserve the exact string.",
  },
];

function changedLines() {
  const cmd = STAGED
    ? "git diff --cached --unified=0 -- 'apps/ui/src/**/*.tsx' 'apps/ui/src/**/*.ts' 'apps/ui/src/**/*.css'"
    : "git diff --unified=0 -- 'apps/ui/src/**/*.tsx' 'apps/ui/src/**/*.ts' 'apps/ui/src/**/*.css'";
  const diff = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" });
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

function sourceFiles() {
  const out = execSync(
    "git ls-files -- 'apps/ui/src/**/*.tsx' 'apps/ui/src/**/*.ts' 'apps/ui/src/**/*.css'",
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  return out.split("\n").filter((file) => file && existsSync(`${REPO_ROOT}/${file}`));
}

function fullTreeViolations() {
  const violations = [];
  for (const file of sourceFiles()) {
    const lines = readFileSync(`${REPO_ROOT}/${file}`, "utf-8").split("\n");
    lines.forEach((line, idx) => {
      for (const { pattern, message } of GLOBAL_FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file,
            line: line.trim(),
            lineNumber: idx + 1,
            match: "case-folded trust identifier",
            message,
          });
        }
      }
    });
  }
  return violations;
}

function main() {
  const added = changedLines();
  const violations = fullTreeViolations();

  for (const { file, line } of added) {
    for (const { pattern, message, allowFiles, skipDirs } of FORBIDDEN_PATTERNS) {
      if (allowFiles && allowFiles.has(file)) continue;
      if (skipDirs && skipDirs.some((d) => file.startsWith(d))) continue;
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
    console.error(`  ${v.file}${v.lineNumber ? `:${v.lineNumber}` : ""}`);
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
