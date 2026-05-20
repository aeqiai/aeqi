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

import { useDecodedBudgetSpend } from "@/hooks/useDecodedBudgetSpend";
import type { DecodedBudgetSpend } from "@/hooks/useDecodedBudgetSpend";
import { useVaultActivity } from "@/hooks/useVaultActivity";
import type { BudgetAccountWithPda } from "@/solana/assets";
import { formatDateTime, formatInteger, formatNumber } from "@/lib/i18n";
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
        <BudgetSpendTable budgetPda={budget.publicKey.toBase58()} metas={metas} />
        <p className={styles.modalFooterNote}>
          Decoded from each signature&apos;s parsed transaction (top SPL transfer + adjacent SPL
          Memo instruction). Rows that didn&apos;t move tokens — freeze, allocate-child, policy
          updates — render as &ldquo;On-chain call&rdquo; with their signature deep-link intact.
        </p>
      </Stack>
    </Modal>
  );
}

/**
 * Decoded spend table for the Budget PDA. Iter-5 closes the gap that
 * `BudgetSignatureTail` left raw: we now fetch parsed transactions for
 * the leading signatures and surface recipient + amount + memo when
 * the tx contained an SPL transfer. Rows that didn't move tokens
 * collapse to "On-chain call" with the signature link still functional.
 *
 * Both data sources are the same `useVaultActivity` against the Budget
 * PDA + `useDecodedBudgetSpend` for the top 12 sigs. Capped at 8
 * visible rows so the modal stays readable; "Showing N of M" footer is
 * honest about truncation.
 */
function BudgetSpendTable({ budgetPda, metas }: { budgetPda: string; metas: TokenMetaMap }) {
  const VISIBLE = 8;
  const { data, isLoading: sigLoading } = useVaultActivity(budgetPda, { windowDays: 30 });
  const signatures = data?.signatures ?? [];
  const { rows: decoded, isLoading: decodedLoading } = useDecodedBudgetSpend(budgetPda, signatures);
  const decodedByKey = new Map<string, DecodedBudgetSpend>();
  for (const d of decoded) decodedByKey.set(d.signature, d);

  const visible = signatures.slice(0, VISIBLE);
  const decimals = budgetDecimals(metas);

  if (sigLoading) {
    return <Loading variant="section" label="Scanning budget signature tail" />;
  }
  if (visible.length === 0) {
    return (
      <DetailField label="Recent spend">
        <span className={styles.modalDetailNote}>
          No on-chain signatures yet. Once a spend or allocate-child instruction lands the signature
          shows up here.
        </span>
      </DetailField>
    );
  }
  const hidden = signatures.length - visible.length;
  const decodedCount = decoded.filter((d) => d.kind === "spend").length;
  return (
    <DetailField
      label={`Recent spend (${formatInteger(visible.length)}${hidden > 0 ? ` of ${formatInteger(signatures.length)}` : ""}${decodedCount > 0 ? ` · ${formatInteger(decodedCount)} decoded` : ""})`}
    >
      <ul className={styles.budgetSpendList}>
        {visible.map((sig) => {
          const row = decodedByKey.get(sig.signature);
          const isSpend = row?.kind === "spend";
          const decoding = decodedLoading && !row;
          return (
            <li key={sig.signature} className={styles.budgetSpendItem}>
              <div className={styles.budgetSpendHead}>
                <span className={styles.budgetSpendWhen}>
                  {sig.blockTime !== null ? formatDateTime(new Date(sig.blockTime * 1000)) : "—"}
                </span>
                {isSpend && row?.amount !== null && row?.amount !== undefined ? (
                  <span className={styles.budgetSpendAmount}>
                    {formatTokenAmount(row.amount, decimals)} USDC
                  </span>
                ) : decoding ? (
                  <Badge variant="muted" size="sm" dot>
                    Decoding…
                  </Badge>
                ) : (
                  <Badge variant="neutral" size="sm" dot>
                    On-chain call
                  </Badge>
                )}
                {sig.err !== null && (
                  <Badge variant="error" size="sm" dot>
                    Failed
                  </Badge>
                )}
              </div>
              {isSpend && (
                <div className={styles.budgetSpendBody}>
                  {row?.recipient ? (
                    <span className={styles.budgetSpendField}>
                      <span className={styles.budgetSpendFieldLabel}>To</span>
                      <CopyableMono
                        full={row.recipient}
                        display={shortAddress(row.recipient)}
                        tone="muted"
                        withExplorer
                      />
                    </span>
                  ) : null}
                  {row?.memo && (
                    <span className={styles.budgetSpendField}>
                      <span className={styles.budgetSpendFieldLabel}>Memo</span>
                      <span className={styles.budgetSpendMemo}>{row.memo}</span>
                    </span>
                  )}
                </div>
              )}
              <a
                href={explorerTxUrl(sig.signature)}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.budgetSpendLink}
                aria-label={`Open transaction ${sig.signature} in Solana explorer`}
              >
                <span className={styles.monoCell}>{shortAddress(sig.signature)}</span>
                <Icon icon={ExternalLink} size="xs" />
              </a>
            </li>
          );
        })}
      </ul>
    </DetailField>
  );
}
