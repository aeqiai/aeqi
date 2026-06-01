import type { CSSProperties } from "react";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { Loading } from "../ui";
import type { IdeaTreeRow } from "./ideaTree";

interface IdeasWorkspaceExplorerProps {
  trustName: string;
  preparingRoot: boolean;
  treeRows: IdeaTreeRow[];
  expandedIdeas: Record<string, boolean>;
  selectedTreeId: string | null;
  composing: boolean;
  onSelect: (ideaId: string) => void;
  onToggleIdea: (id: string, defaultExpanded: boolean) => void;
}

export default function IdeasWorkspaceExplorer({
  trustName,
  preparingRoot,
  treeRows,
  expandedIdeas,
  selectedTreeId,
  composing,
  onSelect,
  onToggleIdea,
}: IdeasWorkspaceExplorerProps) {
  return (
    <aside className="ideas-workspace-tree" aria-label={`${trustName} idea explorer`}>
      {preparingRoot ? (
        <div className="ideas-workspace-loading">
          <Loading size="sm" />
          <span>Preparing root</span>
        </div>
      ) : treeRows.length > 0 ? (
        <div className="ideas-workspace-tree-list" role="tree">
          {treeRows.map(({ node, depth }) => {
            const idea = node.idea;
            const childCount = node.children.length;
            const defaultExpanded = depth <= 1;
            const expanded = expandedIdeas[idea.id] ?? defaultExpanded;
            const isSelected = selectedTreeId === idea.id && !composing;
            return (
              <div
                key={idea.id}
                className={`ideas-workspace-tree-row${depth === 0 ? " is-root" : ""}${
                  node.children.length > 0 ? " has-children" : ""
                }`}
                style={{ "--idea-tree-depth": depth } as CSSProperties}
                role="treeitem"
                aria-selected={isSelected}
                aria-expanded={childCount > 0 ? expanded : undefined}
              >
                <button
                  type="button"
                  className="ideas-workspace-tree-item"
                  onClick={() => onSelect(idea.id)}
                >
                  {node.children.length > 0 ? (
                    <Folder size={13} strokeWidth={1.7} />
                  ) : (
                    <FileText size={13} strokeWidth={1.7} />
                  )}
                  <span>{idea.name || "Untitled"}</span>
                  {childCount > 0 && (
                    <small aria-label={`${childCount} child ideas`}>{childCount}</small>
                  )}
                </button>
                {childCount > 0 ? (
                  <button
                    type="button"
                    className={`ideas-workspace-tree-toggle${expanded ? " is-open" : ""}`}
                    aria-label={expanded ? "Collapse idea" : "Expand idea"}
                    onClick={() => onToggleIdea(idea.id, defaultExpanded)}
                  >
                    <ChevronRight size={13} strokeWidth={1.9} />
                  </button>
                ) : (
                  <span className="ideas-workspace-tree-toggle-spacer" aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ideas-workspace-empty">No ideas match these filters.</div>
      )}
    </aside>
  );
}
