import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Input, Modal, PageSection, Select } from "@/components/ui";
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
      <DeclaredRoundsList rounds={sortedRounds} trustId={trustId} />
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

/* ────────────────────────────────────────────────────────────────── */
/* Activation modal — explains the kind-specific activation paths,    */
/* posts to the (honest-stub) `/api/solana/funding-activate` endpoint */
/* and surfaces success/failure inline. Iter-3 lands the UI; backend  */
/* route name is the contract a follow-up wire-up will fulfil.        */
/* ────────────────────────────────────────────────────────────────── */

const ACTIVATION_KIND_COPY: Record<number, { headline: string; explainer: string }> = {
  0: {
    headline: "Open the deposit window",
    explainer:
      "Commitment sale activation mints the escrow ATA at target_quote and accepts contributor deposits until the target is filled. Pricing is fixed at the declared asset_amount / target_quote ratio.",
  },
  1: {
    headline: "Boot a fresh bonding curve",
    explainer:
      "Bonding-curve activation deploys a new BondingCurve PDA (separate from the genesis curve) with the round's parameters. Buy/Sell against the curve unlocks after this lands.",
  },
  2: {
    headline: "Open pro-rata redemption",
    explainer:
      "Exit activation opens pro-rata redemption from the treasury reserve into the activation quote token. Holders burn shares against the reserve until the round is finalized.",
  },
};

function ActivateRoundModal({
  open,
  onClose,
  trustId,
  round,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  trustId: string;
  round: FundingRequestWithPda | null;
  /**
   * Iter-7: fire after a successful activation so the parent
   * `DeclaredRoundsList` can optimistically flip the row from Pending
   * to Activated and surface the activation signature without waiting
   * for the on-chain status field to refresh.
   */
  onActivated?: (info: { requestIdHex: string; signatureB58: string }) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Reset state every time a fresh round opens; closing the modal also
  // clears, so re-opening for the same row doesn't show stale messaging.
  const handleClose = () => {
    setResult(null);
    setSubmitting(false);
    onClose();
  };

  if (!round) return null;
  const kind = Number(round.account.kind);
  const copy = ACTIVATION_KIND_COPY[kind] ?? {
    headline: `Activate kind ${kind}`,
    explainer: "Activation path for this round kind is not documented yet.",
  };
  const requestIdHex = fullRequestId(round.account.requestId);

  const handleActivate = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.fundingActivate({
        entity_id: trustId,
        request_id: requestIdHex,
      });
      setResult({
        ok: true,
        message: `Activated — ${res.signature_b58.slice(0, 12)}…`,
      });
      // Iter-7: notify parent so the DeclaredRoundsList row flips from
      // Pending → Activated immediately. The on-chain status field
      // catches up on the next refetch; the optimistic flip removes the
      // stale "Pending" badge until then.
      onActivated?.({ requestIdHex, signatureB58: res.signature_b58 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ ok: false, message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Activate round">
      <div className="equity-funding-activate">
        <div className="equity-funding-activate__head">
          <Badge variant="warning" size="sm">
            {KIND_LABELS[kind] ?? `Kind ${kind}`}
          </Badge>
          <span className="equity-funding-activate__requestId" title={requestIdHex}>
            {formatRequestId(round.account.requestId)}
          </span>
        </div>
        <h3 className="equity-funding-activate__headline">{copy.headline}</h3>
        <p className="equity-funding-activate__explainer">{copy.explainer}</p>
        <dl className="equity-funding-activate__meta">
          <div>
            <dt>Asset amount</dt>
            <dd>{formatScaled(bnLikeToBigInt(round.account.assetAmount), ASSET_SCALE)}</dd>
          </div>
          <div>
            <dt>Target quote</dt>
            <dd>{formatScaled(bnLikeToBigInt(round.account.targetQuote), QUOTE_SCALE)} USDC</dd>
          </div>
        </dl>
        {result && (
          <div
            className={
              result.ok
                ? "equity-funding-result equity-funding-result-ok"
                : "equity-funding-result equity-funding-result-err"
            }
            role="status"
          >
            {result.ok ? `✓ ${result.message}` : result.message}
          </div>
        )}
        <div className="equity-funding-activate__actions">
          <Button variant="ghost" size="md" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="md" loading={submitting} onClick={handleActivate}>
            Activate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeclaredRoundsList({
  rounds,
  trustId,
}: {
  rounds: FundingRequestWithPda[];
  trustId: string;
}) {
  const [activating, setActivating] = useState<FundingRequestWithPda | null>(null);

  /**
   * Iter-7: optimistic activation map. Keyed on the full request_id hex
   * so the row flip survives even if the parent re-orders the rounds
   * array (sortedRounds upstream re-evaluates on every render). Value
   * carries the activation signature — surfaced below the row as the
   * activated-primitive's address until the on-chain status catches up
   * and `r.account.status` returns 1 (Activated) on the next fetch.
   *
   * The map is intentionally session-local. A page refresh re-reads the
   * canonical on-chain status; this only bridges the gap between
   * "platform endpoint settled" and "RPC indexer refreshed". Honest:
   * activation succeeded; we don't pretend it's a finalized round yet.
   */
  const [activatedLocal, setActivatedLocal] = useState<Record<string, string>>({});

  /**
   * Iter-8: hide-history toggle. Once a TRUST has been operating for a
   * while the declared-rounds list grows past the visible top —
   * cancelled and finalized rounds are historical record, not active
   * work. Default ON so the operator opens the section to "what's live
   * RIGHT NOW", flipping the toggle reveals the full history.
   *
   * Honored against the same `effectiveStatus` the badge uses, so
   * optimistically-activated rounds count as Activated for the filter
   * (they wouldn't disappear when the toggle is on; they're live).
   */
  const [hideHistory, setHideHistory] = useState(true);

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

  // Pre-compute statuses for hide-history filtering. Mirrors the
  // optimistic-flip logic below so the toggle's "live" definition is
  // the same as the rendered badge: a row that the operator just
  // activated stays visible even when hide-history is on.
  const rowsWithStatus = rounds.map((r) => {
    const requestIdHex = fullRequestId(r.account.requestId);
    const optimisticSig = activatedLocal[requestIdHex];
    const rawStatus = Number(r.account.status);
    const effectiveStatus = optimisticSig && rawStatus === 0 ? 1 : rawStatus;
    return { round: r, effectiveStatus, optimisticSig, requestIdHex };
  });

  const historyCount = rowsWithStatus.filter(
    (rs) => rs.effectiveStatus === 2 || rs.effectiveStatus === 3,
  ).length;
  const visibleRows = hideHistory
    ? rowsWithStatus.filter((rs) => rs.effectiveStatus !== 2 && rs.effectiveStatus !== 3)
    : rowsWithStatus;

  return (
    <div className="equity-funding-declared">
      <div className="equity-funding-declared__titleRow">
        <h3 className="equity-funding-declared__title">Declared rounds</h3>
        {historyCount > 0 && (
          /* Iter-8: history toggle. Ghost Button keeps the chrome quiet
             while inheriting the audited primitive styling. Label flips
             between states so the affordance reads as "do this next". */
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="equity-funding-declared__historyToggle"
            onClick={() => setHideHistory((v) => !v)}
            aria-pressed={!hideHistory}
          >
            {hideHistory ? `Show history (${historyCount} cancelled/finalized)` : "Hide history"}
          </Button>
        )}
      </div>
      {visibleRows.length === 0 ? (
        <div className="equity-funding-declared__emptyFiltered">
          All declared rounds are cancelled or finalized. Flip "Show history" to read the trail.
        </div>
      ) : (
        <ul className="equity-funding-declared__list">
          {visibleRows.map(({ round: r, effectiveStatus, optimisticSig, requestIdHex }) => {
            const kind = Number(r.account.kind);
            const badge = statusBadgeFor(effectiveStatus);
            const assetRaw = bnLikeToBigInt(r.account.assetAmount);
            const quoteRaw = bnLikeToBigInt(r.account.targetQuote);
            const requestId = formatRequestId(r.account.requestId);
            const isPending = effectiveStatus === 0;
            return (
              <li key={r.publicKey.toBase58()} className="equity-funding-declared__row">
                <div className="equity-funding-declared__head">
                  <span className="equity-funding-declared__kind">
                    {KIND_LABELS[kind] ?? `Kind ${kind}`}
                  </span>
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
                  {isPending && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="equity-funding-declared__activateBtn"
                      onClick={() => setActivating(r)}
                    >
                      Activate…
                    </Button>
                  )}
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
                    title={requestIdHex}
                  >
                    {requestId}
                  </span>
                </div>
                {optimisticSig && (
                  /* Iter-7: surface the activation signature so the operator
                     can verify the transaction on the explorer. Compact
                     `equity-funding-result-ok` jade tint mirrors the same
                     "settled" affordance used after Buy/Sell. */
                  <div
                    className="equity-funding-declared__activatedRow"
                    role="status"
                    title={optimisticSig}
                  >
                    <span className="equity-funding-declared__activatedLabel">
                      Activated this session
                    </span>
                    <span className="equity-funding-declared__activatedSig">
                      {optimisticSig.slice(0, 6)}…{optimisticSig.slice(-4)}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ActivateRoundModal
        open={activating !== null}
        onClose={() => setActivating(null)}
        trustId={trustId}
        round={activating}
        onActivated={({ requestIdHex, signatureB58 }) =>
          setActivatedLocal((m) => ({ ...m, [requestIdHex]: signatureB58 }))
        }
      />
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
