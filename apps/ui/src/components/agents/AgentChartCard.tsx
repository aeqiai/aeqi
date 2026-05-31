import type React from "react";
import type { Agent, Role } from "@/lib/types";
import AgentAvatar from "../AgentAvatar";

/**
 * Card cell rendered inside the agents org-chart layout. Renamed from the
 * inline `AgentCard` it replaces inside CompanyAgentsTab to avoid collision
 * with `components/AgentCard.tsx` (a different top-level surface).
 */
export default function AgentChartCard({
  role,
  agent,
  apex = false,
  onSelect,
  style,
}: {
  role: Role;
  agent: Agent | undefined;
  apex?: boolean;
  onSelect: (id: string) => void;
  style?: React.CSSProperties;
}) {
  const clickable = !!agent;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => agent && onSelect(agent.id)}
      style={{
        ...style,
        padding: apex ? "12px 16px" : "10px 14px",
        background: "var(--color-card-elevated)",
        border: 0,
        borderRadius: "var(--radius-md)",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        cursor: clickable ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {agent ? (
        <span aria-hidden style={{ display: "inline-flex", flexShrink: 0 }}>
          <AgentAvatar name={agent.name} src={agent.avatar} />
        </span>
      ) : (
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: "999px",
            background: "var(--bg-row)",
          }}
        />
      )}
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: apex ? 600 : 500,
            color: agent ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {agent?.name ?? "(vacant)"}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {role.title}
        </span>
        {agent && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              className={`agent-settings-status-dot${agent.status === "active" ? " live" : ""}`}
              aria-hidden
            />
            {agent.status || "unknown"}
          </span>
        )}
      </span>
    </button>
  );
}
