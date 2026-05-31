/**
 * Recent vault activity surface — extracted from `AssetsExtras.tsx`
 * in iter-4 to keep that file under the 600-line ceiling. The section
 * fuses two data sources:
 *
 *   1. `useVaultActivity` — raw signatures touching the vault PDA.
 *   2. `useDecodedVaultActivity` — parsed transactions for the leading
 *      N signatures, classified into deposit / withdraw / internal /
 *      sol-deposit / sol-withdraw / other.
 *
 * Honest scope: when a parsed-tx fetch is in flight (or returns a
 * pattern we don't recognise) the row falls back to a quieter
 * "Decoding…" / "On-chain call" badge with the explorer deep-link
 * still functional. Decoded headlines stay opt-in — we never invent
 * counterparty info we couldn't extract from the parsed instructions.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import type { DecodedActivity } from "@/hooks/useDecodedVaultActivity";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import type { VaultSignature } from "@/hooks/useVaultActivity";
import type { RoleAccountWithPda } from "@/solana";
import type { BudgetAccountWithPda, VestingPositionWithPda } from "@/solana/assets";
import { formatCurrency, formatDateTime, formatInteger } from "@/lib/i18n";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/solana-explorer";
import {
  Badge,
  Button,
  DetailField,
  EmptyState,
  Icon,
  Inline,
  Loading,
  PageSection,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

import {
  CopyableMono,
  bytesIdLabel,
  formatTokenAmount,
  isStableSymbol,
  rawToFloat,
  shortAddress,
} from "./AssetsSections";
import { AssetsHistoryModal } from "./AssetsHistoryModal";
import styles from "./AssetsPage.module.css";

type ActivityRow = VaultSignature & { decoded?: DecodedActivity };

/**
 * Iter-10 — counterparty enrichment match.
 *
 * A counterparty pubkey can match more than one source (a role
 * occupant who also receives a vesting grant), so the panel renders
 * each match as its own typed Badge in a small cluster.
 */
interface CounterpartyMatch {
  kind: "role" | "vesting" | "budget-grantor";
  /** Short ASCII-prefix label of the role / vesting position / budget
   *  ID — same encoding the table elsewhere uses. */
  label: string;
}

export function VaultActivitySection({
  signatures,
  decoded,
  isLoading,
  metas,
  roles,
  budgets,
  vestingPositions,
}: {
  signatures: VaultSignature[];
  /** Decoded rows keyed by signature — iter-4 plumbs in `useDecodedVaultActivity`
   *  so the top N signatures render as typed deposit/withdraw rows rather
   *  than opaque signature hashes. */
  decoded: DecodedActivity[];
  isLoading: boolean;
  metas: Record<string, ResolvedTokenMeta>;
  /** Iter-10: counterparty enrichment sources. Each counterparty pubkey
   *  is matched against the COMPANY's role occupants, vesting recipients,
   *  and budget grantees so the expanded panel can tag known actors
   *  rather than render a bare base58 string. */
  roles?: RoleAccountWithPda[];
  budgets?: BudgetAccountWithPda[];
  vestingPositions?: VestingPositionWithPda[];
}) {
  // Iter-10: build a single pubkey-keyed lookup once per render so the
  // expanded detail panel can stay an O(1) lookup. Each match carries
  // a "kind" tag (role / vesting / budget-grantor) + a short label so
  // the panel can render a typed Badge cluster.
  const counterpartyIndex = useMemo(() => {
    const map = new Map<string, CounterpartyMatch[]>();
    const push = (key: string, match: CounterpartyMatch) => {
      const arr = map.get(key) ?? [];
      arr.push(match);
      map.set(key, arr);
    };
    for (const r of roles ?? []) {
      const occupantKey = r.account.account.toBase58();
      const label = bytesIdLabel(r.account.roleId);
      push(occupantKey, { kind: "role", label });
    }
    for (const v of vestingPositions ?? []) {
      const recipientKey = v.account.recipient.toBase58();
      const label = bytesIdLabel(v.account.positionId);
      push(recipientKey, { kind: "vesting", label });
    }
    for (const b of budgets ?? []) {
      const grantorKey = b.account.grantor.toBase58();
      const label = bytesIdLabel(b.account.budgetId);
      push(grantorKey, { kind: "budget-grantor", label });
    }
    return map;
  }, [roles, vestingPositions, budgets]);
  const VISIBLE = 10;
  const decodedByKey = useMemo(() => {
    const map = new Map<string, DecodedActivity>();
    for (const d of decoded) map.set(d.signature, d);
    return map;
  }, [decoded]);

  /** Iter-8: row-level deep-link expansion. The activity row table is
   *  honest but flat — operators reading it for "what landed and from
   *  whom" had to flip out to the explorer to see slot, programs, and
   *  the full counterparty address. Expanding inline keeps the
   *  context where the operator is looking. State is local to the
   *  section so the host page doesn't have to plumb it through. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Iter-9: full history modal. Opens via "View all (N)" in the section
   *  header — exposes every signature the hook returned with a
   *  date-range filter, so a CFO scanning a longer window doesn't have
   *  to drop out to the explorer or page through here at 10/row. */
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);

  const rows = useMemo<ActivityRow[]>(
    () =>
      signatures.slice(0, VISIBLE).map((sig) => ({
        ...sig,
        decoded: decodedByKey.get(sig.signature),
      })),
    [signatures, decodedByKey],
  );

  const expandedRow = expanded ? (rows.find((r) => r.signature === expanded) ?? null) : null;

  const columns: Array<TableColumn<ActivityRow>> = [
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
      cell: (row) => <ActivityKindCell row={row} metas={metas} />,
    },
    {
      key: "counterparty",
      header: "Counterparty",
      cell: (row) => {
        const cp = row.decoded?.counterparty ?? null;
        if (!cp) {
          return <span className={styles.mutedDash}>—</span>;
        }
        return <CopyableMono full={cp} display={shortAddress(cp)} tone="muted" withExplorer />;
      },
    },
    {
      // Iter-7: per-row USD flow value. Computed at par for any
      // decoded SPL transfer whose mint resolves to a registered
      // stablecoin (symbol + decimals known). SOL deposits and
      // unpriced SPL mints render as "—" with a tooltip explaining
      // we don't fabricate prices for non-stables. Surfacing the
      // dollar value next to the headline lets a CFO scan the
      // activity table for "what moved" without doing the
      // base-unit ↔ decimals conversion in their head.
      key: "usd",
      header: "USD flow",
      align: "end",
      cell: (row) => <ActivityUsdCell row={row} metas={metas} />,
    },
    {
      key: "signature",
      header: "Signature",
      cell: (row) => (
        <span className={styles.tokenCell}>
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
        </span>
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

  const hiddenCount = signatures.length - rows.length;
  const decodedCount = rows.filter((r) => r.decoded && r.decoded.kind !== "other").length;

  // Iter-9: "View all (N)" affordance on the section header — only
  // surfaces when there are more signatures than the visible cap, so
  // the action lives where it earns its weight.
  const sectionActions =
    signatures.length > rows.length ? (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setHistoryOpen(true)}
        aria-label="Open full vault history"
      >
        View all ({formatInteger(signatures.length)})
      </Button>
    ) : undefined;

  return (
    <PageSection
      title="Recent vault activity"
      description="Latest on-chain signatures that touched the vault authority PDA. Top rows decode SPL transfers into deposit / withdraw labels."
      actions={sectionActions}
    >
      {isLoading && rows.length === 0 ? (
        <Loading variant="section" label="Scanning vault signature tail" />
      ) : (
        <>
          <Table
            columns={columns}
            data={rows}
            rowKey={(row) => row.signature}
            ariaLabel="Recent vault activity"
            onRowClick={(row) =>
              setExpanded((cur) => (cur === row.signature ? null : row.signature))
            }
            empty={
              <EmptyState
                title="No on-chain activity yet"
                description="No transactions have touched the vault authority PDA. Once a deposit lands the signature shows up here within ~30 seconds."
              />
            }
          />
          {expandedRow && (
            <ActivityDetailPanel
              row={expandedRow}
              metas={metas}
              counterpartyMatches={
                expandedRow.decoded?.counterparty
                  ? (counterpartyIndex.get(expandedRow.decoded.counterparty) ?? [])
                  : []
              }
              onClose={() => setExpanded(null)}
            />
          )}
          {(hiddenCount > 0 || decodedCount > 0) && (
            <span className={styles.activityFooter}>
              {decodedCount > 0
                ? `Decoded ${formatInteger(decodedCount)} of ${formatInteger(rows.length)} visible rows · `
                : ""}
              {hiddenCount > 0
                ? `Showing the latest ${formatInteger(rows.length)} of ${formatInteger(signatures.length)} on-chain signatures.`
                : ""}
            </span>
          )}
        </>
      )}
      <AssetsHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        signatures={signatures}
        decoded={decoded}
        metas={metas}
      />
    </PageSection>
  );
}

/**
 * Activity row cell — renders the decoded headline + amount when we
 * have a parsed transaction in hand, falling back to "On-chain call"
 * with the program list for rows that haven't been decoded yet (RPC
 * still pending or returned no recognised transfer pattern). The
 * graphite/jade/warmth tone matches the deposit/withdraw/other family
 * documented in `.impeccable.md`.
 */
function ActivityKindCell({
  row,
  metas,
}: {
  row: ActivityRow;
  metas: Record<string, ResolvedTokenMeta>;
}) {
  const decoded = row.decoded;
  if (!decoded) {
    return (
      <Inline gap="2" align="center">
        <Badge variant="muted" size="sm" dot>
          Decoding…
        </Badge>
      </Inline>
    );
  }
  if (decoded.kind === "other") {
    return (
      <Inline gap="2" align="center">
        <Badge variant="neutral" size="sm" dot>
          On-chain call
        </Badge>
      </Inline>
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

/**
 * Iter-7: per-row USD flow value. We render a dollar figure when the
 * row decoded into an SPL transfer whose mint is a registered
 * stablecoin (so par valuation is honest). Everything else — SOL
 * deposits, AEQI-issued shares, unpriced SPL governance tokens —
 * falls back to "—" with a tooltip explaining the gap. We deliberately
 * do NOT make up prices: a CFO using this surface needs to trust the
 * USD numbers, so the column reads as the *known* flow value, not an
 * estimate.
 */
function ActivityUsdCell({
  row,
  metas,
}: {
  row: ActivityRow;
  metas: Record<string, ResolvedTokenMeta>;
}) {
  const decoded = row.decoded;
  if (!decoded || decoded.amount === null || decoded.mint === null) {
    return (
      <Tooltip content="USD value is only computed for registered stablecoin mints. SOL deposits and unpriced SPL mints render no value.">
        <span className={styles.mutedDash}>—</span>
      </Tooltip>
    );
  }
  // SOL never carries a mint, so the `decoded.mint === null` guard
  // above covers sol-deposit / sol-withdraw rows already. From here
  // we know we have an SPL transfer with a known mint.
  const meta = metas[decoded.mint];
  if (!meta || !meta.symbol || meta.decimals === null || !isStableSymbol(meta.symbol)) {
    return (
      <Tooltip content="USD value is only computed for registered stablecoin mints.">
        <span className={styles.mutedDash}>—</span>
      </Tooltip>
    );
  }
  const usd = rawToFloat(decoded.amount, meta.decimals);
  const isOutflow = decoded.kind === "withdraw";
  // Render withdraws as negative so the column is a signed flow read
  // — a CFO scanning the table reads "+$200 / -$50" without parsing
  // the badge again. Internal transfers stay positive but quiet
  // because they're not a treasury delta.
  const signed = isOutflow ? -usd : usd;
  return (
    <span className={styles.numCell}>
      {formatCurrency(signed, "USD", { maximumFractionDigits: 2 })}
    </span>
  );
}

/**
 * Iter-8 — Inline activity detail panel.
 *
 * Replaces the previous "click out to explorer for everything else"
 * dead-end with a per-row expansion that surfaces the full signature
 * tail, slot, finality state, counterparty full address, decoded mint,
 * raw amount, and the list of programs touched by the transaction.
 * Lives on the same recessed surface as `HoldingDetailPanel` so the
 * two row-level detail patterns read symmetrically.
 *
 * Honest scope: we only surface fields we have on the hooks — slot +
 * blockTime come from `useVaultActivity`'s signature, decoded fields
 * come from `useDecodedVaultActivity`. Finality is read off the
 * `err === null` flag (confirmed → finalized within slots; the
 * commitment is already "confirmed" by the underlying RPC fetcher).
 * No fabrication.
 */
function ActivityDetailPanel({
  row,
  metas,
  counterpartyMatches,
  onClose,
}: {
  row: ActivityRow;
  metas: Record<string, ResolvedTokenMeta>;
  /** Iter-10: matches keyed off the decoded counterparty pubkey. When
   *  the counterparty is a known role occupant / vesting recipient /
   *  budget grantee, we tag the field with a typed Badge cluster so
   *  the auditor doesn't have to copy the pubkey out and re-scan the
   *  COMPANY surfaces by hand. */
  counterpartyMatches: CounterpartyMatch[];
  onClose: () => void;
}) {
  const decoded = row.decoded;
  const isSol = decoded?.kind === "sol-deposit" || decoded?.kind === "sol-withdraw";
  const symbol = isSol ? "SOL" : decoded?.mint ? (metas[decoded.mint]?.symbol ?? "SPL") : null;
  const decimals = isSol ? 9 : decoded?.mint ? (metas[decoded.mint]?.decimals ?? null) : null;
  const amount =
    decoded?.amount !== null && decoded?.amount !== undefined
      ? formatTokenAmount(decoded.amount, decimals)
      : null;
  const programs = decoded?.programs ?? [];

  return (
    <div className={styles.activityDetailPanel}>
      <div className={styles.activityDetailHead}>
        <span className={styles.activityDetailTitle}>Transaction detail</span>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close transaction detail">
          Collapse
        </Button>
      </div>
      <div className={styles.activityDetailGrid}>
        <DetailField label="Signature">
          <CopyableMono full={row.signature} display={row.signature} mode="full" />
        </DetailField>
        <DetailField label="Slot">
          <span className={styles.numCell}>{formatInteger(row.slot)}</span>
        </DetailField>
        <DetailField label="Block time">
          <span className={styles.numCell}>
            {row.blockTime !== null ? formatDateTime(new Date(row.blockTime * 1000)) : "—"}
          </span>
        </DetailField>
        <DetailField label="Finality">
          {row.err === null ? (
            <Badge variant="success" size="sm" dot>
              Confirmed
            </Badge>
          ) : (
            <Badge variant="error" size="sm" dot>
              Failed
            </Badge>
          )}
        </DetailField>
        <DetailField label="Counterparty">
          {decoded?.counterparty ? (
            <Stack gap="2">
              <CopyableMono
                full={decoded.counterparty}
                display={decoded.counterparty}
                mode="full"
                withExplorer
              />
              {counterpartyMatches.length > 0 && (
                <Inline gap="2" wrap>
                  {counterpartyMatches.map((m, i) => (
                    <Badge
                      key={`${m.kind}-${i}`}
                      variant={
                        m.kind === "role" ? "accent" : m.kind === "vesting" ? "success" : "muted"
                      }
                      size="sm"
                      dot
                    >
                      {counterpartyKindLabel(m.kind)} · {m.label}
                    </Badge>
                  ))}
                </Inline>
              )}
              {counterpartyMatches.length === 0 && (
                <span className={styles.counterpartyUnknownNote}>
                  Not a known role occupant, vesting recipient, or budget grantee on this COMPANY.
                </span>
              )}
            </Stack>
          ) : (
            <span className={styles.mutedDash}>— (internal / unresolved)</span>
          )}
        </DetailField>
        <DetailField label="Token">
          {symbol ? (
            <Inline gap="2" align="center">
              <span className={styles.tokenSymbol}>{symbol}</span>
              {decoded?.mint && !isSol && (
                <CopyableMono
                  full={decoded.mint}
                  display={shortAddress(decoded.mint)}
                  tone="muted"
                  withExplorer
                />
              )}
            </Inline>
          ) : (
            <span className={styles.mutedDash}>—</span>
          )}
        </DetailField>
        <DetailField label="Raw amount">
          {amount && symbol ? (
            <span className={styles.numCell}>
              {amount} {symbol}
            </span>
          ) : (
            <span className={styles.mutedDash}>—</span>
          )}
        </DetailField>
        <DetailField label="Programs touched">
          {programs.length === 0 ? (
            <span className={styles.mutedDash}>—</span>
          ) : (
            <Stack gap="1" className={styles.activityDetailPrograms}>
              {programs.map((pid) => (
                <a
                  key={pid}
                  href={explorerAddressUrl(pid)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.signatureLink}
                  aria-label={`Open program ${pid} in Solana explorer`}
                >
                  <span className={styles.monoCell}>{shortAddress(pid)}</span>
                  <Icon icon={ExternalLink} size="xs" />
                </a>
              ))}
            </Stack>
          )}
        </DetailField>
      </div>
      <p className={styles.activityDetailNote}>
        Decoded from parsed instructions + pre/post token balances; the explorer link above carries
        the canonical view if a deeper trace is needed.
      </p>
    </div>
  );
}

/**
 * Iter-10 — surface label for each counterparty match kind. Kept
 * separate so the renderer stays declarative and the i18n surface can
 * grow without re-threading the renderer.
 */
function counterpartyKindLabel(kind: CounterpartyMatch["kind"]): string {
  switch (kind) {
    case "role":
      return "Role";
    case "vesting":
      return "Vesting";
    case "budget-grantor":
      return "Budget";
  }
}
