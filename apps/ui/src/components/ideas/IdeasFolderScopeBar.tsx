import { ArrowUp } from "lucide-react";
import type { Idea } from "@/lib/types";
import { Button, Icon, IconButton } from "../ui";

export interface IdeasFolderScopeBarProps {
  folderIdea: Idea | null;
  folderAncestors: Idea[];
  childCounts: Map<string, number>;
  onFolderChange?: (ideaId: string | null) => void;
}

export default function IdeasFolderScopeBar({
  folderIdea,
  folderAncestors,
  childCounts,
  onFolderChange,
}: IdeasFolderScopeBarProps) {
  if (!folderIdea && childCounts.size === 0) return null;

  return (
    <div className="ideas-folder-scopebar" aria-label="Idea folder scope">
      <div className="ideas-folder-breadcrumb">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ideas-folder-crumb"
          onClick={() => onFolderChange?.(null)}
        >
          Ideas
        </Button>
        {folderAncestors.map((ancestor) => (
          <Button
            key={ancestor.id}
            type="button"
            variant="ghost"
            size="sm"
            className="ideas-folder-crumb"
            onClick={() => onFolderChange?.(ancestor.id)}
          >
            {ancestor.name}
          </Button>
        ))}
        {folderIdea && <span className="ideas-folder-current">{folderIdea.name}</span>}
      </div>
      <div className="ideas-folder-actions">
        {folderIdea && (
          <>
            <span className="ideas-folder-count">
              {childCounts.get(folderIdea.id) ?? 0} children
            </span>
            <IconButton
              size="xs"
              aria-label="Up"
              onClick={() => onFolderChange?.(folderIdea.parent_idea_id ?? null)}
            >
              <Icon icon={ArrowUp} size="xs" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
