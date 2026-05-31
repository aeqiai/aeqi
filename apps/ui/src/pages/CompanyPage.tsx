import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowDownAZ, Filter, LayoutGrid, Network, Plus, ShieldCheck } from "lucide-react";
import CompanyAvatar from "@/components/CompanyAvatar";
import CompanyContextInspector from "@/components/company/CompanyContextInspector";
import CompanyContextOverview from "@/components/company/CompanyContextOverview";
import CompanyGraphZoomViewport from "@/components/company/CompanyGraphZoomViewport";
import CompanyMapEdgePath from "@/components/company/CompanyMapEdgePath";
import CompanyRegistryStrip from "@/components/company/CompanyRegistryStrip";
import CompanyRoleOptionCard from "@/components/company/CompanyRoleOptionCard";
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
  buildCompanyMapLayout,
  collapseRoleContextsByTerminal,
  persistRoleContext,
  pickDefaultContext,
  relationLabel,
  roleTypeLabel,
  SELF_NODE_ID,
  type RoleBundle,
  type RoleContextOption,
  type CompanyMapNode,
} from "@/lib/companyRoleContext";
import type { Company } from "@/lib/types";
import { useCompanies, useActiveCompany } from "@/queries/companies";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

const EMPTY_BUNDLES: RoleBundle[] = [];
type CompanyRoleFilter = "all" | "owner" | "director" | "operational" | "advisor";
type CompanyRoleSort = "company" | "holder" | "role" | "path";
type CompanyRoleView = "map" | "cards";

const ROLE_FILTER_OPTIONS: Array<{ id: CompanyRoleFilter; label: string }> = [
  { id: "all", label: "All roles" },
  { id: "owner", label: "Owners" },
  { id: "director", label: "Directors" },
  { id: "operational", label: "Operators" },
  { id: "advisor", label: "Advisors" },
];

const ROLE_SORT_OPTIONS: Array<{ id: CompanyRoleSort; label: string }> = [
  { id: "company", label: "COMPANY" },
  { id: "holder", label: "Holder" },
  { id: "role", label: "Role" },
  { id: "path", label: "Path depth" },
];

const ROLE_VIEW_OPTIONS: Array<{ id: CompanyRoleView; label: string }> = [
  { id: "map", label: "Map" },
  { id: "cards", label: "Cards" },
];

function defaultCompanyRoleView(): CompanyRoleView {
  if (typeof window === "undefined") return "map";
  if (typeof window.matchMedia !== "function") return "map";
  return window.matchMedia("(max-width: 760px)").matches ? "cards" : "map";
}

export default function CompanyPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeCompany = useActiveCompany(activeEntityId);
  const companies = useCompanies();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<CompanyRoleFilter>("all");
  const [sort, setSort] = useState<CompanyRoleSort>("company");
  const [view, setView] = useState<CompanyRoleView>(defaultCompanyRoleView);
  const controlledCompanyIds = useMemo(
    () => Array.from(new Set([...(user?.roots ?? []), ...(user?.entities ?? [])])),
    [user?.entities, user?.roots],
  );

  const bundlesQuery = useRoleBundles(companies, Boolean(user?.id));
  const bundles = bundlesQuery.data ?? EMPTY_BUNDLES;
  const roleContexts = useMemo(
    () => buildRoleContexts(bundles, user?.id ?? "", controlledCompanyIds),
    [bundles, controlledCompanyIds, user?.id],
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
    return pickDefaultContext(visibleRoleContexts, activeCompany);
  }, [activeCompany, selectedId, visibleRoleContexts]);

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
        holderLabel(ctx, companies, user?.name || user?.email),
        ctx.company.name,
        ctx.status,
        ...ctx.route.flatMap((segment) => [segment.role.title, segment.company.name]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });

    return collapseRoleContextsByTerminal(next).sort((a, b) =>
      compareContexts(a, b, sort, companies, user?.name || user?.email),
    );
  }, [query, roleContexts, roleFilter, sort, companies, user?.email, user?.name]);

  const selectedHolder = selected
    ? holderLabel(selected, companies, user?.name || user?.email)
    : "";
  const selectedRoleLabel = selected
    ? selected.role.title || roleTypeLabel(selected.role.role_type)
    : "";
  const selectedRelation = selected
    ? relationLabel(selected.route.at(-1)?.relation ?? "direct")
    : "";
  const sortLabel = ROLE_SORT_OPTIONS.find((option) => option.id === sort)?.label ?? "COMPANY";
  const filterLabel =
    ROLE_FILTER_OPTIONS.find((option) => option.id === roleFilter)?.label ?? "All roles";
  const viewLabel = ROLE_VIEW_OPTIONS.find((option) => option.id === view)?.label ?? "Map";
  const publicCompanyCount = useMemo(
    () => companies.filter((company) => company.public).length,
    [companies],
  );
  const unavailableCompanyCount = useMemo(
    () => bundles.filter((bundle) => bundle.unavailable).length,
    [bundles],
  );
  const registryCompanies = useMemo(() => {
    const activeId = selected?.company.id ?? activeCompany?.id ?? null;
    return [...companies].sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      if (a.public !== b.public) return a.public ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [activeCompany?.id, selected?.company.id, companies]);

  const handleEnter = (ctx: RoleContextOption) => {
    persistRoleContext(ctx, user?.id ?? null);
    setActiveEntity(ctx.company.id);
    navigate(entityPath(ctx.company));
  };

  return (
    <div className="company-context-page">
      <PrimitivePageHeader
        title="COMPANY"
        className="company-context-header"
        children={
          <div className="company-context-toolbar ideas-toolbar" aria-label="COMPANY controls">
            <PrimitiveSearchField
              value={query}
              onChange={setQuery}
              placeholder="Search Companies or roles"
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
            Launch COMPANY
          </Button>
        }
      />

      <CompanyContextOverview
        selected={selected}
        activeCompany={activeCompany}
        holder={selectedHolder}
        relation={selectedRelation}
        visibleCount={filteredContexts.length}
        totalCount={visibleRoleContexts.length}
        trustCount={companies.length}
        publicCompanyCount={publicCompanyCount}
      />

      <main className="company-context-workbench">
        <section className="company-context-canvas" aria-label="COMPANY role map">
          <div className="company-context-canvas-top">
            <div className="company-context-canvas-heading">
              <span className="company-context-canvas-kicker">Directory</span>
              <h2>Companies and role paths</h2>
            </div>
            <div className="company-context-canvas-status" aria-label="COMPANY directory status">
              <span>{filteredContexts.length} visible roles</span>
              <span>{unavailableCompanyCount} unavailable</span>
            </div>
          </div>

          <CompanyRegistryStrip
            companies={registryCompanies}
            activeCompanyId={selected?.company.id ?? activeCompany?.id ?? null}
            roleContexts={roleContexts}
            onOpen={(company) => {
              setActiveEntity(company.id);
              navigate(entityPath(company));
            }}
          />

          {bundlesQuery.isLoading ? (
            <div className="company-context-empty">
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>Resolving roles</strong>
              <span>Reading the Companies connected to your account.</span>
            </div>
          ) : filteredContexts.length > 0 && view === "map" ? (
            <CompanyContextMap
              contexts={filteredContexts}
              companies={companies}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onEnter={handleEnter}
            />
          ) : filteredContexts.length > 0 ? (
            <div className="company-context-card-grid" aria-label="COMPANY role cards">
              {filteredContexts.map((context) => (
                <CompanyRoleOptionCard
                  key={context.id}
                  company={context.company}
                  role={context.role}
                  roleContext={context}
                  selected={context.id === selected?.id}
                  activePath={context.id === selected?.id}
                  routeCount={context.routeCount}
                  className="company-context-grid-card"
                  onClick={() => setSelectedId(context.id)}
                  onDoubleClick={() => handleEnter(context)}
                />
              ))}
            </div>
          ) : (
            <div className="company-context-empty">
              <ShieldCheck size={20} strokeWidth={1.6} />
              <strong>No role paths available</strong>
              <span>
                {roleContexts.length === 0
                  ? "Your account does not currently hold a role in a COMPANY."
                  : "No COMPANY or role matches the current filter."}
              </span>
            </div>
          )}
        </section>

        <CompanyContextInspector
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

function useRoleBundles(companies: Company[], enabled: boolean) {
  const trustKey = companies.map((company) => company.id).join("|");
  return useQuery({
    queryKey: ["role-contexts", trustKey],
    enabled: enabled && companies.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.allSettled(
        companies.map(async (company): Promise<RoleBundle> => {
          const resp = await api.getRoles(company.id);
          return { company, roles: resp.roles ?? [], edges: resp.edges ?? [] };
        }),
      );
      return results.map((result, index): RoleBundle => {
        if (result.status === "fulfilled") return result.value;
        return { company: companies[index], roles: [], edges: [], unavailable: true };
      });
    },
  });
}

function CompanyContextMap({
  contexts,
  companies,
  selectedId,
  onSelect,
  onEnter,
}: {
  contexts: RoleContextOption[];
  companies: Company[];
  selectedId: string | null;
  onSelect: (contextId: string) => void;
  onEnter: (context: RoleContextOption) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const contextById = useMemo(() => new Map(contexts.map((ctx) => [ctx.id, ctx])), [contexts]);
  const activeId = previewId ?? selectedId;
  const layout = useMemo(() => buildCompanyMapLayout(contexts, companies), [contexts, companies]);
  const activeContext = activeId ? contextById.get(activeId) : undefined;
  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>([SELF_NODE_ID]);
    if (!activeContext) return ids;
    for (const segment of activeContext.route) {
      if (segment.role.occupant_kind === "company" && segment.role.occupant_id) {
        ids.add(trustNodeId(segment.role.occupant_id));
      }
      ids.add(trustNodeId(segment.company.id));
    }
    return ids;
  }, [activeContext]);

  return (
    <CompanyGraphZoomViewport width={layout.width} height={layout.height}>
      <div
        className="company-context-map-stage"
        style={
          {
            "--company-map-width": `${layout.width}px`,
            "--company-map-height": `${layout.height}px`,
          } as CSSProperties
        }
      >
        <svg
          className="company-context-map-edges"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-label="COMPANY role connections"
        >
          {layout.edges.map((edge) => (
            <CompanyMapEdgePath
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
            <CompanyMapNodeButton
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
    </CompanyGraphZoomViewport>
  );
}

function CompanyMapNodeButton({
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
  node: CompanyMapNode;
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
          "company-context-map-node",
          "company-context-map-node--self",
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
        <span className="company-context-map-node-kicker">Operator</span>
        <span className="company-context-map-node-title">You</span>
        <span className="company-context-map-node-meta">Current actor</span>
      </button>
    );
  }

  const company = node.company;
  const label = `${company?.name ?? "COMPANY"} with ${routeCount} role path${
    routeCount === 1 ? "" : "s"
  }`;

  return (
    <div
      className={[
        "company-context-map-node",
        "company-context-map-node--company",
        terminalContexts.length > 0 ? "company-context-map-node--role-options" : "",
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
        <span className="company-context-map-role-stack">
          {terminalContexts.slice(0, 3).map((context) => (
            <CompanyRoleOptionCard
              key={context.id}
              variant="map"
              company={context.company}
              role={context.role}
              roleContext={context}
              selected={context.id === selectedId}
              activePath={activePath}
              terminalCount={terminalCount}
              routeCount={context.routeCount}
              className="company-context-map-role-card"
              onClick={() => onSelectContext(context.id)}
              onDoubleClick={() => onEnterContext(context)}
              onPreview={(previewing) => onPreviewContext(previewing ? context.id : null)}
            />
          ))}
          {terminalContexts.length > 3 ? (
            <span className="company-context-map-role-more">
              +{terminalContexts.length - 3} roles
            </span>
          ) : null}
        </span>
      ) : (
        <button
          type="button"
          className="company-context-map-node-head company-context-map-node-head-button"
          onClick={onSelect}
          onDoubleClick={onEnter}
          onFocus={() => onPreview(true)}
          onBlur={() => onPreview(false)}
        >
          <CompanyAvatar
            name={company?.name ?? "COMPANY"}
            src={company?.avatar}
            size={42}
            className="company-context-role-avatar"
          />
          <span className="company-context-map-node-copy">
            <span className="company-context-map-node-kicker">COMPANY</span>
            <span className="company-context-map-node-title">{company?.name ?? "COMPANY"}</span>
            <span className="company-context-map-node-meta">
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
  sort: CompanyRoleSort,
  companies: Company[],
  fallbackHolder?: string,
) {
  if (sort === "holder") {
    return holderLabel(a, companies, fallbackHolder).localeCompare(
      holderLabel(b, companies, fallbackHolder),
    );
  }
  if (sort === "role") {
    return roleSortLabel(a).localeCompare(roleSortLabel(b));
  }
  if (sort === "path") {
    return a.route.length - b.route.length || a.company.name.localeCompare(b.company.name);
  }
  return (
    a.company.name.localeCompare(b.company.name) || roleSortLabel(a).localeCompare(roleSortLabel(b))
  );
}

function roleSortLabel(ctx: RoleContextOption) {
  return [
    ctx.role.title || roleTypeLabel(ctx.role.role_type),
    roleTypeLabel(ctx.role.role_type),
  ].join(":");
}

function holderLabel(ctx: RoleContextOption, companies: Company[], fallbackHolder?: string) {
  const role = ctx.role;
  if (role.occupant_kind === "human") {
    return role.occupant_name || fallbackHolder || compactId(role.occupant_id) || "Human";
  }
  if (role.occupant_kind === "company") {
    return companies.find((company) => company.id === role.occupant_id)?.name || "COMPANY";
  }
  if (role.occupant_kind === "agent") return "Agent";
  return "Vacant";
}

function compactId(value: string | null) {
  if (!value) return "";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function trustNodeId(companyId: string) {
  return `company:${companyId}`;
}
