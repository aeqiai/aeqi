#!/usr/bin/env node
/**
 * P0 rerun — 2026-05-05
 * Verifies the 5 P0s from ux-ratings-2026-05-04.md are fixed.
 * Outputs structured JSON to /tmp/ux-p0-rerun.json and screenshots to
 * /tmp/ux-p0-rerun-screenshots/.
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

const SCREENSHOT_DIR = "/tmp/ux-p0-rerun-screenshots";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const AEQI_WEB_SECRET = "z6+YxDDXbfa9Aphlw3XD0u1TpyBhRMvHge3mkWxeIbfZ06c8Y+yM36md2ixjgD5S";
const USER_ID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
const EMAIL = "eqaq131@gmail.com";
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff";

const TOKEN = execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" }
).trim();

console.log("JWT minted:", TOKEN.slice(0, 40) + "...");

const P0_ROUTES = [
  // P0-1: aeqi.ai/economy — expect 200 with coming-soon content
  { url: "https://aeqi.ai/economy", label: "landing-economy", auth: false,
    expectContent: ["economy", "coming", "soon", "æconomy", "Economic"],
    expectNotContent: ["404", "Page not found", "not found"],
    p0id: "P0-2-economy-404" },
  // P0-2: /me/inbox — expect inbox content, NOT settings/profile
  { url: "https://app.aeqi.ai/me/inbox", label: "me-inbox", auth: true,
    expectContent: ["inbox", "message", "session", "Inbox"],
    expectNotContent: ["First name", "Last name", "Identity", "Save"],
    p0id: "P0-1-me-routing" },
  // P0-3: /me/agents
  { url: "https://app.aeqi.ai/me/agents", label: "me-agents", auth: true,
    expectContent: ["agent", "Agent"],
    expectNotContent: ["First name", "Last name", "Identity"],
    p0id: "P0-1-me-routing" },
  // P0-4: /me/quests
  { url: "https://app.aeqi.ai/me/quests", label: "me-quests", auth: true,
    expectContent: ["quest", "Quest"],
    expectNotContent: ["First name", "Last name", "Identity"],
    p0id: "P0-1-me-routing" },
  // P0-5: /me/ideas
  { url: "https://app.aeqi.ai/me/ideas", label: "me-ideas", auth: true,
    expectContent: ["idea", "Idea"],
    expectNotContent: ["First name", "Last name", "Identity"],
    p0id: "P0-1-me-routing" },
  // P0-6: /me/treasury
  { url: "https://app.aeqi.ai/me/treasury", label: "me-treasury", auth: true,
    expectContent: ["treasury", "Treasury", "wallet", "balance"],
    expectNotContent: ["First name", "Last name", "Identity"],
    p0id: "P0-1-me-routing" },
  // Also check /me/settings still works (regression guard)
  { url: "https://app.aeqi.ai/me/settings", label: "me-settings", auth: true,
    expectContent: ["First name", "Last name", "Profile", "Settings"],
    expectNotContent: [],
    p0id: "regression-guard" },
  // P0-3: app root 502 spray check
  { url: "https://app.aeqi.ai/", label: "app-root", auth: true,
    expectContent: [],
    expectNotContent: [],
    p0id: "P0-3-app-root-502" },
];

async function visitRoute(context, route) {
  const page = await context.newPage();
  const networkFailures = [];
  const allRequests = [];

  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    allRequests.push({ url: url.replace(/https?:\/\/[^/]+/, ""), status });
    if (status >= 400 && !url.includes("favicon") && !url.includes("analytics") && !url.includes("plausible")) {
      networkFailures.push({ url: url.replace(/https?:\/\/[^/]+/, ""), status });
    }
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  let httpStatus = null;
  let bodyText = "";
  let finalUrl = route.url;

  try {
    const response = await page.goto(route.url, { waitUntil: "networkidle", timeout: 30000 });
    httpStatus = response?.status();
    finalUrl = page.url();
    await page.waitForTimeout(2000);

    const screenshotPath = `${SCREENSHOT_DIR}/${route.label}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => "");

    // Check expected content
    const contentMatches = {};
    for (const keyword of route.expectContent) {
      contentMatches[keyword] = bodyText.toLowerCase().includes(keyword.toLowerCase());
    }
    const notContentMatches = {};
    for (const keyword of route.expectNotContent) {
      notContentMatches[keyword] = bodyText.toLowerCase().includes(keyword.toLowerCase());
    }

    const passed = route.expectContent.every(k => contentMatches[k]) &&
                   route.expectNotContent.every(k => !notContentMatches[k]);

    // Count 502 errors specifically for app-root check
    const errors502 = networkFailures.filter(f => f.status === 502);
    const errors4xx5xx = networkFailures.filter(f => f.status >= 400);

    await page.close();
    return {
      label: route.label,
      url: route.url,
      finalUrl,
      httpStatus,
      p0id: route.p0id,
      passed,
      contentMatches,
      notContentMatches,
      networkFailures: errors4xx5xx,
      errors502Count: errors502.length,
      consoleErrors: consoleErrors.filter(e => !e.includes("favicon")),
      screenshotPath,
      bodyTextSample: bodyText.slice(0, 500),
    };
  } catch (err) {
    await page.close().catch(() => {});
    return {
      label: route.label,
      url: route.url,
      finalUrl,
      httpStatus,
      p0id: route.p0id,
      passed: false,
      error: err.message,
      networkFailures,
      errors502Count: 0,
      consoleErrors,
      screenshotPath: null,
      bodyTextSample: "",
      contentMatches: {},
      notContentMatches: {},
    };
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const publicCtx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });

  const authedCtx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });

  // Inject auth
  await authedCtx.addCookies([{
    name: "aeqi_token", value: TOKEN, domain: "app.aeqi.ai",
    path: "/", httpOnly: false, secure: true, sameSite: "Lax",
  }]);
  const setupPage = await authedCtx.newPage();
  await setupPage.goto("https://app.aeqi.ai/", { waitUntil: "commit", timeout: 15000 }).catch(() => {});
  await setupPage.evaluate((token) => { localStorage.setItem("aeqi_token", token); }, TOKEN);
  await setupPage.close();

  const results = [];
  for (const route of P0_ROUTES) {
    console.log(`\n[${route.p0id}] ${route.label} — ${route.url}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route);
    results.push(result);

    const statusIcon = result.passed ? "PASS" : "FAIL";
    console.log(`  ${statusIcon} | HTTP ${result.httpStatus} | 502s=${result.errors502Count} | net-fails=${result.networkFailures.length}`);
    if (!result.passed) {
      console.log(`  expected: ${JSON.stringify(route.expectContent)}`);
      console.log(`  not expected: ${JSON.stringify(route.expectNotContent)}`);
      console.log(`  body sample: ${result.bodyTextSample.slice(0, 200)}`);
    }
    if (result.errors502Count > 0) {
      console.log(`  502 failures:`, result.networkFailures.filter(f => f.status === 502).map(f => f.url).join(", "));
    }
  }

  await browser.close();

  writeFileSync("/tmp/ux-p0-rerun.json", JSON.stringify(results, null, 2));
  console.log("\nResults saved to /tmp/ux-p0-rerun.json");
  return results;
}

main().catch(console.error);
