import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { createHash, randomBytes } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AeqiCompany } from "../target/types/aeqi_company";

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

export function companyIdFromLabel(label: string) {
  // Mix the per-invocation suite tail into the hash so the resulting
  // company id (and therefore the PDA) rotates across runs while staying
  // stable within a single mocha invocation.
  return new Uint8Array(
    createHash("sha256").update(label).update(SUITE_SEED_TAIL).digest(),
  );
}

export function findCompanyPda(
  trustProgram: Program<AeqiCompany>,
  companyId: Uint8Array,
) {
  const [trustPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("company"), Buffer.from(companyId)],
    trustProgram.programId,
  );
  return trustPda;
}

export async function createCompany(
  provider: anchor.AnchorProvider,
  trustProgram: Program<AeqiCompany>,
  label: string,
) {
  const companyId = companyIdFromLabel(label);
  const trustPda = findCompanyPda(trustProgram, companyId);

  await trustProgram.methods
    .initialize(Array.from(companyId))
    .accountsPartial({
      company: trustPda,
      authority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  return trustPda;
}
