//! aeqi-indexer — Solana indexer for the AEQI protocol.
//!
//! Subscribes to logs of all 11 AEQI programs via `logsSubscribe` (WS) and
//! decodes Anchor events from the `Program data:` lines via a pre-computed
//! discriminator registry. Projects events into an idempotent SQLite sink.
//!
//! Architecture: hits a public Solana RPC (Helius / Triton / Solana
//! Foundation), per `feedback_use_public_solana_rpc.md` — we run the
//! indexer service ourselves but don't run a validator/RPC node.

// Modules live in `lib.rs` (`aeqi_indexer::*`) so auxiliary bins under
// `src/bin/` can call into them. `main.rs` re-imports the same modules
// through the crate's library surface — there's only ever one
// compilation per module.
use aeqi_indexer::{backfill, events, manifest, registry, sink, snapshot};

use anyhow::{Context, Result};
use clap::Parser;
use futures::StreamExt;
use manifest::{Manifest, DEFAULT_CLUSTER};
use solana_client::nonblocking::pubsub_client::PubsubClient;
use solana_client::nonblocking::rpc_client::RpcClient as NonblockingRpcClient;
use solana_client::rpc_config::{RpcTransactionLogsConfig, RpcTransactionLogsFilter};
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

/// Hardcoded aeqi_token program ID — used to derive the canonical
/// cap-table mint PDA `[b"mint", company]` for each ProposalCreated
/// event so the snapshot job knows which mint to query.
const AEQI_TOKEN_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh");

/// Marker for token-mode proposals — `governance_config_id == [0; 32]`
/// (matches `aeqi_governance::TOKEN_VOTING_CONFIG_ID`). Role-mode
/// proposals do NOT need a snapshot job (Phase 1 handles them via the
/// checkpoint slot guard, ae-003).
const TOKEN_VOTING_CONFIG_ID: [u8; 32] = [0u8; 32];

#[derive(Parser, Debug)]
#[command(name = "aeqi-indexer", about = "Solana log indexer for the AEQI protocol")]
struct Args {
    /// WebSocket RPC URL
    #[arg(long, env = "AEQI_INDEXER_WS", default_value = "ws://127.0.0.1:9900")]
    ws_url: String,

    /// Commitment level for live subscription (confirmed | finalized)
    #[arg(long, env = "AEQI_INDEXER_COMMITMENT", default_value = "confirmed")]
    commitment: String,

    /// SQLite database path
    #[arg(long, env = "AEQI_INDEXER_DB", default_value = "./aeqi-indexer.db")]
    db: String,

    /// HTTP RPC URL for backfill (getSignaturesForAddress + getTransaction)
    #[arg(long, env = "AEQI_INDEXER_RPC", default_value = "http://127.0.0.1:9899")]
    rpc_url: String,

    /// Skip the historical backfill on startup (live tail only)
    #[arg(long, env = "AEQI_INDEXER_SKIP_BACKFILL", default_value_t = false)]
    skip_backfill: bool,

    /// Solana cluster name used to resolve the deployment manifest
    /// (`deployments/<cluster>.json`) and to look up Anchor.toml's
    /// `[programs.<cluster>]` table for the consistency check.
    #[arg(long, env = "AEQI_SOLANA_CLUSTER", default_value = DEFAULT_CLUSTER)]
    cluster: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();

    // Load the canonical program manifest before anything else. Fail
    // fast on missing/malformed file or drift against Anchor.toml —
    // the indexer subscribing to the wrong program IDs is the worst
    // kind of silent failure.
    let manifest_path = Manifest::resolve_path(&args.cluster);
    let manifest = Manifest::load(&manifest_path)
        .with_context(|| format!("loading deployment manifest at {}", manifest_path.display()))?;
    if manifest.cluster != args.cluster {
        anyhow::bail!(
            "manifest cluster {:?} at {} does not match --cluster {:?}",
            manifest.cluster,
            manifest_path.display(),
            args.cluster
        );
    }
    registry::assert_matches_manifest(&manifest)?;
    match manifest.assert_matches_anchor_toml(&manifest_path, None) {
        Ok(toml_path) => info!(
            manifest = %manifest_path.display(),
            anchor_toml = %toml_path.display(),
            programs = manifest.programs.len(),
            "manifest validated against Anchor.toml"
        ),
        Err(e) => {
            // Anchor.toml is the secondary source of truth; treat
            // missing-file as a soft-fail (e.g. installs that ship
            // only the binary + manifest), but actual content drift
            // is fatal.
            let chain = format!("{e:#}");
            let missing = chain.contains("failed to read");
            if missing {
                warn!(
                    manifest = %manifest_path.display(),
                    error = %chain,
                    "Anchor.toml unreadable — skipping consistency check"
                );
            } else {
                return Err(e);
            }
        }
    }

    info!(
        cluster = %args.cluster,
        manifest = %manifest_path.display(),
        programs = manifest.programs.len(),
        ws_url = %args.ws_url,
        commitment = %args.commitment,
        db = %args.db,
        events_known = registry::event_count(),
        "starting aeqi-indexer"
    );

    let sink = std::sync::Arc::new(sink::Sink::open(&args.db)?);
    info!(prior_events = sink.event_count()?, "sink opened");

    // Shared RPC client + signer + active-job tracker for the token
    // snapshot pipeline (ae-008). Built lazily so the indexer still
    // boots when AEQI_INDEXER_SIGNER is misconfigured — failing the
    // snapshot job is recoverable per proposal; failing the whole
    // indexer is not.
    let rpc_for_snapshots = Arc::new(NonblockingRpcClient::new_with_commitment(
        args.rpc_url.clone(),
        CommitmentConfig::confirmed(),
    ));
    let snapshot_signer = match snapshot::load_signer() {
        Ok(kp) => {
            info!(
                signer = %kp.pubkey(),
                "snapshot signer loaded — token-vote snapshots enabled"
            );
            Some(kp)
        }
        Err(e) => {
            warn!(
                ?e,
                "snapshot signer not available — token-vote proposals will not get a snapshot job (votes will fail with SnapshotNotCommitted until resolved)"
            );
            None
        }
    };
    let active_snapshot_jobs: Arc<Mutex<HashSet<Pubkey>>> = Arc::new(Mutex::new(HashSet::new()));

    // Historical backfill — replay any events that happened before the
    // indexer started (or while it was offline). Idempotent via the sink's
    // UNIQUE(signature, program, event_type) constraint.
    if !args.skip_backfill {
        let rpc = solana_client::nonblocking::rpc_client::RpcClient::new(args.rpc_url.clone());
        for program in &manifest.programs {
            let pid = Pubkey::from_str(&program.pubkey).with_context(|| {
                format!("manifest pubkey for {} is not valid base58", program.name)
            })?;
            match backfill::backfill_program(&rpc, &pid, &program.name, sink.clone()).await {
                Ok(n) => info!(program = %program.name, inserted = n, "backfill complete"),
                Err(e) => {
                    warn!(?e, program = %program.name, "backfill failed — continuing to live tail")
                }
            }
        }
    } else {
        info!("--skip-backfill set — going straight to live tail");
    }

    let commitment = match args.commitment.as_str() {
        "finalized" => CommitmentConfig::finalized(),
        _ => CommitmentConfig::confirmed(),
    };

    // Leak the client into 'static — the indexer runs for the lifetime of
    // the process so this is fine, and it lets each subscription stream
    // outlive the local function scope (required by tokio::spawn's
    // 'static bound).
    let client: &'static PubsubClient = Box::leak(Box::new(PubsubClient::new(&args.ws_url).await?));
    let mut handles = Vec::new();

    for program in &manifest.programs {
        let pid = Pubkey::from_str(&program.pubkey)
            .with_context(|| format!("manifest pubkey for {} is not valid base58", program.name))?;
        let name = program.name.clone();
        let resume_slot = sink.cursor(&name)?;
        info!(program = %name, program_id = %pid, ?resume_slot, "subscribing");

        let filter = RpcTransactionLogsFilter::Mentions(vec![pid.to_string()]);
        let cfg = RpcTransactionLogsConfig { commitment: Some(commitment) };
        let (mut sub, _unsub) = client.logs_subscribe(filter, cfg).await?;

        let sink_for_task = sink.clone();
        let rpc_for_task = rpc_for_snapshots.clone();
        let signer_for_task = snapshot_signer.clone();
        let active_jobs_for_task = active_snapshot_jobs.clone();
        let handle = tokio::spawn(async move {
            while let Some(resp) = sub.next().await {
                let slot = resp.context.slot;
                if let Some(err) = &resp.value.err {
                    warn!(program = %name, slot, ?err, "tx error — skipping");
                    continue;
                }
                for (log_index, line) in resp.value.logs.iter().enumerate() {
                    if let Some(rest) = line.strip_prefix("Program data: ") {
                        match base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD,
                            rest,
                        ) {
                            Ok(bytes) if bytes.len() >= 8 => {
                                let payload = &bytes[8..];
                                match registry::lookup(&pid, &bytes[..8]) {
                                    Some(meta) => {
                                        let recorded = sink_for_task.record_event(
                                            meta.program,
                                            meta.event,
                                            slot,
                                            &resp.value.signature,
                                            log_index as u32,
                                            rest,
                                        );
                                        match recorded {
                                            Ok(true) => info!(
                                                program = %meta.program,
                                                event = %meta.event,
                                                slot,
                                                sig = %resp.value.signature,
                                                payload_bytes = payload.len(),
                                                "anchor event recorded"
                                            ),
                                            Ok(false) => {
                                                // dedup hit — replay or reorg
                                            }
                                            Err(e) => warn!(?e, "sink.record_event failed"),
                                        }
                                        // Typed projection — best-effort,
                                        // additive. Decoder returns Ok(None)
                                        // when the event is registered but
                                        // not yet mirrored locally; that's
                                        // expected (we mirror one rep per
                                        // family in the first cut). A
                                        // Borsh error means the on-chain
                                        // struct drifted from our mirror —
                                        // surface but don't crash.
                                        match events::decode(meta.program, meta.event, payload) {
                                            Ok(Some(typed)) => {
                                                if let Err(e) = sink_for_task.record_typed(
                                                    &typed,
                                                    slot,
                                                    &resp.value.signature,
                                                    log_index as u32,
                                                ) {
                                                    warn!(?e, "sink.record_typed failed");
                                                }
                                                // ae-008: kick off a token-vote
                                                // snapshot job for newly-created
                                                // token-mode proposals. Role-mode
                                                // proposals are gated by the slot
                                                // checkpoint (ae-003) and need no
                                                // snapshotter.
                                                dispatch_snapshot_if_token_proposal(
                                                    &typed,
                                                    slot,
                                                    &rpc_for_task,
                                                    signer_for_task.as_ref(),
                                                    &active_jobs_for_task,
                                                );
                                            }
                                            Ok(None) => {
                                                tracing::debug!(
                                                    program = %meta.program,
                                                    event = %meta.event,
                                                    "no typed mirror — raw-only"
                                                );
                                            }
                                            Err(e) => warn!(
                                                ?e,
                                                program = %meta.program,
                                                event = %meta.event,
                                                "typed decode failed — schema drift?"
                                            ),
                                        }
                                    }
                                    None => {
                                        warn!(
                                            program = %name,
                                            slot,
                                            sig = %resp.value.signature,
                                            disc = %hex(&bytes[..8]),
                                            "unknown discriminator (event registered after indexer build?)"
                                        );
                                    }
                                }
                            }
                            Ok(_) => {}
                            Err(e) => warn!(?e, "failed to base64-decode Program data"),
                        }
                    }
                }
                if let Err(e) = sink_for_task.bump_cursor(&name, slot) {
                    warn!(?e, "sink.bump_cursor failed");
                }
            }
            warn!(program = %name, "log subscription ended");
        });
        handles.push(handle);
    }

    for h in handles {
        let _ = h.await;
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

/// Spawn a token-vote snapshot job for a freshly-created proposal IF:
///   - the event is `GovernanceEvent::ProposalCreated`
///   - the proposal uses token voting (`governance_config_id == [0; 32]`)
///   - the signer is configured (otherwise we'd just no-op every tx)
///   - no other snapshot job is already running for the same proposal
///
/// The job runs as a detached tokio task — failure is logged and
/// localized, so a single bad proposal can't take down the indexer.
fn dispatch_snapshot_if_token_proposal(
    typed: &events::TypedEvent,
    decoded_slot: u64,
    rpc: &Arc<NonblockingRpcClient>,
    signer: Option<&Arc<solana_sdk::signature::Keypair>>,
    active_jobs: &Arc<Mutex<HashSet<Pubkey>>>,
) {
    let events::TypedEvent::Governance(events::GovernanceEvent::ProposalCreated(p)) = typed else {
        return;
    };
    if p.governance_config_id != TOKEN_VOTING_CONFIG_ID {
        // Role-mode proposal; ae-003 handles it via the slot
        // checkpoint guard. No snapshot job needed.
        return;
    }
    let Some(signer) = signer else {
        warn!(
            company = %snapshot::pubkey_b58(&p.company),
            proposal_id = %snapshot::pubkey_b58(&p.proposal_id),
            "token-mode proposal observed but snapshot signer unavailable — skipping"
        );
        return;
    };

    let company = Pubkey::new_from_array(p.company);
    let proposal = derive_proposal_pda(&company, &p.proposal_id);
    let mint = derive_canonical_mint_pda(&company);

    let rpc = rpc.clone();
    let signer = signer.clone();
    let active_jobs = active_jobs.clone();

    tokio::spawn(async move {
        // Dedup: if a job for this proposal is already in flight,
        // skip. Bounded by the live tail (one event => at most one
        // dispatch), so contention is minimal.
        {
            let mut jobs = active_jobs.lock().await;
            if !jobs.insert(proposal) {
                info!(
                    %proposal,
                    "snapshot job already in flight — skipping duplicate dispatch"
                );
                return;
            }
        }

        let job = snapshot::SnapshotJob {
            proposal,
            // The snapshot_slot the proposal locked in is at-or-before
            // the slot at which we decoded the event. Use decoded_slot
            // as a safe lower bound for "wait past finalization".
            // commit_snapshot_root will still validate that the actual
            // proposal.snapshot_slot is in the past on-chain, so an
            // optimistic over-estimate here is fine.
            snapshot_slot: decoded_slot,
            mint,
            signer,
            rpc,
        };
        match job.run().await {
            Ok(Some(sig)) => info!(%proposal, %sig, "snapshot job completed"),
            Ok(None) => debug!(%proposal, "snapshot job no-op (already committed)"),
            Err(e) => warn!(?e, %proposal, "snapshot job failed"),
        }
        active_jobs.lock().await.remove(&proposal);
    });
}

fn derive_proposal_pda(company: &Pubkey, proposal_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(
        &[b"proposal", company.as_ref(), proposal_id.as_ref()],
        &Pubkey::from_str("5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq").unwrap(),
    )
    .0
}

fn derive_canonical_mint_pda(company: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"mint", company.as_ref()], &AEQI_TOKEN_PROGRAM_ID).0
}
