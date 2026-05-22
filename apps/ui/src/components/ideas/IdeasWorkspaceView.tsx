import { useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import IdeaCanvas from "@/components/IdeaCanvas";
import { formatDateTime } from "@/lib/i18n";
import type { Idea } from "@/lib/types";
import { Button, Icon, Tooltip, Loading } from "../ui";
import IdeasToolbar from "./IdeasToolbar";
import type { IdeasView } from "./IdeasViewPopover";
import { buildWorkspaceTree, flattenIdeaTree, type IdeaTreeNode } from "./ideaTree";
import { type FilterState, type IdeasFilter, SCOPE_LABEL, matchRank, relativeTime } from "./types";

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

function scopeLabel(idea: Idea, agentId: string): string {
  const resolved =
    idea.scope ?? (idea.agent_id == null ? "global" : idea.agent_id === agentId ? "self" : null);
  if (!resolved) return "Inherited";
  return SCOPE_LABEL[resolved] ?? resolved;
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
  const [expandedIdeas, setExpandedIdeas] = useState<Record<string, boolean>>({});
  const searchActive = filter.search.trim() !== "";
  const activeIdea = composing ? undefined : (selectedIdea ?? rootIdea ?? undefined);
  const activeParentId = composing ? composeParentId : (activeIdea?.id ?? rootIdea?.id ?? null);

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

  const selectedTreeId = activeIdea?.id ?? null;
  const noMatchName = filter.search.trim();

  const toggleIdea = (id: string, defaultExpanded: boolean) =>
    setExpandedIdeas((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultExpanded) }));

  return (
    <div className="ideas-workspace">
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
        <aside className="ideas-workspace-tree" aria-label={`${trustName} idea tree`}>
          <div className="ideas-workspace-tree-head">
            <span>Workspace</span>
            <small>{Math.max(0, ideas.length - (rootIdea ? 1 : 0))} ideas</small>
          </div>
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

        <main className="ideas-workspace-document" aria-label="Idea document">
          {preparingRoot ? (
            <div className="ideas-workspace-loading ideas-workspace-loading--document">
              <Loading size="md" />
            </div>
          ) : rootIdea ? (
            <IdeaCanvas
              key={composing ? `compose:${activeParentId ?? "root"}` : activeIdea?.id}
              agentId={agentId}
              idea={activeIdea}
              initialName={presetName}
              parentIdeaId={activeParentId}
              onBack={() => onSelect(rootIdea.id)}
              onNew={() => onNew(undefined, activeIdea?.id ?? rootIdea.id)}
              onPersisted={onSelect}
            />
          ) : (
            <div className="empty-state-hero muted">
              <span className="empty-state-hero-eyebrow">workspace unavailable</span>
              <h3 className="empty-state-hero-title">The TRUST root could not be prepared.</h3>
              <p className="empty-state-hero-body">{rootError ?? "Try reloading the page."}</p>
            </div>
          )}
        </main>

        <aside className="ideas-workspace-inspector" aria-label="Idea details">
          {activeIdea ? (
            <IdeaInspector
              idea={activeIdea}
              agentId={agentId}
              childCount={descendantCount(activeIdea.id, ideas)}
            />
          ) : (
            <div className="ideas-workspace-inspector-empty">
              <strong>{composing ? "New idea" : trustName}</strong>
              <span>{composing ? "Save it to attach it to the tree." : "Select an idea."}</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function IdeaInspector({
  idea,
  agentId,
  childCount,
}: {
  idea: Idea;
  agentId: string;
  childCount: number;
}) {
  const words = blockTreeToPlainText(idea.content).trim().split(/\s+/).filter(Boolean).length;
  const updated = relativeTime(idea.created_at);
  return (
    <>
      <div className="ideas-workspace-inspector-head">
        <span>Details</span>
        <small title={idea.created_at ? formatDateTime(idea.created_at) : undefined}>
          {updated || "now"}
        </small>
      </div>
      <dl className="quest-detail-meta ideas-workspace-meta">
        <div className="quest-detail-meta-row">
          <dt>scope</dt>
          <dd>
            <span className="quest-detail-value">{scopeLabel(idea, agentId)}</span>
          </dd>
        </div>
        <div className="quest-detail-meta-row">
          <dt>children</dt>
          <dd>{childCount}</dd>
        </div>
        <div className="quest-detail-meta-row">
          <dt>words</dt>
          <dd>{words}</dd>
        </div>
        <div className="quest-detail-meta-row">
          <dt>kind</dt>
          <dd>{idea.kind ?? "note"}</dd>
        </div>
      </dl>
      <div className="quest-detail-context ideas-workspace-tags">
        <h2>Tags</h2>
        {idea.tags && idea.tags.length > 0 ? (
          <div className="ideas-list-tags">
            {idea.tags.map((tag) => (
              <span key={tag} className="ideas-tag-chip">
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <p>No tags yet.</p>
        )}
      </div>
    </>
  );
}
