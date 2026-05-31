//! Anchor event discriminator → typed event name registry.
//!
//! Anchor encodes events as `Program data: base64(disc || borsh)` where
//! `disc = sha256("event:" + EventName)[..8]`. We pre-compute the
//! discriminators for every event our 11 programs emit so the live tail can
//! print typed names (and the DB sink can route to typed columns).

use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::str::FromStr;

use crate::manifest::Manifest;

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
        "aeqi_company",
        "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV",
        &[
            "CompanyInitialized",
            "CompanyFinalized",
            "CompanyPauseChanged",
            "ModuleRegistered",
            "ModuleImplementationPublished",
            "ModuleImplementationActiveChanged",
            "ModuleImplementationAdopted",
            "ModuleAclSet",
        ],
    ),
    (
        "aeqi_factory",
        "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv",
        &[
            "CompanyCreated",
            "CompanySpawned",
            "CompanyFullySpawned",
            "TemplateRegistered",
            "TemplateInstantiated",
        ],
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
        &[
            "ConfigRegistered",
            "ProposalCreated",
            "VoteCast",
            "ProposalExecuted",
            "SnapshotRootCommitted",
        ],
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
        &["PositionCreated", "Claimed", "FdvMilestoneHit", "ContributionPaid"],
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

pub fn assert_matches_manifest(manifest: &Manifest) -> anyhow::Result<()> {
    let registry_programs: BTreeMap<&str, &str> =
        EVENTS.iter().map(|(name, pubkey, _)| (*name, *pubkey)).collect();
    let manifest_programs: BTreeMap<&str, &str> =
        manifest.programs.iter().map(|p| (p.name.as_str(), p.pubkey.as_str())).collect();

    let mut errors = Vec::new();
    for (name, pubkey) in &registry_programs {
        match manifest_programs.get(name) {
            Some(manifest_pubkey) if manifest_pubkey == pubkey => {}
            Some(manifest_pubkey) => errors.push(format!(
                "program {:?}: registry has {}, manifest has {}",
                name, pubkey, manifest_pubkey
            )),
            None => errors.push(format!(
                "program {:?} declared in event registry but missing from manifest",
                name
            )),
        }
    }
    for name in manifest_programs.keys() {
        if !registry_programs.contains_key(name) {
            errors.push(format!(
                "program {:?} declared in manifest but missing from event registry",
                name
            ));
        }
    }

    if !errors.is_empty() {
        anyhow::bail!(
            "event registry/manifest drift detected ({} mismatch{}):\n  - {}",
            errors.len(),
            if errors.len() == 1 { "" } else { "es" },
            errors.join("\n  - ")
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::ProgramEntry;
    use serde::Deserialize;
    use std::collections::BTreeSet;

    fn manifest_from_registry() -> Manifest {
        Manifest {
            cluster: "localnet".to_string(),
            programs: EVENTS
                .iter()
                .map(|(name, pubkey, _)| ProgramEntry {
                    name: (*name).to_string(),
                    pubkey: (*pubkey).to_string(),
                    idl_hash: None,
                    release: None,
                })
                .collect(),
        }
    }

    #[test]
    fn registry_covers_all_emitted_events() {
        let declared_events = EVENTS.iter().map(|(_, _, events)| events.len()).sum::<usize>();
        assert_eq!(event_count(), declared_events);
        assert_eq!(event_count(), 61);
    }

    #[derive(Deserialize)]
    struct IdlEvent {
        name: String,
    }

    #[derive(Deserialize)]
    struct Idl {
        events: Option<Vec<IdlEvent>>,
    }

    fn idl_event_names(idl: &str) -> BTreeSet<String> {
        serde_json::from_str::<Idl>(idl)
            .expect("generated IDL parses")
            .events
            .unwrap_or_default()
            .into_iter()
            .map(|event| event.name)
            .collect()
    }

    #[test]
    fn registry_events_match_generated_idls() {
        let generated_idls = [
            (
                "aeqi_budget",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_budget.json"),
            ),
            (
                "aeqi_factory",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_factory.json"),
            ),
            (
                "aeqi_fund",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_fund.json"),
            ),
            (
                "aeqi_funding",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_funding.json"),
            ),
            (
                "aeqi_governance",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_governance.json"),
            ),
            (
                "aeqi_role",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_role.json"),
            ),
            (
                "aeqi_token",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_token.json"),
            ),
            (
                "aeqi_treasury",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_treasury.json"),
            ),
            (
                "aeqi_company",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_company.json"),
            ),
            (
                "aeqi_unifutures",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_unifutures.json"),
            ),
            (
                "aeqi_vesting",
                include_str!("../../../../apps/ui/src/solana/generated/idl/aeqi_vesting.json"),
            ),
        ];

        let registry_events = EVENTS
            .iter()
            .map(|(program, _, events)| {
                (*program, events.iter().map(|event| (*event).to_string()).collect::<BTreeSet<_>>())
            })
            .collect::<BTreeMap<_, _>>();

        for (program, idl) in generated_idls {
            let registry = registry_events.get(program).expect("program exists in registry");
            let generated = idl_event_names(idl);
            assert_eq!(
                registry, &generated,
                "{program} registry events drifted from generated IDL"
            );
        }
    }

    #[test]
    fn lookup_resolves_unifutures_capital_events() {
        let program_id = Pubkey::from_str("CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF").unwrap();
        let disc = anchor_event_disc("SaleCommitted");
        let meta = lookup(&program_id, &disc).unwrap();
        assert_eq!(meta.program, "aeqi_unifutures");
        assert_eq!(meta.event, "SaleCommitted");
    }

    #[test]
    fn registry_program_ids_match_manifest() {
        let manifest = manifest_from_registry();
        assert_matches_manifest(&manifest).expect("registry and manifest should agree");
    }

    #[test]
    fn registry_program_ids_reject_manifest_drift() {
        let mut manifest = manifest_from_registry();
        let company =
            manifest.programs.iter_mut().find(|program| program.name == "aeqi_company").unwrap();
        company.pubkey = "11111111111111111111111111111111".to_string();

        let err = assert_matches_manifest(&manifest).expect_err("drift should be rejected");
        let msg = format!("{err}");
        assert!(msg.contains("aeqi_company"), "{msg}");
        assert!(msg.contains("drift detected"), "{msg}");
    }
}
