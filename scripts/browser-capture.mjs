#!/usr/bin/env node
import { chromium } from "playwright";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseViewport(value) {
  if (!value) return { width: 1440, height: 900 };
  let width;
  let height;
  if (typeof value === "object") {
    width = Number(value.width || 1440);
    height = Number(value.height || 900);
  } else {
    const match = /^(\d+)x(\d+)$/.exec(String(value));
    if (!match) throw new Error(`invalid viewport: ${value}`);
    width = Number(match[1]);
    height = Number(match[2]);
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`invalid viewport: ${JSON.stringify(value)}`);
  }
  return {
    width: Math.min(Math.max(Math.trunc(width), 320), 3840),
    height: Math.min(Math.max(Math.trunc(height), 240), 2160),
  };
}

async function settled(page, waitMs) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {
    // Long-polling routes may never reach networkidle.
  }
  await page.waitForTimeout(waitMs);
}

async function main() {
  const raw = await readStdin();
  const request = JSON.parse(raw || "{}");
  const url = request.url;
  if (!url) throw new Error("url required");

  const waitMs = Math.min(Math.max(Number(request.wait_ms || 1000), 0), 10000);
  const timeoutMs = Math.min(
    Math.max(Number(request.timeout_ms || 45000), 1000),
    60000,
  );
  const viewport = parseViewport(request.viewport);
  const consoleErrors = [];
  const requestFailures = [];
  const httpFailures = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push(message.text().slice(0, 500));
    });
    page.on("requestfailed", (req) => {
      requestFailures.push({
        method: req.method(),
        url: req.url(),
        failure: req.failure()?.errorText || "unknown",
      });
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        httpFailures.push({ status: response.status(), url: response.url() });
      }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await settled(page, waitMs);

    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 10000 })
      .catch(() => "");
    const title = await page.title().catch(() => "");
    const screenshot = await page.screenshot({
      fullPage: Boolean(request.full_page),
      type: "png",
    });
    let accessibility = null;
    try {
      accessibility = await page.accessibility.snapshot({
        interestingOnly: true,
      });
    } catch {
      accessibility = null;
    }

    const result = {
      ok: true,
      url,
      final_url: page.url(),
      title,
      response_status: response?.status() ?? null,
      viewport,
      full_page: Boolean(request.full_page),
      text_excerpt: bodyText.replace(/\s+/g, " ").trim().slice(0, 2000),
      console_errors: consoleErrors,
      request_failures: requestFailures,
      http_failures: httpFailures,
      screenshot_b64: screenshot.toString("base64"),
      snapshot_b64: Buffer.from(
        JSON.stringify(
          {
            url,
            final_url: page.url(),
            title,
            response_status: response?.status() ?? null,
            viewport,
            full_page: Boolean(request.full_page),
            text_excerpt: bodyText.replace(/\s+/g, " ").trim().slice(0, 4000),
            accessibility,
            console_errors: consoleErrors,
            request_failures: requestFailures,
            http_failures: httpFailures,
          },
          null,
          2,
        ),
      ).toString("base64"),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: error?.message || String(error) })}\n`,
  );
  process.exitCode = 1;
});
