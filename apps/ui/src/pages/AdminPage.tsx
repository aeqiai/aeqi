import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { launchPlanDisplayName } from "@/lib/pricing";
import { useAuthStore } from "@/store/auth";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Spinner,
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
  entity_id: string;
  display_name: string;
  user_id: string;
  user_email: string | null;
  placement_type: string;
  status: string;
  target_port: number | null;
  plan: string;
  service_name: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
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
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
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

function statusVariant(status: string | null | undefined): BadgeVariant {
  if (!status) return "muted";
  const normalized = status.toLowerCase();
  if (["active", "confirmed", "used", "paid", "ok"].includes(normalized)) return "success";
  if (["pending", "trialing", "invited"].includes(normalized)) return "neutral";
  if (["failed", "error", "blocked"].includes(normalized)) return "error";
  if (["expired", "past_due", "unpaid"].includes(normalized)) return "warning";
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
    const empty: Overview = { users: [], placements: [], invite_codes: [], waitlist: [] };
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
            p.entity_id,
            p.display_name,
            p.user_id,
            p.user_email,
            p.placement_type,
            p.status,
            p.target_port,
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
    const activePlacements = data.placements.filter(
      (p) => p.status.toLowerCase() === "active",
    ).length;
    const openInvites = data.invite_codes.filter((c) => !c.used_at && !c.used_by_email).length;
    const pendingWaitlist = data.waitlist.filter((w) => !w.confirmed_at && w.pending_token).length;
    return [
      { label: "Users", value: String(data.users.length), detail: `${admins} admins` },
      {
        label: "Runtime",
        value: String(data.placements.length),
        detail: `${activePlacements} active`,
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
        key: "entity",
        header: "Entity",
        cell: (p) => (
          <span className="admin-mono-cell" title={p.entity_id}>
            {shortId(p.entity_id)}
          </span>
        ),
        width: "96px",
        sortable: true,
        sortAccessor: (p) => p.entity_id,
      },
      {
        key: "name",
        header: "Name",
        cell: (p) => <span className="admin-primary-cell">{valueOrDash(p.display_name)}</span>,
        sortable: true,
        sortAccessor: (p) => p.display_name,
      },
      {
        key: "user",
        header: "User",
        cell: (p) => valueOrDash(p.user_email ?? shortId(p.user_id)),
        sortable: true,
        sortAccessor: (p) => p.user_email ?? p.user_id,
      },
      {
        key: "type",
        header: "Type",
        cell: (p) => labelize(p.placement_type),
        width: "120px",
        sortable: true,
        sortAccessor: (p) => p.placement_type,
      },
      {
        key: "status",
        header: "Status",
        cell: (p) => <StatusPill value={p.status} />,
        width: "120px",
        sortable: true,
        sortAccessor: (p) => p.status,
      },
      {
        key: "port",
        header: "Port",
        cell: (p) => p.target_port ?? "—",
        width: "88px",
        align: "end",
        sortable: true,
        sortAccessor: (p) => p.target_port,
      },
      {
        key: "plan",
        header: "Plan",
        cell: (p) => planLabel(p.plan),
        width: "100px",
        sortable: true,
        sortAccessor: (p) => p.plan,
      },
      {
        key: "service",
        header: "Service",
        cell: (p) => <span className="admin-mono-cell">{valueOrDash(p.service_name)}</span>,
        width: "160px",
        sortable: true,
        sortAccessor: (p) => p.service_name,
      },
      {
        key: "created",
        header: "Created",
        cell: (p) => fmtDate(p.created_at),
        width: "180px",
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
                rowKey={(p) => p.entity_id}
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
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {loading && !data && (
        <div className="admin-page-loading">
          <Spinner />
        </div>
      )}

      {error && <div className="admin-page-error">{error}</div>}

      {data && (
        <>
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
