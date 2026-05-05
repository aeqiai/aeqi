#!/usr/bin/env node
/**
 * UX Walk v11 — 2026-05-05
 * Eleventh UX pass. Post v0.25.0 (bridge fully proven).
 * trustsCount went 5 → 10 (5 new confirmed on-chain TRUSTs).
 *
 * Key new test: do Treasury/Ownership/Governance tabs on a NEW entity
 * (with a real on-chain TRUST) render actual data vs empty state?
 *
 * NEW entity under test: fe1780cb-ce83-44c1-8971-eed846f77941 ("aeqi", port 8418)
 *   trust_id: 0xfe1780cbce8344c18971eed846f7794100000000000000000000000000000000
 *   trust_address: 0xdb58fd698d6ec8742c8c5af70cdb658e408c10f8
 *   block: 18244
 *   role in indexer: { account: "0xb838c136ffbfad33e29d04a206269527fc9614a9", slotIndex: 0 }
 *
 * v10 score: 9.5/10
 * Live bundle: index-CDVRX8gJ.js (Wave 23 — unchanged from v10)
 *
 * Per-fix verification v11:
 *   1. Wallet upgrade stub: is 3dfcc03 now deployed? (v10 P2 carry-forward)
 *   2. On-chain TRUST tabs: do Ownership/Treasury/Governance render real data?
 *   3. Indexer roles confirmed for NEW entity: rolesForTrust → 1 role assignment
 *
 * Detection improvements over v10:
 *   - v11-A: on-chain Ownership tab check — new entity with confirmed TRUST
 *   - v11-B: Treasury tab render check — no JS error, content present
 *   - v11-C: Governance tab render check — no error element visible
 *   - v11-D: trustsCount probe — confirm still ≥ 8
 *   - v11-E: Indexer roles sanity — direct GraphQL query before browser walk
 *   - v11-F: HAIRLINE_COUNT_V11 tag for version comparison
 *
 * Output:
 *   Screenshots → /home/claudedev/aeqi/.observations/ux-v11/
 *   Raw JSON   → /home/claudedev/aeqi/.observations/ux-v11/raw.json
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node scripts/ux-v11-walk.mjs
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".observations", "ux-v11");
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

// Primary entity (Luca Eich personal — original test entity, for regression checks)
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff";
const AGENT_ID = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";

// NEW entity with confirmed on-chain TRUST (the critical v11 test)
// Created ~06:55 CEST, trust_id 0xfe1780cb..., block 18244, port 8418
const NEW_ENTITY_ID = "fe1780cb-ce83-44c1-8971-eed846f77941";
const NEW_TRUST_ADDRESS = "0xdb58fd698d6ec8742c8c5af70cdb658e408c10f8";
const NEW_TRUST_ID = "0xfe1780cbce8344c18971eed846f7794100000000000000000000000000000000";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" },
).trim();

console.log(`JWT minted: ${TOKEN.slice(0, 40)}...`);
console.log(`Primary entity: ${ENTITY_ID} (Luca Eich)`);
console.log(`NEW entity (v11 test): ${NEW_ENTITY_ID} (trust @ ${NEW_TRUST_ADDRESS})`);
console.log(`Bundle under test: index-CDVRX8gJ.js (Wave 23 — unchanged from v10)`);

// ── v11-E: Indexer sanity probe (out-of-band, before browser walk) ─────────────
async function probeIndexer() {
  const result = {};

  // trustsCount
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

  // roles for NEW entity trust
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

  // treasury balances for NEW entity trust
  await new Promise((resolve) => {
    const gqlQuery = `{ treasuryBalances(trustAddress: "${NEW_TRUST_ADDRESS}") { token balance } }`;
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
            result.newEntityTreasury = parsed.data?.treasuryBalances ?? [];
            result.newEntityTreasuryError = parsed.errors ?? null;
          } catch (_) {
            result.newEntityTreasury = [];
          }
          resolve();
        });
      },
    );
    req.on("error", () => { result.newEntityTreasury = []; resolve(); });
    req.write(body);
    req.end();
  });

  // proposals for NEW entity trust
  await new Promise((resolve) => {
    const gqlQuery = `{ proposalsForTrust(trustAddress: "${NEW_TRUST_ADDRESS}") { proposalId state } }`;
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
            result.newEntityProposals = parsed.data?.proposalsForTrust ?? [];
            result.newEntityProposalsError = parsed.errors ?? null;
          } catch (_) {
            result.newEntityProposals = [];
          }
          resolve();
        });
      },
    );
    req.on("error", () => { result.newEntityProposals = []; resolve(); });
    req.write(body);
    req.end();
  });

  return result;
}

// ── Wallet upgrade API probe ──────────────────────────────────────────────────
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

console.log("\n=== v11-E: Pre-walk indexer probe ===");
const indexerProbe = await probeIndexer();
console.log(`trustsCount: ${indexerProbe.trustsCount}`);
console.log(`NEW entity roles (${NEW_ENTITY_ID}): ${JSON.stringify(indexerProbe.newEntityRoles)}`);
console.log(`NEW entity treasury: ${JSON.stringify(indexerProbe.newEntityTreasury)} err=${JSON.stringify(indexerProbe.newEntityTreasuryError)}`);
console.log(`NEW entity proposals: ${JSON.stringify(indexerProbe.newEntityProposals)} err=${JSON.stringify(indexerProbe.newEntityProposalsError)}`);

const walletProbeResult = await probeWalletUpgradeApi(TOKEN);
console.log(`\nWallet upgrade API probe: HTTP ${walletProbeResult.status} — ${walletProbeResult.body}`);
const walletUpgradeIs501 = walletProbeResult.status === 501;
const walletUpgradeIs401 = walletProbeResult.status === 401;
console.log(
  walletUpgradeIs501
    ? "  ✓ Returns 501 — 3dfcc03 DEPLOYED. Frontend graceful-degrade fires."
    : walletUpgradeIs401
      ? "  ✗ Still 401 — 3dfcc03 NOT deployed."
      : `  ? Unexpected status ${walletProbeResult.status}`,
);

// ── Route manifest ────────────────────────────────────────────────────────────
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
  // Original entity (regression base)
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
  // NEW entity (v11 critical test — on-chain TRUST verified)
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}`, label: "new-company-overview", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/ownership`, label: "new-company-ownership", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/treasury`, label: "new-company-treasury", auth: true, isNewTrust: true },
  { url: `https://app.aeqi.ai/c/${NEW_ENTITY_ID}/governance`, label: "new-company-governance", auth: true, isNewTrust: true },
  // Other app routes
  { url: `https://app.aeqi.ai/blueprints`, label: "app-blueprints", auth: true },
  { url: `https://app.aeqi.ai/economy`, label: "app-economy", auth: true },
  { url: `https://app.aeqi.ai/start`, label: "app-start", auth: true },
];

// ── Anti-pattern detector (inherited from v10 — no core changes) ──────────────
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

  // 3b. Total AEQI count
  const totalAeqi = (allText.match(/\\bAEQI\\b/g) || []).length;
  if (totalAeqi > 0) {
    issues.push({ code: "AEQI_UPPERCASE_TOTAL", severity: "info",
      detail: "Uppercase AEQI " + totalAeqi + "x total (includes user-generated content)" });
  }

  // 4. Pill buttons
  const interactiveEls = Array.from(
    document.querySelectorAll("button, [role=button], a.btn, .btn")
  ).slice(0, 100);
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
      detail: actionPillCount + " action pill buttons. Examples: " + actionPillExamples.join("; ") });
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

  // 5. Hairlines
  let hairlineCount = 0;
  for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
    const s = window.getComputedStyle(el);
    if (parseFloat(s.borderTopWidth) === 1
        && s.borderTopStyle !== "none"
        && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
      hairlineCount++;
    }
  }
  if (hairlineCount > 5) {
    issues.push({ code: "HAIRLINES", severity: "P2",
      detail: hairlineCount + " elements with 1px hairline borders" });
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

// ── Core visit function ────────────────────────────────────────────────────────
async function visitRoute(context, route, walletProbeResult, indexerProbeResult) {
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

    // Extra wait for on-chain data routes that fetch from indexer
    const waitMs = route.isNewTrust ? 4000 : 2500;
    await page.waitForTimeout(waitMs);

    screenshotPath = join(SCREENSHOT_DIR, `${route.label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  screenshot: ${screenshotPath}`);

    try {
      bodyTextSample = await page.evaluate(() => (document.body.innerText || "").slice(0, 5000));
    } catch (_) {}

    try {
      antiPatterns = await page.evaluate(new Function(`return (${DETECT_ANTIPATTERNS})()`));
    } catch (e) {
      console.warn(`  anti-pattern eval error on ${route.label}: ${e.message}`);
    }

    // ── v11 specific checks ──
    try {
      const v11Issues = await page.evaluate(
        (args) => {
          const {
            walletProbeStatus, walletProbeBody,
            indexerTrustCount, indexerRoles,
            isNewTrust, newEntityId,
          } = args;
          const issues = [];
          const allText = document.body ? (document.body.innerText || "") : "";
          const path = window.location.pathname;

          // v11-A: On-chain Ownership tab — new entity
          if (isNewTrust && path.includes("ownership")) {
            // Check if ownership tab renders Roles section with data
            const hasRoleSection = /Roles|role|member|owner|director/i.test(allText);
            const hasIndexerRoles = indexerRoles && indexerRoles.length > 0;
            const hasAccountAddress = allText.includes("0x");

            // Check for empty state markers
            const hasEmptyState = /no roles|no members|nothing here|empty|not configured/i.test(allText);
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));

            if (hasErrorState) {
              issues.push({ code: "OWNERSHIP_RENDER_ERROR", severity: "P0",
                detail: "NEW entity ownership tab shows error state. Indexer returned " + (hasIndexerRoles ? indexerRoles.length + " roles" : "0 roles") + ". Possible: tab not wired to indexer." });
            } else if (!hasRoleSection) {
              issues.push({ code: "OWNERSHIP_EMPTY_CONTENT", severity: "P1",
                detail: "NEW entity ownership tab: no role/member content detected. " + (hasIndexerRoles ? "Indexer HAS " + indexerRoles.length + " roles — UI not querying indexer." : "Indexer also empty — possible indexer gap.") });
            } else if (hasEmptyState && hasIndexerRoles) {
              issues.push({ code: "OWNERSHIP_EMPTY_DESPITE_INDEXER", severity: "P1",
                detail: "NEW entity ownership shows empty state but indexer has " + indexerRoles.length + " role(s). P1: UI not fetching indexed roles." });
            } else if (hasIndexerRoles) {
              issues.push({ code: "OWNERSHIP_DATA_RENDERS", severity: "info",
                detail: "BIG WIN: NEW entity ownership renders role data. Indexer roles: " + indexerRoles.length + ". hasAccountAddress=" + hasAccountAddress });
            } else {
              issues.push({ code: "OWNERSHIP_NO_INDEXER_DATA", severity: "info",
                detail: "NEW entity ownership: indexer returned 0 roles (expected for fresh entity, or indexer gap). hasRoleSection=" + hasRoleSection });
            }
          }

          // v11-B: Treasury tab — new entity
          if (isNewTrust && path.includes("treasury")) {
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));
            const hasTreasuryContent = /treasury|balance|token|asset|holdings/i.test(allText);
            const hasEmptyTreasury = /no tokens|no balance|empty treasury|nothing here/i.test(allText);

            if (hasErrorState) {
              issues.push({ code: "TREASURY_RENDER_ERROR", severity: "P0",
                detail: "NEW entity treasury tab shows error state. Tab may not be wired to indexer." });
            } else if (hasTreasuryContent) {
              issues.push({ code: "TREASURY_RENDERS_OK", severity: "info",
                detail: "NEW entity treasury tab renders without error. Empty treasury expected (fresh entity on local anvil)." });
            } else {
              issues.push({ code: "TREASURY_NO_CONTENT", severity: "P1",
                detail: "NEW entity treasury: no treasury-related content detected in page text." });
            }
          }

          // v11-C: Governance tab — new entity
          if (isNewTrust && path.includes("governance")) {
            const hasErrorState = /error|failed|unable to load|something went wrong/i.test(allText.slice(0, 1000));
            const hasGovContent = /governance|proposal|vote|quorum|dao/i.test(allText);

            const errorEls = Array.from(document.querySelectorAll("[class*=error],[class*=Error]")).slice(0, 5);
            const errorTexts = errorEls.map(el => (el.innerText || "").trim()).filter(t => t.length > 0 && t.length < 300);

            if (errorTexts.length > 0) {
              issues.push({ code: "GOVERNANCE_RENDER_ERROR", severity: "P0",
                detail: "NEW entity governance shows visible error element: " + errorTexts[0].slice(0, 80) });
            } else if (hasErrorState) {
              issues.push({ code: "GOVERNANCE_ERROR_IN_BODY", severity: "P1",
                detail: "NEW entity governance: error text in page body (no visible error el)." });
            } else if (hasGovContent) {
              issues.push({ code: "GOVERNANCE_RENDERS_OK", severity: "info",
                detail: "NEW entity governance renders without error. No proposals expected (fresh entity)." });
            } else {
              issues.push({ code: "GOVERNANCE_NO_CONTENT", severity: "P1",
                detail: "NEW entity governance: no governance-related content in page text." });
            }
          }

          // v11-D: trustsCount from indexer pre-probe (injected)
          if (path === "/" || path === "/me") {
            const countOk = indexerTrustCount >= 8;
            issues.push({
              code: countOk ? "INDEXER_TRUSTS_OK" : "INDEXER_TRUSTS_LOW",
              severity: countOk ? "info" : "P1",
              detail: "trustsCount from indexer: " + indexerTrustCount + (countOk ? " ✓" : " — expected ≥8")
            });
          }

          // v11-F: Hairline count (v11 tag)
          let hlCount = 0;
          for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
            const s = window.getComputedStyle(el);
            if (parseFloat(s.borderTopWidth) === 1
                && s.borderTopStyle !== "none"
                && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
              hlCount++;
            }
          }
          issues.push({ code: "HAIRLINE_COUNT_V11", severity: "info",
            detail: "v11 hairline count: " + hlCount + " (threshold >5 = P2)" });

          // v11-G: wallet upgrade (v10 carry-forward)
          if (path.startsWith("/me") && path.includes("settings")) {
            if (walletProbeStatus === 501) {
              issues.push({ code: "WALLET_UPGRADE_501_DEPLOYED", severity: "info",
                detail: "3dfcc03 CONFIRMED DEPLOYED: returns 501. Frontend graceful-degrade fires." });
            } else if (walletProbeStatus === 401) {
              issues.push({ code: "WALLET_UPGRADE_STILL_401", severity: "P2",
                detail: "3dfcc03 NOT YET DEPLOYED: still 401. Binary predates commit." });
            } else {
              issues.push({ code: "WALLET_UPGRADE_UNEXPECTED", severity: "info",
                detail: "Wallet probe status " + walletProbeStatus + " body: " + walletProbeBody });
            }
          }

          // v11-H: Director card check (v10 carry-forward)
          if (path.includes("/roles") && !path.match(/\/roles\/[0-9a-f]/)) {
            const USER_UUID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
            if (allText.includes(USER_UUID)) {
              const directorIdx = allText.indexOf("Director");
              const uuidIdx = allText.indexOf(USER_UUID);
              const proximity = Math.abs(directorIdx - uuidIdx);
              if (directorIdx >= 0 && proximity < 200) {
                issues.push({ code: "DIRECTOR_UUID_IN_LIST_VIEW", severity: "P2",
                  detail: "Director card shows raw UUID. Proximity: " + proximity + " chars." });
              }
            } else {
              const directorIdx = allText.indexOf("Director");
              if (directorIdx >= 0) {
                const ctx = allText.slice(Math.max(0, directorIdx - 10), directorIdx + 120);
                const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
                if (!uuidRe.test(ctx)) {
                  issues.push({ code: "DIRECTOR_NAME_RESOLVED", severity: "info",
                    detail: "Director occupant name resolved (no UUID adjacent)." });
                }
              }
            }
          }

          // v11-I: Company identity tile AEQI check
          if (path.match(/^\/c\/[0-9a-f-]+\/?$/) && !path.match(/\/c\/[0-9a-f-]+\/[a-z]/)) {
            const missionEls = Array.from(document.querySelectorAll(
              "[class*=mission],[class*=Mission],[class*=identity],[class*=Identity],[class*=overview],[class*=Overview]"
            )).slice(0, 10);
            let missionAeqi = false;
            for (const el of missionEls) {
              if (/\\bAEQI\\b/.test(el.innerText || "")) {
                missionAeqi = true;
                issues.push({ code: "MISSION_AEQI_UPPERCASE", severity: "P2",
                  detail: "Identity tile has uppercase AEQI (DB-stored pre-fix record)" });
                break;
              }
            }
            if (!missionAeqi) {
              issues.push({ code: "MISSION_AEQI_CLEAN", severity: "info",
                detail: "Company overview identity tile: no uppercase AEQI" });
            }
          }

          // v11-J: docs nav check (v10-A carry-forward)
          if (window.location.hostname.includes("aeqi.ai") && !window.location.hostname.includes("app.")) {
            const navEls = Array.from(document.querySelectorAll("nav, [class*=nav], aside, ASIDE"));
            let foundLowercase = false;
            let foundUppercase = false;
            for (const el of navEls) {
              const t = el.innerText || "";
              if (t.includes("aeqi Entity")) foundLowercase = true;
              if (t.includes("AEQI Entity")) foundUppercase = true;
            }
            if (foundUppercase) {
              issues.push({ code: "DOCS_NAV_AEQI_UPPERCASE", severity: "P1",
                detail: "Docs nav still shows 'AEQI Entity & AA' (uppercase)." });
            } else if (foundLowercase) {
              issues.push({ code: "DOCS_NAV_AEQI_FIXED", severity: "info",
                detail: "5ba89fe confirmed: docs nav shows 'aeqi Entity & AA' (lowercase)." });
            }
          }

          // v11-K: UUID in page text (info)
          const uuidRe3 = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
          const allUuids = allText.match(uuidRe3) || [];
          if (allUuids.length > 0) {
            issues.push({ code: "UUID_IN_PAGE_TEXT", severity: "info",
              detail: allUuids.length + " UUID(s) in page: " + allUuids.slice(0, 3).join(", ") });
          }

          return issues;
        },
        {
          walletProbeStatus: walletProbeResult.status,
          walletProbeBody: walletProbeResult.body || "",
          indexerTrustCount: indexerProbeResult.trustsCount,
          indexerRoles: indexerProbeResult.newEntityRoles,
          isNewTrust: !!route.isNewTrust,
          newEntityId: route.isNewTrust ? route.url : null,
        },
      );
      antiPatterns = antiPatterns.concat(v11Issues);
    } catch (e) {
      console.warn(`  v11 checks eval error on ${route.label}: ${e.message}`);
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
    console.log(`\n[${route.label}] ${route.url}${route.isNewTrust ? " [NEW-TRUST]" : ""}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route, walletProbeResult, indexerProbe);
    results.push(result);
    const apCount = result.antiPatterns.filter((a) => a.severity !== "info").length;
    const infoCount = result.antiPatterns.filter((a) => a.severity === "info").length;
    console.log(
      `  status=${result.httpStatus} fcp=${result.fcpMs ?? "?"}ms errors=${result.consoleErrors.length} netfails=${result.networkFailures.length} issues=${apCount} info=${infoCount}`,
    );
    for (const ap of result.antiPatterns) {
      if (ap.severity !== "info") {
        console.log(`    [${ap.severity}] ${ap.code}: ${ap.detail}`);
      } else {
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
  return results;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
