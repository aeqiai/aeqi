import { useMemo } from "react";
import { SearchX } from "lucide-react";
import type { Agent } from "@/lib/types";
import { Table, type TableColumn } from "../ui";
import AgentAvatar from "../AgentAvatar";
import { relativeTime } from "../ideas/types";
import { formatSpendUsd } from "@/lib/spend";

// Liveness ladder — three-tone palette per the design language:
//   online  = reachable / active (emerald)
//   idle    = armed but waiting (warmth)
//   offline = stopped / disabled (ink-muted)
// `active` is the only wire value that maps to online; `stopped` to
// offline; everything else (including `inactive` / unknown) collapses
// into idle so the page never paints a row with no readable status.
type Liveness = "online" | "idle" | "offline";
const LIVENESS_LABEL: Record<Liveness, string> = {
  online: "Online",
  idle: "Idle",
  offline: "Offline",
};
function livenessOf(raw: string | undefined): Liveness {
  if (raw === "active") return "online";
  if (raw === "stopped") return "offline";
  return "idle";
}

function formatSpendDisplay(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  if (Math.abs(usd) < 0.01) return formatSpendUsd(usd);
  return `$${usd.toFixed(2)}`;
}

function formatModel(model: string | undefined): string {
  if (!model) return "";
  const slug = model.split("/").pop() ?? model;
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

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
        header: "Agent",
        width: "34%",
        sortable: true,
        sortAccessor: (a) => a.name.toLowerCase(),
        cell: (a) => {
          const liveness = livenessOf(a.status);
          const model = formatModel(a.model);
          return (
            <span className="agents-list-identity">
              <span className="agents-list-avatar">
                <AgentAvatar name={a.name} src={a.avatar} />
              </span>
              <span className="agents-list-identity-main">
                <span className="agents-list-name">{a.name}</span>
                <span className="agents-list-subline">
                  {a.execution_mode || "Runtime"} · {shortId(a.id)}
                </span>
                <span className="agents-list-mobile-meta">
                  {model || "No model"} · {LIVENESS_LABEL[liveness]}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        key: "model",
        header: "Model",
        width: "22%",
        sortable: true,
        sortAccessor: (a) => (a.model ?? "").toLowerCase(),
        cell: (a) =>
          a.model ? (
            <span className="agents-list-model" title={a.model}>
              {formatModel(a.model)}
            </span>
          ) : (
            <span className="agents-list-muted">—</span>
          ),
      },
      {
        key: "status",
        header: "Status",
        width: "16%",
        sortable: true,
        sortAccessor: (a) => a.status ?? "unknown",
        cell: (a) => {
          const liveness = livenessOf(a.status);
          return (
            <span className={`agent-liveness agent-liveness--${liveness}`}>
              <span className={`agent-liveness-dot agent-liveness-dot--${liveness}`} aria-hidden />
              {LIVENESS_LABEL[liveness]}
            </span>
          );
        },
      },
      {
        key: "lastActive",
        header: "Last active",
        width: "16%",
        sortable: true,
        sortAccessor: (a) => (a.last_active ? Date.parse(a.last_active) : 0),
        cell: (a) => relativeTime(a.last_active) || <span className="agents-list-muted">—</span>,
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
              className={
                spend > 0 ? "agents-list-spend" : "agents-list-spend agents-list-spend--zero"
              }
            >
              {formatSpendDisplay(spend)}
            </span>
          );
        },
      },
    ],
    [],
  );

  // Filter-narrowed empty state — entity has agents but the active
  // filters drop the visible set to zero. Centered icon + title + hint
  // on the elevated card register, mirroring `QuestColumnEmptyState`
  // so the table footprint stays weighted as the user toggles chips.
  if (agents.length === 0) {
    return (
      <div className="agents-list">
        <div className="agents-list-empty" role="status">
          <SearchX size={22} strokeWidth={1.5} className="agents-list-empty-icon" aria-hidden />
          <p className="agents-list-empty-title">No agents match these filters.</p>
          <p className="agents-list-empty-hint">
            Drop a chip or clear the search to bring rows back.
          </p>
        </div>
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
        density="compact"
        scrollWidth="sm"
        ariaLabel="Agents"
      />
    </div>
  );
}
