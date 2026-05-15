import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useTreasury } from "@/hooks/useTreasury";
import { fetchTrust } from "@/lib/indexer";
import { formatShortDate } from "@/lib/i18n";
import type { Quest } from "@/lib/types";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { entityBasePath } from "@/lib/entityPath";
import EntityHeroStrip from "./EntityHeroStrip";
import BlockAvatar from "./BlockAvatar";
import { Tooltip } from "@/components/ui";
import "@/styles/overview.css";

/**
 * `/trust/<addr>/overview` — Organization cockpit.
 *
 * Founder-locked direction (2026-05-08): Overview answers
 * "what's happening now," not "what does the P&L look like."
 * Treasury already owns the financial home; this surface is a pulse,
 * not a balance sheet.
 *
 * Three blocks:
 *   1. Hero strip — name, tagline, public toggle (kept; already shipped)
 *   2. Pulse band — three side-by-side cards:
 *        a) Next steps      — seeded onboarding and in-flight work
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
        (i) => i.entity_id === entityId && !!i.awaiting_at && !inboxPending.has(i.session_id),
      ),
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

  // ── Pulse: next steps ───────────────────────────────────────────────
  const nextStepQuests = useMemo(
    () =>
      quests
        .filter(
          (q) =>
            (q.status === "in_progress" || q.status === "todo" || q.status === "backlog") &&
            ((q.agent_id && subtreeIds.has(q.agent_id)) || q.agent_id === entityId),
        )
        .sort((a, b) => {
          const statusDelta = questStatusRank(a.status) - questStatusRank(b.status);
          if (statusDelta !== 0) return statusDelta;
          return parseTs(b.updated_at ?? b.created_at) - parseTs(a.updated_at ?? a.created_at);
        })
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

  // Treasury display: indexed asset count. Native balance lives on the
  // Treasury page so the default company Overview does not pull wallet SDKs.
  const treasuryDisplay = useMemo(() => {
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

  // basePath is canonical: /trust/<addr>.
  // trustPath here is the same — kept as a separate name for the
  // signers stat tile to read clearly.
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const trustPath = basePath;

  return (
    <div className="entity-overview">
      <EntityHeroStrip entityId={entityId} />

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
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function questStatusRank(status: Quest["status"]): number {
  if (status === "in_progress") return 0;
  if (status === "todo") return 1;
  if (status === "backlog") return 2;
  return 3;
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
