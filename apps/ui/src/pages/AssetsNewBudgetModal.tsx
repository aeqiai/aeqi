/**
 * NewBudgetModal — iter-4 closes the "no create CTA" gap on the budgets
 * surface. The form posts to `api.budgetCreate(...)`, which keccak256-
 * hashes the free-text role label into the on-chain 32-byte role ID.
 *
 * The on-chain `BudgetModuleState` must exist before `create_budget` can
 * write. We mirror `RoleBudgetControl`'s pattern: try the create, catch
 * the well-known "module not initialized" error class, lazy-init the
 * module, then retry. The operator sees one button, not two.
 *
 * Honest scope:
 *   - No role autocompletion. The budget program accepts either a hex
 *     role ID or a free-text label; the platform hashes the latter.
 *     Until we wire a roles hook on this surface, the operator types
 *     the role label (e.g. `engineering`) directly.
 *   - No parent-budget picker. Sub-budgets are a separate flow (parent
 *     chaining lives in the detail modal); the create modal stays flat.
 *   - Amount is denominated in USDC (6 decimals) — matches every other
 *     budget surface in the dashboard.
 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Badge, Banner, Button, Inline, Input, Modal, Stack } from "@/components/ui";

import styles from "./AssetsPage.module.css";

const QUOTE_DECIMALS = 6;

interface NewBudgetModalProps {
  open: boolean;
  onClose: () => void;
  trustId: string;
  /** Called after a successful create — host re-fetches the budgets list. */
  onCreated: () => void;
}

interface SubmitResult {
  ok: boolean;
  message: string;
  budgetIdHex?: string;
}

export function NewBudgetModal({ open, onClose, trustId, onCreated }: NewBudgetModalProps) {
  const [roleLabel, setRoleLabel] = useState("");
  const [budgetLabel, setBudgetLabel] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [expiry, setExpiry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Reset transient form state every time the modal opens so the
  // previous result doesn't echo into the next session.
  useEffect(() => {
    if (open) {
      setRoleLabel("");
      setBudgetLabel("");
      setAmountStr("");
      setExpiry("");
      setSubmitting(false);
      setResult(null);
    }
  }, [open]);

  const amountNum = Number(amountStr);
  const amountValid = amountStr.length > 0 && Number.isFinite(amountNum) && amountNum > 0;
  const roleValid = roleLabel.trim().length > 0;
  const submittable = amountValid && roleValid && !submitting;

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submittable) return;

    setResult(null);
    const baseAmount = Math.round(amountNum * Math.pow(10, QUOTE_DECIMALS));
    const expirySecs = expiry ? Math.floor(new Date(expiry).getTime() / 1000) : 0;
    if (expiry && expirySecs <= Math.floor(Date.now() / 1000)) {
      setResult({ ok: false, message: "Expiry must be in the future." });
      return;
    }

    setSubmitting(true);
    try {
      const trimmedBudgetLabel = budgetLabel.trim();
      const callCreate = () =>
        api.budgetCreate({
          entity_id: trustId,
          target_role_id: roleLabel.trim(),
          amount: baseAmount,
          expiry: expirySecs,
          budget_label: trimmedBudgetLabel.length > 0 ? trimmedBudgetLabel : undefined,
        });

      try {
        const res = await callCreate();
        setResult({
          ok: true,
          message: `Budget granted — ${res.budget_id_hex.slice(0, 14)}…`,
          budgetIdHex: res.budget_id_hex,
        });
        onCreated();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          /budget_module|module_state|account.*not.*found|0x..bc4|AccountNotInitialized/i.test(msg)
        ) {
          await api.budgetModuleInit({ entity_id: trustId });
          const res = await callCreate();
          setResult({
            ok: true,
            message: `Budget granted — ${res.budget_id_hex.slice(0, 14)}…`,
            budgetIdHex: res.budget_id_hex,
          });
          onCreated();
        } else {
          throw err;
        }
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
    <Modal open={open} onClose={handleClose} title="Grant a budget">
      <form onSubmit={handleSubmit} className={styles.newBudgetForm}>
        <Stack gap="4">
          <Banner kind="info">
            The on-chain `aeqi_budget` program caps spending by the holder of the named role. The
            budget module initializes automatically on the first grant.
          </Banner>
          <Input
            label="Target role"
            placeholder="engineering"
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
            hint="Free-text label (e.g. `engineering`) — the platform hashes this into the 32-byte on-chain role ID."
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
                : "Denominated in USDC base units (6 decimals) on-chain."
            }
            disabled={submitting}
            required
          />
          <Input
            label="Budget label (optional)"
            placeholder="Q3 contractors"
            value={budgetLabel}
            onChange={(e) => setBudgetLabel(e.target.value)}
            hint="Short identifier for the grant. Omitted → random ID assigned by the program."
            disabled={submitting}
          />
          <Input
            label="Expiry (optional)"
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            hint="Empty → no expiry. Expired budgets reject spend calls on-chain."
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
                    Granted
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
              disabled={!submittable}
              loading={submitting}
            >
              Grant budget
            </Button>
          </Inline>
        </Stack>
      </form>
    </Modal>
  );
}
