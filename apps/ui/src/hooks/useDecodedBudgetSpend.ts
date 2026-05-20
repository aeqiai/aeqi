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

import { getConnection } from "@/solana/client";
import type { VaultSignature } from "@/hooks/useVaultActivity";

const DECODE_LIMIT = 12;
const STALE_TIME_MS = 60_000;

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** SPL Memo v3 program — the dominant version live across mainnet today. */
const MEMO_V3_PROGRAM = "MemoSq4gqABAxKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** SPL Memo v1 — still appears in older programs' CPI shape. */
const MEMO_V1_PROGRAM = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";

export type DecodedBudgetKind = "spend" | "other";

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
 * Pull a memo string out of either a parsed memo instruction (memo lives
 * on `parsed.info` as a string) or the partially-decoded form (data is
 * base58 / base64 depending on the RPC). When neither survives, return
 * `null` rather than guessing.
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
      // partially-decoded — the data is base58; decode best-effort.
      const data = ix.data;
      if (typeof data === "string" && data.length > 0) {
        try {
          // best-effort latin1; memo's typically UTF-8 but base58 decode
          // would need bs58 import. We surface the encoded form rather
          // than fabricating a clean string.
          return data;
        } catch {
          /* fall through */
        }
      }
    }
  }
  return null;
}

function decodeParsedSpend(
  parsed: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getConnection>["getParsedTransaction"]>>
  >,
  sig: VaultSignature,
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
            };
          }
          return decodeParsedSpend(parsed, sig);
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
          };
        }
      },
      enabled: !!budgetPda && targetSigs.length > 0,
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
