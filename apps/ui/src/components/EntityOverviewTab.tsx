import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import type { Position, Quest } from "@/lib/types";

export default function EntityOverviewTab({ entityId }: { entityId: string }) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  // Every agent owned by this entity belongs to the subtree by definition —
  // entity_id is the canonical scoping anchor.
  const entityAgents = useMemo(
    () => agents.filter((a) => a.entity_id === entityId || a.id === entityId),
    [agents, entityId],
  );

  const entity = entityAgents[0] ?? agents.find((a) => a.id === entityId);

  const subtreeIds = useMemo(() => new Set<string>(entityAgents.map((a) => a.id)), [entityAgents]);

  const subtreeNames = useMemo(
    () => new Set<string>(entityAgents.map((a) => a.name)),
    [entityAgents],
  );

  const agentCount = subtreeIds.size;

  const openQuestCount = useMemo(
    () =>
      quests.filter(
        (q) => q.agent_id === entityId && (q.status === "todo" || q.status === "in_progress"),
      ).length,
    [quests, entityId],
  );

  const [positions, setPositions] = useState<Position[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .getPositions(entityId)
      .then((resp) => {
        if (cancelled) return;
        setPositions(resp.positions ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setPositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const recentActivity = useMemo(
    () => events.filter((ev) => ev.agent && subtreeNames.has(ev.agent)).slice(0, 5),
    [events, subtreeNames],
  );

  return (
    <div className="page-content">
      <h1
        style={{
          fontSize: "var(--text-2xl)",
          fontWeight: 500,
          margin: "0 0 24px",
        }}
      >
        {entity?.name || entityId}.
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <KpiTile label="Agents" value={agentCount} />
        <KpiTile label="Positions" value={positions.length} />
        <KpiTile label="Open quests" value={openQuestCount} />
      </div>

      <h2
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: "0 0 12px",
        }}
      >
        Recent activity
      </h2>
      {recentActivity.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No activity yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {recentActivity.map((ev) => (
            <li
              key={ev.id}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 160px",
                gap: 12,
                padding: "10px 0",
                fontSize: 13,
                alignItems: "baseline",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>{formatTimestamp(ev.timestamp)}</span>
              <span>{ev.decision_type.replace(/_/g, " ")}</span>
              <span style={{ color: "var(--text-secondary)" }}>{ev.agent || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: "var(--color-card)",
        padding: "20px 24px",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
