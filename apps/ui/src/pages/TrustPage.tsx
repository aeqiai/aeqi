import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Plus, ShieldCheck } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import TrustGraphZoomViewport from "@/components/trust/TrustGraphZoomViewport";
import TrustRoleOptionCard from "@/components/trust/TrustRoleOptionCard";
import { Button, PrimitivePageHeader, PrimitiveSearchField } from "@/components/ui";
import { api } from "@/lib/api";
import { entityPath } from "@/lib/entityPath";
import {
  buildRoleContexts,
  buildTrustMapLayout,
  persistRoleContext,
  pickDefaultContext,
  roleTypeLabel,
  SELF_NODE_ID,
  type RoleBundle,
  type RoleContextOption,
  type TrustMapEdge,
  type TrustMapNode,
} from "@/lib/trustRoleContext";
import type { Trust } from "@/lib/types";
import { useTrusts, useActiveTrust } from "@/queries/trusts";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

const EMPTY_BUNDLES: RoleBundle[] = [];

export default function TrustPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeTrust = useActiveTrust(activeEntityId);
  const trusts = useTrusts();
  const [query, setQuery] = useState("");
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
  }, [query, roleContexts]);

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
        actions={
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => navigate("/launch")}
            leadingIcon={<Plus size={14} strokeWidth={1.8} />}
          >
            Launch TRUST
          </Button>
        }
      />

      <div className="trust-context-toolbar ideas-list-head" aria-label="TRUST controls">
        <div className="ideas-toolbar">
          <PrimitiveSearchField
            value={query}
            onChange={setQuery}
            placeholder="Search TRUSTs or roles"
            onEscapeEmpty={(event) => event.currentTarget.blur()}
          />
        </div>
      </div>

      <main className="trust-context-workbench">
        <section className="trust-context-canvas" aria-label="TRUST role map">
          {bundlesQuery.isLoading ? (
            <div className="trust-context-empty">
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>Resolving roles</strong>
              <span>Reading the TRUSTs connected to your account.</span>
            </div>
          ) : filteredContexts.length > 0 ? (
            <TrustContextMap
              contexts={filteredContexts}
              trusts={trusts}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onEnter={handleEnter}
            />
          ) : (
            <div className="trust-context-empty">
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>No role paths available</strong>
              <span>
                {roleContexts.length === 0
                  ? "Your account does not currently hold a role in a TRUST."
                  : "No TRUST or role matches the current filter."}
              </span>
            </div>
          )}
        </section>

        <aside className="trust-context-inspector" aria-label="Selected role">
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
                Enter role
                <ArrowRight size={15} strokeWidth={1.8} />
              </button>
              <InspectorBlock title="Path">
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
                    </li>
                  ))}
                </ol>
              </InspectorBlock>
              <InspectorBlock title="Grants">
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
              <InspectorBlock title="Route">
                <p className="trust-context-inspector-copy">
                  {selected.status === "ambiguous"
                    ? `${selected.routeCount} paths can reach this role.`
                    : selected.route.length > 1
                      ? "This role is reached through another TRUST."
                      : selected.route[0]?.relation === "identity"
                        ? "This role is held by a TRUST identity connected to your account."
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
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>No role selected</strong>
              <span>Select a role on the map to inspect its path.</span>
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
  trusts,
  selectedId,
  onSelect,
  onEnter,
}: {
  contexts: RoleContextOption[];
  trusts: Trust[];
  selectedId: string | null;
  onSelect: (contextId: string) => void;
  onEnter: (context: RoleContextOption) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const contextById = useMemo(() => new Map(contexts.map((ctx) => [ctx.id, ctx])), [contexts]);
  const activeId = previewId ?? selectedId;
  const layout = useMemo(() => buildTrustMapLayout(contexts, trusts), [contexts, trusts]);
  const activeContext = activeId ? contextById.get(activeId) : undefined;
  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>([SELF_NODE_ID]);
    if (!activeContext) return ids;
    for (const segment of activeContext.route) {
      if (segment.role.occupant_kind === "trust" && segment.role.occupant_id) {
        ids.add(trustNodeId(segment.role.occupant_id));
      }
      ids.add(trustNodeId(segment.trust.id));
    }
    return ids;
  }, [activeContext]);

  return (
    <TrustGraphZoomViewport width={layout.width} height={layout.height}>
      <div
        className="trust-context-map-stage"
        style={
          {
            "--trust-map-width": `${layout.width}px`,
            "--trust-map-height": `${layout.height}px`,
          } as CSSProperties
        }
      >
        <svg
          className="trust-context-map-edges"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
          focusable="false"
        >
          {layout.edges.map((edge) => (
            <TrustMapEdgePath
              key={edge.id}
              edge={edge}
              layout={layout.byId}
              active={Boolean(activeId && edge.routeIds.includes(activeId))}
            />
          ))}
        </svg>
        {layout.nodes.map((node) => {
          const primary = contextById.get(node.primaryContextId) ?? contexts[0];
          const selected = Boolean(selectedId && node.terminalContextIds.includes(selectedId));
          const activePath = activeNodeIds.has(node.id);
          const terminalContexts = node.terminalContextIds
            .map((contextId) => contextById.get(contextId))
            .filter((ctx): ctx is RoleContextOption => Boolean(ctx));
          return (
            <TrustMapNodeButton
              key={node.id}
              node={node}
              terminalContexts={terminalContexts}
              selectedId={selectedId}
              selected={selected}
              activePath={activePath}
              onSelect={() => onSelect(node.primaryContextId)}
              onSelectContext={onSelect}
              onEnter={primary ? () => onEnter(primary) : undefined}
              onEnterContext={onEnter}
              onPreview={(next) => setPreviewId(next ? node.primaryContextId : null)}
              onPreviewContext={(contextId) => setPreviewId(contextId)}
            />
          );
        })}
      </div>
    </TrustGraphZoomViewport>
  );
}

function TrustMapEdgePath({
  edge,
  layout,
  active,
}: {
  edge: TrustMapEdge;
  layout: Map<string, TrustMapNode>;
  active: boolean;
}) {
  const from = layout.get(edge.from);
  const to = layout.get(edge.to);
  if (!from || !to) return null;
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  return (
    <path
      className={[
        "trust-context-map-edge",
        `trust-context-map-edge--${edge.relation}`,
        edge.role ? "trust-context-map-edge--role" : "trust-context-map-edge--identity",
        active ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      d={`M ${startX} ${startY} C ${startX + 92} ${startY}, ${endX - 92} ${endY}, ${endX} ${endY}`}
    />
  );
}

function TrustMapNodeButton({
  node,
  terminalContexts,
  selectedId,
  selected,
  activePath,
  onSelect,
  onSelectContext,
  onEnter,
  onEnterContext,
  onPreview,
  onPreviewContext,
}: {
  node: TrustMapNode;
  terminalContexts: RoleContextOption[];
  selectedId: string | null;
  selected: boolean;
  activePath: boolean;
  onSelect: () => void;
  onSelectContext: (contextId: string) => void;
  onEnter?: () => void;
  onEnterContext: (context: RoleContextOption) => void;
  onPreview: (previewing: boolean) => void;
  onPreviewContext: (contextId: string | null) => void;
}) {
  const isSelf = node.id === SELF_NODE_ID;
  const terminalCount = node.terminalContextIds.length;
  const routeCount = node.routeIds.length;
  const nodeStyle = {
    left: node.x,
    top: node.y,
    width: node.width,
    minHeight: node.height,
  };

  if (isSelf) {
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
        aria-label="You, operator root"
        onClick={onSelect}
        onDoubleClick={onEnter}
        onMouseEnter={() => onPreview(true)}
        onMouseLeave={() => onPreview(false)}
        onFocus={() => onPreview(true)}
        onBlur={() => onPreview(false)}
      >
        <span className="trust-context-map-node-kicker">Operator</span>
        <span className="trust-context-map-node-title">You</span>
        <span className="trust-context-map-node-meta">Account root</span>
      </button>
    );
  }

  const trust = node.trust;
  const label = `${trust?.name ?? "TRUST"} with ${routeCount} role path${
    routeCount === 1 ? "" : "s"
  }`;

  return (
    <div
      className={[
        "trust-context-map-node",
        "trust-context-map-node--trust",
        terminalContexts.length > 0 ? "trust-context-map-node--role-options" : "",
        selected ? "is-selected" : "",
        activePath ? "is-active-path" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={nodeStyle}
      aria-label={label}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
    >
      {terminalContexts.length > 0 ? (
        <span className="trust-context-map-role-stack">
          {terminalContexts.slice(0, 3).map((context) => (
            <TrustRoleOptionCard
              key={context.id}
              variant="map"
              trust={context.trust}
              role={context.role}
              roleContext={context}
              selected={context.id === selectedId}
              activePath={activePath}
              terminalCount={terminalCount}
              routeCount={context.routeCount}
              className="trust-context-map-role-card"
              onClick={() => onSelectContext(context.id)}
              onDoubleClick={() => onEnterContext(context)}
              onPreview={(previewing) => onPreviewContext(previewing ? context.id : null)}
            />
          ))}
          {terminalContexts.length > 3 ? (
            <span className="trust-context-map-role-more">
              +{terminalContexts.length - 3} roles
            </span>
          ) : null}
        </span>
      ) : (
        <button
          type="button"
          className="trust-context-map-node-head trust-context-map-node-head-button"
          onClick={onSelect}
          onDoubleClick={onEnter}
          onFocus={() => onPreview(true)}
          onBlur={() => onPreview(false)}
        >
          <TrustAvatar
            name={trust?.name ?? "TRUST"}
            src={trust?.avatar}
            size={42}
            className="trust-context-role-avatar"
          />
          <span className="trust-context-map-node-copy">
            <span className="trust-context-map-node-kicker">TRUST</span>
            <span className="trust-context-map-node-title">{trust?.name ?? "TRUST"}</span>
            <span className="trust-context-map-node-meta">
              {terminalCount > 0
                ? `${terminalCount} selectable role${terminalCount === 1 ? "" : "s"}`
                : `${routeCount} path${routeCount === 1 ? "" : "s"}`}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

function trustNodeId(trustId: string) {
  return `trust:${trustId}`;
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="trust-context-inspector-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
