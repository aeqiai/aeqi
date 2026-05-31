import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  ViewWidget,
  WIDGETS,
  type WidgetRenderData,
} from "@/components/CompanyViewsWorkbench.widgets";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import { useDaemonStore } from "@/store/daemon";
import type {
  EntityView,
  EntityViewScope,
  EntityViewUpsert,
  EntityViewWidgetKind,
} from "@/lib/types";

interface CompanyDashboardView {
  id: string;
  backendId?: string;
  title: string;
  scope: EntityViewScope;
  widgets: EntityViewWidgetKind[];
}

interface StoredViewsState {
  selectedViewId?: string;
  views?: CompanyDashboardView[];
}

interface CompanyViewsWorkbenchProps {
  companyId: string;
  editable?: boolean;
}

const STORAGE_KEY = "aeqi_company_views_v1";

const DEFAULT_VIEWS: CompanyDashboardView[] = [
  {
    id: "overview",
    title: "Overview",
    scope: "public",
    widgets: ["identity", "sessions", "quests", "events"],
  },
  {
    id: "operations",
    title: "Operations",
    scope: "private",
    widgets: ["sessions", "agents", "quests", "apps", "events"],
  },
  {
    id: "data-room",
    title: "Data room",
    scope: "public",
    widgets: ["identity", "economy", "website", "ideas"],
  },
];

function cloneDefaultViews(): CompanyDashboardView[] {
  return DEFAULT_VIEWS.map((view) => ({ ...view, widgets: [...view.widgets] }));
}

function normalizeViews(candidate: unknown): CompanyDashboardView[] | null {
  if (!Array.isArray(candidate)) return null;
  const knownKinds = new Set(WIDGETS.map((widget) => widget.kind));
  const views = candidate.flatMap((item): CompanyDashboardView[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<CompanyDashboardView>;
    if (typeof record.id !== "string" || typeof record.title !== "string") return [];
    const scope: EntityViewScope = record.scope === "public" ? "public" : "private";
    const widgets = Array.isArray(record.widgets)
      ? record.widgets.filter((kind): kind is EntityViewWidgetKind =>
          knownKinds.has(kind as EntityViewWidgetKind),
        )
      : [];
    return [{ id: record.id, backendId: record.backendId, title: record.title, scope, widgets }];
  });

  return views.length > 0 ? views : null;
}

function normalizeApiViews(apiViews: EntityView[]): CompanyDashboardView[] | null {
  const knownKinds = new Set(WIDGETS.map((widget) => widget.kind));
  const views = apiViews.flatMap((view): CompanyDashboardView[] => {
    if (view.kind !== "dashboard") return [];
    const widgets = Array.isArray(view.layout_json?.widgets)
      ? view.layout_json.widgets.filter((kind): kind is EntityViewWidgetKind =>
          knownKinds.has(kind as EntityViewWidgetKind),
        )
      : [];
    return [
      {
        id: view.key,
        backendId: view.id,
        title: view.label,
        scope: view.scope,
        widgets,
      },
    ];
  });
  return views.length > 0 ? views : null;
}

function toEntityViewUpserts(views: CompanyDashboardView[]): EntityViewUpsert[] {
  return views.map((view, index) => ({
    ...(view.backendId ? { id: view.backendId } : {}),
    key: view.id,
    label: view.title,
    kind: "dashboard",
    scope: view.scope,
    layout_json: { widgets: view.widgets },
    pinned: index === 0,
    sort_order: index,
  }));
}

function readStoredState(companyId: string): StoredViewsState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const trustState = parsed?.[companyId];
    if (!trustState || typeof trustState !== "object") return null;
    const selectedViewId =
      typeof trustState.selectedViewId === "string" ? trustState.selectedViewId : undefined;
    const views = normalizeViews(trustState.views);
    return { selectedViewId, views: views ?? undefined };
  } catch {
    return null;
  }
}

function persistState(companyId: string, state: StoredViewsState) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        [companyId]: state,
      }),
    );
  } catch {
    // Local persistence is an enhancement; the canonical default view still renders.
  }
}

function createInitialState(companyId: string): Required<StoredViewsState> {
  const stored = readStoredState(companyId);
  const views = stored?.views ?? cloneDefaultViews();
  const requestedViewId =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("view") || undefined;
  return {
    selectedViewId:
      (requestedViewId && views.some((view) => view.id === requestedViewId)
        ? requestedViewId
        : stored?.selectedViewId) ??
      views[0]?.id ??
      "overview",
    views,
  };
}

export default function CompanyViewsWorkbench({
  companyId,
  editable = false,
}: CompanyViewsWorkbenchProps) {
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);
  const events = useDaemonStore((s) => s.events);
  const entity = entities.find((candidate) => candidate.id === companyId);
  const basePath = entity ? entityBasePath(entity) : `/company/${encodeURIComponent(companyId)}`;
  const trustAgents = useMemo(
    () =>
      agents.filter((agent) => agent.company_id === companyId || agent.company_id === entity?.id),
    [agents, entity?.id, companyId],
  );
  const trustAgentIds = useMemo(() => {
    const ids = new Set<string>();
    if (entity?.agent_id) ids.add(entity.agent_id);
    for (const agent of trustAgents) ids.add(agent.id);
    return ids;
  }, [entity?.agent_id, trustAgents]);
  const trustQuests = useMemo(
    () => quests.filter((quest) => Boolean(quest.agent_id && trustAgentIds.has(quest.agent_id))),
    [quests, trustAgentIds],
  );
  const trustEvents = useMemo(() => {
    const trustQuestIds = new Set(trustQuests.map((quest) => quest.id));
    const trustRoots = new Set(
      [companyId, entity?.id, entity?.slug, entity?.company_address, entity?.company_id].filter(
        (value): value is string => Boolean(value),
      ),
    );
    return events.filter((event) => {
      const root = typeof event.metadata?.root === "string" ? event.metadata.root : null;
      return (
        Boolean(event.agent && trustAgentIds.has(event.agent)) ||
        Boolean(event.quest_id && trustQuestIds.has(event.quest_id)) ||
        Boolean(root && trustRoots.has(root))
      );
    });
  }, [
    entity?.id,
    entity?.slug,
    entity?.company_address,
    entity?.company_id,
    events,
    trustAgentIds,
    companyId,
    trustQuests,
  ]);
  const [views, setViews] = useState<CompanyDashboardView[]>(
    () => createInitialState(companyId).views,
  );
  const [selectedViewId, setSelectedViewId] = useState(
    () => createInitialState(companyId).selectedViewId,
  );

  const persistViewsToApi = (nextViews: CompanyDashboardView[]) => {
    if (!editable) return;
    void api
      .upsertCompanyViews(companyId, toEntityViewUpserts(nextViews))
      .then((response) => {
        const normalized = normalizeApiViews(response.views ?? []);
        if (!normalized) return;
        setViews(normalized);
        persistState(companyId, { selectedViewId, views: normalized });
      })
      .catch(() => {
        // Keep the optimistic local state; durable save can retry on the next edit.
      });
  };

  const selectView = (viewId: string) => {
    setSelectedViewId(viewId);
    if (typeof window === "undefined") return;
    const url = new URL(
      `${window.location.origin}${window.location.pathname}${window.location.search}`,
    );
    url.searchParams.set("view", viewId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  useEffect(() => {
    const next = createInitialState(companyId);
    setViews(next.views);
    setSelectedViewId(next.selectedViewId);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getCompanyViews(companyId)
      .then((response) => {
        if (cancelled) return;
        const apiViews = normalizeApiViews(response.views ?? []);
        if (!apiViews) return;
        const requestedViewId =
          typeof window === "undefined"
            ? undefined
            : new URLSearchParams(window.location.search).get("view") || undefined;
        const stored = readStoredState(companyId);
        const nextSelected =
          (requestedViewId && apiViews.some((view) => view.id === requestedViewId)
            ? requestedViewId
            : stored?.selectedViewId && apiViews.some((view) => view.id === stored.selectedViewId)
              ? stored.selectedViewId
              : undefined) ??
          apiViews[0]?.id ??
          "overview";
        setViews(apiViews);
        setSelectedViewId(nextSelected);
        persistState(companyId, { selectedViewId: nextSelected, views: apiViews });
      })
      .catch(() => {
        // Local/default views remain the fallback when the backend is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    persistState(companyId, { selectedViewId, views });
  }, [selectedViewId, companyId, views]);

  const selectedView = views.find((view) => view.id === selectedViewId) ?? views[0];
  const renderData = useMemo<WidgetRenderData>(
    () => ({ entity, basePath, agents: trustAgents, quests: trustQuests, events: trustEvents }),
    [basePath, entity, trustAgents, trustEvents, trustQuests],
  );

  const addView = () => {
    const nextIndex = views.length + 1;
    const nextView: CompanyDashboardView = {
      id: `view-${Date.now().toString(36)}`,
      title: `View ${nextIndex}`,
      scope: "private",
      widgets: ["sessions", "quests", "events"],
    };
    setViews((current) => {
      const next = [...current, nextView];
      persistViewsToApi(next);
      return next;
    });
    selectView(nextView.id);
  };

  const updateSelectedView = (updater: (view: CompanyDashboardView) => CompanyDashboardView) => {
    if (!selectedView) return;
    setViews((current) => {
      const next = current.map((view) => (view.id === selectedView.id ? updater(view) : view));
      persistViewsToApi(next);
      return next;
    });
  };

  const toggleWidget = (kind: EntityViewWidgetKind) => {
    updateSelectedView((view) => {
      const exists = view.widgets.includes(kind);
      return {
        ...view,
        widgets: exists
          ? view.widgets.filter((widget) => widget !== kind)
          : [...view.widgets, kind],
      };
    });
  };

  if (!selectedView) return null;

  return (
    <section
      className="company-views-workbench"
      aria-label={editable ? "Views dashboard builder" : "COMPANY overview"}
    >
      <div className="company-views-top">
        <div className="company-views-heading">
          <span className="company-views-kicker">Views</span>
          <h2>{editable ? "Modular dashboard" : "COMPANY overview"}</h2>
          <p>
            {editable
              ? "Compose a private workspace or public overview from sessions, agents, quests, ideas, apps, events, and market widgets."
              : "Current operating signals scoped to this COMPANY, ready for the first launch review."}
          </p>
        </div>
        <div className="company-views-actions">
          <span
            className="company-views-scope"
            data-scope={editable ? selectedView.scope : "overview"}
          >
            {editable
              ? selectedView.scope === "public"
                ? "Public overview"
                : "Private workspace"
              : "Overview-safe"}
          </span>
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="company-views-new-button"
              leadingIcon={<Plus size={13} strokeWidth={1.6} />}
              onClick={addView}
            >
              New view
            </Button>
          )}
        </div>
      </div>

      <div className="company-views-tabs" role="tablist" aria-label="Saved views">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={view.id === selectedView.id}
            className={
              view.id === selectedView.id ? "company-views-tab is-active" : "company-views-tab"
            }
            onClick={() => selectView(view.id)}
          >
            <span>{view.title}</span>
            {editable && <small>{view.scope}</small>}
          </button>
        ))}
      </div>

      <div className={editable ? "company-views-editor" : "company-views-editor is-readonly"}>
        <div className="company-views-canvas" aria-label={`${selectedView.title} widgets`}>
          {selectedView.widgets.length === 0 ? (
            <div className="company-views-empty">
              <strong>{editable ? "No widgets selected" : "No overview widgets available"}</strong>
              <span>
                {editable
                  ? "Add widgets from the library to shape this view."
                  : "Launch signals will appear here as the COMPANY starts operating."}
              </span>
            </div>
          ) : (
            selectedView.widgets.map((kind) => (
              <ViewWidget key={kind} kind={kind} data={renderData} />
            ))
          )}
        </div>
        {editable && (
          <aside className="company-views-library" aria-label="Available widgets">
            <div className="company-views-library-head">
              <strong>Widget library</strong>
              <span>{selectedView.widgets.length} active</span>
            </div>
            <div className="company-views-scope-toggle" aria-label="View visibility">
              <button
                type="button"
                className={selectedView.scope === "private" ? "is-active" : ""}
                onClick={() => updateSelectedView((view) => ({ ...view, scope: "private" }))}
              >
                Private
              </button>
              <button
                type="button"
                className={selectedView.scope === "public" ? "is-active" : ""}
                onClick={() => updateSelectedView((view) => ({ ...view, scope: "public" }))}
              >
                Public
              </button>
            </div>
            {selectedView.scope === "public" ? (
              <p className="company-views-public-note">
                Public marks this view as overview-safe. Durable sharing and permissions still
                depend on backend view tools.
              </p>
            ) : null}
            <div className="company-views-widget-list">
              {WIDGETS.map((widget) => {
                const active = selectedView.widgets.includes(widget.kind);
                const Icon = widget.icon;
                return (
                  <button
                    key={widget.kind}
                    type="button"
                    className={
                      active ? "company-views-widget-pick is-active" : "company-views-widget-pick"
                    }
                    aria-pressed={active}
                    onClick={() => toggleWidget(widget.kind)}
                  >
                    <Icon size={15} strokeWidth={1.7} aria-hidden />
                    <span>
                      <strong>{widget.label}</strong>
                      <small>{widget.source}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
