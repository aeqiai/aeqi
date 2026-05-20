/**
 * Auxiliary sections + panels for the Assets surface — extracted out of
 * `AssetsPage.tsx` to keep the host page under the 600-line ceiling.
 * Everything in here is tightly coupled to the Assets domain (vault
 * activity, withdraw shell, holding detail, vault identity); not
 * consumed from other pages.
 *
 * Order of declarations mirrors the visual order on the page:
 *   1. VaultActivityStrip — 30d sparkline above the overview.
 *   2. WithdrawFormShell — disabled-form counterpart to the deposit card.
 *   3. VaultIdentitySection — network + PDAs + modules registered.
 *   4. VaultActivitySection — recent signatures table.
 *   5. HoldingDetailPanel — inline expansion under the Holdings table.
 *
 * `HoldingRow` is the shared row shape used both by the Holdings table
 * and the HoldingDetailPanel; it lives in this file so the panel and
 * the page share one type without circling back through AssetsPage.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { type VaultSignature } from "@/hooks/useVaultActivity";
import type { ModuleAccountWithPda } from "@/solana";
import { getAeqiProgramName } from "@/solana/program-names";
import { formatCurrency, formatDateTime, formatInteger } from "@/lib/i18n";
import { explorerClusterLabel, explorerTxUrl } from "@/lib/solana-explorer";
import {
  Badge,
  Button,
  Card,
  DetailField,
  EmptyState,
  Icon,
  Inline,
  Input,
  Loading,
  PageSection,
  Stack,
  Table,
  type TableColumn,
} from "@/components/ui";

import { CopyableMono, shortAddress } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

/**
 * Row shape consumed by the Holdings table + the inline HoldingDetailPanel.
 * The two share one type rather than duplicating field declarations —
 * the panel needs every field the table renders plus the program ID
 * and metadata-source flag that the compact table column drops.
 */
export interface HoldingRow {
  mint: string;
  amount: bigint;
  tokenAccount: string;
  symbol: string | null;
  decimals: number | null;
  /** Stablecoin USD value at par, or null when not a registered stable. */
  usdValue: number | null;
  /** SPL token program owning the ATA — either Token (legacy) or
   *  Token-2022. Carries through to the expanded row for the
   *  "Program" detail. */
  tokenProgram: string;
  /** True when this mint resolved through `useTokenMetas`' on-chain
   *  Token-2022 metadata extension or legacy SPL fallback (vs the
   *  hard-coded registry). Surfaced in the expanded row to make the
   *  "what do we know about this mint" answer honest. */
  metaResolvedOnChain: boolean;
}

/* ────────────────────────────────────────────────────────────────── */
/* Vault activity strip — 30d sparkline above the overview            */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Compact vault-activity sparkline strip — sits beneath the four
 * MetricCards in the overview to give the operator a one-glance answer
 * to "is the vault active". Renders the trailing 30-day signature count
 * as a polyline; pure chrome — clicking the section header is how the
 * operator drills into recent activity.
 *
 * Honest scope: this is a count of on-chain signatures that touched the
 * vault authority PDA, not a USD curve. We have no oracle for
 * non-stablecoin mints and parsed token-balance scan across N days is
 * an order of magnitude more expensive than counting touches. When the
 * empty state hits we explain the dependency: "indexer rail not yet
 * available — counting on-chain signatures instead".
 */
export function VaultActivityStrip({ series, total }: { series: number[]; total: number }) {
  const max = series.length ? Math.max(...series) : 0;
  const min = 0;
  const isEmpty = max === min;
  const width = 720;
  const height = 36;
  const padding = 4;
  const innerH = height - padding * 2;

  const line = useMemo(() => {
    if (series.length === 0) return "";
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / Math.max(series.length - 1, 1)) * width;
        const y = isEmpty ? height - padding : height - padding - ((v - min) / range) * innerH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [series, min, max, isEmpty, innerH]);

  return (
    <div className={styles.activityStrip}>
      <div className={styles.activityStripHead}>
        <span className={styles.activityStripLabel}>Vault activity · 30d</span>
        <span className={styles.activityStripValue}>
          {total > 0
            ? `${formatInteger(total)} on-chain signature${total === 1 ? "" : "s"}`
            : "No signatures yet"}
        </span>
      </div>
      <svg
        className={styles.activityStripSvg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Vault touches per day, last 30 days"
      >
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {isEmpty && (
        <span className={styles.activityStripNote}>
          Counted from on-chain signatures (no indexer rail yet) — a USD curve will land once a
          treasury indexer feed exists.
        </span>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Withdraw form shell                                                 */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Withdraw form shell — the counterpart to the deposit affordance
 * above. Iter-2 left "Withdraw" as a link stub; iter-3 builds the form
 * so the operator can see the shape of the action and the chain of
 * authorization it will require. The submit button is intentionally
 * disabled with an explainer: the corresponding platform route
 * (`POST /budgets/:id/spend` → `spendTreasury`) requires a budget
 * context, and budget selection lives one section down. We surface
 * that route name so the operator knows what we're missing rather
 * than what's been hidden.
 *
 * The form is operable (fields accept input, validation reads the
 * amount) but `onSubmit` is a no-op — clicking the submit button
 * surfaces the disabled-reason copy beneath. This is the honest
 * disabled state pattern: form is real, action is parked behind a
 * known dependency.
 */
export function WithdrawFormShell() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const amountValid = amount.length > 0 && Number(amount) > 0 && Number.isFinite(Number(amount));
  const recipientValid = recipient.length >= 32 && recipient.length <= 44;

  return (
    <Card padding="lg" className={styles.withdrawCard}>
      <Stack gap="3">
        <div className={styles.withdrawHead}>
          <span className={styles.withdrawTitle}>Withdraw from vault</span>
          <Badge variant="muted" dot>
            Disabled · awaiting budget context
          </Badge>
        </div>
        <span className={styles.capitalizeNote}>
          Treasury spend routes through{" "}
          <code className={styles.inlineCode}>POST /budgets/:id/spend</code>. Pick a budget below to
          attach this withdrawal to a spend cap; until then this form previews the shape only.
        </span>
        <div className={styles.withdrawGrid}>
          <Input
            label="Recipient (Solana address)"
            placeholder="3DvL…ZxYa"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            hint={
              recipient.length > 0 && !recipientValid
                ? "Address looks too short — Solana pubkeys are base58 (32–44 chars)."
                : undefined
            }
          />
          <Input
            label="Amount (USDC)"
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={
              amount.length > 0 && !amountValid ? "Amount must be a positive number." : undefined
            }
          />
          <Input
            label="Memo (optional)"
            placeholder="Q3 contractor payment"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className={styles.withdrawMemo}
          />
        </div>
        <Inline gap="3" justify="end">
          <Button
            variant="primary"
            size="md"
            disabled
            aria-disabled
            title="Pick a budget in the Active budgets section below to enable withdrawals."
          >
            Withdraw
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Vault identity                                                      */
/* ────────────────────────────────────────────────────────────────── */

export function VaultIdentitySection({
  moduleStatePda,
  vaultAuthorityPda,
  treasuryAuthority,
  trustAuthority,
  moduleInitialized,
  modules,
}: {
  moduleStatePda: string;
  vaultAuthorityPda: string;
  treasuryAuthority: string | null;
  trustAuthority: string | null;
  moduleInitialized: boolean;
  modules: ModuleAccountWithPda[];
}) {
  const cluster = explorerClusterLabel();
  const clusterPretty = formatClusterLabel(cluster);
  const clusterVariant = clusterTone(cluster);

  // Distinct on-chain program IDs registered with this TRUST. Multiple
  // module slots can point at the same program (rare, but valid), so
  // dedupe before counting and rendering.
  const registeredPrograms = useMemo(() => {
    const seen = new Map<string, { programId: string; name: string | null }>();
    for (const m of modules) {
      const pid = m.account.programId.toBase58();
      if (seen.has(pid)) continue;
      seen.set(pid, { programId: pid, name: getAeqiProgramName(pid) });
    }
    return [...seen.values()];
  }, [modules]);

  return (
    <PageSection title="Vault identity">
      <DetailField label="Network">
        <Inline gap="2">
          <Badge variant={clusterVariant} dot>
            {clusterPretty}
          </Badge>
          <span className={styles.mutedLabel}>{cluster}</span>
        </Inline>
      </DetailField>
      <DetailField label="Vault authority (PDA)">
        <CopyableMono
          full={vaultAuthorityPda}
          display={shortAddress(vaultAuthorityPda)}
          withExplorer
        />
      </DetailField>
      <DetailField label="Module state (PDA)">
        <CopyableMono full={moduleStatePda} display={shortAddress(moduleStatePda)} withExplorer />
      </DetailField>
      <DetailField label="Treasury authority">
        {treasuryAuthority ? (
          <CopyableMono
            full={treasuryAuthority}
            display={shortAddress(treasuryAuthority)}
            withExplorer
          />
        ) : (
          <span className={styles.mutedDash}>—</span>
        )}
      </DetailField>
      <DetailField label="TRUST authority">
        {trustAuthority ? (
          <CopyableMono full={trustAuthority} display={shortAddress(trustAuthority)} withExplorer />
        ) : (
          <span className={styles.mutedDash}>—</span>
        )}
      </DetailField>
      <DetailField label="Treasury module">
        <Badge variant={moduleInitialized ? "success" : "muted"} dot>
          {moduleInitialized ? "Initialized" : "Not initialized"}
        </Badge>
      </DetailField>
      <DetailField label={`Modules registered (${formatInteger(registeredPrograms.length)})`}>
        {registeredPrograms.length === 0 ? (
          <span className={styles.mutedDash}>None yet</span>
        ) : (
          <ul className={styles.modulesList}>
            {registeredPrograms.map((m) => (
              <li key={m.programId} className={styles.modulesItem}>
                <span className={styles.modulesName}>{m.name ?? "External program"}</span>
                <CopyableMono
                  full={m.programId}
                  display={shortAddress(m.programId)}
                  tone="muted"
                  withExplorer
                />
              </li>
            ))}
          </ul>
        )}
      </DetailField>
    </PageSection>
  );
}

/** Cluster label → human-readable label. The env var carries the raw
 *  cluster slug (`mainnet`, `devnet`, `localnet-solana`); the badge wants
 *  Title Case without the redundant `-solana` suffix. */
function formatClusterLabel(cluster: string): string {
  if (cluster === "mainnet" || cluster === "mainnet-beta") return "Mainnet";
  if (cluster === "devnet") return "Devnet";
  if (cluster === "testnet") return "Testnet";
  if (cluster.startsWith("localnet")) return "Localnet";
  return cluster.charAt(0).toUpperCase() + cluster.slice(1);
}

/** Map the cluster to a badge variant. Mainnet is the production
 *  signal (success-tinted); devnet/testnet are warning-tinted so the
 *  operator never misreads where the read is coming from. Localnet
 *  is neutral — clearly dev. */
function clusterTone(cluster: string): "success" | "warning" | "muted" {
  if (cluster === "mainnet" || cluster === "mainnet-beta") return "success";
  if (cluster === "devnet" || cluster === "testnet") return "warning";
  return "muted";
}

/* ────────────────────────────────────────────────────────────────── */
/* Recent vault activity                                               */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Recent vault activity — truncated list of the most recent on-chain
 * signatures that touched the vault authority PDA. Each row deep-links
 * to the cluster's explorer. Iter-2 left treasury history as a stubbed
 * "indexer rail pending" placeholder; iter-3 plumbs the signature feed
 * directly from `getSignaturesForAddress` so we can show *something*
 * concrete while the per-event indexer is still pending.
 *
 * We deliberately do NOT decode signatures into "Deposit X USDC from
 * Y" rows here. That requires either an indexer that classifies
 * transfers by mint, or `getParsedTransaction` per signature (N round
 * trips, fragile to RPC paging). Surfacing signature + slot + when +
 * an explorer link is the honest middle ground: the operator can
 * follow a tx into the explorer in one click.
 */
export function VaultActivitySection({
  signatures,
  isLoading,
}: {
  signatures: VaultSignature[];
  isLoading: boolean;
}) {
  const VISIBLE = 10;
  const rows = signatures.slice(0, VISIBLE);

  const columns: Array<TableColumn<VaultSignature>> = [
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
          >
            <span className={styles.monoCell}>{shortAddress(row.signature)}</span>
            <Icon icon={ExternalLink} size="xs" />
          </a>
        </span>
      ),
    },
    {
      key: "slot",
      header: "Slot",
      align: "end",
      cell: (row) => <span className={styles.numCell}>{formatInteger(row.slot)}</span>,
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

  return (
    <PageSection
      title="Recent vault activity"
      description="Latest on-chain signatures that touched the vault authority PDA. Click a row to open the transaction in the explorer."
    >
      {isLoading ? (
        <Loading variant="section" label="Scanning vault signature tail" />
      ) : (
        <>
          <Table
            columns={columns}
            data={rows}
            rowKey={(row) => row.signature}
            ariaLabel="Recent vault activity"
            empty={
              <EmptyState
                title="No on-chain activity yet"
                description="No transactions have touched the vault authority PDA. Once a deposit lands the signature shows up here within ~30 seconds."
              />
            }
          />
          {hiddenCount > 0 && (
            <span className={styles.activityFooter}>
              Showing the latest {formatInteger(rows.length)} of {formatInteger(signatures.length)}{" "}
              on-chain signatures.
            </span>
          )}
        </>
      )}
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Holding detail panel                                                */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Inline detail panel under the Holdings table — renders the moment a
 * row is clicked and collapses on a re-click. Surfaces the data the
 * compact table column compressed: full mint + ATA (already on the
 * row, but the panel keeps them visible without a tooltip), which SPL
 * token program owns the ATA (Token vs Token-2022), how the symbol
 * was resolved (hard-coded registry vs on-chain metadata extension),
 * and a small "where could this flow next" footer so the operator
 * sees the budget/role linkage without leaving the page.
 *
 * Honest scope: the panel does NOT show "which budget allocated this
 * holding" or "which role spent into this mint" — those joins live on
 * the indexer rail and are out-of-scope until BudgetSpent / vesting
 * Claim events flow back into the dashboard. The footer states that
 * plainly instead of hiding it.
 */
export function HoldingDetailPanel({ row, onClose }: { row: HoldingRow; onClose: () => void }) {
  const token2022 = TOKEN_2022_PROGRAM_ID.toBase58();
  const tokenLegacy = TOKEN_PROGRAM_ID.toBase58();
  const programLabel =
    row.tokenProgram === token2022
      ? "Token-2022"
      : row.tokenProgram === tokenLegacy
        ? "Token (legacy SPL)"
        : "Unknown SPL program";
  const isToken2022 = row.tokenProgram === token2022;

  return (
    <div className={styles.holdingDetailPanel}>
      <div className={styles.holdingDetailHead}>
        <span className={styles.holdingDetailTitle}>{row.symbol ?? "Unnamed SPL"} · detail</span>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close holding detail">
          Close
        </Button>
      </div>
      <div className={styles.holdingDetailGrid}>
        <DetailField label="Mint">
          <CopyableMono full={row.mint} display={row.mint} mode="full" withExplorer />
        </DetailField>
        <DetailField label="Token account (ATA)">
          <CopyableMono
            full={row.tokenAccount}
            display={row.tokenAccount}
            mode="full"
            withExplorer
          />
        </DetailField>
        <DetailField label="Program">
          <Inline gap="2">
            <Badge variant={isToken2022 ? "accent" : "neutral"} dot>
              {programLabel}
            </Badge>
            <CopyableMono
              full={row.tokenProgram}
              display={shortAddress(row.tokenProgram)}
              tone="muted"
              withExplorer
            />
          </Inline>
        </DetailField>
        <DetailField label="Metadata source">
          {row.symbol === null ? (
            <span className={styles.mutedDash}>Unresolved — no symbol/decimals known</span>
          ) : row.metaResolvedOnChain ? (
            <Badge variant="info" dot>
              On-chain
            </Badge>
          ) : (
            <Badge variant="muted" dot>
              Hard-coded registry
            </Badge>
          )}
        </DetailField>
        <DetailField label="Raw amount (base units)">
          <span className={styles.numCell}>{row.amount.toString()}</span>
        </DetailField>
        {row.usdValue !== null && (
          <DetailField label="USD value">
            <span className={styles.numCell}>
              {formatCurrency(row.usdValue, "USD", { maximumFractionDigits: 2 })}
            </span>
          </DetailField>
        )}
      </div>
      <p className={styles.holdingDetailNote}>
        Per-budget allocation breakdown and per-role spend flow are not surfaced here yet —
        BudgetSpent / vesting Claim events emit on-chain but are not fed back into the dashboard
        until the indexer rail lands.
      </p>
    </div>
  );
}
