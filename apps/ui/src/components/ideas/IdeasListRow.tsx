import { type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, FolderOpen } from "lucide-react";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import { formatDateTime } from "@/lib/i18n";
import type { Idea, ScopeValue } from "@/lib/types";
import { Badge, Button, Icon, IconButton } from "../ui";
import {
  decisionLabel,
  ideaKindLabel,
  ideaPrimarySignalLabel,
  ideaScopeLabel,
  ideaSignalTone,
  ideaSourceClarityLabel,
  ideaSourceConfidenceLabel,
  ideaSourceDetailLabel,
  ideaSourceEvidenceLabel,
  ideaSourceLabel,
  ideaSourceOriginLabel,
  knowledgePackActionLabel,
  knowledgePackChecklistLabel,
  knowledgePackLabel,
  knowledgePackProgressLabel,
  knowledgePackReadinessLabel,
  knowledgePackStageLabel,
  memoryReadinessLabel,
  relationshipCountFor,
  relationshipSummaryLabelFor,
  tagCoverageLabel,
} from "./ideaRowSignals";
import { type FilterState, SCOPE_LABEL, highlightMatches, relativeTime, snippetFor } from "./types";

export interface IdeasListRowProps {
  agentId: string;
  childCounts: Map<string, number>;
  defaultExpanded: boolean;
  depth: number;
  filter: Pick<FilterState, "scope" | "search">;
  focusNext: () => void;
  focusPrevious: () => void;
  focusSearch: () => void;
  folderHref: (ideaId: string) => string;
  idea: Idea;
  index: number;
  isExpanded: boolean;
  nestedChildCount: number;
  onDropFiles: (event: DragEvent, parentIdeaId?: string | null) => void;
  onFolderChange?: (ideaId: string | null) => void;
  rowRef: (el: HTMLAnchorElement | null) => void;
  toggleIdea: (id: string, defaultExpanded: boolean) => void;
}

function ScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{SCOPE_LABEL[scope]}</span>;
}

function uniqueMetaChips(chips: Array<string | null>, primarySignal: string): string[] {
  const seen = new Set([primarySignal]);
  return chips.filter((chip): chip is string => {
    if (!chip || seen.has(chip)) return false;
    seen.add(chip);
    return true;
  });
}

export default function IdeasListRow({
  agentId,
  childCounts,
  defaultExpanded,
  depth,
  filter,
  focusNext,
  focusPrevious,
  focusSearch,
  folderHref,
  idea,
  index,
  isExpanded,
  nestedChildCount,
  onDropFiles,
  onFolderChange,
  rowRef,
  toggleIdea,
}: IdeasListRowProps) {
  const flatContent = blockTreeToPlainText(idea.content);
  const snippet = snippetFor(flatContent, filter.search);
  const wordCount = flatContent.trim().split(/\s+/).filter(Boolean).length;
  const ago = relativeTime(idea.created_at);
  const tags = idea.tags ?? [];
  const isCandidate =
    tags.includes("skill") &&
    tags.includes("candidate") &&
    !tags.includes("promoted") &&
    !tags.includes("rejected");
  const extraTags = Math.max(0, tags.length - 1);
  const resolvedScope: ScopeValue | null =
    idea.scope ?? (idea.agent_id == null ? "global" : idea.agent_id === agentId ? "self" : null);
  const showScopeChip =
    resolvedScope != null && resolvedScope !== "self" && filter.scope !== resolvedScope;
  const isInheritedRow = idea.agent_id != null && idea.agent_id !== agentId;
  const childCount = childCounts.get(idea.id) ?? nestedChildCount;
  const hasNestedChildren = nestedChildCount > 0;
  const hasChildren = childCount > 0;
  const relationshipCount = relationshipCountFor(flatContent, childCount, idea.properties);
  const decision = decisionLabel(tags);
  const knowledgePack = knowledgePackLabel(tags, wordCount, relationshipCount);
  const scopeLabel = ideaScopeLabel(idea, agentId);
  const sourceLabel = ideaSourceLabel(idea, agentId);
  const sourceDetailLabel = ideaSourceDetailLabel(idea);
  const sourceClarityLabel = ideaSourceClarityLabel(idea);
  const sourceEvidenceLabel = ideaSourceEvidenceLabel(idea);
  const sourceOriginLabel = ideaSourceOriginLabel(idea);
  const sourceConfidenceLabel = ideaSourceConfidenceLabel(idea);
  const packAction = knowledgePackActionLabel(
    tags,
    wordCount,
    relationshipCount,
    sourceDetailLabel !== null,
  );
  const packProgress = knowledgePackProgressLabel(
    tags,
    wordCount,
    relationshipCount,
    sourceDetailLabel !== null,
  );
  const packChecklist = knowledgePackChecklistLabel(
    tags,
    wordCount,
    relationshipCount,
    sourceDetailLabel !== null,
  );
  const packReadiness = knowledgePackReadinessLabel(
    tags,
    wordCount,
    relationshipCount,
    sourceDetailLabel !== null,
  );
  const packStage = knowledgePackStageLabel(
    tags,
    wordCount,
    relationshipCount,
    sourceDetailLabel !== null,
  );
  const rowReadiness = memoryReadinessLabel({
    tags,
    hasSourceDetail: sourceDetailLabel !== null,
    relationshipCount,
  });
  const relationshipLabel = relationshipSummaryLabelFor(flatContent, childCount, idea.properties);
  const signalTone = ideaSignalTone(tags, decision, knowledgePack, packAction);
  const signalLabel = ideaPrimarySignalLabel({
    decision,
    knowledgePack,
    packAction,
    relationshipCount,
    sourceLabel,
  });
  const metaChips = uniqueMetaChips(
    [
      ideaKindLabel(idea),
      `${scopeLabel} scope`,
      sourceClarityLabel,
      sourceEvidenceLabel,
      sourceOriginLabel,
      sourceConfidenceLabel,
      sourceLabel,
      tagCoverageLabel(tags),
      packReadiness ? null : rowReadiness,
      packStage,
      packReadiness,
      packReadiness ? null : packChecklist,
      packReadiness ? null : packProgress,
      packAction,
      relationshipLabel,
      decision,
      knowledgePack,
    ],
    signalLabel,
  );
  const depthClass = `ideas-list-row-depth-${Math.min(depth, 6)}`;

  return (
    <div
      className={`ideas-list-row-wrap ${depthClass}`}
      data-has-children={hasChildren ? "true" : "false"}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => onDropFiles(event, idea.id)}
    >
      {hasNestedChildren ? (
        <IconButton
          size="xs"
          className={`ideas-list-row-disclosure${isExpanded ? " is-open" : ""}`}
          aria-label={isExpanded ? "Collapse child ideas" : "Expand child ideas"}
          aria-expanded={isExpanded}
          onClick={() => toggleIdea(idea.id, defaultExpanded)}
        >
          <Icon icon={ChevronRight} size="xs" />
        </IconButton>
      ) : (
        <span className="ideas-list-row-disclosure-spacer" aria-hidden />
      )}
      <Link
        ref={rowRef}
        to={folderHref(idea.id)}
        className="ideas-list-row"
        data-testid="idea-row"
        data-idea-id={idea.id}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            focusNext();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (index === 0) focusSearch();
            else focusPrevious();
          } else if (e.key === "Escape") {
            e.preventDefault();
            focusSearch();
          } else if (e.key === "ArrowRight" && hasNestedChildren && !isExpanded) {
            e.preventDefault();
            toggleIdea(idea.id, defaultExpanded);
          } else if (e.key === "ArrowRight" && hasChildren && !hasNestedChildren) {
            e.preventDefault();
            onFolderChange?.(idea.id);
          } else if (e.key === "ArrowLeft" && hasNestedChildren && isExpanded) {
            e.preventDefault();
            toggleIdea(idea.id, defaultExpanded);
          }
        }}
      >
        <div className="ideas-list-row-head">
          <span className="ideas-list-row-signal" title={signalLabel}>
            <Badge variant={signalTone} size="sm" dot className="ideas-list-row-signal-badge">
              {signalLabel}
            </Badge>
          </span>
          <span className="ideas-list-row-name">
            {isInheritedRow && idea.agent_id && (
              <span className="scope-inherited-prefix">from @{idea.agent_id.slice(0, 8)}</span>
            )}
            {highlightMatches(idea.name, filter.search)}
          </span>
          {isCandidate && (
            <span className="ideas-list-row-candidate" title="Candidate skill - needs review">
              needs review
            </span>
          )}
          {showScopeChip && resolvedScope && <ScopeChip scope={resolvedScope} />}
          {extraTags > 0 && <span className="ideas-list-row-more">+{extraTags}</span>}
          {ago ? (
            <span
              className="ideas-list-row-time"
              title={idea.created_at ? formatDateTime(idea.created_at) : undefined}
            >
              {ago}
            </span>
          ) : wordCount > 0 ? (
            <span className="ideas-list-row-words" aria-hidden>
              {wordCount}w
            </span>
          ) : null}
        </div>
        {snippet && (
          <div className="ideas-list-row-snippet">{highlightMatches(snippet, filter.search)}</div>
        )}
        {metaChips.length > 0 && (
          <div className="ideas-list-row-meta" aria-label="Idea signals">
            {metaChips.map((chip) => (
              <span key={chip} className="ideas-list-row-meta-chip" title={chip}>
                {chip}
              </span>
            ))}
          </div>
        )}
      </Link>
      {hasChildren && onFolderChange && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ideas-list-row-folder"
          aria-label={`Open folder for ${idea.name}, ${childCount} child ideas`}
          onClick={() => onFolderChange(idea.id)}
          leadingIcon={<Icon icon={FolderOpen} size="xs" />}
        >
          <span className="ideas-list-row-child-count">{childCount}</span>
        </Button>
      )}
    </div>
  );
}
