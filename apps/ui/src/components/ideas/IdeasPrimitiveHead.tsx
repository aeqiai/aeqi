import { type ReactNode } from "react";
import type { IdeasFilter } from "./types";

export function ViewToggle({
  view,
  onChange,
}: {
  view: "list" | "graph";
  onChange: (next: "list" | "graph") => void;
}) {
  return (
    <div className="primitive-view-toggle" role="tablist" aria-label="View mode">
      <button
        type="button"
        role="tab"
        aria-selected={view === "list"}
        className={`primitive-view-toggle-btn${view === "list" ? " active" : ""}`}
        onClick={() => onChange("list")}
        title="List view (L)"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2 3h8M2 6h8M2 9h8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        list
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "graph"}
        className={`primitive-view-toggle-btn${view === "graph" ? " active" : ""}`}
        onClick={() => onChange("graph")}
        title="Graph view (G)"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden
        >
          <circle cx="3" cy="3" r="1.3" />
          <circle cx="9" cy="3" r="1.3" />
          <circle cx="6" cy="9" r="1.3" />
          <path d="M3 3 L9 3 M3 3 L6 9 M9 3 L6 9" strokeLinecap="round" />
        </svg>
        graph
      </button>
    </div>
  );
}

/**
 * Shared primitive-head for the Ideas surface. Exo 2 "Ideas" title
 * (becomes a back-link to the list when an item is open) + scope
 * tabs on the left; count + view toggle + `+ new idea` on the right.
 * Lives above both list and graph views so switching between them
 * doesn't feel like leaving the primitive.
 */
export function IdeasPrimitiveHead({
  countLabel,
  view,
  onViewChange,
  onNew,
  scopeControl,
  onBack,
}: {
  countLabel?: string;
  view: "list" | "graph";
  onViewChange: (next: "list" | "graph") => void;
  onNew: () => void;
  scopeControl?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="primitive-head">
      <div className="primitive-head-lead">
        {onBack ? (
          <h2 className="primitive-head-heading">
            <button
              type="button"
              className="primitive-head-heading-back"
              onClick={onBack}
              title="Back to ideas"
              aria-label="Back to ideas"
            >
              <span className="primitive-head-heading-back-chevron" aria-hidden>
                ←
              </span>
              Ideas
            </button>
          </h2>
        ) : (
          <h2 className="primitive-head-heading">Ideas</h2>
        )}
        {scopeControl}
      </div>
      <div className="primitive-head-actions">
        {countLabel && <span className="primitive-head-meta">{countLabel}</span>}
        <ViewToggle view={view} onChange={onViewChange} />
        <button type="button" className="primitive-head-new" onClick={onNew} title="New idea (N)">
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 2.5v7M2.5 6h7" />
          </svg>
          new idea
        </button>
      </div>
    </div>
  );
}

/**
 * Slim detail back-bar — the primitive-head's younger sibling. Mounted
 * above IdeaCanvas so the user always has a one-click return to the
 * list. Uses the same 52px band + Exo 2 treatment so switching
 * between list and detail feels continuous; drops the scope tabs and
 * view toggle because they have no meaning inside a single idea.
 */
export function IdeasDetailBackBar({
  onBack,
  onNew,
  showNew,
}: {
  onBack: () => void;
  onNew: () => void;
  showNew: boolean;
}) {
  return (
    <div className="primitive-head primitive-head--detail">
      <div className="primitive-head-lead">
        <h2 className="primitive-head-heading">
          <button
            type="button"
            className="primitive-head-heading-back"
            onClick={onBack}
            title="Back to ideas"
            aria-label="Back to ideas"
          >
            <span className="primitive-head-heading-back-chevron" aria-hidden>
              ←
            </span>
            Ideas
          </button>
        </h2>
      </div>
      {showNew && (
        <div className="primitive-head-actions">
          <button type="button" className="primitive-head-new" onClick={onNew} title="New idea (N)">
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            new idea
          </button>
        </div>
      )}
    </div>
  );
}

export function IdeasScopeTabs({
  scope,
  scopes,
  counts,
  onChange,
}: {
  scope: IdeasFilter;
  scopes: IdeasFilter[];
  counts: Record<IdeasFilter, number>;
  onChange: (next: IdeasFilter) => void;
}) {
  return (
    <div className="primitive-scope-tabs" role="tablist" aria-label="Scope">
      {scopes.map((s) => {
        const isActive = scope === s;
        const isEmpty = counts[s] === 0;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`primitive-scope-tab${isActive ? " active" : ""}${isEmpty && !isActive ? " empty" : ""}`}
            onClick={() => onChange(s)}
          >
            {s}
            <span className="primitive-scope-tab-count">{counts[s]}</span>
          </button>
        );
      })}
    </div>
  );
}
