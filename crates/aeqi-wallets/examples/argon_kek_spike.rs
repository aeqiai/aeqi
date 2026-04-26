//! Phase 0 spike: Argon2id-derived master KEK + ChaCha20-Poly1305 wrap/unwrap
//! roundtrip with timing. Validates the software backend works end-to-end and
//! gives us empirical numbers for derivation cost and wrap/unwrap throughput.
//!
//! Run with: cargo run --release --example argon_kek_spike

use aeqi_wallets::kek::{MasterKekProvider, SoftwareKek};
use rand::RngCore;
use std::time::Instant;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Argon2id KEK spike ===\n");

    // Stable per-deployment salt (would be on disk in prod).
    let mut salt = [0u8; 16];
    rand::rng().fill_bytes(&mut salt);

    // 1) Derive master KEK from passphrase. Deliberately expensive (512 MiB,
    //    t=3, p=4) — runs once per process boot, so a few seconds is fine.
    let t0 = Instant::now();
    let kek = SoftwareKek::derive("operator-passphrase-example-do-not-ship", &salt)?;
    let derive_ms = t0.elapsed().as_millis();
    println!("derive(Argon2id, m=512MiB, t=3, p=4):  {derive_ms} ms");

    // 2) Wrap a 32-byte plaintext per-wallet KEK.
    let mut plaintext = [0u8; 32];
    rand::rng().fill_bytes(&mut plaintext);

    let t1 = Instant::now();
    let ct = kek.wrap(&plaintext).await?;
    let wrap_us = t1.elapsed().as_micros();
    println!(
        "wrap(32 bytes):                        {wrap_us} µs   (ct {} bytes)",
        ct.len()
    );

    // 3) Unwrap and verify roundtrip.
    let t2 = Instant::now();
    let recovered = kek.unwrap(&ct).await?;
    let unwrap_us = t2.elapsed().as_micros();
    println!("unwrap(ciphertext):                    {unwrap_us} µs");

    assert_eq!(&plaintext[..], recovered.as_ref(), "roundtrip mismatch");
    println!("\n  ✓ wrap/unwrap roundtrip OK (32-byte plaintext recovered exactly)");

    // 4) Throughput sanity check: 1000 wrap/unwrap pairs.
    let n = 1000;
    let mut throughput_pairs = Vec::with_capacity(n);
    let t3 = Instant::now();
    for _ in 0..n {
        let mut pt = [0u8; 32];
        rand::rng().fill_bytes(&mut pt);
        let ct = kek.wrap(&pt).await?;
        let pt_back = kek.unwrap(&ct).await?;
        assert_eq!(&pt[..], pt_back.as_ref());
        throughput_pairs.push(ct.len());
    }
    let elapsed_ms = t3.elapsed().as_millis().max(1);
    let pairs_per_sec = (n as u128 * 1000) / elapsed_ms;
    println!("\n  {n} wrap/unwrap pairs in {elapsed_ms} ms => ~{pairs_per_sec} pairs/sec");

    // 5) Tamper detection: flipping a byte in the ciphertext must fail unwrap.
    let mut tampered = ct.clone();
    tampered[20] ^= 0x01;
    let r = kek.unwrap(&tampered).await;
    assert!(r.is_err(), "tampered ciphertext must fail unwrap");
    println!("  ✓ tampered ciphertext rejected (AEAD integrity holds)");

    // 6) Wrong-master rejection: a different passphrase must fail unwrap.
    let other = SoftwareKek::derive("different-passphrase", &salt)?;
    let r = other.unwrap(&ct).await;
    assert!(r.is_err(), "wrong master must fail unwrap");
    println!("  ✓ wrong master KEK rejected (per-passphrase isolation holds)");

    println!("\n=== KEK spike PASS ===");
    Ok(())
}
