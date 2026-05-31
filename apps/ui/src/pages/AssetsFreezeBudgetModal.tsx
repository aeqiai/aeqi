/**
 * Iter-8 — Freeze / Unfreeze budget confirmation modal.
 *
 * Adds the third row-level action on the Budgets surface, completing the
 * tri-action set (Spend / Allocate / Freeze) called out in the iter-7
 * close. The on-chain `aeqi_budget` program ships `freeze` and
 * `unfreeze` instructions that flip the `frozen` boolean on a Budget
 * account; while frozen, any `spend_treasury` or
 * `allocate_child_budget` call against the budget is rejected by the
 * program.
 *
 * Honest scope:
 *   - The platform-side routes (`/api/solana/budget-freeze` and
 *     `/api/solana/budget-unfreeze`) are HONEST STUBS — the on-chain
 *     ixs exist in `programs/aeqi-budget/src/lib.rs`, but the platform
 *     hasn't wired the wrapper routes yet. The api.ts helpers surface
 *     "route not implemented yet" diagnostics so the operator reads the
 *     real gap rather than a generic network error.
 *   - This is a confirmation modal — no form fields. The mutation is a
 *     single bool flip, so the operator confirms the action and sees the
 *     immediate effect (or the diagnostic).
 *   - Frozen budgets get an amber row tint in the BudgetsSection table
 *     (handled outside this modal via the existing Active/Frozen Badge).
 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Badge, Banner, Button, Inline, Modal, Stack } from "@/components/ui";

import { bytesIdLabel, bytesToHex } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

import type { BudgetAccountWithPda } from "@/solana/assets";

interface FreezeBudgetModalProps {
  /** Budget to freeze or unfreeze. Modal is open whenever non-null;
   *  closing the modal nulls the target. */
  budget: BudgetAccountWithPda | null;
  /** Entity ID of the host COMPANY — required for the platform route. */
  companyId: string;
  onClose: () => void;
  /** Called after a successful flip — host re-fetches the budgets list
   *  so the row's Active/Frozen Badge updates. */
  onFlipped: () => void;
}

interface SubmitResult {
  ok: boolean;
  message: string;
}

export function FreezeBudgetModal({
  budget,
  companyId,
  onClose,
  onFlipped,
}: FreezeBudgetModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    if (budget) {
      setSubmitting(false);
      setResult(null);
    }
  }, [budget]);

  if (!budget) {
    return <Modal open={false} onClose={onClose} title="Freeze" children={null} />;
  }

  const isFrozen = budget.account.frozen;
  const budgetIdLabel = bytesIdLabel(budget.account.budgetId);
  const budgetIdHex = `0x${bytesToHex(budget.account.budgetId)}`;
  const verb = isFrozen ? "Unfreeze" : "Freeze";

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    setResult(null);
    setSubmitting(true);
    try {
      const call = isFrozen ? api.budgetUnfreeze : api.budgetFreeze;
      const res = await call({ entity_id: companyId, budget_id: budgetIdHex });
      if (res.ok) {
        setResult({
          ok: true,
          message: isFrozen
            ? "Budget unfrozen — spend + allocate calls are accepted again."
            : "Budget frozen — spend + allocate calls will be rejected until unfrozen.",
        });
        onFlipped();
      } else {
        setResult({
          ok: false,
          message: `Platform did not confirm the ${verb.toLowerCase()} — refetch on the next list refresh.`,
        });
      }
    } catch (err: unknown) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={handleClose} title={`${verb} · ${budgetIdLabel}`}>
      <div className={styles.newBudgetForm}>
        <Stack gap="4">
          <Banner kind={isFrozen ? "info" : "warning"}>
            {isFrozen ? (
              <>
                Re-enable on-chain spend + allocate calls against this budget. The on-chain{" "}
                <span className={styles.monoCell}>aeqi_budget::unfreeze</span> ix flips{" "}
                <span className={styles.monoCell}>frozen = false</span>. Grantor (company authority)
                signs.
              </>
            ) : (
              <>
                Freeze on-chain spend + allocate calls against this budget. The on-chain{" "}
                <span className={styles.monoCell}>aeqi_budget::freeze</span> ix flips{" "}
                <span className={styles.monoCell}>frozen = true</span>. Existing in-flight spends
                are unaffected; new calls are rejected with{" "}
                <span className={styles.monoCell}>budget_frozen</span>.
              </>
            )}
          </Banner>
          {result && (
            <div
              className={result.ok ? styles.newBudgetResultOk : styles.newBudgetResultError}
              role={result.ok ? "status" : "alert"}
            >
              {result.ok ? (
                <Inline gap="2" align="center">
                  <Badge variant="success" dot>
                    {verb}d
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
              type="button"
              variant={isFrozen ? "primary" : "secondary"}
              size="md"
              onClick={handleSubmit}
              loading={submitting}
              disabled={submitting || result?.ok}
            >
              {verb}
            </Button>
          </Inline>
        </Stack>
      </div>
    </Modal>
  );
}
