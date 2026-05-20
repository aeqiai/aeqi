import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import { Badge, Button, EmptyState, Loading, PageSection } from "@/components/ui";
import type { Trust } from "@/lib/types";
import styles from "./EconomyPage.module.css";

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
                <Badge variant={trust.public ? "success" : "muted"} size="sm">
                  {trust.public ? "Public" : "Private"}
                </Badge>
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
