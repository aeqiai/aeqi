import { useEffect, useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import type { Agent } from "@/lib/types";
import { StatusPill, Table, type StatusPillTone, type TableColumn } from "../ui";
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
const LIVENESS_TONE: Record<Liveness, StatusPillTone> = {
  online: "success",
  idle: "review",
  offline: "muted",
};
const AGENTS_PAGE_SIZE = 25;
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

function formatTokenCount(tokens: number | undefined): string {
  if (!Number.isFinite(tokens) || !tokens) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K`;
  return String(tokens);
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

function formatCreatedDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export default function AgentsList({
  agents,
  onSelect,
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
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
          const created = formatCreatedDate(a.created_at);
          return (
            <span className="agents-list-identity">
              <span className="agents-list-avatar">
                <AgentAvatar name={a.name} src={a.avatar} />
              </span>
              <span className="agents-list-identity-main">
                <span className="agents-list-name">{a.name}</span>
                <span className="agents-list-subline">{shortId(a.id)}</span>
                <span className="agents-list-mobile-meta">
                  {model || "No model"} · {LIVENESS_LABEL[liveness]}
                  {created ? ` · Created ${created}` : ""}
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
          return <StatusPill tone={LIVENESS_TONE[liveness]}>{LIVENESS_LABEL[liveness]}</StatusPill>;
        },
      },
      {
        key: "created",
        header: "Created",
        width: "14%",
        sortable: true,
        sortAccessor: (a) => (a.created_at ? Date.parse(a.created_at) : 0),
        cell: (a) =>
          formatCreatedDate(a.created_at) || <span className="agents-list-muted">—</span>,
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
        header: "Usage",
        width: "18%",
        align: "end",
        sortable: true,
        sortAccessor: (a) => a.lifetime_cost_usd ?? 0,
        cell: (a) => {
          const spend = a.lifetime_cost_usd ?? 0;
          const tokens = formatTokenCount(a.total_tokens);
          const hasLimit = Number.isFinite(a.budget_usd) && (a.budget_usd ?? 0) > 0;
          const limit = hasLimit ? formatSpendDisplay(a.budget_usd ?? 0) : "∞";
          return (
            <span
              title={`Inference usage: ${formatSpendUsd(spend)} spent / ${hasLimit ? `${limit} limit` : "unlimited"}${tokens ? ` · ${tokens} tokens` : ""}`}
              className="agents-list-usage"
            >
              <span
                className={
                  spend > 0
                    ? "agents-list-usage-cost"
                    : "agents-list-usage-cost agents-list-usage-cost--zero"
                }
              >
                {formatSpendDisplay(spend)} / {limit}
              </span>
              <span className="agents-list-usage-meta">
                {tokens ? `${tokens} tokens` : "No tokens"}
              </span>
            </span>
          );
        },
      },
    ],
    [],
  );

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(agents.length / AGENTS_PAGE_SIZE));
    setPage((current) => Math.min(current, pageCount));
  }, [agents.length]);

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
        pagination={{
          page,
          pageSize: AGENTS_PAGE_SIZE,
          total: agents.length,
          itemLabel: "agents",
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
