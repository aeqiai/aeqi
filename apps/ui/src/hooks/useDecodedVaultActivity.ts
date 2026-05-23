/**
 * `useDecodedVaultActivity` — fetch parsed transactions for the top-N
 * signatures touching the vault authority PDA and classify each as a
 * Deposit / Withdraw / Other against the TRUST.
 *
 * Iter-4 closes the gap left by `useVaultActivity`: that hook surfaces
 * raw signatures and an explorer deep-link, which is honest but flat.
 * Once we fetch `getParsedTransaction` per signature we can pattern-match
 * SPL transfer instructions and the SOL pre/post balance delta to
 * answer "did 200 USDC just land in the vault, from whom?" without
 * standing up the per-event indexer rail.
 *
 * Decoding scope:
 *   - SPL `transfer` / `transferChecked` instructions on Token + Token-2022
 *     programs against any ATA owned by the vault authority. Source ATA
 *     gives the counterparty (resolved to its owner via `parsed.info`).
 *   - System program lamport transfers to/from the vault authority (SOL
 *     deposits or withdrawals).
 *   - Everything else collapses to `kind: "other"` with the program names.
 *
 * The RPC cost is N × `getParsedTransaction`. We cap N at 12 so the
 * worst-case page load is bounded; the rest stay as raw signatures in
 * the existing `VaultActivitySection` table. React Query keys per-sig
 * so navigating back to the page hits warm cache.
 *
 * Honest scope: the counterparty extracted from a parsed transfer is
 * the *source ATA's owner*, which is the user wallet for direct deposits
 * but the program-derived authority for inter-program flows (curve
 * payouts, budget spends). When the source owner equals the vault
 * authority itself we mark it as an internal transfer rather than a
 * deposit. Stablecoin-only USD valuation — we don't fake prices for
 * AEQI-issued mints.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  PublicKey,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";

import { getConnection, isDirectSolanaRpcEnabled } from "@/solana/client";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import type { VaultSignature } from "@/hooks/useVaultActivity";

/** How many leading signatures to fetch parsed metadata for. RPC cost
 *  scales linearly so we hold this conservative; users can still drill
 *  the rest through the explorer deep-link in the raw table. */
const DECODE_LIMIT = 12;
const STALE_TIME_MS = 60_000;

export type DecodedActivityKind =
  | "deposit"
  | "withdraw"
  | "internal"
  | "sol-deposit"
  | "sol-withdraw"
  | "other";

export interface DecodedActivity {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: VaultSignature["err"];
  kind: DecodedActivityKind;
  /** Token mint involved in the transfer (when kind is deposit/withdraw/internal). */
  mint: string | null;
  /** Raw token amount in base units. Null when the tx didn't touch the vault's ATA. */
  amount: bigint | null;
  /** Counterparty pubkey — source owner on deposits, destination owner on withdraws. */
  counterparty: string | null;
  /** Sentinel for the rare case where we got parsed instructions but
   *  none matched a recognised pattern. Carries the top-level program
   *  IDs so the row can render "called program X" honestly. */
  programs: string[];
}

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

interface ParsedTransferInfo {
  source: string;
  destination: string;
  amount?: string;
  authority?: string;
  multisigAuthority?: string;
  // transferChecked carries token amount under `tokenAmount`
  tokenAmount?: { amount: string };
  mint?: string;
}

function isParsedInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
): ix is ParsedInstruction {
  return "parsed" in ix;
}

/**
 * Resolve a token account address to its owner + mint by scanning the
 * transaction's `accountKeys` and any pre/post token balance snapshots.
 * The post-token-balances array is the cleanest source because each
 * entry contains `{accountIndex, mint, owner, uiTokenAmount}` already.
 */
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

function classifyTokenTransfer(
  vaultAuthority: string,
  info: ParsedTransferInfo,
  resolver: AtaResolver,
): {
  kind: DecodedActivityKind;
  mint: string | null;
  amount: bigint | null;
  counterparty: string | null;
} | null {
  const amountStr = info.tokenAmount?.amount ?? info.amount;
  if (!amountStr) return null;
  const amount = BigInt(amountStr);
  const sourceOwner = resolver.ownerOf(info.source) ?? info.authority ?? null;
  const destOwner = resolver.ownerOf(info.destination);
  const mint =
    info.mint ?? resolver.mintOf(info.destination) ?? resolver.mintOf(info.source) ?? null;

  const vaultIsDest = destOwner === vaultAuthority;
  const vaultIsSrc = sourceOwner === vaultAuthority;

  if (vaultIsDest && !vaultIsSrc) {
    return { kind: "deposit", mint, amount, counterparty: sourceOwner };
  }
  if (vaultIsSrc && !vaultIsDest) {
    return { kind: "withdraw", mint, amount, counterparty: destOwner };
  }
  if (vaultIsSrc && vaultIsDest) {
    return { kind: "internal", mint, amount, counterparty: null };
  }
  return null;
}

/**
 * SOL (lamport) transfer fallback — checked against the pre/post lamport
 * snapshots of the vault authority itself. The vault PDA appears in the
 * transaction's `accountKeys`; whichever index it sits at gets a
 * `preBalances[i]` and `postBalances[i]` we can diff.
 */
function classifyLamportDelta(
  vaultAuthority: string,
  accountKeys: string[],
  preBalances: number[] | undefined,
  postBalances: number[] | undefined,
): { kind: DecodedActivityKind; amount: bigint; counterparty: null } | null {
  if (!preBalances || !postBalances) return null;
  const idx = accountKeys.indexOf(vaultAuthority);
  if (idx === -1) return null;
  const pre = preBalances[idx];
  const post = postBalances[idx];
  if (pre === undefined || post === undefined || pre === post) return null;
  const delta = BigInt(post) - BigInt(pre);
  if (delta === 0n) return null;
  if (delta > 0n) {
    return { kind: "sol-deposit", amount: delta, counterparty: null };
  }
  return { kind: "sol-withdraw", amount: -delta, counterparty: null };
}

/**
 * Decode one parsed transaction against the vault authority. Walks the
 * top-level instructions plus any inner-instruction sets (CPI from
 * programs like the budget/vesting/curve), looking for the first SPL
 * transfer that involves an ATA owned by the vault authority.
 */
function decodeParsedTx(
  vaultAuthority: string,
  parsed: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getConnection>["getParsedTransaction"]>>
  >,
  sig: VaultSignature,
): DecodedActivity {
  const message = parsed.transaction.message;
  const accountKeys = message.accountKeys.map((a) => a.pubkey.toBase58());
  const programs = new Set<string>();
  for (const ix of message.instructions) {
    programs.add(ix.programId.toBase58());
  }

  const resolver = buildResolver(
    parsed.meta?.preTokenBalances ?? undefined,
    parsed.meta?.postTokenBalances ?? undefined,
    accountKeys,
  );

  // Flatten top-level + inner instructions; CPI'd transfers (budget
  // spend, curve payout, vesting claim) only appear in inner sets.
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
    if (type !== "transfer" && type !== "transferChecked") continue;
    const info = (parsedIx as { info: ParsedTransferInfo }).info;
    const classified = classifyTokenTransfer(vaultAuthority, info, resolver);
    if (classified) {
      return {
        signature: sig.signature,
        blockTime: sig.blockTime,
        slot: sig.slot,
        err: sig.err,
        kind: classified.kind,
        mint: classified.mint,
        amount: classified.amount,
        counterparty: classified.counterparty,
        programs: [...programs],
      };
    }
  }

  // No matching token transfer — fall back to SOL lamport delta. We do
  // the check unconditionally because the vault PDA can receive SOL
  // through a program CPI (not just the System program), so gating on
  // the System program ID would silently miss those flows.
  {
    const sol = classifyLamportDelta(
      vaultAuthority,
      accountKeys,
      parsed.meta?.preBalances,
      parsed.meta?.postBalances,
    );
    if (sol) {
      return {
        signature: sig.signature,
        blockTime: sig.blockTime,
        slot: sig.slot,
        err: sig.err,
        kind: sol.kind,
        mint: null,
        amount: sol.amount,
        counterparty: null,
        programs: [...programs],
      };
    }
  }

  return {
    signature: sig.signature,
    blockTime: sig.blockTime,
    slot: sig.slot,
    err: sig.err,
    kind: "other",
    mint: null,
    amount: null,
    counterparty: null,
    programs: [...programs],
  };
}

export interface UseDecodedVaultActivityResult {
  rows: DecodedActivity[];
  isLoading: boolean;
  /** True when at least one decode succeeded — even partial coverage is
   *  worth surfacing rather than blocking on a full-scan. */
  hasAny: boolean;
}

/**
 * Fetch parsed transactions for the leading `limit` signatures. Other
 * signatures stay in raw form (use the existing `VaultActivitySection`
 * table for the full tail).
 */
export function useDecodedVaultActivity(
  vaultAuthority: string | null,
  signatures: VaultSignature[],
  limit: number = DECODE_LIMIT,
): UseDecodedVaultActivityResult {
  const targetSigs = useMemo(() => signatures.slice(0, limit), [signatures, limit]);
  const directRpcEnabled = isDirectSolanaRpcEnabled();

  const queries = useQueries({
    queries: targetSigs.map((sig) => ({
      queryKey: ["assets", "vault-activity-decoded", sig.signature],
      queryFn: async (): Promise<DecodedActivity> => {
        const conn = getConnection();
        if (!vaultAuthority) {
          return {
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
            err: sig.err,
            kind: "other",
            mint: null,
            amount: null,
            counterparty: null,
            programs: [],
          };
        }
        // Sanity: PublicKey ctor throws on garbage; we control the input.
        new PublicKey(vaultAuthority);
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
              counterparty: null,
              programs: [],
            };
          }
          return decodeParsedTx(vaultAuthority, parsed, sig);
        } catch {
          return {
            signature: sig.signature,
            blockTime: sig.blockTime,
            slot: sig.slot,
            err: sig.err,
            kind: "other",
            mint: null,
            amount: null,
            counterparty: null,
            programs: [],
          };
        }
      },
      enabled: directRpcEnabled && !!vaultAuthority && targetSigs.length > 0,
      staleTime: STALE_TIME_MS,
    })),
  });

  const rows = useMemo<DecodedActivity[]>(() => {
    const out: DecodedActivity[] = [];
    for (let i = 0; i < targetSigs.length; i += 1) {
      const q = queries[i];
      if (q?.data) out.push(q.data);
    }
    return out;
  }, [queries, targetSigs]);

  const isLoading = queries.some((q) => q.isLoading);
  const hasAny = rows.length > 0;

  return { rows, isLoading, hasAny };
}

/** Pretty label for a decoded activity row. Stays honest about the
 *  counterparty resolution: a `null` counterparty becomes "(internal)" or
 *  "(unknown)" rather than fabricating a wallet. */
export function decodedActivityLabel(
  row: DecodedActivity,
  metas: Record<string, ResolvedTokenMeta>,
): { headline: string; tone: "deposit" | "withdraw" | "internal" | "other" } {
  if (row.kind === "deposit" || row.kind === "sol-deposit") {
    const symbol = row.kind === "sol-deposit" ? "SOL" : symbolFor(row.mint, metas);
    const amountText = formatDecoded(row.amount, row.mint, metas, row.kind === "sol-deposit");
    return {
      headline: `Deposit ${amountText} ${symbol}`,
      tone: "deposit",
    };
  }
  if (row.kind === "withdraw" || row.kind === "sol-withdraw") {
    const symbol = row.kind === "sol-withdraw" ? "SOL" : symbolFor(row.mint, metas);
    const amountText = formatDecoded(row.amount, row.mint, metas, row.kind === "sol-withdraw");
    return {
      headline: `Withdraw ${amountText} ${symbol}`,
      tone: "withdraw",
    };
  }
  if (row.kind === "internal") {
    return {
      headline: `Internal transfer ${formatDecoded(row.amount, row.mint, metas, false)} ${symbolFor(row.mint, metas)}`,
      tone: "internal",
    };
  }
  return { headline: "On-chain call", tone: "other" };
}

function symbolFor(mint: string | null, metas: Record<string, ResolvedTokenMeta>): string {
  if (!mint) return "SPL";
  return metas[mint]?.symbol ?? "SPL";
}

function formatDecoded(
  amount: bigint | null,
  mint: string | null,
  metas: Record<string, ResolvedTokenMeta>,
  isSol: boolean,
): string {
  if (amount === null) return "—";
  const decimals: number | null = isSol ? 9 : mint ? (metas[mint]?.decimals ?? null) : null;
  if (decimals === null || decimals === 0) return amount.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}
