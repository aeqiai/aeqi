#!/usr/bin/env node
// verify-url-contract.mjs
//
// Static URL-contract verifier. Greps every UI-side API call URL and asserts
// that it matches a route registered by the platform Rust crate
// (`aeqi-platform/src/routes/*.rs`). Catches the bug class where the client
// calls an endpoint that no server route serves and gets a silent 404 (or
// silently 405s through the proxy catch-all). See AEQI idea b3069378 (SA25).
//
// Usage:
//   node scripts/verify-url-contract.mjs
//
// Env:
//   AEQI_PLATFORM_PATH  — path to the aeqi-platform repo (default: ../../../aeqi-platform
//                         relative to this script).
//
// Exit: 0 on full coverage, 1 if any platform-owned URL has no matching route.
//
// Design notes:
//   * Pure Node built-ins (fs, path, url). No npm deps.
//   * Route extraction is a regex parse over `.route("PATTERN", METHOD(handler))`
//     calls in any *.rs file under `src/routes/`. We also pull `.nest("PREFIX", …)`
//     so we can collapse nested routers if any get added.
//   * Client URL extraction reads every `*.ts`/`*.tsx` under `src/`. We look for
//     calls passed to `apiRequest(...)` / `request<T>(...)` (which both prepend
//     `/api`) and raw `fetch("/api/...")` strings.
//   * Platform vs runtime-proxied: the platform has a wildcard catch-all
//     `/api/{*rest}` that forwards to the per-tenant runtime. Any client URL
//     that's not under a *platform-owned* prefix is allowed to fall through
//     to that wildcard — those endpoints live in the runtime crate which this
//     script does not parse. Platform-owned prefixes are listed in
//     `PLATFORM_OWNED_PREFIXES`; everything that matches one of those MUST
//     have an explicit route registration or it's a hard fail.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(__dirname, "..");
const UI_SRC = join(UI_ROOT, "src");
const PLATFORM_ROOT =
  process.env.AEQI_PLATFORM_PATH ||
  resolve(UI_ROOT, "..", "..", "..", "aeqi-platform");
const PLATFORM_ROUTES_DIR = join(PLATFORM_ROOT, "src", "routes");

// Platform-owned URL prefixes. Calls to these MUST hit an explicit
// `.route(...)` registration on the platform; if not, they 404 (or 405)
// instead of falling through to the runtime catch-all proxy. Order matters
// only for human grep clarity; the matcher uses longest-prefix.
const PLATFORM_OWNED_PREFIXES = [
  "/api/auth/",
  "/api/account/",
  "/api/me/",
  "/api/billing/",
  "/api/admin/",
  "/api/trusts",
  "/api/entities",
  "/api/companies/",
  "/api/solana/",
  "/api/curves/",
  "/api/start/",
  "/api/runtime/",
  "/api/architect/",
  "/api/walks/",
  "/api/identity/",
  "/api/hosting/",
  "/api/keys",
  "/api/invitations/",
  "/api/integrations/",
  "/api/wallet/",
  "/api/webhooks/",
  "/api/diagnostics/",
  "/api/public/",
  "/api/economy/",
  "/api/blueprints",
  "/api/mcp",
  "/api/health",
];

// Client-URL allowlist: paths the verifier intentionally skips. Add a path
// here only with a written reason; bypassing the check is how the SA25 bug
// crept in originally.
const CLIENT_ALLOWLIST = new Set([
  // None for now. Documented escape hatch only.
]);

function walk(dir, ext) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(p, ext));
    } else if (ext.some((e) => name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

// ----- Server route extraction -----

// Matches `.route("PATTERN", ...)` capturing the pattern. The METHOD portion
// is captured separately by a second pass that scans the same call to find
// `get(`, `post(`, `put(`, `delete(`, `any(`, `.get(`, `.post(`, ...
const ROUTE_RE = /\.route\(\s*"([^"]+)"\s*,([\s\S]*?)\)\s*;?\s*$/gm;
// Looser single-line version that fires on each .route(...) line in dense
// router files — many entries are one-liners.
const ROUTE_RE_INLINE = /\.route\(\s*"([^"]+)"\s*,([^)]*\)[^)]*)\)/g;

const METHOD_TOKENS = ["get", "post", "put", "delete", "patch", "any"];

function extractServerRoutes() {
  const files = walk(PLATFORM_ROUTES_DIR, [".rs"]);
  // Also include router.rs siblings: routes/router.rs is the canonical wire
  // list; routes/mod.rs may have inline routes; bin/* could declare auxiliary
  // mounts. For the SA25 bug we only care about prod-served routes, which all
  // live under src/routes/*.
  const seen = new Set();
  const routes = []; // { pattern, methods: Set<string>, file }

  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    // Use the inline regex; it handles both one-line and multi-line .route(..)
    // forms because `[^)]*\)[^)]*` lets the body contain nested parens at
    // most one level deep (e.g. `get(routes::foo::handler)`), which is the
    // shape these files actually use.
    let m;
    while ((m = ROUTE_RE_INLINE.exec(txt))) {
      const pattern = m[1];
      const body = m[2];
      const methods = new Set();
      for (const tok of METHOD_TOKENS) {
        const re = new RegExp(`(?:^|[\\s.(])${tok}\\s*\\(`, "g");
        if (re.test(body)) methods.add(tok.toUpperCase());
      }
      // `.route("/x", any(...))` accepts any method.
      if (methods.has("ANY")) {
        for (const tok of METHOD_TOKENS) if (tok !== "any") methods.add(tok.toUpperCase());
      }
      const key = `${pattern}::${[...methods].sort().join(",")}::${f}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ pattern, methods, file: f.replace(PLATFORM_ROOT + "/", "") });
    }
  }
  return routes;
}

// Convert an axum pattern (e.g. `/api/foo/{id}` or `/api/foo/{*rest}`) into a
// regex that matches client URL templates after we've stripped TS template
// literal interpolations.
function patternToRegex(pattern) {
  // Replace axum placeholders FIRST (before regex-escaping), so we don't have
  // to dance around escaped braces.
  //   `{*rest}` → catch-all (any remaining chars).
  //   `{name}`  → single path segment (no `/`).
  const placeholdered = pattern
    .replace(/\{\*[a-zA-Z_][a-zA-Z0-9_]*\}/g, "\x00CATCHALL\x00")
    .replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, "\x00SEGMENT\x00");
  const escaped = placeholdered.replace(/[.+^$()|[\]\\{}?*]/g, "\\$&");
  const re = escaped
    .replace(/\x00CATCHALL\x00/g, ".*")
    .replace(/\x00SEGMENT\x00/g, "[^/]+");
  return new RegExp(`^${re}$`);
}

// ----- Client URL extraction -----

// `request<T>("/path", ...)` and `apiRequest<T>("/path", ...)`. We capture
// both the path and the call site so we can pinpoint orphans. `request` (the
// imported alias for `apiRequest`) prepends `/api` itself, so the captured
// path is the relative tail.
const REQUEST_CALL_RE =
  /(?:apiRequest|request)\s*(?:<[^>]*>)?\s*\(\s*[`"]([^`"]+)[`"]/g;
// `fetch("/api/...")` with either a plain string or a template literal that
// starts with `/api/`. Template-literal interpolations get normalized to a
// `{id}`-style placeholder so they can compare to axum's `{id}` form.
const FETCH_CALL_RE = /fetch\s*\(\s*[`"](\/api\/[^`"$]*?)(?:`|")/g;
// Template-literal fetch with interpolation: fetch(`/api/foo/${id}/bar`)
const FETCH_TEMPLATE_RE = /fetch\s*\(\s*`(\/api\/[^`]+)`/g;

// Methods used at the call site. Best-effort: look for `method: "POST"` etc.
// within ~200 chars after the URL string.
const METHOD_PATTERN = /method\s*:\s*["']([A-Z]+)["']/;

function normalizeTemplate(url) {
  // `/api/foo/${id}/bar` → `/api/foo/{x}/bar`
  return url.replace(/\$\{[^}]+\}/g, "{x}");
}

function extractClientUrls() {
  const files = walk(UI_SRC, [".ts", ".tsx"]);
  const urls = []; // { path, fullPath, method, file, line }

  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    const lines = txt.split("\n");
    const lineOffsets = [];
    {
      let off = 0;
      for (const l of lines) {
        lineOffsets.push(off);
        off += l.length + 1;
      }
    }
    const lineFor = (idx) => {
      let lo = 0,
        hi = lineOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineOffsets[mid] <= idx) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };

    // apiRequest / request calls: path is relative (no /api prefix).
    let m;
    REQUEST_CALL_RE.lastIndex = 0;
    while ((m = REQUEST_CALL_RE.exec(txt))) {
      let path = normalizeTemplate(m[1]);
      // Only treat strings that look like paths (start with /). The
      // `apiRequest` signature also accepts second-arg URLs in some helpers,
      // so we skip non-path strings.
      if (!path.startsWith("/")) continue;
      const fullPath = path.startsWith("/api/") || path === "/api"
        ? path
        : `/api${path}`;
      const ctx = txt.slice(m.index, m.index + 400);
      const mm = ctx.match(METHOD_PATTERN);
      const method = mm ? mm[1] : "GET";
      urls.push({
        path,
        fullPath,
        method,
        file: f.replace(UI_ROOT + "/", ""),
        line: lineFor(m.index),
      });
    }

    // Raw fetch("/api/...") — plain string.
    FETCH_CALL_RE.lastIndex = 0;
    while ((m = FETCH_CALL_RE.exec(txt))) {
      const fullPath = normalizeTemplate(m[1]);
      const ctx = txt.slice(m.index, m.index + 400);
      const mm = ctx.match(METHOD_PATTERN);
      const method = mm ? mm[1] : "GET";
      urls.push({
        path: fullPath.replace(/^\/api/, ""),
        fullPath,
        method,
        file: f.replace(UI_ROOT + "/", ""),
        line: lineFor(m.index),
      });
    }

    // Raw fetch(`/api/...${x}...`) — template literal.
    FETCH_TEMPLATE_RE.lastIndex = 0;
    while ((m = FETCH_TEMPLATE_RE.exec(txt))) {
      const fullPath = normalizeTemplate(m[1]);
      const ctx = txt.slice(m.index, m.index + 400);
      const mm = ctx.match(METHOD_PATTERN);
      const method = mm ? mm[1] : "GET";
      urls.push({
        path: fullPath.replace(/^\/api/, ""),
        fullPath,
        method,
        file: f.replace(UI_ROOT + "/", ""),
        line: lineFor(m.index),
      });
    }
  }
  return urls;
}

// ----- Matching -----

function isPlatformOwned(fullPath) {
  for (const pre of PLATFORM_OWNED_PREFIXES) {
    if (fullPath === pre || fullPath.startsWith(pre)) return true;
  }
  return false;
}

function methodMatches(serverMethods, clientMethod) {
  // Server `any(...)` means all methods are accepted; we converted any → set
  // of all method tokens upstream, so a literal containsCheck works.
  return serverMethods.has(clientMethod.toUpperCase());
}

// The catch-all proxy `/api/{*rest}` forwards anything unmatched to the
// per-tenant runtime crate. Treating it as a concrete match would defeat the
// whole purpose of this script: every URL would trivially "match" and orphans
// would never surface. We exclude it so platform-owned URLs must hit an
// explicit route registration to be considered covered.
const CATCHALL_PATTERNS = new Set(["/api/{*rest}", "/api/{*path}", "/api/llm/v1/{*path}"]);

function findMatch(routes, url) {
  // Strip query strings before pattern match — axum routes never include `?`.
  const pathOnly = url.fullPath.split("?")[0].replace(/\/$/, "") || "/";
  // Try each route; collect ones where the pattern matches the URL path.
  // Normalize the client's `{x}` placeholder to `[^/]+` for the pattern's
  // regex segment, since axum's `{name}` was also converted to `[^/]+`. So
  // the client's `{x}` must satisfy the route regex naturally.
  const candidates = routes.filter(
    (r) => !CATCHALL_PATTERNS.has(r.pattern) && patternToRegex(r.pattern).test(pathOnly),
  );
  if (candidates.length === 0) return null;
  // Prefer a candidate that supports the client's HTTP method.
  const methodOk = candidates.find((r) => methodMatches(r.methods, url.method));
  return methodOk || candidates[0];
}

// ----- Main -----

function main() {
  const routes = extractServerRoutes();
  const urls = extractClientUrls();

  const orphans = []; // { url, reason }
  const methodMismatches = [];
  let covered = 0;

  for (const u of urls) {
    if (CLIENT_ALLOWLIST.has(u.fullPath)) {
      covered++;
      continue;
    }
    const match = findMatch(routes, u);
    if (!match) {
      if (isPlatformOwned(u.fullPath)) {
        orphans.push({ url: u, reason: "no server route" });
      } else {
        // Falls through to runtime catch-all — not a platform-side miss.
        covered++;
      }
      continue;
    }
    if (!methodMatches(match.methods, u.method)) {
      methodMismatches.push({ url: u, route: match });
      continue;
    }
    covered++;
  }

  // Always print a summary line first.
  //
  // Method mismatches (WARN) are advisory only. The HTTP method heuristic
  // looks at the ~400 chars after each captured URL for `method: "X"`; calls
  // with no explicit `method:` literal default to GET, which produces false
  // positives on POST helpers that pass a body via the second-arg
  // `RequestInit` object. False positives in WARN are tolerable; false
  // negatives in FAIL are not — that's the SA25 bug class this script exists
  // to catch.
  const ok = orphans.length === 0;
  console.log(
    `URL contract: ${urls.length} client calls / ${routes.length} server routes parsed`,
  );
  console.log(`Platform root: ${PLATFORM_ROOT}`);

  if (orphans.length > 0) {
    console.log("");
    console.log(`FAIL: ${orphans.length} client URL(s) have no matching server route:`);
    for (const o of orphans) {
      console.log(
        `  ${o.url.method.padEnd(6)} ${o.url.fullPath}   (${o.url.file}:${o.url.line})`,
      );
    }
  }
  if (methodMismatches.length > 0) {
    console.log("");
    console.log(
      `WARN: ${methodMismatches.length} client URL(s) have a route but the HTTP method is unregistered:`,
    );
    for (const m of methodMismatches) {
      console.log(
        `  ${m.url.method.padEnd(6)} ${m.url.fullPath}   route=${m.route.pattern} methods=[${[...m.route.methods].join(",")}]   (${m.url.file}:${m.url.line})`,
      );
    }
  }

  if (ok) {
    console.log("");
    console.log(`OK: ${covered} URLs covered by ${routes.length} routes`);
    process.exit(0);
  }
  process.exit(1);
}

main();
