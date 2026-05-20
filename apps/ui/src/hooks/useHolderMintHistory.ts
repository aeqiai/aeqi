/**
 * `useHolderMintHistory` — iter-8 functional gap: per-holder on-chain
 * inflow history for the cap-table HolderDrawer.
 *
 * Iter-7 left the drawer with a `Recent curve activity` stream (filtered
 * from the page-wide `useCurveTrades` projection) but every other
 * deposit-shaped event was invisible: the operator who minted 100k
 * LAUNCH from share controls or accepted a transfer from another holder
 * had no record visible inside the drawer. Iter-8 closes that gap by
 * scanning `getSignaturesForAddress(holder.token_account)` and decoding
 * SPL/Token-2022 `mintTo[Checked]` + `transfer[Checked]` instructions
 * whose destination matches the inspected ATA.
 *
 * RPC cost: 1 `getSignaturesForAddress` + N × `getParsedTransaction`
 * where N is bounded by `DECODE_LIMIT`. We use React Query so navigating
 * back to the drawer pays for a warm cache. The hook is `enabled` only
 * when the drawer has a holder mounted, so closing the drawer also
 * drops the spinner without trashing the cache.
 *
 * Honest scope: this is the holder's TOKEN-ACCOUNT history, not the
 * holder's wallet history. Internal AEQI flows (curve buy minting to the
 * holder, vesting claim transfer, share-controls mint) all touch the
 * ATA and show up here. Off-chain bookkeeping (sub-accounts, EOA-only
 * sends that never reached this ATA) cannot — that's an indexer rail's
 * job. We surface `kind` honestly: `mint` for fresh issuance, `transfer-in`
 * for inbound transfers, `other` for txns we couldn't pattern-match.
 *
 * Soft-fails: RPC failure collapses to an empty rows array rather than
 * blocking the drawer. The drawer renders an empty state in that case;
 * the operator still has the curve-activity stream and quick actions.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";

import { getConnection } from "@/solana/client";

const SIGNATURE_LIMIT = 50;
/** Hard cap on parsed-tx decodes. Keeps the worst-case drawer open
 *  under a second on a localnet RPC and bounded on hosted clusters. */
const DECODE_LIMIT = 12;
const STALE_TIME_MS = 60_000;

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type MintHistoryKind = "mint" | "transfer-in" | "other";

export interface MintHistoryRow {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: ConfirmedSignatureInfo["err"];
  kind: MintHistoryKind;
  /** Raw token base units. Null when we couldn't pattern-match the inflow. */
  amount: bigint | null;
  /** Source-owner of a transfer-in (null on direct mints). */
  source: string | null;
}

export interface UseHolderMintHistoryResult {
  rows: MintHistoryRow[];
  /** True while the leading `getSignaturesForAddress` is in flight. */
  isLoading: boolean;
  /** True when at least one decode has settled — partial coverage is
   *  surfaced rather than blocked. */
  hasAny: boolean;
  /** True after the signature fetch returned an empty tail (no history
   *  ever touched this ATA on the configured cluster). */
  isEmpty: boolean;
}

interface ParsedTransferInfo {
  source?: string;
  destination?: string;
  authority?: string;
  multisigAuthority?: string;
  account?: string;
  mint?: string;
  amount?: string;
  tokenAmount?: { amount: string };
}

function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

/**
 * Resolve `ata → owner` for transfer source attribution. Token balance
 * snapshots carry the owner directly; we only need them for the source
 * side of a transferChecked since the destination is by definition the
 * inspected holder's ATA.
 */
function buildOwnerResolver(
  preBalances: Array<{ accountIndex: number; owner?: string }> | undefined,
  postBalances: Array<{ accountIndex: number; owner?: string }> | undefined,
  accountKeys: string[],
): (ata: string) => string | null {
  const ownerByAta = new Map<string, string>();
  for (const bal of [...(preBalances ?? []), ...(postBalances ?? [])]) {
    const ata = accountKeys[bal.accountIndex];
    if (!ata) continue;
    if (bal.owner) ownerByAta.set(ata, bal.owner);
  }
  return (ata: string) => ownerByAta.get(ata) ?? null;
}

function tryBigInt(value: string | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function decodeForAta(
  targetAta: string,
  parsed: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getConnection>["getParsedTransaction"]>>
  >,
  sig: {
    signature: string;
    blockTime: number | null;
    slot: number;
    err: ConfirmedSignatureInfo["err"];
  },
): MintHistoryRow {
  const message = parsed.transaction.message;
  const accountKeys = message.accountKeys.map((a) => a.pubkey.toBase58());
  const ownerOf = buildOwnerResolver(
    parsed.meta?.preTokenBalances ?? undefined,
    parsed.meta?.postTokenBalances ?? undefined,
    accountKeys,
  );

  const allInstructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...message.instructions,
  ];
  for (const set of parsed.meta?.innerInstructions ?? []) {
    for (const ix of set.instructions) {
      allInstructions.push(ix);
    }
  }

  for (const ix of allInstructions) {
    if (!isParsedInstruction(ix)) continue;
    const pid = ix.programId.toBase58();
    if (pid !== SPL_TOKEN_PROGRAM && pid !== SPL_TOKEN_2022_PROGRAM) continue;
    const parsedIx = ix.parsed;
    if (typeof parsedIx !== "object" || parsedIx === null) continue;
    const type = (parsedIx as { type?: string }).type;
    const info = (parsedIx as { info: ParsedTransferInfo }).info;

    // mintTo / mintToChecked — the destination ATA is `info.account`.
    if (type === "mintTo" || type === "mintToChecked") {
      if (info.account === targetAta) {
        const amount = tryBigInt(info.tokenAmount?.amount ?? info.amount);
        return {
          signature: sig.signature,
          blockTime: sig.blockTime,
          slot: sig.slot,
          err: sig.err,
          kind: "mint",
          amount,
          source: null,
        };
      }
      continue;
    }

    // transfer / transferChecked — destination is `info.destination`.
    if (type === "transfer" || type === "transferChecked") {
      if (info.destination !== targetAta) continue;
      const amount = tryBigInt(info.tokenAmount?.amount ?? info.amount);
      const sourceAta = info.source ?? "";
      const sourceOwner = sourceAta ? ownerOf(sourceAta) : null;
      return {
        signature: sig.signature,
        blockTime: sig.blockTime,
        slot: sig.slot,
        err: sig.err,
        kind: "transfer-in",
        amount,
        source: sourceOwner ?? info.authority ?? null,
      };
    }
  }

  return {
    signature: sig.signature,
    blockTime: sig.blockTime,
    slot: sig.slot,
    err: sig.err,
    kind: "other",
    amount: null,
    source: null,
  };
}

/**
 * Fetch the inflow history for a single token-account ATA. `null` /
 * empty `tokenAccount` shuts the hook off cleanly so the consumer can
 * pass `holder?.tokenAccount.toBase58() ?? null` directly.
 */
export function useHolderMintHistory(tokenAccount: string | null): UseHolderMintHistoryResult {
  const enabled = !!tokenAccount;

  const sigQuery = useQuery({
    queryKey: ["equity", "holder-mint-history", "sigs", tokenAccount ?? null],
    queryFn: async () => {
      if (!tokenAccount) return [] as ConfirmedSignatureInfo[];
      try {
        const conn = getConnection();
        const pk = new PublicKey(tokenAccount);
        return await conn.getSignaturesForAddress(pk, { limit: SIGNATURE_LIMIT });
      } catch {
        return [] as ConfirmedSignatureInfo[];
      }
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const targetSigs = useMemo(() => {
    return (sigQuery.data ?? []).slice(0, DECODE_LIMIT);
  }, [sigQuery.data]);

  const decoded = useQueries({
    queries: targetSigs.map((sig) => ({
      queryKey: ["equity", "holder-mint-history", "decoded", sig.signature],
      queryFn: async (): Promise<MintHistoryRow | null> => {
        if (!tokenAccount) return null;
        try {
          const conn = getConnection();
          const parsed = await conn.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          });
          if (!parsed) return null;
          return decodeForAta(tokenAccount, parsed, {
            signature: sig.signature,
            blockTime: sig.blockTime ?? null,
            slot: sig.slot,
            err: sig.err,
          });
        } catch {
          return null;
        }
      },
      enabled: !!tokenAccount,
      staleTime: STALE_TIME_MS,
    })),
  });

  const rows = useMemo<MintHistoryRow[]>(() => {
    const out: MintHistoryRow[] = [];
    for (const q of decoded) {
      if (q.data && (q.data.kind === "mint" || q.data.kind === "transfer-in")) {
        out.push(q.data);
      }
    }
    return out;
  }, [decoded]);

  const isLoading = enabled && (sigQuery.isLoading || decoded.some((q) => q.isLoading));
  const hasAny = rows.length > 0;
  const isEmpty = !isLoading && (sigQuery.data?.length ?? 0) === 0;

  return { rows, isLoading, hasAny, isEmpty };
}
