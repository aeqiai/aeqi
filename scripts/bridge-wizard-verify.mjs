#!/usr/bin/env node
/**
 * bridge-wizard-verify.mjs — 2026-05-05
 *
 * End-to-end verification that the company creation wizard (UI path) reaches
 * the on-chain DAO bridge and registers a new TRUST, incrementing trustsCount
 * from the indexer.
 *
 * Test user: eqaq131@gmail.com (subscription_status=active, is_admin=1)
 * — this user skips Stripe, so the wizard lands directly at company creation
 *   (the 402 → Stripe redirect path is exercised only for non-subscribed users).
 *
 * Flow:
 *   1. Mint JWT via _mint-jwt.mjs helper.
 *   2. Query indexer for initial trustsCount.
 *   3. Navigate to https://app.aeqi.ai/start via Playwright (authed context).
 *   4. Click a blueprint card → navigate to /start/<slug>.
 *   5. Wait for wizard page to load; verify company name field is pre-filled.
 *   6. Click "Create company" (primary CTA).
 *   7. Watch for navigation to /<entity_id>/overview.
 *   8. Intercept /api/start/launch network request and capture status + body.
 *   9. Poll indexer trustsCount until it increments OR 2-min timeout.
 *  10. Capture screenshots at every step.
 *
 * Usage:
 *   AEQI_WEB_SECRET=... node scripts/bridge-wizard-verify.mjs
 *
 * Output:
 *   Screenshots → /home/claudedev/aeqi/.observations/bridge-wizard-verify-2026-05-05/
 *   Raw JSON   → /home/claudedev/aeqi/.observations/bridge-wizard-verify-2026-05-05/raw.json
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

const REPO_ROOT = "/home/claudedev/aeqi";
const SCREENSHOT_DIR = "/home/claudedev/aeqi/.observations/bridge-wizard-verify-2026-05-05";
const RAW_JSON = `${SCREENSHOT_DIR}/raw.json`;
const INDEXER_URL = "http://localhost:8501/graphql";
const APP_BASE = "https://app.aeqi.ai";

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Auth setup ────────────────────────────────────────────────────────────────
const AEQI_WEB_SECRET = process.env.AEQI_WEB_SECRET;
if (!AEQI_WEB_SECRET) {
  console.error("AEQI_WEB_SECRET required — set it in env before running");
  process.exit(1);
}

const USER_ID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
const EMAIL = "eqaq131@gmail.com";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node ${REPO_ROOT}/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" },
).trim();
console.log(`JWT minted: ${TOKEN.slice(0, 40)}...`);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function queryTrustsCount() {
  const resp = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ trustsCount }" }),
  });
  const data = await resp.json();
  return data?.data?.trustsCount ?? null;
}

async function screenshot(page, label) {
  const path = `${SCREENSHOT_DIR}/${label}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`  📷 ${path}`);
  return path;
}

// Poll indexer for trustsCount to reach target, with 2-min timeout.
async function pollTrustsCount(initialCount, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = initialCount;
  while (Date.now() < deadline) {
    const count = await queryTrustsCount();
    if (count !== null && count > initialCount) {
      return { success: true, finalCount: count, elapsed: timeoutMs - (deadline - Date.now()) };
    }
    lastCount = count ?? lastCount;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { success: false, finalCount: lastCount, elapsed: timeoutMs };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const result = {
    ts: new Date().toISOString(),
    userId: USER_ID,
    email: EMAIL,
    initialTrustsCount: null,
    finalTrustsCount: null,
    verdict: "PENDING",
    entity_id: null,
    networkRequests: [],
    steps: [],
    screenshots: [],
    error: null,
  };

  // ── Step 0: initial trustsCount ───────────────────────────────────────────
  const initialCount = await queryTrustsCount();
  result.initialTrustsCount = initialCount;
  console.log(`\nStep 0: initial trustsCount = ${initialCount}`);
  result.steps.push({ step: 0, label: "initial-trusts-count", trustsCount: initialCount });

  if (initialCount === null) {
    result.verdict = "FAIL";
    result.error = "Indexer unreachable or trustsCount query failed";
    writeFileSync(RAW_JSON, JSON.stringify(result, null, 2));
    console.error("FAIL: cannot reach indexer");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const UA =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });

  // Inject auth cookie + localStorage token
  await ctx.addCookies([
    {
      name: "aeqi_token",
      value: TOKEN,
      domain: "app.aeqi.ai",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const setupPage = await ctx.newPage();
  try {
    await setupPage.goto(`${APP_BASE}/`, { waitUntil: "commit", timeout: 15000 });
    await setupPage.evaluate((t) => {
      localStorage.setItem("aeqi_token", t);
    }, TOKEN);
  } catch (_) {}
  await setupPage.close();

  const page = await ctx.newPage();

  // Capture network requests of interest
  page.on("response", async (res) => {
    const url = res.url();
    const status = res.status();
    if (
      url.includes("/api/start/launch") ||
      url.includes("/api/companies/create") ||
      url.includes("/api/start/entity") ||
      url.includes("/api/billing/checkout")
    ) {
      let body = null;
      try {
        body = await res.json();
      } catch (_) {}
      result.networkRequests.push({ url, status, body });
      console.log(`  [network] ${status} ${url}`, body ? JSON.stringify(body).slice(0, 120) : "");
    }
  });

  try {
    // ── Step 1: Navigate to /start ──────────────────────────────────────────
    console.log(`\nStep 1: navigate to ${APP_BASE}/start`);
    await page.goto(`${APP_BASE}/start`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const s1 = await screenshot(page, "01-start-page");
    result.screenshots.push(s1);
    result.steps.push({ step: 1, label: "start-page", url: page.url() });

    // Check if we got redirected to signup (not authed)
    if (page.url().includes("/signup")) {
      result.verdict = "FAIL";
      result.error = "Not authenticated — redirected to /signup";
      result.steps.push({ step: 1, label: "auth-failure", url: page.url() });
      await browser.close();
      writeFileSync(RAW_JSON, JSON.stringify(result, null, 2));
      console.error("FAIL: authentication didn't work, redirected to signup");
      process.exit(1);
    }

    // ── Step 2: Click a blueprint card ("Start blank" or first available) ───
    console.log(`\nStep 2: selecting blueprint`);
    // Try "Start blank" button first; fall back to first blueprint card
    const blankBtn = page.locator(".bp-launch-blank");
    const isBlankVisible = await blankBtn.isVisible().catch(() => false);
    let blueprintSlug = "blank";
    if (isBlankVisible) {
      console.log("  clicking Start blank button");
      await blankBtn.click();
    } else {
      // Fall back to first card
      const firstCard = page.locator(".bp-launch-card-btn").first();
      const isCardVisible = await firstCard.isVisible().catch(() => false);
      if (isCardVisible) {
        console.log("  clicking first blueprint card");
        await firstCard.click();
        blueprintSlug = "first-card";
      } else {
        // Navigate directly to a known blueprint
        console.log("  no cards visible, navigating directly to /start/personal-os");
        await page.goto(`${APP_BASE}/start/personal-os`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        blueprintSlug = "personal-os";
      }
    }

    await page.waitForTimeout(3000);
    const s2 = await screenshot(page, "02-after-blueprint-click");
    result.screenshots.push(s2);
    result.steps.push({ step: 2, label: "blueprint-selected", slug: blueprintSlug, url: page.url() });

    // ── Step 3: Wizard page — verify it loaded ──────────────────────────────
    console.log(`\nStep 3: wizard page at ${page.url()}`);
    // If we're still on /start, navigate directly to a blueprint
    if (!page.url().includes("/start/")) {
      console.log("  still on /start, navigating directly to /start/personal-os");
      await page.goto(`${APP_BASE}/start/personal-os`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
    }

    const wizardTitle = await page.locator(".wizard-title, h1").first().textContent().catch(() => null);
    console.log(`  wizard title: ${wizardTitle}`);
    const s3 = await screenshot(page, "03-wizard-page");
    result.screenshots.push(s3);
    result.steps.push({ step: 3, label: "wizard-loaded", url: page.url(), wizardTitle });

    // ── Step 4: Ensure company name is set ─────────────────────────────────
    console.log(`\nStep 4: checking/setting company name`);
    // The wizard pre-fills the name from the blueprint. Check it.
    const nameField = page.locator("input[type=text]").first();
    const isNameFieldVisible = await nameField.isVisible().catch(() => false);
    let companyName = null;
    if (isNameFieldVisible) {
      companyName = await nameField.inputValue().catch(() => null);
      console.log(`  name field current value: "${companyName}"`);
      if (!companyName || companyName.trim() === "") {
        const testName = `Verify Bridge ${Date.now()}`;
        console.log(`  filling company name: "${testName}"`);
        await nameField.fill(testName);
        companyName = testName;
      }
    } else {
      console.log("  name field not visible, wizard may be loading");
    }
    result.steps.push({ step: 4, label: "company-name", companyName });

    // ── Step 5: Click Create company ────────────────────────────────────────
    console.log(`\nStep 5: clicking Create company`);
    // Find the primary CTA button — it's in the top wizard-cta-row
    const createBtn = page
      .locator(".wizard-cta-row button.btn-primary, .wizard-cta-row button[class*=primary]")
      .first();
    const isCreateBtnVisible = await createBtn.isVisible().catch(() => false);

    if (!isCreateBtnVisible) {
      // Fallback: any button containing "Create"
      const anyCreate = page.getByRole("button", { name: /create/i }).first();
      const isAnyCreateVisible = await anyCreate.isVisible().catch(() => false);
      if (!isAnyCreateVisible) {
        result.verdict = "FAIL";
        result.error = "Create company button not found on wizard page";
        const sErr = await screenshot(page, "04-no-create-button");
        result.screenshots.push(sErr);
        await browser.close();
        writeFileSync(RAW_JSON, JSON.stringify(result, null, 2));
        console.error("FAIL: Create button not found");
        process.exit(1);
      }
      await anyCreate.click();
    } else {
      await createBtn.click();
    }

    console.log(`  clicked Create — waiting for navigation or error`);
    const s5 = await screenshot(page, "05-after-create-click");
    result.screenshots.push(s5);

    // ── Step 6: Wait for outcome (navigate away or error) ──────────────────
    console.log(`\nStep 6: waiting for post-create navigation`);
    try {
      await page.waitForURL(
        (url) => {
          const p = new URL(url).pathname;
          // Expect redirect to /<entity_id>/overview or /<entity_id>
          return (
            /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(p) ||
            p.includes("/overview")
          );
        },
        { timeout: 30000 },
      );
      console.log(`  navigated to: ${page.url()}`);
      // Extract entity_id from URL
      const entityMatch = page.url().match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
      if (entityMatch) {
        result.entity_id = entityMatch[1];
        console.log(`  entity_id: ${result.entity_id}`);
      }
    } catch (_) {
      // Navigation timeout — check for Stripe redirect or error
      const currentUrl = page.url();
      console.log(`  no navigation after 30s, still at: ${currentUrl}`);
      if (currentUrl.includes("stripe.com") || currentUrl.includes("checkout")) {
        result.verdict = "FAIL";
        result.error = "Redirected to Stripe — subscription gate triggered for subscribed user. Bug in skipsStripe logic.";
      }
    }

    await page.waitForTimeout(2000);
    const s6 = await screenshot(page, "06-post-create");
    result.screenshots.push(s6);
    result.steps.push({ step: 6, label: "post-create", url: page.url(), entityId: result.entity_id });

    // ── Step 7: Check for error state on wizard ─────────────────────────────
    const submitError = await page.locator(".wizard-submit-error").textContent().catch(() => null);
    if (submitError && submitError.trim()) {
      console.log(`  submit error visible: "${submitError}"`);
      result.steps.push({ step: 7, label: "submit-error", error: submitError });
    }

    // ── Step 8: Poll indexer for trustsCount increment ──────────────────────
    console.log(`\nStep 8: polling indexer (initial=${initialCount}, timeout=2min)`);
    const pollResult = await pollTrustsCount(initialCount);
    result.finalTrustsCount = pollResult.finalCount;
    console.log(
      `  poll finished: finalCount=${pollResult.finalCount} success=${pollResult.success} elapsed=${Math.round(pollResult.elapsed / 1000)}s`,
    );
    result.steps.push({ step: 8, label: "indexer-poll", ...pollResult });

    // ── Verdict ─────────────────────────────────────────────────────────────
    if (pollResult.success && result.entity_id) {
      result.verdict = "PASS";
      console.log(`\n✅ PASS: trustsCount ${initialCount} → ${pollResult.finalCount}`);
    } else if (!pollResult.success) {
      result.verdict = "FAIL";
      result.error =
        result.error ||
        `trustsCount did not increment within 2 minutes (stayed at ${pollResult.finalCount})`;
      console.log(`\n❌ FAIL: ${result.error}`);
    } else if (!result.entity_id) {
      result.verdict = "FAIL";
      result.error = "entity_id not captured from redirect URL";
      console.log(`\n❌ FAIL: ${result.error}`);
    }
  } catch (err) {
    result.verdict = "FAIL";
    result.error = err.message;
    console.error(`\nFatal error: ${err.message}`);
    try {
      const sErr = await screenshot(page, "error-state");
      result.screenshots.push(sErr);
    } catch (_) {}
  }

  await browser.close();

  // Final summary
  console.log("\n── Summary ─────────────────────────────────────────────────────");
  console.log(`Verdict:           ${result.verdict}`);
  console.log(`Initial trustsCount: ${result.initialTrustsCount}`);
  console.log(`Final trustsCount:   ${result.finalTrustsCount}`);
  console.log(`entity_id:           ${result.entity_id ?? "(none)"}`);
  if (result.error) console.log(`Error:             ${result.error}`);
  console.log("\nNetwork requests of interest:");
  for (const r of result.networkRequests) {
    console.log(`  ${r.status} ${r.url}`);
    if (r.body) console.log(`    body: ${JSON.stringify(r.body).slice(0, 200)}`);
  }

  writeFileSync(RAW_JSON, JSON.stringify(result, null, 2));
  console.log(`\nRaw JSON: ${RAW_JSON}`);

  process.exit(result.verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
