#!/usr/bin/env node
/**
 * Repeatable launch smoke for app.aeqi.ai.
 *
 * This composes scripts/visual-route.mjs across the routes most likely to
 * appear in a launch or fundraising demo. Secrets are never loaded here:
 * callers provide AEQI_TOKEN, or AEQI_WEB_SECRET + AEQI_USER_ID + AEQI_EMAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BASE_URL = "https://app.aeqi.ai";
const DEFAULT_VIEWPORT = "1440x900";
const DEFAULT_WAIT_MS = "2500";

function usage() {
  console.log(`Usage:
  npm run launch:smoke
  AEQI_ENTITY=<trust-or-entity-id> AEQI_TOKEN=<jwt> npm run launch:smoke

Options:
  --base <url>         Base URL. Default: ${DEFAULT_BASE_URL}
  --trust <id>         TRUST/entity id for /trust/<id> checks. Defaults to AEQI_ENTITY.
  --out-dir <dir>      Artifact directory. Default: /tmp/aeqi-launch-smoke-<timestamp>
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --wait-ms <ms>       Visual-route settle wait. Default: ${DEFAULT_WAIT_MS}
  --public-only        Run only unauthenticated checks.
  --help               Show this help.

Auth:
  Protected route checks require either AEQI_TOKEN, or AEQI_WEB_SECRET plus
  AEQI_USER_ID and AEQI_EMAIL. The script passes those through to visual-route.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--public-only") {
      args.publicOnly = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      args[key] = value;
      i += 1;
      continue;
    }
    throw new Error(`Unexpected positional argument: ${arg}`);
  }
  return args;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}

function hasAuthEnv() {
  if (process.env.AEQI_TOKEN) return true;
  return Boolean(process.env.AEQI_WEB_SECRET && process.env.AEQI_USER_ID && process.env.AEQI_EMAIL);
}

function visualRouteArgs(check, opts) {
  const out = path.join(opts.outDir, `${check.name}.png`);
  const report = path.join(opts.outDir, `${check.name}.json`);
  const args = [
    path.join("scripts", "visual-route.mjs"),
    "--base",
    opts.baseUrl,
    "--url",
    check.url,
    "--viewport",
    opts.viewport,
    "--wait-ms",
    opts.waitMs,
    "--out",
    out,
    "--report",
    report,
    "--fail-on-console",
    "--fail-on-network",
  ];
  if (check.auth) args.push("--require-auth");
  else args.push("--no-auth");
  if (opts.trustId && check.auth) args.push("--entity", opts.trustId);
  for (const text of check.expectText) args.push("--expect-text", text);
  return { args, report };
}

function checksFor(opts) {
  const checks = [
    {
      name: "login-launch-redirect",
      url: "/login?next=%2Flaunch",
      auth: false,
      expectText: ["Continue with email"],
    },
  ];
  if (opts.publicOnly) return checks;

  checks.push(
    {
      name: "home-auth",
      url: "/",
      auth: true,
      expectText: ["Inbox"],
    },
    {
      name: "launch-auth",
      url: "/launch",
      auth: true,
      expectText: ["Name is available."],
    },
    {
      name: "blueprints-auth",
      url: "/blueprints",
      auth: true,
      expectText: ["Blueprints"],
    },
  );

  if (opts.trustId) {
    checks.push(
      {
        name: "trust-overview-auth",
        url: `/trust/${opts.trustId}`,
        auth: true,
        expectText: ["Activity"],
      },
      {
        name: "trust-ideas-auth",
        url: `/trust/${opts.trustId}/ideas`,
        auth: true,
        expectText: ["Ideas"],
      },
    );
  }
  return checks;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const opts = {
    baseUrl: args.base ?? DEFAULT_BASE_URL,
    trustId: args.trust ?? process.env.AEQI_ENTITY ?? null,
    outDir: args["out-dir"] ?? path.join("/tmp", `aeqi-launch-smoke-${timestamp()}`),
    viewport: args.viewport ?? DEFAULT_VIEWPORT,
    waitMs: args["wait-ms"] ?? DEFAULT_WAIT_MS,
    publicOnly: Boolean(args.publicOnly),
  };

  if (!opts.publicOnly && !hasAuthEnv()) {
    throw new Error(
      "Authenticated launch smoke requires AEQI_TOKEN, or AEQI_WEB_SECRET + AEQI_USER_ID + AEQI_EMAIL. Use --public-only for the unauthenticated check.",
    );
  }
  if (!opts.publicOnly && !opts.trustId) {
    throw new Error("Authenticated launch smoke requires --trust or AEQI_ENTITY.");
  }

  fs.mkdirSync(opts.outDir, { recursive: true });
  const checks = checksFor(opts);
  const results = [];

  for (const check of checks) {
    const { args: routeArgs, report } = visualRouteArgs(check, opts);
    console.log(`\n[launch-smoke] ${check.name}: ${check.url}`);
    const result = spawnSync(process.execPath, routeArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    results.push({
      name: check.name,
      url: check.url,
      ok: result.status === 0,
      status: result.status,
      report,
    });
  }

  const summary = {
    ok: results.every((r) => r.ok),
    baseUrl: opts.baseUrl,
    trustId: opts.trustId,
    outDir: opts.outDir,
    results,
  };
  const summaryPath = path.join(opts.outDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n[launch-smoke] summary: ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 2;
}

main();
