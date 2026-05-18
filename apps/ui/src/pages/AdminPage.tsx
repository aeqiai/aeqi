import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/i18n";
import { launchPlanDisplayName } from "@/lib/pricing";
import { useAuthStore } from "@/store/auth";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Loading,
  Table,
  Tabs,
  type BadgeVariant,
  type TableColumn,
} from "@/components/ui";

interface UserRow {
  id: string;
  email: string;
  name: string;
  provider: string;
  subscription_status: string | null;
  subscription_plan: string | null;
  is_admin: boolean;
  created_at: string;
}

interface PlacementRow {
  trust_id: string;
  display_name: string;
  user_id: string;
  user_email?: string | null;
  owner_email?: string | null;
  placement_type: string;
  status?: string | null;
  placement_status?: string | null;
  org_lifecycle?: string | null;
  trust_status?: string | null;
  trust_address?: string | null;
  creator_address?: string | null;
  target_host?: string | null;
  target_port: number | null;
  runtime_id?: string | null;
  runtime_control?: string | null;
  runtime_operational_status?: string | null;
  runtime_action_required?: string | null;
  runtime_restart_supported?: boolean | null;
  runtime_running?: boolean | null;
  runtime_reachable?: boolean | null;
  runtime_health_checked?: boolean | null;
  runtime_endpoint?: string | null;
  runtime_checked_at?: string | null;
  plan: string;
  service_name: string | null;
  stripe_subscription_id: string | null;
  trust_error?: string | null;
  runtime_error?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string;
}

interface InviteRow {
  code: string;
  owner_email: string | null;
  used_by_email: string | null;
  used_at: string | null;
  created_at: string;
}

interface WaitlistRow {
  email: string;
  created_at: string;
  confirmed_at: string | null;
  pending_token: boolean;
}

interface Overview {
  users: UserRow[];
  placements: PlacementRow[];
  invite_codes: InviteRow[];
  waitlist: WaitlistRow[];
  health: AdminHealth | null;
}

interface AdminHealth {
  overall?: string;
  trust?: {
    active?: number;
    provisioning?: number;
    failed?: number;
    missing_trust_address?: number;
    active_without_trust?: string[];
  };
  runtime?: {
    placements_total?: number;
    by_type?: Record<string, number>;
    by_status?: Record<string, number>;
    by_operational_status?: Record<string, number>;
    missing_target?: string[];
    failed?: string[];
    live_attention?: string[];
  };
  postgres?: {
    enabled?: boolean;
    status?: string;
    latency_ms?: number;
    runtime_placements_source?: string;
  };
  placement?: {
    by_lifecycle?: Record<string, number>;
  };
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return formatDateTime(s, { fallback: s });
}

function shortId(s: string): string {
  if (!s) return "—";
  return s.length <= 12 ? s : s.slice(0, 8);
}

function valueOrDash(s: string | null | undefined): string {
  return s && s.trim() ? s : "—";
}

function planLabel(s: string | null | undefined): string {
  if (!s || !s.trim()) return "—";
  const normalized = s.toLowerCase();
  if (
    ["starter", "standard", "launch", "company", "workspace", "growth", "pro"].includes(normalized)
  ) {
    return launchPlanDisplayName(s);
  }
  return labelize(s);
}

function labelize(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function placementStatus(p: PlacementRow): string {
  return p.placement_status || p.status || "unknown";
}

function runtimeStatus(p: PlacementRow): string {
  return p.runtime_operational_status || placementStatus(p);
}

function runtimeEndpoint(p: PlacementRow): string {
  return (
    p.runtime_endpoint ||
    (p.target_host && p.target_port ? `${p.target_host}:${p.target_port}` : "—")
  );
}

function runtimeDetail(p: PlacementRow): string {
  if (p.runtime_action_required) return labelize(p.runtime_action_required);
  if (p.runtime_control) return labelize(p.runtime_control);
  return "—";
}

function compactAddress(s: string | null | undefined): string {
  if (!s) return "—";
  return s.length <= 18 ? s : `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function statusVariant(status: string | null | undefined): BadgeVariant {
  if (!status) return "muted";
  const normalized = status.toLowerCase();
  if (["active", "confirmed", "used", "paid", "ok", "healthy", "running"].includes(normalized)) {
    return "success";
  }
  if (["pending", "trialing", "invited", "provisioning", "unknown"].includes(normalized)) {
    return "neutral";
  }
  if (
    ["failed", "error", "blocked", "stopped", "unhealthy", "missing_target"].includes(normalized)
  ) {
    return "error";
  }
  if (["expired", "past_due", "unpaid", "unreachable"].includes(normalized)) return "warning";
  if (["cancelled", "canceled", "inactive", "paused"].includes(normalized)) return "muted";
  return "neutral";
}

function StatusPill({ value }: { value: string | null | undefined }) {
  return (
    <Badge variant={statusVariant(value)} size="sm" dot>
      {labelize(value)}
    </Badge>
  );
}

function overallVariant(status: string | null | undefined): BadgeVariant {
  if (status === "critical") return "error";
  if (status === "warning") return "warning";
  if (status === "ok") return "success";
  return "neutral";
}

function matchesQuery(values: Array<string | number | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query),
  );
}

/**
 * `/admin` — operator dashboard. Read-only fleet view of users, runtime
 * placements, invite codes, and waitlist signups. Admin-only; non-admins
 * are bounced to /me. Backend gates the API on is_admin too — this is
 * defense in depth.
 */
export default function AdminPage() {
  const isAdmin = useAuthStore((s) => s.user?.is_admin === true);
  const userLoaded = useAuthStore((s) => s.user !== null);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getAdminOverview()
      .then((res) => {
        setData({
          users: (res.users as unknown as UserRow[]) ?? [],
          placements: (res.placements as unknown as PlacementRow[]) ?? [],
          invite_codes: (res.invite_codes as unknown as InviteRow[]) ?? [],
          waitlist: (res.waitlist as unknown as WaitlistRow[]) ?? [],
          health: (res.health as AdminHealth | undefined) ?? null,
        });
        setLastLoadedAt(new Date());
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const empty: Overview = {
      users: [],
      placements: [],
      invite_codes: [],
      waitlist: [],
      health: null,
    };
    if (!data) return empty;
    return {
      users: data.users.filter((u) =>
        matchesQuery(
          [
            u.email,
            u.name,
            u.provider,
            u.subscription_status,
            u.subscription_plan,
            u.is_admin ? "admin" : "member",
            u.created_at,
          ],
          normalizedQuery,
        ),
      ),
      placements: data.placements.filter((p) =>
        matchesQuery(
          [
            p.trust_id,
            p.display_name,
            p.user_id,
            p.user_email,
            p.owner_email,
            p.placement_type,
            placementStatus(p),
            runtimeStatus(p),
            p.runtime_control,
            p.runtime_action_required,
            p.org_lifecycle,
            p.trust_status,
            p.trust_address,
            p.target_host,
            p.target_port,
            p.runtime_endpoint,
            p.plan,
            p.service_name,
            p.stripe_subscription_id,
            p.created_at,
          ],
          normalizedQuery,
        ),
      ),
      invite_codes: data.invite_codes.filter((c) =>
        matchesQuery(
          [c.code, c.owner_email, c.used_by_email, c.used_at ? "used" : "open", c.created_at],
          normalizedQuery,
        ),
      ),
      waitlist: data.waitlist.filter((w) =>
        matchesQuery(
          [
            w.email,
            w.confirmed_at ? "confirmed" : w.pending_token ? "pending" : "open",
            w.confirmed_at,
            w.created_at,
          ],
          normalizedQuery,
        ),
      ),
    };
  }, [data, normalizedQuery]);

  const stats = useMemo(() => {
    if (!data) {
      return [
        { label: "Users", value: "0", detail: "0 admins" },
        { label: "Runtime", value: "0", detail: "0 active" },
        { label: "Invites", value: "0", detail: "0 open" },
        { label: "Waitlist", value: "0", detail: "0 pending" },
      ];
    }
    const admins = data.users.filter((u) => u.is_admin).length;
    const activePlacements = data.placements.filter((p) => p.org_lifecycle === "active").length;
    const healthyRuntimes =
      data.health?.runtime?.by_operational_status?.healthy ??
      data.placements.filter((p) => runtimeStatus(p) === "healthy").length;
    const trustActive =
      data.health?.trust?.active ??
      data.placements.filter((p) => p.trust_status === "active").length;
    const openInvites = data.invite_codes.filter((c) => !c.used_at && !c.used_by_email).length;
    const pendingWaitlist = data.waitlist.filter((w) => !w.confirmed_at && w.pending_token).length;
    return [
      { label: "Users", value: String(data.users.length), detail: `${admins} admins` },
      {
        label: "Organizations",
        value: String(data.placements.length),
        detail: `${activePlacements} active`,
      },
      {
        label: "Runtime",
        value: String(healthyRuntimes),
        detail: `${data.health?.runtime?.live_attention?.length ?? 0} need attention`,
      },
      {
        label: "Trust",
        value: String(trustActive),
        detail: `${data.health?.trust?.provisioning ?? 0} provisioning`,
      },
      { label: "Invites", value: String(data.invite_codes.length), detail: `${openInvites} open` },
      {
        label: "Waitlist",
        value: String(data.waitlist.length),
        detail: `${pendingWaitlist} pending`,
      },
    ];
  }, [data]);

  const userColumns = useMemo<Array<TableColumn<UserRow>>>(
    () => [
      {
        key: "email",
        header: "Email",
        cell: (u) => <span className="admin-primary-cell">{u.email}</span>,
        sortable: true,
        sortAccessor: (u) => u.email,
      },
      {
        key: "name",
        header: "Name",
        cell: (u) => valueOrDash(u.name),
        sortable: true,
        sortAccessor: (u) => u.name,
      },
      {
        key: "provider",
        header: "Provider",
        cell: (u) => labelize(u.provider),
        width: "120px",
        sortable: true,
        sortAccessor: (u) => u.provider,
      },
      {
        key: "subscription",
        header: "Subscription",
        cell: (u) => <StatusPill value={u.subscription_status} />,
        width: "140px",
        sortable: true,
        sortAccessor: (u) => u.subscription_status,
      },
      {
        key: "plan",
        header: "Plan",
        cell: (u) => planLabel(u.subscription_plan),
        width: "120px",
        sortable: true,
        sortAccessor: (u) => u.subscription_plan,
      },
      {
        key: "admin",
        header: "Role",
        cell: (u) => (
          <Badge variant={u.is_admin ? "accent" : "muted"} size="sm">
            {u.is_admin ? "Admin" : "Member"}
          </Badge>
        ),
        width: "100px",
        sortable: true,
        sortAccessor: (u) => (u.is_admin ? 1 : 0),
      },
      {
        key: "created",
        header: "Created",
        cell: (u) => fmtDate(u.created_at),
        width: "180px",
        sortable: true,
        sortAccessor: (u) => new Date(u.created_at),
      },
    ],
    [],
  );

  const placementColumns = useMemo<Array<TableColumn<PlacementRow>>>(
    () => [
      {
        key: "organization",
        header: "Organization",
        cell: (p) => (
          <div className="admin-entity-cell">
            <span className="admin-primary-cell">{valueOrDash(p.display_name)}</span>
            <span className="admin-entity-meta">
              <span className="admin-runtime-kind">
                <Server size={14} aria-hidden="true" />
                {labelize(p.placement_type)}
              </span>
              <span className="admin-mono-cell" title={p.trust_id}>
                {shortId(p.trust_id)}
              </span>
            </span>
          </div>
        ),
        width: "240px",
        sortable: true,
        sortAccessor: (p) => p.display_name || p.trust_id,
      },
      {
        key: "lifecycle",
        header: "Lifecycle",
        cell: (p) => <StatusPill value={p.org_lifecycle ?? placementStatus(p)} />,
        width: "150px",
        sortable: true,
        sortAccessor: (p) => p.org_lifecycle ?? placementStatus(p),
      },
      {
        key: "trust",
        header: "Trust",
        cell: (p) => (
          <div className="admin-trust-cell">
            <StatusPill value={p.trust_status ?? (p.trust_address ? "active" : "pending")} />
            <span className="admin-mono-cell" title={p.trust_address ?? undefined}>
              {compactAddress(p.trust_address)}
            </span>
          </div>
        ),
        width: "180px",
        sortable: true,
        sortAccessor: (p) => p.trust_status ?? p.trust_address,
      },
      {
        key: "runtime",
        header: "Runtime",
        cell: (p) => (
          <div className="admin-runtime-cell">
            <StatusPill value={runtimeStatus(p)} />
            <span className="admin-runtime-detail">{runtimeDetail(p)}</span>
          </div>
        ),
        width: "170px",
        sortable: true,
        sortAccessor: (p) => runtimeStatus(p),
      },
      {
        key: "host",
        header: "Target",
        cell: (p) => <span className="admin-mono-cell">{runtimeEndpoint(p)}</span>,
        width: "172px",
        sortable: true,
        sortAccessor: (p) => runtimeEndpoint(p),
      },
      {
        key: "service",
        header: "Service",
        cell: (p) => <span className="admin-mono-cell">{valueOrDash(p.service_name)}</span>,
        width: "240px",
        sortable: true,
        sortAccessor: (p) => p.service_name,
      },
      {
        key: "created",
        header: "Created",
        cell: (p) => fmtDate(p.created_at),
        width: "150px",
        sortable: true,
        sortAccessor: (p) => new Date(p.created_at),
      },
    ],
    [],
  );

  const inviteColumns = useMemo<Array<TableColumn<InviteRow>>>(
    () => [
      {
        key: "code",
        header: "Code",
        cell: (c) => <span className="admin-mono-cell">{c.code}</span>,
        sortable: true,
        sortAccessor: (c) => c.code,
      },
      {
        key: "state",
        header: "State",
        cell: (c) => <StatusPill value={c.used_at || c.used_by_email ? "used" : "open"} />,
        width: "100px",
        sortable: true,
        sortAccessor: (c) => (c.used_at || c.used_by_email ? "used" : "open"),
      },
      {
        key: "owner",
        header: "Owner",
        cell: (c) => valueOrDash(c.owner_email),
        sortable: true,
        sortAccessor: (c) => c.owner_email,
      },
      {
        key: "usedBy",
        header: "Used by",
        cell: (c) => valueOrDash(c.used_by_email),
        sortable: true,
        sortAccessor: (c) => c.used_by_email,
      },
      {
        key: "usedAt",
        header: "Used at",
        cell: (c) => fmtDate(c.used_at),
        width: "180px",
        sortable: true,
        sortAccessor: (c) => (c.used_at ? new Date(c.used_at) : null),
      },
      {
        key: "created",
        header: "Created",
        cell: (c) => fmtDate(c.created_at),
        width: "180px",
        sortable: true,
        sortAccessor: (c) => new Date(c.created_at),
      },
    ],
    [],
  );

  const waitlistColumns = useMemo<Array<TableColumn<WaitlistRow>>>(
    () => [
      {
        key: "email",
        header: "Email",
        cell: (w) => <span className="admin-primary-cell">{w.email}</span>,
        sortable: true,
        sortAccessor: (w) => w.email,
      },
      {
        key: "state",
        header: "State",
        cell: (w) => (
          <StatusPill value={w.confirmed_at ? "confirmed" : w.pending_token ? "pending" : "open"} />
        ),
        width: "120px",
        sortable: true,
        sortAccessor: (w) => (w.confirmed_at ? "confirmed" : w.pending_token ? "pending" : "open"),
      },
      {
        key: "confirmed",
        header: "Confirmed",
        cell: (w) => fmtDate(w.confirmed_at),
        width: "180px",
        sortable: true,
        sortAccessor: (w) => (w.confirmed_at ? new Date(w.confirmed_at) : null),
      },
      {
        key: "created",
        header: "Created",
        cell: (w) => fmtDate(w.created_at),
        width: "180px",
        sortable: true,
        sortAccessor: (w) => new Date(w.created_at),
      },
    ],
    [],
  );

  if (userLoaded && !isAdmin) return <Navigate to="/account" replace />;

  const emptyForQuery = (
    <EmptyState
      eyebrow="No results"
      title="No matching rows"
      description="Clear or change the search query to inspect the full admin dataset."
      action={
        query ? (
          <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
            Clear search
          </Button>
        ) : undefined
      }
    />
  );

  const emptyDataset = (title: string) => (
    <EmptyState eyebrow="Empty" title={title} description="No rows were returned by the backend." />
  );

  const tableTabs = data
    ? [
        {
          id: "users",
          label: "Users",
          count: filtered.users.length,
          content: (
            <Section title="Users" count={filtered.users.length} total={data.users.length}>
              <Table
                columns={userColumns}
                data={filtered.users}
                rowKey={(u) => u.id}
                density="compact"
                ariaLabel="Admin users"
                empty={normalizedQuery ? emptyForQuery : emptyDataset("No users")}
                defaultSort={{ key: "created", dir: "desc" }}
              />
            </Section>
          ),
        },
        {
          id: "runtime",
          label: "Runtime",
          count: filtered.placements.length,
          content: (
            <Section
              title="Runtime placements"
              count={filtered.placements.length}
              total={data.placements.length}
            >
              <Table
                columns={placementColumns}
                data={filtered.placements}
                rowKey={(p) => p.trust_id}
                density="compact"
                ariaLabel="Admin runtime placements"
                empty={normalizedQuery ? emptyForQuery : emptyDataset("No runtime placements")}
                defaultSort={{ key: "created", dir: "desc" }}
              />
            </Section>
          ),
        },
        {
          id: "invites",
          label: "Invites",
          count: filtered.invite_codes.length,
          content: (
            <Section
              title="Invite codes"
              count={filtered.invite_codes.length}
              total={data.invite_codes.length}
            >
              <Table
                columns={inviteColumns}
                data={filtered.invite_codes}
                rowKey={(c) => c.code}
                density="compact"
                ariaLabel="Admin invite codes"
                empty={normalizedQuery ? emptyForQuery : emptyDataset("No invite codes")}
                defaultSort={{ key: "created", dir: "desc" }}
              />
            </Section>
          ),
        },
        {
          id: "waitlist",
          label: "Waitlist",
          count: filtered.waitlist.length,
          content: (
            <Section title="Waitlist" count={filtered.waitlist.length} total={data.waitlist.length}>
              <Table
                columns={waitlistColumns}
                data={filtered.waitlist}
                rowKey={(w) => w.email}
                density="compact"
                ariaLabel="Admin waitlist"
                empty={normalizedQuery ? emptyForQuery : emptyDataset("No waitlist signups")}
                defaultSort={{ key: "created", dir: "desc" }}
              />
            </Section>
          ),
        },
      ]
    : [];

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Admin</h1>
          <p className="admin-page-subtitle">
            Read-only operator view for users, runtime placements, invites, and waitlist.
          </p>
        </div>
        <div className="admin-page-actions">
          {lastLoadedAt && (
            <span className="admin-page-refresh-note">
              Updated {fmtDate(lastLoadedAt.toISOString())}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {loading && !data && (
        <div className="admin-page-loading">
          <Loading />
        </div>
      )}

      {error && <div className="admin-page-error">{error}</div>}

      {data && (
        <>
          <ProtocolHealth health={data.health} placements={data.placements} />

          <div className="admin-metrics" aria-label="Admin summary">
            {stats.map((stat) => (
              <div key={stat.label} className="admin-metric">
                <span className="admin-metric-label">{stat.label}</span>
                <strong className="admin-metric-value">{stat.value}</strong>
                <span className="admin-metric-detail">{stat.detail}</span>
              </div>
            ))}
          </div>

          <div className="admin-toolbar">
            <Input
              size="sm"
              type="search"
              aria-label="Search admin data"
              placeholder="Search email, entity, status, invite, service"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                Clear
              </Button>
            )}
          </div>

          <div className="admin-tabs">
            <Tabs tabs={tableTabs} defaultTab="users" />
          </div>
        </>
      )}
    </div>
  );
}

function ProtocolHealth({
  health,
  placements,
}: {
  health: AdminHealth | null;
  placements: PlacementRow[];
}) {
  const overall = health?.overall ?? "unknown";
  const lifecycle = health?.placement?.by_lifecycle ?? countBy(placements, (p) => p.org_lifecycle);
  const runtimeTypes = health?.runtime?.by_type ?? countBy(placements, (p) => p.placement_type);
  const runtimeStatuses =
    health?.runtime?.by_operational_status ??
    health?.runtime?.by_status ??
    countBy(placements, runtimeStatus);
  const warnings = [
    ...(health?.trust?.active_without_trust ?? []).map((id) => ({
      code: "active_without_trust",
      entity: id,
      severity: "critical" as const,
    })),
    ...(health?.runtime?.missing_target ?? []).map((id) => ({
      code: "ready_without_target",
      entity: id,
      severity: "critical" as const,
    })),
    ...(health?.runtime?.failed ?? []).map((id) => ({
      code: "runtime_failed",
      entity: id,
      severity: "warning" as const,
    })),
    ...(health?.runtime?.live_attention ?? []).map((id) => ({
      code: "runtime_needs_operator",
      entity: id,
      severity: "critical" as const,
    })),
  ];

  return (
    <section className="admin-health" aria-label="Protocol health">
      <div className="admin-health-head">
        <div>
          <h2 className="admin-health-title">Protocol health</h2>
          <p className="admin-health-subtitle">
            Organization readiness is Trust plus runtime. Transitional rows stay visible here.
          </p>
        </div>
        <Badge variant={overallVariant(overall)} size="sm" dot>
          {labelize(overall)}
        </Badge>
      </div>

      <div className="admin-health-grid">
        <HealthTile
          icon={<ShieldCheck size={18} aria-hidden="true" />}
          label="Trust"
          value={health?.trust?.active ?? 0}
          detail={`${health?.trust?.provisioning ?? 0} provisioning · ${
            health?.trust?.failed ?? 0
          } failed`}
        />
        <HealthTile
          icon={<Server size={18} aria-hidden="true" />}
          label="Runtime"
          value={health?.runtime?.placements_total ?? placements.length}
          detail={formatMap(runtimeTypes)}
        />
        <HealthTile
          icon={<Activity size={18} aria-hidden="true" />}
          label="Lifecycle"
          value={lifecycle.active ?? 0}
          detail={formatMap(lifecycle)}
        />
        <HealthTile
          icon={<Database size={18} aria-hidden="true" />}
          label="Postgres"
          value={labelize(health?.postgres?.status ?? "unknown")}
          detail={`${health?.postgres?.runtime_placements_source ?? "unknown"} · ${
            health?.postgres?.latency_ms ?? "—"
          }ms`}
        />
      </div>

      <div className="admin-health-status">
        <div className="admin-health-status-row">
          <span>Runtime operations</span>
          <span>{formatMap(runtimeStatuses)}</span>
        </div>
        <div className="admin-health-status-row">
          <span>Missing Trust addresses</span>
          <span>{health?.trust?.missing_trust_address ?? 0}</span>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="admin-warning-list" role="status">
          {warnings.map((warning) => (
            <div key={`${warning.code}:${warning.entity}`} className="admin-warning-row">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{labelize(warning.code)}</span>
              <span className="admin-mono-cell">{shortId(warning.entity)}</span>
              <Badge variant={warning.severity === "critical" ? "error" : "warning"} size="sm">
                {labelize(warning.severity)}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-health-clear">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>No protocol health warnings</span>
        </div>
      )}
    </section>
  );
}

function HealthTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="admin-health-tile">
      <div className="admin-health-tile-icon">{icon}</div>
      <div>
        <span className="admin-health-tile-label">{label}</span>
        <strong className="admin-health-tile-value">{value}</strong>
        <span className="admin-health-tile-detail">{detail}</span>
      </div>
    </div>
  );
}

function countBy<T>(
  rows: T[],
  select: (row: T) => string | null | undefined,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = select(row) || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function formatMap(map: Record<string, number>): string {
  const entries = Object.entries(map).filter(([, count]) => count > 0);
  if (entries.length === 0) return "—";
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${count} ${labelize(key)}`)
    .join(" · ");
}

function Section({
  title,
  count,
  total,
  children,
}: {
  title: string;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
  const countLabel = count === total ? String(count) : `${count} of ${total}`;

  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h2 className="admin-section-title">{title}</h2>
        <span className="admin-section-count">{countLabel}</span>
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}
