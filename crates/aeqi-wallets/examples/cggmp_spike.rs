//! Phase 0 spike: cggmp21 2-of-2 threshold ECDSA keygen + sign roundtrip with timing.
//!
//! Uses the trusted_dealer shortcut for keygen (avoids the multi-hour safe-prime
//! generation of a real DKG ceremony) and runs the full interactive signing
//! protocol over round_based's sync simulation harness.

use std::time::Instant;

use cggmp21::{
    DataToSign, ExecutionId, key_share::AnyKeyShare as _, security_level::SecurityLevel128,
    supported_curves::Secp256k1, trusted_dealer,
};
use rand_core::OsRng;
use round_based::sim;

type Msg = cggmp21::signing::msg::Msg<Secp256k1, sha2::Sha256>;

fn main() {
    let mut rng = OsRng;
    let n: u16 = 2; // 2-of-2

    // ── Keygen (trusted dealer — includes safe-prime generation for aux info) ────
    println!("=== cggmp21 2-of-2 threshold ECDSA spike ===\n");
    println!("[keygen] generating {n}-of-{n} key shares via trusted dealer ...");
    let t0 = Instant::now();

    let key_shares = trusted_dealer::builder::<Secp256k1, SecurityLevel128>(n)
        .set_threshold(Some(n))
        .generate_shares(&mut rng)
        .expect("trusted dealer keygen failed");

    let keygen_elapsed = t0.elapsed();
    println!("[keygen] done in {:.2?}", keygen_elapsed);

    // Confirm all parties agree on the same joint public key.
    let joint_pk = key_shares[0].shared_public_key();
    for ks in &key_shares {
        assert_eq!(
            ks.shared_public_key(),
            joint_pk,
            "parties disagree on public key"
        );
    }
    println!("[keygen] joint public key consistent across all parties ✓");

    // ── Signing ──────────────────────────────────────────────────────────────────
    let msg_digest: [u8; 32] = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(b"aeqi wallet phase-0 spike message");
        h.finalize().into()
    };
    let data_to_sign =
        DataToSign::<Secp256k1>::digest::<sha2::Sha256>(b"aeqi wallet phase-0 spike message");

    // parties_indexes_at_keygen[i] = keygen index of the i-th signer.
    // For 2-of-2 both parties participate; their keygen indices are 0 and 1.
    let keygen_indexes: Vec<u16> = (0..n).collect();

    println!("[signing] running {n}-party interactive signing protocol ...");
    let t1 = Instant::now();

    // Clone key_shares into the closure (round_based sim takes ownership of futures).
    let ks: Vec<_> = key_shares.clone();

    let signatures = sim::run::<Msg, _>(n, |i, party| {
        let key_share = ks[usize::from(i)].clone();
        let ki = keygen_indexes.clone();
        let mut rng = OsRng;
        async move {
            cggmp21::signing(
                ExecutionId::new(b"spike-signing-session-01"),
                i,
                &ki,
                &key_share,
            )
            .sign(&mut rng, party, data_to_sign)
            .await
        }
    })
    .expect("simulation failed")
    .expect_ok();

    let signing_elapsed = t1.elapsed();
    println!("[signing] done in {:.2?}", signing_elapsed);

    // ── Verify ───────────────────────────────────────────────────────────────────
    println!("[verify] checking all {n} output signatures ...");
    for (i, sig) in signatures.iter().enumerate() {
        sig.verify(&*joint_pk, &data_to_sign)
            .unwrap_or_else(|_| panic!("party {i} signature verification FAILED"));
    }
    println!("[verify] all signatures valid ✓");

    // Also cross-check: both parties produce the same (r, s) signature.
    assert_eq!(
        signatures[0].r, signatures[1].r,
        "parties produced different r components"
    );
    assert_eq!(
        signatures[0].s, signatures[1].s,
        "parties produced different s components"
    );
    println!("[verify] both parties produced identical (r,s) ✓");

    // ── Report ───────────────────────────────────────────────────────────────────
    println!("\n=== PASS ===");
    println!("  message (hex):  {}", hex::encode(msg_digest));
    println!(
        "  keygen time:    {:.2?}  (trusted-dealer incl. safe-prime gen)",
        keygen_elapsed
    );
    println!(
        "  signing time:   {:.2?}  (interactive MPC, 2 parties)",
        signing_elapsed
    );
    println!("  total:          {:.2?}", keygen_elapsed + signing_elapsed);
}
