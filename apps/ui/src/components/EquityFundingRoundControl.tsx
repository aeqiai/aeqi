import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Input, PageSection, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { FundingRequestWithPda } from "@/solana";
import "./EquityFundingRoundControl.css";

interface EquityFundingRoundControlProps {
  trustId: string;
  /** Declared funding rounds for this TRUST (on-chain reads). */
  declaredRounds?: FundingRequestWithPda[];
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
export default function EquityFundingRoundControl({
  trustId,
  declaredRounds = [],
}: EquityFundingRoundControlProps) {
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

  // Sort declared rounds by createdAt desc so the most recent declaration
  // sits at the top. `createdAt` is an i64 unix seconds; Anchor surfaces
  // it as a BN-like — coerce via `Number()` (safe for any practical
  // timestamp). If the field is bigint at runtime, `Number()` still works
  // for values well under 2^53.
  const sortedRounds = useMemo(() => {
    return [...declaredRounds].sort((a, b) => {
      const ta = Number(a.account.createdAt?.toString?.() ?? a.account.createdAt ?? 0);
      const tb = Number(b.account.createdAt?.toString?.() ?? b.account.createdAt ?? 0);
      return tb - ta;
    });
  }, [declaredRounds]);

  return (
    <PageSection
      title="Funding round"
      description="Declare an on-chain capital raise sourced from a Budget. Activation lands separately."
    >
      <DeclaredRoundsList rounds={sortedRounds} />
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

/* ────────────────────────────────────────────────────────────────── */
/* Declared rounds list                                                */
/* ────────────────────────────────────────────────────────────────── */

const ASSET_SCALE = 10n ** BigInt(ASSET_DECIMALS);
const QUOTE_SCALE = 10n ** BigInt(QUOTE_DECIMALS);

const KIND_LABELS: Record<number, string> = {
  0: "Commitment sale",
  1: "Bonding curve",
  2: "Exit",
};

// On-chain FundingRequest.status enum lives in
// `aeqi-funding/src/state.rs` — current canonical values:
//   0 = Pending, 1 = Activated, 2 = Cancelled, 3 = Finalized.
// Mirror the status colour family the rest of the app uses so the
// declared-rounds row reads at-a-glance.
function statusBadgeFor(status: number): {
  label: string;
  variant: "muted" | "warning" | "success" | "error";
} {
  switch (status) {
    case 0:
      return { label: "Pending", variant: "warning" };
    case 1:
      return { label: "Activated", variant: "success" };
    case 2:
      return { label: "Cancelled", variant: "muted" };
    case 3:
      return { label: "Finalized", variant: "success" };
    default:
      return { label: `Status ${status}`, variant: "muted" };
  }
}

function DeclaredRoundsList({ rounds }: { rounds: FundingRequestWithPda[] }) {
  if (rounds.length === 0) {
    return (
      <div className="equity-funding-declared equity-funding-declared--empty">
        <EmptyState
          title="No rounds declared yet"
          description="Declared rounds appear here once the form below fires. Activation lands separately."
        />
      </div>
    );
  }
  return (
    <div className="equity-funding-declared">
      <h3 className="equity-funding-declared__title">Declared rounds</h3>
      <ul className="equity-funding-declared__list">
        {rounds.map((r) => {
          const kind = Number(r.account.kind);
          const status = Number(r.account.status);
          const badge = statusBadgeFor(status);
          const assetRaw = bnLikeToBigInt(r.account.assetAmount);
          const quoteRaw = bnLikeToBigInt(r.account.targetQuote);
          const requestId = formatRequestId(r.account.requestId);
          return (
            <li key={r.publicKey.toBase58()} className="equity-funding-declared__row">
              <div className="equity-funding-declared__head">
                <span className="equity-funding-declared__kind">
                  {KIND_LABELS[kind] ?? `Kind ${kind}`}
                </span>
                <Badge variant={badge.variant} size="sm">
                  {badge.label}
                </Badge>
              </div>
              <div className="equity-funding-declared__meta">
                <span className="equity-funding-declared__metaItem">
                  Asset · {formatScaled(assetRaw, ASSET_SCALE)}
                </span>
                <span className="equity-funding-declared__metaItem">
                  Target · {formatScaled(quoteRaw, QUOTE_SCALE)} USDC
                </span>
                <span
                  className="equity-funding-declared__metaItem equity-funding-declared__metaItem--mono"
                  title={fullRequestId(r.account.requestId)}
                >
                  {requestId}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (value && typeof (value as { toString: () => string }).toString === "function") {
    try {
      return BigInt((value as { toString: () => string }).toString());
    } catch {
      return 0n;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  return 0n;
}

function formatScaled(amount: bigint, scale: bigint): string {
  if (scale === 0n) return amount.toString();
  const whole = amount / scale;
  const frac = amount % scale;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (frac === 0n) return wholeStr;
  // Trim trailing zeros, cap at 2 decimal places for compactness.
  const fracStr = frac.toString().padStart(ASSET_DECIMALS, "0").slice(0, 2).replace(/0+$/, "");
  return fracStr.length > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
}

function formatRequestId(bytes: number[] | Uint8Array | undefined): string {
  const hex = fullRequestId(bytes);
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-4)}`;
}

function fullRequestId(bytes: number[] | Uint8Array | undefined): string {
  if (!bytes) return "—";
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  return (
    "0x" + arr.map((b) => (typeof b === "number" ? b : 0).toString(16).padStart(2, "0")).join("")
  );
}
