import { useMemo } from "react";
import type { Agent } from "@/lib/types";
import { EmptyState, Table, type TableColumn } from "../ui";
import AgentAvatar from "../AgentAvatar";
import { relativeTime } from "../ideas/types";
import { formatSpendUsd } from "@/lib/spend";

export default function AgentsList({
  agents,
  onSelect,
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
}) {
  const columns = useMemo<Array<TableColumn<Agent>>>(
    () => [
      {
        key: "name",
        header: "Name",
        width: "30%",
        sortable: true,
        sortAccessor: (a) => a.name.toLowerCase(),
        cell: (a) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <AgentAvatar name={a.name} src={a.avatar} />
            <strong style={{ fontWeight: 500 }}>{a.name}</strong>
          </span>
        ),
      },
      {
        key: "model",
        header: "Model",
        width: "22%",
        sortable: true,
        sortAccessor: (a) => (a.model ?? "").toLowerCase(),
        cell: (a) => a.model ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>,
      },
      {
        key: "status",
        header: "Status",
        width: "16%",
        sortable: true,
        sortAccessor: (a) => a.status ?? "unknown",
        cell: (a) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              className={`agent-settings-status-dot${a.status === "active" ? " live" : ""}`}
              aria-hidden
            />
            {a.status || "unknown"}
          </span>
        ),
      },
      {
        key: "lastActive",
        header: "Last active",
        width: "16%",
        sortable: true,
        sortAccessor: (a) => (a.last_active ? Date.parse(a.last_active) : 0),
        cell: (a) => relativeTime(a.last_active) || "—",
      },
      {
        key: "spend",
        header: "Spend",
        width: "16%",
        align: "end",
        sortable: true,
        sortAccessor: (a) => a.lifetime_cost_usd ?? 0,
        cell: (a) => {
          const spend = a.lifetime_cost_usd ?? 0;
          return (
            <span
              title={`Lifetime inference spend: ${formatSpendUsd(spend)}`}
              style={{
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                color: spend > 0 ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
            >
              {formatSpendUsd(spend)}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (agents.length === 0) {
    return (
      <div className="ideas-list-body">
        <EmptyState
          title="No agents match these filters."
          description="Drop a chip or clear the search to bring rows back."
        />
      </div>
    );
  }

  // Flat list rendered via the canonical Table primitive — same shape as
  // RolesList. Real <table> semantics, column widths drive both header
  // and body cells via <col>, browser-enforced alignment.
  return (
    <div className="agents-list">
      <Table<Agent>
        columns={columns}
        data={agents}
        rowKey={(a) => a.id}
        onRowClick={(a) => onSelect(a.id)}
        ariaLabel="Agents"
      />
    </div>
  );
}
