/**
 * `BudgetsSection` + its utilization meter cell.
 *
 * Extracted iter-6 from `AssetsSections.tsx`. The flat-list iter-5
 * version was a single `<Table>` invocation; iter-6 introduces the
 * parent_budget_id hierarchy grouping (top-level + per-parent sub-tables
 * + detached orphans), which more than doubled the function size and
 * pushed `AssetsSections.tsx` over the lint ceiling. Splitting keeps
 * each Assets surface file under the 600-line guard and lets the
 * hierarchy logic live next to the budget-specific cell helpers without
 * dragging in the unrelated vesting concerns.
 */
import type { CSSProperties } from "react";
import { useMemo } from "react";

import type { BudgetAccountWithPda } from "@/solana/assets";
import { formatInteger, formatNumber } from "@/lib/i18n";
import { Badge, Button, PageSection, Stack, Table, type TableColumn } from "@/components/ui";

import {
  ExpiryCell,
  budgetDecimals,
  bytesIdLabel,
  bytesToHex,
  formatTokenAmount,
  type TokenMetaMap,
} from "./AssetsSections";
import styles from "./AssetsPage.module.css";

export function BudgetsSection({
  budgets,
  metas,
  onSelect,
  onSpend,
  onAllocate,
  onFreeze,
  actions,
}: {
  budgets: BudgetAccountWithPda[];
  metas: TokenMetaMap;
  onSelect: (row: BudgetAccountWithPda) => void;
  /** Iter-7: row-level Spend affordance. Host opens NewSpendModal
   *  prefilled with the row so the operator can disburse against the
   *  selected budget without leaving the Assets surface. */
  onSpend: (row: BudgetAccountWithPda) => void;
  /** Iter-8: row-level Allocate affordance. Host opens
   *  NewAllocateModal prefilled with the row as parent so the operator
   *  can spawn a role-scoped sub-budget under it. Closes the iter-7
   *  NEXT gap. */
  onAllocate: (row: BudgetAccountWithPda) => void;
  /** Iter-8: row-level Freeze / Unfreeze affordance. Host opens
   *  FreezeBudgetModal which flips the on-chain `frozen` bool. */
  onFreeze: (row: BudgetAccountWithPda) => void;
  /** Section-level actions slot — host page mounts a "+ New budget" CTA. */
  actions?: React.ReactNode;
}) {
  /* iter-6: budget hierarchy view. Each Budget account carries a 32-byte
     `parent_budget_id`; when non-zero the budget is a sub-budget under
     its parent allocation. Iter-5 rendered a flat list which lost the
     allocation tree (operators couldn't see which budgets were sub-caps
     of which parents). We now group budgets into:
     - Top-level (parent_budget_id == 0)
     - Per-parent buckets, keyed by hex(parent_budget_id)
     and render each bucket as a nested Table indented under its parent.
     The hierarchy stays visible at the section level rather than buried
     in the modal. Orphan children (parent ID not present in the list)
     fall back to a "Detached sub-budgets" bucket so they're still
     visible.
  */
  const { topLevel, childrenByParent, orphans } = useMemo(() => {
    const byBudgetId = new Map<string, BudgetAccountWithPda>();
    for (const b of budgets) {
      byBudgetId.set(bytesToHex(b.account.budgetId), b);
    }
    const top: BudgetAccountWithPda[] = [];
    const children = new Map<string, BudgetAccountWithPda[]>();
    const orphanList: BudgetAccountWithPda[] = [];
    for (const b of budgets) {
      const parentHex = bytesToHex(b.account.parentBudgetId);
      const isTop = !parentHex.match(/[^0]/);
      if (isTop) {
        top.push(b);
        continue;
      }
      if (byBudgetId.has(parentHex)) {
        const arr = children.get(parentHex) ?? [];
        arr.push(b);
        children.set(parentHex, arr);
      } else {
        orphanList.push(b);
      }
    }
    const sortFn = (a: BudgetAccountWithPda, b: BudgetAccountWithPda) => {
      const aFrozen = a.account.frozen ? 1 : 0;
      const bFrozen = b.account.frozen ? 1 : 0;
      if (aFrozen !== bFrozen) return aFrozen - bFrozen;
      return bytesToHex(a.account.budgetId).localeCompare(bytesToHex(b.account.budgetId));
    };
    top.sort(sortFn);
    orphanList.sort(sortFn);
    for (const [k, arr] of children) {
      arr.sort(sortFn);
      children.set(k, arr);
    }
    return { topLevel: top, childrenByParent: children, orphans: orphanList };
  }, [budgets]);

  const columns: Array<TableColumn<BudgetAccountWithPda>> = [
    {
      key: "budgetId",
      header: "Budget",
      cell: (row) => <span className={styles.monoCell}>{bytesIdLabel(row.account.budgetId)}</span>,
    },
    {
      key: "role",
      header: "Target role",
      cell: (row) => (
        <span className={styles.monoCell}>{bytesIdLabel(row.account.targetRoleId)}</span>
      ),
    },
    {
      key: "utilization",
      header: "Utilization",
      cell: (row) => (
        <BudgetUtilization
          spent={row.account.spent}
          amount={row.account.amount}
          decimals={budgetDecimals(metas)}
        />
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      align: "end",
      cell: (row) => <ExpiryCell expiry={Number(row.account.expiry)} />,
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (row) =>
        row.account.frozen ? (
          <Badge variant="warning" dot>
            Frozen
          </Badge>
        ) : (
          <Badge variant="success" dot>
            Active
          </Badge>
        ),
    },
    {
      // Iter-7 → 8: row-level tri-action — Spend / Allocate / Freeze.
      // Spend + Allocate are disabled when the budget is frozen (the
      // on-chain program rejects both with `budget_frozen`); Freeze
      // stays live so the operator can toggle back. Click events stop
      // propagation so the row-click (which opens the detail modal)
      // doesn't also fire under any of them.
      key: "actions",
      header: "",
      align: "end",
      cell: (row) => (
        <span className={styles.budgetRowActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onSpend(row);
            }}
            disabled={row.account.frozen}
            title={row.account.frozen ? "Budget is frozen" : "Spend from this budget"}
            aria-label={`Spend from budget ${bytesIdLabel(row.account.budgetId)}`}
          >
            Spend
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onAllocate(row);
            }}
            disabled={row.account.frozen}
            title={
              row.account.frozen
                ? "Budget is frozen — unfreeze before allocating sub-budgets."
                : "Allocate a role-scoped sub-budget under this budget"
            }
            aria-label={`Allocate sub-budget under ${bytesIdLabel(row.account.budgetId)}`}
          >
            Allocate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onFreeze(row);
            }}
            title={
              row.account.frozen ? "Unfreeze this budget" : "Freeze on-chain spend + allocate calls"
            }
            aria-label={
              row.account.frozen
                ? `Unfreeze budget ${bytesIdLabel(row.account.budgetId)}`
                : `Freeze budget ${bytesIdLabel(row.account.budgetId)}`
            }
          >
            {row.account.frozen ? "Unfreeze" : "Freeze"}
          </Button>
        </span>
      ),
    },
  ];

  // No hierarchy: nothing has a non-zero parent. Fall through to the
  // single flat table iter-5 shipped — quieter visual.
  const hasHierarchy = childrenByParent.size > 0 || orphans.length > 0;

  return (
    <PageSection
      title="Active budgets"
      description="Per-role allocations recorded on `aeqi_budget`. Spend caps are enforced on-chain. Click a row for details."
      actions={actions}
    >
      {!hasHierarchy ? (
        <Table
          columns={columns}
          data={topLevel}
          rowKey={(row) => row.publicKey.toBase58()}
          ariaLabel="Active budgets"
          onRowClick={onSelect}
        />
      ) : (
        <>
          <Table
            columns={columns}
            data={topLevel}
            rowKey={(row) => row.publicKey.toBase58()}
            ariaLabel="Top-level budgets"
            onRowClick={onSelect}
          />
          {[...childrenByParent.entries()].map(([parentHex, kids]) => {
            const parent = topLevel.find((t) => bytesToHex(t.account.budgetId) === parentHex);
            const parentLabel = parent
              ? bytesIdLabel(parent.account.budgetId)
              : `0x${parentHex.slice(0, 12)}…`;
            return (
              <div key={parentHex} className={styles.budgetHierarchyGroup}>
                <div className={styles.budgetHierarchyHead}>
                  <span>Sub-budgets of {parentLabel}</span>
                  <span className={styles.budgetHierarchyCount}>
                    · {formatInteger(kids.length)}
                  </span>
                </div>
                <div className={styles.budgetHierarchyChildren}>
                  <Table
                    columns={columns}
                    data={kids}
                    rowKey={(row) => row.publicKey.toBase58()}
                    ariaLabel={`Sub-budgets of ${parentLabel}`}
                    onRowClick={onSelect}
                  />
                </div>
              </div>
            );
          })}
          {orphans.length > 0 && (
            <div className={styles.budgetHierarchyGroup}>
              <div className={styles.budgetHierarchyHead}>
                <span>Detached sub-budgets</span>
                <span className={styles.budgetHierarchyCount}>
                  · {formatInteger(orphans.length)}
                </span>
              </div>
              <div className={styles.budgetHierarchyChildren}>
                <Table
                  columns={columns}
                  data={orphans}
                  rowKey={(row) => row.publicKey.toBase58()}
                  ariaLabel="Detached sub-budgets"
                  onRowClick={onSelect}
                />
              </div>
            </div>
          )}
        </>
      )}
    </PageSection>
  );
}

/**
 * Inline utilization meter. Bar fill is driven by a CSS custom property
 * so the only dynamic styling is one width — keeps the design-system
 * audit happy (no inline color/tone hex).
 *
 * Budgets are denominated in USDC base units by convention (the only
 * mint the budget program initializes against today). We look up
 * decimals once per metas snapshot so utilization rows render with the
 * right scale even on localnet where the registry USDC mint differs.
 */
function BudgetUtilization({
  spent,
  amount,
  decimals,
}: {
  spent: bigint;
  amount: bigint;
  decimals: number;
}) {
  const spentNum = Number(spent);
  const totalNum = Number(amount);
  const pct = totalNum > 0 ? Math.min(100, (spentNum / totalNum) * 100) : 0;
  const fillStyle: CSSProperties = { width: `${pct}%` };
  return (
    <Stack gap="1" className={styles.utilization}>
      <div className={styles.utilizationMeta}>
        <span>
          {formatTokenAmount(spent, decimals)} / {formatTokenAmount(amount, decimals)}
        </span>
        <span>{formatNumber(pct, { maximumFractionDigits: 0 })}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={styles.utilizationTrack}
      >
        <div className={styles.utilizationFill} data-tone="accent" style={fillStyle} />
      </div>
    </Stack>
  );
}
