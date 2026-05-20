import { useState } from "react";
import { Button, Input, PageSection, Select } from "@/components/ui";
import { api } from "@/lib/api";
import "./EquityFundingRoundControl.css";

interface EquityFundingRoundControlProps {
  trustId: string;
}

const ASSET_DECIMALS = 6;
const QUOTE_DECIMALS = 6;

type FundingKind = 0 | 1 | 2;

const KIND_OPTIONS: { value: FundingKind; label: string; help: string }[] = [
  {
    value: 0,
    label: "Commitment sale",
    help: "Fixed-price pre-sale. Asset + target quote locked at declare time.",
  },
  {
    value: 1,
    label: "Bonding curve",
    help: "Continuous-curve issuance. Parameters land at activation.",
  },
  {
    value: 2,
    label: "Exit",
    help: "Pro-rata redemption. Parameters land at activation.",
  },
];

/**
 * Declare a funding round against the TRUST. Activation (start a sale /
 * curve / exit) is a separate ix and lands in a follow-up ship. The
 * platform handler keccak256-hashes free-text budget labels into the
 * 32-byte on-chain budget identifier.
 *
 * Single-button UX: tries fundingRequestCreate directly; on the
 * FundingModuleState-missing error shape, lazily inits the module and
 * retries. Operators don't have to think about the one-time init step.
 */
export default function EquityFundingRoundControl({ trustId }: EquityFundingRoundControlProps) {
  const [kind, setKind] = useState<FundingKind>(0);
  const [budgetIdInput, setBudgetIdInput] = useState("");
  const [assetAmountStr, setAssetAmountStr] = useState("");
  const [targetQuoteStr, setTargetQuoteStr] = useState("");
  const [requestLabel, setRequestLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    if (!budgetIdInput.trim()) {
      setResult({ ok: false, message: "Budget id (hex or label) is required" });
      return;
    }
    const assetNum = parseFloat(assetAmountStr || "0");
    const quoteNum = parseFloat(targetQuoteStr || "0");
    if (kind === 0 && (!(assetNum > 0) || !(quoteNum > 0))) {
      setResult({
        ok: false,
        message: "Commitment sale requires both asset amount AND target quote > 0",
      });
      return;
    }
    const assetBase = isFinite(assetNum) ? Math.round(assetNum * Math.pow(10, ASSET_DECIMALS)) : 0;
    const quoteBase = isFinite(quoteNum) ? Math.round(quoteNum * Math.pow(10, QUOTE_DECIMALS)) : 0;

    setSubmitting(true);
    try {
      const callCreate = () =>
        api.fundingRequestCreate({
          entity_id: trustId,
          kind,
          budget_id: budgetIdInput.trim(),
          asset_amount: assetBase,
          target_quote: quoteBase,
          request_label: requestLabel.trim() || undefined,
        });

      try {
        const res = await callCreate();
        setResult({
          ok: true,
          message: `Round declared — ${res.request_id_hex.slice(0, 14)}…`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/funding_module|module_state|account.*not.*found|AccountNotInitialized/i.test(msg)) {
          await api.fundingModuleInit({ entity_id: trustId });
          const res = await callCreate();
          setResult({
            ok: true,
            message: `Round declared — ${res.request_id_hex.slice(0, 14)}…`,
          });
        } else {
          throw err;
        }
      }
      setBudgetIdInput("");
      setAssetAmountStr("");
      setTargetQuoteStr("");
      setRequestLabel("");
    } catch (err: unknown) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const activeKind = KIND_OPTIONS.find((k) => k.value === kind);

  return (
    <PageSection
      title="Funding round"
      description="Declare an on-chain capital raise sourced from a Budget. Activation lands separately."
    >
      <form className="equity-funding-form" onSubmit={handleSubmit}>
        <div className="equity-funding-row">
          <label className="equity-funding-label" htmlFor="equity-funding-kind">
            Kind
          </label>
          <Select
            id="equity-funding-kind"
            value={String(kind)}
            onChange={(v) => setKind(Number(v) as FundingKind)}
            disabled={submitting}
            options={KIND_OPTIONS.map((opt) => ({
              value: String(opt.value),
              label: opt.label,
            }))}
          />
          {activeKind && <span className="equity-funding-help">{activeKind.help}</span>}
        </div>
        <div className="equity-funding-row">
          <label className="equity-funding-label" htmlFor="equity-funding-budget">
            Budget id <span className="equity-funding-optional">(hex or label)</span>
          </label>
          <Input
            id="equity-funding-budget"
            type="text"
            placeholder="0x… or a budget label"
            value={budgetIdInput}
            onChange={(e) => setBudgetIdInput(e.currentTarget.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="equity-funding-grid">
          <div className="equity-funding-row">
            <label className="equity-funding-label" htmlFor="equity-funding-asset">
              Asset amount{" "}
              {kind !== 0 && <span className="equity-funding-optional">(optional)</span>}
            </label>
            <Input
              id="equity-funding-asset"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={assetAmountStr}
              onChange={(e) => setAssetAmountStr(e.currentTarget.value)}
              disabled={submitting}
            />
          </div>
          <div className="equity-funding-row">
            <label className="equity-funding-label" htmlFor="equity-funding-quote">
              Target quote (USDC){" "}
              {kind !== 0 && <span className="equity-funding-optional">(optional)</span>}
            </label>
            <Input
              id="equity-funding-quote"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={targetQuoteStr}
              onChange={(e) => setTargetQuoteStr(e.currentTarget.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div className="equity-funding-row">
          <label className="equity-funding-label" htmlFor="equity-funding-label">
            Round label <span className="equity-funding-optional">(optional)</span>
          </label>
          <Input
            id="equity-funding-label"
            type="text"
            placeholder="seed-2026, strategic-partner …"
            value={requestLabel}
            onChange={(e) => setRequestLabel(e.currentTarget.value)}
            disabled={submitting}
          />
        </div>
        <div className="equity-funding-actions">
          <Button type="submit" variant="primary" size="md" loading={submitting}>
            Declare round
          </Button>
        </div>
        {result && (
          <div
            className={`equity-funding-result ${result.ok ? "equity-funding-result-ok" : "equity-funding-result-err"}`}
          >
            {result.ok ? `✓ ${result.message}` : result.message}
          </div>
        )}
      </form>
    </PageSection>
  );
}
