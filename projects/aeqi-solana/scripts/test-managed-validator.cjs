#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TESTS = ["tests/**/*.ts"];
const PROGRAM_SO_NAMES = {
  aeqi_budget: "aeqi_budget.so",
  aeqi_factory: "aeqi_factory.so",
  aeqi_fund: "aeqi_fund.so",
  aeqi_funding: "aeqi_funding.so",
  aeqi_governance: "aeqi_governance.so",
  aeqi_role: "aeqi_role.so",
  aeqi_token: "aeqi_token.so",
  aeqi_treasury: "aeqi_treasury.so",
  aeqi_company: "aeqi_company.so",
  aeqi_unifutures: "aeqi_unifutures.so",
  aeqi_vesting: "aeqi_vesting.so",
};

function usage() {
  console.log(`Usage: npm run test:managed -- [options] [test files/globs...]

Options:
  --skip-build              Reuse existing target/deploy artifacts and target/types.
  --base-port <port>        Port base for rpc/ws/faucet/gossip/dynamic range.
  --rpc-port <port>         Explicit RPC port; derives the other ports from it.
  --ledger <path>           Validator ledger path. Defaults under .anchor/.
  --timeout-ms <ms>         Validator startup timeout. Default: 30000.
  --verbose-validator       Stream validator stdout/stderr to the console.
  --help                    Show this help.

Environment:
  AEQI_SOLANA_TEST_SKIP_BUILD=1
  AEQI_SOLANA_TEST_BASE_PORT=20900
  AEQI_SOLANA_TEST_RPC_PORT=20901
  AEQI_SOLANA_TEST_LEDGER=.anchor/managed-test-ledger
  AEQI_SOLANA_TEST_VERBOSE_VALIDATOR=1

Examples:
  npm run test:managed
  npm run test:managed -- tests/aeqi-role.ts
  npm run test:managed -- --skip-build tests/aeqi-token.ts`);
}

function parseArgs(argv) {
  const opts = {
    skipBuild: process.env.AEQI_SOLANA_TEST_SKIP_BUILD === "1",
    basePort: numberEnv("AEQI_SOLANA_TEST_BASE_PORT"),
    rpcPort: numberEnv("AEQI_SOLANA_TEST_RPC_PORT"),
    ledger: process.env.AEQI_SOLANA_TEST_LEDGER,
    timeoutMs: numberEnv("AEQI_SOLANA_TEST_TIMEOUT_MS") ?? 30_000,
    verboseValidator: process.env.AEQI_SOLANA_TEST_VERBOSE_VALIDATOR === "1",
    tests: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--skip-build" || arg === "--no-build") {
      opts.skipBuild = true;
      continue;
    }
    if (arg === "--base-port") {
      opts.basePort = requiredNumber(argv[++i], arg);
      continue;
    }
    if (arg === "--rpc-port") {
      opts.rpcPort = requiredNumber(argv[++i], arg);
      continue;
    }
    if (arg === "--ledger") {
      opts.ledger = requireValue(argv[++i], arg);
      continue;
    }
    if (arg === "--timeout-ms") {
      opts.timeoutMs = requiredNumber(argv[++i], arg);
      continue;
    }
    if (arg === "--verbose-validator") {
      opts.verboseValidator = true;
      continue;
    }
    opts.tests.push(arg);
  }

  return opts;
}

function numberEnv(name) {
  if (!process.env[name]) return undefined;
  return requiredNumber(process.env[name], name);
}

function requiredNumber(value, name) {
  const parsed = Number.parseInt(requireValue(value, name), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function parseProgramIds() {
  const anchorToml = fs.readFileSync(path.join(ROOT, "Anchor.toml"), "utf8");
  const programIds = {};
  let inLocalnet = false;

  for (const line of anchorToml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[programs.localnet]") {
      inLocalnet = true;
      continue;
    }
    if (inLocalnet && trimmed.startsWith("[")) break;
    if (!inLocalnet || !trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"$/);
    if (match) programIds[match[1]] = match[2];
  }

  const missing = Object.keys(PROGRAM_SO_NAMES).filter(
    (name) => !programIds[name],
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing [programs.localnet] IDs for: ${missing.join(", ")}`,
    );
  }
  return programIds;
}

async function findPorts(opts) {
  const requestedBase =
    opts.basePort ?? (opts.rpcPort ? opts.rpcPort - 1 : undefined);
  const start = requestedBase ?? 20_000 + Math.floor(Math.random() * 1_000);

  for (let base = start; base < start + 2_000; base += 100) {
    const ports = {
      base,
      rpc: opts.rpcPort ?? base + 1,
      ws: (opts.rpcPort ?? base + 1) + 1,
      faucet: base + 10,
      gossip: base + 11,
      dynamicStart: base + 20,
      dynamicEnd: base + 80,
    };
    const candidates = [
      ports.rpc,
      ports.ws,
      ports.faucet,
      ports.gossip,
      ports.dynamicStart,
      ports.dynamicStart + 1,
      ports.dynamicStart + 2,
      ports.dynamicEnd,
    ];

    if (await portsAreFree(candidates)) return ports;
    if (requestedBase) {
      throw new Error(`Requested port base ${requestedBase} is not available`);
    }
  }
  throw new Error("Could not find a free managed validator port range");
}

async function portsAreFree(ports) {
  const results = await Promise.all(ports.map((port) => isPortFree(port)));
  return results.every(Boolean);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function runChecked(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`,
    );
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function latestMtimeMs(dir) {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtimeMs(fullPath));
    } else if (entry.isFile()) {
      latest = Math.max(latest, fs.statSync(fullPath).mtimeMs);
    }
  }
  return latest;
}

function assertSkipBuildArtifactsFresh() {
  const stale = [];

  for (const [name, soName] of Object.entries(PROGRAM_SO_NAMES)) {
    const programDir = path.join(ROOT, "programs", name.replaceAll("_", "-"));
    const sourceMtime = latestMtimeMs(path.join(programDir, "src"));
    const artifacts = [
      path.join(ROOT, "target", "deploy", soName),
      path.join(ROOT, "target", "idl", `${name}.json`),
      path.join(ROOT, "target", "types", `${name}.ts`),
    ];

    for (const artifact of artifacts) {
      if (!fs.existsSync(artifact)) {
        stale.push(`${path.relative(ROOT, artifact)} is missing`);
        continue;
      }
      if (fs.statSync(artifact).mtimeMs + 1_000 < sourceMtime) {
        stale.push(
          `${path.relative(ROOT, artifact)} is older than ${path.relative(ROOT, programDir)}/src`,
        );
      }
    }
  }

  if (stale.length > 0) {
    throw new Error(
      [
        "--skip-build requested but generated Solana artifacts are missing or stale:",
        ...stale.map((line) => `  - ${line}`),
        "Run `anchor build` or omit `--skip-build` before running managed tests.",
      ].join(os.EOL),
    );
  }
}

function validatorArgs(programIds, ports, ledger) {
  const args = [
    "--reset",
    "--ledger",
    ledger,
    "--mint",
    runCapture("solana", ["address"]),
  ];

  for (const [name, programId] of Object.entries(programIds)) {
    args.push(
      "--bpf-program",
      programId,
      path.join("target", "deploy", PROGRAM_SO_NAMES[name]),
    );
  }

  args.push(
    "--bind-address",
    "127.0.0.1",
    "--rpc-port",
    String(ports.rpc),
    "--faucet-port",
    String(ports.faucet),
    "--gossip-port",
    String(ports.gossip),
    "--dynamic-port-range",
    `${ports.dynamicStart}-${ports.dynamicEnd}`,
  );

  return args;
}

async function waitForRpc(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await rpcRequest(port, "getHealth");
      if (health.result === "ok") return;
    } catch (_) {
      await sleep(500);
    }
  }
  throw new Error(`Validator RPC did not become healthy within ${timeoutMs}ms`);
}

function rpcRequest(port, method) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 1_000,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("RPC timeout")));
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(5_000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tests = opts.tests.length > 0 ? opts.tests : DEFAULT_TESTS;
  const ledger = path.resolve(
    ROOT,
    opts.ledger ?? path.join(".anchor", "managed-test-ledger"),
  );
  const validatorOutput = `${ledger}.output.log`;
  const programIds = parseProgramIds();
  const ports = await findPorts(opts);

  if (!opts.skipBuild) {
    runChecked("anchor", ["build"]);
  } else {
    assertSkipBuildArtifactsFresh();
  }

  fs.rmSync(ledger, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(ledger), { recursive: true });

  console.log(
    [
      "Starting managed Solana validator",
      `  rpc: http://127.0.0.1:${ports.rpc}`,
      `  websocket: ws://127.0.0.1:${ports.ws}`,
      `  faucet: ${ports.faucet}`,
      `  gossip: ${ports.gossip}`,
      `  dynamic: ${ports.dynamicStart}-${ports.dynamicEnd}`,
      `  ledger: ${path.relative(ROOT, ledger) || ledger}`,
      `  validator output: ${path.relative(ROOT, validatorOutput) || validatorOutput}`,
    ].join(os.EOL),
  );

  const validatorLog = fs.createWriteStream(validatorOutput, { flags: "w" });
  const validator = spawn(
    "solana-test-validator",
    validatorArgs(programIds, ports, ledger),
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  validator.stdout.on("data", (chunk) => {
    validatorLog.write(chunk);
    if (opts.verboseValidator) process.stdout.write(chunk);
  });
  validator.stderr.on("data", (chunk) => {
    validatorLog.write(chunk);
    if (opts.verboseValidator) process.stderr.write(chunk);
  });

  const shutdown = async () => {
    await stopProcess(validator);
    validatorLog.end();
  };

  process.once("SIGINT", async () => {
    await shutdown();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await shutdown();
    process.exit(143);
  });

  try {
    await waitForRpc(ports.rpc, opts.timeoutMs);
    console.log(`Running ts-mocha against http://127.0.0.1:${ports.rpc}`);

    const mocha = spawn(
      path.join(ROOT, "node_modules", ".bin", "ts-mocha"),
      ["-p", "./tsconfig.json", "-t", "1000000", ...tests],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ANCHOR_PROVIDER_URL: `http://127.0.0.1:${ports.rpc}`,
          ANCHOR_WALLET:
            process.env.ANCHOR_WALLET ??
            path.join(os.homedir(), ".config", "solana", "id.json"),
        },
        stdio: "inherit",
      },
    );

    const code = await new Promise((resolve, reject) => {
      mocha.once("error", reject);
      mocha.once("exit", (exitCode, signal) => {
        if (signal) resolve(128);
        else resolve(exitCode ?? 1);
      });
    });

    await shutdown();
    process.exitCode = code;
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
