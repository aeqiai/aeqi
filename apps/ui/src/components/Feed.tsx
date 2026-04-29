import { useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useEntitiesQuery } from "@/queries/entities";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore, selectInboxCount } from "@/store/inbox";
import { useAuthStore } from "@/store/auth";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";
import BlockAvatar from "@/components/BlockAvatar";

type Scope = "user" | "company" | "agent";

interface FeedProps {
  scope: Scope;
  /** Required when scope === "company" or "agent". */
  entityId?: string;
  /** Required when scope === "agent". */
  agentId?: string;
}

interface StatTile {
  label: string;
  value: string | number;
}

/**
 * Feed — the canonical home surface at every level (user / company /
 * agent). One component, three scopes. Header carries a thin stat
 * strip with at-a-glance state; body is a chronological activity
 * stream pulled from the existing daemon / inbox stores.
 *
 * At user scope with zero companies, the empty state IS the create
 * surface — BlueprintLaunchPicker rendered inline. No redirect to
 * `/start`; the page reads your data and becomes what you need.
 */
export default function Feed({ scope, entityId, agentId }: FeedProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entitiesQuery = useEntitiesQuery();
  const entitiesFetched = entitiesQuery.isFetched;
  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);
  const events = useDaemonStore((s) => s.events);
  const inboxCount = useInboxStore(selectInboxCount);

  // Resolve display-level identity for the header. User scope shows
  // the user's name; company scope shows the entity's display_name;
  // agent scope shows the agent's name.
  const entity = useMemo(
    () => (entityId ? entities.find((e) => e.id === entityId) : undefined),
    [entityId, entities],
  );
  const agent = useMemo(
    () => (agentId ? agents.find((a) => a.id === agentId) : undefined),
    [agentId, agents],
  );

  // All hooks before any early return — rules-of-hooks. Activity items
  // are derived for every render even on guarded scopes; the cost is
  // negligible (one filter+sort over current store state).
  const items = useMemo(
    () => buildActivityItems({ scope, entityId, agentId, agents, quests, events }),
    [scope, entityId, agentId, agents, quests, events],
  );

  // Empty-state-as-onboarding: at `/` with zero companies, the feed
  // page IS the create surface. No redirect, no separate route — the
  // page adapts to the user's data.
  if (scope === "user" && entitiesFetched && entities.length === 0) {
    return <FeedZeroState onSpawned={(id) => navigate(`/c/${encodeURIComponent(id)}`)} />;
  }

  // Wait for entities to load before deciding empty vs populated.
  if (scope === "user" && !entitiesFetched) return null;

  // Defensive: company scope without a resolved entity bounces home.
  // Same for agent scope without a resolved agent. Stale URLs from
  // before a data reset should not render a half-broken surface.
  if (scope === "company" && entityId && !entity) return <Navigate to="/" replace />;
  if (scope === "agent" && (!entity || !agent)) return <Navigate to="/" replace />;

  const heading = (() => {
    if (scope === "user") {
      const name = user?.name || user?.email?.split("@")[0] || "you";
      return name;
    }
    if (scope === "company") return entity?.name ?? "Company";
    return agent?.name ?? "Agent";
  })();

  const stats: StatTile[] = (() => {
    if (scope === "user") {
      return [
        { label: "Companies", value: entities.length },
        { label: "Agents", value: agents.length },
        { label: "Awaiting", value: inboxCount },
      ];
    }
    if (scope === "company") {
      const myAgents = agents.filter((a) => a.entity_id === entityId);
      const myQuests = quests.filter((q) => myAgents.some((a) => a.id === q.agent_id));
      const openQuests = myQuests.filter(
        (q) => q.status !== "done" && q.status !== "cancelled",
      ).length;
      return [
        { label: "Agents", value: myAgents.length },
        { label: "Open quests", value: openQuests },
        { label: "Awaiting", value: inboxCount },
      ];
    }
    const agentQuests = quests.filter((q) => q.agent_id === agentId);
    const openQuests = agentQuests.filter(
      (q) => q.status !== "done" && q.status !== "cancelled",
    ).length;
    return [
      { label: "Status", value: agent?.status ?? "—" },
      { label: "Open quests", value: openQuests },
      { label: "Model", value: shortModel(agent?.model) },
    ];
  })();

  return (
    <div className="feed">
      <header className="feed-header">
        <div className="feed-header-row">
          <span className="feed-header-avatar">
            <BlockAvatar name={heading} size={28} />
          </span>
          <h1 className="feed-heading">{heading}</h1>
        </div>
        <div className="feed-stat-strip">
          {stats.map((tile) => (
            <div key={tile.label} className="feed-stat-tile">
              <div className="feed-stat-value">{tile.value}</div>
              <div className="feed-stat-label">{tile.label}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="feed-body">
        {items.length === 0 ? (
          <FeedQuietState scope={scope} />
        ) : (
          <ul className="feed-activity-list" role="list">
            {items.map((item) => (
              <li key={item.id} className="feed-activity-row">
                <span className="feed-activity-meta">{item.kind}</span>
                <span className="feed-activity-body">{item.text}</span>
                <span className="feed-activity-time">{item.timeLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FeedZeroState({ onSpawned }: { onSpawned: (entityId: string) => void }) {
  return (
    <div className="feed feed--zero">
      <header className="feed-zero-hero">
        <h1 className="feed-zero-title">Start your first autonomous company.</h1>
        <p className="feed-zero-sub">
          Pick a blueprint, or start blank. Your agents start moving once you do.
        </p>
      </header>
      <BlueprintLaunchPicker mode="spawn-company" onSpawnedCompany={onSpawned} />
    </div>
  );
}

function FeedQuietState({ scope }: { scope: Scope }) {
  const copy =
    scope === "user"
      ? "Quiet so far. Activity from your agents will appear here as they work."
      : scope === "company"
        ? "This company is fresh. Send an agent a message and you'll see it here."
        : "This agent hasn't done anything yet. Open Sessions and say hi.";
  return <p className="feed-quiet">{copy}</p>;
}

interface ActivityItem {
  id: string;
  kind: string;
  text: string;
  timeLabel: string;
  ts: number;
}

function buildActivityItems({
  scope,
  entityId,
  agentId,
  agents,
  quests,
  events,
}: {
  scope: Scope;
  entityId?: string;
  agentId?: string;
  agents: ReturnType<typeof useDaemonStore.getState>["agents"];
  quests: ReturnType<typeof useDaemonStore.getState>["quests"];
  events: ReturnType<typeof useDaemonStore.getState>["events"];
}): ActivityItem[] {
  // Filter scope. user: everything; company: items belonging to this
  // entity's agents; agent: items belonging to this single agent.
  const inScope = (recordAgentId: string | undefined) => {
    if (!recordAgentId) return scope === "user";
    if (scope === "user") return true;
    if (scope === "company") {
      const a = agents.find((x) => x.id === recordAgentId);
      return a?.entity_id === entityId;
    }
    return recordAgentId === agentId;
  };

  const out: ActivityItem[] = [];

  for (const q of quests) {
    if (!inScope(q.agent_id)) continue;
    const ts = parseTs(q.updated_at ?? q.created_at);
    const a = agents.find((x) => x.id === q.agent_id);
    const subject = q.idea?.name || "untitled quest";
    out.push({
      id: `q:${q.id}`,
      kind: q.status === "done" ? "completed" : "quest",
      text: `${a?.name ?? "Agent"} — ${subject}`,
      timeLabel: relativeTime(ts),
      ts,
    });
  }

  // ActivityEntry doesn't carry agent_id, only an agent display name.
  // Filter to user scope only — at company/agent scope the quest list
  // already provides scoped activity, and matching by name string
  // would be fragile.
  if (scope === "user") {
    for (const e of events) {
      const ts = parseTs(e.created_at ?? e.timestamp);
      out.push({
        id: `e:${e.id}`,
        kind: e.decision_type || "activity",
        text: e.summary || "activity",
        timeLabel: relativeTime(ts),
        ts,
      });
    }
  }

  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, 50);
}

function parseTs(value: string | undefined): number {
  if (!value) return 0;
  const d = Date.parse(value);
  return Number.isFinite(d) ? d : 0;
}

function relativeTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function shortModel(model: string | undefined): string {
  if (!model) return "—";
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}
