// @vitest-environment node
/**
 * Smoke tests for the TypeScript PDA mirror of
 * `aeqi-platform/src/solana_provisioner.rs`.
 *
 * Runs in the Node test environment (not jsdom): web3.js v1.x's
 * `findProgramAddressSync` invokes `@noble/curves` `isOnCurve`, which
 * misbehaves under jsdom (every candidate nonce reports on-curve and the
 * loop exhausts with "Unable to find a viable program address nonce").
 * PDA derivation needs no DOM APIs anyway.
 *
 * Strategy: parity with the Rust side's property tests
 * (`trust_pda_is_deterministic`, `trust_pda_is_unique_per_trust_id`) rather
 * than hardcoded base58 values. Hardcoded values would have to be
 * regenerated whenever a seed convention changes; the property tests catch
 * the same regressions (PDA stability across runs, distinct inputs producing
 * distinct outputs) plus the structural invariants the Rust side asserts
 * by construction.
 */
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import {
  AEQI_ROLE_PROGRAM_ID,
  AEQI_TOKEN_PROGRAM_ID,
  AEQI_TREASURY_PROGRAM_ID,
  AEQI_TRUST_PROGRAM_ID,
  AEQI_UNIFUTURES_PROGRAM_ID,
  GENESIS_CURVE_ID,
  ROLE_MODULE_ID,
  TOKEN_CONFIG_KEY,
  deriveGenesisCurvePda,
  deriveModulePda,
  deriveRoleModuleStatePda,
  deriveTokenBytesConfigPda,
  deriveTokenMintPda,
  deriveTokenModuleStatePda,
  deriveTreasuryModuleStatePda,
  deriveTreasuryVaultAuthorityPda,
  deriveTrustPda,
} from "..";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function filledBytes(byte: number, length = 32): Uint8Array {
  const out = new Uint8Array(length);
  out.fill(byte);
  return out;
}

describe("solana/pdas", () => {
  describe("module ID sentinels", () => {
    it("ROLE_MODULE_ID is `pad32('R')` — first byte 0x52, rest zero", () => {
      expect(ROLE_MODULE_ID.length).toBe(32);
      expect(ROLE_MODULE_ID[0]).toBe(0x52);
      for (let i = 1; i < 32; i += 1) {
        expect(ROLE_MODULE_ID[i]).toBe(0);
      }
    });

    it("GENESIS_CURVE_ID starts with the ASCII bytes of 'GENESIS'", () => {
      expect(GENESIS_CURVE_ID.length).toBe(32);
      const expected = utf8("GENESIS");
      for (let i = 0; i < expected.length; i += 1) {
        expect(GENESIS_CURVE_ID[i]).toBe(expected[i]);
      }
      for (let i = expected.length; i < 32; i += 1) {
        expect(GENESIS_CURVE_ID[i]).toBe(0);
      }
    });

    it("TOKEN_CONFIG_KEY is [1, 0, ..., 0] — single tag byte", () => {
      expect(TOKEN_CONFIG_KEY.length).toBe(32);
      expect(TOKEN_CONFIG_KEY[0]).toBe(1);
      for (let i = 1; i < 32; i += 1) {
        expect(TOKEN_CONFIG_KEY[i]).toBe(0);
      }
    });
  });

  describe("deriveTrustPda", () => {
    it("is deterministic for the same trust id", () => {
      const trustId = filledBytes(42);
      const a = deriveTrustPda(trustId);
      const b = deriveTrustPda(trustId);
      expect(a.equals(b)).toBe(true);
    });

    it("is unique per trust id", () => {
      const a = deriveTrustPda(filledBytes(1));
      const b = deriveTrustPda(filledBytes(2));
      expect(a.equals(b)).toBe(false);
    });

    it("rejects trust ids that are not exactly 32 bytes", () => {
      expect(() => deriveTrustPda(new Uint8Array(31))).toThrow(/exactly 32 bytes/);
      expect(() => deriveTrustPda(new Uint8Array(33))).toThrow(/exactly 32 bytes/);
    });

    it("derives off AEQI_TRUST_PROGRAM_ID against the canonical 'trust' seed", () => {
      const trustId = filledBytes(7);
      const pda = deriveTrustPda(trustId);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8("trust"), trustId],
        AEQI_TRUST_PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });
  });

  describe("module-state PDAs are stable per trust + program", () => {
    const trustPda = deriveTrustPda(filledBytes(11));

    it.each([
      ["role", deriveRoleModuleStatePda, "role_module", AEQI_ROLE_PROGRAM_ID],
      ["token", deriveTokenModuleStatePda, "token_module", AEQI_TOKEN_PROGRAM_ID],
      ["treasury", deriveTreasuryModuleStatePda, "treasury_module", AEQI_TREASURY_PROGRAM_ID],
    ] as const)("%s matches canonical seeds", (_label, accessor, seed, programId) => {
      const pda = accessor(trustPda);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8(seed), trustPda.toBytes()],
        programId,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it("treasury vault authority uses the treasury_vault_authority seed", () => {
      const pda = deriveTreasuryVaultAuthorityPda(trustPda);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8("treasury_vault_authority"), trustPda.toBytes()],
        AEQI_TREASURY_PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });
  });

  describe("token + curve PDAs", () => {
    const trustPda = deriveTrustPda(filledBytes(13));

    it("token mint uses the 'mint' seed on the token program", () => {
      const mint = deriveTokenMintPda(trustPda);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8("mint"), trustPda.toBytes()],
        AEQI_TOKEN_PROGRAM_ID,
      );
      expect(mint.equals(expected)).toBe(true);
    });

    it("genesis curve seeds on the unifutures program", () => {
      const curve = deriveGenesisCurvePda(trustPda);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8("curve"), trustPda.toBytes(), GENESIS_CURVE_ID],
        AEQI_UNIFUTURES_PROGRAM_ID,
      );
      expect(curve.equals(expected)).toBe(true);
    });

    it("token bytes-config PDA is owned by trust program (cfg_bytes + TOKEN_CONFIG_KEY)", () => {
      const cfg = deriveTokenBytesConfigPda(trustPda);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8("cfg_bytes"), trustPda.toBytes(), TOKEN_CONFIG_KEY],
        AEQI_TRUST_PROGRAM_ID,
      );
      expect(cfg.equals(expected)).toBe(true);
    });
  });

  describe("deriveModulePda", () => {
    it("matches the canonical [module, trust, module_id] seeds", () => {
      const trustPda = deriveTrustPda(filledBytes(99));
      const pda = deriveModulePda(trustPda, ROLE_MODULE_ID);
      const [expected] = PublicKey.findProgramAddressSync(
        [utf8("module"), trustPda.toBytes(), ROLE_MODULE_ID],
        AEQI_TRUST_PROGRAM_ID,
      );
      expect(pda.equals(expected)).toBe(true);
    });

    it("rejects module ids that are not 32 bytes", () => {
      const trustPda = deriveTrustPda(filledBytes(1));
      expect(() => deriveModulePda(trustPda, new Uint8Array(8))).toThrow(/exactly 32 bytes/);
    });
  });
});
