/**
 * Auxiliary sections + panels for the Assets surface — extracted out of
 * `AssetsPage.tsx` to keep the host page under the 600-line ceiling.
 * Everything in here is tightly coupled to the Assets domain (sparkline,
 * withdraw shell, vault identity, holding detail + receive card); not
 * consumed from other pages.
 *
 * Order of declarations mirrors the visual order on the page:
 *   1. VaultActivityStrip — 30d sparkline above the overview.
 *   2. WithdrawFormShell — disabled-form counterpart to the deposit card.
 *   3. HoldingReceiveCard — row-level receive surface (mint-scoped QR).
 *   4. VaultIdentitySection — network + PDAs + modules registered.
 *   5. HoldingDetailPanel — inline expansion under the Holdings table.
 *
 * `VaultActivitySection` (recent decoded signatures) lives in
 * `AssetsActivity.tsx` so it can grow with the parsed-tx decoder
 * without pushing this file over the lint ceiling.
 *
 * `HoldingRow` is the shared row shape used both by the Holdings table
 * and the HoldingDetailPanel; it lives in this file so the panel and
 * the page share one type without circling back through AssetsPage.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import type { ModuleAccountWithPda } from "@/solana";
import { getAeqiProgramName } from "@/solana/program-names";
import { formatCurrency, formatInteger } from "@/lib/i18n";
import { explorerAddressUrl, explorerClusterLabel } from "@/lib/solana-explorer";
import {
  Badge,
  Button,
  Card,
  DetailField,
  Icon,
  Inline,
  Input,
  PageSection,
  QRCode,
  Stack,
} from "@/components/ui";

import { CopyableMono, bytesIdLabel, shortAddress } from "./AssetsSections";
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
 * to "how has this vault moved". Iter-5 introduces a real USD curve
 * (`mode: "usd"`) replayed from decoded stablecoin deposits/withdraws.
 * When no decoded stable events exist we fall back to the trailing
 * 30-day signature count (`mode: "count"`).
 *
 * Both modes share one SVG renderer. The USD mode tags the curve as a
 * line + faint area-fill so the value-over-time reads more naturally
 * than a flat count polyline. The header label, value, and footnote
 * change so the operator never wonders what the line represents.
 */
export interface VaultActivityStripProps {
  /** Numeric series, oldest-first, length = windowDays (30). */
  series: number[];
  /** Renderer mode — "usd" treats values as USD balances; "count" treats
   *  them as signature counts. */
  mode: "usd" | "count";
  /** Right-edge value displayed in the header. Total signatures for
   *  "count" mode, current USD balance for "usd" mode. */
  total: number;
  /** Optional headline suffix — e.g. "Treasury value · 30d". */
  label?: string;
}

export function VaultActivityStrip({ series, mode, total, label }: VaultActivityStripProps) {
  const max = series.length ? Math.max(...series) : 0;
  const min = mode === "usd" ? Math.min(...series, max) : 0;
  const isFlat = max === min;
  const width = 720;
  const height = 36;
  const padding = 4;
  const innerH = height - padding * 2;

  const linePoints = useMemo(() => {
    if (series.length === 0) return "";
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / Math.max(series.length - 1, 1)) * width;
        const y = isFlat ? height - padding : height - padding - ((v - min) / range) * innerH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [series, min, max, isFlat, innerH]);

  // Area fill path for USD mode — same coords, but closed back to the
  // baseline so the polyline reads as a treasury "filled" curve.
  const areaPath = useMemo(() => {
    if (mode !== "usd" || series.length === 0) return "";
    const coords = linePoints.split(" ");
    if (coords.length === 0) return "";
    const first = coords[0]?.split(",")[0];
    const last = coords[coords.length - 1]?.split(",")[0];
    if (!first || !last) return "";
    return `M ${first},${height - padding} L ${coords.join(" L ")} L ${last},${height - padding} Z`;
  }, [linePoints, series, mode]);

  const headerLabel = label ?? (mode === "usd" ? "Treasury value · 30d" : "Vault activity · 30d");
  const headerValue =
    mode === "usd"
      ? total > 0
        ? formatCurrency(total, "USD", { maximumFractionDigits: 0 })
        : "$0"
      : total > 0
        ? `${formatInteger(total)} on-chain signature${total === 1 ? "" : "s"}`
        : "No signatures yet";

  // USD curve delta vs the curve's earliest non-zero value — the operator
  // wants "how has this moved" at a glance. We avoid claiming a delta
  // when the floor is zero (would render an infinite-percent gain).
  const usdDelta = useMemo(() => {
    if (mode !== "usd" || series.length === 0) return null;
    const first = series.find((v) => v > 0) ?? 0;
    const last = series[series.length - 1] ?? 0;
    if (first === 0 || !Number.isFinite(first)) return null;
    const diff = last - first;
    const pct = (diff / first) * 100;
    return { diff, pct };
  }, [series, mode]);

  return (
    <div className={styles.activityStrip}>
      <div className={styles.activityStripHead}>
        <span className={styles.activityStripLabel}>{headerLabel}</span>
        <span className={styles.activityStripValue}>
          {headerValue}
          {usdDelta && (
            <span
              className={styles.activityStripDelta}
              data-tone={usdDelta.diff >= 0 ? "up" : "down"}
            >
              {" "}
              {usdDelta.diff >= 0 ? "+" : ""}
              {formatCurrency(usdDelta.diff, "USD", { maximumFractionDigits: 0 })}
            </span>
          )}
        </span>
      </div>
      <svg
        className={styles.activityStripSvg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          mode === "usd"
            ? "Stablecoin USD balance per day, last 30 days"
            : "Vault touches per day, last 30 days"
        }
        data-mode={mode}
      >
        {mode === "usd" && areaPath && <path d={areaPath} fill="currentColor" opacity="0.08" />}
        <polyline
          points={linePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {isFlat && mode === "count" && (
        <span className={styles.activityStripNote}>
          No on-chain signatures touched the vault in the last 30 days.
        </span>
      )}
      {mode === "usd" && (
        <span className={styles.activityStripNote}>
          Replayed from decoded stablecoin deposits and withdraws. Older flows beyond the decode
          window approximate to the current balance; AEQI-issued shares and unpriced SPLs are not
          included.
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
export interface WithdrawFormShellProps {
  /** Optional mint to prefill the "Mint" detail line — surfaced when the
   *  operator clicks "Send" on a holdings row so the form lands on the
   *  exact token they were drilling into. */
  prefillMint?: { mint: string; symbol: string | null } | null;
  /** Renders a "Clear" affordance when the form is in prefill mode. */
  onClearPrefill?: () => void;
  /** Renders a header label override — used when the form is mounted
   *  inside a holdings expansion. */
  headline?: string;
}

export function WithdrawFormShell({
  prefillMint,
  onClearPrefill,
  headline,
}: WithdrawFormShellProps = {}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const amountValid = amount.length > 0 && Number(amount) > 0 && Number.isFinite(Number(amount));
  const recipientValid = recipient.length >= 32 && recipient.length <= 44;

  const title = headline ?? "Withdraw from vault";

  return (
    <Card padding="lg" className={styles.withdrawCard}>
      <Stack gap="3">
        <div className={styles.withdrawHead}>
          <span className={styles.withdrawTitle}>{title}</span>
          <Badge variant="muted" dot>
            Disabled · awaiting budget context
          </Badge>
        </div>
        {prefillMint && (
          <div className={styles.withdrawPrefill}>
            <span className={styles.withdrawPrefillLabel}>Mint</span>
            <Badge variant="accent" dot>
              {prefillMint.symbol ?? "SPL"}
            </Badge>
            <CopyableMono
              full={prefillMint.mint}
              display={shortAddress(prefillMint.mint)}
              tone="muted"
              withExplorer
            />
            {onClearPrefill && (
              <Button variant="ghost" size="sm" onClick={onClearPrefill}>
                Clear
              </Button>
            )}
          </div>
        )}
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
            label={`Amount (${prefillMint?.symbol ?? "USDC"})`}
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
/* Receive card — counterpart to Send on holdings rows                 */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Compact "receive" card surfaced beneath a holdings row when the
 * operator clicks the Receive icon-button. The deposit address is the
 * same vault authority PDA shown at the top of the page — but the
 * inline card removes the context-switch cost of scrolling back up.
 */
export function HoldingReceiveCard({
  vaultAuthority,
  symbol,
  onClose,
}: {
  vaultAuthority: string;
  symbol: string | null;
  onClose: () => void;
}) {
  return (
    <div className={styles.receiveCard}>
      <div className={styles.receiveHead}>
        <span className={styles.holdingDetailTitle}>Receive {symbol ?? "SPL"} into the TRUST</span>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close receive card">
          Close
        </Button>
      </div>
      <div className={styles.receiveBody}>
        <QRCode value={vaultAuthority} size={128} />
        <Stack gap="2" className={styles.receiveBodyText}>
          <DetailField label="Vault deposit address">
            <CopyableMono full={vaultAuthority} display={vaultAuthority} mode="full" withExplorer />
          </DetailField>
          <span className={styles.capitalizeNote}>
            Send {symbol ?? "any SPL token"} to this address from any Solana wallet — the TRUST owns
            the balance the moment the deposit confirms.
          </span>
          <a
            href={explorerAddressUrl(vaultAuthority)}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.capitalizeExplorer}
            aria-label="Open vault address in Solana explorer"
          >
            <Icon icon={ExternalLink} size="xs" />
            <span>View vault on Solana explorer</span>
          </a>
        </Stack>
      </div>
    </div>
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

  // Per-module rows — one row per module *slot* (not per distinct
  // program). Two slots pointing at the same program ID is rare but
  // valid; surfacing both keeps the operator honest about the TRUST's
  // module count. Iter-5: surfacing the `initialized` flag + version
  // turns "modules registered" from a count into a real provisioning
  // table — the operator sees which slots have actually been initialized
  // on-chain vs which are still pending the post-deploy module-init
  // instruction.
  const moduleRows = useMemo(() => {
    return modules.map((m) => {
      const pid = m.account.programId.toBase58();
      return {
        key: m.publicKey.toBase58(),
        programId: pid,
        programName: getAeqiProgramName(pid),
        moduleLabel: bytesIdLabel(m.account.moduleId),
        // `initialized` is a u8 flag on the on-chain Module struct; the
        // post-deploy module-init instruction flips it from 0 → 1.
        initialized: Number(m.account.initialized) > 0,
        // Anchor returns u64 as BN; toString avoids the bigint coercion
        // hassle for a value we only render.
        version: m.account.implementationVersion.toString(),
        provider: m.account.provider.toBase58(),
      };
    });
  }, [modules]);

  // Aggregate provisioning state for the section header — initialized
  // count vs total slots. "Fully provisioned" only when every slot is
  // initialized; "partial" when some are. "Not initialized" when none.
  const provisioning = useMemo(() => {
    if (moduleRows.length === 0) return { initialized: 0, total: 0 };
    const initialized = moduleRows.filter((m) => m.initialized).length;
    return { initialized, total: moduleRows.length };
  }, [moduleRows]);

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
      <DetailField
        label={
          moduleRows.length === 0
            ? "Modules registered"
            : `Modules registered (${formatInteger(provisioning.initialized)}/${formatInteger(provisioning.total)} initialized)`
        }
      >
        {moduleRows.length === 0 ? (
          <span className={styles.mutedDash}>None yet</span>
        ) : (
          <ul className={styles.moduleRowsList}>
            {moduleRows.map((m) => (
              <li key={m.key} className={styles.moduleRow}>
                <div className={styles.moduleRowHead}>
                  <span className={styles.modulesName}>{m.programName ?? "External program"}</span>
                  <Badge variant={m.initialized ? "success" : "muted"} size="sm" dot>
                    {m.initialized ? "Initialized" : "Not initialized"}
                  </Badge>
                  {m.version !== "0" && <span className={styles.moduleVersion}>v{m.version}</span>}
                </div>
                <div className={styles.moduleRowMeta}>
                  <span className={styles.moduleRowField}>
                    <span className={styles.moduleRowFieldLabel}>Slot</span>
                    <span className={styles.monoCellInline}>{m.moduleLabel}</span>
                  </span>
                  <span className={styles.moduleRowField}>
                    <span className={styles.moduleRowFieldLabel}>Program</span>
                    <CopyableMono
                      full={m.programId}
                      display={shortAddress(m.programId)}
                      tone="muted"
                      withExplorer
                    />
                  </span>
                </div>
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
export function HoldingDetailPanel({
  row,
  onClose,
  onSend,
  onReceive,
}: {
  row: HoldingRow;
  onClose: () => void;
  /** Iter-4: row-level Send affordance — host opens the WithdrawFormShell
   *  prefilled with this mint. */
  onSend?: (row: HoldingRow) => void;
  /** Iter-4: row-level Receive affordance — host shows a QR-style deposit
   *  card scoped to this mint without scrolling back to the top. */
  onReceive?: (row: HoldingRow) => void;
}) {
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
        <Inline gap="2" align="center">
          {onReceive && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReceive(row)}
              aria-label={`Receive more ${row.symbol ?? "SPL"} into the TRUST`}
            >
              Receive
            </Button>
          )}
          {onSend && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSend(row)}
              aria-label={`Send ${row.symbol ?? "SPL"} from the TRUST`}
            >
              Send
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close holding detail">
            Close
          </Button>
        </Inline>
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
