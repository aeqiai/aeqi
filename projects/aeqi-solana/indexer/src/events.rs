//! Typed Anchor event decoders.
//!
//! Anchor encodes `emit!(MyEvent { .. })` as
//! `Program data: base64(disc || borsh(MyEvent))` where `disc =
//! sha256("event:" + EventName)[..8]`.
//!
//! `registry.rs` already maps `(program, disc) -> (program, event_name)` so the
//! sink can label rows. This module goes one step further: it Borsh-decodes the
//! payload into a strongly-typed Rust struct mirroring the on-chain
//! `#[event]` definition, projects it into a family-level `TypedEvent`, and
//! lets the sink land the structured fields in family tables alongside the
//! raw payload.
//!
//! We deliberately mirror the structs locally (with `borsh::BorshDeserialize`)
//! instead of pulling the program crates in as path dependencies — the indexer
//! is a standalone workspace specifically to avoid `solana-client` 3.x ↔
//! `anchor-lang` 0.31 `solana-program` 2.x resolver fights (see the comment at
//! the top of `Cargo.toml`). Borsh wire format is `repr(C)`-ish field order;
//! Anchor's `Pubkey` serializes as 32 raw bytes, which is exactly what
//! `[u8; 32]` does. Adding new families/events is a 3-step recipe documented
//! in [`Family`].
//!
//! Scope (first cut, per quest 67-162.7): one representative event per family
//! (TRUST / module / ACL / governance / capital / feed). Unknown
//! discriminators fall through unchanged — the raw `events` table still gets
//! them, and `lookup` in `registry.rs` still surfaces the typed name.

use anyhow::Result;
use borsh::{BorshDeserialize, BorshSerialize};

/// Family bucket each typed event lands in — drives sink table routing and
/// the Graph-era projection model from the brief (TRUST / module / ACL /
/// governance / capital / feed). Field names are intentionally generic
/// because multiple programs contribute to the same family table:
/// `capital_events`, for example, captures both treasury withdraws and fund
/// deposits as different `kind` discriminators on the same row shape.
///
/// To add a new event:
///   1. Mirror the on-chain `#[event]` struct below with
///      `#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]`.
///   2. Add a variant + match arm in [`decode`].
///   3. Add a `record_typed_*` SQL path in `sink.rs` if it's a new family;
///      if it's a new event within an existing family, just project into the
///      same table.
#[derive(Debug, Clone)]
pub enum TypedEvent {
    Trust(TrustEvent),
    Module(ModuleEvent),
    Acl(AclEvent),
    Governance(GovernanceEvent),
    Capital(CapitalEvent),
    Feed(FeedEvent),
    Curve(CurveEvent),
}

// ---------------------------------------------------------------------------
// TRUST family — TRUST lifecycle (creation, finalize, pause)
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct TrustInitialized {
    pub trust: [u8; 32],
    pub trust_id: [u8; 32],
    pub authority: [u8; 32],
}

#[derive(Debug, Clone)]
pub enum TrustEvent {
    Initialized(TrustInitialized),
}

// ---------------------------------------------------------------------------
// MODULE family — module install / version adoption
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct ModuleRegistered {
    pub trust: [u8; 32],
    pub module_id: [u8; 32],
    pub program_id: [u8; 32],
    pub provider: [u8; 32],
    pub implementation_version: u64,
    pub implementation_metadata_hash: [u8; 32],
    pub trust_acl: u64,
}

#[derive(Debug, Clone)]
pub enum ModuleEvent {
    Registered(ModuleRegistered),
}

// ---------------------------------------------------------------------------
// ACL family — module-to-module access control changes
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct ModuleAclSet {
    pub trust: [u8; 32],
    pub source_module_id: [u8; 32],
    pub target_module_id: [u8; 32],
    pub flags: u64,
}

#[derive(Debug, Clone)]
pub enum AclEvent {
    Set(ModuleAclSet),
}

// ---------------------------------------------------------------------------
// GOVERNANCE family — proposal lifecycle
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct ProposalCreated {
    pub trust: [u8; 32],
    pub proposal_id: [u8; 32],
    pub governance_config_id: [u8; 32],
    pub proposer: [u8; 32],
    pub vote_start: i64,
    pub vote_duration: i64,
}

#[derive(Debug, Clone)]
pub enum GovernanceEvent {
    ProposalCreated(ProposalCreated),
}

// ---------------------------------------------------------------------------
// CAPITAL family — treasury / fund flows
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct TreasuryDeposited {
    pub trust: [u8; 32],
    pub depositor_ta: [u8; 32],
    pub amount: u64,
}

#[derive(Debug, Clone)]
pub enum CapitalEvent {
    /// kind: "deposit" — treasury inbound flow.
    Deposit(TreasuryDeposited),
}

// ---------------------------------------------------------------------------
// FEED family — oracle / NAV updates (price-style feeds)
// ---------------------------------------------------------------------------
//
// The current AEQI programs don't emit a dedicated `Pyth` / oracle update
// event, but `aeqi_fund::NavUpdated` is the canonical price-style feed: a
// trusted manager publishes a new gross NAV that downstream consumers price
// against. Modeling it under the feed family lets us add Pyth-backed events
// later without re-shaping the table.

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct NavUpdated {
    pub trust: [u8; 32],
    pub fund_id: [u8; 32],
    pub gross_nav: u64,
    pub high_water_mark: u64,
    pub accrued_carry: u64,
}

#[derive(Debug, Clone)]
pub enum FeedEvent {
    NavUpdated(NavUpdated),
}

// ---------------------------------------------------------------------------
// CURVE family — bonding-curve lifecycle + trades (ja-017)
// ---------------------------------------------------------------------------
//
// Genesis bonding curves are aeqi_unifutures's primary primitive. CurveCreated
// is the one-shot lifecycle event; CurveBuy / CurveSell are the trade stream.
// We split the family into TWO sink tables: `curves` (one row per
// (trust, curve_id), natural-keyed) and `curve_trades` (one row per trade,
// uniqued on (signature, log_index)). The single TypedEvent::Curve variant
// carries either shape; sink.rs::record_typed routes by the inner enum
// discriminant.

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct CurveCreated {
    pub trust: [u8; 32],
    pub curve_id: [u8; 32],
    pub creator: [u8; 32],
    pub asset_mint: [u8; 32],
    pub quote_mint: [u8; 32],
    pub curve_type: u8,
    pub start_price: u128,
    pub end_price: u128,
    pub max_supply: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct CurveBuy {
    pub trust: [u8; 32],
    pub curve_id: [u8; 32],
    pub buyer: [u8; 32],
    pub token_amount: u64,
    pub cost: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone)]
pub struct CurveSell {
    pub trust: [u8; 32],
    pub curve_id: [u8; 32],
    pub seller: [u8; 32],
    pub token_amount: u64,
    pub return_amount: u64,
}

#[derive(Debug, Clone)]
pub enum CurveEvent {
    Created(CurveCreated),
    Buy(CurveBuy),
    Sell(CurveSell),
}

// ---------------------------------------------------------------------------
// Decoder dispatch
// ---------------------------------------------------------------------------

/// Decode the Borsh payload (post-discriminator) into a typed event, given
/// the registry-resolved `(program, event)` pair.
///
/// Returns `Ok(None)` when the event is known to the registry but doesn't
/// have a typed mirror yet — this is expected (we only mirror one
/// representative per family in the first cut) and is a "raw-only" signal
/// for the caller. Returns `Err(_)` only on a schema mismatch (Borsh decode
/// failure), which IS a real problem worth surfacing.
pub fn decode(program: &str, event: &str, payload: &[u8]) -> Result<Option<TypedEvent>> {
    let typed = match (program, event) {
        ("aeqi_trust", "TrustInitialized") => Some(TypedEvent::Trust(TrustEvent::Initialized(
            TrustInitialized::try_from_slice(payload)?,
        ))),
        ("aeqi_trust", "ModuleRegistered") => Some(TypedEvent::Module(ModuleEvent::Registered(
            ModuleRegistered::try_from_slice(payload)?,
        ))),
        ("aeqi_trust", "ModuleAclSet") => {
            Some(TypedEvent::Acl(AclEvent::Set(ModuleAclSet::try_from_slice(payload)?)))
        }
        ("aeqi_governance", "ProposalCreated") => Some(TypedEvent::Governance(
            GovernanceEvent::ProposalCreated(ProposalCreated::try_from_slice(payload)?),
        )),
        ("aeqi_treasury", "TreasuryDeposited") => Some(TypedEvent::Capital(CapitalEvent::Deposit(
            TreasuryDeposited::try_from_slice(payload)?,
        ))),
        ("aeqi_fund", "NavUpdated") => {
            Some(TypedEvent::Feed(FeedEvent::NavUpdated(NavUpdated::try_from_slice(payload)?)))
        }
        ("aeqi_unifutures", "CurveCreated") => {
            Some(TypedEvent::Curve(CurveEvent::Created(CurveCreated::try_from_slice(payload)?)))
        }
        ("aeqi_unifutures", "CurveBuy") => {
            Some(TypedEvent::Curve(CurveEvent::Buy(CurveBuy::try_from_slice(payload)?)))
        }
        ("aeqi_unifutures", "CurveSell") => {
            Some(TypedEvent::Curve(CurveEvent::Sell(CurveSell::try_from_slice(payload)?)))
        }
        _ => None,
    };
    Ok(typed)
}

/// Family discriminator for the `kind` column on multi-event family tables
/// (e.g. `capital_events.kind = "deposit"`).
pub fn family_kind(event: &TypedEvent) -> &'static str {
    match event {
        TypedEvent::Trust(TrustEvent::Initialized(_)) => "initialized",
        TypedEvent::Module(ModuleEvent::Registered(_)) => "registered",
        TypedEvent::Acl(AclEvent::Set(_)) => "set",
        TypedEvent::Governance(GovernanceEvent::ProposalCreated(_)) => "created",
        TypedEvent::Capital(CapitalEvent::Deposit(_)) => "deposit",
        TypedEvent::Feed(FeedEvent::NavUpdated(_)) => "nav_updated",
        TypedEvent::Curve(CurveEvent::Created(_)) => "created",
        TypedEvent::Curve(CurveEvent::Buy(_)) => "buy",
        TypedEvent::Curve(CurveEvent::Sell(_)) => "sell",
    }
}

/// Base58-encode a 32-byte Solana account address. Lifted into a helper so
/// the sink can keep its INSERT statements column-aligned and so the same
/// encoding (lowercase `bs58` standard) is used everywhere typed-projected
/// pubkeys land in SQL.
pub fn b58(addr: &[u8; 32]) -> String {
    bs58::encode(addr).into_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::anchor_event_disc;
    use borsh::BorshSerialize;

    /// Round-trip helper: take a typed struct, serialize it via Borsh with
    /// the matching Anchor discriminator prefix, base64-wrap it (the wire
    /// shape `Program data` carries), then strip the discriminator and
    /// decode it back. Mirrors what the indexer does on every log line.
    fn wire_payload<T: BorshSerialize>(event_name: &str, value: &T) -> Vec<u8> {
        let disc = anchor_event_disc(event_name);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&disc);
        value.serialize(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn decode_trust_initialized_round_trip() {
        let original =
            TrustInitialized { trust: [1u8; 32], trust_id: [2u8; 32], authority: [3u8; 32] };
        let bytes = wire_payload("TrustInitialized", &original);
        let typed = decode("aeqi_trust", "TrustInitialized", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Trust(TrustEvent::Initialized(decoded)) => {
                assert_eq!(decoded.trust, original.trust);
                assert_eq!(decoded.trust_id, original.trust_id);
                assert_eq!(decoded.authority, original.authority);
            }
            other => panic!("expected TrustInitialized, got {other:?}"),
        }
    }

    #[test]
    fn decode_module_registered_round_trip() {
        let original = ModuleRegistered {
            trust: [10u8; 32],
            module_id: [11u8; 32],
            program_id: [12u8; 32],
            provider: [13u8; 32],
            implementation_version: 7,
            implementation_metadata_hash: [14u8; 32],
            trust_acl: 0xdead_beef_cafe_babe,
        };
        let bytes = wire_payload("ModuleRegistered", &original);
        let typed = decode("aeqi_trust", "ModuleRegistered", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Module(ModuleEvent::Registered(decoded)) => {
                assert_eq!(decoded.implementation_version, 7);
                assert_eq!(decoded.trust_acl, 0xdead_beef_cafe_babe);
                assert_eq!(decoded.module_id, original.module_id);
            }
            other => panic!("expected ModuleRegistered, got {other:?}"),
        }
    }

    #[test]
    fn decode_module_acl_set_round_trip() {
        let original = ModuleAclSet {
            trust: [20u8; 32],
            source_module_id: [21u8; 32],
            target_module_id: [22u8; 32],
            flags: 0b1011,
        };
        let bytes = wire_payload("ModuleAclSet", &original);
        let typed = decode("aeqi_trust", "ModuleAclSet", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Acl(AclEvent::Set(decoded)) => {
                assert_eq!(decoded.flags, 0b1011);
                assert_eq!(decoded.source_module_id, original.source_module_id);
            }
            other => panic!("expected ModuleAclSet, got {other:?}"),
        }
    }

    #[test]
    fn decode_proposal_created_round_trip() {
        let original = ProposalCreated {
            trust: [30u8; 32],
            proposal_id: [31u8; 32],
            governance_config_id: [32u8; 32],
            proposer: [33u8; 32],
            vote_start: 1_700_000_000,
            vote_duration: 86_400,
        };
        let bytes = wire_payload("ProposalCreated", &original);
        let typed = decode("aeqi_governance", "ProposalCreated", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Governance(GovernanceEvent::ProposalCreated(decoded)) => {
                assert_eq!(decoded.vote_start, 1_700_000_000);
                assert_eq!(decoded.vote_duration, 86_400);
            }
            other => panic!("expected ProposalCreated, got {other:?}"),
        }
    }

    #[test]
    fn decode_treasury_deposited_round_trip() {
        let original =
            TreasuryDeposited { trust: [40u8; 32], depositor_ta: [41u8; 32], amount: 1_000_000 };
        let bytes = wire_payload("TreasuryDeposited", &original);
        let typed = decode("aeqi_treasury", "TreasuryDeposited", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Capital(CapitalEvent::Deposit(decoded)) => {
                assert_eq!(decoded.amount, 1_000_000);
            }
            other => panic!("expected TreasuryDeposited, got {other:?}"),
        }
    }

    #[test]
    fn decode_nav_updated_round_trip() {
        let original = NavUpdated {
            trust: [50u8; 32],
            fund_id: [51u8; 32],
            gross_nav: 9_999,
            high_water_mark: 10_500,
            accrued_carry: 42,
        };
        let bytes = wire_payload("NavUpdated", &original);
        let typed = decode("aeqi_fund", "NavUpdated", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Feed(FeedEvent::NavUpdated(decoded)) => {
                assert_eq!(decoded.gross_nav, 9_999);
                assert_eq!(decoded.high_water_mark, 10_500);
                assert_eq!(decoded.accrued_carry, 42);
            }
            other => panic!("expected NavUpdated, got {other:?}"),
        }
    }

    #[test]
    fn decode_curve_created_round_trip() {
        let original = CurveCreated {
            trust: [60u8; 32],
            curve_id: [61u8; 32],
            creator: [62u8; 32],
            asset_mint: [63u8; 32],
            quote_mint: [64u8; 32],
            curve_type: 0,
            start_price: 1_000_000_000_000_000_000u128,
            end_price: 10_000_000_000_000_000_000u128,
            max_supply: 1_000_000_000_000u64,
        };
        let bytes = wire_payload("CurveCreated", &original);
        let typed = decode("aeqi_unifutures", "CurveCreated", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Curve(CurveEvent::Created(decoded)) => {
                assert_eq!(decoded.curve_type, 0);
                assert_eq!(decoded.start_price, original.start_price);
                assert_eq!(decoded.end_price, original.end_price);
                assert_eq!(decoded.max_supply, original.max_supply);
                assert_eq!(decoded.curve_id, original.curve_id);
                assert_eq!(decoded.asset_mint, original.asset_mint);
            }
            other => panic!("expected CurveCreated, got {other:?}"),
        }
    }

    #[test]
    fn decode_curve_buy_round_trip() {
        let original = CurveBuy {
            trust: [70u8; 32],
            curve_id: [71u8; 32],
            buyer: [72u8; 32],
            token_amount: 1_000_000,
            cost: 1_200_000,
        };
        let bytes = wire_payload("CurveBuy", &original);
        let typed = decode("aeqi_unifutures", "CurveBuy", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Curve(CurveEvent::Buy(decoded)) => {
                assert_eq!(decoded.token_amount, 1_000_000);
                assert_eq!(decoded.cost, 1_200_000);
                assert_eq!(decoded.buyer, original.buyer);
            }
            other => panic!("expected CurveBuy, got {other:?}"),
        }
    }

    #[test]
    fn decode_curve_sell_round_trip() {
        let original = CurveSell {
            trust: [80u8; 32],
            curve_id: [81u8; 32],
            seller: [82u8; 32],
            token_amount: 500_000,
            return_amount: 480_000,
        };
        let bytes = wire_payload("CurveSell", &original);
        let typed = decode("aeqi_unifutures", "CurveSell", &bytes[8..]).unwrap().unwrap();
        match typed {
            TypedEvent::Curve(CurveEvent::Sell(decoded)) => {
                assert_eq!(decoded.token_amount, 500_000);
                assert_eq!(decoded.return_amount, 480_000);
                assert_eq!(decoded.seller, original.seller);
            }
            other => panic!("expected CurveSell, got {other:?}"),
        }
    }

    #[test]
    fn unknown_event_returns_none_not_err() {
        // Vesting events aren't mirrored yet — registry knows them but
        // decoder should pass them through as raw-only.
        let result = decode("aeqi_vesting", "PositionCreated", &[0u8; 16]).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn schema_mismatch_returns_err() {
        // Short payload that cannot satisfy TrustInitialized (3×32 bytes).
        let err = decode("aeqi_trust", "TrustInitialized", &[0u8; 4]).unwrap_err();
        assert!(format!("{err}").to_lowercase().contains("unexpected"));
    }

    #[test]
    fn family_kind_covers_all_variants() {
        // Cheap exhaustiveness check — if a variant is added without a
        // family_kind arm, this won't catch it (the match in family_kind
        // will), but it ensures each kind label is non-empty and stable.
        for kind in [
            family_kind(&TypedEvent::Trust(TrustEvent::Initialized(TrustInitialized {
                trust: [0; 32],
                trust_id: [0; 32],
                authority: [0; 32],
            }))),
            family_kind(&TypedEvent::Module(ModuleEvent::Registered(ModuleRegistered {
                trust: [0; 32],
                module_id: [0; 32],
                program_id: [0; 32],
                provider: [0; 32],
                implementation_version: 0,
                implementation_metadata_hash: [0; 32],
                trust_acl: 0,
            }))),
            family_kind(&TypedEvent::Acl(AclEvent::Set(ModuleAclSet {
                trust: [0; 32],
                source_module_id: [0; 32],
                target_module_id: [0; 32],
                flags: 0,
            }))),
            family_kind(&TypedEvent::Governance(GovernanceEvent::ProposalCreated(
                ProposalCreated {
                    trust: [0; 32],
                    proposal_id: [0; 32],
                    governance_config_id: [0; 32],
                    proposer: [0; 32],
                    vote_start: 0,
                    vote_duration: 0,
                },
            ))),
            family_kind(&TypedEvent::Capital(CapitalEvent::Deposit(TreasuryDeposited {
                trust: [0; 32],
                depositor_ta: [0; 32],
                amount: 0,
            }))),
            family_kind(&TypedEvent::Feed(FeedEvent::NavUpdated(NavUpdated {
                trust: [0; 32],
                fund_id: [0; 32],
                gross_nav: 0,
                high_water_mark: 0,
                accrued_carry: 0,
            }))),
            family_kind(&TypedEvent::Curve(CurveEvent::Created(CurveCreated {
                trust: [0; 32],
                curve_id: [0; 32],
                creator: [0; 32],
                asset_mint: [0; 32],
                quote_mint: [0; 32],
                curve_type: 0,
                start_price: 0,
                end_price: 0,
                max_supply: 0,
            }))),
            family_kind(&TypedEvent::Curve(CurveEvent::Buy(CurveBuy {
                trust: [0; 32],
                curve_id: [0; 32],
                buyer: [0; 32],
                token_amount: 0,
                cost: 0,
            }))),
            family_kind(&TypedEvent::Curve(CurveEvent::Sell(CurveSell {
                trust: [0; 32],
                curve_id: [0; 32],
                seller: [0; 32],
                token_amount: 0,
                return_amount: 0,
            }))),
        ] {
            assert!(!kind.is_empty());
        }
    }

    #[test]
    fn b58_round_trips_to_expected_length() {
        let addr = [1u8; 32];
        let encoded = b58(&addr);
        // Standard 32-byte base58 encoding length is 43–44 chars.
        assert!(encoded.len() >= 43 && encoded.len() <= 44, "unexpected len: {}", encoded.len());
    }
}
