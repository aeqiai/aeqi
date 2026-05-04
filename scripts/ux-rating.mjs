#!/usr/bin/env node
/**
 * UX Rating crawl — 2026-05-04
 * Navigates every canonical route, captures screenshots, console errors,
 * network failures, and basic perf metrics. Output goes to
 * /tmp/ux-rating-screenshots/ + .observations/ux-ratings-2026-05-04.md
 */

import { chromium } from "/home/claudedev/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCREENSHOT_DIR = "/tmp/ux-rating-screenshots";
const OUT_FILE = join(REPO_ROOT, ".observations", "ux-ratings-2026-05-04.md");

mkdirSync(SCREENSHOT_DIR, { recursive: true });
mkdirSync(join(REPO_ROOT, ".observations"), { recursive: true });

// Mint a fresh JWT with 2hr TTL
const AEQI_WEB_SECRET = process.env.AEQI_WEB_SECRET;
if (!AEQI_WEB_SECRET) {
  console.error("AEQI_WEB_SECRET required");
  process.exit(1);
}

const USER_ID = "bbbd909d-02ab-4ea6-9da2-98d10d4aeba8";
const EMAIL = "eqaq131@gmail.com";
const ENTITY_ID = "9f8d30b9-abed-408e-9eae-91c48bb360ff"; // first owned entity

const TOKEN = process.env.AEQI_TOKEN || execSync(
  `AEQI_WEB_SECRET="${AEQI_WEB_SECRET}" node /home/claudedev/aeqi/scripts/_mint-jwt.mjs ${USER_ID} ${EMAIL} 7200`,
  { encoding: "utf-8" }
).trim();

console.log("JWT minted:", TOKEN.slice(0, 40) + "...");

const ROUTES = [
  // Public surfaces
  { url: "https://aeqi.ai/", label: "landing-home", auth: false },
  { url: "https://aeqi.ai/docs", label: "landing-docs", auth: false },
  { url: "https://aeqi.ai/economy", label: "landing-economy", auth: false },
  // Authed app
  { url: "https://app.aeqi.ai/", label: "app-root", auth: true },
  { url: "https://app.aeqi.ai/me/inbox", label: "me-inbox", auth: true },
  { url: "https://app.aeqi.ai/me/agents", label: "me-agents", auth: true },
  { url: "https://app.aeqi.ai/me/quests", label: "me-quests", auth: true },
  { url: "https://app.aeqi.ai/me/ideas", label: "me-ideas", auth: true },
  { url: "https://app.aeqi.ai/me/treasury", label: "me-treasury", auth: true },
  { url: "https://app.aeqi.ai/me/settings", label: "me-settings", auth: true },
  { url: "https://app.aeqi.ai/start", label: "start-blueprints", auth: true },
  { url: "https://app.aeqi.ai/start/solo-founder", label: "start-solo-founder", auth: true },
  { url: "https://app.aeqi.ai/start/personal-os", label: "start-personal-os", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}`, label: "company-shell", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/treasury`, label: "company-treasury", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/ownership`, label: "company-ownership", auth: true },
  { url: `https://app.aeqi.ai/c/${ENTITY_ID}/governance`, label: "company-governance", auth: true },
];

async function visitRoute(context, route) {
  const page = await context.newPage();
  const networkFailures = [];
  const consoleErrors = [];
  const allRequests = [];

  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    allRequests.push({ url, status });
    if (status >= 400 && !url.includes("favicon") && !url.includes("analytics")) {
      networkFailures.push({ url, status });
    }
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGEERROR: ${err.message}`);
  });

  const t0 = Date.now();
  let fcpMs = null;
  let finalUrl = route.url;
  let httpStatus = null;

  try {
    const response = await page.goto(route.url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    httpStatus = response?.status();
    finalUrl = page.url();

    // Measure FCP via Performance API
    try {
      fcpMs = await page.evaluate(() => {
        const entries = performance.getEntriesByType("paint");
        const fcp = entries.find((e) => e.name === "first-contentful-paint");
        return fcp ? Math.round(fcp.startTime) : null;
      });
    } catch (_) {}

    // Wait a beat for React hydration
    await page.waitForTimeout(1500);

    // Screenshot
    const screenshotPath = join(SCREENSHOT_DIR, `${route.label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  screenshot: ${screenshotPath}`);

    // Capture visible text sample for copy analysis
    let bodyText = "";
    try {
      bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    } catch (_) {}

    // Detect anti-patterns in DOM
    const antiPatterns = await page.evaluate(() => {
      const issues = [];
      // Check for "AEQI" uppercase in visible text
      const bodyText = document.body.innerText || "";
      if (/\bAEQI\b/.test(bodyText)) {
        issues.push(`uppercase AEQI found in visible text`);
      }
      // Check for rounded-square buttons (border-radius > 6px on buttons)
      const buttons = Array.from(document.querySelectorAll("button, [role=button], .btn"));
      for (const btn of buttons.slice(0, 30)) {
        const style = window.getComputedStyle(btn);
        const r = parseFloat(style.borderRadius);
        if (r > 8) {
          issues.push(`button with border-radius ${r}px: "${btn.textContent?.trim().slice(0, 40)}"`);
        }
      }
      // Check for hairline 1px borders
      const allEls = Array.from(document.querySelectorAll("*")).slice(0, 200);
      let hairlineCount = 0;
      for (const el of allEls) {
        const s = window.getComputedStyle(el);
        const bw = parseFloat(s.borderTopWidth);
        if (bw === 1 && s.borderTopStyle !== "none" && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
          hairlineCount++;
        }
      }
      if (hairlineCount > 5) {
        issues.push(`${hairlineCount} elements with 1px hairline borders`);
      }
      // Check for JetBrains Mono usage
      const allTextEls = Array.from(document.querySelectorAll("*")).slice(0, 100);
      for (const el of allTextEls) {
        const ff = window.getComputedStyle(el).fontFamily;
        if (ff && ff.toLowerCase().includes("jetbrains")) {
          issues.push(`JetBrains Mono in use on: ${el.tagName} "${el.textContent?.trim().slice(0, 30)}"`);
          break;
        }
      }
      // Check for gradient text
      const gradientTextEls = Array.from(document.querySelectorAll("*")).slice(0, 300);
      for (const el of gradientTextEls) {
        const s = window.getComputedStyle(el);
        if (s.backgroundImage && s.backgroundImage.includes("gradient") && s.webkitBackgroundClip === "text") {
          issues.push(`gradient text on: ${el.tagName} "${el.textContent?.trim().slice(0, 40)}"`);
          break;
        }
      }
      return issues;
    });

    const elapsed = Date.now() - t0;

    return {
      label: route.label,
      url: route.url,
      finalUrl,
      httpStatus,
      elapsed,
      fcpMs,
      screenshotPath,
      networkFailures,
      consoleErrors: consoleErrors.filter(
        (e) => !e.includes("favicon") && !e.includes("analytics")
      ),
      antiPatterns,
      bodyText,
    };
  } catch (err) {
    console.error(`  ERROR visiting ${route.url}: ${err.message}`);
    return {
      label: route.label,
      url: route.url,
      finalUrl,
      httpStatus,
      elapsed: Date.now() - t0,
      fcpMs: null,
      screenshotPath: null,
      networkFailures,
      consoleErrors: [...consoleErrors, `NAV_ERROR: ${err.message}`],
      antiPatterns: [],
      bodyText: "",
      error: err.message,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // Create two contexts — one public, one authed
  const publicCtx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });

  const authedCtx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });

  // Set auth cookie for app.aeqi.ai
  await authedCtx.addCookies([
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
  // Also set localStorage via a page trick
  const setupPage = await authedCtx.newPage();
  await setupPage.goto("https://app.aeqi.ai/", { waitUntil: "commit", timeout: 15000 }).catch(() => {});
  await setupPage.evaluate((token) => {
    localStorage.setItem("aeqi_token", token);
  }, TOKEN);
  await setupPage.close();

  const results = [];
  for (const route of ROUTES) {
    console.log(`\nVisiting [${route.label}] ${route.url}`);
    const ctx = route.auth ? authedCtx : publicCtx;
    const result = await visitRoute(ctx, route);
    results.push(result);
    console.log(`  status=${result.httpStatus} fcp=${result.fcpMs}ms elapsed=${result.elapsed}ms errors=${result.consoleErrors.length} netfails=${result.networkFailures.length} antipatterns=${result.antiPatterns.length}`);
  }

  await browser.close();

  // Save raw JSON
  writeFileSync(
    join(REPO_ROOT, ".observations", "ux-raw-2026-05-04.json"),
    JSON.stringify(results, null, 2)
  );

  console.log("\nResults saved. Generating markdown report...");
  return results;
}

main().then((results) => {
  console.log("\nDone. Results:", results.length, "routes");
  writeFileSync("/tmp/ux-rating-results.json", JSON.stringify(results, null, 2));
}).catch(console.error);
