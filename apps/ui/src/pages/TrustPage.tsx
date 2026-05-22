import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, GitBranch, Plus, Route, ShieldCheck } from "lucide-react";
import OperatingContextCard from "@/components/trust/OperatingContextCard";
import RoleContextCard from "@/components/trust/RoleContextCard";
import { Button, PrimitivePageHeader, PrimitiveSearchField } from "@/components/ui";
import { api } from "@/lib/api";
import { entityPath } from "@/lib/entityPath";
import {
  buildRoleContexts,
  buildTrustMapLayout,
  persistRoleContext,
  pickDefaultContext,
  relationLabel,
  roleTypeLabel,
  routeNodeId,
  SELF_NODE_ID,
  type RoleBundle,
  type RoleContextOption,
  type TrustMapNode,
} from "@/lib/trustRoleContext";
import type { Trust } from "@/lib/types";
import { useTrusts, useActiveTrust } from "@/queries/trusts";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

type ContextFilter = "all" | "direct" | "nested" | "ambiguous";

const FILTERS: Array<{ id: ContextFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "direct", label: "Direct" },
  { id: "nested", label: "Nested" },
  { id: "ambiguous", label: "Ambiguous" },
];

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
      <PrimitivePageHeader
        title="TRUST"
        className="trust-context-header"
        padding="none"
        actions={
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => navigate("/launch")}
            leadingIcon={<Plus size={14} strokeWidth={1.8} />}
          >
            Create TRUST
          </Button>
        }
      >
        <OperatingContextCard variant="inline" activeTrust={activeTrust} roleContext={selected} />
      </PrimitivePageHeader>

      <div
        className="trust-context-toolbar ideas-list-head"
        aria-label="Switch role context controls"
      >
        <div className="ideas-toolbar">
          <PrimitiveSearchField
            value={query}
            onChange={setQuery}
            placeholder="Search roles or TRUSTs"
            onEscapeEmpty={(event) => event.currentTarget.blur()}
          />
          <div className="trust-context-filters" aria-label="Role context filters">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ideas-toolbar-btn ${filter === item.id ? "is-active" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="trust-context-toolbar-stats" aria-label="Role-context summary">
            <Metric label="Role contexts" value={metrics.total} />
            <Metric label="Nested routes" value={metrics.nested} />
            <Metric label="Ambiguous" value={metrics.ambiguous} />
          </div>
        </div>
      </div>

      <main className="trust-context-workbench">
        <section className="trust-context-canvas" aria-label="Available role contexts">
          {bundlesQuery.isLoading ? (
            <div className="trust-context-empty">
              <Route size={20} strokeWidth={1.6} />
              <strong>Resolving role contexts</strong>
              <span>Reading role graphs across your TRUSTs.</span>
            </div>
          ) : filteredContexts.length > 0 ? (
            <TrustContextMap
              contexts={filteredContexts}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onEnter={handleEnter}
            />
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

function TrustContextMap({
  contexts,
  selectedId,
  onSelect,
  onEnter,
}: {
  contexts: RoleContextOption[];
  selectedId: string | null;
  onSelect: (contextId: string) => void;
  onEnter: (context: RoleContextOption) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const contextById = useMemo(() => new Map(contexts.map((ctx) => [ctx.id, ctx])), [contexts]);
  const activeId = previewId ?? selectedId;
  const layout = useMemo(() => buildTrustMapLayout(contexts), [contexts]);
  const activeContext = activeId ? contextById.get(activeId) : undefined;
  const activeRouteIds = activeContext
    ? new Set(activeContext.route.map((segment, index) => routeNodeId(segment, index)))
    : new Set();

  return (
    <div className="trust-context-map">
      <div className="trust-context-map-head">
        <div>
          <p className="trust-context-kicker">Authority web</p>
          <h2 className="trust-context-section-title">Choose the role you want to assume</h2>
        </div>
        <span className="trust-context-map-hint">
          {contexts.length} route{contexts.length === 1 ? "" : "s"} visible
        </span>
      </div>
      <div
        className="trust-context-map-viewport"
        style={
          {
            "--trust-map-width": `${layout.width}px`,
            "--trust-map-height": `${layout.height}px`,
          } as CSSProperties
        }
      >
        <div className="trust-context-map-stage">
          <svg
            className="trust-context-map-edges"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
            focusable="false"
          >
            {layout.edges.map((edge) => {
              const from = layout.byId.get(edge.from);
              const to = layout.byId.get(edge.to);
              if (!from || !to) return null;
              const active = Boolean(activeId && edge.routeIds.includes(activeId));
              const startX = from.x + from.width;
              const startY = from.y + from.height / 2;
              const endX = to.x;
              const endY = to.y + to.height / 2;
              return (
                <path
                  key={edge.id}
                  className={[
                    "trust-context-map-edge",
                    `trust-context-map-edge--${edge.relation}`,
                    active ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  d={`M ${startX} ${startY} C ${startX + 70} ${startY}, ${endX - 70} ${endY}, ${endX} ${endY}`}
                />
              );
            })}
          </svg>
          {layout.nodes.map((node) => {
            const isSelf = node.id === SELF_NODE_ID;
            const primary = contextById.get(node.primaryContextId) ?? contexts[0];
            const terminal = Boolean(selectedId && node.terminalContextIds.includes(selectedId));
            const activePath = isSelf || activeRouteIds.has(node.id);
            return (
              <TrustMapNodeButton
                key={node.id}
                node={node}
                selected={terminal}
                activePath={activePath}
                onSelect={() => onSelect(node.primaryContextId)}
                onEnter={primary ? () => onEnter(primary) : undefined}
                onPreview={(next) => setPreviewId(next ? node.primaryContextId : null)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrustMapNodeButton({
  node,
  selected,
  activePath,
  onSelect,
  onEnter,
  onPreview,
}: {
  node: TrustMapNode;
  selected: boolean;
  activePath: boolean;
  onSelect: () => void;
  onEnter?: () => void;
  onPreview: (previewing: boolean) => void;
}) {
  const isSelf = node.id === SELF_NODE_ID;
  const terminalCount = node.terminalContextIds.length;
  const segment = node.segment;
  const routeCount = node.routeIds.length;
  const label = isSelf
    ? "You, operator root"
    : `${segment?.role.title ?? "Untitled role"} in ${segment?.trust.name ?? "TRUST"}, ${routeCount} route${routeCount === 1 ? "" : "s"}`;
  const nodeStyle = {
    left: node.x,
    top: node.y,
    width: node.width,
    minHeight: node.height,
  };

  if (!isSelf && segment) {
    return (
      <RoleContextCard
        variant="map"
        trust={segment.trust}
        role={segment.role}
        relation={segment.relation}
        selected={selected}
        activePath={activePath}
        terminalCount={terminalCount}
        routeCount={routeCount}
        className={[
          "trust-context-map-node",
          terminalCount > 0 ? "trust-context-map-node--terminal" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={nodeStyle}
        onClick={onSelect}
        onDoubleClick={onEnter}
        onPreview={onPreview}
      />
    );
  }

  return (
    <button
      type="button"
      className={[
        "trust-context-map-node",
        "trust-context-map-node--self",
        activePath ? "is-active-path" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={nodeStyle}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
      onDoubleClick={onEnter}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
    >
      <span className="trust-context-map-node-kicker">Root</span>
      <span className="trust-context-map-node-title">You</span>
      <span className="trust-context-map-node-meta">Operator</span>
    </button>
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
