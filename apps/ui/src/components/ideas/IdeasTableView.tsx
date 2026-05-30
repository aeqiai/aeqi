import { useMemo } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button, Icon, PrimitivePageHeader, Tooltip } from "../ui";
import IdeasToolbar from "./IdeasToolbar";
import { type IdeasView } from "./IdeasViewPopover";
import { blockTreeToPlainText } from "../editor/blockEditorContent";
import type { Idea } from "@/lib/types";
import { Badge } from "../ui";
import {
  decisionLabel,
  ideaPrimarySignalLabel,
  ideaScopeLabel,
  ideaSignalTone,
  ideaSourceConfidenceLabel,
  ideaSourceDetailLabel,
  ideaSourceEvidenceLabel,
  ideaSourceLabel,
  ideaSourceOriginLabel,
  isRelationshipPropertyKey,
  isSourceMetadataPropertyKey,
  knowledgePackChecklistLabel,
  knowledgePackActionLabel,
  knowledgePackLabel,
  knowledgePackProgressLabel,
  knowledgePackReadinessLabel,
  knowledgePackStageLabel,
  memoryReadinessLabel,
  relationshipCountFor,
  relationshipLabelFor,
} from "./ideaRowSignals";
import type { FilterState, IdeasFilter } from "./types";

/**
 * Tables-in-Ideas Phase 2 — Table view.
 *
 * Renders Ideas as rows with property keys promoted to columns. Property
 * keys are discovered from the visible set on every render — no schema,
 * no preferences storage. Source and relationship metadata render in
 * dedicated columns, while the most common remaining keys become property
 * columns. Click any row to open the Idea detail page.
 */
export interface IdeasTableViewProps {
  agentId: string;
  ideas: Idea[];
  filter: FilterState;
  scopeCounts: Record<IdeasFilter, number>;
  needsReviewCount: number;
  onFilter: (patch: Partial<FilterState>) => void;
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}

const MAX_PROPERTY_COLUMNS = 6;

function ideaProperties(idea: Idea): Record<string, unknown> {
  return (idea.properties ?? {}) as Record<string, unknown>;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export default function IdeasTableView({
  agentId,
  ideas,
  filter,
  scopeCounts,
  needsReviewCount,
  onFilter,
  view,
  onViewChange,
  onNew,
  onOpen,
}: IdeasTableViewProps) {
  const propertyColumns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const idea of ideas) {
      for (const key of Object.keys(ideaProperties(idea))) {
        if (isSourceMetadataPropertyKey(key) || isRelationshipPropertyKey(key)) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_PROPERTY_COLUMNS)
      .map(([key]) => key);
  }, [ideas]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const idea of ideas) {
      if (!idea.parent_idea_id) continue;
      counts.set(idea.parent_idea_id, (counts.get(idea.parent_idea_id) ?? 0) + 1);
    }
    return counts;
  }, [ideas]);

  return (
    <div className="ideas-list">
      <PrimitivePageHeader
        title="Ideas"
        children={
          <IdeasToolbar
            inline
            filter={filter}
            scopeCounts={scopeCounts}
            needsReviewCount={needsReviewCount}
            onFilter={onFilter}
            view={view}
            onViewChange={onViewChange}
          />
        }
        actions={
          <Tooltip content="New idea (N)">
            <Button
              variant="primary"
              size="md"
              onClick={onNew}
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              Idea
            </Button>
          </Tooltip>
        }
      />
      <div className="ideas-table-wrap" role="region" aria-label="Ideas table">
        <table className="ideas-table">
          <thead>
            <tr>
              <th scope="col" className="ideas-table-col-name">
                Name
              </th>
              <th scope="col" className="ideas-table-col-signal">
                Signal
              </th>
              <th scope="col" className="ideas-table-col-source">
                Source
              </th>
              <th scope="col" className="ideas-table-col-relationships">
                Relationships
              </th>
              {propertyColumns.map((key) => (
                <th key={key} scope="col">
                  {key}
                </th>
              ))}
              <th scope="col" className="ideas-table-col-tags">
                Tags
              </th>
            </tr>
          </thead>
          <tbody>
            {ideas.length === 0 ? (
              <tr>
                <td colSpan={5 + propertyColumns.length} className="ideas-table-empty">
                  <div className="ideas-table-empty-inner">
                    <Lightbulb
                      size={22}
                      strokeWidth={1.5}
                      className="ideas-table-empty-icon"
                      aria-hidden
                    />
                    <p className="ideas-table-empty-title">No ideas here yet</p>
                    <p className="ideas-table-empty-hint">
                      Capture decisions, mandates, and memories your agents will reuse.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              ideas.map((idea) => {
                const props = ideaProperties(idea);
                const tags = idea.tags ?? [];
                const hiddenTagCount = Math.max(0, tags.length - 3);
                const content = blockTreeToPlainText(idea.content);
                const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
                const childCount = childCounts.get(idea.id) ?? 0;
                const relationshipCount = relationshipCountFor(
                  content,
                  childCount,
                  idea.properties,
                );
                const decision = decisionLabel(tags);
                const knowledgePack = knowledgePackLabel(tags, wordCount, relationshipCount);
                const sourceDetail = ideaSourceDetailLabel(idea);
                const sourceEvidence = ideaSourceEvidenceLabel(idea);
                const sourceOrigin = ideaSourceOriginLabel(idea);
                const sourceConfidence = ideaSourceConfidenceLabel(idea);
                const sourcePrimary = sourceDetail ?? "No source detail";
                const sourceMeta = [
                  sourceEvidence,
                  ideaSourceLabel(idea, agentId),
                  `${ideaScopeLabel(idea, agentId)} scope`,
                  sourceOrigin,
                  sourceConfidence,
                ].filter(Boolean);
                const packAction = knowledgePackActionLabel(
                  tags,
                  wordCount,
                  relationshipCount,
                  sourceDetail !== null,
                );
                const packProgress = knowledgePackProgressLabel(
                  tags,
                  wordCount,
                  relationshipCount,
                  sourceDetail !== null,
                );
                const packChecklist = knowledgePackChecklistLabel(
                  tags,
                  wordCount,
                  relationshipCount,
                  sourceDetail !== null,
                );
                const packReadiness = knowledgePackReadinessLabel(
                  tags,
                  wordCount,
                  relationshipCount,
                  sourceDetail !== null,
                );
                const packStage = knowledgePackStageLabel(
                  tags,
                  wordCount,
                  relationshipCount,
                  sourceDetail !== null,
                );
                const rowReadiness = memoryReadinessLabel({
                  tags,
                  hasSourceDetail: sourceDetail !== null,
                  relationshipCount,
                });
                const signalLabel = ideaPrimarySignalLabel({
                  decision,
                  knowledgePack,
                  packAction,
                  relationshipCount,
                  sourceLabel: ideaSourceLabel(idea, agentId),
                });
                const signalTone = ideaSignalTone(tags, decision, knowledgePack, packAction);
                const relationshipLabel =
                  relationshipLabelFor(content, childCount, idea.properties) ?? "No linked memory";
                const relationshipTone = relationshipCount > 0 ? "info" : "warning";
                const relationshipPrimary =
                  relationshipCount > 0
                    ? `${relationshipCount} ${relationshipCount === 1 ? "relationship" : "relationships"}`
                    : "No relationships";
                const packDetail = packAction && packAction !== signalLabel ? packAction : null;
                const packProgressDetail =
                  packStage && packStage !== signalLabel && packStage !== packDetail
                    ? packStage
                    : packReadiness && packReadiness !== signalLabel && packReadiness !== packDetail
                      ? packReadiness
                      : packChecklist &&
                          packChecklist !== signalLabel &&
                          packChecklist !== packDetail
                        ? packChecklist
                        : packProgress &&
                            packProgress !== signalLabel &&
                            packProgress !== packDetail
                          ? packProgress
                          : null;
                return (
                  <tr
                    key={idea.id}
                    className="ideas-table-row"
                    onClick={() => onOpen(idea.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onOpen(idea.id);
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td className="ideas-table-cell-name">
                      <span className="ideas-table-name">{idea.name}</span>
                      <span className="ideas-table-snippet">{content.slice(0, 80)}</span>
                    </td>
                    <td className="ideas-table-cell-signal">
                      <span className="ideas-table-signal-stack">
                        <Badge variant={signalTone} size="sm" dot>
                          {signalLabel}
                        </Badge>
                        {packDetail && (
                          <span className="ideas-table-signal-detail">{packDetail}</span>
                        )}
                        {packProgressDetail && (
                          <span className="ideas-table-signal-detail">{packProgressDetail}</span>
                        )}
                        {!packReadiness && (
                          <span className="ideas-table-signal-detail">{rowReadiness}</span>
                        )}
                        <span className="ideas-table-signal-detail">{relationshipLabel}</span>
                      </span>
                    </td>
                    <td className="ideas-table-cell-source">
                      <span className="ideas-table-source-primary">
                        <Badge variant={sourceDetail ? "neutral" : "warning"} size="sm" dot>
                          {sourcePrimary}
                        </Badge>
                      </span>
                      <span className="ideas-table-source-meta">{sourceMeta.join(" / ")}</span>
                    </td>
                    <td className="ideas-table-cell-relationships">
                      <span className="ideas-table-relationships-primary">
                        <Badge variant={relationshipTone} size="sm" dot>
                          {relationshipPrimary}
                        </Badge>
                      </span>
                      <span className="ideas-table-relationships-meta">{relationshipLabel}</span>
                    </td>
                    {propertyColumns.map((key) => (
                      <td key={key} className="ideas-table-cell-prop">
                        {formatCell(props[key])}
                      </td>
                    ))}
                    <td className="ideas-table-cell-tags">
                      {tags.length === 0 ? (
                        <Badge variant="warning" size="sm" dot>
                          No tags
                        </Badge>
                      ) : (
                        <>
                          {tags.slice(0, 3).map((t) => (
                            <span key={t} className="ideas-tag-chip">
                              {t}
                            </span>
                          ))}
                          {hiddenTagCount > 0 && (
                            <Badge variant="muted" size="sm">
                              +{hiddenTagCount}
                            </Badge>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
