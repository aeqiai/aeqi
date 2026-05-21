/**
 * Iter-8 — Allocate-child sub-budget modal.
 *
 * Closes the iter-7 NEXT gap on the Budgets surface: the BudgetsSection
 * shipped the parent_budget_id hierarchy view + a row-level Spend
 * affordance, but no path to *create* a sub-budget under a parent.
 * Operators landed on a top-level budget, saw the hierarchy bucket,
 * and had to drop to `aeqi` CLI to spawn a role-scoped sub-cap.
 *
 * This modal opens from the row-level "Allocate" affordance on a
 * top-level budget and posts to `api.allocateChildBudget(...)` (which
 * routes to `POST /solana/budget-create` with the parent reference
 * set; the on-chain `aeqi_budget::allocate_child_budget` instruction
 * creates a Budget account whose `parent_budget_id` references the
 * parent and whose `amount` is debited from the parent's remaining
 * allocation).
 *
 * Honest scope:
 *   - The child amount cannot exceed the parent's remaining
 *     allocation. We pre-validate the inputs against the parent's
 *     `amount - spent` so the operator sees the cap before the
 *     on-chain program rejects the call.
 *   - Frozen parent budgets cannot allocate; the host page disables
 *     the row-level Allocate button (same pattern as Spend), so this
 *     modal never opens against a frozen parent.
 *   - Same USDC 6-decimals conversion as create + spend.
 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/i18n";
import { Badge, Banner, Button, Inline, Input, Modal, Stack } from "@/components/ui";

import { bytesIdLabel, bytesToHex, formatTokenAmount, toBigInt } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

import type { BudgetAccountWithPda } from "@/solana/assets";

const QUOTE_DECIMALS = 6;

interface NewAllocateModalProps {
  /** Parent budget to allocate from. Modal is open whenever non-null;
   *  closing the modal nulls the parent. */
  parent: BudgetAccountWithPda | null;
  /** Entity ID of the host TRUST — required for the platform route. */
  trustId: string;
  onClose: () => void;
  /** Called after a successful allocate — host re-fetches the budgets
   *  list so the hierarchy view picks up the new sub-budget. */
  onAllocated: () => void;
}

interface SubmitResult {
  ok: boolean;
  message: string;
}

export function NewAllocateModal({ parent, trustId, onClose, onAllocated }: NewAllocateModalProps) {
  const [roleLabel, setRoleLabel] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [budgetLabel, setBudgetLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Reset transient form state whenever a new parent gets opened so the
  // previous allocate's result doesn't echo into the next session.
  useEffect(() => {
    if (parent) {
      setRoleLabel("");
      setAmountStr("");
      setBudgetLabel("");
      setSubmitting(false);
      setResult(null);
    }
  }, [parent]);

  if (!parent) {
    return <Modal open={false} onClose={onClose} title="Allocate" children={null} />;
  }

  const amountNum = Number(amountStr);
  const amountValid = amountStr.length > 0 && Number.isFinite(amountNum) && amountNum > 0;
  const roleValid = roleLabel.trim().length > 0;
  const submittable = amountValid && roleValid && !submitting;

  const parentIdLabel = bytesIdLabel(parent.account.budgetId);
  const parentIdHex = `0x${bytesToHex(parent.account.budgetId)}`;
  const amountBI = toBigInt(parent.account.amount);
  const spentBI = toBigInt(parent.account.spent);
  const remainingRaw = amountBI - spentBI;
  const remaining = remainingRaw > 0n ? remainingRaw : 0n;
  const remainingHuman = Number(remaining) / Math.pow(10, QUOTE_DECIMALS);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submittable) return;

    setResult(null);
    const baseAmount = Math.round(amountNum * Math.pow(10, QUOTE_DECIMALS));
    if (BigInt(baseAmount) > remaining) {
      setResult({
        ok: false,
        message: `Amount exceeds parent's remaining allocation (${formatTokenAmount(remaining, QUOTE_DECIMALS)} USDC).`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const trimmedBudgetLabel = budgetLabel.trim();
      const res = await api.allocateChildBudget({
        entity_id: trustId,
        parent_budget_id: parentIdHex,
        target_role_id: roleLabel.trim(),
        amount: baseAmount,
        budget_label: trimmedBudgetLabel.length > 0 ? trimmedBudgetLabel : undefined,
      });
      setResult({
        ok: true,
        message: `Sub-budget allocated — ${res.budget_id_hex.slice(0, 14)}…`,
      });
      onAllocated();
    } catch (err: unknown) {
      // Honest error surface: bubble up the platform / on-chain message
      // verbatim. Parent-cap rejections, frozen-parent rejections, and
      // role-resolution failures all surface different codes that the
      // operator needs to read.
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={handleClose} title={`Allocate · sub-budget of ${parentIdLabel}`}>
      <form onSubmit={handleSubmit} className={styles.newBudgetForm}>
        <Stack gap="4">
          <Banner kind="info">
            Spawns a role-scoped sub-budget under{" "}
            <span className={styles.monoCell}>{parentIdLabel}</span>. The on-chain `aeqi_budget`
            program debits the amount from the parent&apos;s remaining allocation and creates a new
            Budget account targeting the named role.
          </Banner>
          <div className={styles.newSpendRemaining}>
            <span className={styles.newSpendRemainingLabel}>Parent remaining</span>
            <span className={styles.newSpendRemainingValue}>
              {formatTokenAmount(remaining, QUOTE_DECIMALS)} USDC
            </span>
          </div>
          <Input
            label="Target role"
            placeholder="engineering-frontend"
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
            hint="Free-text role label — the platform hashes this into the 32-byte on-chain role ID. Caller must occupy a role with allocate-child authority."
            disabled={submitting}
            required
            autoFocus
          />
          <Input
            label="Amount (USDC)"
            placeholder="0.00"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            hint={
              amountStr.length > 0 && !amountValid
                ? "Amount must be a positive number."
                : `Max ${formatNumber(remainingHuman, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC available from parent.`
            }
            disabled={submitting}
            required
          />
          <Input
            label="Sub-budget label (optional)"
            placeholder="Q3 frontend contractors"
            value={budgetLabel}
            onChange={(e) => setBudgetLabel(e.target.value)}
            hint="Short identifier for the sub-budget. Omitted → random ID assigned by the program."
            disabled={submitting}
          />
          {result && (
            <div
              className={result.ok ? styles.newBudgetResultOk : styles.newBudgetResultError}
              role={result.ok ? "status" : "alert"}
            >
              {result.ok ? (
                <Inline gap="2" align="center">
                  <Badge variant="success" dot>
                    Allocated
                  </Badge>
                  <span>{result.message}</span>
                </Inline>
              ) : (
                <Inline gap="2" align="center">
                  <Badge variant="error" dot>
                    Failed
                  </Badge>
                  <span>{result.message}</span>
                </Inline>
              )}
            </div>
          )}
          <Inline gap="3" justify="end">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={handleClose}
              disabled={submitting}
            >
              {result?.ok ? "Close" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!submittable || parent.account.frozen}
              loading={submitting}
              title={
                parent.account.frozen
                  ? "Parent is frozen — unfreeze before allocating sub-budgets."
                  : undefined
              }
            >
              Allocate {amountValid ? formatCurrency(amountNum) : "sub-budget"}
            </Button>
          </Inline>
        </Stack>
      </form>
    </Modal>
  );
}
