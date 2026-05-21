/**
 * `useDecodedModuleActivity` — decode the leading N signatures against a
 * Module PDA into typed `aeqi_trust` instruction rows.
 *
 * Iter-6 surfaced the raw signature tail in `ModuleDetailModal` with
 * timestamp + explorer-link only. Operators couldn't tell which signature
 * was an `adopt_module_implementation` vs a `set_module_acl` vs a
 * `register_module` without opening each one in the explorer. Iter-7
 * closes that gap by walking each parsed transaction, finding the
 * `aeqi_trust` invocation that touched the Module PDA, and mapping its
 * 8-byte Anchor discriminator to the IDL instruction name.
 *
 * Decode strategy:
 *   1. The Module PDA is owned by `aeqi_trust` so most lifecycle
 *      mutations enter through one of the IDL's 11 instructions. We
 *      pull the instructions whose `programId === AEQI_TRUST_PROGRAM_ID`
 *      and look at the first 8 bytes of their data — `bs58.decode(data)`
 *      for partially-decoded instructions, or the `parsed.type` for
 *      fully-parsed ones (the IDL doesn't ship a parser plugin so RPCs
 *      almost always return partial-decode shape here).
 *   2. The discriminator → name map mirrors the canonical IDL
 *      (`aeqi_trust.json` instructions array, 2026-05-21 snapshot).
 *      If we don't recognise the disc the row falls back to a typed
 *      "On-chain call" badge with the raw 8-byte hex disc surfaced for
 *      the operator to grep upstream.
 *   3. Multiple `aeqi_trust` instructions in one tx (e.g. factory's
 *      register + adopt sequence) collapse to the FIRST recognised
 *      instruction. We surface the count via the secondary label so
 *      the operator knows the row is a compound, not a single-shot.
 *
 * Honest scope:
 *   - We do NOT decode arg payloads (which module slot, which ACL bits).
 *     The IDL types are non-trivial to encode-decode without dragging
 *     Anchor's borsh stack into the browser bundle; the operator gets
 *     the instruction *name* (the load-bearing answer) but not the
 *     argument values. The explorer deep-link covers the rest.
 *   - Capped at 12 sigs to match `useDecodedVaultActivity`. The modal
 *     truncates to 8 rows; the headroom matters because a tx may not
 *     decode and we want to surface the next-best one.
 *   - Non-AEQI signatures (third-party programs that touched the Module
 *     account via CPI without our IDL) collapse to "on-chain call" with
 *     the calling program IDs surfaced honestly. We never fabricate an
 *     `aeqi_trust` name when our program wasn't the caller.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { ParsedInstruction, PartiallyDecodedInstruction } from "@solana/web3.js";
import bs58 from "bs58";

import { getConnection } from "@/solana/client";
import { AEQI_TRUST_PROGRAM_ID } from "@/solana/pdas";
import type { VaultSignature } from "@/hooks/useVaultActivity";

const DECODE_LIMIT = 12;
const STALE_TIME_MS = 60_000;

const AEQI_TRUST_PID = AEQI_TRUST_PROGRAM_ID.toBase58();

/**
 * Anchor 8-byte instruction discriminators for `aeqi_trust`. Source of
 * truth: `apps/ui/src/solana/generated/idl/aeqi_trust.json` 2026-05-21
 * snapshot — keep in sync if the IDL is regenerated. Stored as hex so
 * the lookup key matches `bytesToHex(slice(0, 8))` without re-binding.
 */
const TRUST_DISCRIMINATORS: Record<string, string> = {
  "3406184628680edd": "adopt_module_implementation",
  ab3dda387f730cd9: "finalize",
  afaf6d1f0d989bed: "initialize",
  a91dedaf09f4a8d7: "publish_module_implementation",
  "66c5bb44323908ac": "register_module",
  "661410a145cbe265": "set_address_config",
  "232fce85907db36e": "set_bytes_config",
  bd25702641891fcc: "set_module_acl",
  "34096db715e47548": "set_module_implementation_active",
  "6eabcb8a5759a166": "set_numeric_config",
  "5b3c7dc0b0e1a6da": "set_paused",
};

export type DecodedModuleKind = "trust-ix" | "other";

export interface DecodedModuleActivity {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: VaultSignature["err"];
  kind: DecodedModuleKind;
  /** IDL instruction name when the disc matched (e.g. `set_module_acl`).
   *  Null when `kind === "other"`. */
  instruction: string | null;
  /** 8-byte hex disc surfaced for unrecognised AEQI calls — gives the
   *  operator a grep target against the IDL without us fabricating a
   *  name we don't have. */
  unknownDiscHex: string | null;
  /** Other AEQI-trust calls within the same tx — surfaced as a
   *  "+N more" label so the operator knows the row is a compound. */
  extraTrustCalls: number;
  /** Top-level program IDs called in the transaction. Surfaced in the
   *  "other" fallback so the row reads "called program X" honestly. */
  programs: string[];
}

function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Pull the first 8 bytes of a partially-decoded instruction's data.
 * Anchor stamps every ix with an 8-byte discriminator; that prefix
 * survives the bs58 wire encoding. Returns null when the data is too
 * short or undecodable.
 */
function discFromPartialIx(ix: PartiallyDecodedInstruction): string | null {
  if (typeof ix.data !== "string" || ix.data.length === 0) return null;
  try {
    const bytes = bs58.decode(ix.data);
    if (bytes.length < 8) return null;
    return bytesToHex(bytes.slice(0, 8));
  } catch {
    return null;
  }
}

/**
 * Walk a parsed transaction looking for `aeqi_trust` invocations against
 * the target Module PDA. Returns the first recognised instruction name
 * (so the row gets a load-bearing label) plus a count of additional
 * trust calls in the tx (so a compound register-then-adopt reads as
 * such instead of hiding the second call).
 */
function decodeParsedModuleTx(
  moduleAddress: string,
  parsed: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getConnection>["getParsedTransaction"]>>
  >,
  sig: VaultSignature,
): DecodedModuleActivity {
  const message = parsed.transaction.message;
  const accountKeys = message.accountKeys.map((a) => a.pubkey.toBase58());
  const programs = new Set<string>();
  for (const ix of message.instructions) programs.add(ix.programId.toBase58());

  // Flatten top-level + inner instructions; the factory wraps multiple
  // `aeqi_trust` calls inside a single user-facing tx via CPI.
  const allInstructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...message.instructions,
  ];
  for (const set of parsed.meta?.innerInstructions ?? []) {
    for (const ix of set.instructions) allInstructions.push(ix);
  }

  let firstInstruction: string | null = null;
  let firstUnknownDisc: string | null = null;
  let trustCallCount = 0;

  for (const ix of allInstructions) {
    if (ix.programId.toBase58() !== AEQI_TRUST_PID) continue;

    // Honest gate: confirm this instruction actually touched the
    // module PDA we're decoding for. A factory `initialize` doesn't
    // touch any Module; the register/adopt/set_acl trio do.
    // `PartiallyDecodedInstruction` exposes the account list; the
    // fully-parsed shape doesn't — for the latter we fall back to a
    // tx-wide accountKeys membership check (the signature wouldn't
    // have been returned otherwise) which is less precise but still
    // honest for `aeqi_trust` since it only writes to module/trust
    // PDAs.
    if (!isParsedInstruction(ix)) {
      const accountList = ix.accounts;
      const touchesModule = accountList.some((k) => k.toBase58() === moduleAddress);
      if (!touchesModule) continue;
    } else if (!accountKeys.includes(moduleAddress)) {
      continue;
    }

    trustCallCount += 1;
    if (isParsedInstruction(ix)) {
      // The IDL doesn't ship a parser plugin so this branch is rare in
      // practice; we still respect it for forward-compat. The parsed
      // shape carries the instruction name directly under `parsed.type`.
      const parsedIx = ix.parsed;
      const type =
        parsedIx && typeof parsedIx === "object" && "type" in parsedIx
          ? (parsedIx as { type?: string }).type
          : undefined;
      if (type && firstInstruction === null) firstInstruction = type;
      continue;
    }
    const disc = discFromPartialIx(ix);
    if (!disc) continue;
    const name = TRUST_DISCRIMINATORS[disc];
    if (name && firstInstruction === null) {
      firstInstruction = name;
    } else if (!name && firstInstruction === null && firstUnknownDisc === null) {
      firstUnknownDisc = disc;
    }
  }

  if (firstInstruction || firstUnknownDisc) {
    return {
      signature: sig.signature,
      blockTime: sig.blockTime,
      slot: sig.slot,
      err: sig.err,
      kind: "trust-ix",
      instruction: firstInstruction,
      unknownDiscHex: firstInstruction ? null : firstUnknownDisc,
      extraTrustCalls: Math.max(0, trustCallCount - 1),
      programs: [...programs],
    };
  }

  return {
    signature: sig.signature,
    blockTime: sig.blockTime,
    slot: sig.slot,
    err: sig.err,
    kind: "other",
    instruction: null,
    unknownDiscHex: null,
    extraTrustCalls: 0,
    programs: [...programs],
  };
}

export interface UseDecodedModuleActivityResult {
  rows: DecodedModuleActivity[];
  isLoading: boolean;
  hasAny: boolean;
}

/**
 * Fetch parsed transactions for the leading `limit` signatures touching
 * a Module PDA and tag each with its IDL instruction name where the
 * 8-byte Anchor discriminator matches a known `aeqi_trust` ix.
 */
export function useDecodedModuleActivity(
  moduleAddress: string | null,
  signatures: VaultSignature[],
  limit: number = DECODE_LIMIT,
): UseDecodedModuleActivityResult {
  const targetSigs = useMemo(() => signatures.slice(0, limit), [signatures, limit]);

  const queries = useQueries({
    queries: targetSigs.map((sig) => ({
      queryKey: ["assets", "module-activity-decoded", moduleAddress ?? "none", sig.signature],
      queryFn: async (): Promise<DecodedModuleActivity> => {
        if (!moduleAddress) {
          return {
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
            err: sig.err,
            kind: "other",
            instruction: null,
            unknownDiscHex: null,
            extraTrustCalls: 0,
            programs: [],
          };
        }
        const conn = getConnection();
        try {
          const parsed = await conn.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          });
          if (!parsed) {
            return {
              signature: sig.signature,
              blockTime: sig.blockTime,
              slot: sig.slot,
              err: sig.err,
              kind: "other",
              instruction: null,
              unknownDiscHex: null,
              extraTrustCalls: 0,
              programs: [],
            };
          }
          return decodeParsedModuleTx(moduleAddress, parsed, sig);
        } catch {
          return {
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
            err: sig.err,
            kind: "other",
            instruction: null,
            unknownDiscHex: null,
            extraTrustCalls: 0,
            programs: [],
          };
        }
      },
      enabled: !!moduleAddress && targetSigs.length > 0,
      staleTime: STALE_TIME_MS,
    })),
  });

  const rows = useMemo<DecodedModuleActivity[]>(() => {
    const out: DecodedModuleActivity[] = [];
    for (let i = 0; i < targetSigs.length; i += 1) {
      const q = queries[i];
      if (q?.data) out.push(q.data);
    }
    return out;
  }, [queries, targetSigs]);

  const isLoading = queries.some((q) => q.isLoading);
  const hasAny = rows.some((r) => r.kind === "trust-ix");

  return { rows, isLoading, hasAny };
}
