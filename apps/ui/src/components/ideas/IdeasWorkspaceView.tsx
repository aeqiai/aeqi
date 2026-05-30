import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, FileText, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import * as ideasApi from "@/api/ideas";
import { ImportMenu } from "@/components/blueprints/ImportMenu";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import IdeaCanvas, { type IdeaCanvasHandle } from "@/components/IdeaCanvas";
import { useNav } from "@/hooks/useNav";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";
import type { Idea, ScopeValue } from "@/lib/types";
import { useAgentIdeasCache } from "@/queries/ideas";
import { Badge, Button, Icon, IconButton, Tooltip, Loading } from "../ui";
import IdeaWorkspaceInspector from "./IdeaWorkspaceInspector";
import IdeasToolbar from "./IdeasToolbar";
import type { IdeasView } from "./IdeasViewPopover";
import { importIdeaProperties, importIdeaScope, isMarkdownFile } from "./ideaImport";
import {
  buildIdeaWikiStructure,
  buildWorkspaceTree,
  flattenIdeaTree,
  type IdeaTreeNode,
} from "./ideaTree";
import { type FilterState, type IdeasFilter, matchRank } from "./types";

export interface IdeasWorkspaceViewProps {
  agentId: string;
  ideas: Idea[];
  filtered: Idea[];
  rootIdea: Idea | null;
  selectedIdea?: Idea;
  composing: boolean;
  presetName: string;
  composeParentId: string | null;
  trustName: string;
  filter: FilterState;
  scopeCounts: Record<IdeasFilter, number>;
  needsReviewCount: number;
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  onFilter: (patch: Partial<FilterState>) => void;
  onNew: (name?: string, parentIdeaId?: string | null) => void;
  onSelect: (ideaId: string) => void;
  preparingRoot: boolean;
  rootError?: string | null;
}

function nestedCount(node: IdeaTreeNode): number {
  return node.children.reduce((total, child) => total + 1 + nestedCount(child), 0);
}

function descendantCount(id: string, ideas: Idea[]): number {
  const byParent = new Map<string, Idea[]>();
  for (const idea of ideas) {
    if (!idea.parent_idea_id) continue;
    const current = byParent.get(idea.parent_idea_id) ?? [];
    current.push(idea);
    byParent.set(idea.parent_idea_id, current);
  }
  const walk = (parentId: string): number =>
    (byParent.get(parentId) ?? []).reduce((total, child) => total + 1 + walk(child.id), 0);
  return walk(id);
}

function scopeValue(idea: Idea, agentId: string): ScopeValue {
  return idea.scope ?? (idea.agent_id == null || idea.agent_id !== agentId ? "global" : "self");
}

export default function IdeasWorkspaceView({
  agentId,
  ideas,
  filtered,
  rootIdea,
  selectedIdea,
  composing,
  presetName,
  composeParentId,
  trustName,
  filter,
  scopeCounts,
  needsReviewCount,
  view,
  onViewChange,
  onFilter,
  onNew,
  onSelect,
  preparingRoot,
  rootError,
}: IdeasWorkspaceViewProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<IdeaCanvasHandle>(null);
  const { goEntity, trustId } = useNav();
  const { patchIdea, removeIdea, invalidateIdeas } = useAgentIdeasCache(agentId, trustId);
  const [expandedIdeas, setExpandedIdeas] = useState<Record<string, boolean>>({});
  const [composeScope, setComposeScope] = useState<ScopeValue>("self");
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [canCommit, setCanCommit] = useState(false);
  const [inspectorBusy, setInspectorBusy] = useState(false);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const searchActive = filter.search.trim() !== "";
  const activeIdea = composing ? undefined : (selectedIdea ?? rootIdea ?? undefined);
  const activeParentId = composing ? composeParentId : (activeIdea?.id ?? rootIdea?.id ?? null);
  const rootSelected = Boolean(activeIdea && rootIdea && activeIdea.id === rootIdea.id);
  const activeScope = rootSelected
    ? "global"
    : activeIdea
      ? scopeValue(activeIdea, agentId)
      : composeScope;

  const ranked = useMemo(() => {
    if (searchActive) {
      return filtered
        .map((idea, index) => ({
          idea,
          index,
          rank: matchRank(
            { name: idea.name, content: blockTreeToPlainText(idea.content) },
            filter.search,
          ),
        }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((row) => row.idea);
    }
    if (filter.sort === "recent") {
      return [...filtered].sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      });
    }
    if (filter.sort === "alpha") {
      return [...filtered].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    return filtered;
  }, [filtered, filter.search, filter.sort, searchActive]);

  const treeRows = useMemo(() => {
    if (!rootIdea) return [];
    return flattenIdeaTree([buildWorkspaceTree(rootIdea, ranked)], expandedIdeas);
  }, [rootIdea, ranked, expandedIdeas]);
  const wikiStructure = useMemo(
    () => (rootIdea ? buildIdeaWikiStructure(rootIdea, ranked) : null),
    [rootIdea, ranked],
  );

  const selectedTreeId = activeIdea?.id ?? null;
  const noMatchName = filter.search.trim();
  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const idea of ideas) {
      for (const tag of idea.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [ideas]);

  const toggleIdea = (id: string, defaultExpanded: boolean) =>
    setExpandedIdeas((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultExpanded) }));

  const persistTags = useCallback(
    async (nextTags: string[]) => {
      if (!activeIdea) return;
      setInspectorError(null);
      try {
        await ideasApi.updateIdea(activeIdea.id, { tags: nextTags }, trustId);
        patchIdea(activeIdea.id, { tags: nextTags });
      } catch (error) {
        setInspectorError(error instanceof Error ? error.message : "Tag update failed");
      }
    },
    [activeIdea, patchIdea, trustId],
  );

  const handleScopeChange = useCallback(
    async (next: ScopeValue) => {
      if (composing || !activeIdea) {
        setComposeScope(next);
        return;
      }
      if (rootSelected) return;
      if (next === activeScope) return;
      setInspectorError(null);
      setInspectorBusy(true);
      try {
        await ideasApi.updateIdea(activeIdea.id, { scope: next }, trustId);
        patchIdea(activeIdea.id, { scope: next });
      } catch (error) {
        setInspectorError(error instanceof Error ? error.message : "Scope update failed");
      } finally {
        setInspectorBusy(false);
      }
    },
    [activeIdea, activeScope, composing, patchIdea, rootSelected, trustId],
  );

  const handleSave = useCallback(async () => {
    setInspectorError(null);
    setInspectorBusy(true);
    try {
      await canvasRef.current?.commit();
      setCanvasDirty(false);
    } catch (error) {
      setInspectorError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setInspectorBusy(false);
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (composing) {
      if (rootIdea) onSelect(rootIdea.id);
      return;
    }
    canvasRef.current?.revert();
    setCanvasDirty(false);
  }, [composing, onSelect, rootIdea]);

  const handleTrackAsQuest = useCallback(() => {
    if (!activeIdea) return;
    goEntity(trustId, "quests", "new", {
      replace: false,
      search: { fromIdea: activeIdea.id },
    });
  }, [activeIdea, goEntity, trustId]);

  const handleDelete = useCallback(async () => {
    if (!activeIdea || activeIdea.id === rootIdea?.id) return;
    setInspectorError(null);
    setInspectorBusy(true);
    try {
      const res = await ideasApi.deleteIdea(activeIdea.id, trustId);
      if (!res.ok && res.error === "in_use" && res.quest_ids?.length) {
        const ids = res.quest_ids;
        const formatted = ids.length === 1 ? `quest ${ids[0]}` : `${ids.length} quests`;
        setInspectorError(
          `In use by ${formatted}. Detach or delete first: ${ids.slice(0, 5).join(", ")}` +
            (ids.length > 5 ? " ..." : ""),
        );
        return;
      }
      if (!res.ok) {
        setInspectorError(res.error ?? "Delete failed");
        return;
      }
      removeIdea(activeIdea.id);
      if (rootIdea) onSelect(rootIdea.id);
    } catch (error) {
      setInspectorError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setInspectorBusy(false);
    }
  }, [activeIdea, onSelect, removeIdea, rootIdea, trustId]);

  const handleFileImport = useCallback(
    async (files: FileList | File[]) => {
      const parentIdeaId = activeIdea?.id ?? rootIdea?.id ?? null;
      if (!parentIdeaId) return;
      setInspectorError(null);
      const failures: string[] = [];
      for (const file of Array.from(files)) {
        try {
          if (isMarkdownFile(file)) {
            const raw = await file.text();
            const { body, data } = parseFrontmatter(raw);
            const name =
              (typeof data.title === "string" && data.title) ||
              file.name.replace(/\.(md|markdown)$/i, "") ||
              "Untitled";
            const summary = typeof data.summary === "string" ? data.summary.trim() : "";
            const content =
              summary && !body.startsWith(summary) ? `${summary}\n\n${body.trim()}` : body.trim();
            await ideasApi.storeIdea(
              {
                name,
                content,
                tags: asStringArray(data.tags),
                agent_id: agentId,
                scope: importIdeaScope(data) ?? activeScope,
                parent_idea_id: parentIdeaId,
                properties: importIdeaProperties(data, file.name),
              },
              trustId,
            );
          } else {
            const upload = await ideasApi.uploadFileToIdea(
              {
                agentId,
                file,
                scope: activeScope,
                parentIdeaId,
              },
              trustId,
            );
            if (!upload.ok) throw new Error(upload.error || "upload failed");
          }
        } catch (error) {
          failures.push(
            `${file.name}: ${error instanceof Error ? error.message : "import failed"}`,
          );
        }
      }
      await invalidateIdeas();
      if (failures.length > 0) setInspectorError(failures.join("; "));
    },
    [activeIdea?.id, activeScope, agentId, invalidateIdeas, rootIdea?.id, trustId],
  );

  return (
    <div
      className={`ideas-workspace${detailsCollapsed ? " ideas-workspace--details-collapsed" : ""}`}
    >
      <header className="ideas-workspace-head">
        <h1>Ideas</h1>
        <IdeasToolbar
          filter={filter}
          scopeCounts={scopeCounts}
          needsReviewCount={needsReviewCount}
          onFilter={onFilter}
          view={view}
          onViewChange={onViewChange}
          searchInputRef={searchRef}
          showKbdHint
          inline
          onSearchKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const first = treeRows.find((row) => row.node.idea.id !== rootIdea?.id)?.node.idea;
            if (first) onSelect(first.id);
            else if (noMatchName) onNew(noMatchName, rootIdea?.id ?? null);
          }}
        />
        <div className="ideas-workspace-head-actions">
          <Tooltip content={activeIdea ? `New under ${activeIdea.name}` : "New idea"}>
            <Button
              variant="primary"
              size="md"
              onClick={() => onNew(undefined, activeParentId)}
              leadingIcon={<Icon icon={Plus} size="sm" />}
              disabled={!rootIdea}
            >
              New
            </Button>
          </Tooltip>
        </div>
      </header>
      {rootError && (
        <div className="bp-error ideas-workspace-error" role="alert">
          {rootError}
        </div>
      )}
      <div className="ideas-workspace-layout">
        <aside className="ideas-workspace-tree" aria-label={`${trustName} idea explorer`}>
          <div className="ideas-workspace-tree-head">
            <span>Explorer</span>
            <small>{Math.max(0, ideas.length - (rootIdea ? 1 : 0))} ideas</small>
          </div>
          {wikiStructure && (
            <div className="ideas-workspace-structure" aria-label="Wiki structure">
              <div className="ideas-workspace-structure-status">
                <Badge variant={wikiStructure.tone} size="sm" dot>
                  {wikiStructure.label}
                </Badge>
                <span>{wikiStructure.indexPages} index pages</span>
              </div>
              <dl className="ideas-workspace-structure-metrics">
                <div>
                  <dt>Depth</dt>
                  <dd>{wikiStructure.maxDepth}</dd>
                </div>
                <div>
                  <dt>Root</dt>
                  <dd>{wikiStructure.rootChildren}</dd>
                </div>
                <div>
                  <dt>Leaves</dt>
                  <dd>{wikiStructure.leafPages}</dd>
                </div>
                <div>
                  <dt>Unfiled</dt>
                  <dd>{wikiStructure.unfiled}</dd>
                </div>
              </dl>
              {wikiStructure.clusters.length > 0 && (
                <div className="ideas-workspace-structure-clusters" aria-label="Wiki clusters">
                  {wikiStructure.clusters.map((cluster) => (
                    <button
                      key={cluster.tag}
                      type="button"
                      onClick={() => onFilter({ tags: [cluster.tag] })}
                      title={`${cluster.count} root pages tagged ${cluster.tag}`}
                    >
                      #{cluster.tag}
                      <small>{cluster.count}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {preparingRoot ? (
            <div className="ideas-workspace-loading">
              <Loading size="sm" />
              <span>Preparing root</span>
            </div>
          ) : treeRows.length > 0 ? (
            <div className="ideas-workspace-tree-list" role="tree">
              {treeRows.map(({ node, depth }) => {
                const idea = node.idea;
                const childTotal = nestedCount(node);
                const defaultExpanded = depth <= 1;
                const expanded = expandedIdeas[idea.id] ?? defaultExpanded;
                const isSelected = selectedTreeId === idea.id && !composing;
                return (
                  <div
                    key={idea.id}
                    className="ideas-workspace-tree-row"
                    style={{ "--idea-tree-depth": depth } as CSSProperties}
                    role="treeitem"
                    aria-selected={isSelected}
                    aria-expanded={node.children.length > 0 ? expanded : undefined}
                  >
                    {node.children.length > 0 ? (
                      <button
                        type="button"
                        className={`ideas-workspace-tree-toggle${expanded ? " is-open" : ""}`}
                        aria-label={expanded ? "Collapse idea" : "Expand idea"}
                        onClick={() => toggleIdea(idea.id, defaultExpanded)}
                      >
                        <ChevronRight size={13} strokeWidth={1.9} />
                      </button>
                    ) : (
                      <span className="ideas-workspace-tree-toggle-spacer" aria-hidden />
                    )}
                    <button
                      type="button"
                      className="ideas-workspace-tree-item"
                      onClick={() => onSelect(idea.id)}
                    >
                      <FileText size={13} strokeWidth={1.7} />
                      <span>{idea.name || "Untitled"}</span>
                      {childTotal > 0 && <small>{childTotal}</small>}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ideas-workspace-empty">No ideas match these filters.</div>
          )}
        </aside>

        <main className="ideas-workspace-document" aria-label="Idea">
          {preparingRoot ? (
            <div className="ideas-workspace-loading ideas-workspace-loading--document">
              <Loading size="md" />
            </div>
          ) : rootIdea ? (
            <IdeaCanvas
              ref={canvasRef}
              key={composing ? `compose:${activeParentId ?? "root"}` : activeIdea?.id}
              agentId={agentId}
              idea={activeIdea}
              initialName={presetName}
              parentIdeaId={activeParentId}
              onBack={() => onSelect(rootIdea.id)}
              onNew={() => onNew(undefined, activeIdea?.id ?? rootIdea.id)}
              onPersisted={onSelect}
              embedded
              hideMetaStrip
              contentHeaderSlot={
                <div className="ideas-workspace-document-head">
                  <div className="ideas-workspace-document-title">Idea</div>
                  <div className="ideas-workspace-document-actions">
                    {canvasDirty && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleCancel}
                          disabled={inspectorBusy}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => void handleSave()}
                          disabled={!canCommit}
                          loading={inspectorBusy}
                        >
                          Save
                        </Button>
                      </>
                    )}
                    <Tooltip content={detailsCollapsed ? "Show details" : "Hide details"} portal>
                      <IconButton
                        variant="bordered"
                        size="md"
                        className="ideas-workspace-document-toggle"
                        aria-label={detailsCollapsed ? "Show details" : "Hide details"}
                        onClick={() => setDetailsCollapsed((collapsed) => !collapsed)}
                      >
                        {detailsCollapsed ? (
                          <PanelRightOpen size={13} strokeWidth={1.7} />
                        ) : (
                          <PanelRightClose size={13} strokeWidth={1.7} />
                        )}
                      </IconButton>
                    </Tooltip>
                  </div>
                </div>
              }
              composeScope={composeScope}
              onDirtyChange={setCanvasDirty}
              onCanCommitChange={setCanCommit}
              conversationActivity="combined"
            />
          ) : (
            <div className="empty-state-hero muted">
              <span className="empty-state-hero-eyebrow">workspace unavailable</span>
              <h3 className="empty-state-hero-title">The TRUST root could not be prepared.</h3>
              <p className="empty-state-hero-body">{rootError ?? "Try reloading the page."}</p>
            </div>
          )}
        </main>

        {!detailsCollapsed && (
          <aside className="ideas-workspace-inspector" aria-label="Details">
            {activeIdea || composing ? (
              <IdeaWorkspaceInspector
                idea={activeIdea}
                agentId={agentId}
                scopedEntity={trustId}
                composing={composing}
                childCount={activeIdea ? descendantCount(activeIdea.id, ideas) : 0}
                scope={activeScope}
                tagSuggestions={tagSuggestions}
                dirty={canvasDirty}
                canCommit={canCommit}
                busy={inspectorBusy}
                error={inspectorError}
                canTrack={Boolean(activeIdea && !rootSelected)}
                canDelete={Boolean(activeIdea && activeIdea.id !== rootIdea?.id)}
                scopeLocked={rootSelected}
                importMenu={
                  <ImportMenu
                    trustId={trustId}
                    parts={["ideas"]}
                    blueprintTitle="Import child ideas from a Blueprint"
                    accept="*/*"
                    fileLabel="From files"
                    onMarkdownPicked={(files) => void handleFileImport(files)}
                    onBlueprintSpawned={() => void invalidateIdeas()}
                  />
                }
                onScopeChange={(next) => void handleScopeChange(next)}
                onTagAdd={(tag) => {
                  if (!activeIdea) return;
                  const key = tag.toLowerCase();
                  if ((activeIdea.tags ?? []).some((item) => item.toLowerCase() === key)) return;
                  void persistTags([...(activeIdea.tags ?? []), key]);
                }}
                onTagRemove={(tag) => {
                  if (!activeIdea) return;
                  void persistTags((activeIdea.tags ?? []).filter((item) => item !== tag));
                }}
                onTrackAsQuest={handleTrackAsQuest}
                onDelete={() => void handleDelete()}
                onSave={() => void handleSave()}
                onCancel={handleCancel}
              />
            ) : (
              <div className="ideas-workspace-inspector-empty">
                <strong>{composing ? "New idea" : trustName}</strong>
                <span>{composing ? "Save it to attach it to the tree." : "Select an idea."}</span>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
