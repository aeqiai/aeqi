import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import "./RoleBudgetControl.css";

interface RoleBudgetControlProps {
  /** Trust id (entity id) — passed through to the platform route. */
  trustId: string;
  /** Off-chain role id (UUID). The platform keccak256-hashes this into the
   *  32-byte on-chain role identifier. */
  roleId: string;
  roleTitle: string;
}

const QUOTE_DECIMALS = 6;

/**
 * Grant a spending budget against this role. The on-chain `aeqi-budget`
 * program caps role spend at the granted `amount` (denominated in the
 * trust's quote token, 6 decimals); `expiry = 0` means no expiry.
 *
 * The on-chain BudgetModuleState must exist before create_budget can
 * write. We lazily init the module on first failure rather than asking
 * the operator to think about it — single-button UX.
 */
export default function RoleBudgetControl({ trustId, roleId, roleTitle }: RoleBudgetControlProps) {
  const [amountStr, setAmountStr] = useState("");
  const [expiry, setExpiry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    const amountNum = parseFloat(amountStr);
    if (!isFinite(amountNum) || amountNum <= 0) {
      setResult({ ok: false, message: "Amount must be > 0" });
      return;
    }
    const baseAmount = Math.round(amountNum * Math.pow(10, QUOTE_DECIMALS));
    const expirySecs = expiry ? Math.floor(new Date(expiry).getTime() / 1000) : 0;
    if (expiry && expirySecs <= Math.floor(Date.now() / 1000)) {
      setResult({ ok: false, message: "Expiry must be in the future" });
      return;
    }

    setSubmitting(true);
    try {
      const callCreate = () =>
        api.budgetCreate({
          entity_id: trustId,
          target_role_id: roleId,
          amount: baseAmount,
          expiry: expirySecs,
        });

      try {
        const res = await callCreate();
        setResult({
          ok: true,
          message: `Budget granted — ${res.budget_id_hex.slice(0, 14)}…`,
        });
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
          });
        } else {
          throw err;
        }
      }
      setAmountStr("");
      setExpiry("");
    } catch (err: unknown) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="role-budget-control" aria-labelledby="role-budget-heading">
      <header className="role-budget-header">
        <h2 id="role-budget-heading" className="role-budget-title">
          Budget
        </h2>
        <p className="role-budget-subtitle">
          Cap spending by the holder of <strong>{roleTitle}</strong>. On-chain enforced via
          aeqi-budget.
        </p>
      </header>
      <form className="role-budget-form" onSubmit={handleSubmit}>
        <div className="role-budget-row">
          <label className="role-budget-label" htmlFor="role-budget-amount">
            Amount (USDC)
          </label>
          <Input
            id="role-budget-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.currentTarget.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="role-budget-row">
          <label className="role-budget-label" htmlFor="role-budget-expiry">
            Expiry <span className="role-budget-optional">(optional)</span>
          </label>
          <Input
            id="role-budget-expiry"
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.currentTarget.value)}
            disabled={submitting}
          />
        </div>
        <div className="role-budget-actions">
          <Button type="submit" variant="primary" size="md" loading={submitting}>
            Grant budget
          </Button>
        </div>
        {result && (
          <div
            className={`role-budget-result ${result.ok ? "role-budget-result-ok" : "role-budget-result-err"}`}
          >
            {result.message}
          </div>
        )}
      </form>
    </section>
  );
}
