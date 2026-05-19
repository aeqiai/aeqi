import { useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useAssets } from "@/hooks/useAssets";
import { lookupTokenMeta } from "@/solana";
import type { BudgetAccountWithPda, VaultHolding } from "@/solana";
import {
  Badge,
  Card,
  DetailField,
  EmptyState,
  Inline,
  Loading,
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  QRCode,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

/**
 * Assets — `a` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * The TRUST's wealth surface — "what does this TRUST hold?" — and the
 * public-facing answer to the "TRUST capitalizes self → buys runtime"
 * model. The hero affordance is the vault deposit address: any Solana
 * wallet sending USDC to it credits the TRUST. Everything else is
 * supporting context (holdings, budgets, vesting headline).
 *
 * Sections (order is load-bearing — the deposit CTA sits before the
 * read-only context):
 *   1. Capitalize your TRUST — vault authority pubkey with copy + QR.
 *      First-class call to action; renders even before the treasury
 *      module is initialized (PDAs are deterministic from `trust_pda`).
 *   2. Vault identity — module-state + vault authority PDAs, treasury
 *      authority, module status.
 *   3. Holdings — every SPL token account owned by the vault, across
 *      Token-2022 and legacy Token programs.
 *   4. Active budgets — per-role allocations from `aeqi_budget` (hidden
 *      cleanly for Foundation-shaped TRUSTs that don't adopt budget).
 *   5. Vesting tile — count-only headline from `aeqi_vesting`
 *      (hidden if no positions exist on this TRUST).
 *
 * Anti-scope: no deposit/withdraw write UI (deposits happen externally
 * via Solana wallets), no transfer history (deferred to indexer HTTP),
 * no fund management (Venture-specific, future quest).
 */
export default function AssetsPage({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = entity?.trust_address ?? null;

  const { vault, holdings, budgets, vestingCount, isLoading, error } = useAssets(trustAddress);

  if (!trustAddress) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <EmptyState
            title="Not yet on-chain"
            description="This entity does not have a TRUST proxy address yet. Once the click-to-DAO bridge fires, the treasury vault and on-chain holdings will render here."
          />
        </PageBody>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <Loading variant="section" label="Reading on-chain treasury state" />
        </PageBody>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <EmptyState
            title="Couldn't read treasury state"
            description={error.message || "The RPC call to the configured Solana cluster failed."}
          />
        </PageBody>
      </Page>
    );
  }

  if (!vault) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <EmptyState
            title="Treasury vault unavailable"
            description="The treasury vault PDAs could not be derived for this TRUST."
          />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Assets" description="What the TRUST holds." />
      <PageBody>
        <CapitalizeSection vaultAuthority={vault.vaultAuthorityPda.toBase58()} />
        <VaultIdentitySection
          moduleStatePda={vault.moduleStatePda.toBase58()}
          vaultAuthorityPda={vault.vaultAuthorityPda.toBase58()}
          treasuryAuthority={vault.moduleState?.treasuryAuthority.toBase58() ?? null}
          moduleInitialized={!!vault.moduleState}
        />
        <HoldingsSection holdings={holdings ?? []} />
        {(budgets?.length ?? 0) > 0 && <BudgetsSection budgets={budgets ?? []} />}
        {(vestingCount ?? 0) > 0 && <VestingTile count={vestingCount ?? 0} />}
      </PageBody>
    </Page>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Sections                                                            */
/* ────────────────────────────────────────────────────────────────── */

function CapitalizeSection({ vaultAuthority }: { vaultAuthority: string }) {
  return (
    <PageSection
      title="Capitalize your TRUST"
      description="Send USDC (or any SPL token) to the vault address from any Solana wallet. The TRUST owns the balance the moment it lands."
    >
      <Card padding="lg">
        <Inline gap="6" align="start">
          <QRCode value={vaultAuthority} size={160} />
          <Stack gap="3" style={{ flex: 1, minWidth: 0 }}>
            <DetailField label="Vault deposit address">
              <CopyableMono full={vaultAuthority} display={vaultAuthority} mode="full" />
            </DetailField>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
              The deposit address is a program-owned PDA — only the TRUST&apos;s configured treasury
              authority can authorize a withdrawal.
            </span>
          </Stack>
        </Inline>
      </Card>
    </PageSection>
  );
}

function VaultIdentitySection({
  moduleStatePda,
  vaultAuthorityPda,
  treasuryAuthority,
  moduleInitialized,
}: {
  moduleStatePda: string;
  vaultAuthorityPda: string;
  treasuryAuthority: string | null;
  moduleInitialized: boolean;
}) {
  return (
    <PageSection title="Vault identity">
      <DetailField label="Vault authority (PDA)">
        <CopyableMono full={vaultAuthorityPda} display={shortAddress(vaultAuthorityPda)} />
      </DetailField>
      <DetailField label="Module state (PDA)">
        <CopyableMono full={moduleStatePda} display={shortAddress(moduleStatePda)} />
      </DetailField>
      <DetailField label="Treasury authority">
        {treasuryAuthority ? (
          <CopyableMono full={treasuryAuthority} display={shortAddress(treasuryAuthority)} />
        ) : (
          <span style={{ color: "var(--color-text-muted)" }}>—</span>
        )}
      </DetailField>
      <DetailField label="Module">
        <Badge variant={moduleInitialized ? "success" : "muted"} dot>
          {moduleInitialized ? "Initialized" : "Not initialized"}
        </Badge>
      </DetailField>
    </PageSection>
  );
}

function HoldingsSection({ holdings }: { holdings: VaultHolding[] }) {
  // Group by mint so multiple ATAs against the same mint collapse to one
  // row with aggregate amount. Rare in practice (one mint normally has
  // one ATA per owner) but possible after wallet weirdness.
  const rows = useMemo(() => {
    const byMint = new Map<string, { mint: string; amount: bigint; tokenAccount: string }>();
    for (const h of holdings) {
      const key = h.mint.toBase58();
      const prev = byMint.get(key);
      if (prev) {
        prev.amount = prev.amount + h.amount;
      } else {
        byMint.set(key, {
          mint: key,
          amount: h.amount,
          tokenAccount: h.tokenAccount.toBase58(),
        });
      }
    }
    return [...byMint.values()].sort((a, b) => {
      // Surface non-zero balances first; alphabetize the rest.
      const aZero = a.amount === 0n;
      const bZero = b.amount === 0n;
      if (aZero !== bZero) return aZero ? 1 : -1;
      return a.mint.localeCompare(b.mint);
    });
  }, [holdings]);

  const columns: Array<TableColumn<(typeof rows)[number]>> = [
    {
      key: "token",
      header: "Token",
      cell: (row) => {
        const meta = lookupTokenMeta(row.mint);
        return (
          <span style={{ display: "inline-flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ fontWeight: 500 }}>{meta.symbol ?? "Unknown"}</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
              }}
            >
              {shortAddress(row.mint)}
            </span>
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      cell: (row) => {
        const meta = lookupTokenMeta(row.mint);
        return (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatTokenAmount(row.amount, meta.decimals)}
          </span>
        );
      },
    },
    {
      key: "ata",
      header: "Token account",
      cell: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          {shortAddress(row.tokenAccount)}
        </span>
      ),
    },
  ];

  return (
    <PageSection
      title="Holdings"
      description="SPL token accounts owned by the vault authority across the Token and Token-2022 programs."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.mint}
        empty={
          <EmptyState
            title="No holdings yet"
            description="Send USDC or any other SPL token to the vault deposit address above to capitalize the TRUST."
          />
        }
        ariaLabel="Vault holdings"
      />
    </PageSection>
  );
}

function BudgetsSection({ budgets }: { budgets: BudgetAccountWithPda[] }) {
  const rows = useMemo(
    () =>
      [...budgets].sort((a, b) => {
        // Frozen budgets last; otherwise stable by budget_id.
        const aFrozen = a.account.frozen ? 1 : 0;
        const bFrozen = b.account.frozen ? 1 : 0;
        if (aFrozen !== bFrozen) return aFrozen - bFrozen;
        return bytesToHex(a.account.budgetId).localeCompare(bytesToHex(b.account.budgetId));
      }),
    [budgets],
  );

  const columns: Array<TableColumn<BudgetAccountWithPda>> = [
    {
      key: "budgetId",
      header: "Budget",
      cell: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          {bytesIdLabel(row.account.budgetId)}
        </span>
      ),
    },
    {
      key: "role",
      header: "Target role",
      cell: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          {bytesIdLabel(row.account.targetRoleId)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Allocated",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.account.amount.toString()}</span>
      ),
    },
    {
      key: "spent",
      header: "Spent",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.account.spent.toString()}</span>
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      align: "end",
      cell: (row) => <ExpiryCell expiry={Number(row.account.expiry)} />,
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (row) =>
        row.account.frozen ? (
          <Badge variant="warning" dot>
            Frozen
          </Badge>
        ) : (
          <Badge variant="success" dot>
            Active
          </Badge>
        ),
    },
  ];

  return (
    <PageSection
      title="Active budgets"
      description="Per-role allocations recorded on `aeqi_budget`. Spend caps are enforced on-chain."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        ariaLabel="Active budgets"
      />
    </PageSection>
  );
}

function VestingTile({ count }: { count: number }) {
  return (
    <PageSection title="Vesting">
      <MetricGrid columns={3}>
        <MetricCard
          label="Positions outstanding"
          value={count.toString()}
          detail="Outstanding vesting grants on this TRUST."
        />
      </MetricGrid>
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ────────────────────────────────────────────────────────────────── */

function CopyableMono({
  full,
  display,
  mode,
}: {
  full: string;
  display: string;
  mode?: "short" | "full";
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(full);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <span
        role="button"
        tabIndex={0}
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleCopy(e);
        }}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: mode === "full" ? "var(--text-sm)" : "var(--text-sm)",
          cursor: "pointer",
          wordBreak: mode === "full" ? "break-all" : "normal",
        }}
      >
        {display}
        {copied ? " ✓" : ""}
      </span>
    </Tooltip>
  );
}

function ExpiryCell({ expiry }: { expiry: number }) {
  // Expiry is a unix-seconds timestamp; 0 means "no expiry".
  if (expiry === 0) {
    return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
  }
  const date = new Date(expiry * 1000);
  const now = Date.now();
  const expired = date.getTime() <= now;
  const label = date.toISOString().slice(0, 10);
  return expired ? (
    <Badge variant="warning" size="sm" dot>
      Expired {label}
    </Badge>
  ) : (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>
  );
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Convert raw token base units to a human-readable amount. When the
 * mint's decimals are unknown (no registry hit), fall back to the raw
 * base-unit string so we never silently misrender by assuming 6.
 */
function formatTokenAmount(amount: bigint, decimals: number | null): string {
  if (decimals === null) return amount.toString();
  if (decimals === 0) return amount.toString();
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}

/** Anchor returns `[u8; 32]` as either Uint8Array or number[] — normalize. */
function bytesToHex(bytes: Uint8Array | number[]): string {
  const iter = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of iter) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Render a 32-byte sentinel ID. Many on-chain IDs are
 * `pad32(ascii_prefix)` — surface the ASCII prefix when present,
 * otherwise fall back to a truncated hex preview.
 */
function bytesIdLabel(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let asciiLen = 0;
  for (const b of arr) {
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) {
      asciiLen += 1;
      continue;
    }
    asciiLen = 0;
    break;
  }
  if (asciiLen > 0 && asciiLen <= 16) {
    return new TextDecoder("ascii").decode(arr.slice(0, asciiLen));
  }
  return `0x${bytesToHex(arr).slice(0, 12)}…`;
}
