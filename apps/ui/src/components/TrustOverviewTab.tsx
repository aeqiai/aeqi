import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Copy, Check } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useTreasury } from "@/hooks/useTreasury";
import { fetchTrust } from "@/lib/indexer";
import { api } from "@/lib/api";
import { formatShortDate } from "@/lib/i18n";
import type { Quest } from "@/lib/types";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { entityBasePath } from "@/lib/entityPath";
import TrustHeroStrip from "./TrustHeroStrip";
import TrustStateBand, { MILESTONE_ORDER, type MilestoneKey } from "./TrustStateBand";
import TrustGenesisCurveCard from "./TrustGenesisCurveCard";
import BlockAvatar from "./BlockAvatar";
import { Loading } from "@/components/ui";
import "@/styles/overview.css";

const HealthBlock = lazy(() => import("@/pages/HealthPage"));

type LaunchStatus = Awaited<ReturnType<typeof api.getLaunchStatus>>;
type GenesisCurveState = NonNullable<LaunchStatus["unifutures"]>;

/**
 * `/trust/<addr>/overview` — TRUST cockpit (v2).
 *
 * Composition (top → bottom, sections render conditionally):
 *
 *   1. Hero band — TrustHeroStrip (avatar plate + name + tagline +
 *      chrome row). Identity at-a-glance.
 *   2. State band — one wide card carrying the mode-specific primary
 *      CTA: operational → chat / provisioning → progress / static →
 *      launch. This is the 120% beat of the page.
 *   3. On-chain identity strip — compact TRUST address + signers count.
 *      Always visible; the proof this is a real on-chain primitive.
 *   4. Operations grid (operational mode only) — pulse stack left (one
 *      primary card, two quieter satellites) + side stats right.
 *   5. Modules row — one card per installed module. Genesis curve is
 *      the first (and currently only) module; renders only when
 *      launchStatus.unifutures !== null.
 *   6. Health — substrate compounding, lazy-loaded (operational mode).
 *
 * All cards paint --color-card-elevated to sit above .content-paper
 * (--color-card). Same paper-on-paper convention as the home page.
 */
export default function TrustOverviewTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  const entity = entities.find((e) => e.id === trustId);
  const trustAddress = entity?.trust_address;
  const basePath = entity ? entityBasePath(entity) : "/launch";

  // ── Launch / runtime state ──────────────────────────────────────────
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLaunchStatus(trustId)
      .then((status) => {
        if (cancelled) return;
        setLaunchStatus(status);
        setLaunchError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLaunchStatus(null);
        setLaunchError(err instanceof Error ? err.message : "Status unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [trustId]);

  // Mode is derived from launch state. The current milestone is the
  // first one not yet reached; once all reached, mode flips operational.
  const mode = useMemo<"operational" | "provisioning" | "static" | "error">(() => {
    if (entity?.launch_error || launchStatus?.runtime_error || launchStatus?.trust_error)
      return "error";
    if (!launchStatus) return "static";
    const allDone = MILESTONE_ORDER.every((k) => launchStatus.milestones[k]?.reached);
    if (allDone) return "operational";
    const anyReached = MILESTONE_ORDER.some((k) => launchStatus.milestones[k]?.reached);
    return anyReached ? "provisioning" : "static";
  }, [launchStatus, entity?.launch_error]);

  const currentMilestone = useMemo<MilestoneKey | null>(() => {
    if (!launchStatus) return null;
    return MILESTONE_ORDER.find((k) => !launchStatus.milestones[k]?.reached) ?? null;
  }, [launchStatus]);

  // ── Click-to-copy address ────────────────────────────────────────────
  const [trustCopied, setTrustCopied] = useState(false);
  const copyAddress = () => {
    if (!trustAddress) return;
    navigator.clipboard.writeText(trustAddress);
    setTrustCopied(true);
    setTimeout(() => setTrustCopied(false), 1500);
  };

  // ── Inbox (entity-scoped decisions) ─────────────────────────────────
  const inboxAllItems = useInboxStore((s) => s.items);
  const inboxPending = useInboxStore((s) => s.pendingDismissal);
  const entityInbox = useMemo(
    () =>
      inboxAllItems.filter(
        (i) => i.trust_id === trustId && !!i.awaiting_at && !inboxPending.has(i.session_id),
      ),
    [inboxAllItems, inboxPending, trustId],
  );

  // ── Agents subtree ──────────────────────────────────────────────────
  const subtreeAgents = useMemo(
    () => agents.filter((a) => a.trust_id === trustId || a.id === trustId),
    [agents, trustId],
  );
  const subtreeIds = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.id)),
    [subtreeAgents],
  );
  const subtreeNames = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.name)),
    [subtreeAgents],
  );
  const activeAgentsCount = useMemo(
    () =>
      subtreeAgents.filter(
        (a) => a.status === "running" || a.status === "active" || a.status === "online",
      ).length,
    [subtreeAgents],
  );
  const rootAgent = useMemo(
    () => subtreeAgents.find((a) => a.id === entity?.agent_id) ?? subtreeAgents[0] ?? null,
    [subtreeAgents, entity?.agent_id],
  );

  // ── Pulse: next steps / recent events ───────────────────────────────
  const nextStepQuests = useMemo(
    () =>
      quests
        .filter(
          (q) =>
            (q.status === "in_progress" ||
              q.status === "in_review" ||
              q.status === "todo" ||
              q.status === "backlog") &&
            ((q.agent_id && subtreeIds.has(q.agent_id)) || q.agent_id === trustId),
        )
        .sort((a, b) => {
          const statusDelta = questStatusRank(a.status) - questStatusRank(b.status);
          if (statusDelta !== 0) return statusDelta;
          const priorityDelta = questPriorityRank(a.priority) - questPriorityRank(b.priority);
          if (priorityDelta !== 0) return priorityDelta;
          return parseTs(a.created_at) - parseTs(b.created_at);
        })
        .slice(0, 4),
    [quests, subtreeIds, trustId],
  );

  const recentEvents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events
      .filter((ev) => ev.agent && subtreeNames.has(ev.agent) && parseTs(ev.timestamp) >= cutoff)
      .sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp))
      .slice(0, 5);
  }, [events, subtreeNames]);

  // ── Treasury ────────────────────────────────────────────────────────
  const { balances, transfers } = useTreasury(trustId);
  const assetCount = balances?.length ?? null;
  const netDelta = useMemo(() => {
    if (transfers === null) return null;
    let inCount = 0;
    let outCount = 0;
    for (const t of transfers.slice(0, 50)) {
      if (t.direction === "in") inCount += 1;
      else outCount += 1;
    }
    return { inCount, outCount };
  }, [transfers]);

  // ── On-chain signers count ──────────────────────────────────────────
  const [signersCount, setSignersCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!trustAddress) {
      setSignersCount(null);
      return;
    }
    fetchTrust(trustAddress)
      .then((trust) => {
        if (cancelled) return;
        setSignersCount(trust?.signersCount ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setSignersCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  // ── Genesis curve module ────────────────────────────────────────────
  const [buying, setBuying] = useState(false);
  const [buyResult, setBuyResult] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const genesisCurve: GenesisCurveState | null = launchStatus?.unifutures ?? null;

  const handleFirstBuy = async () => {
    setBuying(true);
    setBuyError(null);
    setBuyResult(null);
    try {
      const result = await api.tryUnifuturesFirstBuy({ entity_id: trustId });
      setBuyResult(result.signature_b58);
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Buy failed.");
    } finally {
      setBuying(false);
    }
  };

  // ── Mode-specific primary CTA target ────────────────────────────────
  const operationalCtaPath = useMemo(() => {
    if (!entity || !rootAgent) return `${basePath}/agents`;
    return `${basePath}/agents/${encodeURIComponent(rootAgent.id)}`;
  }, [entity, rootAgent, basePath]);

  return (
    <div className="trust-overview">
      <TrustHeroStrip trustId={trustId} />

      <TrustStateBand
        mode={mode}
        currentMilestone={currentMilestone}
        launchError={launchError ?? entity?.launch_error ?? null}
        activeAgents={activeAgentsCount}
        totalAgents={subtreeAgents.length}
        operationalCtaPath={operationalCtaPath}
        onLaunch={() => navigate("/launch")}
        rootAgentName={rootAgent?.name}
      />

      {trustAddress && (
        <section className="trust-overview-identity" aria-label="On-chain identity">
          <span className="trust-overview-identity-label">TRUST</span>
          <button
            type="button"
            className="trust-overview-identity-addr"
            onClick={copyAddress}
            title={trustCopied ? "Copied" : "Click to copy"}
          >
            <span>{trustAddress}</span>
            {trustCopied ? (
              <Check size={14} strokeWidth={1.8} />
            ) : (
              <Copy size={14} strokeWidth={1.5} />
            )}
          </button>
          <span className="trust-overview-identity-sep" aria-hidden>
            ·
          </span>
          <span className="trust-overview-identity-label">Signers</span>
          <span className="trust-overview-identity-num">
            {signersCount === null ? "—" : signersCount}
          </span>
        </section>
      )}

      {mode === "operational" && (
        <section className="trust-overview-ops" aria-label="Operations">
          <div className="trust-overview-ops-pulse">
            <PulseCard
              tone="primary"
              title="Awaiting decisions"
              empty="No decisions waiting."
              link={
                entityInbox.length > 0 ? { to: `${basePath}/inbox`, label: "Open inbox" } : null
              }
            >
              {entityInbox.slice(0, 5).map((item) => {
                const fromName = item.agent_name || "Agent";
                const preview =
                  item.awaiting_subject || item.last_agent_message || item.session_name;
                return (
                  <PulseRow
                    key={item.session_id}
                    avatar={fromName}
                    from={fromName}
                    time={relativeTime(item.awaiting_at ?? item.last_active)}
                    text={preview ?? "Untitled"}
                    onClick={() =>
                      navigate(
                        sessionDeepUrlFromId(
                          entities,
                          item.trust_id,
                          item.agent_id,
                          item.session_id,
                        ),
                      )
                    }
                  />
                );
              })}
            </PulseCard>

            <div className="trust-overview-ops-pulse-pair">
              <PulseCard
                tone="quiet"
                title="Next steps"
                empty="No queued work."
                link={
                  nextStepQuests.length > 0
                    ? { to: `${basePath}/quests`, label: "All quests" }
                    : null
                }
              >
                {nextStepQuests.map((q) => {
                  const agent = q.agent_id ? agents.find((a) => a.id === q.agent_id) : null;
                  const agentName = agent?.name ?? "Agent";
                  return (
                    <PulseRow
                      key={q.id}
                      avatar={agentName}
                      from={agentName}
                      time=""
                      text={q.idea?.name ?? "untitled quest"}
                      onClick={() => navigate(`${basePath}/quests/${encodeURIComponent(q.id)}`)}
                    />
                  );
                })}
              </PulseCard>

              <PulseCard
                tone="quiet"
                title="Last 24h"
                empty="Quiet day. No activity."
                link={
                  recentEvents.length > 0 ? { to: `${basePath}/events`, label: "All events" } : null
                }
              >
                {recentEvents.map((ev) => {
                  const decision = ev.decision_type.replace(/_/g, " ");
                  return (
                    <PulseRow
                      key={ev.id}
                      avatar={ev.agent ?? "system"}
                      from={ev.agent ?? "system"}
                      time={relativeTime(ev.timestamp)}
                      text={decision}
                      onClick={() => navigate(`${basePath}/events`)}
                    />
                  );
                })}
              </PulseCard>
            </div>
          </div>

          <aside className="trust-overview-ops-stats" aria-label="Stats">
            <Stat
              label="Active agents"
              value={String(activeAgentsCount)}
              hint={`of ${subtreeAgents.length}`}
              to={`${basePath}/agents`}
            />
            <Stat
              label="Treasury"
              value={assetCount === null ? "—" : String(assetCount)}
              hint={assetCount === 1 ? "asset" : "assets"}
              delta={netDelta ? netDeltaLabel(netDelta) : null}
              deltaTone={netDeltaTone(netDelta)}
              to={`${basePath}/treasury`}
            />
            <Stat
              label="In flight"
              value={String(nextStepQuests.length)}
              hint={nextStepQuests.length === 1 ? "quest" : "quests"}
              to={`${basePath}/quests`}
            />
          </aside>
        </section>
      )}

      {genesisCurve && (
        <section className="trust-overview-modules" aria-label="Modules">
          <div className="trust-overview-section-head">
            <h2 className="trust-overview-section-title">Modules</h2>
            <p className="trust-overview-section-sub">
              Programmable surfaces installed on this TRUST.
            </p>
          </div>
          <TrustGenesisCurveCard
            curve={genesisCurve}
            buying={buying}
            buyResult={buyResult}
            buyError={buyError}
            onFirstBuy={handleFirstBuy}
          />
        </section>
      )}

      {mode === "operational" && (
        <section className="trust-overview-health" aria-label="Health">
          <div className="trust-overview-section-head">
            <h2 className="trust-overview-section-title">Health</h2>
            <p className="trust-overview-section-sub">Is this TRUST compounding?</p>
          </div>
          <div className="trust-overview-card">
            <Suspense fallback={<Loading size="sm" />}>
              <HealthBlock trustId={trustId} />
            </Suspense>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Pulse card ──────────────────────────────────────────────────────────

interface PulseCardProps {
  tone: "primary" | "quiet";
  title: string;
  empty: string;
  link: { to: string; label: string } | null;
  children?: React.ReactNode;
}

function PulseCard({ tone, title, empty, link, children }: PulseCardProps) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  const hasItems = items.length > 0;
  return (
    <article className={`trust-overview-card trust-overview-pulse trust-overview-pulse--${tone}`}>
      <header className="trust-overview-pulse-head">
        <h3 className="trust-overview-pulse-title">{title}</h3>
        {link && (
          <Link className="trust-overview-pulse-link" to={link.to}>
            {link.label}
            <ArrowRight size={12} strokeWidth={1.8} />
          </Link>
        )}
      </header>
      {hasItems ? (
        <ul className="trust-overview-pulse-list" role="list">
          {items}
        </ul>
      ) : (
        <p className="trust-overview-pulse-empty">{empty}</p>
      )}
    </article>
  );
}

interface PulseRowProps {
  avatar: string;
  from: string;
  time: string;
  text: string;
  onClick: () => void;
}

function PulseRow({ avatar, from, time, text, onClick }: PulseRowProps) {
  return (
    <li className="trust-overview-pulse-row">
      <button type="button" className="trust-overview-pulse-btn" onClick={onClick}>
        <span className="trust-overview-pulse-meta">
          <span className="trust-overview-pulse-avatar" aria-hidden>
            <BlockAvatar name={avatar} size={18} />
          </span>
          <span className="trust-overview-pulse-from">{from}</span>
          {time && <span className="trust-overview-pulse-time">{time}</span>}
        </span>
        <span className="trust-overview-pulse-text">{text}</span>
      </button>
    </li>
  );
}

// ── Stat tile ───────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  delta?: string | null;
  deltaTone?: "positive" | "negative" | "neutral";
  to: string;
}

function Stat({ label, value, hint, delta, deltaTone = "neutral", to }: StatProps) {
  return (
    <Link to={to} className="trust-overview-card trust-overview-stat">
      <span className="trust-overview-stat-label">{label}</span>
      <span className="trust-overview-stat-value">
        {value}
        {hint && <span className="trust-overview-stat-hint"> {hint}</span>}
      </span>
      {delta && (
        <span className={`trust-overview-stat-delta trust-overview-stat-delta--${deltaTone}`}>
          {delta}
        </span>
      )}
    </Link>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function questStatusRank(status: Quest["status"]): number {
  if (status === "in_review") return 0;
  if (status === "in_progress") return 1;
  if (status === "todo") return 2;
  if (status === "backlog") return 3;
  return 4;
}

function questPriorityRank(priority: Quest["priority"]): number {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "normal") return 2;
  if (priority === "low") return 3;
  return 4;
}

function parseTs(value: string | undefined): number {
  if (!value) return 0;
  const d = Date.parse(value);
  return Number.isFinite(d) ? d : 0;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return formatShortDate(ts);
}

function netDeltaLabel(delta: { inCount: number; outCount: number } | null): string {
  if (delta === null) return "";
  if (delta.inCount === 0 && delta.outCount === 0) return "no movement";
  return `+${delta.inCount} in · −${delta.outCount} out`;
}

function netDeltaTone(
  delta: { inCount: number; outCount: number } | null,
): "positive" | "negative" | "neutral" {
  if (delta === null) return "neutral";
  if (delta.inCount > delta.outCount) return "positive";
  if (delta.outCount > delta.inCount) return "negative";
  return "neutral";
}
