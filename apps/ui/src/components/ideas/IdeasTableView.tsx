import { useMemo } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button, Icon, Tooltip } from "../ui";
import IdeasToolbar from "./IdeasToolbar";
import { type IdeasView } from "./IdeasViewPopover";
import { blockTreeToPlainText } from "../editor/blockEditorContent";
import type { Idea } from "@/lib/types";
import type { FilterState, IdeasFilter } from "./types";

/**
 * Tables-in-Ideas Phase 2 — Table view.
 *
 * Renders Ideas as rows with property keys promoted to columns. Property
 * keys are discovered from the visible set on every render — no schema,
 * no preferences storage. The first three keys (in alphabetical order)
 * become columns alongside Name and #tags. Click any row to open the
 * Idea detail page.
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
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_PROPERTY_COLUMNS)
      .map(([key]) => key);
  }, [ideas]);

  return (
    <div className="ideas-list">
      <header className="ideas-page-header">
        <h1 className="ideas-page-title">Ideas</h1>
        <div className="ideas-page-header-actions">
          <Tooltip content="New idea (N)">
            <Button
              variant="primary"
              size="md"
              onClick={onNew}
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              New
            </Button>
          </Tooltip>
        </div>
      </header>
      <IdeasToolbar
        filter={filter}
        scopeCounts={scopeCounts}
        needsReviewCount={needsReviewCount}
        onFilter={onFilter}
        view={view}
        onViewChange={onViewChange}
      />
      <div className="ideas-table-wrap" role="region" aria-label="Ideas table">
        <table className="ideas-table">
          <thead>
            <tr>
              <th scope="col" className="ideas-table-col-name">
                Name
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
                <td colSpan={2 + propertyColumns.length} className="ideas-table-empty">
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
                      <span className="ideas-table-snippet">
                        {blockTreeToPlainText(idea.content).slice(0, 80)}
                      </span>
                    </td>
                    {propertyColumns.map((key) => (
                      <td key={key} className="ideas-table-cell-prop">
                        {formatCell(props[key])}
                      </td>
                    ))}
                    <td className="ideas-table-cell-tags">
                      {(idea.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="ideas-tag-chip">
                          {t}
                        </span>
                      ))}
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
