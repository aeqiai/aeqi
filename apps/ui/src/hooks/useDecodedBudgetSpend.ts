/**
 * `useDecodedBudgetSpend` — decode the leading N signatures against a
 * Budget PDA into typed spend rows (recipient + USDC amount + memo if
 * present).
 *
 * Iter-5 closes the gap that `BudgetSignatureTail` left raw: the modal
 * lists signatures by timestamp but doesn't tell the operator what each
 * one *did*. Now we replay each parsed transaction and look for:
 *
 *   1. SPL `transfer` / `transferChecked` instructions that move tokens
 *      *out of* a vault ATA on behalf of the budget. The destination
 *      ATA's owner is the recipient (the spend target).
 *   2. SPL Memo program instructions in the same transaction — their
 *      base64 (or utf-8) payload carries the spend memo when the
 *      caller attached one.
 *
 * Honest scope:
 *   - We don't differentiate "allocate child budget" from "spend to
 *     recipient"; both look like a budget-program signature against the
 *     PDA. When the parsed transaction has no outgoing SPL transfer we
 *     mark the row as `kind: "other"` rather than fabricating a spend.
 *   - Capped at the same 12-row limit as `useDecodedVaultActivity` to
 *     hold the RPC cost bounded; if more signatures need decoding the
 *     caller can lift the cap.
 *
 * The hook is symmetric with `useDecodedVaultActivity` — same React
 * Query batching, same one-second stale window, same per-sig cache key.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  PublicKey,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

import { getConnection, isDirectSolanaRpcEnabled } from "@/solana/client";
import { AEQI_BUDGET_PROGRAM_ID } from "@/solana/pdas";
import type { VaultSignature } from "@/hooks/useVaultActivity";

const DECODE_LIMIT = 12;
const STALE_TIME_MS = 60_000;

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** SPL Memo v3 program — the dominant version live across mainnet today. */
const MEMO_V3_PROGRAM = "MemoSq4gqABAxKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** SPL Memo v1 — still appears in older programs' CPI shape. */
const MEMO_V1_PROGRAM = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";

/**
 * Iter-9: budget IDL instruction discriminators. Source of truth:
 * `apps/ui/src/solana/generated/idl/aeqi_budget.json` 2026-05-21 snapshot
 * — keep in sync if the IDL regenerates. The freeze/unfreeze pair is the
 * iter-8 "NEXT" gap closure: when an operator freezes/unfreezes a budget,
 * the on-chain ix touches the Budget PDA but moves no tokens. Iter-5's
 * decoder fell through to "On-chain call" with no semantic label.
 *
 * Stored as hex-encoded first 8 bytes of the instruction data, matching
 * the discriminator surfaced by `bs58.decode(ix.data).slice(0, 8)`.
 * `init` is the one-time per-company BudgetModuleState allocation; it
 * doesn't touch any Budget PDA but is included so future expansion to a
 * module-state signature tail can reuse the table.
 */
const BUDGET_DISCRIMINATORS: Record<string, DecodedBudgetIxName> = {
  ebe6b3c9e93a9e48: "create_budget",
  ff5bcf54fbc2fe3f: "freeze",
  dc3bcfec6cfa2f64: "init",
  "6f661140f5ca4f37": "record_spend",
  "85a044fd50e8daf7": "unfreeze",
};

export type DecodedBudgetIxName = "create_budget" | "freeze" | "init" | "record_spend" | "unfreeze";

/**
 * Iter-9: kind taxonomy widened beyond the iter-5 `spend | other` split.
 * Honest semantics:
 *  - `spend` — parsed SPL transfer out of the budget's vault ATA (iter-5).
 *  - `budget-ix` — `aeqi_budget` IDL instruction touched the Budget PDA
 *    but moved no tokens (freeze, unfreeze, allocate-child, etc).
 *  - `other` — neither matched. Could be a third-party CPI against the
 *    Budget PDA or a tx we couldn't parse; we surface the program list
 *    on the row so the operator can still tell what happened.
 */
export type DecodedBudgetKind = "spend" | "budget-ix" | "other";

export interface DecodedBudgetSpend {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: VaultSignature["err"];
  kind: DecodedBudgetKind;
  /** Token mint of the outgoing transfer (USDC for the canonical budget). */
  mint: string | null;
  /** Raw token amount in base units. */
  amount: bigint | null;
  /** Owner of the destination ATA — the spend recipient. */
  recipient: string | null;
  /** Memo text if a Memo program instruction sat alongside the transfer. */
  memo: string | null;
  /** Top-level program IDs the transaction called — surfaced in the "other"
   *  fallback so the row can render "called aeqi_budget" honestly. */
  programs: string[];
  /** Iter-9: IDL instruction name when the row decoded as a `budget-ix`
   *  (freeze, unfreeze, …). Null for spend rows + truly-other rows. */
  budgetIx: DecodedBudgetIxName | null;
}

function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

interface ParsedTransferInfo {
  source: string;
  destination: string;
  amount?: string;
  authority?: string;
  tokenAmount?: { amount: string };
  mint?: string;
}

interface AtaResolver {
  ownerOf: (ata: string) => string | null;
  mintOf: (ata: string) => string | null;
}

function buildResolver(
  preBalances: Array<{ accountIndex: number; mint: string; owner?: string }> | undefined,
  postBalances: Array<{ accountIndex: number; mint: string; owner?: string }> | undefined,
  accountKeys: string[],
): AtaResolver {
  const ownerByAta = new Map<string, string>();
  const mintByAta = new Map<string, string>();
  for (const bal of [...(preBalances ?? []), ...(postBalances ?? [])]) {
    const ata = accountKeys[bal.accountIndex];
    if (!ata) continue;
    if (bal.owner) ownerByAta.set(ata, bal.owner);
    if (bal.mint) mintByAta.set(ata, bal.mint);
  }
  return {
    ownerOf: (ata: string) => ownerByAta.get(ata) ?? null,
    mintOf: (ata: string) => mintByAta.get(ata) ?? null,
  };
}

/**
 * Decode a partially-decoded SPL Memo instruction's data into the human
 * UTF-8 string. The RPC delivers Memo instruction data as base58 when it
 * can't (or doesn't) parse the program shape — the bytes themselves
 * still carry a plain UTF-8 payload, so we run them through
 * `bs58.decode` and `TextDecoder("utf-8", { fatal: true })`. If the
 * payload isn't valid UTF-8 we return `null` rather than surface raw
 * base58 to the operator (which reads as garbled mojibake — strictly
 * worse than no memo).
 */
function decodeMemoBytes(data: string): string | null {
  try {
    const bytes = bs58.decode(data);
    if (bytes.length === 0) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(bytes);
    // Strip NUL + C0 control bytes that occasionally pad short memos.
    // We never trim real printable whitespace; .trim() handles edges.
    // The regex is intentional — `no-control-regex` is the wrong check
    // for byte-payload sanitization where the control range IS the target.
    // eslint-disable-next-line no-control-regex
    const cleaned = text.replace(/[\x00-\x1f\x7f]+/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

/**
 * Pull a memo string out of either a parsed memo instruction (memo lives
 * on `parsed.info` as a string) or the partially-decoded form. When the
 * partially-decoded shape is the only one available we run the base58
 * data through `bs58.decode` → UTF-8; iter-5 surfaced the raw base58
 * blob ("3aS9F2QbvR…") which is unreadable, iter-6 surfaces the actual
 * memo text. Returns `null` rather than guessing when nothing decodes.
 */
function extractMemo(ixs: Array<ParsedInstruction | PartiallyDecodedInstruction>): string | null {
  for (const ix of ixs) {
    const pid = ix.programId.toBase58();
    if (pid !== MEMO_V3_PROGRAM && pid !== MEMO_V1_PROGRAM) continue;
    if (isParsedInstruction(ix)) {
      const parsedIx = ix.parsed;
      if (typeof parsedIx === "string") return parsedIx;
      if (parsedIx && typeof parsedIx === "object") {
        const info = (parsedIx as { info?: unknown }).info;
        if (typeof info === "string") return info;
        if (info && typeof info === "object" && "memo" in info) {
          const memoVal = (info as { memo: unknown }).memo;
          if (typeof memoVal === "string") return memoVal;
        }
      }
    } else {
      // partially-decoded — the data string is base58 (web3.js default).
      // Decode the raw bytes and interpret as UTF-8 so the user-facing
      // memo lands as plain text. If the bytes aren't valid UTF-8 we
      // return null (the memo wasn't really a string).
      const data = ix.data;
      if (typeof data === "string" && data.length > 0) {
        const decoded = decodeMemoBytes(data);
        if (decoded) return decoded;
      }
    }
  }
  return null;
}

/**
 * Iter-9: extract the first 8 bytes (Anchor instruction discriminator)
 * from a partially-decoded `aeqi_budget` instruction. Returns null when
 * the data is too short or undecodable — matches the helper shape used by
 * `useDecodedModuleActivity` for `aeqi_company` ix.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

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

const AEQI_BUDGET_PID = AEQI_BUDGET_PROGRAM_ID.toBase58();

/**
 * Iter-9: detect the IDL instruction name when this tx invoked
 * `aeqi_budget` against the target Budget PDA. We honestly bail when no
 * `aeqi_budget` instruction touched the PDA — a third-party CPI that
 * happens to mention the Budget account in some satellite slot should
 * NOT be relabelled as a budget mutation.
 */
function decodeBudgetIxName(
  budgetPda: string,
  allInstructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  accountKeys: string[],
): DecodedBudgetIxName | null {
  for (const ix of allInstructions) {
    if (ix.programId.toBase58() !== AEQI_BUDGET_PID) continue;

    // Confirm the instruction touched the Budget PDA. Partial shape
    // exposes the accounts list directly; the fully-parsed shape doesn't,
    // so we fall back to a tx-wide membership check (the sig wouldn't
    // have been returned otherwise — `aeqi_budget` only writes to
    // Budget/ModuleState PDAs).
    if (!isParsedInstruction(ix)) {
      const touches = ix.accounts.some((k) => k.toBase58() === budgetPda);
      if (!touches) continue;
      const disc = discFromPartialIx(ix);
      if (!disc) continue;
      const name = BUDGET_DISCRIMINATORS[disc];
      if (name) return name;
    } else if (accountKeys.includes(budgetPda)) {
      // Parsed shape rare for `aeqi_budget` since no parser plugin ships
      // with the IDL — fall through. Future-proof: if a parser ever
      // resolves `ix.parsed.type` we honour it.
      const type = (ix.parsed as { type?: string } | null)?.type;
      if (type === "create_budget" || type === "freeze" || type === "unfreeze") return type;
    }
  }
  return null;
}

function decodeParsedSpend(
  parsed: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getConnection>["getParsedTransaction"]>>
  >,
  sig: VaultSignature,
  budgetPda: string,
): DecodedBudgetSpend {
  const message = parsed.transaction.message;
  const accountKeys = message.accountKeys.map((a) => a.pubkey.toBase58());
  const programs = new Set<string>();
  for (const ix of message.instructions) programs.add(ix.programId.toBase58());

  const resolver = buildResolver(
    parsed.meta?.preTokenBalances ?? undefined,
    parsed.meta?.postTokenBalances ?? undefined,
    accountKeys,
  );

  const allInstructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...message.instructions,
  ];
  for (const set of parsed.meta?.innerInstructions ?? []) {
    for (const ix of set.instructions) allInstructions.push(ix);
  }

  const memo = extractMemo(allInstructions);

  for (const ix of allInstructions) {
    if (!isParsedInstruction(ix)) continue;
    const pid = ix.programId.toBase58();
    if (pid !== SPL_TOKEN_PROGRAM && pid !== SPL_TOKEN_2022_PROGRAM) continue;
    const parsedIx = ix.parsed;
    if (typeof parsedIx !== "object" || parsedIx === null) continue;
    const type = (parsedIx as { type?: string }).type;
    if (type !== "transfer" && type !== "transferChecked") continue;
    const info = (parsedIx as { info: ParsedTransferInfo }).info;
    const amountStr = info.tokenAmount?.amount ?? info.amount;
    if (!amountStr) continue;
    const amount = BigInt(amountStr);
    const recipient = resolver.ownerOf(info.destination);
    const mint =
      info.mint ?? resolver.mintOf(info.destination) ?? resolver.mintOf(info.source) ?? null;
    return {
      signature: sig.signature,
      blockTime: sig.blockTime,
      slot: sig.slot,
      err: sig.err,
      kind: "spend",
      mint,
      amount,
      recipient,
      memo,
      programs: [...programs],
      budgetIx: null,
    };
  }

  // Iter-9: no SPL transfer matched — try to surface the `aeqi_budget`
  // instruction name (freeze, unfreeze, …) so the operator gets a typed
  // label instead of "On-chain call".
  const budgetIx = decodeBudgetIxName(budgetPda, allInstructions, accountKeys);
  if (budgetIx) {
    return {
      signature: sig.signature,
      blockTime: sig.blockTime,
      slot: sig.slot,
      err: sig.err,
      kind: "budget-ix",
      mint: null,
      amount: null,
      recipient: null,
      memo,
      programs: [...programs],
      budgetIx,
    };
  }

  return {
    signature: sig.signature,
    blockTime: sig.blockTime,
    slot: sig.slot,
    err: sig.err,
    kind: "other",
    mint: null,
    amount: null,
    recipient: null,
    memo,
    programs: [...programs],
    budgetIx: null,
  };
}

export interface UseDecodedBudgetSpendResult {
  rows: DecodedBudgetSpend[];
  isLoading: boolean;
  hasAny: boolean;
}

export function useDecodedBudgetSpend(
  budgetPda: string | null,
  signatures: VaultSignature[],
  limit: number = DECODE_LIMIT,
): UseDecodedBudgetSpendResult {
  const targetSigs = useMemo(() => signatures.slice(0, limit), [signatures, limit]);
  const directRpcEnabled = isDirectSolanaRpcEnabled();

  const queries = useQueries({
    queries: targetSigs.map((sig) => ({
      queryKey: ["assets", "budget-spend-decoded", budgetPda, sig.signature],
      queryFn: async (): Promise<DecodedBudgetSpend> => {
        const conn = getConnection();
        if (!budgetPda) {
          return {
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
            err: sig.err,
            kind: "other",
            mint: null,
            amount: null,
            recipient: null,
            memo: null,
            programs: [],
            budgetIx: null,
          };
        }
        new PublicKey(budgetPda);
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
              mint: null,
              amount: null,
              recipient: null,
              memo: null,
              programs: [],
              budgetIx: null,
            };
          }
          return decodeParsedSpend(parsed, sig, budgetPda);
        } catch {
          return {
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
            err: sig.err,
            kind: "other",
            mint: null,
            amount: null,
            recipient: null,
            memo: null,
            programs: [],
            budgetIx: null,
          };
        }
      },
      enabled: directRpcEnabled && !!budgetPda && targetSigs.length > 0,
      staleTime: STALE_TIME_MS,
    })),
  });

  const rows = useMemo<DecodedBudgetSpend[]>(() => {
    const out: DecodedBudgetSpend[] = [];
    for (let i = 0; i < targetSigs.length; i += 1) {
      const q = queries[i];
      if (q?.data) out.push(q.data);
    }
    return out;
  }, [queries, targetSigs]);

  const isLoading = queries.some((q) => q.isLoading);
  return { rows, isLoading, hasAny: rows.length > 0 };
}
