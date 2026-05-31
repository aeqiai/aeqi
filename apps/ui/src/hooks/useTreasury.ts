import { useEffect, useRef, useState } from "react";

import { indexerEnabled } from "@/lib/indexer";
import { resolveSymbol } from "@/lib/tokenRegistry";

// ── Shape of a token holding ──────────────────────────────────────────────────

export interface TokenBalance {
  /** ERC-20 symbol inferred from address (indexer v1 returns address only). */
  symbol: string;
  /** Human-readable amount string (18-decimal formatted). */
  amount: string;
  /** Token contract address. */
  tokenAddress: string;
  /** Last-updated block number. */
  lastUpdatedBlock: number;
}

// ── Shape of a transfer ───────────────────────────────────────────────────────

export type TransferDirection = "in" | "out";

export interface TreasuryTransfer {
  direction: TransferDirection;
  /** Counter-party address (full, truncation is a display concern). */
  counterparty: string;
  /** Human-readable amount string. */
  amount: string;
  /** Block number the transfer was confirmed. */
  block: number;
}

// ── Hook result ───────────────────────────────────────────────────────────────

export interface TreasuryState {
  /** Null = loading; [] = loaded (empty or unavailable). */
  balances: TokenBalance[] | null;
  /** Null = loading; [] = loaded (empty or unavailable). */
  transfers: TreasuryTransfer[] | null;
  /** True only while the initial fetch is in-flight. */
  loading: boolean;
}

// Emitted at most once per mounted hook instance.
const WARN_KEY = "__useTreasury_warned__";

function isFieldNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // GraphQL "field not found" variants from common implementations.
  return /field.*not.*found|unknown field|cannot query field/i.test(msg);
}

/** Format a hex balance string with 18 decimals to a human-readable string. */
function formatHexBalance(hex: string): string {
  try {
    const raw = BigInt(hex);
    const whole = raw / BigInt(1e18);
    const frac = raw % BigInt(1e18);
    // Show up to 4 decimal places.
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4);
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return hex;
  }
}

/**
 * Fetches on-chain ERC-20 treasury balances + recent transfers for an entity's
 * COMPANY contract, using the indexer's `treasuryBalances(companyId)` field.
 *
 * Accepts `companyId` (bytes32 hex, e.g.
 * `"0x59bc9fd3956a4104aaf883253fde840c0000…"`) — the COMPANY's on-chain identity.
 *
 * Graceful-degrade: if the indexer doesn't have the treasury fields yet, the
 * hook silently returns [] and logs a one-time warning.
 */
export function useTreasury(companyId: string | undefined): TreasuryState {
  const [balances, setBalances] = useState<TokenBalance[] | null>(null);
  const [transfers, setTransfers] = useState<TreasuryTransfer[] | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    // Reset on identity change.
    setBalances(null);
    setTransfers(null);

    if (!companyId || !indexerEnabled()) {
      setBalances([]);
      setTransfers([]);
      return;
    }

    let cancelled = false;

    const warn = (msg: string) => {
      if (!warnedRef.current && !(globalThis as Record<string, unknown>)[WARN_KEY]) {
        console.warn(`[useTreasury] ${msg}`);
        warnedRef.current = true;
        (globalThis as Record<string, unknown>)[WARN_KEY] = true;
      }
    };

    (async () => {
      // ── ERC-20 balances via treasuryBalances(companyId) ─────────────────────
      let resolvedBalances: TokenBalance[] = [];
      try {
        const raw = await fetchTreasuryBalances(companyId);
        if (!cancelled) {
          resolvedBalances = raw.map((r) => ({
            symbol: resolveSymbol(r.tokenAddress),
            amount: formatHexBalance(r.balance),
            tokenAddress: r.tokenAddress,
            lastUpdatedBlock: r.lastUpdatedBlock,
          }));
        }
      } catch (err) {
        if (isFieldNotFoundError(err)) {
          warn("indexer treasuryBalances field missing");
        }
        // Leave resolvedBalances as [].
      }
      if (!cancelled) setBalances(resolvedBalances);

      // ── Recent transfers ──────────────────────────────────────────────────
      let resolvedTransfers: TreasuryTransfer[] = [];
      try {
        const data = await fetchTreasuryTransfers(companyId);
        if (!cancelled) resolvedTransfers = data;
      } catch (err) {
        if (isFieldNotFoundError(err)) {
          warn("indexer treasuryTransfers field missing");
        }
        // Leave resolvedTransfers as [].
      }
      if (!cancelled) setTransfers(resolvedTransfers);
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const loading = balances === null || transfers === null;
  return { balances, transfers, loading };
}

// ── Indexer helpers ───────────────────────────────────────────────────────────

interface RawTreasuryBalance {
  tokenAddress: string;
  balance: string;
  lastUpdatedBlock: number;
}

interface RawTransfer {
  direction: string;
  counterparty: string;
  amount: string;
  block: number;
}

const ENV_INDEXER_URL = import.meta.env.VITE_INDEXER_URL;
const INDEXER_URL: string | null =
  ENV_INDEXER_URL === undefined ? "/indexer/graphql" : (ENV_INDEXER_URL as string) || null;

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!INDEXER_URL) return null;
  const resp = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`indexer http ${resp.status}`);
  interface GqlResp {
    data?: T;
    errors?: { message: string }[];
  }
  const json = (await resp.json()) as GqlResp;
  if (json.errors && json.errors.length > 0) {
    throw new Error(`indexer graphql: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data ?? null;
}

async function fetchTreasuryBalances(companyId: string): Promise<RawTreasuryBalance[]> {
  if (!INDEXER_URL) return [];
  const data = await gql<{ treasuryBalances: RawTreasuryBalance[] }>(
    `query($id: String!) { treasuryBalances(companyId: $id) { tokenAddress balance lastUpdatedBlock } }`,
    { id: companyId },
  );
  return data?.treasuryBalances ?? [];
}

async function fetchTreasuryTransfers(companyId: string): Promise<TreasuryTransfer[]> {
  if (!INDEXER_URL) return [];
  const data = await gql<{ treasuryTransfers: RawTransfer[] }>(
    `query($id: String!, $limit: Int!) { treasuryTransfers(companyId: $id, limit: $limit) { direction counterparty amount block } }`,
    { id: companyId, limit: 20 },
  );
  return (data?.treasuryTransfers ?? []).map((r) => ({
    direction: (r.direction === "out" ? "out" : "in") as TransferDirection,
    counterparty: r.counterparty,
    amount: r.amount,
    block: r.block,
  }));
}
