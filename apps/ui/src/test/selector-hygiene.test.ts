import { describe, it, expect } from "vitest";

/**
 * Static guard against React error #185 (Maximum update depth exceeded).
 *
 * Zustand selectors must return stable references across renders. The classic
 * footgun is:
 *
 *   const xs = useStore((s) => s.list || []);  // ❌ fresh [] every call
 *
 * When `s.list` is undefined, `|| []` returns a brand-new empty array on every
 * invocation. React sees a new reference, re-renders, calls the selector
 * again, gets another new []... infinite loop.
 *
 * The fix is a module-level constant:
 *
 *   const EMPTY: Foo[] = [];
 *   const xs = useStore((s) => s.list ?? EMPTY);  // ✅ stable
 *
 * This test walks the entire source tree via Vite's `import.meta.glob` and
 * fails if any file re-introduces the pattern. It runs in milliseconds and is
 * the cheapest possible CI guard against a bug that's very expensive in prod.
 */

/**
 * Matches `useFooStore((s) => ... || [])` or `... ?? []` / `{}` at the tail
 * of the selector body. Tolerates optional whitespace and trailing type
 * assertions, but not arbitrary multi-line expressions (keep it simple —
 * multi-line selectors are unusual and should be flagged for human review).
 */
const DANGEROUS_SELECTOR =
  /use\w+Store\s*\(\s*\(\s*\w+\s*\)\s*=>[^)]*(\|\||\?\?)\s*(\[\s*\]|\{\s*\})\s*\)/;

// Vite pulls every .ts/.tsx under src/ at test time. `as: "raw"` gives us
// the file contents as strings without executing them.
const files = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("selector hygiene", () => {
  it("no Zustand selector returns a fresh [] or {} via || / ?? fallback", () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(files)) {
      // Skip this file itself (it contains the pattern as a regex literal).
      if (path.endsWith("/selector-hygiene.test.ts")) continue;
      content.split("\n").forEach((line, i) => {
        if (DANGEROUS_SELECTOR.test(line)) {
          offenders.push(`${path}:${i + 1}\n  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      [
        "Found Zustand selector(s) that return a fresh reference, which causes React error #185.",
        "Replace with a module-level constant: `const EMPTY: T[] = []; ... s.x ?? EMPTY`.",
        "",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
