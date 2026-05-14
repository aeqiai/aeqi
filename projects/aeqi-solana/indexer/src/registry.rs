//! Anchor event discriminator → typed event name registry.
//!
//! Anchor encodes events as `Program data: base64(disc || borsh)` where
//! `disc = sha256("event:" + EventName)[..8]`. We pre-compute the
//! discriminators for every event our 11 programs emit so the live tail can
//! print typed names (and the DB sink can route to typed columns).

use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::str::FromStr;

pub fn anchor_event_disc(name: &str) -> [u8; 8] {
    let preimage = format!("event:{}", name);
    let hash = Sha256::digest(preimage.as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash[..8]);
    out
}

#[derive(Debug, Clone, Copy)]
pub struct EventMeta {
    pub program: &'static str,
    pub event: &'static str,
}

const EVENTS: &[(&str, &str, &[&str])] = &[
    (
        "aeqi_trust",
        "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV",
        &[
            "TrustInitialized",
            "TrustFinalized",
            "TrustPauseChanged",
            "ModuleRegistered",
            "ModuleAclSet",
        ],
    ),
    (
        "aeqi_factory",
        "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv",
        &["CompanyCreated", "CompanySpawned", "TemplateRegistered", "TemplateInstantiated"],
    ),
    (
        "aeqi_role",
        "4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB",
        &[
            "RoleTypeCreated",
            "RoleCreated",
            "RoleAssigned",
            "RoleTransferred",
            "RoleResigned",
            "RoleDelegated",
        ],
    ),
    (
        "aeqi_governance",
        "5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq",
        &["ConfigRegistered", "ProposalCreated", "VoteCast", "ProposalExecuted"],
    ),
    (
        "aeqi_token",
        "AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh",
        &["TokenModuleInitialized", "MintCreated", "TokensMinted", "TokensBurned"],
    ),
    (
        "aeqi_treasury",
        "2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7",
        &["TreasuryWithdrew", "TreasuryDeposited"],
    ),
    (
        "aeqi_vesting",
        "DCZKRmxjUyAZ3nptbkCBnAGqTe4E7xTvXfLbnf95uj7y",
        &["PositionCreated", "Claimed"],
    ),
    (
        "aeqi_budget",
        "5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G",
        &["BudgetCreated", "BudgetSpent", "BudgetFrozen", "BudgetUnfrozen"],
    ),
    (
        "aeqi_fund",
        "DaFpZcqMaL4rmAemJ2WBeUth42PMmHxNg9t6j9h9p7YP",
        &["FundCreated", "FundDeposited", "FundRedeemed", "NavUpdated", "CarryClaimed"],
    ),
    (
        "aeqi_funding",
        "8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U",
        &[
            "FundingRequestCreated",
            "FundingRequestCancelled",
            "FundingRequestActivated",
            "FundingRequestFinalized",
        ],
    ),
    (
        "aeqi_unifutures",
        "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF",
        &[
            "CurveCreated",
            "CurveBuy",
            "CurveSell",
            "LiquidityPoolCreated",
            "LiquidityAdded",
            "LiquidityRemoved",
            "SwapExecuted",
            "SaleCreated",
            "ExitCreated",
            "SaleCommitted",
            "SaleFinalized",
            "AllocationClaimed",
            "ExitSettled",
            "ProRataClaimed",
        ],
    ),
];

pub static REGISTRY: Lazy<HashMap<(Pubkey, [u8; 8]), EventMeta>> = Lazy::new(|| {
    let mut m = HashMap::new();
    for (program, pid, events) in EVENTS {
        let pk = Pubkey::from_str(pid).expect("hardcoded program id parses");
        for ev in events.iter() {
            m.insert((pk, anchor_event_disc(ev)), EventMeta { program, event: ev });
        }
    }
    m
});

pub fn lookup(program_id: &Pubkey, disc: &[u8]) -> Option<EventMeta> {
    if disc.len() < 8 {
        return None;
    }
    let mut key = [0u8; 8];
    key.copy_from_slice(&disc[..8]);
    REGISTRY.get(&(*program_id, key)).copied()
}

pub fn event_count() -> usize {
    REGISTRY.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_covers_all_emitted_events() {
        let declared_events = EVENTS.iter().map(|(_, _, events)| events.len()).sum::<usize>();
        assert_eq!(event_count(), declared_events);
        assert_eq!(event_count(), 54);
    }

    #[test]
    fn lookup_resolves_unifutures_capital_events() {
        let program_id = Pubkey::from_str("CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF").unwrap();
        let disc = anchor_event_disc("SaleCommitted");
        let meta = lookup(&program_id, &disc).unwrap();
        assert_eq!(meta.program, "aeqi_unifutures");
        assert_eq!(meta.event, "SaleCommitted");
    }
}
