/**
 * Iter-9 — Treasury history modal ("View all").
 *
 * `VaultActivitySection` caps at the leading 10 signatures for a calm
 * reading surface. Operators auditing a 30+ day stretch (CFO scanning
 * for an inbound transfer that didn't decode, or compliance pulling a
 * window of withdrawals) need the full tail. Iter-9 closes that gap
 * with a "View all (N)" affordance on the section header → opens this
 * modal carrying every signature `useVaultActivity` returned (capped at
 * 1000 by the hook for RPC bounds).
 *
 * Surface:
 *  - Date-range filter (from / to) so operators can window to a
 *    specific month / week / day. Defaults to "all time".
 *  - Decoded label badge per row, reused from `useDecodedVaultActivity`
 *    semantics — deposit / withdraw / internal / sol-* / other.
 *  - USD flow column where the mint resolves to a registered stablecoin
 *    (par valuation honest); otherwise "—" with a tooltip.
 *  - Explorer deep-link per row.
 *
 * Honest scope:
 *  - Capped at 1000 sigs by `useVaultActivity`'s SIGNATURE_LIMIT. A
 *    truly busy vault might exceed that; we surface a footer note when
 *    we hit the cap so the operator knows the truncation is at the
 *    hook layer (not in this modal).
 *  - We do NOT virtualize the list. A 1000-row table sized to the
 *    modal viewport is ~30k DOM nodes — large but not catastrophic on
 *    desktop. If perf becomes a problem we can swap in `react-window`
 *    or similar; for now the design system has no virtualized list
 *    primitive and rolling one would be more cost than the surface
 *    justifies.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import type { DecodedActivity } from "@/hooks/useDecodedVaultActivity";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import type { VaultSignature } from "@/hooks/useVaultActivity";
import { formatCurrency, formatDateTime, formatInteger } from "@/lib/i18n";
import { explorerTxUrl } from "@/lib/solana-explorer";
import {
  Badge,
  Icon,
  Inline,
  Input,
  Modal,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

import { formatTokenAmount, isStableSymbol, rawToFloat, shortAddress } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

type HistoryRow = VaultSignature & { decoded?: DecodedActivity };

export function AssetsHistoryModal({
  open,
  onClose,
  signatures,
  decoded,
  metas,
}: {
  open: boolean;
  onClose: () => void;
  signatures: VaultSignature[];
  decoded: DecodedActivity[];
  metas: Record<string, ResolvedTokenMeta>;
}) {
  // Date filters in ISO yyyy-mm-dd form so the native HTML date-picker
  // semantics (via the design-system Input primitive at type="date") work
  // without a date library. Empty = unbounded on that edge. Filtering is
  // purely client-side over signatures we already fetched — no
  // additional RPC cost.
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const decodedByKey = useMemo(() => {
    const map = new Map<string, DecodedActivity>();
    for (const d of decoded) map.set(d.signature, d);
    return map;
  }, [decoded]);

  const filtered = useMemo<HistoryRow[]>(() => {
    const fromMs = from ? new Date(from).getTime() : null;
    // To-date is end-of-day inclusive — operator picking "2026-05-21"
    // should see signatures up through 23:59:59 that day.
    const toMs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    return signatures
      .filter((sig) => {
        if (sig.blockTime === null) return fromMs === null && toMs === null;
        const ms = sig.blockTime * 1000;
        if (fromMs !== null && ms < fromMs) return false;
        if (toMs !== null && ms > toMs) return false;
        return true;
      })
      .map((sig) => ({ ...sig, decoded: decodedByKey.get(sig.signature) }));
  }, [signatures, from, to, decodedByKey]);

  const columns: Array<TableColumn<HistoryRow>> = [
    {
      key: "when",
      header: "When",
      cell: (row) =>
        row.blockTime !== null ? (
          <span className={styles.numCell}>{formatDateTime(new Date(row.blockTime * 1000))}</span>
        ) : (
          <span className={styles.mutedDash}>—</span>
        ),
    },
    {
      key: "kind",
      header: "Activity",
      cell: (row) => <HistoryKindCell row={row} metas={metas} />,
    },
    {
      key: "usd",
      header: "USD flow",
      align: "end",
      cell: (row) => <HistoryUsdCell row={row} metas={metas} />,
    },
    {
      key: "signature",
      header: "Signature",
      cell: (row) => (
        <a
          href={explorerTxUrl(row.signature)}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.signatureLink}
          aria-label={`Open transaction ${row.signature} in Solana explorer`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className={styles.monoCell}>{shortAddress(row.signature)}</span>
          <Icon icon={ExternalLink} size="xs" />
        </a>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (row) =>
        row.err === null ? (
          <Badge variant="success" size="sm" dot>
            Confirmed
          </Badge>
        ) : (
          <Badge variant="error" size="sm" dot>
            Failed
          </Badge>
        ),
    },
  ];

  // `useVaultActivity` caps at SIGNATURE_LIMIT = 1000; surface the cap
  // honestly when we hit it so the operator knows truncation isn't from
  // the modal's filter logic.
  const HOOK_CAP = 1000;
  const hitCap = signatures.length >= HOOK_CAP;

  return (
    <Modal open={open} onClose={onClose} title="Vault history">
      <Stack gap="3">
        <Inline gap="3" align="center" wrap>
          <Input
            type="date"
            size="sm"
            label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            max={to || undefined}
            aria-label="Filter from date"
          />
          <Input
            type="date"
            size="sm"
            label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            min={from || undefined}
            aria-label="Filter to date"
          />
          <span className={styles.historyCount}>
            {formatInteger(filtered.length)} of {formatInteger(signatures.length)} signatures
            {hitCap && " (RPC cap)"}
          </span>
        </Inline>
        <div className={styles.historyTableScroll}>
          <Table
            columns={columns}
            data={filtered}
            rowKey={(row) => row.signature}
            ariaLabel="Full vault history"
            empty={
              <span className={styles.mutedLabel}>No signatures in the selected date range.</span>
            }
          />
        </div>
        {hitCap && (
          <p className={styles.historyFooterNote}>
            Showing the latest {formatInteger(HOOK_CAP)} on-chain signatures. The RPC tail is capped
            at this depth for cost; older signatures live in the explorer.
          </p>
        )}
      </Stack>
    </Modal>
  );
}

function HistoryKindCell({
  row,
  metas,
}: {
  row: HistoryRow;
  metas: Record<string, ResolvedTokenMeta>;
}) {
  const decoded = row.decoded;
  if (!decoded) {
    return (
      <Badge variant="muted" size="sm" dot>
        Pending
      </Badge>
    );
  }
  if (decoded.kind === "other") {
    return (
      <Badge variant="neutral" size="sm" dot>
        On-chain call
      </Badge>
    );
  }
  const isDeposit = decoded.kind === "deposit" || decoded.kind === "sol-deposit";
  const isWithdraw = decoded.kind === "withdraw" || decoded.kind === "sol-withdraw";
  const isInternal = decoded.kind === "internal";
  const tone: "success" | "warning" | "neutral" = isDeposit
    ? "success"
    : isWithdraw
      ? "warning"
      : "neutral";
  const label = isDeposit ? "Deposit" : isWithdraw ? "Withdraw" : isInternal ? "Internal" : "Other";
  const isSol = decoded.kind === "sol-deposit" || decoded.kind === "sol-withdraw";
  const symbol = isSol ? "SOL" : decoded.mint ? (metas[decoded.mint]?.symbol ?? "SPL") : "SPL";
  const decimals = isSol ? 9 : decoded.mint ? (metas[decoded.mint]?.decimals ?? null) : null;
  const amount = decoded.amount !== null ? formatTokenAmount(decoded.amount, decimals) : "—";
  return (
    <Inline gap="2" align="center">
      <Badge variant={tone} size="sm" dot>
        {label}
      </Badge>
      <span className={styles.numCell}>
        {amount} {symbol}
      </span>
    </Inline>
  );
}

function HistoryUsdCell({
  row,
  metas,
}: {
  row: HistoryRow;
  metas: Record<string, ResolvedTokenMeta>;
}) {
  const decoded = row.decoded;
  if (!decoded || decoded.amount === null || decoded.mint === null) {
    return (
      <Tooltip content="USD value only computed for registered stablecoin mints.">
        <span className={styles.mutedDash}>—</span>
      </Tooltip>
    );
  }
  const meta = metas[decoded.mint];
  if (!meta || !meta.symbol || meta.decimals === null || !isStableSymbol(meta.symbol)) {
    return (
      <Tooltip content="USD value only computed for registered stablecoin mints.">
        <span className={styles.mutedDash}>—</span>
      </Tooltip>
    );
  }
  const usd = rawToFloat(decoded.amount, meta.decimals);
  const isOutflow = decoded.kind === "withdraw";
  const signed = isOutflow ? -usd : usd;
  return (
    <span className={styles.numCell}>
      {formatCurrency(signed, "USD", { maximumFractionDigits: 2 })}
    </span>
  );
}
