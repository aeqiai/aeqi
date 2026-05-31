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
 *
 * Iter-10 — Approval chain walk-up.
 * When a budget has a non-zero `parent_budget_id`, the host now passes
 * down the full budget list + the COMPANY authority pubkey so we can
 * resolve the parent chain ("who can ultimately reclaim this
 * allocation?"). The chain renders as a calm vertical stack inside
 * the modal — top of chain = COMPANY authority, then each parent down
 * to this budget. Honors the "no hairlines" rule via tinted indent
 * rather than border-left stripes.
 */
export function BudgetDetailModal({
  budget,
  budgets,
  trustAuthority,
  metas,
  onClose,
}: {
  budget: BudgetAccountWithPda | null;
  /** Full budget list — used to walk the `parent_budget_id` chain so
   *  we can render a top-down "who controls this" hierarchy. */
  budgets?: BudgetAccountWithPda[];
  /** Company authority pubkey (base58) — the terminal node of the
   *  approval chain. Surfaced as "COMPANY authority" at the top of the
   *  chain so an auditor sees the chain bottoms out at the on-chain
   *  governance root, not in mid-air. */
  trustAuthority?: string | null;
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
  const parentBytes =
    acc.parentBudgetId instanceof Uint8Array
      ? acc.parentBudgetId
      : Uint8Array.from(acc.parentBudgetId);
  const hasParent = Array.from(parentBytes).some((b) => b !== 0);

  // Iter-10: walk the parent chain top-down. The chain starts at the
  // current budget and follows each `parent_budget_id` lookup until we
  // hit a budget with no parent (or an orphan). The terminal node is
  // the COMPANY authority — every chain bottoms out there.
  const chain = walkApprovalChain(budget, budgets ?? []);
  const orphan = hasParent && chain.length < 2;

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
          <DetailField label="Approval chain">
            <ApprovalChain chain={chain} trustAuthority={trustAuthority ?? null} orphan={orphan} />
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
          Memo instruction). Rows that didn&apos;t move tokens render their `aeqi_budget` IDL
          instruction name when the Anchor discriminator matches (freeze, unfreeze, create_budget,
          …); third-party CPI calls remain &ldquo;On-chain call&rdquo; with their explorer link
          intact.
        </p>
      </Stack>
    </Modal>
  );
}

/**
 * Iter-10 — walk the budget parent chain bottom-up, then reverse it
 * for top-down rendering. Each entry includes its hex ID + the budget
 * itself when we resolved it inside the visible budgets list. If the
 * chain hits a parent_budget_id we can't find in the list, we mark
 * the chain as orphaned and stop walking — the modal surfaces the
 * gap honestly rather than silently truncating.
 */
interface ChainNode {
  budget: BudgetAccountWithPda;
  idHex: string;
  parentHex: string | null;
}

function walkApprovalChain(
  start: BudgetAccountWithPda,
  budgets: BudgetAccountWithPda[],
): ChainNode[] {
  const byId = new Map<string, BudgetAccountWithPda>();
  for (const b of budgets) {
    byId.set(bytesToHex(b.account.budgetId), b);
  }

  const seen = new Set<string>();
  const nodes: ChainNode[] = [];
  let current: BudgetAccountWithPda | null = start;
  while (current) {
    const idHex = bytesToHex(current.account.budgetId);
    if (seen.has(idHex)) break; // defensive: cycle guard
    seen.add(idHex);
    const parentHex = bytesToHex(current.account.parentBudgetId);
    const hasParent = parentHex.match(/[^0]/) !== null;
    nodes.push({
      budget: current,
      idHex,
      parentHex: hasParent ? parentHex : null,
    });
    if (!hasParent) break;
    const parent = byId.get(parentHex);
    if (!parent) break; // chain orphaned — terminate
    current = parent;
  }
  // Reverse for top-down rendering: COMPANY authority at the top, this
  // budget at the bottom.
  return nodes.reverse();
}

/**
 * Iter-10 — vertical approval-chain renderer.
 *
 * Renders the chain top-down: COMPANY authority (terminal), then each
 * parent budget, ending in the current budget. Each row is a compact
 * (label · ID · utilization) strip. The terminal "COMPANY authority"
 * row is rendered with an accent Badge so the reader sees the chain
 * bottoms out at the on-chain governance root.
 *
 * When the chain is orphaned (a parent_budget_id pointed at a budget
 * we couldn't find in the visible list — e.g. the parent was created
 * on a different COMPANY, or the list was filtered) we surface a quiet
 * banner so an auditor knows the chain is incomplete.
 */
function ApprovalChain({
  chain,
  trustAuthority,
  orphan,
}: {
  chain: ChainNode[];
  trustAuthority: string | null;
  orphan: boolean;
}) {
  const decimals = 6; // USDC convention — matches BudgetDetailModal
  return (
    <Stack gap="2" className={styles.approvalChain}>
      {trustAuthority && (
        <div className={styles.approvalChainNode}>
          <div className={styles.approvalChainNodeHead}>
            <Badge variant="accent" size="sm" dot>
              COMPANY authority
            </Badge>
            <CopyableMono
              full={trustAuthority}
              display={shortAddress(trustAuthority)}
              tone="muted"
              withExplorer
            />
          </div>
          <span className={styles.approvalChainNodeNote}>
            Terminal node — the on-chain authority that can reclaim every allocation below.
          </span>
        </div>
      )}
      {chain.map((node, idx) => {
        const acc = node.budget.account;
        const isCurrent = idx === chain.length - 1;
        const amountBI = toBigInt(acc.amount);
        const spentBI = toBigInt(acc.spent);
        const pct = amountBI > BigInt(0) ? Number((spentBI * BigInt(10000)) / amountBI) / 100 : 0;
        const remainingBI = amountBI > spentBI ? amountBI - spentBI : 0n;
        return (
          <div
            key={node.idHex}
            className={`${styles.approvalChainNode} ${
              isCurrent ? styles.approvalChainNodeCurrent : ""
            }`}
          >
            <div className={styles.approvalChainNodeHead}>
              <Badge variant={isCurrent ? "accent" : "muted"} size="sm" dot>
                {isCurrent ? "This budget" : `Parent ${chain.length - 1 - idx}`}
              </Badge>
              <span className={styles.monoCell}>{bytesIdLabel(acc.budgetId)}</span>
              {acc.frozen && (
                <Badge variant="warning" size="sm" dot>
                  Frozen
                </Badge>
              )}
            </div>
            <span className={styles.approvalChainNodeNote}>
              {formatTokenAmount(remainingBI, decimals)} USDC remaining ·{" "}
              {formatNumber(pct, { maximumFractionDigits: 1 })}% spent
            </span>
          </div>
        );
      })}
      {orphan && (
        <p className={styles.approvalChainOrphanNote}>
          Parent budget not in this COMPANY&apos;s visible list — the chain is incomplete. Reclaim
          authority resolves at the COMPANY root above.
        </p>
      )}
    </Stack>
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
  // Iter-9: decoded count includes IDL-decoded ix rows (freeze, unfreeze,
  // …) alongside spend rows so the footer reads honestly when an operator
  // freezes a budget without spending.
  const decodedCount = decoded.filter((d) => d.kind === "spend" || d.kind === "budget-ix").length;
  return (
    <DetailField
      label={`Recent spend (${formatInteger(visible.length)}${hidden > 0 ? ` of ${formatInteger(signatures.length)}` : ""}${decodedCount > 0 ? ` · ${formatInteger(decodedCount)} decoded` : ""})`}
    >
      <ul className={styles.budgetSpendList}>
        {visible.map((sig) => {
          const row = decodedByKey.get(sig.signature);
          const isSpend = row?.kind === "spend";
          const isBudgetIx = row?.kind === "budget-ix";
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
                ) : isBudgetIx && row?.budgetIx ? (
                  // Iter-9: render the decoded `aeqi_budget` IDL ix name —
                  // freeze / unfreeze / create_budget / record_spend / init.
                  // freeze/unfreeze use the warmth/success accent family so
                  // a CFO can scan the timeline for lifecycle events
                  // without parsing each label. record_spend rows that
                  // didn't surface a transfer (e.g. failed-but-confirmed
                  // tx) fall here too — the label is still load-bearing.
                  <Badge
                    variant={
                      row.budgetIx === "freeze"
                        ? "warning"
                        : row.budgetIx === "unfreeze"
                          ? "success"
                          : "accent"
                    }
                    size="sm"
                    dot
                  >
                    {row.budgetIx.replace(/_/g, " ")}
                  </Badge>
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
