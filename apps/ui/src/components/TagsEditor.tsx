import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Chip-row tag editor with autocomplete.
 *
 * Renders every tag as a chip; typed tags can be removed, hashtag-extracted
 * tags are read-only (live in the body). The `+ tag` affordance flips to an
 * inline input on click. Enter commits (or selects a suggestion), Esc cancels,
 * arrow keys navigate the suggestion list, Backspace on an empty input
 * removes the most recent typed tag.
 *
 * `suggestions` is the full set of tags seen elsewhere in the agent's ideas.
 * We filter by prefix match and never show tags already on this idea.
 */
export default function TagsEditor({
  tags,
  typed,
  suggestions = [],
  onAdd,
  onRemove,
}: {
  tags: string[];
  typed: string[];
  suggestions?: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [hoverIdx, setHoverIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const tagsLower = useMemo(() => new Set(tags.map((t) => t.toLowerCase())), [tags]);

  const matches = useMemo(() => {
    const q = draft.trim().replace(/^#/, "").toLowerCase();
    const pool = suggestions.filter((s) => !tagsLower.has(s.toLowerCase()));
    if (!q) return pool.slice(0, 6);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const s of pool) {
      const l = s.toLowerCase();
      if (l === q) continue;
      if (l.startsWith(q)) starts.push(s);
      else if (l.includes(q)) contains.push(s);
    }
    return [...starts, ...contains].slice(0, 6);
  }, [draft, suggestions, tagsLower]);

  useEffect(() => {
    setHoverIdx(0);
  }, [draft]);

  const commit = (raw?: string) => {
    const source = (raw ?? draft).trim().replace(/^#/, "").toLowerCase();
    setDraft("");
    setAdding(false);
    if (!source) return;
    if (tagsLower.has(source)) return;
    onAdd(source);
  };

  const typedSet = new Set(typed.map((t) => t.toLowerCase()));
  const showSuggestions = adding && matches.length > 0;

  return (
    <div className="ideas-tags-editor">
      {tags.map((t) => {
        const removable = typedSet.has(t.toLowerCase());
        return (
          <span key={t} className={`ideas-tag-chip${removable ? " removable" : ""}`}>
            #{t}
            {removable && (
              <button
                type="button"
                className="ideas-tag-chip-x"
                onClick={() => onRemove(t)}
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      {adding ? (
        <span className="ideas-tag-input-wrap">
          <input
            ref={inputRef}
            className="ideas-tag-input"
            value={draft}
            placeholder="tag"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (showSuggestions && matches[hoverIdx]) {
                  commit(matches[hoverIdx]);
                } else {
                  commit();
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft("");
                setAdding(false);
              } else if (e.key === "Backspace" && draft === "" && typed.length > 0) {
                e.preventDefault();
                onRemove(typed[typed.length - 1]);
              } else if (e.key === "," || e.key === " ") {
                if (draft.trim()) {
                  e.preventDefault();
                  commit();
                  setAdding(true);
                }
              } else if (e.key === "ArrowDown" && showSuggestions) {
                e.preventDefault();
                setHoverIdx((i) => (i + 1) % matches.length);
              } else if (e.key === "ArrowUp" && showSuggestions) {
                e.preventDefault();
                setHoverIdx((i) => (i - 1 + matches.length) % matches.length);
              } else if (e.key === "Tab" && showSuggestions && matches[hoverIdx]) {
                e.preventDefault();
                commit(matches[hoverIdx]);
              }
            }}
            onBlur={() => {
              // Defer so a mouse-click on a suggestion can commit first.
              requestAnimationFrame(() => {
                if (document.activeElement !== inputRef.current) commit();
              });
            }}
          />
          {showSuggestions && (
            <span className="ideas-tag-suggest" role="listbox">
              {matches.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={i === hoverIdx}
                  className={`ideas-tag-suggest-item${i === hoverIdx ? " active" : ""}`}
                  // Use mousedown so the click lands before the input's blur fires.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(m);
                  }}
                  onMouseEnter={() => setHoverIdx(i)}
                >
                  #{m}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          className="ideas-tag-add"
          onClick={() => setAdding(true)}
          aria-label="Add tag"
        >
          + tag
        </button>
      )}
    </div>
  );
}
