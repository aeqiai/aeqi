/**
 * Iter-10 — vault snapshot export.
 *
 * Folds the on-chain state behind the Assets page into a single JSON
 * blob a CFO / auditor can download for off-platform record-keeping.
 * Every field maps to an on-chain account we already fetched for the
 * surface, so the snapshot is byte-for-byte the same data the operator
 * sees rendered — no derived gymnastics, no hidden RPC round trips.
 *
 * The "USD valuation" block is the same permissive par-summation the
 * TreasuryOverviewSection uses for the headline tile: stablecoin
 * holdings sum at par, unknown mints contribute zero. We label that
 * scope explicitly in `valuation.method` so a downstream consumer
 * doesn't mistake it for an oracle read.
 *
 * Honest scope:
 *  - The signatures block is capped at whatever `useVaultActivity`
 *    returned (≤ 1000 by hook). Anything older lives in the explorer.
 *  - Decoded vault activity is union-typed in the hook (deposit /
 *    withdraw / internal / sol-* / other) — we surface the decoded
 *    record verbatim so the consumer can filter on `kind`.
 *  - `bigint` and `BN` values are stringified to keep the JSON
 *    portable (a 64-bit balance won't round-trip cleanly as a JSON
 *    number once it exceeds 2^53 - 1).
 */
import type { DecodedActivity } from "@/hooks/useDecodedVaultActivity";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import type { VaultSignature } from "@/hooks/useVaultActivity";
import type { BudgetAccountWithPda, VaultHolding, VestingPositionWithPda } from "@/solana/assets";
import type { ModuleAccountWithPda, RoleAccountWithPda } from "@/solana";
import type { Trust } from "@/lib/types";

import { bytesToHex, isStableSymbol, rawToFloat, toBigInt } from "./AssetsSections";

export interface VaultSnapshotInput {
  entity: Trust | undefined;
  trustAddress: string;
  vault: {
    moduleStatePda: string;
    vaultAuthorityPda: string;
    moduleInitialized: boolean;
    treasuryAuthority: string | null;
  };
  holdings: VaultHolding[];
  budgets: BudgetAccountWithPda[];
  vestingPositions: VestingPositionWithPda[];
  modules: ModuleAccountWithPda[] | undefined;
  roles: RoleAccountWithPda[] | undefined;
  signatures: VaultSignature[];
  decodedActivity: DecodedActivity[];
  metas: Record<string, ResolvedTokenMeta>;
}

/**
 * Build the snapshot JSON object — a plain dictionary with no class
 * instances, BN handles, or PublicKey wrappers. Safe to pass through
 * `JSON.stringify` directly.
 */
export function buildVaultSnapshot(input: VaultSnapshotInput): Record<string, unknown> {
  const {
    entity,
    trustAddress,
    vault,
    holdings,
    budgets,
    vestingPositions,
    modules,
    roles,
    signatures,
    decodedActivity,
    metas,
  } = input;

  // USD valuation — par-summation across registered stablecoins. The
  // TreasuryOverviewSection uses the same rule for its headline tile,
  // so the snapshot's `stablecoin_usd` matches what the operator just
  // read off-screen.
  let stablecoinUsd = 0;
  for (const h of holdings) {
    const meta = metas[h.mint.toBase58()];
    if (meta?.symbol && isStableSymbol(meta.symbol) && meta.decimals !== null) {
      stablecoinUsd += rawToFloat(h.amount, meta.decimals);
    }
  }

  return {
    schema_version: "1",
    generated_at: new Date().toISOString(),
    entity: entity
      ? {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          trust_id: entity.trust_id ?? null,
        }
      : null,
    trust: {
      address: trustAddress,
      module_state_pda: vault.moduleStatePda,
      vault_authority_pda: vault.vaultAuthorityPda,
      module_initialized: vault.moduleInitialized,
      treasury_authority: vault.treasuryAuthority,
    },
    valuation: {
      method: "stablecoin-par",
      stablecoin_usd: stablecoinUsd,
      holding_count: holdings.length,
      nonzero_holding_count: holdings.filter((h) => h.amount > 0n).length,
    },
    holdings: holdings.map((h) => {
      const mintKey = h.mint.toBase58();
      const meta = metas[mintKey];
      return {
        mint: mintKey,
        token_account: h.tokenAccount.toBase58(),
        symbol: meta?.symbol ?? null,
        decimals: meta?.decimals ?? null,
        amount_raw: h.amount.toString(),
        usd_at_par:
          meta?.symbol && isStableSymbol(meta.symbol) && meta.decimals !== null
            ? rawToFloat(h.amount, meta.decimals)
            : null,
      };
    }),
    budgets: budgets.map((b) => {
      const acc = b.account;
      const amount = toBigInt(acc.amount);
      const spent = toBigInt(acc.spent);
      const remaining = amount > spent ? amount - spent : 0n;
      const parentHex = bytesToHex(acc.parentBudgetId);
      return {
        budget_pda: b.publicKey.toBase58(),
        budget_id_hex: `0x${bytesToHex(acc.budgetId)}`,
        target_role_id_hex: `0x${bytesToHex(acc.targetRoleId)}`,
        parent_budget_id_hex: parentHex.match(/[^0]/) ? `0x${parentHex}` : null,
        grantor: acc.grantor.toBase58(),
        amount_raw: amount.toString(),
        spent_raw: spent.toString(),
        remaining_raw: remaining.toString(),
        expiry_unix: Number(acc.expiry),
        frozen: !!acc.frozen,
      };
    }),
    vesting: vestingPositions.map((v) => {
      const acc = v.account;
      return {
        position_pda: v.publicKey.toBase58(),
        position_id_hex: `0x${bytesToHex(acc.positionId)}`,
        recipient: acc.recipient.toBase58(),
        mint: acc.mint.toBase58(),
        grantor: acc.grantor.toBase58(),
        total_amount_raw: toBigInt(acc.totalAmount).toString(),
        claimed_amount_raw: toBigInt(acc.claimedAmount).toString(),
        start_time_unix: Number(acc.startTime),
        cliff_time_unix: Number(acc.cliffTime),
        end_time_unix: Number(acc.endTime),
      };
    }),
    modules: (modules ?? []).map((m) => ({
      module_pda: m.publicKey.toBase58(),
      module_id_hex: `0x${bytesToHex(m.account.moduleId)}`,
      program_id: m.account.programId.toBase58(),
      implementation_version: m.account.implementationVersion.toString(),
      initialized: !!m.account.initialized,
    })),
    roles: (roles ?? []).map((r) => ({
      role_pda: r.publicKey.toBase58(),
      role_id_hex: `0x${bytesToHex(r.account.roleId)}`,
      role_type_id_hex: `0x${bytesToHex(r.account.roleTypeId)}`,
      occupant: r.account.account.toBase58(),
      status: r.account.status,
    })),
    activity: signatures.map((sig) => {
      const decoded = decodedActivity.find((d) => d.signature === sig.signature) ?? null;
      return {
        signature: sig.signature,
        slot: sig.slot,
        block_time_unix: sig.blockTime,
        confirmed: sig.err === null,
        decoded: decoded
          ? {
              kind: decoded.kind,
              counterparty: decoded.counterparty,
              mint: decoded.mint,
              amount_raw: decoded.amount !== null ? decoded.amount.toString() : null,
              programs: decoded.programs,
            }
          : null,
      };
    }),
  };
}

/**
 * Convenience: build the snapshot and trigger a browser download.
 * Returns the generated filename for the host to surface in a toast /
 * confirmation strip if it wants.
 */
export function downloadVaultSnapshot(
  input: VaultSnapshotInput,
  filenameHint?: string,
): { filename: string; bytes: number } {
  const snapshot = buildVaultSnapshot(input);
  const body = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // Filename: `<entity-slug>-vault-snapshot-<yyyymmdd-hhmm>.json`.
  // We don't try to be clever about timezone — `Date()` formats are
  // local-time which is what an operator scanning their Downloads
  // folder will reason about.
  const now = new Date();
  const stamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0");
  const slug = (filenameHint ?? "trust")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const filename = `${slug || "trust"}-vault-snapshot-${stamp}.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the blob URL — the click already triggered the download, the
  // URL object is no longer needed.
  URL.revokeObjectURL(url);

  return { filename, bytes: body.length };
}
