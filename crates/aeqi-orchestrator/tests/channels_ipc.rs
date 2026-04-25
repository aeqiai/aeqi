//! T1.9.1 — Move B.4 + supporting cases for the channels IPC handler.
//!
//! Verifies that the IPC create path siphons token-shaped fields out of
//! the inbound payload, writes them to the credentials substrate, and
//! saves the channel row with no token in its config blob.

use std::sync::{Arc, Mutex as StdMutex};

use aeqi_core::credentials::{CredentialCipher, CredentialKey, CredentialStore, ScopeKind};
use aeqi_orchestrator::ipc::channels::handle_channels_upsert;
use aeqi_test_support::TestHarness;
use rusqlite::Connection;

fn fresh_store() -> Arc<CredentialStore> {
    let conn = Connection::open_in_memory().unwrap();
    CredentialStore::initialize_schema(&conn).unwrap();
    let cipher = CredentialCipher::ephemeral();
    Arc::new(CredentialStore::new(Arc::new(StdMutex::new(conn)), cipher))
}

#[tokio::test]
async fn ipc_create_telegram_writes_token_to_substrate_strips_from_config() {
    let creds = fresh_store();
    let h = TestHarness::build()
        .await
        .unwrap()
        .with_credentials(creds.clone());
    let ctx = h.ctx();
    // The harness builds `aeqi.db` lazily; we need an agent_id for the
    // `agent_id required` check + the `(agent_id, kind)` unique index.
    let agent = ctx
        .agent_registry
        .spawn("agent-a", None, None)
        .await
        .unwrap();
    let req = serde_json::json!({
        "agent_id": agent.id,
        "config": {
            "kind": "telegram",
            "token": "ABC123"
        }
    });
    // No tenancy filter for this smoke test.
    let resp = handle_channels_upsert(&ctx, &req, &None).await;
    assert_eq!(
        resp.get("ok"),
        Some(&serde_json::Value::Bool(true)),
        "response should be ok=true; got {resp}"
    );
    let channel_id = resp
        .get("channel")
        .and_then(|c| c.get("id"))
        .and_then(|v| v.as_str())
        .expect("response carries channel id")
        .to_string();

    // Credential row materialized with the token.
    let row = creds
        .find(&CredentialKey {
            scope_kind: ScopeKind::Channel,
            scope_id: channel_id.clone(),
            provider: "telegram".into(),
            name: "token".into(),
        })
        .await
        .unwrap()
        .expect("token credential row exists");
    let plain = creds.decrypt(&row).unwrap();
    assert_eq!(plain, b"ABC123");

    // The channel row exists and its config carries no `token` field.
    // We round-trip via the public API: pull it back via channels_list.
    let listing = aeqi_orchestrator::ipc::channels::handle_channels_list(
        &ctx,
        &serde_json::json!({"agent_id": agent.id}),
        &None,
    )
    .await;
    let channels = listing
        .get("channels")
        .and_then(|c| c.as_array())
        .expect("channels array");
    assert_eq!(channels.len(), 1);
    let cfg_value = channels[0].get("config").unwrap();
    // No `token` key on the deserialized config.
    if let Some(obj) = cfg_value.as_object() {
        assert!(
            obj.get("token").is_none(),
            "channel.config must not carry token after IPC create: {obj:?}"
        );
    }
}

#[tokio::test]
async fn ipc_create_without_substrate_handle_rolls_back() {
    let h = TestHarness::build().await.unwrap();
    // No credentials handle on this harness.
    let ctx = h.ctx();
    let agent = ctx
        .agent_registry
        .spawn("agent-b", None, None)
        .await
        .unwrap();
    let req = serde_json::json!({
        "agent_id": agent.id,
        "config": {"kind": "telegram", "token": "WILL-FAIL"}
    });
    let resp = handle_channels_upsert(&ctx, &req, &None).await;
    assert_eq!(
        resp.get("ok"),
        Some(&serde_json::Value::Bool(false)),
        "without substrate handle, IPC create must fail loudly: {resp}"
    );
    let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        err.contains("credentials substrate"),
        "error must mention substrate, got: {err}"
    );

    // Verify the channel row was rolled back — listing returns empty.
    let listing = aeqi_orchestrator::ipc::channels::handle_channels_list(
        &ctx,
        &serde_json::json!({"agent_id": agent.id}),
        &None,
    )
    .await;
    let channels = listing.get("channels").and_then(|c| c.as_array()).unwrap();
    assert!(
        channels.is_empty(),
        "rollback must leave no channel row behind"
    );
}
