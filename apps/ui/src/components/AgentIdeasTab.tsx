import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getIdeaGraph, storeIdea } from "@/api/ideas";
import { useCurrentTrust } from "@/hooks/useCurrentTrust";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas, useAgentIdeasCache, useVisibleIdeas } from "@/queries/ideas";
import type { Idea } from "@/lib/types";
import type { GraphNode, GraphEdge } from "./IdeaGraph";
import IdeasListView from "./ideas/IdeasListView";
import IdeasWorkspaceView from "./ideas/IdeasWorkspaceView";
import type { IdeasView } from "./ideas/IdeasViewPopover";
import { blockTreeToPlainText } from "./editor/blockEditorContent";
import { Loading } from "./ui";
import { findTrustRootIdea, trustRootProperties } from "./ideas/ideaTree";
import {
  type FilterState,
  type IdeasFilter,
  IDEA_FILTER_VALUES,
  IDEA_SCOPE_VALUES,
  matchesVisibilityFilter,
  visibilityBucket,
  parseScope,
  parseSort,
  parseTags,
  serializeTags,
  childCountsByIdeaParent,
  ideaAncestors,
  isDirectIdeaChildOf,
} from "./ideas/types";

const NO_IDEAS: Idea[] = [];
const IdeasGraphView = lazy(() => import("./ideas/IdeasGraphView"));
const IdeasCanvasView = lazy(() => import("./ideas/IdeasCanvasView"));
const IdeasTableView = lazy(() => import("./ideas/IdeasTableView"));

const viewFallback = (
  <div className="ideas-list-body">
    <Loading size="md" />
  </div>
);

/**
 * Ideas tab. Routes to:
 *   - graph view (?view=graph)
 *   - compose canvas (?compose=1 — triggered by New idea)
 *   - detail canvas (`:itemId` selected)
 *   - dense inline picker with parent/child disclosure (default — no itemId, no compose)
 *
 * Filter state (scope / q / tag) lives in URL search params so switching
 * between list and graph keeps the frame; the graph view applies the same
 * filters to its nodes so the two views stay coherent.
 */
export default function AgentIdeasTab({
  agentId,
  scope = "agent",
  kind,
  tags = [],
}: {
  agentId: string;
  scope?: "agent" | "entity";
  kind?: "goal";
  tags?: string[];
}) {
  const { goEntity, trustId } = useNav();
  const { entity } = useCurrentTrust();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const { addIdea } = useAgentIdeasCache(agentId, trustId);
  const rootCreateRef = useRef(false);
  const [rootCreateError, setRootCreateError] = useState<string | null>(null);
  const view: IdeasView = ((): IdeasView => {
    const raw = searchParams.get("view");
    if (raw === "graph" || raw === "table") return raw;
    // `?view=kanban` is a retired view (2026-05-17) — fall back to list.
    return "list";
  })();
  const composing = searchParams.get("compose") === "1";
  const folderParam = searchParams.get("folder");

  const filter: FilterState = {
    scope: parseScope(searchParams.get("scope")),
    search: searchParams.get("q") ?? "",
    tags: parseTags(searchParams.get("tags") ?? searchParams.get("tag")),
    sort: parseSort(searchParams.get("sort")),
    needsReview: searchParams.get("review") === "1",
  };

  const patchParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      mut(params);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setView = useCallback(
    (next: IdeasView) => {
      patchParams((p) => {
        if (next === "list") p.delete("view");
        else p.set("view", next);
      });
    },
    [patchParams],
  );

  const setFilter = useCallback(
    (patch: Partial<FilterState>) => {
      patchParams((p) => {
        if ("scope" in patch) {
          if (patch.scope && patch.scope !== "all") p.set("scope", patch.scope);
          else p.delete("scope");
        }
        if ("search" in patch) {
          if (patch.search) p.set("q", patch.search);
          else p.delete("q");
        }
        if ("tags" in patch) {
          // Drop the legacy single-tag param so the URL stays clean
          // when migrating between visits or when the user clears the
          // last tag back to the empty state.
          p.delete("tag");
          if (patch.tags && patch.tags.length > 0) p.set("tags", serializeTags(patch.tags));
          else p.delete("tags");
        }
        if ("sort" in patch) {
          if (patch.sort && patch.sort !== "tag") p.set("sort", patch.sort);
          else p.delete("sort");
        }
        if ("needsReview" in patch) {
          if (patch.needsReview) p.set("review", "1");
          else p.delete("review");
        }
        p.delete("kind");
      });
    },
    [patchParams],
  );

  const agentIdeas = useAgentIdeas(agentId, scope === "agent", trustId);
  const visibleIdeas = useVisibleIdeas(scope === "entity", trustId);
  const ideasQuery = scope === "entity" ? visibleIdeas : agentIdeas;
  const { data: ideas = NO_IDEAS, isLoading: ideasLoading } = ideasQuery;
  const trustName = (scope === "entity" ? entity?.name : null) || "TRUST";
  const trustRootIdea = useMemo(
    () => (scope === "entity" ? findTrustRootIdea(ideas, trustId) : null),
    [ideas, scope, trustId],
  );

  useEffect(() => {
    if (scope !== "entity" || ideasLoading || trustRootIdea || rootCreateRef.current || !trustId) {
      return;
    }
    rootCreateRef.current = true;
    setRootCreateError(null);
    const name = trustName.trim() || "TRUST";
    storeIdea(
      {
        name,
        content: "",
        tags: ["trust"],
        scope: "global",
        properties: trustRootProperties(trustId),
      },
      trustId,
    )
      .then((res) => {
        addIdea({
          id: res.id,
          name,
          content: "",
          tags: ["trust"],
          scope: "global",
          parent_idea_id: null,
          properties: trustRootProperties(trustId),
        });
      })
      .catch((error) => {
        rootCreateRef.current = false;
        setRootCreateError(error instanceof Error ? error.message : "Could not create TRUST root");
      });
  }, [scope, ideasLoading, trustRootIdea, trustId, trustName, addIdea]);

  // Apply scope + search + tag to the agent's ideas. The graph view
  // filters its own nodes against this same universe so the two views
  // answer the same question through different lenses.
  const scoped = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    return ideas.filter((idea) => {
      // scope filtering
      const sc = filter.scope;
      if (sc !== "all") {
        if (sc === "inherited") {
          // cross-cut: visible but anchored on another agent
          if (idea.agent_id == null || idea.agent_id === agentId) return false;
        } else if (idea.scope != null) {
          if (!matchesVisibilityFilter(idea.scope, sc)) return false;
        } else {
          // Legacy rows have no scope column; only self/global can be
          // inferred from agent ownership.
          const inferredSelf = idea.agent_id === agentId;
          if (sc === "self" && !inferredSelf) return false;
          if (sc === "global" && idea.agent_id != null) return false;
          if (sc !== "self" && sc !== "global") return false;
        }
      }
      if (filter.needsReview) {
        const t = idea.tags ?? [];
        const isCandidate =
          t.includes("skill") &&
          t.includes("candidate") &&
          !t.includes("promoted") &&
          !t.includes("rejected");
        if (!isCandidate) return false;
      }
      if (kind && idea.kind !== kind) return false;
      if (q) {
        const inName = idea.name.toLowerCase().includes(q);
        const inContent = blockTreeToPlainText(idea.content).toLowerCase().includes(q);
        if (!inName && !inContent) return false;
      }
      return true;
    });
  }, [ideas, filter.search, filter.scope, filter.needsReview, kind, agentId]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const idea of scoped) {
      for (const t of idea.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  // Multi-tag filtering — OR semantics. Picking #skill and #candidate shows
  // ideas tagged with EITHER, so adding a tag broadens the visible set.
  // (AND would tighten it; users typically expect "I selected more, I see
  // more" for additive chip selection.)
  const filtered = useMemo(() => {
    const activeTags = [...tags, ...filter.tags];
    if (activeTags.length === 0) return scoped;
    const wanted = new Set(activeTags);
    return scoped.filter((idea) => (idea.tags || []).some((t) => wanted.has(t)));
  }, [scoped, filter.tags, tags]);

  const folderIdea = useMemo(
    () => (folderParam ? scoped.find((idea) => idea.id === folderParam) : undefined),
    [folderParam, scoped],
  );
  const activeFolderId = folderIdea?.id ?? null;
  const folderAncestors = useMemo(
    () => (activeFolderId ? ideaAncestors(activeFolderId, scoped) : []),
    [activeFolderId, scoped],
  );
  const childCounts = useMemo(() => childCountsByIdeaParent(scoped), [scoped]);
  const folderFiltered = useMemo(() => {
    const knownIds = new Set(filtered.map((idea) => idea.id));
    return filtered.filter((idea) => isDirectIdeaChildOf(idea, activeFolderId, knownIds));
  }, [filtered, activeFolderId]);

  const setFolder = useCallback(
    (nextFolderId: string | null) => {
      patchParams((p) => {
        if (nextFolderId) p.set("folder", nextFolderId);
        else p.delete("folder");
        p.delete("compose");
        p.delete("name");
        p.delete("parent");
      });
    },
    [patchParams],
  );

  // Mirror IdeasListView's needsReview count so the shared toolbar can
  // render the popover badge with real volume — scoped to the agent's
  // full idea set, not the currently-filtered slice.
  const needsReviewCount = useMemo(
    () =>
      ideas.filter((i) => {
        const t = i.tags ?? [];
        return (
          t.includes("skill") &&
          t.includes("candidate") &&
          !t.includes("promoted") &&
          !t.includes("rejected")
        );
      }).length,
    [ideas],
  );

  const scopeCounts = useMemo(() => {
    const counts = Object.fromEntries(IDEA_FILTER_VALUES.map((f) => [f, 0])) as Record<
      IdeasFilter,
      number
    >;
    for (const idea of ideas) {
      counts.all += 1;
      // inherited cross-cut
      if (idea.agent_id != null && idea.agent_id !== agentId) counts.inherited += 1;
      // scope-based
      if (idea.scope != null && IDEA_SCOPE_VALUES.includes(idea.scope)) {
        counts[visibilityBucket(idea.scope)] += 1;
      } else if (idea.agent_id === agentId) {
        counts.self += 1;
      } else if (idea.agent_id == null) {
        counts.global += 1;
      }
    }
    return counts;
  }, [ideas, agentId]);

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    if (view !== "graph") return;
    setGraphLoading(true);
    getIdeaGraph({ agent_id: scope === "entity" ? undefined : agentId, limit: 200 }, trustId)
      .then((d) => {
        setGraphData({
          nodes: ((d.nodes || []) as GraphNode[]).map((n) => ({
            ...n,
            tags: Array.isArray(n.tags) ? n.tags.filter(Boolean) : [],
          })),
          edges: (d.edges || []) as GraphEdge[],
        });
      })
      .catch(() => setGraphData({ nodes: [], edges: [] }))
      .finally(() => setGraphLoading(false));
  }, [view, agentId, scope, trustId]);

  // Cross-view filter projection — the list already honors scope + tag +
  // search against the full `ideas` store; the graph view receives the
  // same predicate as an id-set, then prunes its nodes and edges so the
  // dots on screen match the rows the user just filtered.
  const filteredGraph = useMemo(() => {
    const graphIdeas = activeFolderId ? folderFiltered : filtered;
    if (
      !activeFolderId &&
      filter.scope === "all" &&
      filter.tags.length === 0 &&
      !filter.search.trim()
    )
      return graphData;
    const allowed = new Set(graphIdeas.map((i) => i.id));
    const nodes = graphData.nodes.filter((n) => allowed.has(n.id));
    const allowedNodeIds = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter(
      (e) => allowedNodeIds.has(e.source) && allowedNodeIds.has(e.target),
    );
    return { nodes, edges };
  }, [
    graphData,
    filtered,
    folderFiltered,
    activeFolderId,
    filter.scope,
    filter.tags,
    filter.search,
  ]);

  // Graph → detail: push a new history entry so browser-back returns to
  // the graph view. Using `replace: true` here stranded the user on the
  // list view after drilling into a node — hitting back wiped the graph
  // mode entirely.
  const handleGraphSelect = (node: GraphNode | null) => {
    if (!node) return;
    goEntity(trustId, "ideas", node.id, {
      search: activeFolderId ? { folder: activeFolderId } : undefined,
    });
  };

  const currentListSearch = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("compose");
    params.delete("name");
    params.delete("parent");
    params.delete("folder");
    if (params.get("view") === "list") params.delete("view");
    const out: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      if (value) out[key] = value;
    }
    return out;
  }, [searchParams]);

  const openIdea = useCallback(
    (ideaId: string) => {
      goEntity(trustId, "ideas", ideaId, { search: currentListSearch() });
    },
    [goEntity, trustId, currentListSearch],
  );

  // "+ New idea" — compose mode is an explicit search param so the default
  // no-itemId state stays on the inline picker. Optional `name` survives
  // the navigate so a create-from-query click lands on a pre-filled canvas.
  // When the list is scoped to a folder idea, compose inherits that parent
  // so the new row lands exactly where the user started it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; parentIdeaId?: string | null }>).detail;
      const name = detail?.name;
      const parentIdeaId =
        detail?.parentIdeaId ??
        (scope === "entity" ? selectedId || trustRootIdea?.id || activeFolderId : activeFolderId);
      const search: Record<string, string> = { compose: "1" };
      if (name) search.name = name;
      if (parentIdeaId) {
        search.parent = parentIdeaId;
        if (scope !== "entity") search.folder = parentIdeaId;
      }
      goEntity(trustId, "ideas", undefined, { replace: true, search });
    };
    window.addEventListener("aeqi:new-idea", handler);
    return () => window.removeEventListener("aeqi:new-idea", handler);
  }, [trustId, goEntity, activeFolderId, scope, selectedId, trustRootIdea?.id]);

  const fireNewIdea = useCallback(
    (
      name?: string,
      parentIdeaId: string | null = scope === "entity"
        ? selectedId || trustRootIdea?.id || activeFolderId
        : activeFolderId,
    ) =>
      window.dispatchEvent(
        new CustomEvent("aeqi:new-idea", {
          detail: { ...(name ? { name } : {}), ...(parentIdeaId ? { parentIdeaId } : {}) },
        }),
      ),
    [activeFolderId, scope, selectedId, trustRootIdea?.id],
  );

  // Graph-mode keyboard: `n` / `l` while the canvas is focused so the user
  // never has to grab the mouse to flip back. Gated so it never fires
  // from inside any editable surface.
  useEffect(() => {
    if (view !== "graph") return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;
      if (inInput) return;
      if (e.key === "n") {
        e.preventDefault();
        e.stopImmediatePropagation();
        fireNewIdea();
      } else if (e.key === "l") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setView("list");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [view, setView, fireNewIdea]);

  if (view === "graph") {
    return (
      <Suspense fallback={viewFallback}>
        <IdeasGraphView
          agentId={agentId}
          graphData={graphData}
          filteredGraph={filteredGraph}
          graphLoading={graphLoading}
          filter={filter}
          scopeCounts={scopeCounts}
          selectedId={selectedId}
          view={view}
          onViewChange={setView}
          onNew={() => fireNewIdea()}
          onSelect={handleGraphSelect}
          onFilterChange={setFilter}
        />
      </Suspense>
    );
  }

  if (view === "table") {
    return (
      <Suspense fallback={viewFallback}>
        <IdeasTableView
          agentId={agentId}
          ideas={folderFiltered}
          filter={filter}
          scopeCounts={scopeCounts}
          needsReviewCount={needsReviewCount}
          onFilter={setFilter}
          view={view}
          onViewChange={setView}
          onNew={() => fireNewIdea()}
          onOpen={(id) =>
            goEntity(trustId, "ideas", id, {
              search: activeFolderId ? { folder: activeFolderId } : undefined,
            })
          }
        />
      </Suspense>
    );
  }

  const selected = selectedId ? ideas.find((i) => i.id === selectedId) : undefined;

  if (scope === "entity") {
    const presetName = composing ? (searchParams.get("name") ?? "") : "";
    const composeParentId = composing
      ? (searchParams.get("parent") ?? selectedId ?? trustRootIdea?.id ?? null)
      : null;
    return (
      <IdeasWorkspaceView
        agentId={agentId}
        ideas={ideas}
        filtered={filtered}
        rootIdea={trustRootIdea}
        selectedIdea={selected}
        composing={composing}
        presetName={presetName}
        composeParentId={composeParentId}
        trustName={trustName}
        filter={filter}
        scopeCounts={scopeCounts}
        needsReviewCount={needsReviewCount}
        view={view}
        onViewChange={setView}
        onFilter={setFilter}
        onNew={fireNewIdea}
        onSelect={openIdea}
        preparingRoot={ideasLoading || (!trustRootIdea && !rootCreateError)}
        rootError={rootCreateError}
      />
    );
  }

  if (selected || composing) {
    const presetName = composing ? (searchParams.get("name") ?? "") : "";
    const composeParentId = composing ? (searchParams.get("parent") ?? activeFolderId) : null;
    const backSearch = activeFolderId ? { folder: activeFolderId } : undefined;
    return (
      <Suspense fallback={viewFallback}>
        <IdeasCanvasView
          agentId={agentId}
          idea={selected}
          presetName={presetName}
          parentIdeaId={composeParentId}
          onBack={() => goEntity(trustId, "ideas", undefined, { search: backSearch })}
          onNew={() => fireNewIdea()}
        />
      </Suspense>
    );
  }

  if (ideasLoading) {
    return (
      <div
        className="ideas-list-body"
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Loading size="md" />
      </div>
    );
  }

  return (
    <IdeasListView
      agentId={agentId}
      ideas={ideas}
      scoped={scoped}
      filtered={folderFiltered}
      tagCounts={tagCounts}
      scopeCounts={scopeCounts}
      filter={filter}
      onFilter={setFilter}
      view={view}
      onViewChange={setView}
      folderId={activeFolderId}
      folderIdea={folderIdea ?? null}
      folderAncestors={folderAncestors}
      childCounts={childCounts}
      onFolderChange={setFolder}
    />
  );
}
