#!/usr/bin/env node
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const usage = `usage: npm run rehearsal:browser-evidence -- --quest <quest_id> --agent <agent_id> --url <url> [options]

Captures browser evidence for an AEQI quest through the browser MCP tool.

Required:
  --quest <id>       Quest that owns the evidence.
  --agent <id>       Agent whose file store receives screenshot/snapshot evidence.
  --url <url>        Page to capture.

Options:
  --action <name>    screenshot or open. Default: screenshot.
  --viewport <WxH>   Viewport for capture. Default: 1440x900.
  --full-page        Capture a full-page screenshot.
  --wait-ms <ms>     Extra settle time after load. Default: 1000.
  --timeout-ms <ms>  Page navigation timeout. Default: 45000.
  --mcp-http <path>  Path to the AEQI MCP HTTP helper.
  --dry-run          Print the MCP payload without calling AEQI.
  --skip-preflight   Skip the live browser capability check.
  --json             Print raw JSON response.
  --help             Show this help.
`;

function parseArgs(argv) {
  const args = {
    action: "screenshot",
    viewport: "1440x900",
    wait_ms: 1000,
    timeout_ms: 45000,
    full_page: false,
    dry_run: false,
    skip_preflight: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--quest" || arg === "-q") {
      args.quest_id = argv[++i];
    } else if (arg === "--agent" || arg === "-a") {
      args.agent_id = argv[++i];
    } else if (arg === "--url" || arg === "-u") {
      args.url = argv[++i];
    } else if (arg === "--action") {
      args.action = argv[++i];
    } else if (arg === "--viewport") {
      args.viewport = argv[++i];
    } else if (arg === "--wait-ms") {
      args.wait_ms = Number(argv[++i]);
    } else if (arg === "--timeout-ms") {
      args.timeout_ms = Number(argv[++i]);
    } else if (arg === "--mcp-http") {
      args.mcp_http = argv[++i];
    } else if (arg === "--full-page") {
      args.full_page = true;
    } else if (arg === "--dry-run") {
      args.dry_run = true;
    } else if (arg === "--skip-preflight") {
      args.skip_preflight = true;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function validate(args) {
  if (args.help) return;
  for (const key of ["quest_id", "agent_id", "url"]) {
    if (!args[key]) throw new Error(`missing required --${key.replace("_id", "")}`);
  }
  if (!["open", "screenshot"].includes(args.action)) {
    throw new Error("--action must be open or screenshot");
  }
  if (!/^https?:\/\//.test(args.url)) {
    throw new Error("--url must start with http:// or https://");
  }
  if (!/^(\d+)x(\d+)$/.test(String(args.viewport))) {
    throw new Error("--viewport must use WIDTHxHEIGHT, for example 1440x900");
  }
  for (const key of ["wait_ms", "timeout_ms"]) {
    if (!Number.isFinite(args[key]) || args[key] < 0) {
      throw new Error(`--${key.replace("_", "-")} must be a non-negative number`);
    }
  }
}

function commandPath(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveMcpHttp(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.AEQI_MCP_HTTP,
    path.join(os.homedir(), ".aeqi/bin/aeqi-mcp-http"),
    commandPath("aeqi-mcp-http"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "could not find aeqi-mcp-http; pass --mcp-http or set AEQI_MCP_HTTP",
  );
}

function payloadFor(args) {
  return {
    action: args.action,
    quest_id: args.quest_id,
    agent_id: args.agent_id,
    url: args.url,
    viewport: args.viewport,
    full_page: args.full_page,
    wait_ms: args.wait_ms,
    timeout_ms: args.timeout_ms,
  };
}

function callMcp(helper, tool, payload) {
  const result = spawnSync(helper, [tool, JSON.stringify(payload)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stderr.trim()) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    process.stdout.write(result.stdout);
    throw new Error("aeqi-mcp-http returned non-JSON output");
  }
}

function preflightBrowserCapability(helper, action) {
  const capabilities = callMcp(helper, "browser", { action: "capabilities" });
  const actions = Array.isArray(capabilities.actions) ? capabilities.actions : [];
  if (!actions.includes(action)) {
    const planned = Array.isArray(capabilities.planned_actions)
      ? ` planned actions: ${capabilities.planned_actions.join(", ")}.`
      : "";
    throw new Error(
      `live browser MCP does not enable ${action}; status=${capabilities.status ?? "unknown"}; enabled actions: ${actions.join(", ") || "none"}.${planned}`,
    );
  }
  return capabilities;
}

function printSummary(response) {
  if (!response || typeof response !== "object") {
    console.log("browser evidence response was not JSON");
    return;
  }
  console.log(`browser evidence: ${response.ok ? "ok" : "failed"}`);
  console.log(`quest: ${response.quest_id ?? "unknown"}`);
  console.log(`url: ${response.final_url ?? response.url ?? "unknown"}`);
  console.log(`status: ${response.response_status ?? "unknown"}`);
  const screenshot = response.evidence?.screenshot;
  const snapshot = response.evidence?.snapshot;
  if (screenshot?.file?.name || screenshot?.name) {
    console.log(`screenshot: ${screenshot.file?.name ?? screenshot.name}`);
  }
  if (snapshot?.file?.name || snapshot?.name) {
    console.log(`snapshot: ${snapshot.file?.name ?? snapshot.name}`);
  }
  if (Array.isArray(response.console_errors) && response.console_errors.length > 0) {
    console.log(`console errors: ${response.console_errors.length}`);
  }
  if (Array.isArray(response.http_failures) && response.http_failures.length > 0) {
    console.log(`http failures: ${response.http_failures.length}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  validate(args);
  const payload = payloadFor(args);

  if (args.dry_run) {
    console.log(
      JSON.stringify(
        {
          tool: "browser",
          args: payload,
        },
        null,
        2,
      ),
    );
    return;
  }

  const helper = resolveMcpHttp(args.mcp_http);
  if (!args.skip_preflight) {
    const capabilities = preflightBrowserCapability(helper, args.action);
    if (!args.json) {
      console.error(`browser preflight: ${capabilities.status ?? "unknown"}`);
    }
  }
  const response = callMcp(helper, "browser", payload);

  if (args.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    printSummary(response);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
