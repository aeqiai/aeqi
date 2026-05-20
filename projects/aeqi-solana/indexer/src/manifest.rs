//! Canonical deployment manifest for the AEQI Solana indexer.
//!
//! Today the indexer is the first consumer of a single source of truth for
//! "which programs exist on which cluster, and at what addresses". Without
//! this, the same 11 program IDs lived in three places — `Anchor.toml`,
//! every `programs/aeqi-*/src/lib.rs` `declare_id!`, and an array literal in
//! `main.rs` — and drift was inevitable.
//!
//! Layout (`deployments/<cluster>.json`):
//!
//! ```json
//! {
//!   "cluster": "localnet",
//!   "programs": [
//!     { "name": "aeqi_trust", "pubkey": "Ccbs...JbXV", "idl_hash": null, "release": null }
//!   ]
//! }
//! ```
//!
//! The indexer loads this at startup (`AEQI_INDEXER_MANIFEST` env var
//! overrides the default path) and then validates the manifest against
//! `Anchor.toml [programs.<cluster>]`. A mismatch is fatal — the whole
//! point of the manifest is to detect drift, not paper over it.
//!
//! `declare_id!` in the Rust program crates is intentionally NOT
//! cross-validated here: Anchor compile-time IDs are fixed by the build
//! system and we trust the workspace to keep them in sync with
//! `Anchor.toml` via Anchor's own tooling.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Default manifest cluster when `AEQI_SOLANA_CLUSTER` is unset.
pub const DEFAULT_CLUSTER: &str = "localnet";

/// One program declared in the cluster manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgramEntry {
    /// Crate name (`aeqi_trust`, `aeqi_factory`, ...).
    pub name: String,
    /// Base58-encoded program ID, exactly as it appears in `Anchor.toml`.
    pub pubkey: String,
    /// Optional sha256 of the Anchor IDL JSON for this program. `None`
    /// when IDLs haven't been built yet (fresh checkout, CI cold cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idl_hash: Option<String>,
    /// Optional release tag (semver / git tag) this program was last
    /// shipped under. Indexer doesn't act on it; it's documentation that
    /// lives with the addresses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
}

/// One cluster's deployed program set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    /// Cluster identifier (`localnet`, `devnet`, `mainnet`).
    pub cluster: String,
    /// Programs deployed on this cluster, in subscription order.
    pub programs: Vec<ProgramEntry>,
}

impl Manifest {
    /// Resolve the manifest path for `cluster`, honoring an explicit
    /// `AEQI_INDEXER_MANIFEST` override.
    pub fn resolve_path(cluster: &str) -> PathBuf {
        if let Ok(explicit) = std::env::var("AEQI_INDEXER_MANIFEST") {
            return PathBuf::from(explicit);
        }
        // Default: `<indexer-crate>/../deployments/<cluster>.json`,
        // i.e. `projects/aeqi-solana/deployments/<cluster>.json`.
        let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        crate_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(crate_dir)
            .join("deployments")
            .join(format!("{}.json", cluster))
    }

    /// Load and parse the manifest at `path`.
    pub fn load(path: &Path) -> Result<Self> {
        let bytes = std::fs::read(path)
            .with_context(|| format!("failed to read manifest at {}", path.display()))?;
        let manifest: Manifest = serde_json::from_slice(&bytes)
            .with_context(|| format!("failed to parse manifest at {}", path.display()))?;
        if manifest.programs.is_empty() {
            bail!("manifest at {} has no programs", path.display());
        }
        manifest.validate_internal(path)?;
        Ok(manifest)
    }

    fn validate_internal(&self, path: &Path) -> Result<()> {
        let mut seen_names = BTreeMap::new();
        let mut seen_pubkeys = BTreeMap::new();
        for (idx, p) in self.programs.iter().enumerate() {
            if p.name.trim().is_empty() {
                bail!("manifest at {} has an empty program name at entry {}", path.display(), idx);
            }
            if p.pubkey.trim().is_empty() {
                bail!("manifest at {} program {:?} has an empty pubkey", path.display(), p.name);
            }
            if let Some(idl_hash) = &p.idl_hash {
                if !is_sha256_hex(idl_hash) {
                    bail!(
                        "manifest at {} program {:?} has invalid idl_hash {:?}; expected 64 hex characters",
                        path.display(),
                        p.name,
                        idl_hash
                    );
                }
            }
            if let Some(prev) = seen_names.insert(p.name.clone(), idx) {
                bail!(
                    "manifest at {} declares program name {:?} twice (entries {} and {})",
                    path.display(),
                    p.name,
                    prev,
                    idx
                );
            }
            if let Some(prev) = seen_pubkeys.insert(p.pubkey.clone(), idx) {
                bail!(
                    "manifest at {} declares pubkey {:?} twice (entries {} and {})",
                    path.display(),
                    p.pubkey,
                    prev,
                    idx
                );
            }
        }
        Ok(())
    }

    /// Cross-check the manifest's `(name, pubkey)` map against
    /// `Anchor.toml [programs.<cluster>]`. Fails loudly on any
    /// divergence — the manifest is supposed to be the single source of
    /// truth and a mismatch means drift is already in flight.
    ///
    /// Returns the path to the Anchor.toml that was inspected so callers
    /// can log it. If `anchor_toml_path` is `None`, the function looks
    /// for `<manifest-parent>/../Anchor.toml`.
    pub fn assert_matches_anchor_toml(
        &self,
        manifest_path: &Path,
        anchor_toml_path: Option<&Path>,
    ) -> Result<PathBuf> {
        let toml_path = match anchor_toml_path {
            Some(p) => p.to_path_buf(),
            None => default_anchor_toml_for(manifest_path)?,
        };
        let toml_str = std::fs::read_to_string(&toml_path)
            .with_context(|| format!("failed to read {}", toml_path.display()))?;
        let anchor: toml::Value = toml::from_str(&toml_str)
            .with_context(|| format!("failed to parse {}", toml_path.display()))?;
        let programs = anchor
            .get("programs")
            .and_then(toml::Value::as_table)
            .ok_or_else(|| anyhow!("{} has no [programs] table", toml_path.display()))?;
        let cluster_tbl =
            programs.get(&self.cluster).and_then(toml::Value::as_table).ok_or_else(|| {
                anyhow!(
                    "{} has no [programs.{}] entry; manifest expected one",
                    toml_path.display(),
                    self.cluster
                )
            })?;

        // Build canonical sets from both sides for symmetric-diff
        // reporting — keeps the failure message useful instead of
        // dying on the first mismatch.
        let manifest_set: BTreeMap<&str, &str> =
            self.programs.iter().map(|p| (p.name.as_str(), p.pubkey.as_str())).collect();
        let mut anchor_set: BTreeMap<String, String> = BTreeMap::new();
        for (name, val) in cluster_tbl {
            let pubkey = val.as_str().ok_or_else(|| {
                anyhow!(
                    "{}: [programs.{}].{} is not a string",
                    toml_path.display(),
                    self.cluster,
                    name
                )
            })?;
            anchor_set.insert(name.clone(), pubkey.to_string());
        }

        let mut errors: Vec<String> = Vec::new();
        for (name, pubkey) in &manifest_set {
            match anchor_set.get(*name) {
                Some(anchor_pk) if anchor_pk == pubkey => {}
                Some(anchor_pk) => errors.push(format!(
                    "program {:?}: manifest has {}, Anchor.toml has {}",
                    name, pubkey, anchor_pk
                )),
                None => errors.push(format!(
                    "program {:?} declared in manifest but missing from Anchor.toml [programs.{}]",
                    name, self.cluster
                )),
            }
        }
        for (name, _) in &anchor_set {
            if !manifest_set.contains_key(name.as_str()) {
                errors.push(format!(
                    "program {:?} declared in Anchor.toml [programs.{}] but missing from manifest",
                    name, self.cluster
                ));
            }
        }

        if !errors.is_empty() {
            bail!(
                "manifest/{} drift detected ({} mismatch{}):\n  - {}\n\nFix the manifest at {} or Anchor.toml at {} so both agree before restarting the indexer.",
                toml_path.display(),
                errors.len(),
                if errors.len() == 1 { "" } else { "es" },
                errors.join("\n  - "),
                manifest_path.display(),
                toml_path.display(),
            );
        }
        Ok(toml_path)
    }
}

fn default_anchor_toml_for(manifest_path: &Path) -> Result<PathBuf> {
    // Manifest lives at `<solana-root>/deployments/<cluster>.json`; the
    // Anchor.toml is its grandparent's `Anchor.toml`.
    let parent = manifest_path
        .parent()
        .ok_or_else(|| anyhow!("manifest path {} has no parent", manifest_path.display()))?;
    let solana_root = parent
        .parent()
        .ok_or_else(|| anyhow!("manifest parent {} has no parent", parent.display()))?;
    Ok(solana_root.join("Anchor.toml"))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(body.as_bytes()).unwrap();
    }

    fn fixture_manifest() -> &'static str {
        r#"{
  "cluster": "localnet",
  "programs": [
    { "name": "aeqi_trust",      "pubkey": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV" },
    { "name": "aeqi_factory",    "pubkey": "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv" },
    { "name": "aeqi_role",       "pubkey": "4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB" },
    { "name": "aeqi_governance", "pubkey": "5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq" },
    { "name": "aeqi_token",      "pubkey": "AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh" },
    { "name": "aeqi_treasury",   "pubkey": "2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7" },
    { "name": "aeqi_vesting",    "pubkey": "DCZKRmxjUyAZ3nptbkCBnAGqTe4E7xTvXfLbnf95uj7y" },
    { "name": "aeqi_budget",     "pubkey": "5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G" },
    { "name": "aeqi_fund",       "pubkey": "DaFpZcqMaL4rmAemJ2WBeUth42PMmHxNg9t6j9h9p7YP" },
    { "name": "aeqi_funding",    "pubkey": "8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U" },
    { "name": "aeqi_unifutures", "pubkey": "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF" }
  ]
}"#
    }

    fn fixture_anchor_toml() -> &'static str {
        r#"
[programs.localnet]
aeqi_budget     = "5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G"
aeqi_factory    = "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv"
aeqi_fund       = "DaFpZcqMaL4rmAemJ2WBeUth42PMmHxNg9t6j9h9p7YP"
aeqi_funding    = "8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U"
aeqi_governance = "5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq"
aeqi_role       = "4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB"
aeqi_token      = "AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh"
aeqi_treasury   = "2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7"
aeqi_trust      = "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV"
aeqi_unifutures = "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF"
aeqi_vesting    = "DCZKRmxjUyAZ3nptbkCBnAGqTe4E7xTvXfLbnf95uj7y"
"#
    }

    #[test]
    fn manifest_roundtrip_loads_all_eleven_programs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("deployments").join("localnet.json");
        write(&path, fixture_manifest());
        let manifest = Manifest::load(&path).unwrap();
        assert_eq!(manifest.cluster, "localnet");
        assert_eq!(manifest.programs.len(), 11);
        let names: Vec<_> = manifest.programs.iter().map(|p| p.name.as_str()).collect();
        for expected in [
            "aeqi_trust",
            "aeqi_factory",
            "aeqi_role",
            "aeqi_governance",
            "aeqi_token",
            "aeqi_treasury",
            "aeqi_vesting",
            "aeqi_budget",
            "aeqi_fund",
            "aeqi_funding",
            "aeqi_unifutures",
        ] {
            assert!(names.contains(&expected), "missing program {}", expected);
        }
        // Optional fields default to None and serialize away.
        assert!(manifest.programs.iter().all(|p| p.idl_hash.is_none()));
        assert!(manifest.programs.iter().all(|p| p.release.is_none()));
    }

    #[test]
    fn anchor_consistency_check_passes_on_aligned_inputs() {
        let tmp = TempDir::new().unwrap();
        let manifest_path = tmp.path().join("deployments").join("localnet.json");
        let anchor_path = tmp.path().join("Anchor.toml");
        write(&manifest_path, fixture_manifest());
        write(&anchor_path, fixture_anchor_toml());
        let manifest = Manifest::load(&manifest_path).unwrap();
        manifest
            .assert_matches_anchor_toml(&manifest_path, Some(&anchor_path))
            .expect("aligned manifest+anchor should validate");
    }

    #[test]
    fn anchor_consistency_check_fails_loudly_on_pubkey_drift() {
        let tmp = TempDir::new().unwrap();
        let manifest_path = tmp.path().join("deployments").join("localnet.json");
        let anchor_path = tmp.path().join("Anchor.toml");
        write(&manifest_path, fixture_manifest());
        // Swap aeqi_trust's pubkey to a different (still-valid) base58.
        let drifted = fixture_anchor_toml().replace(
            "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV",
            "11111111111111111111111111111111",
        );
        write(&anchor_path, &drifted);
        let manifest = Manifest::load(&manifest_path).unwrap();
        let err = manifest
            .assert_matches_anchor_toml(&manifest_path, Some(&anchor_path))
            .expect_err("drift should be rejected");
        let msg = format!("{err}");
        assert!(msg.contains("aeqi_trust"), "{}", msg);
        assert!(msg.contains("drift detected"), "{}", msg);
    }

    #[test]
    fn anchor_consistency_check_reports_missing_program() {
        let tmp = TempDir::new().unwrap();
        let manifest_path = tmp.path().join("deployments").join("localnet.json");
        let anchor_path = tmp.path().join("Anchor.toml");
        write(&manifest_path, fixture_manifest());
        // Drop aeqi_unifutures from Anchor.toml entirely.
        let trimmed: String = fixture_anchor_toml()
            .lines()
            .filter(|l| !l.contains("aeqi_unifutures"))
            .collect::<Vec<_>>()
            .join("\n");
        write(&anchor_path, &trimmed);
        let manifest = Manifest::load(&manifest_path).unwrap();
        let err = manifest
            .assert_matches_anchor_toml(&manifest_path, Some(&anchor_path))
            .expect_err("missing program should be rejected");
        assert!(format!("{err}").contains("aeqi_unifutures"));
    }

    #[test]
    fn manifest_rejects_duplicate_names() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("dup.json");
        write(
            &path,
            r#"{ "cluster": "localnet", "programs": [
              { "name": "aeqi_trust", "pubkey": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV" },
              { "name": "aeqi_trust", "pubkey": "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv" }
            ] }"#,
        );
        let err = Manifest::load(&path).expect_err("duplicate names should fail");
        assert!(format!("{err}").contains("twice"));
    }

    #[test]
    fn manifest_rejects_malformed_idl_hashes() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("bad-idl-hash.json");
        write(
            &path,
            r#"{ "cluster": "localnet", "programs": [
              {
                "name": "aeqi_trust",
                "pubkey": "CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV",
                "idl_hash": "not-a-sha256"
              }
            ] }"#,
        );
        let err = Manifest::load(&path).expect_err("malformed idl_hash should fail");
        assert!(format!("{err}").contains("invalid idl_hash"));
    }

    #[test]
    fn manifest_rejects_empty_programs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("empty.json");
        write(&path, r#"{ "cluster": "localnet", "programs": [] }"#);
        let err = Manifest::load(&path).expect_err("empty manifest should fail");
        assert!(format!("{err}").contains("no programs"));
    }

    #[test]
    fn resolve_path_honors_env_override() {
        // Save & restore — keep the test polite to a shared process.
        let prev = std::env::var("AEQI_INDEXER_MANIFEST").ok();
        std::env::set_var("AEQI_INDEXER_MANIFEST", "/tmp/explicit/devnet.json");
        let resolved = Manifest::resolve_path("localnet");
        assert_eq!(resolved, PathBuf::from("/tmp/explicit/devnet.json"));
        match prev {
            Some(v) => std::env::set_var("AEQI_INDEXER_MANIFEST", v),
            None => std::env::remove_var("AEQI_INDEXER_MANIFEST"),
        }
    }
}
