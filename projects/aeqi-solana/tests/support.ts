import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { createHash, randomBytes } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AeqiTrust } from "../target/types/aeqi_trust";

/**
 * Per-invocation random tail used to rotate PDA seeds across mocha runs
 * against a persistent localnet validator (see quest ae-041 / ae-026
 * Phase 3 verification).
 *
 * Generated once at module load, so all fixtures within a single
 * `ts-mocha` invocation share a stable tail (within-suite seed
 * differentiators like `seed0`/`seed1` still produce distinct PDAs),
 * but consecutive runs get different tails — no more
 * AccountAlreadyInUse on re-run.
 */
export const SUITE_SEED_TAIL: Uint8Array = new Uint8Array(randomBytes(30));

export async function fundKeypair(
  provider: anchor.AnchorProvider,
  lamports = 2 * anchor.web3.LAMPORTS_PER_SOL,
) {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(kp.publicKey, lamports);
  const latest = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction(
    { signature: sig, ...latest },
    "confirmed",
  );
  return kp;
}

export async function expectTxFail(
  run: () => Promise<unknown>,
  pattern: RegExp | string,
) {
  try {
    await run();
  } catch (e: any) {
    const message = String(e);
    if (typeof pattern === "string") {
      expect(message).to.include(pattern);
    } else {
      expect(message).to.match(pattern);
    }
    return;
  }

  throw new Error(`expected transaction failure matching ${pattern}`);
}

export function trustIdFromLabel(label: string) {
  // Mix the per-invocation suite tail into the hash so the resulting
  // trust id (and therefore the PDA) rotates across runs while staying
  // stable within a single mocha invocation.
  return new Uint8Array(
    createHash("sha256").update(label).update(SUITE_SEED_TAIL).digest(),
  );
}

export function findTrustPda(
  trustProgram: Program<AeqiTrust>,
  trustId: Uint8Array,
) {
  const [trustPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trust"), Buffer.from(trustId)],
    trustProgram.programId,
  );
  return trustPda;
}

export async function createTrust(
  provider: anchor.AnchorProvider,
  trustProgram: Program<AeqiTrust>,
  label: string,
) {
  const trustId = trustIdFromLabel(label);
  const trustPda = findTrustPda(trustProgram, trustId);

  await trustProgram.methods
    .initialize(Array.from(trustId))
    .accountsPartial({
      trust: trustPda,
      authority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  return trustPda;
}
