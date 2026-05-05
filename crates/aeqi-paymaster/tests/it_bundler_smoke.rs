//! Bundler integration smoke tests.
//!
//! These tests connect to the live aeqi-bundler (rundler) at 127.0.0.1:3000
//! and verify that the bundler is reachable and returns sane JSON-RPC responses.
//!
//! Run only when the bundler service is up:
//!   systemctl status aeqi-bundler   # must be active
//!
//! Skipped automatically if BUNDLER_URL is not set and the default endpoint
//! does not respond (so CI without the service still passes).
//!
//! To run manually:
//!   cargo test -p aeqi-paymaster --test it_bundler_smoke -- --nocapture

const BUNDLER_URL: &str = "http://127.0.0.1:3000";
const EP_V07: &str = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const CHAIN_ID_ANVIL: &str = "0x7a69"; // 31337

/// Perform a raw JSON-RPC call and return the parsed response body.
async fn rpc(client: &reqwest::Client, method: &str, params: serde_json::Value) -> serde_json::Value {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    });

    let resp = client
        .post(BUNDLER_URL)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .expect("bundler RPC request failed");

    resp.json::<serde_json::Value>()
        .await
        .expect("bundler response is not valid JSON")
}

/// Returns true if the bundler is reachable at BUNDLER_URL.
async fn bundler_is_up(client: &reqwest::Client) -> bool {
    client
        .post(BUNDLER_URL)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_chainId",
            "params": [],
            "id": 0,
        }))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Assert v0.7 EntryPoint is in the supported list.
#[tokio::test]
async fn test_eth_supported_entry_points_includes_v07() {
    let client = reqwest::Client::new();
    if !bundler_is_up(&client).await {
        eprintln!("SKIP: bundler not reachable at {BUNDLER_URL}");
        return;
    }

    let resp = rpc(&client, "eth_supportedEntryPoints", serde_json::json!([])).await;
    let eps = resp["result"].as_array().expect("result must be an array");

    assert!(
        eps.iter()
            .any(|v| v.as_str().unwrap_or("").eq_ignore_ascii_case(EP_V07)),
        "EntryPoint v0.7 ({EP_V07}) not in eth_supportedEntryPoints: {eps:?}"
    );
}

/// Assert bundler reports chain ID 31337 (matches dev anvil).
#[tokio::test]
async fn test_eth_chain_id_matches_anvil() {
    let client = reqwest::Client::new();
    if !bundler_is_up(&client).await {
        eprintln!("SKIP: bundler not reachable at {BUNDLER_URL}");
        return;
    }

    let resp = rpc(&client, "eth_chainId", serde_json::json!([])).await;
    let chain_id = resp["result"].as_str().expect("chainId must be a string");

    assert_eq!(
        chain_id.to_lowercase(),
        CHAIN_ID_ANVIL,
        "bundler chainId mismatch: got {chain_id}, want {CHAIN_ID_ANVIL}"
    );
}

/// A dummy UserOp against a non-existent sender account should return
/// a validation error (AA20), not an RPC transport error or panic.
/// This confirms the bundler is processing requests end-to-end.
#[tokio::test]
async fn test_estimate_user_operation_gas_returns_aa20_for_undeployed_account() {
    let client = reqwest::Client::new();
    if !bundler_is_up(&client).await {
        eprintln!("SKIP: bundler not reachable at {BUNDLER_URL}");
        return;
    }

    // Minimal v0.7 UserOperation — sender has no deployed account, callData = nop.
    let dummy_uo = serde_json::json!({
        "sender":                  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "nonce":                   "0x0",
        "callData":                "0x",
        "callGasLimit":            "0x0",
        "verificationGasLimit":    "0x0",
        "preVerificationGas":      "0x0",
        "maxFeePerGas":            "0x0",
        "maxPriorityFeePerGas":    "0x0",
        "signature":               "0x",
    });

    let resp = rpc(
        &client,
        "eth_estimateUserOperationGas",
        serde_json::json!([dummy_uo, EP_V07]),
    )
    .await;

    // Must have an error (not a result) and the error message must mention AA20.
    assert!(
        resp.get("error").is_some(),
        "expected an error response for undeployed account, got: {resp}"
    );

    let msg = resp["error"]["message"].as_str().unwrap_or("");
    assert!(
        msg.contains("AA20"),
        "expected AA20 error for undeployed account, got: {msg}"
    );
}
