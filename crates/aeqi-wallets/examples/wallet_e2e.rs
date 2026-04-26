//! Phase 1 end-to-end spike: provision a custodial wallet, sign a digest,
//! verify with k256, reveal the mnemonic, and verify the reveal is stable
//! across calls.
//!
//! Run with: cargo run --release --example wallet_e2e

use std::sync::Arc;
use std::time::Instant;

use aeqi_wallets::{
    Address, EcdsaSignature, MasterKekProvider, ProvisionRequest, Pubkey, kek::SoftwareKek,
    provision_custodial, reveal_recovery_seed, sign_custodial, store::schema::migrate,
    types::ProvisionedBy,
};
use k256::ecdsa::{Signature, VerifyingKey, signature::hazmat::PrehashVerifier};
use rand::RngCore;
use rusqlite::Connection;
use sha3::{Digest, Keccak256};
use std::sync::Mutex;

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> anyhow::Result<()> {
    println!("=== aeqi-wallets Phase 1 end-to-end ===\n");

    // 1) Set up an in-memory DB and run migrations.
    let conn = Connection::open_in_memory()?;
    migrate(&conn)?;
    let db = Arc::new(Mutex::new(conn));

    // 2) Boot a software master KEK. In prod the master comes from Argon2id +
    //    operator passphrase; here we seed from random bytes (faster).
    let mut master = [0u8; 32];
    rand::rng().fill_bytes(&mut master);
    let kek = SoftwareKek::from_bytes(master, 1);
    println!("[1/5] master KEK ready (version {})\n", kek.version());

    // 3) Provision a custodial wallet for "user-alice".
    let t = Instant::now();
    let provisioned = provision_custodial(
        &db,
        &kek,
        ProvisionRequest {
            user_id: "user-alice".into(),
            is_primary: true,
            provisioned_by: ProvisionedBy::Runtime,
        },
    )
    .await?;
    println!(
        "[2/5] provisioned wallet for user-alice in {:?}",
        t.elapsed()
    );
    println!("        wallet_id: {}", provisioned.id.as_str());
    println!("        address:   {}", provisioned.address);
    println!(
        "        mnemonic:  {}\n",
        truncate_secret(&provisioned.mnemonic_revealed_once)
    );

    // 4) Sign a 32-byte Keccak256 digest of an example payload.
    let payload = b"transfer 1.0 ETH to 0xCAFE...";
    let digest: [u8; 32] = Keccak256::digest(payload).into();
    let t = Instant::now();
    let sig: EcdsaSignature = sign_custodial(&db, &kek, &provisioned.id, &digest).await?;
    let sign_elapsed = t.elapsed();
    println!("[3/5] signed digest in {:?}", sign_elapsed);
    println!("        r: 0x{}", hex::encode(sig.r));
    println!("        s: 0x{}", hex::encode(sig.s));
    println!("        v: {}\n", sig.v);

    // 5) Verify the signature with raw k256 against the stored compressed pubkey.
    verify_against_pubkey(&provisioned.address, &provisioned.pubkey, &digest, &sig)?;
    println!("[4/5] signature verifies against pubkey ✓");
    println!("        address roundtripped: {}\n", provisioned.address);

    // 6) Reveal the recovery seed twice; must be identical.
    let r1 = reveal_recovery_seed(&db, &kek, &provisioned.id).await?;
    let r2 = reveal_recovery_seed(&db, &kek, &provisioned.id).await?;
    assert_eq!(r1.mnemonic, r2.mnemonic, "reveal must be stable");
    assert_eq!(r1.address, provisioned.address);
    println!("[5/5] recovery reveal stable across calls ✓");
    println!(
        "        mnemonic words: {}\n",
        r1.mnemonic.split_whitespace().count()
    );

    // 7) Throughput sanity check: 100 sign() calls.
    let n = 100;
    let t = Instant::now();
    for _ in 0..n {
        let _ = sign_custodial(&db, &kek, &provisioned.id, &digest).await?;
    }
    let elapsed_ms = t.elapsed().as_millis().max(1);
    let signs_per_sec = (n as u128 * 1000) / elapsed_ms;
    println!("    {n} custodial-signs in {elapsed_ms} ms => ~{signs_per_sec} ops/sec");

    println!("\n=== PASS ===");
    Ok(())
}

fn verify_against_pubkey(
    addr: &Address,
    pubkey: &Pubkey,
    digest: &[u8; 32],
    sig: &EcdsaSignature,
) -> anyhow::Result<()> {
    let mut r_s = [0u8; 64];
    r_s[..32].copy_from_slice(&sig.r);
    r_s[32..].copy_from_slice(&sig.s);
    let k256_sig = Signature::from_slice(&r_s)?;
    let vk = VerifyingKey::from_sec1_bytes(&pubkey.0)?;
    vk.verify_prehash(digest, &k256_sig)?;

    // Also assert the address derives from this pubkey (full-circle check).
    let uncompressed = vk.to_encoded_point(false);
    let bytes = uncompressed.as_bytes();
    let hash = Keccak256::digest(&bytes[1..]);
    let mut derived = [0u8; 20];
    derived.copy_from_slice(&hash[12..]);
    anyhow::ensure!(
        addr.0 == derived,
        "address {addr} does not match pubkey-derived {}",
        Address(derived)
    );
    Ok(())
}

fn truncate_secret(s: &str) -> String {
    let words: Vec<&str> = s.split_whitespace().collect();
    if words.len() <= 4 {
        s.to_string()
    } else {
        format!(
            "{} {} {} ... ({} words)",
            words[0],
            words[1],
            words[2],
            words.len()
        )
    }
}
