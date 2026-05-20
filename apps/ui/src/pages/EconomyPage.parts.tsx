import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import { Button, EmptyState, Loading, PageSection, type TableColumn } from "@/components/ui";
import { formatInteger } from "@/lib/i18n";
import type { Trust } from "@/lib/types";
import {
  compactAddress,
  POOL_KIND_CHIP_LABEL,
  POOL_KIND_LABEL,
  type PoolKind,
  type PoolKindFilter,
} from "./EconomyPage.utils";
import styles from "./EconomyPage.module.css";

export interface PoolRow {
  id: string;
  trust: Trust;
  kind: PoolKind;
  curve: string;
  assetMint: string;
  quoteMint: string;
  buyAmount: number;
  maxCost: number;
}

/** Column factory for the indexed liquidity-pool table. Lives next to its
 * sibling parts so the EconomyPage shell stays under the file-length cap. */
export function makePoolColumns(onOpen: (row: PoolRow) => void): Array<TableColumn<PoolRow>> {
  return [
    {
      key: "pool",
      header: "Pool",
      cell: (row) => (
        <span className={styles.trustCellText}>
          <span className={styles.trustName}>{POOL_KIND_LABEL[row.kind]}</span>
          <span className={styles.trustMeta}>{row.trust.name}</span>
        </span>
      ),
      sortable: true,
      sortAccessor: (row) => row.trust.name,
    },
    {
      key: "liquidity",
      header: "Liquidity",
      cell: (row) => (
        <TableStatus
          state={row.buyAmount > 0 ? "in_progress" : "backlog"}
          label={row.buyAmount > 0 ? "Bonded" : "Dormant"}
        />
      ),
      width: "108px",
      sortable: true,
      sortAccessor: (row) => (row.buyAmount > 0 ? 1 : 0),
    },
    {
      key: "curve",
      header: "Curve",
      cell: (row) => <span className={styles.mono}>{compactAddress(row.curve)}</span>,
    },
    {
      key: "asset",
      header: "Asset",
      cell: (row) => <span className={styles.mono}>{compactAddress(row.assetMint)}</span>,
    },
    {
      key: "quote",
      header: "Quote",
      cell: (row) => <span className={styles.mono}>{compactAddress(row.quoteMint)}</span>,
    },
    {
      key: "buy",
      header: "First buy",
      cell: (row) => formatInteger(row.buyAmount),
      align: "end",
      width: "110px",
    },
    {
      key: "action",
      header: "",
      cell: (row) => (
        <Button
          variant="secondary"
          size="sm"
          trailingIcon={<ArrowUpRight size={13} strokeWidth={1.5} />}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
        >
          Open
        </Button>
      ),
      width: "92px",
      align: "end",
    },
  ];
}

/** Chrome-tier segmented chip group for the pools toolbar — `All / Genesis
 * / AMM`. Renders only the kinds present in the indexed pool set so the
 * strip stays a no-op when one kind dominates (today: just Genesis). */
export function PoolKindChips({
  kinds,
  value,
  onChange,
}: {
  kinds: PoolKind[];
  value: PoolKindFilter;
  onChange: (next: PoolKindFilter) => void;
}) {
  const options: PoolKindFilter[] = ["all", ...kinds];
  return (
    <div className={styles.kindChips} role="radiogroup" aria-label="Pool kind">
      {options.map((kind) => {
        const active = value === kind;
        const label = kind === "all" ? "All" : POOL_KIND_CHIP_LABEL[kind];
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.kindChip}${active ? ` ${styles.kindChipActive}` : ""}`}
            onClick={() => onChange(kind)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function TrustDirectory({
  trusts,
  loading,
  onOpen,
  onViewAll,
}: {
  trusts: Trust[];
  loading: boolean;
  onOpen: (trust: Trust) => void;
  onViewAll: () => void;
}) {
  return (
    <PageSection
      title="Trust directory"
      description="The public operating graph starts with every trust that can be inspected."
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={onViewAll}
          trailingIcon={<ArrowUpRight size={13} strokeWidth={1.5} />}
        >
          View all
        </Button>
      }
    >
      {loading ? (
        <div className={styles.loadingRow}>
          <Loading size="sm" /> Loading trusts...
        </div>
      ) : trusts.length === 0 ? (
        <EmptyState title="No trusts found" description="No trust matches the current search." />
      ) : (
        <div className={styles.trustGrid}>
          {trusts.map((trust) => (
            <article key={trust.id} className={styles.trustCard}>
              <button type="button" className={styles.trustCardMain} onClick={() => onOpen(trust)}>
                <span className={styles.trustCardHead}>
                  <TrustAvatar name={trust.name} size={36} />
                  <span className={styles.trustCellText}>
                    <span className={styles.trustName}>{trust.name}</span>
                    <span className={styles.trustMeta}>{trust.tagline || "Operating trust"}</span>
                  </span>
                </span>
              </button>
              <span className={styles.trustCardFoot}>
                <span className={styles.trustStatus}>
                  <span
                    className={`quest-status-dot quest-status-dot--${
                      trust.public ? "done" : "backlog"
                    }`}
                    aria-hidden
                  />
                  <span className={styles.trustStatusLabel}>
                    {trust.public ? "Public" : "Private"}
                  </span>
                </span>
                {trust.public && (
                  <Link to={`/${encodeURIComponent(trust.id)}`} className={styles.publicLink}>
                    Profile
                  </Link>
                )}
              </span>
            </article>
          ))}
        </div>
      )}
    </PageSection>
  );
}

export type RegistryTone = "live" | "pending" | "settled";

const TONE_TO_DOT: Record<RegistryTone, string> = {
  live: "in_progress",
  pending: "in_review",
  settled: "done",
};

export type MetricStatusState = "backlog" | "in_progress" | "in_review" | "done";

export function MetricStatus({ state, label }: { state: MetricStatusState; label: string }) {
  return (
    <span className={styles.metricStatus}>
      <span className={`quest-status-dot quest-status-dot--${state}`} aria-hidden />
      <span className={styles.metricStatusLabel}>{label}</span>
    </span>
  );
}

export function TableStatus({ state, label }: { state: MetricStatusState; label: string }) {
  return (
    <span className={styles.tableStatus}>
      <span className={`quest-status-dot quest-status-dot--${state}`} aria-hidden />
      <span className={styles.tableStatusLabel}>{label}</span>
    </span>
  );
}

function registryToneLabel(tone: RegistryTone, value: number): string {
  if (value === 0) {
    if (tone === "live") return "No live offers";
    if (tone === "pending") return "None pending";
    return "Nothing settled";
  }
  if (tone === "live") return value === 1 ? "1 live" : `${value} live`;
  if (tone === "pending") return value === 1 ? "1 pending" : `${value} pending`;
  return value === 1 ? "1 settled" : `${value} settled`;
}

export function RegistryCard({
  icon,
  title,
  value,
  body,
  tone,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  body: string;
  tone: RegistryTone;
  onOpen: () => void;
}) {
  const dotState = value === 0 ? "backlog" : TONE_TO_DOT[tone];
  return (
    <button type="button" className={styles.registryCard} onClick={onOpen}>
      <span className={styles.registryCardHead}>
        <span className={styles.registryIcon}>{icon}</span>
        <span className={styles.registryTitle}>{title}</span>
        <span className={styles.registryValue}>{value}</span>
      </span>
      <span className={styles.registryStatus}>
        <span className={`quest-status-dot quest-status-dot--${dotState}`} aria-hidden />
        <span className={styles.registryStatusLabel}>{registryToneLabel(tone, value)}</span>
      </span>
      <span className={styles.registryBody}>{body}</span>
    </button>
  );
}
