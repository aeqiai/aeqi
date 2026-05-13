import type { FilterState } from "./types";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface IdeasListFilterChipsProps {
  activeChips: FilterChip[];
  clearAll: () => void;
  tagCounts: [string, number][];
  visibleTagCount: number;
  hiddenTagCount: number;
  tagsExpanded: boolean;
  setTagsExpanded: (b: boolean) => void;
  filter: FilterState;
  toggleTag: (t: string) => void;
  tagChipLimit: number;
}

export default function IdeasListFilterChips({
  activeChips,
  clearAll,
  tagCounts,
  visibleTagCount,
  hiddenTagCount,
  tagsExpanded,
  setTagsExpanded,
  filter,
  toggleTag,
  tagChipLimit,
}: IdeasListFilterChipsProps) {
  return (
    <div className="ideas-tags-strip">
      {activeChips.length > 0 && (
        <div className="ideas-list-chips" role="list" aria-label="Active filters">
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              role="listitem"
              className="ideas-list-chip"
              onClick={c.onRemove}
              title={`Remove ${c.label}`}
            >
              <span className="ideas-list-chip-label">{c.label}</span>
              <span className="ideas-list-chip-x" aria-hidden>
                ×
              </span>
            </button>
          ))}
          <button type="button" className="ideas-list-chip-clear" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}
      {tagCounts.length > 0 && (
        <div className="ideas-list-tags">
          {tagCounts.slice(0, visibleTagCount).map(([t, n]) => {
            const isActive = filter.tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={isActive}
                className={`ideas-tag-chip${isActive ? " active" : ""}`}
                onClick={() => toggleTag(t)}
              >
                #{t}
                <span className="ideas-tag-chip-count">{n}</span>
              </button>
            );
          })}
          {hiddenTagCount > 0 && (
            <button
              type="button"
              className="ideas-list-tag-more"
              onClick={() => setTagsExpanded(true)}
              aria-label={`Show ${hiddenTagCount} more tags`}
            >
              +{hiddenTagCount} more
            </button>
          )}
          {tagsExpanded && tagCounts.length > tagChipLimit && (
            <button
              type="button"
              className="ideas-list-tag-more"
              onClick={() => setTagsExpanded(false)}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
