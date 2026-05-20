import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Button, Input, PageSection } from "@/components/ui";
import "./EquityVestingControls.css";

/**
 * Grant a vesting position to a recipient — wires the platform's
 * POST /api/solana/vesting-create endpoint (ja-020). For MVP we expose
 * the linear-cliff schedule only: start_time, cliff_time, end_time as
 * unix-seconds derived from HTML date inputs. The on-chain handler
 * validates the schedule and stores the position keyed by a server-
 * generated random `position_id`.
 *
 * Renders as its own PageSection above the existing read-only vesting
 * list so the table data flow stays untouched. The Claim flow lives in
 * a follow-up ship — the vesting vault must be funded first.
 *
 * Decimals hardcoded to 6 (canonical cap-table default).
 */
const TOKEN_DECIMALS = 6;

interface EquityVestingControlsProps {
  trustId: string;
}

export function EquityVestingControls({ trustId }: EquityVestingControlsProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [cliffDate, setCliffDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [granting, setGranting] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountBaseUnits = useMemo(() => toBaseUnits(amount), [amount]);

  const startUnix = useMemo(() => dateToUnix(startDate), [startDate]);
  const cliffUnix = useMemo(() => dateToUnix(cliffDate), [cliffDate]);
  const endUnix = useMemo(() => dateToUnix(endDate), [endDate]);

  const recipientLooksValid = useMemo(() => {
    const t = recipient.trim();
    return t.length >= 32 && t.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(t);
  }, [recipient]);

  const scheduleValid = useMemo(() => {
    if (startUnix === null || cliffUnix === null || endUnix === null) return false;
    return startUnix < endUnix && cliffUnix >= startUnix && cliffUnix <= endUnix;
  }, [startUnix, cliffUnix, endUnix]);

  const canSubmit = !granting && amountBaseUnits !== null && recipientLooksValid && scheduleValid;

  const handleGrant = async () => {
    if (!canSubmit) return;
    setGranting(true);
    setError(null);
    setSignature(null);
    setPositionId(null);
    try {
      const result = await api.vestingCreate({
        entity_id: trustId,
        recipient_pubkey: recipient.trim(),
        total_amount: Number(amountBaseUnits),
        start_time: startUnix!,
        cliff_time: cliffUnix!,
        end_time: endUnix!,
      });
      setSignature(result.signature_b58);
      setPositionId(result.position_id_hex);
      setRecipient("");
      setAmount("");
      setStartDate("");
      setCliffDate("");
      setEndDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant failed.");
    } finally {
      setGranting(false);
    }
  };

  return (
    <PageSection
      title="Grant vesting"
      description="Linear-cliff vesting position for a recipient (owner-only)."
    >
      <div className="vesting-grant-row">
        <Input
          label="Recipient"
          placeholder="recipient pubkey"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={granting}
          size="sm"
        />
        <Input
          label="Amount"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={granting}
          size="sm"
        />
      </div>
      <div className="vesting-grant-row">
        <Input
          label="Start"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={granting}
          size="sm"
        />
        <Input
          label="Cliff"
          type="date"
          value={cliffDate}
          onChange={(e) => setCliffDate(e.target.value)}
          disabled={granting}
          size="sm"
        />
        <Input
          label="End"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          disabled={granting}
          size="sm"
        />
        <Button
          variant="primary"
          size="sm"
          loading={granting}
          disabled={!canSubmit}
          onClick={handleGrant}
        >
          Grant
        </Button>
      </div>
      <div className="vesting-grant-status">
        {signature ? (
          <span className="vesting-grant-status--signature">
            ✓ Granted · {formatSignature(signature)}
            {positionId && ` · position ${formatSignature(positionId)}`}
          </span>
        ) : error ? (
          <span className="vesting-grant-status--error">{error}</span>
        ) : (
          <span>
            Linear vesting between cliff and end; recipient signs `claim` on chain to draw.
          </span>
        )}
      </div>
    </PageSection>
  );
}

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

function dateToUnix(date: string): number | null {
  if (!date) return null;
  // HTML date input gives YYYY-MM-DD — interpret as midnight UTC.
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function formatSignature(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}
