import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBalance } from "wagmi";
import { anvil } from "wagmi/chains";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useTreasury } from "@/hooks/useTreasury";
import { fetchTrust } from "@/lib/indexer";
import type { Quest } from "@/lib/types";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { entityBasePath } from "@/lib/entityPath";
import EntityHeroStrip from "./EntityHeroStrip";
import BlockAvatar from "./BlockAvatar";
import "@/styles/overview.css";

/**
 * `/c/<entity>/overview` — Company cockpit.
 *
 * Founder-locked direction (2026-05-08): Overview answers
 * "what's happening now," not "what does the P&L look like."
 * Treasury already owns the financial home; this surface is a pulse,
 * not a balance sheet.
 *
 * Three blocks:
 *   1. Hero strip — name, tagline, public toggle (kept; already shipped)
 *   2. Pulse band — three side-by-side cards:
 *        a) Active quests   — top in-flight work in this Company subtree
 *        b) Awaiting decisions — entity-scoped inbox (kind=decision_request)
 *        c) Last 24h activity — compact agent activity stream
 *   3. Slim numbers row — 4 stat tiles:
 *        Treasury · 7d activity · TRUST signers · Active agents
 *
 * Each Pulse card and stat tile clicks through to its full surface.
 * Empty states render gracefully and surface the next action inline.
 */
export default function EntityOverviewTab({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  const entity = entities.find((e) => e.id === entityId);
  const trustAddress = entity?.trust_address;
  const trustId = entity?.trust_id;

  // Inbox: subscribe to raw fields and useMemo the entity-filtered slice.
  // A selector that filters inline returns a fresh array every call and
  // breaks `useSyncExternalStore`'s identity check (React error #185).
  const inboxAllItems = useInboxStore((s) => s.items);
  const inboxPending = useInboxStore((s) => s.pendingDismissal);
  const entityInbox = useMemo(
    () => inboxAllItems.filter((i) => i.entity_id === entityId && !inboxPending.has(i.session_id)),
    [inboxAllItems, inboxPending, entityId],
  );

  const subtreeAgents = useMemo(
    () => agents.filter((a) => a.entity_id === entityId || a.id === entityId),
    [agents, entityId],
  );
  const subtreeIds = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.id)),
    [subtreeAgents],
  );
  const subtreeNames = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.name)),
    [subtreeAgents],
  );

  // ── Pulse: active quests ────────────────────────────────────────────
  const activeQuests = useMemo(
    () =>
      quests
        .filter(
          (q) =>
            q.status === "in_progress" &&
            ((q.agent_id && subtreeIds.has(q.agent_id)) || q.agent_id === entityId),
        )
        .sort(
          (a, b) => parseTs(b.updated_at ?? b.created_at) - parseTs(a.updated_at ?? a.created_at),
        )
        .slice(0, 5),
    [quests, subtreeIds, entityId],
  );

  // ── Pulse: last 24h activity stream ─────────────────────────────────
  const recentEvents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events
      .filter((ev) => ev.agent && subtreeNames.has(ev.agent) && parseTs(ev.timestamp) >= cutoff)
      .sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp))
      .slice(0, 6);
  }, [events, subtreeNames]);

  // ── Numbers row: treasury balance + 7d net delta ────────────────────
  const { balances, transfers } = useTreasury(trustId);
  const { data: ethBalance } = useBalance({
    address: trustAddress as `0x${string}` | undefined,
    chainId: anvil.id,
    query: { enabled: Boolean(trustAddress) },
  });

  // Treasury display: total ERC-20 + native ETH count. We don't price-feed
  // off-chain — show "X assets" for now (single source of truth for $$ is
  // /treasury). When balances is null we're loading; render em-dash.
  const treasuryDisplay = useMemo(() => {
    if (balances === null) return "—";
    const tokens = balances.length;
    const eth = ethBalance ? 1 : 0;
    const total = tokens + eth;
    if (total === 0) return "0 assets";
    return `${total} ${total === 1 ? "asset" : "assets"}`;
  }, [balances, ethBalance]);

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

  // ── Numbers row: active agents (status=running/active/online) ───────
  const activeAgentsCount = useMemo(
    () =>
      subtreeAgents.filter(
        (a) => a.status === "running" || a.status === "active" || a.status === "online",
      ).length,
    [subtreeAgents],
  );

  // basePath is canonical: /trust/<addr> when on-chain, /c/<id> otherwise.
  // trustPath here is the same — kept as a separate name for the
  // signers stat tile to read clearly.
  const basePath = entity ? entityBasePath(entity) : `/c/${encodeURIComponent(entityId)}`;
  const trustPath = basePath;

  return (
    <div className="entity-overview">
      <EntityHeroStrip entityId={entityId} />

      {/* ── Pulse band ── */}
      <div className="entity-overview-pulse">
        {/* a) Active quests */}
        <section className="entity-overview-pulse-card" aria-labelledby="pulse-quests">
          <div className="entity-overview-pulse-head">
            <h2 id="pulse-quests" className="entity-overview-pulse-title">
              Active quests
            </h2>
            {activeQuests.length > 0 && (
              <Link to={`${basePath}/quests`} className="entity-overview-pulse-link">
                View all →
              </Link>
            )}
          </div>
          {activeQuests.length === 0 ? (
            <p className="entity-overview-pulse-empty">
              No active quests ·{" "}
              <Link to={`${basePath}/quests`} className="entity-overview-pulse-empty-link">
                start one →
              </Link>
            </p>
          ) : (
            <ul className="entity-overview-pulse-list" role="list">
              {activeQuests.map((q) => {
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
                            item.entity_id,
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
                          {relativeTime(item.awaiting_at)}
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
        <Link to={`${basePath}/treasury`} className="entity-overview-stat">
          <span className="entity-overview-stat-label">Treasury</span>
          <span className="entity-overview-stat-value">{treasuryDisplay}</span>
        </Link>

        <Link to={`${basePath}/treasury`} className="entity-overview-stat">
          <span className="entity-overview-stat-label">Activity</span>
          <span className="entity-overview-stat-value">{netDeltaValue(netDelta)}</span>
          <span className={netDeltaClassName(netDelta)}>{netDeltaLabel(netDelta)}</span>
        </Link>

        <Link to={trustPath} className="entity-overview-stat">
          <span className="entity-overview-stat-label">TRUST signers</span>
          <span className="entity-overview-stat-value">
            {trustsCount === null ? "—" : trustsCount}
          </span>
        </Link>

        <Link to={`${basePath}/agents`} className="entity-overview-stat">
          <span className="entity-overview-stat-label">Active agents</span>
          <span className="entity-overview-stat-value">
            {activeAgentsCount}
            <span className="entity-overview-stat-delta">/{subtreeAgents.length}</span>
          </span>
        </Link>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

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
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
