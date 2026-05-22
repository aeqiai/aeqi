import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, GitBranch, Plus, Route, Search, ShieldCheck } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import { api } from "@/lib/api";
import { entityPath } from "@/lib/entityPath";
import type { Role, RoleEdge, RoleType, Trust } from "@/lib/types";
import { useTrusts, useActiveTrust } from "@/queries/trusts";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

interface RoleBundle {
  trust: Trust;
  roles: Role[];
  edges: RoleEdge[];
  unavailable?: boolean;
}

interface AuthoritySegment {
  trust: Trust;
  role: Role;
  relation: "direct" | "identity" | "nested";
}

interface RoleContextOption {
  id: string;
  trust: Trust;
  role: Role;
  route: AuthoritySegment[];
  status: "available" | "ambiguous";
  routeCount: number;
}

type ContextFilter = "all" | "direct" | "nested" | "ambiguous";

const FILTERS: Array<{ id: ContextFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "direct", label: "Direct" },
  { id: "nested", label: "Nested" },
  { id: "ambiguous", label: "Ambiguous" },
];

const MAX_ROUTE_DEPTH = 4;
const EMPTY_BUNDLES: RoleBundle[] = [];

/**
 * `/trust` — role-context switcher.
 *
 * The selectable unit is no longer a TRUST card. It is a RoleContext:
 * terminal role + terminal TRUST + the authority route that lets the
 * operator assume it. TRUST remains the operating shell; the role is the
 * action the user takes.
 */
export default function TrustPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeTrust = useActiveTrust(activeEntityId);
  const trusts = useTrusts();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContextFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const controlledTrustIds = useMemo(
    () => Array.from(new Set([...(user?.roots ?? []), ...(user?.entities ?? [])])),
    [user?.entities, user?.roots],
  );

  const bundlesQuery = useRoleBundles(trusts, Boolean(user?.id));
  const bundles = bundlesQuery.data ?? EMPTY_BUNDLES;
  const roleContexts = useMemo(
    () => buildRoleContexts(bundles, user?.id ?? "", controlledTrustIds),
    [bundles, controlledTrustIds, user?.id],
  );

  const selected = useMemo(() => {
    if (selectedId) {
      const match = roleContexts.find((ctx) => ctx.id === selectedId);
      if (match) return match;
    }
    return pickDefaultContext(roleContexts, activeTrust);
  }, [activeTrust, roleContexts, selectedId]);

  useEffect(() => {
    if (!selected && selectedId) setSelectedId(null);
  }, [selected, selectedId]);

  const filteredContexts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return roleContexts.filter((ctx) => {
      if (filter === "direct" && ctx.route.length !== 1) return false;
      if (filter === "nested" && ctx.route.length <= 1) return false;
      if (filter === "ambiguous" && ctx.status !== "ambiguous") return false;
      if (!normalized) return true;
      return [
        ctx.role.title,
        roleTypeLabel(ctx.role.role_type),
        ctx.trust.name,
        ctx.status,
        ...ctx.route.flatMap((segment) => [segment.role.title, segment.trust.name]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [filter, query, roleContexts]);

  const metrics = useMemo(
    () => ({
      total: roleContexts.length,
      nested: roleContexts.filter((ctx) => ctx.route.length > 1).length,
      ambiguous: roleContexts.filter((ctx) => ctx.status === "ambiguous").length,
    }),
    [roleContexts],
  );

  const handleEnter = (ctx: RoleContextOption) => {
    persistRoleContext(ctx, user?.id ?? null);
    setActiveEntity(ctx.trust.id);
    navigate(entityPath(ctx.trust));
  };

  return (
    <div className="trust-context-page">
      <header className="trust-context-ledger">
        <div className="trust-context-ledger-main">
          <span className="trust-context-ledger-avatar" aria-hidden="true">
            <TrustAvatar name={activeTrust?.name ?? selected?.trust.name ?? "TRUST"} size={64} />
          </span>
          <div className="trust-context-ledger-copy">
            <p className="trust-context-kicker">Acting as</p>
            <h1 className="trust-context-title">
              {selected ? roleTypeLabel(selected.role.role_type) : "No role context"}
            </h1>
            <p className="trust-context-subtitle">
              {selected
                ? `${selected.role.title} in ${selected.trust.name}`
                : activeTrust
                  ? `${activeTrust.name} has no assumable role loaded`
                  : "Choose an assumable role below"}
            </p>
          </div>
        </div>
        <div className="trust-context-ledger-stats" aria-label="Role-context summary">
          <Metric label="Role contexts" value={metrics.total} />
          <Metric label="Nested routes" value={metrics.nested} />
          <Metric label="Ambiguous" value={metrics.ambiguous} />
        </div>
        <button type="button" className="trust-context-create" onClick={() => navigate("/launch")}>
          <Plus size={15} strokeWidth={1.7} />
          Create TRUST
        </button>
      </header>

      <section className="trust-context-toolbar" aria-label="Switch role context controls">
        <div className="trust-context-toolbar-copy">
          <p className="trust-context-kicker">Switch role context</p>
          <h2 className="trust-context-section-title">Influence table</h2>
        </div>
        <label className="trust-context-search">
          <Search size={15} strokeWidth={1.7} aria-hidden="true" />
          <span className="sr-only">Search role contexts</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roles or TRUSTs"
          />
        </label>
        <div className="trust-context-filters" aria-label="Role context filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "is-active" : undefined}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <main className="trust-context-workbench">
        <section className="trust-context-canvas" aria-label="Available role contexts">
          <div className="trust-context-lanes" aria-hidden="true">
            <span>Self</span>
            <span>Authority route</span>
            <span>Terminal role</span>
            <span>Scope</span>
          </div>

          {bundlesQuery.isLoading ? (
            <div className="trust-context-empty">
              <Route size={20} strokeWidth={1.6} />
              <strong>Resolving role contexts</strong>
              <span>Reading role graphs across your TRUSTs.</span>
            </div>
          ) : filteredContexts.length > 0 ? (
            <div className="trust-context-route-list">
              {filteredContexts.map((ctx) => (
                <RoleContextRow
                  key={ctx.id}
                  context={ctx}
                  selected={selected?.id === ctx.id}
                  onSelect={() => setSelectedId(ctx.id)}
                  onEnter={() => handleEnter(ctx)}
                />
              ))}
            </div>
          ) : (
            <div className="trust-context-empty">
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>No roles available</strong>
              <span>
                {roleContexts.length === 0
                  ? "You do not currently hold an assumable role in any TRUST."
                  : "No role contexts match the current filter."}
              </span>
            </div>
          )}
        </section>

        <aside className="trust-context-inspector" aria-label="Selected role context">
          {selected ? (
            <>
              <div className="trust-context-inspector-head">
                <p className="trust-context-kicker">Selected role</p>
                <h2>{selected.role.title}</h2>
                <span>{selected.trust.name}</span>
              </div>
              <button
                type="button"
                className="trust-context-enter"
                onClick={() => handleEnter(selected)}
              >
                Enter context
                <ArrowRight size={15} strokeWidth={1.8} />
              </button>
              <InspectorBlock title="Route">
                <ol className="trust-context-route-steps">
                  <li>
                    <span>You</span>
                    <small>{user?.email ?? "Operator"}</small>
                  </li>
                  {selected.route.map((segment) => (
                    <li key={`${segment.trust.id}:${segment.role.id}:${segment.relation}`}>
                      <span>
                        {segment.trust.name} / {segment.role.title}
                      </span>
                      <small>{relationLabel(segment.relation)}</small>
                    </li>
                  ))}
                </ol>
              </InspectorBlock>
              <InspectorBlock title="Permissions">
                <div className="trust-context-grants">
                  {selected.role.grants.length > 0 ? (
                    selected.role.grants
                      .slice(0, 5)
                      .map((grant) => <span key={grant}>{grant}</span>)
                  ) : (
                    <>
                      <span>Quests</span>
                      <span>Agents</span>
                      <span>Events</span>
                      <span>Review</span>
                    </>
                  )}
                </div>
              </InspectorBlock>
              <InspectorBlock title="Provenance">
                <p className="trust-context-inspector-copy">
                  {selected.status === "ambiguous"
                    ? `${selected.routeCount} valid routes can reach this role. Choose deliberately before entering.`
                    : selected.route.length > 1
                      ? "This role is reached through nested TRUST authority."
                      : selected.route[0]?.relation === "identity"
                        ? "This role is held by a TRUST identity available to your account."
                        : "This role is held directly by your account."}
                </p>
              </InspectorBlock>
              <InspectorBlock title="Entry points">
                <div className="trust-context-entry-grid">
                  {["Overview", "Roles", "Quests", "Ideas", "Events", "Assets", "Quorum"].map(
                    (item) => (
                      <span key={item}>{item}</span>
                    ),
                  )}
                </div>
              </InspectorBlock>
            </>
          ) : (
            <div className="trust-context-empty trust-context-empty--inspector">
              <GitBranch size={20} strokeWidth={1.6} />
              <strong>No role selected</strong>
              <span>Select a role context to inspect its authority route.</span>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function useRoleBundles(trusts: Trust[], enabled: boolean) {
  const trustKey = trusts.map((trust) => trust.id).join("|");
  return useQuery({
    queryKey: ["role-contexts", trustKey],
    enabled: enabled && trusts.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.allSettled(
        trusts.map(async (trust): Promise<RoleBundle> => {
          const resp = await api.getRoles(trust.id);
          return { trust, roles: resp.roles ?? [], edges: resp.edges ?? [] };
        }),
      );
      return results.map((result, index): RoleBundle => {
        if (result.status === "fulfilled") return result.value;
        return { trust: trusts[index], roles: [], edges: [], unavailable: true };
      });
    },
  });
}

function RoleContextRow({
  context,
  selected,
  onSelect,
  onEnter,
}: {
  context: RoleContextOption;
  selected: boolean;
  onSelect: () => void;
  onEnter: () => void;
}) {
  const direct = context.route[0];
  const nested = context.route.slice(1, -1);
  const terminal = context.route[context.route.length - 1];
  const routeLabel = context.route.length === 1 ? "Direct access" : routeSummary(context.route);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`trust-context-route-row ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-label={`${context.role.title} in ${context.trust.name}, ${routeLabel}`}
    >
      <span className="trust-context-actor-node">
        <span>You</span>
        <small>Operator</small>
      </span>
      <span className="trust-context-route-cell">
        <RoleMiniNode segment={direct} />
        {nested.map((segment) => (
          <RoleMiniNode key={`${segment.trust.id}:${segment.role.id}`} segment={segment} muted />
        ))}
      </span>
      <span className="trust-context-terminal-cell">
        <RoleMiniNode segment={terminal} terminal />
      </span>
      <span className="trust-context-scope-cell">
        <span className="trust-context-status">
          {context.status === "ambiguous" ? `${context.routeCount} routes` : "Available"}
        </span>
        <span className="trust-context-route-label">{routeLabel}</span>
        <button
          type="button"
          className="trust-context-row-enter"
          onClick={(event) => {
            event.stopPropagation();
            onEnter();
          }}
        >
          Assume role
        </button>
      </span>
    </div>
  );
}

function RoleMiniNode({
  segment,
  muted = false,
  terminal = false,
}: {
  segment: AuthoritySegment;
  muted?: boolean;
  terminal?: boolean;
}) {
  return (
    <span
      className={["trust-context-role-node", muted ? "is-muted" : "", terminal ? "is-terminal" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="trust-context-role-avatar" aria-hidden="true">
        <TrustAvatar name={segment.trust.name} size={28} />
      </span>
      <span className="trust-context-role-copy">
        <strong>{segment.role.title || roleTypeLabel(segment.role.role_type)}</strong>
        <small>
          {segment.trust.name} / {roleTypeLabel(segment.role.role_type)}
        </small>
      </span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="trust-context-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="trust-context-inspector-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function buildRoleContexts(
  bundles: RoleBundle[],
  userId: string,
  controlledTrustIds: string[],
): RoleContextOption[] {
  if (!userId) return [];

  const byTrust = new Map(bundles.map((bundle) => [bundle.trust.id, bundle]));
  const allRoles = bundles.flatMap((bundle) => bundle.roles.map((role) => ({ bundle, role })));
  const controlledTrusts = new Set(controlledTrustIds);
  const directRoutes: AuthoritySegment[][] = allRoles
    .filter(
      ({ role }) =>
        role.occupant_kind === "human" &&
        (role.occupant_id === userId ||
          (role.occupant_id ? controlledTrusts.has(role.occupant_id) : false)),
    )
    .map(({ bundle, role }) => [
      {
        trust: bundle.trust,
        role,
        relation: role.occupant_id === userId ? ("direct" as const) : ("identity" as const),
      },
    ]);

  const queue = [...directRoutes];
  const routes: AuthoritySegment[][] = [];
  const seenRoutes = new Set<string>();

  while (queue.length > 0) {
    const route = queue.shift();
    if (!route) continue;
    const key = route.map((segment) => `${segment.trust.id}:${segment.role.id}`).join(">");
    if (seenRoutes.has(key)) continue;
    seenRoutes.add(key);
    routes.push(route);

    if (route.length >= MAX_ROUTE_DEPTH) continue;
    const terminalTrust = route[route.length - 1].trust;
    for (const { bundle, role } of allRoles) {
      if (role.occupant_kind !== "trust" || role.occupant_id !== terminalTrust.id) continue;
      if (!byTrust.has(bundle.trust.id)) continue;
      if (route.some((segment) => segment.role.id === role.id)) continue;
      queue.push([...route, { trust: bundle.trust, role, relation: "nested" }]);
    }
  }

  const counts = new Map<string, number>();
  for (const route of routes) {
    const terminal = route[route.length - 1];
    const id = `${terminal.trust.id}:${terminal.role.id}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return routes
    .map((route, index) => {
      const terminal = route[route.length - 1];
      const terminalId = `${terminal.trust.id}:${terminal.role.id}`;
      const routeCount = counts.get(terminalId) ?? 1;
      return {
        id: `${terminalId}:${index}`,
        trust: terminal.trust,
        role: terminal.role,
        route,
        status: routeCount > 1 ? "ambiguous" : "available",
        routeCount,
      } satisfies RoleContextOption;
    })
    .sort((a, b) => {
      if (a.route.length !== b.route.length) return a.route.length - b.route.length;
      return `${a.trust.name}:${a.role.title}`.localeCompare(`${b.trust.name}:${b.role.title}`);
    });
}

function pickDefaultContext(contexts: RoleContextOption[], activeTrust: Trust | null) {
  if (contexts.length === 0) return null;
  if (activeTrust) {
    const activeMatch = contexts.find((ctx) => ctx.trust.id === activeTrust.id);
    if (activeMatch) return activeMatch;
  }
  return contexts[0];
}

function roleTypeLabel(type: RoleType) {
  if (type === "operational") return "Operator";
  if (type === "director") return "Director";
  if (type === "owner") return "Owner";
  return "Advisor";
}

function relationLabel(relation: AuthoritySegment["relation"]) {
  if (relation === "direct") return "Direct";
  if (relation === "identity") return "TRUST identity";
  return "Nested authority";
}

function routeSummary(route: AuthoritySegment[]) {
  return route
    .map(
      (segment) =>
        `${segment.trust.name} / ${segment.role.title || roleTypeLabel(segment.role.role_type)}`,
    )
    .join(" -> ");
}

function persistRoleContext(ctx: RoleContextOption, userId: string | null) {
  try {
    localStorage.setItem(
      "aeqi_role_context",
      JSON.stringify({
        user_id: userId,
        trust_id: ctx.trust.id,
        role_id: ctx.role.id,
        route: ctx.route.map((segment) => ({
          trust_id: segment.trust.id,
          trust_name: segment.trust.name,
          role_id: segment.role.id,
          role_title: segment.role.title,
          relation: segment.relation,
        })),
      }),
    );
  } catch {
    // localStorage may be unavailable; navigation still works.
  }
}
