#!/usr/bin/env node
/**
 * Capture a single UI route with Playwright and emit a compact QA report.
 *
 * This is an operator visual probe, not a CI blanket gate. It is cheap by
 * default: collect console/network signals, assert requested text/selectors,
 * save a screenshot, and only inspect the image when the UI change warrants it.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "https://app.aeqi.ai";
const DEFAULT_VIEWPORT = "1440x900";
const DEFAULT_WAIT_MS = 2500;

function usage() {
  console.log(`Usage:
  node scripts/visual-route.mjs --url /admin --expect-text "Admin"

Options:
  --url <path-or-url>          Route to open. Required.
  --base <url>                 Base URL for relative routes. Default: ${DEFAULT_BASE_URL}
  --out <png-path>             Screenshot path. Default: /tmp/aeqi-visual-<route>-<ts>.png
  --report <json-path>         Report path. Default: <out>.json
  --viewport <WxH>             Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --wait-ms <ms>               Wait after load and each click. Default: ${DEFAULT_WAIT_MS}
  --expect-text <text>         Require body text to include text. Repeatable.
  --expect-selector <selector> Require selector to exist. Repeatable.
  --click <selector>           Click selector before assertions/screenshot. Repeatable.
  --full-page                  Capture the full page. Default: viewport screenshot.
  --no-auth                    Do not seed auth localStorage.
  --require-auth               Require auth material and fail on auth redirects.
  --storage-state <json>       Playwright storage state with a logged-in app session.
  --auth-env <path>            Load auth env vars from KEY=VALUE file before resolving auth.
  --token <jwt>                JWT to seed. Falls back to AEQI_TOKEN.
  --user-id <id>               JWT subject/user_id when minting from AEQI_WEB_SECRET.
  --email <email>              JWT email when minting from AEQI_WEB_SECRET.
  --ttl <seconds>              Minted token TTL. Default: 1800.
  --entity <id>                Optional aeqi_entity localStorage value.
  --fail-on-console           Fail when console.error is observed.
  --fail-on-network           Fail when request failures or HTTP >=400 are observed.
  --help                      Show this help.

Auth modes:
  1. AEQI_TOKEN or --token seeds an existing JWT.
  2. Secret-mode runtimes log in with AEQI_AUTH_SECRET, AEQI_WEB_SECRET, or [web].auth_secret.
  3. Accounts-mode runtimes can log in with AEQI_EMAIL + AEQI_PASSWORD.
  4. AEQI_WEB_SECRET + AEQI_USER_ID/--user-id + AEQI_EMAIL/--email mints one.
  5. --storage-state reuses a Playwright-authenticated browser state file.
  6. --no-auth captures public/login routes without auth.

When --require-auth is set, redirects to /login, /signup, or /welcome fail the report.`);
}

function parseArgs(argv) {
  const args = {
    expectText: [],
    expectSelector: [],
    click: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (
      [
        "--full-page",
        "--no-auth",
        "--require-auth",
        "--fail-on-console",
        "--fail-on-network",
      ].includes(arg)
    ) {
      args[arg.slice(2)] = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      if (key === "expect-text") args.expectText.push(value);
      else if (key === "expect-selector") args.expectSelector.push(value);
      else if (key === "click") args.click.push(value);
      else args[key] = value;
      continue;
    }
    if (!args.url) {
      args.url = arg;
      continue;
    }
    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return args;
}

function expandHome(value) {
  if (!value.startsWith("~/")) return value;
  const home = process.env.HOME;
  return home ? path.join(home, value.slice(2)) : value;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const normalized = trimmed.startsWith("export ")
    ? trimmed.slice(7).trim()
    : trimmed;
  const idx = normalized.indexOf("=");
  if (idx <= 0) return null;
  const key = normalized.slice(0, idx).trim();
  let value = normalized.slice(idx + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadAuthEnv(filePath) {
  const resolved = expandHome(filePath);
  const loaded = [];
  const content = fs.readFileSync(resolved, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] == null) {
      process.env[parsed.key] = parsed.value;
      loaded.push(parsed.key);
    }
  }
  return { path: resolved, loaded };
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function mintToken({ secret, userId, email, ttlSeconds }) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      user_id: userId,
      email,
      iat: now,
      exp: now + ttlSeconds,
    }),
  );
  const data = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${data}.${signature}`;
}

function resolveUrl(route, baseUrl) {
  try {
    return new URL(route).toString();
  } catch {
    return new URL(route, baseUrl).toString();
  }
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match)
    throw new Error(
      `Invalid viewport "${value}". Use WIDTHxHEIGHT, e.g. 1440x900.`,
    );
  return { width: Number(match[1]), height: Number(match[2]) };
}

function routeSlug(url) {
  const parsed = new URL(url);
  const slug = parsed.pathname
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  return slug || "root";
}

function defaultOutPath(url) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("/tmp", `aeqi-visual-${routeSlug(url)}-${stamp}.png`);
}

function defaultReportPath(outPath) {
  return /\.png$/i.test(outPath)
    ? outPath.replace(/\.png$/i, ".json")
    : `${outPath}.json`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    const message =
      (body && typeof body.error === "string" && body.error) ||
      (body && typeof body.message === "string" && body.message) ||
      response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return body;
}

async function probeAuthMode(origin, warnings) {
  try {
    const body = await fetchJson(`${origin}/api/auth/mode`);
    return {
      appMode: body?.app_mode || "runtime",
      authMode: body?.mode || "accounts",
      source: "api",
    };
  } catch (error) {
    warnings.push(
      `Auth mode probe failed; defaulting to accounts/runtime: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { appMode: "runtime", authMode: "accounts", source: "default" };
  }
}

function readAuthSecretFromConfig(filePath) {
  if (!filePath) return null;
  const resolved = expandHome(filePath);
  if (!fs.existsSync(resolved)) return null;
  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  let inWeb = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const section = /^\[([^\]]+)\]$/.exec(trimmed);
    if (section) {
      inWeb = section[1] === "web";
      continue;
    }
    if (!inWeb) continue;
    const match = /^auth_secret\s*=\s*(.+)$/.exec(trimmed);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

function resolveSecretModeSecret() {
  if (process.env.AEQI_AUTH_SECRET) {
    return { value: process.env.AEQI_AUTH_SECRET, source: "AEQI_AUTH_SECRET" };
  }
  if (process.env.AEQI_WEB_SECRET) {
    return { value: process.env.AEQI_WEB_SECRET, source: "AEQI_WEB_SECRET" };
  }
  for (const filePath of [process.env.AEQI_CONFIG, "~/.aeqi/aeqi.toml"].filter(
    Boolean,
  )) {
    const value = readAuthSecretFromConfig(filePath);
    if (value) return { value, source: filePath };
  }
  return null;
}

async function loginSecretMode(origin) {
  const secret = resolveSecretModeSecret();
  if (!secret) return null;
  const body = await fetchJson(`${origin}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ secret: secret.value }),
  });
  if (!body?.token) throw new Error("secret-mode login returned no token");
  return { token: body.token, source: `secret-login:${secret.source}` };
}

async function loginAccountsMode(origin) {
  const email = process.env.AEQI_EMAIL;
  const password = process.env.AEQI_PASSWORD;
  if (!email || !password) return null;
  const body = await fetchJson(`${origin}/api/auth/login/email`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!body?.token) throw new Error("account login returned no token");
  return {
    token: body.token,
    source: "account-login:AEQI_EMAIL+AEQI_PASSWORD",
  };
}

async function resolveAuthSeed({ args, url, ttlSeconds, warnings }) {
  if (args["no-auth"]) {
    return { token: null, appMode: null, authMode: null, source: "none" };
  }
  if (args["storage-state"]) {
    return {
      token: null,
      appMode: null,
      authMode: null,
      source: "storage-state",
    };
  }

  const origin = new URL(url).origin;
  const mode = await probeAuthMode(origin, warnings);
  const explicitToken = args.token ?? process.env.AEQI_TOKEN ?? null;
  if (explicitToken) {
    return {
      token: explicitToken,
      appMode: mode.appMode,
      authMode: mode.authMode,
      source: "token",
    };
  }

  if (mode.authMode === "none") {
    return {
      token: null,
      appMode: mode.appMode,
      authMode: "none",
      source: "auth-mode:none",
    };
  }

  if (mode.authMode === "secret") {
    try {
      const login = await loginSecretMode(origin);
      if (login) {
        return {
          token: login.token,
          appMode: mode.appMode,
          authMode: mode.authMode,
          source: login.source,
        };
      }
    } catch (error) {
      throw new Error(
        `Secret-mode auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (mode.authMode === "accounts") {
    try {
      const login = await loginAccountsMode(origin);
      if (login) {
        return {
          token: login.token,
          appMode: mode.appMode,
          authMode: mode.authMode,
          source: login.source,
        };
      }
    } catch (error) {
      throw new Error(
        `Account auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (process.env.AEQI_WEB_SECRET) {
    const userId = args["user-id"] ?? process.env.AEQI_USER_ID;
    const email = args.email ?? process.env.AEQI_EMAIL;
    if (userId && email) {
      return {
        token: mintToken({
          secret: process.env.AEQI_WEB_SECRET,
          userId,
          email,
          ttlSeconds,
        }),
        appMode: mode.appMode,
        authMode: mode.authMode,
        source: "minted:AEQI_WEB_SECRET",
      };
    }
    warnings.push(
      "AEQI_WEB_SECRET is set, but AEQI_USER_ID/--user-id and AEQI_EMAIL/--email are required to mint a token.",
    );
  }

  return {
    token: null,
    appMode: mode.appMode,
    authMode: mode.authMode,
    source: "unavailable",
  };
}

function isAuthRedirect(url) {
  const parsed = new URL(url);
  return ["/login", "/signup", "/welcome"].includes(parsed.pathname);
}

async function waitForSettledPage(page, waitMs) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 30000 });
  } catch {
    // Long-polling and websocket-heavy routes may never become network-idle.
  }
  await page.waitForTimeout(waitMs);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.url) {
    usage();
    throw new Error("--url is required");
  }

  const baseUrl = args.base ?? DEFAULT_BASE_URL;
  const url = resolveUrl(args.url, baseUrl);
  const viewport = parseViewport(args.viewport ?? DEFAULT_VIEWPORT);
  const waitMs = Number(args["wait-ms"] ?? DEFAULT_WAIT_MS);
  const ttlSeconds = Number(args.ttl ?? 1800);
  const outPath = args.out ?? defaultOutPath(url);
  const reportPath = args.report ?? defaultReportPath(outPath);
  const failures = [];
  const warnings = [];
  let authEnvLoaded = null;

  const authEnvPath = args["auth-env"] ?? process.env.AEQI_VISUAL_AUTH_ENV;
  if (authEnvPath && !args["no-auth"]) {
    try {
      authEnvLoaded = loadAuthEnv(authEnvPath);
    } catch (error) {
      throw new Error(
        `Failed to load auth env file ${authEnvPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (args["require-auth"] && args["no-auth"]) {
    throw new Error("--require-auth cannot be combined with --no-auth.");
  }
  const authSeed = await resolveAuthSeed({ args, url, ttlSeconds, warnings });
  const token = authSeed.token;
  if (args["require-auth"] && authSeed.source === "unavailable") {
    throw new Error(
      `Auth required but no usable auth material is available for mode ${authSeed.authMode}. Pass --token/AEQI_TOKEN, --storage-state, AEQI_EMAIL+AEQI_PASSWORD, or AEQI_WEB_SECRET+user/email.`,
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const consoleErrors = [];
  const requestFailures = [];
  const httpFailures = [];

  const browser = await chromium.launch({ headless: true });
  const contextOptions = { viewport };
  if (args["storage-state"] && !args["no-auth"]) {
    contextOptions.storageState = expandHome(args["storage-state"]);
  }
  const context = await browser.newContext(contextOptions);
  if (
    (token || authSeed.authMode || args.entity || process.env.AEQI_ENTITY) &&
    !args["no-auth"]
  ) {
    await context.addInitScript(
      ({ seededToken, appMode, authMode, entity }) => {
        if (seededToken) window.localStorage.setItem("aeqi_token", seededToken);
        if (appMode) window.localStorage.setItem("aeqi_app_mode", appMode);
        if (authMode) window.localStorage.setItem("aeqi_auth_mode", authMode);
        if (entity) window.localStorage.setItem("aeqi_entity", entity);
      },
      {
        seededToken: token,
        appMode: authSeed.appMode,
        authMode: authSeed.authMode,
        entity: args.entity ?? process.env.AEQI_ENTITY ?? null,
      },
    );
  }

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text().slice(0, 500));
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) {
      httpFailures.push({
        status,
        url: response.url(),
      });
    }
  });

  let responseStatus = null;
  let finalUrl = url;
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    responseStatus = response?.status() ?? null;
    await waitForSettledPage(page, waitMs);

    for (const selector of args.click) {
      await page.locator(selector).first().click({ timeout: 15000 });
      await waitForSettledPage(page, Math.max(500, Math.floor(waitMs / 2)));
    }

    finalUrl = page.url();
    const authRedirected = isAuthRedirect(finalUrl);

    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 10000 })
      .catch(() => "");
    const normalizedBody = bodyText.replace(/\s+/g, " ").trim();

    for (const expected of args.expectText) {
      if (!normalizedBody.includes(expected)) {
        failures.push(`Expected text not found: ${expected}`);
      }
    }
    for (const selector of args.expectSelector) {
      const count = await page.locator(selector).count();
      if (count === 0)
        failures.push(`Expected selector not found: ${selector}`);
    }

    if (responseStatus !== null && responseStatus >= 400) {
      failures.push(`Navigation returned HTTP ${responseStatus}`);
    }
    if (args["require-auth"] && authRedirected) {
      failures.push(
        `Authenticated route redirected to ${new URL(finalUrl).pathname}`,
      );
    }
    if (args["fail-on-console"] && consoleErrors.length > 0) {
      failures.push(`${consoleErrors.length} console error(s) observed`);
    }
    if (
      args["fail-on-network"] &&
      (requestFailures.length > 0 || httpFailures.length > 0)
    ) {
      failures.push(
        `${requestFailures.length} request failure(s), ${httpFailures.length} HTTP failure(s) observed`,
      );
    }

    await page.screenshot({
      path: outPath,
      fullPage: Boolean(args["full-page"]),
    });

    const report = {
      ok: failures.length === 0,
      url,
      finalUrl,
      responseStatus,
      viewport,
      fullPage: Boolean(args["full-page"]),
      authSeeded: Boolean(
        (token || authSeed.source === "storage-state") && !args["no-auth"],
      ),
      authMode: authSeed.authMode ?? authSeed.source,
      authSource: authSeed.source,
      authRedirected,
      authEnvLoaded: authEnvLoaded
        ? { path: authEnvLoaded.path, keys: authEnvLoaded.loaded.sort() }
        : null,
      screenshot: outPath,
      report: reportPath,
      expectedText: args.expectText,
      expectedSelectors: args.expectSelector,
      clicked: args.click,
      warnings,
      failures,
      consoleErrors: consoleErrors.slice(0, 20),
      requestFailures: requestFailures.slice(0, 20),
      httpFailures: httpFailures.slice(0, 20),
      bodyTextSample: normalizedBody.slice(0, 2000),
    };

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    `[visual-route] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
