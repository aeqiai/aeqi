/**
 * ActivatedRoundLedger — iter-10 functional gap.
 *
 * Reads the underlying Unifutures primitive (`sale` / `curve` / `exit`)
 * backing an activated FundingRequest and renders a one-line headline
 * + collapsible detail block. Lives below the activated row in
 * `EquityFundingRoundControl`'s DeclaredRoundsList.
 *
 *   - CommitmentSale: commitments_collected (count) +
 *     proceeds_collected (USDC sum) / target_quote.
 *   - BondingCurve:   current_supply (tokens sold) / max_supply,
 *     reserve_balance (USDC).
 *   - Exit:           PDA only — exit account fields land in a follow-up
 *     Anchor IDL update.
 *
 * Fetches eagerly so the headline can already show counters before the
 * operator clicks the row open. The hook is keyed on the round's
 * `primitive_id` so React Query keeps the read warm across renders.
 *
 * Extracted into its own file (vs inlined in EquityFundingRoundControl)
 * to keep the parent component under the 600-line lint ceiling and to
 * mirror the project's "one feature, one file" cap-table extraction
 * pattern (see `CapTableSection` and `HolderDrawer`).
 */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { useDaemonStore } from "@/store/daemon";
import { useFundingPrimitive } from "@/hooks/useFundingPrimitive";
import type { FundingRequestWithPda } from "@/solana";

// Decimal scales mirror the canonical token + USDC mint shape used by
// the platform (`asset_amount` is u64 base units against the LAUNCH
// 6-decimal mint; `target_quote` is u64 base units against the 6-decimal
// USDC mint). Mirrors the constants in EquityFundingRoundControl.
const ASSET_DECIMALS = 6;
const QUOTE_DECIMALS = 6;
const ASSET_SCALE = 10n ** BigInt(ASSET_DECIMALS);
const QUOTE_SCALE = 10n ** BigInt(QUOTE_DECIMALS);

export interface ActivatedRoundLedgerProps {
  companyId: string;
  round: FundingRequestWithPda;
}

export function ActivatedRoundLedger({ companyId, round }: ActivatedRoundLedgerProps) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === companyId), [entities, companyId]);
  const companyAddress = entity?.company_address ?? null;

  const kind = Number(round.account.kind);
  const primitiveIdHex = fullRequestId(round.account.primitiveId);
  const [expanded, setExpanded] = useState(false);

  // Iter-10: fetch eagerly even when collapsed so the headline already
  // shows "12 commitments · 4,200 / 10,000 USDC raised". One cheap
  // fetchNullable per activated round on cold load; RQ keeps it warm
  // for 15s afterwards.
  const { primitive, isLoading } = useFundingPrimitive(companyAddress, kind, primitiveIdHex, true);

  let headline: string;
  let detail: React.ReactNode = null;
  if (isLoading && !primitive) {
    headline = "Reading on-chain ledger…";
  } else if (!primitive) {
    headline = "Ledger not yet visible on chain";
  } else if (primitive.kind === "commitment_sale") {
    const sale = primitive.account;
    const commits = bnLikeToBigInt(sale.commitmentsCollected);
    const proceeds = bnLikeToBigInt(sale.proceedsCollected);
    const target = bnLikeToBigInt(sale.targetQuote);
    headline = `${commits.toString()} ${commits === 1n ? "commitment" : "commitments"} · ${formatScaled(proceeds, QUOTE_SCALE)} / ${formatScaled(target, QUOTE_SCALE)} USDC raised`;
    detail = (
      <dl className="equity-funding-declared__ledgerMeta">
        <div>
          <dt>Commitments</dt>
          <dd>{commits.toString()}</dd>
        </div>
        <div>
          <dt>Proceeds collected</dt>
          <dd>{formatScaled(proceeds, QUOTE_SCALE)} USDC</dd>
        </div>
        <div>
          <dt>Target quote</dt>
          <dd>{formatScaled(target, QUOTE_SCALE)} USDC</dd>
        </div>
        <div>
          <dt>Overflow</dt>
          <dd>{formatScaled(bnLikeToBigInt(sale.overflowQuote), QUOTE_SCALE)} USDC</dd>
        </div>
        <div>
          <dt>Sale PDA</dt>
          <dd className="equity-funding-declared__ledgerMono" title={primitive.address.toBase58()}>
            {shortPubkey(primitive.address.toBase58())}
          </dd>
        </div>
      </dl>
    );
  } else if (primitive.kind === "bonding_curve") {
    const curve = primitive.account;
    const currentSupply = bnLikeToBigInt(curve.currentSupply);
    const maxSupply = bnLikeToBigInt(curve.maxSupply);
    const reserve = bnLikeToBigInt(curve.reserveBalance);
    const proceeds = bnLikeToBigInt(curve.proceedsCollected);
    headline = `${formatScaled(currentSupply, ASSET_SCALE)} / ${formatScaled(maxSupply, ASSET_SCALE)} sold · ${formatScaled(reserve, QUOTE_SCALE)} USDC reserve`;
    detail = (
      <dl className="equity-funding-declared__ledgerMeta">
        <div>
          <dt>Current supply</dt>
          <dd>{formatScaled(currentSupply, ASSET_SCALE)}</dd>
        </div>
        <div>
          <dt>Max supply</dt>
          <dd>{formatScaled(maxSupply, ASSET_SCALE)}</dd>
        </div>
        <div>
          <dt>Reserve balance</dt>
          <dd>{formatScaled(reserve, QUOTE_SCALE)} USDC</dd>
        </div>
        <div>
          <dt>Proceeds collected</dt>
          <dd>{formatScaled(proceeds, QUOTE_SCALE)} USDC</dd>
        </div>
        <div>
          <dt>Curve PDA</dt>
          <dd className="equity-funding-declared__ledgerMono" title={primitive.address.toBase58()}>
            {shortPubkey(primitive.address.toBase58())}
          </dd>
        </div>
      </dl>
    );
  } else {
    headline = "Exit primitive activated";
    detail = (
      <dl className="equity-funding-declared__ledgerMeta">
        <div>
          <dt>Exit PDA</dt>
          <dd className="equity-funding-declared__ledgerMono" title={primitive.address.toBase58()}>
            {shortPubkey(primitive.address.toBase58())}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <div className="equity-funding-declared__ledger">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="equity-funding-declared__ledgerToggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`ledger-${round.publicKey.toBase58()}`}
      >
        <span aria-hidden="true" className="equity-funding-declared__ledgerChevron">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="equity-funding-declared__ledgerHeadline">{headline}</span>
      </Button>
      {expanded && detail && (
        <div
          id={`ledger-${round.publicKey.toBase58()}`}
          className="equity-funding-declared__ledgerBody"
        >
          {detail}
        </div>
      )}
    </div>
  );
}

/* Helpers — local copies so the sub-component doesn't depend on parent
   re-exports. Same shape as the helpers in EquityFundingRoundControl. */

function shortPubkey(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
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

function fullRequestId(bytes: number[] | Uint8Array | undefined): string {
  if (!bytes) return "—";
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  return (
    "0x" + arr.map((b) => (typeof b === "number" ? b : 0).toString(16).padStart(2, "0")).join("")
  );
}
