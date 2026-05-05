#!/usr/bin/env node
/**
 * UX Walk v9 — 2026-05-05
 * Ninth UX pass. Post Wave 23 fixes:
 *   - 32b96052: WS-23-B Director list/cards view human occupant UUID → display name
 *   - 9db18db8: WS-23-C treasury URL detection: /me/treasury "account" copy
 *
 * v8 score: 9.1/10
 * Live bundle: index-CDVRX8gJ.js (Wave 23)
 *
 * Per-fix verification:
 *   1. WS-23-B: Director in LIST view — must show display name, NOT UUID
 *      Ground truth: body text must NOT match /bbbd909d-02ab-4ea6-9da2-98d10d4aeba8/ near "Director"
 *   2. WS-23-C: /me/treasury copy — "account" not "Company"
 *      Ground truth: page text must NOT contain "This Company isn't billed"
 *   3. Hairlines: any further drop from v8's 13/27 routes
 *
 * v8 carry-forward:
 *   - AEQI_UPPERCASE_STRUCTURAL FP on session-rail ASIDE — excluded
 *   - DB-stored identity idea for Luca Eich — AEQI uppercase in company-overview
 *   - aeqi-docs nav "AEQI Entity & AA" — aeqi-docs repo, not apps/ui
 *
 * Detection improvement (v9 over v8):
 *   - Director UUID check uses raw body text scan (not card-element narrow query)
 *     to fix the false-positive from v8 (card innerText missed sibling UUID node)
 *
 * Output:
 *   Screenshots → /home/claudedev/aeqi/.observations/ux-v9/
 *   Raw JSON   → /home/claudedev/aeqi/.observations/ux-v9/raw.json
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node scripts/ux-v9-walk.mjs
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = "/home/claudedev/aeqi";
const SCREENSHOT_DIR = join(REPO_ROOT, ".observations", "ux-v9");
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
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff";
const AGENT_ID = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" },
).trim();

console.log(`JWT minted: ${TOKEN.slice(0, 40)}...`);
console.log(`Bundle under test: index-CDVRX8gJ.js (Wave 23)`);

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
  { url: `https://app.aeqi.ai/blueprints`, label: "app-blueprints", auth: true },
  { url: `https://app.aeqi.ai/economy`, label: "app-economy", auth: true },
  { url: `https://app.aeqi.ai/start`, label: "app-start", auth: true },
];

// ── Anti-pattern detector ─────────────────────────────────────────────────────
// v9: inherited from v8 with no changes to core detectors
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

  // 3. AEQI uppercase structural check (nav/headings/labels only, not user content)
  //    v8+: Excludes session-rail ASIDE to eliminate the FP documented in CLAUDE.md
  const sessionRailExclude = new Set(
    Array.from(document.querySelectorAll(
      "[class*=sessions-rail],[class*=session-rail],[class*=sessions-sidebar],[class*=session-sidebar],[class*=sessions-list]"
    ))
  );
  // Expand exclusion to include all descendants of session-rail elements
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
      detail: "Uppercase AEQI " + structuralAeqiCount + "x in structural copy (session-rail excluded). Examples: " + structuralAeqiExamples.join("; ") });
  }

  // 3b. Total AEQI count for reference (includes user data)
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
      detail: actionPillCount + " action pill buttons (>8px radius on text CTA). Examples: " + actionPillExamples.join("; ") });
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
      detail: inlinePills.length + " elements with inline borderRadius 999px. Tags: " +
        inlinePills.map(el => el.tagName + "." + (el.className||"").split(" ")[0]).slice(0,5).join(", ")
    });
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
            jadeBadgeExamples.push("\\"" + (el.textContent||"").trim().slice(0,20) + "\\" bg=" + s.backgroundColor + " color=" + s.color + " class=" + (el.className || "").slice(0,30));
          }
          break;
        }
      }
    }
  }
  if (jadeBadgeCount > 0) {
    issues.push({ code: "JADE_BADGE_NON_SUCCESS", severity: "P1",
      detail: jadeBadgeCount + " badge(s) with jade/teal color outside success context. Examples: " + jadeBadgeExamples.join("; ") });
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
        detail: 'Raw UUID appears in a heading: "' + uuidHeadingText + '"' });
    }
    const planCards = Array.from(document.querySelectorAll("[class*=plan],[class*=Plan],[class*=billing],[class*=Billing]")).slice(0, 10);
    for (const pc of planCards) {
      const pcText = pc.innerText || "";
      if (uuidPattern.test(pcText)) {
        uuidPattern.lastIndex = 0;
        issues.push({ code: "UUID_IN_PLAN_CARD", severity: "P1",
          detail: 'UUID in plan card element "' + pcText.trim().slice(0, 60) + '"' });
        break;
      }
      uuidPattern.lastIndex = 0;
    }
  }

  // 13. "See proposals" build note
  if (allText.includes("See proposals") && allText.includes("Phase 2")) {
    issues.push({ code: "BUILD_NOTE_EXPOSED", severity: "P2",
      detail: '"See proposals (full tab in Phase 2)" internal note visible on page' });
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
    detail: "Action buttons: " + correctRadiusCount + " correct radius (<= 8px), " + wrongRadiusCount + " wrong (> 8px)" });

  // 15. Governance checks
  if (window.location.pathname.includes("governance")) {
    const govBadges = Array.from(document.querySelectorAll("*")).filter(el => {
      const t = (el.innerText || "").trim();
      return /^\\d+ role/.test(t) || /role\\s*:\\s*\\d/.test(t);
    });
    for (const el of govBadges.slice(0, 5)) {
      const s = window.getComputedStyle(el);
      issues.push({ code: "GOV_ROLE_BADGE_COLOR", severity: "info",
        detail: 'Governance role element "' + (el.innerText||"").trim().slice(0,30) + '" bg=' + s.backgroundColor + ' color=' + s.color });
    }
    const errorEls = Array.from(document.querySelectorAll("[class*=error],[class*=Error]")).slice(0,5);
    for (const el of errorEls) {
      const t = (el.innerText || "").trim();
      if (t.length > 0 && t.length < 300) {
        issues.push({ code: "GOV_ERROR_ELEMENT", severity: "P1",
          detail: 'Governance error element: "' + t.slice(0,80) + '"' });
      }
    }
  }

  // 16. Plan name on settings
  if (window.location.pathname.includes("settings")) {
    const planSection = Array.from(document.querySelectorAll("h2,h3,[class*=plan],[class*=Plan],[class*=billing],[class*=Billing]")).slice(0, 20);
    for (const el of planSection) {
      const t = (el.innerText || "").trim();
      if (/plan/i.test(el.className) || /plan/i.test(t) || /billing/i.test(el.className)) {
        issues.push({ code: "SETTINGS_PLAN_LABEL", severity: "info",
          detail: 'Plan/billing element: "' + t.slice(0, 80) + '" tag=' + el.tagName + ' class=' + (el.className||"").slice(0,40) });
      }
    }
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
      detail: "Hardcoded font-size: " + inlineFont13.length + "x 13px, " + inlineFont14.length + "x 14px (should be token vars)" });
  }

  return issues;
}`;

// ── Core visit function ───────────────────────────────────────────────────────
async function visitRoute(context, route) {
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

    await page.waitForTimeout(2500);

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

    // ── v9 specific checks ──
    try {
      const v9Issues = await page.evaluate(() => {
        const issues = [];
        const allText = document.body ? (document.body.innerText || "") : "";
        const path = window.location.pathname;

        // v9-A: Governance copy — still-clean check
        if (path.includes("governance") && allText.includes("No proposals yet")) {
          issues.push({ code: "GOV_COPY_CLEAN", severity: "info",
            detail: '"No proposals yet" copy confirmed — Wave 20 governance fix still present' });
        }

        // v9-B: Director occupant — WS-23-B fix verification (LIST VIEW)
        // v9 improvement: use raw body text scan, not card-element query
        // v8 bug: card innerText only captured "Director" label; sibling UUID was separate node
        // Ground truth: body text must NOT contain the user UUID near "Director"
        if (path.includes("/roles") && !path.match(/\/roles\/[0-9a-f]/)) {
          const USER_UUID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
          const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

          // Check if the specific user UUID appears anywhere in page text
          if (allText.includes(USER_UUID)) {
            // Check if it appears in context near "Director"
            const directorIdx = allText.indexOf("Director");
            const uuidIdx = allText.indexOf(USER_UUID);
            const proximity = Math.abs(directorIdx - uuidIdx);
            if (directorIdx >= 0 && proximity < 200) {
              issues.push({ code: "DIRECTOR_UUID_IN_LIST_VIEW", severity: "P2",
                detail: 'Director card still shows raw UUID in LIST view (WS-23-B fix not landed). UUID at proximity ' + proximity + ' chars from "Director" in body text.' });
            } else {
              issues.push({ code: "DIRECTOR_UUID_ELSEWHERE", severity: "info",
                detail: 'User UUID present in page but not near "Director" (proximity: ' + proximity + 'chars). May be in URL/debug context.' });
            }
          } else {
            // UUID not in body — check if Director shows a human name
            const directorIdx = allText.indexOf("Director");
            if (directorIdx >= 0) {
              const context = allText.slice(Math.max(0, directorIdx - 10), directorIdx + 120);
              // Check for other UUIDs nearby
              const hasAnyUuid = uuidRe.test(context);
              uuidRe.lastIndex = 0;
              if (hasAnyUuid) {
                issues.push({ code: "DIRECTOR_OTHER_UUID", severity: "P2",
                  detail: 'Director card shows a UUID (not the known user UUID but still raw). Context: "' + context.replace(/\n/g, " ").trim().slice(0, 100) + '"' });
              } else {
                issues.push({ code: "DIRECTOR_NAME_RESOLVED", severity: "info",
                  detail: 'WS-23-B CONFIRMED: Director occupant resolved to display name. Context: "' + context.replace(/\n/g, " ").trim().slice(0, 100) + '"' });
              }
            } else {
              issues.push({ code: "DIRECTOR_EL_NOT_FOUND", severity: "info",
                detail: "Director role not found on roles page body text — may be empty or different layout" });
            }
          }
        }

        // v9-C: Personal treasury copy — WS-23-C fix verification
        // Ground truth: page text must NOT contain "This Company isn't billed"
        if (path.startsWith("/me") && path.includes("treasury")) {
          const hasCompanyCopy = allText.includes("This Company isn") || allText.includes("for this Company");
          const hasAccountCopy = allText.includes("This account") || allText.includes("for this account") ||
                                 allText.includes("personal account") || allText.includes("account isn");
          const treasurySection = allText.slice(0, 3000);

          if (hasCompanyCopy) {
            issues.push({ code: "PERSONAL_TREASURY_COMPANY_COPY", severity: "P3",
              detail: 'WS-23-C NOT LANDED: Personal treasury still says "This Company...". Body snippet: "' + treasurySection.slice(0, 150).replace(/\n/g, " ") + '"' });
          } else if (hasAccountCopy) {
            issues.push({ code: "PERSONAL_TREASURY_FIXED", severity: "info",
              detail: 'WS-23-C CONFIRMED: Personal treasury uses "account" copy — fix verified' });
          } else {
            // Capture what the page actually says for debugging
            const trimmed = treasurySection.replace(/\s+/g, " ").trim();
            issues.push({ code: "PERSONAL_TREASURY_COPY_AMBIGUOUS", severity: "info",
              detail: 'Treasury copy ambiguous (neither known phrase found). Sample: "' + trimmed.slice(0, 200) + '"' });
          }
        }

        // v9-D: Company treasury — confirm "Company" copy is still correct (not accidentally broken)
        if (path.includes("/c/") && path.includes("treasury")) {
          const hasCompanyCopy = allText.includes("This Company") || allText.includes("company treasury");
          const hasAccountCopy = allText.includes("This account");
          if (hasAccountCopy && !hasCompanyCopy) {
            issues.push({ code: "COMPANY_TREASURY_WRONG_COPY", severity: "P2",
              detail: 'Company treasury shows "account" copy — WS-23-C detection may have over-corrected' });
          }
          if (hasCompanyCopy) {
            issues.push({ code: "COMPANY_TREASURY_COPY_CORRECT", severity: "info",
              detail: 'Company treasury uses "Company" copy — correct, not regressed' });
          }
        }

        // v9-E: AEQI uppercase in company-overview identity tile (DB-stored pre-fix)
        if (path.match(/^\/c\/[0-9a-f-]+\/?$/) && !path.match(/\/c\/[0-9a-f-]+\/[a-z]/)) {
          const missionEls = Array.from(document.querySelectorAll(
            "[class*=mission],[class*=Mission],[class*=identity],[class*=Identity],[class*=overview],[class*=Overview]"
          )).slice(0, 10);
          let missionAeqi = false;
          for (const el of missionEls) {
            if (/\bAEQI\b/.test(el.innerText || "")) {
              missionAeqi = true;
              issues.push({ code: "MISSION_AEQI_UPPERCASE", severity: "P2",
                detail: 'Identity tile still has uppercase AEQI (DB-stored pre-fix record) — P1 pending DB migration' });
              break;
            }
          }
          if (!missionAeqi) {
            issues.push({ code: "MISSION_AEQI_CLEAN", severity: "info",
              detail: "Company overview identity tile: no uppercase AEQI found" });
          }
        }

        // v9-F: Session-rail AEQI — info only (structural detector excludes rail in v8+)
        if (path.match(/\/agents\//) && (path.endsWith("/agents/" + path.split("/agents/")[1].split("/")[0]) || path.includes("/sessions"))) {
          const sessionRailEl = document.querySelector(
            "[class*=sessions-rail],[class*=session-rail],[class*=sessions-sidebar],[class*=session-sidebar],[class*=sessions-list]"
          );
          if (sessionRailEl) {
            const railText = (sessionRailEl.innerText || "");
            const railAeqi = (railText.match(/\bAEQI\b/g) || []).length;
            issues.push({ code: "SESSION_RAIL_AEQI_INFO", severity: "info",
              detail: "Session rail AEQI count: " + railAeqi + "x (excluded from structural check)" });
          }
        }

        // v9-G: Wallet upgrade section — /me/settings
        if (path.startsWith("/me") && path.includes("settings")) {
          const walletTexts = Array.from(document.querySelectorAll("*"))
            .filter(el => el.childNodes.length <= 5 && /upgrade.*passkey|passkey.*enrolled|upgrade wallet|wallets/i.test((el.innerText || "").trim()))
            .map(el => (el.innerText || "").trim().slice(0, 80));
          if (walletTexts.length > 0) {
            issues.push({ code: "WALLET_SECTION_PRESENT", severity: "info",
              detail: 'Wallet section found: "' + walletTexts[0] + '"' });
          }
        }

        // v9-H: Hairline count per route
        let hlCount = 0;
        for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
          const s = window.getComputedStyle(el);
          if (parseFloat(s.borderTopWidth) === 1
              && s.borderTopStyle !== "none"
              && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
            hlCount++;
          }
        }
        issues.push({ code: "HAIRLINE_COUNT_V9", severity: "info",
          detail: "v9 hairline count: " + hlCount + " (threshold >5 = P2)" });

        // v9-I: Raw UUID count on page (excluding URLs) — catch any new regressions
        const uuidRe2 = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const allUuids = allText.match(uuidRe2) || [];
        if (allUuids.length > 0) {
          issues.push({ code: "UUID_IN_PAGE_TEXT", severity: "info",
            detail: allUuids.length + " UUID(s) found in page text (may be user content or debug): " + allUuids.slice(0, 3).join(", ") });
        }

        return issues;
      });
      antiPatterns = antiPatterns.concat(v9Issues);
    } catch (e) {
      console.warn(`  v9 checks eval error on ${route.label}: ${e.message}`);
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
    console.log(`\n[${route.label}] ${route.url}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route);
    results.push(result);
    const apCount = result.antiPatterns.filter(a => a.severity !== "info").length;
    const infoCount = result.antiPatterns.filter(a => a.severity === "info").length;
    console.log(`  status=${result.httpStatus} fcp=${result.fcpMs ?? "?"}ms errors=${result.consoleErrors.length} netfails=${result.networkFailures.length} issues=${apCount} info=${infoCount}`);
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
