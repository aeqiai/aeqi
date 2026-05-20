import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Button, Input, PageSection } from "@/components/ui";
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

  const mintBaseUnits = useMemo(() => toBaseUnits(mintAmount), [mintAmount]);
  const transferBaseUnits = useMemo(() => toBaseUnits(transferAmount), [transferAmount]);
  const burnBaseUnits = useMemo(() => toBaseUnits(burnAmount), [burnAmount]);

  const recipientLooksValid = (s: string) => {
    const trimmed = s.trim();
    // Solana base58 pubkeys are 32-44 chars. Loose check; server validates.
    return trimmed.length >= 32 && trimmed.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
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
    <PageSection title="Share controls" description="Mint, transfer, and burn cap-table tokens.">
      <div className="share-control-row">
        <Input
          label="Mint to"
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
        <Button
          variant="primary"
          size="sm"
          loading={minting}
          disabled={mintBaseUnits === null || !recipientLooksValid(mintRecipient)}
          onClick={handleMint}
        >
          Mint
        </Button>
        <TradeStatus
          signature={mintSignature}
          error={mintError}
          idle="Issues new LAUNCH to the recipient's ATA (owner-only)."
        />
      </div>
      <div className="share-control-row">
        <Input
          label="Transfer to"
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
        <Button
          variant="secondary"
          size="sm"
          loading={transferring}
          disabled={transferBaseUnits === null || !recipientLooksValid(transferRecipient)}
          onClick={handleTransfer}
        >
          Transfer
        </Button>
        <TradeStatus
          signature={transferSignature}
          error={transferError}
          idle="Moves LAUNCH from your ATA to the recipient's ATA."
        />
      </div>
      <div className="share-control-row">
        <Input
          label="Burn amount"
          inputMode="decimal"
          placeholder="0.0"
          value={burnAmount}
          onChange={(e) => setBurnAmount(e.target.value)}
          disabled={burning}
          size="sm"
        />
        <Button
          variant="danger"
          size="sm"
          loading={burning}
          disabled={burnBaseUnits === null}
          onClick={handleBurn}
        >
          Burn
        </Button>
        <TradeStatus
          signature={burnSignature}
          error={burnError}
          idle="Destroys LAUNCH from your ATA permanently."
        />
      </div>
    </PageSection>
  );
}

function TradeStatus({
  signature,
  error,
  idle,
}: {
  signature: string | null;
  error: string | null;
  idle: string;
}) {
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
  return <span className="share-control-status">{idle}</span>;
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
