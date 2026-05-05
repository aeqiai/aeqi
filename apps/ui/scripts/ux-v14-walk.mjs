#!/usr/bin/env node
/**
 * UX Walk v14 — 2026-05-05
 * Fourteenth UX pass. Post hairline REAL fix (commit d3fc9745).
 *
 * PRIMARY PURPOSE: Verify whether d3fc9745 actually reduced visible hairlines
 * vs the cosmetic swap in 4d8808fd (caught by v13).
 *
 * d3fc9745 commit claims:
 * - Reverts the box-shadow swap from 4d8808fd
 * - Badge/pill borders dropped; tints carry separation
 * - Card outlines use tint vs page background
 * - Row separators use gap:1px instead of inset shadow
 * - Section dividers use increased padding/margin-top
 * - Form inputs restored to real border:1px solid (semantic)
 * - Interactive states use outline instead of box-shadow
 * - Code blocks keep real border:1px (semantic content boundaries)
 * - Inset box-shadow count drops to zero across all 12 affected CSS files
 *
 * EXTENDED HAIRLINE DETECTOR (v14 — fixes v13 computed-style regex bug):
 *
 * v13 shadow detector bug (CLAUDE.md warning): The browser reorders
 * `box-shadow` computed style — color is moved FIRST, `inset` moves LAST:
 *   CSS source:  "inset 0 0 0 1px rgba(0,0,0,0.1)"
 *   Computed:    "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px inset"
 *
 * v13 checked `bs.includes("inset") && bs.includes("1px")` which matched
 * "inset" in computed style but the shadow pattern was detecting the BROWSER's
 * format. The fix: match the COMPUTED format pattern: `/ 0px 0px 0px 1px inset/`
 * and `/ 0px [-]?1px 0px 0px inset/` (for edge shadows).
 *
 * EXPECTED OUTCOME:
 * - v13 shadow count was misleadingly low (regex matched wrong format)
 * - v14 with correct regex should show near-zero shadow hairlines (d3fc9745 removed them)
 * - CSS border hairlines should be higher (form inputs/code blocks restored to real border)
 * - Combined total should DROP substantially (decorative removed; semantic kept)
 *
 * v13 score: 9.6/10
 * v13 hairline summary: combined ranged 0-55 per route, 13/27 routes >5
 * Target after d3fc9745: routes >5 to drop below 6/27
 *
 * Live bundle: index-DAVv30ya.js (still same bundle — this is a pre-deploy run
 *              against prod to establish baseline; the fix is in main, deploy follows)
 *
 * NOTE: d3fc9745 is committed to main but the live bundle has NOT been redeployed
 * yet. This walk tests the CURRENT live UI. The hairline reduction will be visible
 * once ui-deploy.sh runs. Walk detects hairline state of d3fc9745-deployed code.
 * If bundle hash is still DAVv30ya → comparing against pre-fix UI (establishes delta).
 * If bundle hash has moved → comparing against post-fix UI (confirms reduction).
 *
 * Output:
 *   Screenshots → /home/claudedev/aeqi/.observations/ux-v14/
 *   Raw JSON   → /home/claudedev/aeqi/.observations/ux-v14/raw.json
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node apps/ui/scripts/ux-v14-walk.mjs
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = "/home/claudedev/aeqi";
const SCREENSHOT_DIR = join(REPO_ROOT, ".observations", "ux-v14");
const RAW_JSON = join(SCREENSHOT_DIR, "raw.json");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Auth setup ────────────────────────────────────────────────────────────────
const AEQI_WEB_SECRET = process.env.AEQI_WEB_SECRET;
if (!AEQI_WEB_SECRET) {
  console.error("AEQI_WEB_SECRET required — set it in env before running");
  process.exit(1);
}

const USER_ID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
const EMAIL = "eqaq131@gmail.com";

// Primary entity (Luca Eich personal — regression base)
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff";
const AGENT_ID = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";

// v11 new-trust entity (regression check)
const NEW_ENTITY_ID = "fe1780cb-ce83-44c1-8971-eed846f77941";
const NEW_TRUST_ADDRESS = "0xdb58fd698d6ec8742c8c5af70cdb658e408c10f8";
const NEW_TRUST_ID = "0xfe1780cbce8344c18971eed846f7794100000000000000000000000000000000";

// v12 trust routing entity (carry-forward regression check)
const REDIRECT_ENTITY_ID = "9642ce17-ea35-4eb2-981a-0d7984a5f759";
const REDIRECT_TRUST_ADDR = "0xc321f39f8db2a05d664094982bd05b4214b90096";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" },
).trim();

console.log(`JWT minted: ${TOKEN.slice(0, 40)}...`);
console.log(`Primary entity: ${ENTITY_ID} (Luca Eich)`);
console.log(`v11 NEW entity: ${NEW_ENTITY_ID} (trust @ ${NEW_TRUST_ADDRESS})`);
console.log(`v12 redirect test entity: ${REDIRECT_ENTITY_ID} (trust @ ${REDIRECT_TRUST_ADDR})`);
console.log(`\nv14 PRIMARY FOCUS: verify d3fc9745 real hairline fix`);
console.log(`  FIXED regex: browser computed style is "rgba(...) Xpx Xpx Xpx 1px inset"`);
console.log(`  NOT "inset 0 0 0 1px rgba(...)" — v13 regex was checking source order`);
console.log(`  v14 regex: / 0px 0px 0px 1px inset/ and / 0px [-]?1px 0px 0px inset/`);

// ── v14-E: Pre-walk probes ────────────────────────────────────────────────────
async function probeIndexer() {
  const result = {};

  await new Promise((resolve) => {
    const body = JSON.stringify({ query: "{ trustsCount }" });
    const req = http.request(
      {
        hostname: "localhost",
        port: 8501,
        path: "/graphql",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            result.trustsCount = parsed.data?.trustsCount ?? -1;
          } catch (_) {
            result.trustsCount = -1;
          }
          resolve();
        });
      },
    );
    req.on("error", () => { result.trustsCount = -1; resolve(); });
    req.write(body);
    req.end();
  });

  await new Promise((resolve) => {
    const gqlQuery = `{ rolesForTrust(trustId: "${NEW_TRUST_ID}") { account roleTypeId slotIndex } }`;
    const body = JSON.stringify({ query: gqlQuery });
    const req = http.request(
      {
        hostname: "localhost",
        port: 8501,
        path: "/graphql",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            result.newEntityRoles = parsed.data?.rolesForTrust ?? [];
          } catch (_) {
            result.newEntityRoles = [];
          }
          resolve();
        });
      },
    );
    req.on("error", () => { result.newEntityRoles = []; resolve(); });
    req.write(body);
    req.end();
  });

  return result;
}

async function probeWalletUpgradeApi(token) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ credential: "test-probe" });
    const req = https.request(
      {
        hostname: "app.aeqi.ai",
        path: "/api/wallet/upgrade-to-passkey",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: data.slice(0, 200) });
        });
      },
    );
    req.on("error", (err) => resolve({ status: -1, error: err.message }));
    req.write(body);
    req.end();
  });
}

async function probeServerRedirect() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "app.aeqi.ai",
        path: `/c/${REDIRECT_ENTITY_ID}/overview`,
        method: "GET",
        headers: { Cookie: `aeqi_token=${TOKEN}` },
      },
      (res) => {
        resolve({
          status: res.statusCode,
          location: res.headers["location"] ?? null,
        });
      },
    );
    req.on("error", (err) => resolve({ status: -1, error: err.message }));
    req.end();
  });
}

// Check live bundle to determine if d3fc9745 is deployed
async function probeLiveBundleHash() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "app.aeqi.ai",
        path: "/",
        method: "GET",
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const match = data.match(/index-([A-Za-z0-9_-]+)\.js/);
          resolve(match ? match[0] : "unknown");
        });
      },
    );
    req.on("error", () => resolve("probe-failed"));
    req.end();
  });
}

console.log("\n=== v14-E: Pre-walk probes ===");
const indexerProbe = await probeIndexer();
console.log(`trustsCount: ${indexerProbe.trustsCount}`);
console.log(`v11 entity roles (regression): ${JSON.stringify(indexerProbe.newEntityRoles)}`);

const walletProbeResult = await probeWalletUpgradeApi(TOKEN);
console.log(`\nWallet upgrade API probe: HTTP ${walletProbeResult.status}`);

const serverRedirectProbe = await probeServerRedirect();
const expectedLocation = `/trust/${REDIRECT_TRUST_ADDR}/overview`;
const serverRedirectOk = serverRedirectProbe.status === 308 &&
  serverRedirectProbe.location === expectedLocation;
console.log(`Server-side redirect probe: HTTP ${serverRedirectProbe.status} → ${serverRedirectProbe.location}`);
console.log(serverRedirectOk ? "  [PASS] 308 confirmed" : `  [?] Got ${serverRedirectProbe.status}`);

const liveBundleHash = await probeLiveBundleHash();
const V13_BUNDLE = "index-DAVv30ya.js";
const isPreFix = liveBundleHash === V13_BUNDLE;
console.log(`\nLive bundle: ${liveBundleHash}`);
console.log(isPreFix
  ? `  [PRE-FIX] d3fc9745 not yet deployed — comparing against old bundle (delta baseline)`
  : `  [POST-FIX] New bundle — d3fc9745 is deployed, verifying actual fix`);

// ── Route manifest (27 original routes + carry-forward trust routes) ──────────
const ROUTES = [
  { url: "https://aeqi.ai/", label: "landing-home", auth: false },
  { url: "https://aeqi.ai/docs", label: "landing-docs", auth: false },
  { url: "https://aeqi.ai/economy", label: "landing-economy", auth: false },
  { url: "https://app.aeqi.ai/signup", label: "app-signup", auth: false },
  { url: "https://app.aeqi.ai/signin", label: "app-signin", auth: false },
  { url: "https://app.aeqi.ai/", label: "app-root", auth: true },
  { url: `https://app.aeqi.ai/me`, label: "me-root", auth: true },
  { url: `https://app.aeqi.ai/me/agents`, label: "me-agents", auth: true },
  { url: `https://app.aeqi.ai/me/quests`, label: "me-quests", auth: true },
  { url: `https://app.aeqi.ai/me/ideas`, label: "me-ideas", auth: true },
  { url: `https://app.aeqi.ai/me/events`, label: "me-events", auth: true },
  { url: `https://app.aeqi.ai/me/treasury`, label: "me-treasury", auth: true },
  { url: `https://app.aeqi.ai/me/settings`, label: "me-settings", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}`, label: "company-overview", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/roles`, label: "company-roles", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/ownership`, label: "company-ownership", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/treasury`, label: "company-treasury", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/governance`, label: "company-governance", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/settings`, label: "company-settings", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}`, label: "agent-overview", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/sessions`, label: "agent-sessions", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/quests`, label: "agent-quests", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/events`, label: "agent-events", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/agents/${AGENT_ID}/ideas`, label: "agent-ideas", auth: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}`, label: "new-company-overview", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/ownership`, label: "new-company-ownership", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/treasury`, label: "new-company-treasury", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/governance`, label: "new-company-governance", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${REDIRECT_ENTITY_ID}/overview`, label: "trust-redirect-test", auth: true, isTrustRedirect: true },
  { url: `https://app.aeqi.ai/trust/${REDIRECT_TRUST_ADDR}/overview`, label: "trust-direct-hit", auth: true, isTrustDirect: true },
  { url: `https://app.aeqi.ai/blueprints`, label: "app-blueprints", auth: true },
  { url: `https://app.aeqi.ai/economy`, label: "app-economy", auth: true },
  { url: `https://app.aeqi.ai/start`, label: "app-start", auth: true },
];

// ── Anti-pattern detector (v14 — fixes v13 shadow regex to match COMPUTED style) ──
//
// KEY FIX in v14:
// Browser computed style reorders box-shadow: color comes FIRST, inset moves LAST.
// CSS source:  "inset 0 0 0 1px rgba(0,0,0,0.1)"
// Computed:    "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px inset"
//
// v13 shadow hairline patterns matched correctly (includes "inset" check), but
// the regex pattern `/ 0px 0px 0px 1px inset/` is the correct computed format.
// v13's regex `inset\s+0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+1px` was matching
// the CSS *source* format, not the *computed* format returned by getComputedStyle.
// Result: v13 undercounted shadow hairlines even when they existed.
//
// v14 FIX: Use computed-format patterns:
//   All-side 1px inset: ends with " 0px 0px 0px 1px inset"
//   Top edge inset:     ends with " 0px 1px 0px 0px inset"
//   Bottom edge inset:  ends with " 0px -1px 0px 0px inset"
const DETECT_ANTIPATTERNS = `() => {
  const issues = [];
  const body = document.body;
  if (!body) return issues;
  const allText = body.innerText || "";

  // 1. Raw CSS variable literals in text
  if (/var\\(--[a-z][a-z0-9-]+\\)|^--[a-z][a-z0-9-]+:/gm.test(allText)) {
    issues.push({ code: "TOKEN_LITERAL", severity: "P1",
      detail: "Raw CSS var() visible in rendered text" });
  }

  // 2. "undefined" text
  const undefs = (allText.match(/\\bundefined\\b/g) || []).filter(m => m === "undefined");
  if (undefs.length > 0) {
    issues.push({ code: "UNDEFINED_TEXT", severity: "P0",
      detail: "'undefined' appears " + undefs.length + "x" });
  }

  // 3. AEQI uppercase structural check (v8+: excludes session-rail)
  const sessionRailExclude = new Set(
    Array.from(document.querySelectorAll(
      "[class*=sessions-rail],[class*=session-rail],[class*=sessions-sidebar],[class*=session-sidebar],[class*=sessions-list]"
    ))
  );
  const sessionRailDescendants = new Set();
  for (const el of sessionRailExclude) {
    for (const desc of Array.from(el.querySelectorAll("*"))) {
      sessionRailDescendants.add(desc);
    }
  }

  const structuralEls = Array.from(document.querySelectorAll(
    "nav, header, [class*=sidebar],[class*=rail],[class*=Sidebar],[class*=Rail]," +
    "h1,h2,h3,h4,[placeholder],[aria-label],[class*=mission],[class*=Mission]," +
    "[class*=identity],[class*=Identity],[class*=label],[class*=Label]"
  )).filter(el => !sessionRailExclude.has(el) && !sessionRailDescendants.has(el));

  let structuralAeqiCount = 0;
  const structuralAeqiExamples = [];
  for (const el of structuralEls) {
    const t = el.innerText || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
    const matches = t.match(/\\bAEQI\\b/g);
    if (matches) {
      structuralAeqiCount += matches.length;
      if (structuralAeqiExamples.length < 3) {
        structuralAeqiExamples.push("<" + el.tagName + "> \\"" + t.trim().slice(0,50) + "\\"");
      }
    }
  }
  if (structuralAeqiCount > 0) {
    issues.push({ code: "AEQI_UPPERCASE_STRUCTURAL", severity: "P1",
      detail: "Uppercase AEQI " + structuralAeqiCount + "x in structural copy. Examples: " + structuralAeqiExamples.join("; ") });
  }

  const totalAeqi = (allText.match(/\\bAEQI\\b/g) || []).length;
  if (totalAeqi > 0) {
    issues.push({ code: "AEQI_UPPERCASE_TOTAL", severity: "info",
      detail: "Uppercase AEQI " + totalAeqi + "x total" });
  }

  // 4. Pill buttons (excludes cookie consent)
  const cookieEls = new Set(
    Array.from(document.querySelectorAll("[class*=cookie],[class*=consent],[class*=Cookie],[class*=Consent]"))
  );
  const cookieDescendants = new Set();
  for (const el of cookieEls) {
    for (const desc of Array.from(el.querySelectorAll("*"))) {
      cookieDescendants.add(desc);
    }
  }

  // Also exclude by button text (cookie consent buttons don't always have cookie class)
  const cookieButtonTexts = new Set(["Essential only", "Accept all", "Accept All", "Essential Only"]);

  const interactiveEls = Array.from(
    document.querySelectorAll("button, [role=button], a.btn, .btn")
  ).slice(0, 100).filter(el => {
    if (cookieEls.has(el) || cookieDescendants.has(el)) return false;
    const text = (el.textContent || "").trim();
    if (cookieButtonTexts.has(text)) return false;
    return true;
  });

  let actionPillCount = 0;
  let avatarPillCount = 0;
  const actionPillExamples = [];
  for (const el of interactiveEls) {
    const r = parseFloat(window.getComputedStyle(el).borderRadius);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const text = (el.textContent || "").trim().slice(0, 30);
    if (r > 8) {
      const isIconLike = Math.abs(w - h) < 12 && h <= 56 && text.length <= 3;
      const isPill = r >= h * 0.4 && !isIconLike;
      if (isPill) {
        actionPillCount++;
        if (actionPillExamples.length < 5) {
          actionPillExamples.push(r + "px \\"" + text + "\\" inlineStyle=" + (el.style.borderRadius || "none"));
        }
      } else {
        avatarPillCount++;
      }
    }
  }
  if (actionPillCount > 0) {
    issues.push({ code: "ACTION_PILL_BUTTONS", severity: "P1",
      detail: actionPillCount + " action pill buttons (excl. cookie consent). Examples: " + actionPillExamples.join("; ") });
  }
  if (avatarPillCount > 0) {
    issues.push({ code: "ICON_PILL_BUTTONS", severity: "info",
      detail: avatarPillCount + " icon/avatar circular elements (expected)" });
  }

  // 4b. Inline borderRadius 999px
  const inlinePills = Array.from(document.querySelectorAll("[style*='999']")).slice(0, 30).filter(el => {
    return (el.style.borderRadius || "").includes("999");
  });
  if (inlinePills.length > 0) {
    issues.push({ code: "INLINE_999PX_RADIUS", severity: "P0",
      detail: inlinePills.length + " elements with inline borderRadius 999px" });
  }

  // 5. EXTENDED HAIRLINE DETECTOR (v14 — FIXED computed-style regex)
  //
  //    v13 bug: browser reorders box-shadow computed style.
  //    CSS source: "inset 0 0 0 1px rgba(0,0,0,0.1)"
  //    Computed:   "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px inset"
  //
  //    v13 regex matched source order; v14 regex matches computed order.
  //    This means v13 shadow counts were likely accurate (string "inset" still
  //    present in computed style), but the SPECIFICITY check was wrong.
  //    v14 uses the exact computed format to match only true 1px inset hairlines.
  //
  //    d3fc9745 claims to drop inset box-shadow count to zero.
  //    Expected v14 result: shadowHairlineCount ≈ 0 on most routes.
  //    If shadow count is still >0 on many routes, the fix missed some declarations.
  //
  //    SEMANTIC borders kept by d3fc9745 (should appear in border count):
  //      - Code blocks: asv-codeblock, pre fallback, table cells
  //      - Form inputs: inbox-composer, assignee-picker, tpl-search
  //      - Interactive outlines: plan-card--selected uses outline (not border)
  //
  //    DECORATIVE borders removed (border count should DROP):
  //      - Badge/pill outlines: key-pill-border, aeqi-ref-pill
  //      - Card outlines: asv-trail, asv-msg-ask
  //      - Row separators: dash-quest-row top shadow
  //      - Stat cards: stat-card-border

  let borderHairlineCount = 0;        // CSS border: 1px
  let shadowHairlineCount = 0;        // box-shadow: ... 1px inset (computed format)
  let combinedHairlineCount = 0;      // total unique elements with either
  const hairlineExamples = [];
  const shadowExamples = [];

  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 600)) {
    const s = window.getComputedStyle(el);
    let hasBorderHairline = false;
    let hasShadowHairline = false;

    // CSS border hairline
    if (parseFloat(s.borderTopWidth) === 1
        && s.borderTopStyle !== "none"
        && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
      hasBorderHairline = true;
      borderHairlineCount++;
    }

    // Box-shadow inset hairline — v14 FIXED: match COMPUTED style format
    // Browser format: "rgba(R, G, B, A) Hpx Vpx BlurPx SpreadPx inset"
    // All-border 1px:  ends in " 0px 0px 0px 1px inset"
    // Top edge 1px:    ends in " 0px 1px 0px 0px inset"
    // Bottom edge 1px: ends in " 0px -1px 0px 0px inset"
    const boxShadow = s.boxShadow || "";
    if (boxShadow.includes("1px") && boxShadow.includes("inset")) {
      // Split multiple shadows and check each
      const shadowParts = boxShadow.split(/,(?![^()]*\\))/);
      for (const part of shadowParts) {
        const p = part.trim();
        if (!p.includes("inset")) continue;
        // Match computed format: "... 0px 0px 0px 1px inset" (all-side 1px border)
        const allBorderComputed = / 0px 0px 0px 1px inset/.test(p);
        // Match computed format: "... 0px 1px 0px 0px inset" (top hairline)
        const topEdgeComputed = / 0px 1px 0px 0px inset/.test(p);
        // Match computed format: "... 0px -1px 0px 0px inset" (bottom hairline)
        const bottomEdgeComputed = / 0px -1px 0px 0px inset/.test(p);
        if (allBorderComputed || topEdgeComputed || bottomEdgeComputed) {
          hasShadowHairline = true;
          shadowHairlineCount++;
          if (shadowExamples.length < 5) {
            const cls = (el.className || "").toString().slice(0, 40);
            shadowExamples.push(el.tagName + (cls ? "." + cls : "") + " shadow=\\"" + p.slice(0, 80) + "\\"");
          }
          break;
        }
      }
    }

    if (hasBorderHairline || hasShadowHairline) {
      combinedHairlineCount++;
      if (hairlineExamples.length < 5) {
        const cls = (el.className || "").toString().slice(0, 40);
        hairlineExamples.push(el.tagName + (cls ? "." + cls : "") + " [border=" + hasBorderHairline + " shadow=" + hasShadowHairline + "]");
      }
    }
  }

  // v14: separate counts for analysis
  issues.push({ code: "HAIRLINE_BORDER_COUNT_V14", severity: "info",
    detail: "v14 CSS-border hairlines: " + borderHairlineCount });
  issues.push({ code: "HAIRLINE_SHADOW_COUNT_V14", severity: "info",
    detail: "v14 box-shadow inset hairlines (FIXED regex): " + shadowHairlineCount +
      (shadowExamples.length > 0 ? " Examples: " + shadowExamples.join("; ") : "") });
  issues.push({ code: "HAIRLINE_COMBINED_COUNT_V14", severity: combinedHairlineCount > 5 ? "P2" : "info",
    detail: "v14 TOTAL hairlines (border + shadow): " + combinedHairlineCount + (combinedHairlineCount > 5 ? " [P2]" : " [ok]") +
      (hairlineExamples.length > 0 ? " Examples: " + hairlineExamples.join("; ") : "") });

  // Legacy HAIRLINES code for backward compat with score comparison
  if (combinedHairlineCount > 5) {
    issues.push({ code: "HAIRLINES", severity: "P2",
      detail: combinedHairlineCount + " hairlines (border+shadow combined)" });
  }

  // 6. JetBrains Mono
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 150)) {
    const ff = window.getComputedStyle(el).fontFamily || "";
    if (ff.toLowerCase().includes("jetbrains")) {
      issues.push({ code: "JETBRAINS_MONO", severity: "P1",
        detail: "JetBrains Mono on <" + el.tagName + ">" });
      break;
    }
  }

  // 7. Gradient text
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 300)) {
    const s = window.getComputedStyle(el);
    if (s.backgroundImage && s.backgroundImage.includes("gradient") && s.webkitBackgroundClip === "text") {
      issues.push({ code: "GRADIENT_TEXT", severity: "P1",
        detail: "Gradient text on <" + el.tagName + "> \\"" + (el.textContent||"").trim().slice(0,40) + "\\"" });
      break;
    }
  }

  // 8. Fuchsia avatars
  for (const el of Array.from(document.querySelectorAll(
    "[class*=avatar], [class*=Avatar], [class*=dot], [class*=indicator]"
  )).slice(0, 20)) {
    const bg = window.getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/);
    if (m) {
      const [, r, g, b] = m.map(Number);
      if (r > 150 && g < 80 && b > 80 && r > b) {
        issues.push({ code: "FUCHSIA_AVATAR", severity: "P1",
          detail: "Fuchsia color " + bg + " on " + el.className.slice(0,40) });
        break;
      }
    }
  }

  // 9. 404 page
  if (/404|not found|page not found/i.test(allText) && allText.length < 500) {
    issues.push({ code: "404_PAGE", severity: "P0", detail: "404 rendered" });
  }

  // 10. Personal rail leak
  if (window.location.pathname.startsWith("/me")) {
    const sidebarEl = document.querySelector("[class*=sidebar],[class*=rail],[class*=nav],[class*=Sidebar]");
    const sidebarText = (sidebarEl || {}).innerText || "";
    if (/Ownership|Governance/i.test(sidebarText)) {
      issues.push({ code: "PERSONAL_RAIL_LEAK", severity: "P1",
        detail: "Personal rail shows Ownership/Governance (company-only tabs)" });
    }
  }

  // 11. Jade/teal badges
  const badgeEls = Array.from(document.querySelectorAll(
    "[class*=badge],[class*=Badge],[class*=tag],[class*=Tag],[class*=chip],[class*=Chip],[class*=pill],[class*=count]"
  )).slice(0, 60);
  let jadeBadgeCount = 0;
  const jadeBadgeExamples = [];
  for (const el of badgeEls) {
    const s = window.getComputedStyle(el);
    for (const colorProp of [s.color, s.backgroundColor]) {
      const m = colorProp.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/);
      if (m) {
        const [, r, g, b] = m.map(Number);
        if (g > 100 && g > r * 1.3 && g > b * 0.8 && b > 70) {
          jadeBadgeCount++;
          if (jadeBadgeExamples.length < 3) {
            jadeBadgeExamples.push("\\"" + (el.textContent||"").trim().slice(0,20) + "\\" bg=" + s.backgroundColor + " class=" + (el.className || "").slice(0,30));
          }
          break;
        }
      }
    }
  }
  if (jadeBadgeCount > 0) {
    issues.push({ code: "JADE_BADGE_NON_SUCCESS", severity: "P1",
      detail: jadeBadgeCount + " badge(s) with jade/teal color. Examples: " + jadeBadgeExamples.join("; ") });
  }

  // 12. Raw UUID in headings
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuidMatches = allText.match(uuidPattern) || [];
  if (uuidMatches.length > 0) {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,.heading,strong")).slice(0, 30);
    let uuidInHeading = false;
    let uuidHeadingText = "";
    for (const h of headings) {
      const hText = h.innerText || "";
      if (uuidPattern.test(hText)) {
        uuidInHeading = true;
        uuidHeadingText = hText.trim().slice(0, 60);
        uuidPattern.lastIndex = 0;
        break;
      }
      uuidPattern.lastIndex = 0;
    }
    if (uuidInHeading) {
      issues.push({ code: "UUID_AS_LABEL", severity: "P1",
        detail: 'Raw UUID in heading: "' + uuidHeadingText + '"' });
    }
  }

  // 13. "See proposals" build note
  if (allText.includes("See proposals") && allText.includes("Phase 2")) {
    issues.push({ code: "BUILD_NOTE_EXPOSED", severity: "P2",
      detail: '"See proposals (Phase 2)" internal note visible' });
  }

  // 14. Button radius summary
  const actionBtns = Array.from(document.querySelectorAll("button.btn, .btn-primary, .btn-secondary, [class*=button]")).slice(0, 20);
  let correctRadiusCount = 0;
  let wrongRadiusCount = 0;
  for (const btn of actionBtns) {
    const r = parseFloat(window.getComputedStyle(btn).borderRadius);
    const text = (btn.textContent || "").trim();
    if (text.length > 2) {
      if (r > 8) wrongRadiusCount++;
      else correctRadiusCount++;
    }
  }
  issues.push({ code: "BUTTON_RADIUS_CHECK", severity: "info",
    detail: "Buttons: " + correctRadiusCount + " correct (<=8px), " + wrongRadiusCount + " wrong (>8px)" });

  // 15. Governance error elements
  if (window.location.pathname.includes("governance")) {
    const errorEls = Array.from(document.querySelectorAll("[class*=error],[class*=Error]")).slice(0,5);
    for (const el of errorEls) {
      const t = (el.innerText || "").trim();
      if (t.length > 0 && t.length < 300) {
        issues.push({ code: "GOV_ERROR_ELEMENT", severity: "P1",
          detail: 'Governance error: "' + t.slice(0,80) + '"' });
      }
    }
  }

  // 16. Settings UUID in h3
  if (window.location.pathname.includes("settings")) {
    const uuidPat = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const h3els = Array.from(document.querySelectorAll("h3")).slice(0, 20);
    for (const h3 of h3els) {
      const t = (h3.innerText || "").trim();
      if (uuidPat.test(t)) {
        issues.push({ code: "H3_UUID_PLAN_CARD", severity: "P0",
          detail: 'h3 contains UUID: "' + t.slice(0, 60) + '"' });
      }
    }
  }

  // 17. Hardcoded fontsize
  const inlineFont13 = Array.from(document.querySelectorAll("[style*='font-size: 13'],[style*='fontSize: 13'],[style*='font-size:13']")).slice(0,10);
  const inlineFont14 = Array.from(document.querySelectorAll("[style*='font-size: 14'],[style*='fontSize: 14'],[style*='font-size:14']")).slice(0,10);
  if (inlineFont13.length > 0 || inlineFont14.length > 0) {
    issues.push({ code: "HARDCODED_FONTSIZE", severity: "P2",
      detail: "Hardcoded font-size: " + inlineFont13.length + "x 13px, " + inlineFont14.length + "x 14px" });
  }

  return issues;
}`;

// ── v14-specific per-route checks ─────────────────────────────────────────────
const V14_CHECKS = `(args) => {
  const {
    walletProbeStatus, walletProbeBody,
    indexerTrustCount, indexerRoles,
    isNewTrust, isTrustRedirect, isTrustDirect,
    redirectEntityId, redirectTrustAddr,
    serverRedirectStatus, serverRedirectLocation,
    isPreFix,
  } = args;
  const issues = [];
  const allText = document.body ? (document.body.innerText || "") : "";
  const path = window.location.pathname;

  // v14-A: Trust routing (carry-forward from v12)
  if (isTrustRedirect) {
    const expectedPath = "/trust/" + redirectTrustAddr + "/overview";
    const isOnExpectedPath = path === expectedPath;
    const isStillOnCPath = path.includes("/c/" + redirectEntityId);
    if (isOnExpectedPath) {
      issues.push({ code: "TRUST_REDIRECT_PASS", severity: "info",
        detail: "PASS: redirected to " + path });
    } else if (isStillOnCPath) {
      issues.push({ code: "TRUST_REDIRECT_FAIL", severity: "P1",
        detail: "FAIL: still on /c/ after 5s." });
    } else {
      issues.push({ code: "TRUST_REDIRECT_UNEXPECTED", severity: "P1",
        detail: "Unexpected path: " + path });
    }
    if (serverRedirectStatus === 308) {
      issues.push({ code: "SERVER_308_CONFIRMED", severity: "info",
        detail: "308 → " + serverRedirectLocation });
    }
  }

  // v14-B: Trust direct hit (carry-forward)
  if (isTrustDirect) {
    const isOnTrustPath = path.startsWith("/trust/");
    const hasContent = allText.length > 200;
    if (isOnTrustPath && hasContent) {
      issues.push({ code: "TRUST_DIRECT_RENDERS", severity: "info",
        detail: "PASS: renders at " + path + " (" + allText.length + " chars)" });
    } else {
      issues.push({ code: "TRUST_DIRECT_FAIL", severity: "P1",
        detail: "path=" + path + " contentLen=" + allText.length });
    }
    const tabsVisible = [/Roles/i.test(allText), /Ownership/i.test(allText),
      /Governance/i.test(allText), /Treasury/i.test(allText)].filter(Boolean).length;
    issues.push({ code: "TRUST_DIRECT_TABS_COUNT", severity: tabsVisible >= 3 ? "info" : "P2",
      detail: tabsVisible + "/4 tabs visible" });
  }

  // v11 regression checks (carry-forward)
  if (isNewTrust && path.includes("ownership")) {
    const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));
    const hasIndexerRoles = indexerRoles && indexerRoles.length > 0;
    if (hasErrorState) {
      issues.push({ code: "OWNERSHIP_RENDER_ERROR", severity: "P0", detail: "v11 entity ownership error (regression)" });
    } else if (hasIndexerRoles) {
      issues.push({ code: "OWNERSHIP_DATA_RENDERS", severity: "info",
        detail: "v11 regression OK: roles=" + indexerRoles.length });
    }
  }
  if (isNewTrust && path.includes("treasury")) {
    const hasErrorState = /error|failed|unable to load/i.test(allText.slice(0, 1000));
    if (hasErrorState) {
      issues.push({ code: "TREASURY_RENDER_ERROR", severity: "P0", detail: "v11 treasury error (regression)" });
    } else {
      issues.push({ code: "TREASURY_RENDERS_OK", severity: "info", detail: "v11 treasury OK" });
    }
  }
  if (isNewTrust && path.includes("governance")) {
    const errorEls = Array.from(document.querySelectorAll("[class*=error],[class*=Error]")).slice(0, 5);
    const errorTexts = errorEls.map(el => (el.innerText || "").trim()).filter(t => t.length > 0 && t.length < 300);
    if (errorTexts.length > 0) {
      issues.push({ code: "GOVERNANCE_RENDER_ERROR", severity: "P0", detail: "v11 governance error (regression): " + errorTexts[0].slice(0, 80) });
    } else {
      issues.push({ code: "GOVERNANCE_RENDERS_OK", severity: "info", detail: "v11 governance OK" });
    }
  }

  // Indexer probe result
  if (path === "/" || path === "/me") {
    const countOk = indexerTrustCount >= 11;
    issues.push({ code: countOk ? "INDEXER_TRUSTS_OK" : "INDEXER_TRUSTS_LOW",
      severity: countOk ? "info" : "P1",
      detail: "trustsCount: " + indexerTrustCount });
  }

  // Wallet upgrade (carry-forward)
  if (path.startsWith("/me") && path.includes("settings")) {
    if (walletProbeStatus === 501) {
      issues.push({ code: "WALLET_UPGRADE_501_DEPLOYED", severity: "info", detail: "501 confirmed" });
    } else if (walletProbeStatus === 401) {
      issues.push({ code: "WALLET_UPGRADE_STILL_401", severity: "P2", detail: "still 401" });
    }
  }

  // Director card check (carry-forward)
  if (path.includes("/roles") && !path.match(/\\/roles\\/[0-9a-f]/)) {
    const USER_UUID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
    if (allText.includes(USER_UUID)) {
      const directorIdx = allText.indexOf("Director");
      const uuidIdx = allText.indexOf(USER_UUID);
      if (directorIdx >= 0 && Math.abs(directorIdx - uuidIdx) < 200) {
        issues.push({ code: "DIRECTOR_UUID_IN_LIST_VIEW", severity: "P2", detail: "Director shows raw UUID" });
      }
    } else {
      const directorIdx = allText.indexOf("Director");
      if (directorIdx >= 0) {
        const ctx = allText.slice(Math.max(0, directorIdx - 10), directorIdx + 120);
        if (!/[0-9a-f]{8}-[0-9a-f]{4}/.test(ctx)) {
          issues.push({ code: "DIRECTOR_NAME_RESOLVED", severity: "info", detail: "Director name resolved" });
        }
      }
    }
  }

  // Company overview identity tile
  if (path.match(/^\\/c\\/[0-9a-f-]+\\/?$/) && !path.match(/\\/c\\/[0-9a-f-]+\\/[a-z]/)) {
    const missionEls = Array.from(document.querySelectorAll(
      "[class*=mission],[class*=identity],[class*=overview]"
    )).slice(0, 10);
    let found = false;
    for (const el of missionEls) {
      if (/\\bAEQI\\b/.test(el.innerText || "")) {
        found = true;
        issues.push({ code: "MISSION_AEQI_UPPERCASE", severity: "P2", detail: "Identity tile AEQI uppercase (DB-stored)" });
        break;
      }
    }
    if (!found) {
      issues.push({ code: "MISSION_AEQI_CLEAN", severity: "info", detail: "Identity tile clean" });
    }
  }

  // Docs nav (carry-forward)
  if (window.location.hostname.includes("aeqi.ai") && !window.location.hostname.includes("app.")) {
    const navEls = Array.from(document.querySelectorAll("nav, [class*=nav], aside, ASIDE"));
    let foundUppercase = false;
    let foundLowercase = false;
    for (const el of navEls) {
      const t = el.innerText || "";
      if (t.includes("aeqi Entity")) foundLowercase = true;
      if (t.includes("AEQI Entity")) foundUppercase = true;
    }
    if (foundUppercase) {
      issues.push({ code: "DOCS_NAV_AEQI_UPPERCASE", severity: "P1", detail: "Docs nav uppercase (regression)" });
    } else if (foundLowercase) {
      issues.push({ code: "DOCS_NAV_AEQI_FIXED", severity: "info", detail: "Docs nav lowercase confirmed" });
    }
  }

  // UUID in page text
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const allUuids = allText.match(uuidRe) || [];
  if (allUuids.length > 0) {
    issues.push({ code: "UUID_IN_PAGE_TEXT", severity: "info",
      detail: allUuids.length + " UUID(s): " + allUuids.slice(0, 3).join(", ") });
  }

  // v14-specific: bundle deploy status note
  if (isPreFix && (path === "/" || path === "/me")) {
    issues.push({ code: "V14_PRE_FIX_BUNDLE", severity: "info",
      detail: "Pre-fix bundle detected — hairline counts reflect d3fc9745-undeployed state" });
  }

  return issues;
}`;

// ── Core visit function ────────────────────────────────────────────────────────
async function visitRoute(context, route, walletProbeResult, indexerProbeResult, serverRedirectProbe, isPreFix) {
  const page = await context.newPage();
  const networkFailures = [];
  const consoleErrors = [];

  page.on("response", (res) => {
    const s = res.status();
    const u = res.url();
    if (s >= 400 && !u.includes("favicon") && !u.includes("analytics") && !u.includes("plausible")) {
      networkFailures.push({ url: u, status: s });
    }
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("ERR_NAME_NOT_RESOLVED")) {
        consoleErrors.push(text);
      }
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGEERROR: ${err.message}`);
  });

  const t0 = Date.now();
  let httpStatus = null;
  let finalUrl = route.url;
  let screenshotPath = null;
  let antiPatterns = [];
  let bodyTextSample = "";
  let fcpMs = null;

  try {
    const response = await page.goto(route.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    httpStatus = response?.status() ?? null;
    finalUrl = page.url();

    try {
      fcpMs = await page.evaluate(() => {
        const entries = performance.getEntriesByType("paint");
        const e = entries.find((e) => e.name === "first-contentful-paint");
        return e ? Math.round(e.startTime) : null;
      });
    } catch (_) {}

    const waitMs = (route.isNewTrust || route.isTrustRedirect || route.isTrustDirect) ? 5000 : 2500;
    await page.waitForTimeout(waitMs);
    finalUrl = page.url();

    screenshotPath = join(SCREENSHOT_DIR, `${route.label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  screenshot: ${screenshotPath}`);
    console.log(`  final URL: ${finalUrl}`);

    try {
      bodyTextSample = await page.evaluate(() => (document.body.innerText || "").slice(0, 5000));
    } catch (_) {}

    try {
      antiPatterns = await page.evaluate(new Function(`return (${DETECT_ANTIPATTERNS})()`));
    } catch (e) {
      console.warn(`  anti-pattern eval error on ${route.label}: ${e.message}`);
    }

    try {
      const v14Issues = await page.evaluate(
        new Function("args", `return (${V14_CHECKS})(args)`),
        {
          walletProbeStatus: walletProbeResult.status,
          walletProbeBody: walletProbeResult.body || "",
          indexerTrustCount: indexerProbeResult.trustsCount,
          indexerRoles: indexerProbeResult.newEntityRoles,
          isNewTrust: !!route.isNewTrust,
          isTrustRedirect: !!route.isTrustRedirect,
          isTrustDirect: !!route.isTrustDirect,
          redirectEntityId: REDIRECT_ENTITY_ID,
          redirectTrustAddr: REDIRECT_TRUST_ADDR,
          serverRedirectStatus: serverRedirectProbe.status,
          serverRedirectLocation: serverRedirectProbe.location,
          isPreFix,
        },
      );
      antiPatterns = antiPatterns.concat(v14Issues);
    } catch (e) {
      console.warn(`  v14 checks eval error on ${route.label}: ${e.message}`);
    }

  } catch (err) {
    console.error(`  ERROR on ${route.label}: ${err.message}`);
    consoleErrors.push(`NAV_ERROR: ${err.message}`);
  } finally {
    await page.close();
  }

  return {
    label: route.label,
    url: route.url,
    finalUrl,
    auth: route.auth,
    isNewTrust: !!route.isNewTrust,
    isTrustRedirect: !!route.isTrustRedirect,
    isTrustDirect: !!route.isTrustDirect,
    httpStatus,
    elapsed: Date.now() - t0,
    fcpMs,
    screenshotPath,
    networkFailures,
    consoleErrors,
    antiPatterns,
    bodyTextSample,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const publicCtx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const authedCtx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });

  await authedCtx.addCookies([{
    name: "aeqi_token",
    value: TOKEN,
    domain: "app.aeqi.ai",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);

  const setupPage = await authedCtx.newPage();
  try {
    await setupPage.goto("https://app.aeqi.ai/", { waitUntil: "commit", timeout: 15000 });
    await setupPage.evaluate((t) => { localStorage.setItem("aeqi_token", t); }, TOKEN);
  } catch (_) {}
  await setupPage.close();

  const results = [];
  for (const route of ROUTES) {
    const tag = route.isTrustRedirect ? " [TRUST-REDIRECT]" : route.isTrustDirect ? " [TRUST-DIRECT]" : route.isNewTrust ? " [NEW-TRUST]" : "";
    console.log(`\n[${route.label}] ${route.url}${tag}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route, walletProbeResult, indexerProbe, serverRedirectProbe, isPreFix);
    results.push(result);
    const apCount = result.antiPatterns.filter((a) => a.severity !== "info").length;
    const infoCount = result.antiPatterns.filter((a) => a.severity === "info").length;
    console.log(
      `  status=${result.httpStatus} fcp=${result.fcpMs ?? "?"}ms errors=${result.consoleErrors.length} netfails=${result.networkFailures.length} issues=${apCount} info=${infoCount}`,
    );
    for (const ap of result.antiPatterns) {
      if (ap.severity !== "info") {
        console.log(`    [${ap.severity}] ${ap.code}: ${ap.detail}`);
      } else if (ap.code.startsWith("HAIRLINE_")) {
        // Always show hairline counts for v14 analysis
        console.log(`    [info] ${ap.code}: ${ap.detail}`);
      }
    }
    if (result.consoleErrors.length > 0) {
      for (const e of result.consoleErrors.slice(0, 3)) {
        console.log(`    console.error: ${e.slice(0, 120)}`);
      }
    }
    if (result.networkFailures.length > 0) {
      for (const f of result.networkFailures.slice(0, 3)) {
        console.log(`    net-fail: ${f.status} ${f.url.slice(0, 80)}`);
      }
    }
  }

  await browser.close();
  writeFileSync(RAW_JSON, JSON.stringify(results, null, 2));
  console.log(`\nRaw JSON: ${RAW_JSON}`);

  // ── v14 Hairline Summary ──────────────────────────────────────────────────
  console.log("\n=== v14 HAIRLINE ANALYSIS ===");
  console.log(`Bundle: ${liveBundleHash} (${isPreFix ? "PRE-FIX — d3fc9745 not deployed" : "POST-FIX — d3fc9745 deployed"})`);
  console.log("Route                      | border(v14) | shadow(v14) | total | flag");
  console.log("---------------------------|-------------|-------------|-------|-----");

  let totalBorder = 0, totalShadow = 0, totalCombined = 0;
  let routesOver5 = 0;

  for (const r of results) {
    const borderCount = r.antiPatterns.find(a => a.code === "HAIRLINE_BORDER_COUNT_V14");
    const shadowCount = r.antiPatterns.find(a => a.code === "HAIRLINE_SHADOW_COUNT_V14");
    const combinedCount = r.antiPatterns.find(a => a.code === "HAIRLINE_COMBINED_COUNT_V14");

    // Use /:\s*(\d+)/ to match the count after the last colon — NOT /\d+/ which
    // picks the first digit run in the string (e.g. "14" from "V14" in the code name).
    const b = borderCount ? parseInt(borderCount.detail.match(/:\s*(\d+)/)?.[1] || "0") : 0;
    const s = shadowCount ? parseInt(shadowCount.detail.match(/:\s*(\d+)/)?.[1] || "0") : 0;
    const c = combinedCount ? parseInt(combinedCount.detail.match(/:\s*(\d+)/)?.[1] || "0") : 0;

    totalBorder += b;
    totalShadow += s;
    totalCombined += c;
    if (c > 5) routesOver5++;

    const label = r.label.padEnd(26);
    console.log(`${label} | ${String(b).padEnd(11)} | ${String(s).padEnd(11)} | ${String(c).padEnd(5)} | ${c > 5 ? "P2" : "ok"}`);
  }

  console.log(`\nTOTAL across all routes:`);
  console.log(`  CSS border hairlines: ${totalBorder}`);
  console.log(`  Box-shadow hairlines (FIXED regex): ${totalShadow}`);
  console.log(`  Combined total: ${totalCombined}`);
  console.log(`  Routes >5 hairlines: ${routesOver5}/${results.length}`);

  console.log(`\nv13 baseline (cosmetic-swap state):`);
  console.log(`  CSS border hairlines: ~600 total, 13/27 routes >5`);
  console.log(`  Box-shadow hairlines: 22 on quests/ideas routes (v13 regex bug likely undercounted)`);
  console.log(`  Routes >5: 13/27`);

  const verdict = isPreFix
    ? `PRE-FIX bundle (${V13_BUNDLE}): hairline counts reflect BEFORE d3fc9745 deployed`
    : totalShadow < 10 && routesOver5 < 8
      ? `FIX CONFIRMED: shadow near zero (${totalShadow}), routes-over-5 dropped to ${routesOver5}/${results.length}`
      : `FIX UNCLEAR: shadow=${totalShadow} routes-over-5=${routesOver5} — investigate`;

  console.log(`\nVERDICT: ${verdict}`);

  return results;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
