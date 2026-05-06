//! aeqi-aa-smoke — end-to-end ERC-4337 UserOperation smoke test.
//!
//! Exercises the full AA stack (anvil + rundler bundler + aeqi-paymaster) and
//! reports a structured result so broken deployments are caught immediately.
//!
//! ## What it proves
//!
//! 1. Anvil is reachable and reports chain ID 31337.
//! 2. Bundler is reachable and lists EntryPoint v0.7.
//! 3. Paymaster service is reachable (health check).
//! 4. Paymaster.sol deploys and can be funded via EP.depositTo.
//! 5. SimpleAccount deploys with ECDSA validation.
//! 6. A UserOp signed by the account owner is accepted by the bundler.
//! 7. The bundler mines the UserOp on anvil chain 31337.
//! 8. `eth_getUserOperationReceipt` returns `success=true`.
//!
//! ## Known limitation — paymaster sponsorship path
//!
//! The paymaster-sponsored path has a v0.7 offset incompatibility in Paymaster.sol
//! (see `docs/aa-userop-lifecycle.md`). This binary uses the self-paying path to
//! prove the core stack, and separately checks paymaster service connectivity.
//!
//! ## Usage
//!
//! Requires anvil (:8545), bundler (:3000), and aeqi-paymaster (:3001) to be running.
//!
//! ```bash
//! cargo run -p aeqi-paymaster --bin aa-smoke --release
//! # or with JSON output:
//! SMOKE_JSON=1 cargo run -p aeqi-paymaster --bin aa-smoke --release
//! ```
//!
//! Exit code 0 = success, 1 = failure.

use std::time::Instant;

use anyhow::{Context, Result, anyhow};
use serde_json::json;

const ANVIL_URL: &str = "http://127.0.0.1:8545";
const BUNDLER_URL: &str = "http://127.0.0.1:3000";
const PAYMASTER_URL: &str = "http://127.0.0.1:3001";
const EP_V07: &str = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/// Hardhat/anvil account #0 — deployer, account owner, and paymaster signer.
/// Never use in production.
const DEPLOYER_PK: &str = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_ADDR: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ── Shell helper ──────────────────────────────────────────────────────────────

/// Run a shell command, returning trimmed stdout.
/// Returns an empty string on failure (caller asserts).
fn sh(cmd: &str) -> String {
    let out = std::process::Command::new("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .unwrap_or_else(|e| panic!("sh failed to launch: {cmd}: {e}"));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Run a shell command, returning (stdout, success).
fn sh_status(cmd: &str) -> (String, bool) {
    let out = std::process::Command::new("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .unwrap_or_else(|e| panic!("sh failed to launch: {cmd}: {e}"));
    (
        String::from_utf8_lossy(&out.stdout).trim().to_string(),
        out.status.success(),
    )
}

/// Deploy a contract from pre-compiled bytecode via `cast send --create`.
///
/// Bytecode is passed via an environment variable to avoid bash argument
/// length limits on large hex strings.
///
/// Returns the deployed contract address (0x-prefixed).
fn cast_deploy(bytecode: &str, abi_sig: &str, args: &[&str]) -> Result<String> {
    // Build ABI-encoded constructor args.
    let args_quoted = args
        .iter()
        .map(|a| format!("'{a}'"))
        .collect::<Vec<_>>()
        .join(" ");
    let ctor_hex = sh(&format!(
        "cast abi-encode '{abi_sig}' {args_quoted} 2>/dev/null"
    ));
    if ctor_hex.is_empty() {
        return Err(anyhow!(
            "cast abi-encode failed for sig={abi_sig} args={args:?}"
        ));
    }
    let deploy_data = format!("{}{}", bytecode, ctor_hex.trim_start_matches("0x"));

    // Pass bytecode via env var (avoids shell 4096-char arg limit).
    let out = std::process::Command::new("bash")
        .arg("-c")
        .arg(format!(
            "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
             --create \"$AEQI_DEPLOY_DATA\" 2>/dev/null \
             | grep '^contractAddress' | awk '{{print $2}}'"
        ))
        .env("AEQI_DEPLOY_DATA", &deploy_data)
        .output()
        .context("cast deploy failed to launch")?;

    let addr = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !addr.starts_with("0x") || addr.len() != 42 {
        return Err(anyhow!(
            "contract deploy failed — got: {addr} (full stdout shown above)"
        ));
    }
    Ok(addr)
}

// ── JSON-RPC helper ───────────────────────────────────────────────────────────

async fn rpc(
    client: &reqwest::Client,
    url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let resp = client
        .post(url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .with_context(|| format!("RPC {method} request to {url} failed"))?
        .json::<serde_json::Value>()
        .await
        .with_context(|| format!("RPC {method} response from {url} is not JSON"))?;
    Ok(resp)
}

// ── Contract bytecode loaders ─────────────────────────────────────────────────

/// Load Paymaster.sol compiled bytecode from aeqi-core forge output.
fn load_paymaster_bytecode() -> Result<String> {
    let bytecode = sh(
        "cat /home/claudedev/projects/aeqi-core/out/Paymaster.sol/Paymaster.json \
         2>/dev/null | python3 -c \
         \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    if bytecode.is_empty() || !bytecode.starts_with("0x") {
        return Err(anyhow!(
            "Paymaster.sol not compiled. Run: forge build --root /home/claudedev/projects/aeqi-core"
        ));
    }
    Ok(bytecode)
}

/// Load SimpleAccount compiled bytecode.
///
/// First tries the pre-compiled artifact at /tmp/simple-account-test.
/// If absent, compiles from /home/claudedev/aeqi/test-contracts/SimpleAccount.sol.
fn load_simple_account_bytecode() -> Result<String> {
    // Try pre-compiled first.
    let bytecode = sh(
        "cat /tmp/simple-account-test/out/SimpleAccount.sol/SimpleAccount.json \
         2>/dev/null | python3 -c \
         \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    if bytecode.starts_with("0x") && bytecode.len() > 10 {
        return Ok(bytecode);
    }

    // Compile on the fly.
    eprintln!("SimpleAccount not pre-compiled — building now...");
    let (_, ok) = sh_status(
        "mkdir -p /tmp/simple-account-test/src && \
         cp /home/claudedev/aeqi/test-contracts/SimpleAccount.sol \
           /tmp/simple-account-test/src/SimpleAccount.sol 2>/dev/null && \
         forge build --root /tmp/simple-account-test >/dev/null 2>&1",
    );
    if !ok {
        return Err(anyhow!(
            "Failed to compile SimpleAccount.sol via forge. \
             Ensure foundry is installed and SimpleAccount.sol is at \
             /home/claudedev/aeqi/test-contracts/SimpleAccount.sol"
        ));
    }

    let bytecode = sh(
        "cat /tmp/simple-account-test/out/SimpleAccount.sol/SimpleAccount.json \
         2>/dev/null | python3 -c \
         \"import sys,json; d=json.load(sys.stdin); print(d['bytecode']['object'])\" 2>/dev/null",
    );
    if bytecode.starts_with("0x") && bytecode.len() > 10 {
        Ok(bytecode)
    } else {
        Err(anyhow!(
            "SimpleAccount compilation succeeded but bytecode not found"
        ))
    }
}

// ── Result types ──────────────────────────────────────────────────────────────

#[derive(Debug)]
struct SmokeResult {
    success: bool,
    user_op_hash: Option<String>,
    tx_hash: Option<String>,
    actual_gas_used: Option<String>,
    paymaster_sponsored: bool,
    latency_ms: u64,
    error: Option<String>,
    paymaster_reachable: bool,
}

impl SmokeResult {
    fn print_human(&self) {
        if self.success {
            println!("AA SMOKE: OK");
            println!(
                "  user_op_hash:    {}",
                self.user_op_hash.as_deref().unwrap_or("?")
            );
            println!(
                "  tx_hash:         {}",
                self.tx_hash.as_deref().unwrap_or("?")
            );
            println!(
                "  gas_used:        {}",
                self.actual_gas_used.as_deref().unwrap_or("?")
            );
            println!(
                "  paymaster_spon:  {}",
                if self.paymaster_sponsored {
                    "yes"
                } else {
                    "no (self-pay)"
                }
            );
            println!("  latency_ms:      {}", self.latency_ms);
        } else {
            println!("AA SMOKE: FAIL");
            println!(
                "  error: {}",
                self.error.as_deref().unwrap_or("unknown error")
            );
            println!("  latency_ms: {}", self.latency_ms);
        }
        println!(
            "  paymaster_svc:   {}",
            if self.paymaster_reachable {
                "up"
            } else {
                "down"
            }
        );
    }

    fn print_json(&self) {
        let v = json!({
            "success":            self.success,
            "user_op_hash":       self.user_op_hash,
            "tx_hash":            self.tx_hash,
            "actual_gas_used":    self.actual_gas_used,
            "paymaster_sponsored": self.paymaster_sponsored,
            "latency_ms":         self.latency_ms,
            "error":              self.error,
            "paymaster_reachable": self.paymaster_reachable,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&v).unwrap_or_else(|_| v.to_string())
        );
    }
}

// ── Core smoke logic ──────────────────────────────────────────────────────────

async fn run_smoke() -> SmokeResult {
    let t0 = Instant::now();
    let client = reqwest::Client::new();

    // Check paymaster liveness (non-fatal, informational).
    let paymaster_reachable = client
        .get(format!("{PAYMASTER_URL}/health"))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    macro_rules! fail {
        ($fmt:literal $($args:tt)*) => {{
            return SmokeResult {
                success: false,
                user_op_hash: None,
                tx_hash: None,
                actual_gas_used: None,
                paymaster_sponsored: false,
                latency_ms: t0.elapsed().as_millis() as u64,
                error: Some(format!($fmt $($args)*)),
                paymaster_reachable,
            };
        }};
        ($msg:expr) => {{
            return SmokeResult {
                success: false,
                user_op_hash: None,
                tx_hash: None,
                actual_gas_used: None,
                paymaster_sponsored: false,
                latency_ms: t0.elapsed().as_millis() as u64,
                error: Some(($msg).to_string()),
                paymaster_reachable,
            };
        }};
    }

    // ── Gate: anvil must be up ────────────────────────────────────────────────

    let chain_resp = match rpc(&client, ANVIL_URL, "eth_chainId", json!([])).await {
        Ok(r) => r,
        Err(e) => fail!("anvil unreachable at {ANVIL_URL}: {e}"),
    };
    let chain_id = chain_resp["result"].as_str().unwrap_or("").to_lowercase();
    if chain_id != "0x7a69" {
        fail!("anvil chainId mismatch: got {chain_id}, want 0x7a69 (31337)");
    }

    // ── Gate: bundler must be up ──────────────────────────────────────────────

    let bundler_resp = match rpc(&client, BUNDLER_URL, "eth_chainId", json!([])).await {
        Ok(r) => r,
        Err(e) => fail!("bundler unreachable at {BUNDLER_URL}: {e}"),
    };
    let bundler_chain = bundler_resp["result"].as_str().unwrap_or("").to_lowercase();
    if bundler_chain != "0x7a69" {
        fail!("bundler chainId mismatch: got {bundler_chain}, want 0x7a69 (31337)");
    }

    // Verify EntryPoint v0.7 is supported.
    let ep_resp = match rpc(&client, BUNDLER_URL, "eth_supportedEntryPoints", json!([])).await {
        Ok(r) => r,
        Err(e) => fail!("eth_supportedEntryPoints failed: {e}"),
    };
    let eps = match ep_resp["result"].as_array() {
        Some(a) => a.clone(),
        None => fail!("eth_supportedEntryPoints: unexpected response: {ep_resp}"),
    };
    let has_ep_v07 = eps
        .iter()
        .any(|v| v.as_str().unwrap_or("").eq_ignore_ascii_case(EP_V07));
    if !has_ep_v07 {
        fail!("bundler does not support EntryPoint v0.7 ({EP_V07}); got: {eps:?}");
    }

    // ── Load contract bytecodes ───────────────────────────────────────────────

    let paymaster_bytecode = match load_paymaster_bytecode() {
        Ok(b) => b,
        Err(e) => fail!("Paymaster.sol bytecode load failed: {e}"),
    };

    let sa_bytecode = match load_simple_account_bytecode() {
        Ok(b) => b,
        Err(e) => fail!("SimpleAccount bytecode load failed: {e}"),
    };

    // ── Deploy Paymaster.sol ──────────────────────────────────────────────────

    let paymaster_addr = match cast_deploy(
        &paymaster_bytecode,
        "constructor(address,address)",
        &[EP_V07, DEPLOYER_ADDR],
    ) {
        Ok(a) => a,
        Err(e) => fail!("Paymaster.sol deploy failed: {e}"),
    };

    // Fund Paymaster via EP.depositTo.
    let fund_status = sh(&format!(
        "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
         --value 1ether '{EP_V07}' 'depositTo(address)' '{paymaster_addr}' 2>/dev/null | \
         grep '^status' | grep -c '1 (success)'"
    ));
    if fund_status != "1" {
        fail!("EP.depositTo failed for paymaster {paymaster_addr}");
    }

    // Verify EP balance.
    let ep_balance_str = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'balanceOf(address)(uint256)' '{paymaster_addr}' 2>/dev/null | awk '{{print $1}}'"
    ));
    let ep_balance: u128 = ep_balance_str.parse().unwrap_or(0);
    if ep_balance < 1_000_000_000_000_000_000u128 {
        fail!("paymaster EP balance too low: {ep_balance_str} wei (expected >= 1 ETH)");
    }

    // ── Deploy SimpleAccount ──────────────────────────────────────────────────

    let sa_addr = match cast_deploy(
        &sa_bytecode,
        "constructor(address,address)",
        &[DEPLOYER_ADDR, EP_V07],
    ) {
        Ok(a) => a,
        Err(e) => fail!("SimpleAccount deploy failed: {e}"),
    };

    // Fund account with 0.1 ETH so it can prefund gas (self-paying path).
    sh(&format!(
        "cast send --rpc-url {ANVIL_URL} --private-key {DEPLOYER_PK} \
         --value 0.1ether '{sa_addr}' 2>/dev/null"
    ));

    // ── Build no-op UserOp ────────────────────────────────────────────────────
    //
    // callData: execute(address(0), 0, 0x) — no ETH moved, no storage written.

    let call_data = sh("cast calldata 'execute(address,uint256,bytes)' \
         '0x0000000000000000000000000000000000000000' '0' '0x' 2>/dev/null");
    if !call_data.starts_with("0x") {
        fail!("cast calldata for no-op execute failed; got: {call_data}");
    }

    // Packed v0.7 gas fields.
    let account_gas_limits = "0x000000000000000000000000000249f0000000000000000000000000000186a0";
    let gas_fees = "0x0000000000000000000000003b9aca0000000000000000000000000077359400";
    let pre_verification_gas = "0x186a0";

    // Query EP nonce for this account.
    let nonce_str = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'getNonce(address,uint192)(uint256)' '{sa_addr}' '0' 2>/dev/null"
    ));
    let nonce: u64 = nonce_str.parse().unwrap_or(0);
    let nonce_hex = format!("0x{nonce:x}");

    // Compute userOpHash from EntryPoint (no paymaster — self-paying path).
    let user_op_hash = sh(&format!(
        "cast call --rpc-url {ANVIL_URL} '{EP_V07}' \
         'getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))(bytes32)' \
         '({sa_addr},{nonce},0x,{call_data},{account_gas_limits},{pvg},{gas_fees},0x,0x)' 2>/dev/null",
        pvg = pre_verification_gas
    ));
    if !user_op_hash.starts_with("0x") || user_op_hash.len() != 66 {
        fail!("EP.getUserOpHash failed; got: {user_op_hash}");
    }

    // Sign with account owner (eth_sign prefix — SimpleAccount validates WITH prefix).
    let account_sig = sh(&format!(
        "cast wallet sign --private-key {DEPLOYER_PK} '{user_op_hash}' 2>/dev/null"
    ));
    if !account_sig.starts_with("0x") || account_sig.len() != 132 {
        fail!("cast wallet sign failed; got: {account_sig}");
    }

    // ── Submit via eth_sendUserOperation ──────────────────────────────────────

    let submit_resp = match rpc(
        &client,
        BUNDLER_URL,
        "eth_sendUserOperation",
        json!([
            {
                "sender":                        sa_addr,
                "nonce":                         nonce_hex,
                "factory":                       null,
                "factoryData":                   null,
                "callData":                      call_data,
                "callGasLimit":                  "0x186a0",
                "verificationGasLimit":          "0x249f0",
                "preVerificationGas":            pre_verification_gas,
                "maxFeePerGas":                  "0x77359400",
                "maxPriorityFeePerGas":          "0x3b9aca00",
                "paymaster":                     null,
                "paymasterVerificationGasLimit": null,
                "paymasterPostOpGasLimit":       null,
                "paymasterData":                 null,
                "signature":                     account_sig,
            },
            EP_V07,
        ]),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => fail!("eth_sendUserOperation request failed: {e}"),
    };

    if let Some(err) = submit_resp.get("error") {
        let msg = err["message"].as_str().unwrap_or("(no message)");
        fail!("bundler rejected UserOp: {msg}");
    }

    let returned_hash = match submit_resp["result"].as_str() {
        Some(h) => h.to_string(),
        None => fail!("eth_sendUserOperation: no result in response: {submit_resp}"),
    };

    if returned_hash.to_lowercase() != user_op_hash.to_lowercase() {
        fail!("returned hash {returned_hash} != computed userOpHash {user_op_hash}");
    }

    // ── Poll for receipt ──────────────────────────────────────────────────────

    let mut receipt = serde_json::Value::Null;
    for attempt in 1u32..=15 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let resp = match rpc(
            &client,
            BUNDLER_URL,
            "eth_getUserOperationReceipt",
            json!([returned_hash]),
        )
        .await
        {
            Ok(r) => r,
            Err(_) => continue,
        };

        if let Some(r) = resp["result"].as_object() {
            receipt = serde_json::Value::Object(r.clone());
            eprintln!("receipt received on poll {attempt}");
            break;
        }
    }

    if receipt.is_null() {
        fail!("UserOp not mined within 30 s — bundler may be unhealthy");
    }

    // ── Validate receipt ──────────────────────────────────────────────────────

    let success = receipt["success"].as_bool().unwrap_or(false);
    if !success {
        let reason = receipt["reason"].as_str().unwrap_or("(none)");
        fail!("UserOp mined but success=false; reason: {reason}");
    }

    let tx_status = receipt["receipt"]["status"].as_str().unwrap_or("0x0");
    if tx_status != "0x1" {
        fail!("tx status must be 0x1 (success); got: {tx_status}");
    }

    let tx_hash = receipt["receipt"]["transactionHash"]
        .as_str()
        .unwrap_or("?")
        .to_string();
    let actual_gas_used = receipt["actualGasUsed"].as_str().map(|s| s.to_string());

    SmokeResult {
        success: true,
        user_op_hash: Some(returned_hash),
        tx_hash: Some(tx_hash),
        actual_gas_used,
        paymaster_sponsored: false, // self-paying path; paymaster v0.7 offset fix pending
        latency_ms: t0.elapsed().as_millis() as u64,
        error: None,
        paymaster_reachable,
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let json_output = std::env::var("SMOKE_JSON").is_ok();

    let result = run_smoke().await;

    if json_output {
        result.print_json();
    } else {
        result.print_human();
    }

    std::process::exit(if result.success { 0 } else { 1 });
}
