import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import BlockAvatar from "./BlockAvatar";
import { Loading, Tooltip } from "@/components/ui";
import "@/styles/overview.css";

// HealthBlock — substrate compounding read folded into the cockpit
// 2026-05-17. Renders the 4 trend metrics + 30d sparklines as a
// section beneath the slim numbers row. Lazy-imported to keep the
// initial Overview chunk small; the Health hook pulls a deeper
// activity tail on mount.
const HealthBlock = lazy(() => import("@/pages/HealthPage"));

type LaunchStatus = Awaited<ReturnType<typeof api.getLaunchStatus>>;
type GenesisCurveState = NonNullable<LaunchStatus["unifutures"]>;

/**
 * `/trust/<addr>/overview` — TRUST cockpit.
 *
 * Founder-locked direction (2026-05-08): Overview answers
 * "what's happening now," not "what does the P&L look like."
 * Financial/on-chain indicators stay a pulse here, not a dedicated
 * balance-sheet page.
 *
 * Four blocks:
 *   1. Hero strip — name, tagline, public toggle (kept; already shipped)
 *   2. Pulse band — three side-by-side cards:
 *        a) Next steps      — seeded onboarding and in-flight work
 *        b) Awaiting decisions — entity-scoped inbox (kind=decision_request)
 *        c) Last 24h activity — compact agent activity stream
 *   3. Slim numbers row — 4 stat tiles:
 *        Assets · 7d activity · TRUST signers · Active agents
 *   4. Health block — substrate compounding (folded in 2026-05-17 from
 *      the retired /trust/<addr>/health surface): 4 trend metrics with
 *      one-line interpretations + 30d sparklines.
 *
 * Pulse cards and routed stat tiles click through to their full surface.
 * Empty states render gracefully and surface the next action inline.
 */
export default function TrustOverviewTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  const entity = entities.find((e) => e.id === trustId);
  const trustAddress = entity?.trust_address;

  // Click-to-copy the truncated TRUST pubkey: the demo moment where the
  // audience can paste the address into any Solana explorer to verify
  // the on-chain reality. `stopPropagation` lets the rest of the tile
  // still navigate to /trust/<addr>.
  const [trustCopied, setTrustCopied] = useState(false);
  const handleCopyTrust = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!trustAddress) return;
    navigator.clipboard.writeText(trustAddress);
    setTrustCopied(true);
    setTimeout(() => setTrustCopied(false), 1500);
  };

  // Inbox: subscribe to raw fields and useMemo the entity-filtered slice.
  // A selector that filters inline returns a fresh array every call and
  // breaks `useSyncExternalStore`'s identity check (React error #185).
  const inboxAllItems = useInboxStore((s) => s.items);
  const inboxPending = useInboxStore((s) => s.pendingDismissal);
  // The overview's "Awaiting decisions" card surfaces decision-requests
  // only — filter to rows with `awaiting_at` set. The broadened inbox
  // query (2026-05-07) returns every session in scope; this card stays
  // narrow to its purpose.
  const entityInbox = useMemo(
    () =>
      inboxAllItems.filter(
        (i) => i.trust_id === trustId && !!i.awaiting_at && !inboxPending.has(i.session_id),
      ),
    [inboxAllItems, inboxPending, trustId],
  );

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

  // ── Pulse: next steps ───────────────────────────────────────────────
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
        .slice(0, 5),
    [quests, subtreeIds, trustId],
  );

  // ── Pulse: last 24h activity stream ─────────────────────────────────
  const recentEvents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events
      .filter((ev) => ev.agent && subtreeNames.has(ev.agent) && parseTs(ev.timestamp) >= cutoff)
      .sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp))
      .slice(0, 6);
  }, [events, subtreeNames]);

  // ── Numbers row: indexed assets + 7d transfer activity ──────────────
  const { balances, transfers } = useTreasury(trustId);

  // Indexed asset count. The dedicated page surface was retired; keep the
  // lightweight indexer signal in the cockpit without linking to a dead route.
  const assetDisplay = useMemo(() => {
    if (balances === null) return "—";
    const total = balances.length;
    if (total === 0) return "0 assets";
    return `${total} ${total === 1 ? "asset" : "assets"}`;
  }, [balances]);

  // Recent transfer counts (in vs out) as a 7d-activity proxy. Direction-
  // only signal — the indexer returns hex amounts per-token without a USD
  // oracle, so the sign + label ("+3 in / -1 out" vs "no movement") is
  // what matters at-a-glance. Block-time joins for a strict 7d window
  // are deferred; we cap at the most recent 50 transfers as a proxy.
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

  // ── Numbers row: TRUST signers count ────────────────────────────────
  const [trustsCount, setTrustsCount] = useState<number | null>(null);
  const [genesisCurve, setGenesisCurve] = useState<GenesisCurveState | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyResult, setBuyResult] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!trustAddress) {
      setTrustsCount(null);
      return;
    }
    fetchTrust(trustAddress)
      .then((trust) => {
        if (cancelled) return;
        setTrustsCount(trust?.signersCount ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setTrustsCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  useEffect(() => {
    let cancelled = false;
    if (!trustAddress) {
      setGenesisCurve(null);
      setCurveError(null);
      return;
    }
    api
      .getLaunchStatus(trustId)
      .then((status) => {
        if (cancelled) return;
        setGenesisCurve(status.unifutures);
        setCurveError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setGenesisCurve(null);
        setCurveError(err instanceof Error ? err.message : "Curve state unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [trustId, trustAddress]);

  // ── Numbers row: active agents (status=running/active/online) ───────
  const activeAgentsCount = useMemo(
    () =>
      subtreeAgents.filter(
        (a) => a.status === "running" || a.status === "active" || a.status === "online",
      ).length,
    [subtreeAgents],
  );

  // basePath is canonical: /trust/<addr>.
  // trustPath here is the same — kept as a separate name for the
  // signers stat tile to read clearly.
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const trustPath = basePath;

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

  return (
    <div className="entity-overview">
      <TrustHeroStrip trustId={trustId} />

      {/* ── Pulse band ── */}
      <div className="entity-overview-pulse">
        {/* a) Next steps */}
        <section className="entity-overview-pulse-card" aria-labelledby="pulse-quests">
          <div className="entity-overview-pulse-head">
            <h2 id="pulse-quests" className="entity-overview-pulse-title">
              Next steps
            </h2>
            {nextStepQuests.length > 0 && (
              <Link to={`${basePath}/quests`} className="entity-overview-pulse-link">
                View all →
              </Link>
            )}
          </div>
          {nextStepQuests.length === 0 ? (
            <p className="entity-overview-pulse-empty">
              No queued next steps ·{" "}
              <Link to={`${basePath}/quests`} className="entity-overview-pulse-empty-link">
                start one →
              </Link>
            </p>
          ) : (
            <ul className="entity-overview-pulse-list" role="list">
              {nextStepQuests.map((q) => {
                const agent = q.agent_id ? agents.find((a) => a.id === q.agent_id) : null;
                const agentName = agent?.name ?? "Agent";
                return (
                  <li key={q.id} className="entity-overview-pulse-row">
                    <button
                      type="button"
                      className="entity-overview-pulse-btn"
                      onClick={() => navigate(`${basePath}/quests/${encodeURIComponent(q.id)}`)}
                    >
                      <span className="entity-overview-pulse-from">
                        <span className="entity-overview-pulse-avatar" aria-hidden>
                          {agent?.avatar ? (
                            <img src={agent.avatar} alt="" />
                          ) : (
                            <BlockAvatar name={agentName} size={18} />
                          )}
                        </span>
                        {agentName}
                      </span>
                      <span className="entity-overview-pulse-text">
                        {q.idea?.name ?? "untitled quest"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* b) Awaiting decisions */}
        <section className="entity-overview-pulse-card" aria-labelledby="pulse-decisions">
          <div className="entity-overview-pulse-head">
            <h2 id="pulse-decisions" className="entity-overview-pulse-title">
              Awaiting decisions
            </h2>
            {entityInbox.length > 0 && (
              <Link to={`${basePath}/inbox`} className="entity-overview-pulse-link">
                View inbox →
              </Link>
            )}
          </div>
          {entityInbox.length === 0 ? (
            <p className="entity-overview-pulse-empty">No decisions waiting.</p>
          ) : (
            <ul className="entity-overview-pulse-list" role="list">
              {entityInbox.slice(0, 5).map((item) => {
                const fromName = item.agent_name || "Agent";
                const preview =
                  item.awaiting_subject || item.last_agent_message || item.session_name;
                return (
                  <li key={item.session_id} className="entity-overview-pulse-row">
                    <button
                      type="button"
                      className="entity-overview-pulse-btn"
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
                    >
                      <span className="entity-overview-pulse-from">
                        <span className="entity-overview-pulse-avatar" aria-hidden>
                          <BlockAvatar name={fromName} size={18} />
                        </span>
                        {fromName}
                        <span className="entity-overview-pulse-time">
                          {relativeTime(item.awaiting_at ?? item.last_active)}
                        </span>
                      </span>
                      <span className="entity-overview-pulse-text">{preview}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* c) Last 24h activity */}
        <section className="entity-overview-pulse-card" aria-labelledby="pulse-activity">
          <div className="entity-overview-pulse-head">
            <h2 id="pulse-activity" className="entity-overview-pulse-title">
              Last 24h
            </h2>
            {recentEvents.length > 0 && (
              <Link to={`${basePath}/events`} className="entity-overview-pulse-link">
                View events →
              </Link>
            )}
          </div>
          {recentEvents.length === 0 ? (
            <p className="entity-overview-pulse-empty">Quiet day. No agent activity.</p>
          ) : (
            <ul className="entity-overview-pulse-list" role="list">
              {recentEvents.map((ev) => {
                const decision = ev.decision_type.replace(/_/g, " ");
                return (
                  <li key={ev.id} className="entity-overview-pulse-row">
                    <button
                      type="button"
                      className="entity-overview-pulse-btn"
                      onClick={() => navigate(`${basePath}/events`)}
                    >
                      <span className="entity-overview-pulse-from">
                        {ev.agent ?? "system"}
                        <span className="entity-overview-pulse-time">
                          {relativeTime(ev.timestamp)}
                        </span>
                      </span>
                      <span className="entity-overview-pulse-text">{decision}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ── Slim numbers row ── */}
      <div className="entity-overview-numbers">
        <div className="entity-overview-stat">
          <span className="entity-overview-stat-label">Assets</span>
          <span className="entity-overview-stat-value">{assetDisplay}</span>
        </div>

        <div className="entity-overview-stat">
          <span className="entity-overview-stat-label">Activity</span>
          <span className="entity-overview-stat-value">{netDeltaValue(netDelta)}</span>
          <span className={netDeltaClassName(netDelta)}>{netDeltaLabel(netDelta)}</span>
        </div>

        <Link to={trustPath} className="entity-overview-stat">
          <span className="entity-overview-stat-label">TRUST signers</span>
          <span className="entity-overview-stat-value">
            {trustsCount === null ? "—" : trustsCount}
          </span>
          {trustAddress ? (
            <Tooltip content={trustCopied ? "Copied" : "Copy full address"}>
              <span
                role="button"
                tabIndex={0}
                onClick={handleCopyTrust}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleCopyTrust(e);
                }}
                className="entity-overview-stat-delta entity-overview-trust-pubkey"
              >
                {trustAddress.length > 12
                  ? `${trustAddress.slice(0, 6)}…${trustAddress.slice(-4)}`
                  : trustAddress}
                {trustCopied ? " ✓" : ""}
              </span>
            </Tooltip>
          ) : null}
        </Link>

        <Link to={`${basePath}/agents`} className="entity-overview-stat">
          <span className="entity-overview-stat-label">Active agents</span>
          <span className="entity-overview-stat-value">
            {activeAgentsCount}
            <span className="entity-overview-stat-delta">/{subtreeAgents.length}</span>
          </span>
        </Link>
      </div>

      <section className="entity-overview-genesis" aria-labelledby="overview-genesis">
        <div className="entity-overview-section-head">
          <h2 id="overview-genesis" className="entity-overview-section-title">
            Genesis curve
          </h2>
          <p className="entity-overview-section-sub">UniFutures first buy</p>
        </div>
        <div className="entity-overview-genesis-row">
          <div className="entity-overview-genesis-main">
            <span className="entity-overview-genesis-label">Curve</span>
            <span className="entity-overview-genesis-value">
              {genesisCurve
                ? compactAddress(genesisCurve.curve)
                : curveError
                  ? "unavailable"
                  : "loading"}
            </span>
            {genesisCurve && (
              <span className="entity-overview-genesis-sub">
                Asset {compactAddress(genesisCurve.asset_mint)} · USDC{" "}
                {compactAddress(genesisCurve.quote_mint)}
              </span>
            )}
            {!genesisCurve && curveError && (
              <span className="entity-overview-genesis-sub">{curveError}</span>
            )}
            {buyResult && (
              <span className="entity-overview-genesis-sub">
                Settled {compactAddress(buyResult)}
              </span>
            )}
            {buyError && <span className="entity-overview-genesis-error">{buyError}</span>}
          </div>
          <button
            type="button"
            className="entity-overview-genesis-buy"
            onClick={() => void handleFirstBuy()}
            disabled={!genesisCurve || buying}
          >
            {buying ? "Buying" : "Try $1 USDC buy"}
          </button>
        </div>
      </section>

      {/* ── Health block — substrate compounding ── */}
      <section className="entity-overview-health" aria-labelledby="overview-health">
        <header className="entity-overview-section-head">
          <h2 id="overview-health" className="entity-overview-section-title">
            Health
          </h2>
          <p className="entity-overview-section-sub">Is this TRUST compounding?</p>
        </header>
        <Suspense fallback={<Loading size="sm" />}>
          <HealthBlock trustId={trustId} />
        </Suspense>
      </section>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

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

function compactAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function netDeltaValue(delta: { inCount: number; outCount: number } | null): string {
  if (delta === null) return "—";
  const total = delta.inCount + delta.outCount;
  if (total === 0) return "0";
  return String(total);
}

function netDeltaLabel(delta: { inCount: number; outCount: number } | null): string {
  if (delta === null) return "loading";
  if (delta.inCount === 0 && delta.outCount === 0) return "no movement";
  return `+${delta.inCount} in / -${delta.outCount} out`;
}

function netDeltaClassName(delta: { inCount: number; outCount: number } | null): string {
  if (delta === null) return "entity-overview-stat-delta";
  if (delta.inCount > delta.outCount) return "entity-overview-stat-delta is-positive";
  if (delta.outCount > delta.inCount) return "entity-overview-stat-delta is-negative";
  return "entity-overview-stat-delta";
}
