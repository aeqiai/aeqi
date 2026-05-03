import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button, Spinner } from "@/components/ui";

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

  const load = () => {
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
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (userLoaded && !isAdmin) return <Navigate to="/me" replace />;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Admin</h1>
          <p className="admin-page-subtitle">Fleet view — read-only.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {loading && !data && (
        <div className="admin-page-loading">
          <Spinner />
        </div>
      )}

      {error && <div className="admin-page-error">{error}</div>}

      {data && (
        <>
          <Section title="Users" count={data.users.length}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Subscription</th>
                  <th>Plan</th>
                  <th>Admin</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.name || "—"}</td>
                    <td>{u.provider}</td>
                    <td>{u.subscription_status ?? "—"}</td>
                    <td>{u.subscription_plan ?? "—"}</td>
                    <td>{u.is_admin ? "yes" : "—"}</td>
                    <td>{fmtDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Runtime placements" count={data.placements.length}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Name</th>
                  <th>User</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Port</th>
                  <th>Plan</th>
                  <th>Service</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.placements.map((p) => (
                  <tr key={p.entity_id}>
                    <td className="admin-cell-mono">{p.entity_id.slice(0, 8)}</td>
                    <td>{p.display_name || "—"}</td>
                    <td>{p.user_email ?? p.user_id.slice(0, 8)}</td>
                    <td>{p.placement_type}</td>
                    <td>{p.status}</td>
                    <td>{p.target_port ?? "—"}</td>
                    <td>{p.plan}</td>
                    <td className="admin-cell-mono">{p.service_name ?? "—"}</td>
                    <td>{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Invite codes" count={data.invite_codes.length}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Owner</th>
                  <th>Used by</th>
                  <th>Used at</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.invite_codes.map((c) => (
                  <tr key={c.code}>
                    <td className="admin-cell-mono">{c.code}</td>
                    <td>{c.owner_email ?? "—"}</td>
                    <td>{c.used_by_email ?? "—"}</td>
                    <td>{fmtDate(c.used_at)}</td>
                    <td>{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Waitlist" count={data.waitlist.length}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>State</th>
                  <th>Confirmed at</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.waitlist.map((w) => (
                  <tr key={w.email}>
                    <td>{w.email}</td>
                    <td>{w.confirmed_at ? "confirmed" : w.pending_token ? "pending" : "—"}</td>
                    <td>{fmtDate(w.confirmed_at)}</td>
                    <td>{fmtDate(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-section">
      <h2 className="admin-section-title">
        {title}
        <span className="admin-section-count">{count}</span>
      </h2>
      <div className="admin-section-body">
        {count === 0 ? <div className="admin-section-empty">Nothing here.</div> : children}
      </div>
    </section>
  );
}
