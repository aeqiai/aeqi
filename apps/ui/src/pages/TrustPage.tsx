import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowDownAZ, Filter, LayoutGrid, Network, Plus, ShieldCheck } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import TrustContextInspector from "@/components/trust/TrustContextInspector";
import TrustContextOverview from "@/components/trust/TrustContextOverview";
import TrustGraphZoomViewport from "@/components/trust/TrustGraphZoomViewport";
import TrustMapEdgePath from "@/components/trust/TrustMapEdgePath";
import TrustRoleOptionCard from "@/components/trust/TrustRoleOptionCard";
import {
  Button,
  PrimitivePageHeader,
  PrimitiveSearchField,
  ToolbarRadioPopover,
} from "@/components/ui";
import { api } from "@/lib/api";
import { entityPath } from "@/lib/entityPath";
import {
  buildRoleContexts,
  buildTrustMapLayout,
  collapseRoleContextsByTerminal,
  persistRoleContext,
  pickDefaultContext,
  relationLabel,
  roleTypeLabel,
  SELF_NODE_ID,
  type RoleBundle,
  type RoleContextOption,
  type TrustMapNode,
} from "@/lib/trustRoleContext";
import type { Trust } from "@/lib/types";
import { useTrusts, useActiveTrust } from "@/queries/trusts";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

const EMPTY_BUNDLES: RoleBundle[] = [];
type TrustRoleFilter = "all" | "owner" | "director" | "operational" | "advisor";
type TrustRoleSort = "trust" | "holder" | "role" | "path";
type TrustRoleView = "map" | "cards";

const ROLE_FILTER_OPTIONS: Array<{ id: TrustRoleFilter; label: string }> = [
  { id: "all", label: "All roles" },
  { id: "owner", label: "Owners" },
  { id: "director", label: "Directors" },
  { id: "operational", label: "Operators" },
  { id: "advisor", label: "Advisors" },
];

const ROLE_SORT_OPTIONS: Array<{ id: TrustRoleSort; label: string }> = [
  { id: "trust", label: "TRUST" },
  { id: "holder", label: "Holder" },
  { id: "role", label: "Role" },
  { id: "path", label: "Path depth" },
];

const ROLE_VIEW_OPTIONS: Array<{ id: TrustRoleView; label: string }> = [
  { id: "map", label: "Map" },
  { id: "cards", label: "Cards" },
];

export default function TrustPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeTrust = useActiveTrust(activeEntityId);
  const trusts = useTrusts();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<TrustRoleFilter>("all");
  const [sort, setSort] = useState<TrustRoleSort>("trust");
  const [view, setView] = useState<TrustRoleView>("map");
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
  const visibleRoleContexts = useMemo(
    () => collapseRoleContextsByTerminal(roleContexts),
    [roleContexts],
  );

  const selected = useMemo(() => {
    if (selectedId) {
      const match = visibleRoleContexts.find((ctx) => ctx.id === selectedId);
      if (match) return match;
    }
    return pickDefaultContext(visibleRoleContexts, activeTrust);
  }, [activeTrust, selectedId, visibleRoleContexts]);

  useEffect(() => {
    if (!selected && selectedId) setSelectedId(null);
  }, [selected, selectedId]);

  const filteredContexts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const next = roleContexts.filter((ctx) => {
      if (roleFilter !== "all" && ctx.role.role_type !== roleFilter) return false;
      if (!normalized) return true;
      return [
        ctx.role.title,
        roleTypeLabel(ctx.role.role_type),
        holderLabel(ctx, trusts, user?.name || user?.email),
        ctx.trust.name,
        ctx.status,
        ...ctx.route.flatMap((segment) => [segment.role.title, segment.trust.name]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });

    return collapseRoleContextsByTerminal(next).sort((a, b) =>
      compareContexts(a, b, sort, trusts, user?.name || user?.email),
    );
  }, [query, roleContexts, roleFilter, sort, trusts, user?.email, user?.name]);

  const selectedHolder = selected ? holderLabel(selected, trusts, user?.name || user?.email) : "";
  const selectedRoleLabel = selected
    ? selected.role.title || roleTypeLabel(selected.role.role_type)
    : "";
  const selectedRelation = selected
    ? relationLabel(selected.route.at(-1)?.relation ?? "direct")
    : "";
  const sortLabel = ROLE_SORT_OPTIONS.find((option) => option.id === sort)?.label ?? "TRUST";
  const filterLabel =
    ROLE_FILTER_OPTIONS.find((option) => option.id === roleFilter)?.label ?? "All roles";
  const viewLabel = ROLE_VIEW_OPTIONS.find((option) => option.id === view)?.label ?? "Map";

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
        children={
          <div className="trust-context-toolbar ideas-toolbar" aria-label="TRUST controls">
            <PrimitiveSearchField
              value={query}
              onChange={setQuery}
              placeholder="Search TRUSTs or roles"
              onEscapeEmpty={(event) => event.currentTarget.blur()}
            />
            <ToolbarRadioPopover
              label="Sort"
              current={sortLabel}
              glyph={<ArrowDownAZ size={15} strokeWidth={1.7} />}
              options={ROLE_SORT_OPTIONS}
              value={sort}
              onChange={setSort}
            />
            <ToolbarRadioPopover
              label="Filter"
              current={filterLabel}
              glyph={<Filter size={15} strokeWidth={1.7} />}
              options={ROLE_FILTER_OPTIONS}
              value={roleFilter}
              onChange={setRoleFilter}
              indicator={roleFilter !== "all"}
            />
            <ToolbarRadioPopover
              label="View"
              current={viewLabel}
              glyph={
                view === "map" ? (
                  <Network size={15} strokeWidth={1.7} />
                ) : (
                  <LayoutGrid size={15} strokeWidth={1.7} />
                )
              }
              options={ROLE_VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
          </div>
        }
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

      <TrustContextOverview
        selected={selected}
        holder={selectedHolder}
        relation={selectedRelation}
        visibleCount={filteredContexts.length}
        totalCount={visibleRoleContexts.length}
      />

      <main className="trust-context-workbench">
        <section className="trust-context-canvas" aria-label="TRUST role map">
          {bundlesQuery.isLoading ? (
            <div className="trust-context-empty">
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>Resolving roles</strong>
              <span>Reading the TRUSTs connected to your account.</span>
            </div>
          ) : filteredContexts.length > 0 && view === "map" ? (
            <TrustContextMap
              contexts={filteredContexts}
              trusts={trusts}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onEnter={handleEnter}
            />
          ) : filteredContexts.length > 0 ? (
            <div className="trust-context-card-grid" aria-label="TRUST role cards">
              {filteredContexts.map((context) => (
                <TrustRoleOptionCard
                  key={context.id}
                  trust={context.trust}
                  role={context.role}
                  roleContext={context}
                  selected={context.id === selected?.id}
                  activePath={context.id === selected?.id}
                  routeCount={context.routeCount}
                  className="trust-context-grid-card"
                  onClick={() => setSelectedId(context.id)}
                  onDoubleClick={() => handleEnter(context)}
                />
              ))}
            </div>
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

        <TrustContextInspector
          selected={selected}
          holderLabel={selectedHolder}
          roleLabel={selectedRoleLabel}
          relation={selectedRelation}
          userEmail={user?.email}
          onEnter={handleEnter}
        />
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
          aria-label="TRUST role connections"
        >
          {layout.edges.map((edge) => (
            <TrustMapEdgePath
              key={edge.id}
              edge={edge}
              layout={layout.byId}
              active={Boolean(activeId && edge.routeIds.includes(activeId))}
              onSelect={edge.routeIds[0] ? () => onSelect(edge.routeIds[0]) : undefined}
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
        aria-label="You, current actor"
        onClick={onSelect}
        onDoubleClick={onEnter}
        onMouseEnter={() => onPreview(true)}
        onMouseLeave={() => onPreview(false)}
        onFocus={() => onPreview(true)}
        onBlur={() => onPreview(false)}
      >
        <span className="trust-context-map-node-kicker">Operator</span>
        <span className="trust-context-map-node-title">You</span>
        <span className="trust-context-map-node-meta">Current actor</span>
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

function compareContexts(
  a: RoleContextOption,
  b: RoleContextOption,
  sort: TrustRoleSort,
  trusts: Trust[],
  fallbackHolder?: string,
) {
  if (sort === "holder") {
    return holderLabel(a, trusts, fallbackHolder).localeCompare(
      holderLabel(b, trusts, fallbackHolder),
    );
  }
  if (sort === "role") {
    return roleSortLabel(a).localeCompare(roleSortLabel(b));
  }
  if (sort === "path") {
    return a.route.length - b.route.length || a.trust.name.localeCompare(b.trust.name);
  }
  return (
    a.trust.name.localeCompare(b.trust.name) || roleSortLabel(a).localeCompare(roleSortLabel(b))
  );
}

function roleSortLabel(ctx: RoleContextOption) {
  return [
    ctx.role.title || roleTypeLabel(ctx.role.role_type),
    roleTypeLabel(ctx.role.role_type),
  ].join(":");
}

function holderLabel(ctx: RoleContextOption, trusts: Trust[], fallbackHolder?: string) {
  const role = ctx.role;
  if (role.occupant_kind === "human") {
    return role.occupant_name || fallbackHolder || compactId(role.occupant_id) || "Human";
  }
  if (role.occupant_kind === "trust") {
    return trusts.find((trust) => trust.id === role.occupant_id)?.name || "TRUST";
  }
  if (role.occupant_kind === "agent") return "Agent";
  return "Vacant";
}

function compactId(value: string | null) {
  if (!value) return "";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function trustNodeId(trustId: string) {
  return `trust:${trustId}`;
}
