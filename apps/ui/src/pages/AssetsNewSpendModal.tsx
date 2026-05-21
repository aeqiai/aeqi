/**
 * Iter-7 — Spend-from-budget modal.
 *
 * Closes the iter-6 NEXT gap on the Budgets surface: the BudgetsSection
 * shipped a row-click → detail modal but no path to actually disburse
 * against a budget. Operators landed on the detail modal, saw the
 * remaining allocation, and had to drop to `aeqi` CLI to spend.
 *
 * This modal opens from the row-level "Spend" affordance and posts to
 * `api.spendTreasury(budgetId, { destination, amount, memo })`. The
 * platform route (`POST /budgets/:id/spend`) wraps the on-chain
 * `aeqi_budget::spend_treasury` instruction — caller must occupy the
 * budget's owner role, the amount must fit inside the remaining
 * allocation, and the destination must be a Solana pubkey.
 *
 * Honest scope:
 *   - Amount is denominated in the budget's quote token (USDC by
 *     convention — same 6-decimals scale used elsewhere on the page).
 *     The form converts the human input into base units before posting.
 *   - No multi-step idempotency UI; we pass through any `idempotency_key`
 *     parameter the API exposes but the form doesn't surface one to the
 *     operator (the platform will treat repeat posts safely on its end).
 *   - When the platform returns `code` rather than `ok=true`, we surface
 *     the code + error string honestly rather than retry behind a
 *     spinner — most spend failures are caller-role mismatches the
 *     operator needs to see.
 *   - We deliberately do NOT auto-init the budget module on this path:
 *     spending requires an existing Budget account whose parent module
 *     must already be initialised (otherwise create_budget would have
 *     failed in the first place). The auto-init dance in
 *     `AssetsNewBudgetModal` is correct for creation; here it would
 *     mask a different failure class.
 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/i18n";
import { Badge, Banner, Button, Inline, Input, Modal, Stack } from "@/components/ui";

import { bytesIdLabel, bytesToHex, formatTokenAmount, toBigInt } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

import type { BudgetAccountWithPda } from "@/solana/assets";

/** USDC base-unit scale used across the rest of the Assets surface.
 *  Matches NewBudgetModal so amount input ↔ on-chain wire conversion
 *  is symmetrical across the create and spend paths. */
const QUOTE_DECIMALS = 6;

interface NewSpendModalProps {
  /** Budget to spend against. The modal is open whenever this is
   *  non-null; closing the modal nulls the budget. */
  budget: BudgetAccountWithPda | null;
  onClose: () => void;
  /** Called after a successful spend — host re-fetches the budgets
   *  list so the utilization meter and remaining allocation update. */
  onSpent: () => void;
}

interface SubmitResult {
  ok: boolean;
  message: string;
}

export function NewSpendModal({ budget, onClose, onSpent }: NewSpendModalProps) {
  const [destination, setDestination] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Reset transient form state whenever a new budget gets opened, so
  // the previous spend's result doesn't echo into the next session.
  useEffect(() => {
    if (budget) {
      setDestination("");
      setAmountStr("");
      setMemo("");
      setSubmitting(false);
      setResult(null);
    }
  }, [budget]);

  if (!budget) {
    return <Modal open={false} onClose={onClose} title="Spend" children={null} />;
  }

  const amountNum = Number(amountStr);
  const amountValid = amountStr.length > 0 && Number.isFinite(amountNum) && amountNum > 0;
  const destinationValid = destination.length >= 32 && destination.length <= 44;
  const submittable = amountValid && destinationValid && !submitting;

  const budgetIdLabel = bytesIdLabel(budget.account.budgetId);
  const budgetIdHex = `0x${bytesToHex(budget.account.budgetId)}`;
  const amountBI = toBigInt(budget.account.amount);
  const spentBI = toBigInt(budget.account.spent);
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
        message: `Amount exceeds remaining allocation (${formatTokenAmount(remaining, QUOTE_DECIMALS)} USDC).`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const trimmedMemo = memo.trim();
      const res = await api.spendTreasury(budgetIdHex, {
        destination: destination.trim(),
        amount: baseAmount,
        memo: trimmedMemo.length > 0 ? trimmedMemo : undefined,
      });
      if (res.ok) {
        setResult({
          ok: true,
          message: `Spend posted — ${formatTokenAmount(BigInt(baseAmount), QUOTE_DECIMALS)} USDC dispatched.`,
        });
        onSpent();
      } else {
        // Honest error surface: the platform's role-check / allocation
        // / module-state codes need to land in front of the operator
        // verbatim. Hiding them behind a generic "Spend failed" forces
        // a CLI debug round-trip.
        setResult({
          ok: false,
          message: res.error
            ? `${res.code ?? "spend_failed"}: ${res.error}`
            : (res.code ?? "spend_failed"),
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
    <Modal open={true} onClose={handleClose} title={`Spend · ${budgetIdLabel}`}>
      <form onSubmit={handleSubmit} className={styles.newBudgetForm}>
        <Stack gap="4">
          <Banner kind="info">
            Dispatches a treasury transfer against this budget. The on-chain `aeqi_budget` program
            checks that the caller occupies the budget&apos;s owner role and the spend fits inside
            the remaining allocation.
          </Banner>
          <div className={styles.newSpendRemaining}>
            <span className={styles.newSpendRemainingLabel}>Remaining</span>
            <span className={styles.newSpendRemainingValue}>
              {formatTokenAmount(remaining, QUOTE_DECIMALS)} USDC
            </span>
          </div>
          <Input
            label="Destination (Solana address)"
            placeholder="3DvL…ZxYa"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            hint={
              destination.length > 0 && !destinationValid
                ? "Address looks too short — Solana pubkeys are base58 (32–44 chars)."
                : "ATA / wallet to receive the spend."
            }
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
                : `Max ${formatNumber(remainingHuman, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC remaining in this budget.`
            }
            disabled={submitting}
            required
          />
          <Input
            label="Memo (optional)"
            placeholder="Q3 contractor payment"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            hint="Attached as an SPL Memo instruction alongside the transfer."
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
                    Sent
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
              disabled={!submittable || budget.account.frozen}
              loading={submitting}
              title={
                budget.account.frozen ? "Budget is frozen — unfreeze before spending." : undefined
              }
            >
              Send {amountValid ? formatCurrency(amountNum) : "spend"}
            </Button>
          </Inline>
        </Stack>
      </form>
    </Modal>
  );
}
