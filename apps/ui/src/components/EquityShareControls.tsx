import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Button, ConfirmDialog, Input, PageSection } from "@/components/ui";
import { EQUITY_ANCHORS, useEquityPrefill } from "@/components/equity/equityPrefillContext";
import "./EquityShareControls.css";

/**
 * Equity share controls — mint / transfer / burn LAUNCH tokens via the
 * platform's three token endpoints (ja-019: `/api/solana/token-mint`,
 * `/token-burn`, `/token-transfer`).
 *
 * Mint is authority-gated: the on-chain `aeqi_token::mint_tokens` ix
 * enforces `signer == trust.authority`, so the form only renders when
 * the current viewer is the placement creator. Transfer + Burn are
 * user-self actions and always render — they operate on the caller's
 * own ATA.
 *
 * Decimals hardcoded to 6 (canonical `aeqi-token` default per
 * `DEFAULT_TOKEN_DECIMALS`). If the on-chain default ever changes, this
 * constant should move into a shared `solana/constants` module.
 */
const TOKEN_DECIMALS = 6;

interface EquityShareControlsProps {
  trustId: string;
}

export function EquityShareControls({ trustId }: EquityShareControlsProps) {
  // Note: the Mint form renders unconditionally. The on-chain
  // `aeqi_token::mint_tokens` instruction gates by signer == trust.authority,
  // and the platform endpoint additionally gates to the placement owner.
  // Non-owners hitting Mint get a 403; the error surfaces in the status
  // line below the button. v2 can hide the form when the daemon-store
  // entity carries an `owner_user_id` field — it doesn't yet.

  const [mintRecipient, setMintRecipient] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [minting, setMinting] = useState(false);
  const [mintSignature, setMintSignature] = useState<string | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);

  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferSignature, setTransferSignature] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [burnAmount, setBurnAmount] = useState("");
  const [burning, setBurning] = useState(false);
  const [burnSignature, setBurnSignature] = useState<string | null>(null);
  const [burnError, setBurnError] = useState<string | null>(null);

  // Iter-10: preview-and-confirm gate. Each card opens a ConfirmDialog
  // summarising the action ("Mint 1,000 LAUNCH to 3DvL…") before firing
  // the chain call. The dialog's Continue button is the actual submit;
  // Cancel closes without touching chain. Adds one safe gesture between
  // the operator's intent and an irreversible on-chain settlement —
  // matches the "every control does what its visual weight promises"
  // discipline (the form's submit weight = "summary first, then ship").
  const [preview, setPreview] = useState<
    | { kind: "mint"; recipient: string; amountDisplay: string }
    | { kind: "transfer"; recipient: string; amountDisplay: string }
    | { kind: "burn"; amountDisplay: string }
    | null
  >(null);

  // Cap-table → ShareControls prefill: each row-menu selection updates
  // the prefill nonce, which we depend on so identical addresses still
  // re-prefill (clicking the same holder twice should still highlight
  // the target field).
  const { prefill } = useEquityPrefill();
  useEffect(() => {
    if (prefill.mintTo) setMintRecipient(prefill.mintTo);
    if (prefill.transferTo) setTransferRecipient(prefill.transferTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.nonce]);

  const mintBaseUnits = useMemo(() => toBaseUnits(mintAmount), [mintAmount]);
  const transferBaseUnits = useMemo(() => toBaseUnits(transferAmount), [transferAmount]);
  const burnBaseUnits = useMemo(() => toBaseUnits(burnAmount), [burnAmount]);

  const recipientLooksValid = (s: string) => {
    const trimmed = s.trim();
    // Solana base58 pubkeys are 32-44 chars. Loose check; server validates.
    return trimmed.length >= 32 && trimmed.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
  };

  // Iter-10: requesting an action opens the preview gate. Each card's
  // submit button calls one of these instead of firing the chain call
  // inline. Cheap validation runs here so the preview only opens when
  // the action would actually fire.
  const requestMint = () => {
    if (mintBaseUnits === null || !recipientLooksValid(mintRecipient)) return;
    setPreview({
      kind: "mint",
      recipient: mintRecipient.trim(),
      amountDisplay: mintAmount.trim(),
    });
  };
  const requestTransfer = () => {
    if (transferBaseUnits === null || !recipientLooksValid(transferRecipient)) return;
    setPreview({
      kind: "transfer",
      recipient: transferRecipient.trim(),
      amountDisplay: transferAmount.trim(),
    });
  };
  const requestBurn = () => {
    if (burnBaseUnits === null) return;
    setPreview({ kind: "burn", amountDisplay: burnAmount.trim() });
  };

  const handleMint = async () => {
    if (mintBaseUnits === null || !recipientLooksValid(mintRecipient)) return;
    setMinting(true);
    setMintError(null);
    setMintSignature(null);
    try {
      const result = await api.tokenMint({
        entity_id: trustId,
        recipient_pubkey: mintRecipient.trim(),
        amount: Number(mintBaseUnits),
      });
      setMintSignature(result.signature_b58);
      setMintRecipient("");
      setMintAmount("");
    } catch (err) {
      setMintError(err instanceof Error ? err.message : "Mint failed.");
    } finally {
      setMinting(false);
    }
  };

  const handleTransfer = async () => {
    if (transferBaseUnits === null || !recipientLooksValid(transferRecipient)) return;
    setTransferring(true);
    setTransferError(null);
    setTransferSignature(null);
    try {
      const result = await api.tokenTransfer({
        entity_id: trustId,
        recipient_pubkey: transferRecipient.trim(),
        amount: Number(transferBaseUnits),
      });
      setTransferSignature(result.signature_b58);
      setTransferRecipient("");
      setTransferAmount("");
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setTransferring(false);
    }
  };

  const handleBurn = async () => {
    if (burnBaseUnits === null) return;
    setBurning(true);
    setBurnError(null);
    setBurnSignature(null);
    try {
      const result = await api.tokenBurn({
        entity_id: trustId,
        amount: Number(burnBaseUnits),
      });
      setBurnSignature(result.signature_b58);
      setBurnAmount("");
    } catch (err) {
      setBurnError(err instanceof Error ? err.message : "Burn failed.");
    } finally {
      setBurning(false);
    }
  };

  return (
    <PageSection
      id={EQUITY_ANCHORS.shareControls}
      title="Share controls"
      description="Mint, transfer, and burn cap-table tokens."
    >
      {/* Iter-6: 3-card grid (Mint · Transfer · Burn). Each card has
          identical structure — title, one-line copy, form fields,
          submit. The forms previously rendered as rows of unequal
          width and shape because Burn has one field where Mint and
          Transfer have two; the grid + min-height fix that without
          forcing Burn to fake a second field. */}
      <div className="share-control-grid">
        <ShareControlCard
          title="Mint"
          description="Issue new LAUNCH to a recipient's ATA. Owner-only — non-owners receive a 403."
          submitLabel="Mint"
          submitVariant="primary"
          loading={minting}
          disabled={mintBaseUnits === null || !recipientLooksValid(mintRecipient)}
          onSubmit={requestMint}
          signature={mintSignature}
          error={mintError}
        >
          <Input
            label="Recipient"
            placeholder="recipient pubkey"
            value={mintRecipient}
            onChange={(e) => setMintRecipient(e.target.value)}
            disabled={minting}
            size="sm"
          />
          <Input
            label="Amount"
            inputMode="decimal"
            placeholder="0.0"
            value={mintAmount}
            onChange={(e) => setMintAmount(e.target.value)}
            disabled={minting}
            size="sm"
          />
        </ShareControlCard>
        <ShareControlCard
          title="Transfer"
          description="Move LAUNCH from your ATA to a recipient's ATA. Any holder can transfer their own balance."
          submitLabel="Transfer"
          submitVariant="secondary"
          loading={transferring}
          disabled={transferBaseUnits === null || !recipientLooksValid(transferRecipient)}
          onSubmit={requestTransfer}
          signature={transferSignature}
          error={transferError}
        >
          <Input
            label="Recipient"
            placeholder="recipient pubkey"
            value={transferRecipient}
            onChange={(e) => setTransferRecipient(e.target.value)}
            disabled={transferring}
            size="sm"
          />
          <Input
            label="Amount"
            inputMode="decimal"
            placeholder="0.0"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            disabled={transferring}
            size="sm"
          />
        </ShareControlCard>
        <ShareControlCard
          title="Burn"
          description="Destroy LAUNCH from your ATA permanently. Reduces total supply by the burned amount."
          submitLabel="Burn"
          submitVariant="danger"
          loading={burning}
          disabled={burnBaseUnits === null}
          onSubmit={requestBurn}
          signature={burnSignature}
          error={burnError}
        >
          <Input
            label="Amount"
            inputMode="decimal"
            placeholder="0.0"
            value={burnAmount}
            onChange={(e) => setBurnAmount(e.target.value)}
            disabled={burning}
            size="sm"
          />
        </ShareControlCard>
      </div>
      <ConfirmDialog
        open={preview !== null}
        onClose={() => {
          // Don't allow closing while a chain call is mid-flight — the
          // confirm button itself owns the loading state.
          if (minting || transferring || burning) return;
          setPreview(null);
        }}
        title={
          preview?.kind === "mint"
            ? "Preview mint"
            : preview?.kind === "transfer"
              ? "Preview transfer"
              : preview?.kind === "burn"
                ? "Preview burn"
                : "Preview"
        }
        confirmLabel={
          preview?.kind === "mint"
            ? "Continue · mint"
            : preview?.kind === "transfer"
              ? "Continue · transfer"
              : preview?.kind === "burn"
                ? "Continue · burn"
                : "Continue"
        }
        destructive={preview?.kind === "burn"}
        loading={minting || transferring || burning}
        message={<PreviewBody preview={preview} />}
        onConfirm={async () => {
          if (!preview) return;
          if (preview.kind === "mint") {
            await handleMint();
          } else if (preview.kind === "transfer") {
            await handleTransfer();
          } else {
            await handleBurn();
          }
          setPreview(null);
        }}
      />
    </PageSection>
  );
}

/**
 * Iter-10: human-readable preview body for ConfirmDialog. Renders the
 * action verb, formatted amount (with the LAUNCH ticker so the operator
 * doesn't have to mental-math base units), and recipient where
 * applicable. Burn additionally surfaces the destructive-tone copy.
 *
 * Honest scope: no client-side balance check (the cap-table fetch is
 * decoupled from this section), and no on-chain fee estimate (the
 * platform endpoint pays the network fee from the trust authority's
 * fee-payer key — operators don't sign with their own SOL). The preview
 * is "what's about to happen", not "what will it cost".
 */
function PreviewBody({
  preview,
}: {
  preview:
    | { kind: "mint"; recipient: string; amountDisplay: string }
    | { kind: "transfer"; recipient: string; amountDisplay: string }
    | { kind: "burn"; amountDisplay: string }
    | null;
}) {
  if (!preview) return null;
  if (preview.kind === "mint") {
    return (
      <div className="share-control-preview">
        <p className="share-control-preview__line">
          Mint <strong>{preview.amountDisplay} LAUNCH</strong> to{" "}
          <span className="share-control-preview__mono">{formatPubkey(preview.recipient)}</span>.
        </p>
        <p className="share-control-preview__hint">
          Expands the cap-table supply by this amount. Owner-only · the trust authority pays the
          network fee.
        </p>
      </div>
    );
  }
  if (preview.kind === "transfer") {
    return (
      <div className="share-control-preview">
        <p className="share-control-preview__line">
          Transfer <strong>{preview.amountDisplay} LAUNCH</strong> from your ATA to{" "}
          <span className="share-control-preview__mono">{formatPubkey(preview.recipient)}</span>.
        </p>
        <p className="share-control-preview__hint">
          Moves shares between holders without changing total supply.
        </p>
      </div>
    );
  }
  return (
    <div className="share-control-preview">
      <p className="share-control-preview__line">
        Burn <strong>{preview.amountDisplay} LAUNCH</strong> from your ATA.
      </p>
      <p className="share-control-preview__hint">
        Permanently reduces total supply by this amount. This cannot be reversed.
      </p>
    </div>
  );
}

function formatPubkey(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Iter-6: shared 3-card wrapper for Mint / Transfer / Burn. Locks the
 * vertical structure so the three forms read as one workspace — same
 * title weight, same description height (clamped by CSS min-height so
 * a short Burn copy doesn't collapse the grid row), same submit
 * placement, same status-line affordance. The form fields themselves
 * are passed in as children so each action keeps its own field shape.
 */
function ShareControlCard({
  title,
  description,
  submitLabel,
  submitVariant,
  loading,
  disabled,
  onSubmit,
  signature,
  error,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  submitVariant: "primary" | "secondary" | "danger";
  loading: boolean;
  disabled: boolean;
  onSubmit: () => void;
  signature: string | null;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="share-control-card">
      <div className="share-control-card__header">
        <span className="share-control-card__title">{title}</span>
        <span className="share-control-card__description">{description}</span>
      </div>
      <div className="share-control-card__form">{children}</div>
      <Button
        className="share-control-card__submit"
        variant={submitVariant}
        size="sm"
        loading={loading}
        disabled={disabled}
        onClick={onSubmit}
      >
        {submitLabel}
      </Button>
      <TradeStatus signature={signature} error={error} />
    </div>
  );
}

/**
 * Iter-6: idle copy moved into the card description above, so this
 * status line renders one of three states: signature (jade), error
 * (red), or an empty placeholder that reserves the row height so the
 * grid doesn't jump on submit. Min-height in the CSS holds the layout
 * even when the line is empty.
 */
function TradeStatus({ signature, error }: { signature: string | null; error: string | null }) {
  if (signature) {
    return (
      <span className="share-control-status share-control-status--signature">
        ✓ Settled · {formatSignature(signature)}
      </span>
    );
  }
  if (error) {
    return <span className="share-control-status share-control-status--error">{error}</span>;
  }
  return (
    <span className="share-control-status" aria-hidden="true">
      &nbsp;
    </span>
  );
}

/**
 * Parse a user-facing decimal string into raw u64 base units against the
 * canonical 6-decimal mint. Returns null for empty / invalid / zero
 * input — caller uses this to gate the action button.
 */
function toBaseUnits(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [integerPart, fractionalPart = ""] = trimmed.split(".");
  const padded = fractionalPart.padEnd(TOKEN_DECIMALS, "0").slice(0, TOKEN_DECIMALS);
  const combined = `${integerPart}${padded}`.replace(/^0+(?=\d)/, "");
  try {
    const value = BigInt(combined);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

function formatSignature(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}
