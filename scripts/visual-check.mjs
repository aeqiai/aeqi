#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  checks,
  DEFAULT_ROLE_ID,
  DEFAULT_TRUST_ID,
  listChecks,
} from "./visual-checks/routes.mjs";

function usage() {
  console.log(`Usage:
  node scripts/visual-check.mjs --list
  node scripts/visual-check.mjs <check|all> [options]

Options:
  --base <url>          Base URL. Default: visual-route default.
  --trust <id>          TRUST id. Default: ${DEFAULT_TRUST_ID}
  --role-id <id>        Role id for role-detail. Default: ${DEFAULT_ROLE_ID}
  --viewport <WxH>      Browser viewport.
  --wait-ms <ms>        Wait after load/clicks.
  --out-dir <dir>       Screenshot/report directory. Default: /tmp/aeqi-visual-checks
  --layout              Run named layout assertions for checks that define them.
  --full-page           Capture full-page screenshots.
  --fail-on-console     Fail on console.error.
  --fail-on-network     Fail on request/HTTP failures.
  --require-auth        Require auth for authenticated checks. Default for auth checks.
  --no-auth             Disable auth for all checks.
  --dry-run             Print visual-route commands without running them.`);
}

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--list") args.list = true;
    else if (
      [
        "--layout",
        "--full-page",
        "--fail-on-console",
        "--fail-on-network",
        "--require-auth",
        "--no-auth",
        "--dry-run",
      ].includes(arg)
    ) {
      args[arg.slice(2)] = true;
    } else if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      args[arg.slice(2)] = value;
      i += 1;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

function routeArgsFor(checkName, check, args) {
  const trust = args.trust ?? process.env.AEQI_VISUAL_TRUST ?? DEFAULT_TRUST_ID;
  const roleId = args["role-id"] ?? process.env.AEQI_VISUAL_ROLE_ID ?? DEFAULT_ROLE_ID;
  const url = check.url({ trust, roleId });
  const outDir = args["out-dir"] ?? "/tmp/aeqi-visual-checks";
  const out = path.join(outDir, `${checkName}.png`);
  const routeArgs = ["scripts/visual-route.mjs", "--url", url, "--out", out];

  if (args.base) routeArgs.push("--base", args.base);
  if (args.viewport) routeArgs.push("--viewport", args.viewport);
  if (args["wait-ms"]) routeArgs.push("--wait-ms", args["wait-ms"]);
  if (args["full-page"]) routeArgs.push("--full-page");
  if (args["fail-on-console"]) routeArgs.push("--fail-on-console");
  if (args["fail-on-network"]) routeArgs.push("--fail-on-network");
  if (args["no-auth"] || check.auth === false) {
    routeArgs.push("--no-auth");
  } else if (args["require-auth"] || check.auth) {
    routeArgs.push("--require-auth");
  }
  for (const text of check.expectText ?? []) routeArgs.push("--expect-text", text);
  for (const selector of check.expectSelector ?? []) {
    routeArgs.push("--expect-selector", selector);
  }
  if (args.layout) {
    for (const assertion of check.layout ?? []) routeArgs.push("--assert-layout", assertion);
  }
  return routeArgs;
}

function printList() {
  for (const check of listChecks()) {
    console.log(
      `${check.name.padEnd(18)} auth=${String(check.auth).padEnd(5)} layout=${check.layout.join(",") || "-"}`,
    );
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}
if (args.list) {
  printList();
  process.exit(0);
}

const selected = args.positional[0] ?? "role-detail";
const names = selected === "all" ? Object.keys(checks) : [selected];
const missing = names.filter((name) => !checks[name]);
if (missing.length > 0) {
  usage();
  throw new Error(`Unknown visual check(s): ${missing.join(", ")}`);
}

fs.mkdirSync(args["out-dir"] ?? "/tmp/aeqi-visual-checks", { recursive: true });
if (!args["dry-run"] && !fs.existsSync("node_modules/playwright/package.json")) {
  throw new Error(
    "Missing root node_modules/playwright. In a worktree, run `npm run ui:wt -- doctor <worktree> --repair` first.",
  );
}

let failed = false;
for (const name of names) {
  const commandArgs = routeArgsFor(name, checks[name], args);
  if (args["dry-run"]) {
    console.log(["node", ...commandArgs].join(" "));
    continue;
  }
  const result = spawnSync("node", commandArgs, { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(2);
