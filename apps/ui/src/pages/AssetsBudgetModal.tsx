/**
 * Budget detail modal + its on-chain signature tail, extracted from
 * `AssetsSections.tsx` to keep each file under the 600-line ceiling.
 *
 * The modal is the side-panel surface a user gets after clicking a row
 * in the Active budgets table — it exposes the data the compact table
 * compressed (full IDs, parent chaining, raw spend) and surfaces the
 * recent on-chain signature tail against the Budget PDA.
 *
 * Signatures are read via `useVaultActivity(budgetPda)` — same hook,
 * different PDA. Every Budget mutation (spend, freeze, allocate-child,
 * policy update) writes to the Budget account so signatures against
 * the PDA enumerate the budget's lifecycle without an indexer.
 */
import { ExternalLink } from "lucide-react";

import { useVaultActivity } from "@/hooks/useVaultActivity";
import type { BudgetAccountWithPda } from "@/solana/assets";
import { formatDateTime, formatNumber } from "@/lib/i18n";
import { explorerTxUrl } from "@/lib/solana-explorer";
import { Badge, DetailField, Icon, Loading, Modal, Stack } from "@/components/ui";

import {
  CopyableMono,
  ExpiryCell,
  budgetDecimals,
  bytesIdLabel,
  bytesToHex,
  formatTokenAmount,
  shortAddress,
  toBigInt,
  type TokenMetaMap,
} from "./AssetsSections";
import styles from "./AssetsPage.module.css";

/**
 * Side-panel-style modal that exposes the full Budget record. Iter-2
 * surfaces the data the table compresses: full PDA + explorer link,
 * full budget/role IDs (the table renders pad32 ASCII prefix only),
 * grantor + parent budget chaining, raw spend numbers, and the
 * lifecycle posture (frozen / expiry). Iter-3 adds the on-chain
 * signature tail against the Budget PDA — see `BudgetSignatureTail`.
 */
export function BudgetDetailModal({
  budget,
  metas,
  onClose,
}: {
  budget: BudgetAccountWithPda | null;
  metas: TokenMetaMap;
  onClose: () => void;
}) {
  if (!budget) {
    return <Modal open={false} onClose={onClose} title="Budget" children={null} />;
  }
  const acc = budget.account;
  const decimals = budgetDecimals(metas);
  // BN is the on-chain numeric (Anchor maps `u64` → bn.js); convert
  // through string into the bigint our formatter expects so we don't
  // bleed BN's runtime arithmetic into the type surface.
  const amountBI = toBigInt(acc.amount);
  const spentBI = toBigInt(acc.spent);
  const spentFmt = formatTokenAmount(spentBI, decimals);
  const totalFmt = formatTokenAmount(amountBI, decimals);
  const remainingRaw = amountBI - spentBI;
  const remaining = remainingRaw > BigInt(0) ? remainingRaw : BigInt(0);
  const remainingFmt = formatTokenAmount(remaining, decimals);
  const pct = amountBI > BigInt(0) ? Number((spentBI * BigInt(10000)) / amountBI) / 100 : 0;
  const idLabel = bytesIdLabel(acc.budgetId);
  const idHex = `0x${bytesToHex(acc.budgetId)}`;
  const roleLabel = bytesIdLabel(acc.targetRoleId);
  const parentHex = `0x${bytesToHex(acc.parentBudgetId)}`;
  const parentBytes =
    acc.parentBudgetId instanceof Uint8Array
      ? acc.parentBudgetId
      : Uint8Array.from(acc.parentBudgetId);
  const hasParent = Array.from(parentBytes).some((b) => b !== 0);

  return (
    <Modal open={true} onClose={onClose} title={`Budget · ${idLabel}`}>
      <Stack gap="4">
        <DetailField label="Budget ID">
          <CopyableMono full={idHex} display={idLabel} mode="short" />
        </DetailField>
        <DetailField label="Target role">
          <span className={styles.monoCell}>{roleLabel}</span>
        </DetailField>
        {hasParent && (
          <DetailField label="Parent budget">
            <CopyableMono full={parentHex} display={`${parentHex.slice(0, 14)}…`} mode="short" />
          </DetailField>
        )}
        <DetailField label="Budget PDA">
          <CopyableMono
            full={budget.publicKey.toBase58()}
            display={shortAddress(budget.publicKey.toBase58())}
            withExplorer
          />
        </DetailField>
        <DetailField label="Grantor">
          <CopyableMono
            full={acc.grantor.toBase58()}
            display={shortAddress(acc.grantor.toBase58())}
            withExplorer
          />
        </DetailField>
        <DetailField label="Allocation">
          <Stack gap="1">
            <span className={styles.numCell}>
              {spentFmt} / {totalFmt} USDC ·{" "}
              <span className={styles.mutedLabel}>
                {formatNumber(pct, { maximumFractionDigits: 1 })}%
              </span>
            </span>
            <span className={styles.modalDetailNote}>{remainingFmt} USDC remaining</span>
          </Stack>
        </DetailField>
        <DetailField label="Expiry">
          <ExpiryCell expiry={Number(acc.expiry)} />
        </DetailField>
        <DetailField label="Status">
          {acc.frozen ? (
            <Badge variant="warning" dot>
              Frozen
            </Badge>
          ) : (
            <Badge variant="success" dot>
              Active
            </Badge>
          )}
        </DetailField>
        <BudgetSignatureTail budgetPda={budget.publicKey.toBase58()} />
        <p className={styles.modalFooterNote}>
          The list above shows raw on-chain signatures that touched the Budget PDA — every
          BudgetSpent / RecordSpend / Freeze updates the account. Decoding signatures into typed
          spend rows (amount + destination + memo) needs the indexer rail to land.
        </p>
      </Stack>
    </Modal>
  );
}

/**
 * On-chain signature tail for the Budget PDA — iter-3's honest answer
 * to "show me what's happened on this budget" while the per-event
 * indexer rail is still pending.
 *
 * Reuses `useVaultActivity` against the Budget PDA — same shape works
 * for any PDA. Capped at 8 rows so the modal doesn't grow tall on
 * busy budgets; "Showing N of M" footer is honest about truncation.
 */
function BudgetSignatureTail({ budgetPda }: { budgetPda: string }) {
  const VISIBLE = 8;
  const { data, isLoading } = useVaultActivity(budgetPda, { windowDays: 30 });
  const signatures = data?.signatures ?? [];
  const rows = signatures.slice(0, VISIBLE);

  if (isLoading) {
    return <Loading variant="section" label="Scanning budget signature tail" />;
  }
  if (rows.length === 0) {
    return (
      <DetailField label="Recent on-chain activity">
        <span className={styles.modalDetailNote}>
          No on-chain signatures yet. Once a spend or allocate-child instruction lands the signature
          shows up here.
        </span>
      </DetailField>
    );
  }
  const hidden = signatures.length - rows.length;
  return (
    <DetailField
      label={`Recent on-chain activity (${rows.length}${hidden > 0 ? ` of ${signatures.length}` : ""})`}
    >
      <ul className={styles.budgetSignatureList}>
        {rows.map((sig) => (
          <li key={sig.signature} className={styles.budgetSignatureItem}>
            <span className={styles.budgetSignatureWhen}>
              {sig.blockTime !== null ? formatDateTime(new Date(sig.blockTime * 1000)) : "—"}
            </span>
            <a
              href={explorerTxUrl(sig.signature)}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.budgetSignatureLink}
              aria-label={`Open transaction ${sig.signature} in Solana explorer`}
            >
              <span className={styles.monoCell}>{shortAddress(sig.signature)}</span>
              <Icon icon={ExternalLink} size="xs" />
            </a>
            {sig.err !== null && (
              <Badge variant="error" size="sm" dot>
                Failed
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </DetailField>
  );
}
