import { useEffect, useRef, useState } from "react";

/**
 * Chip-row tag editor. Renders every tag as a chip; typed tags can be
 * removed, hashtag-extracted tags are read-only (live in the body).
 *
 * The `+ tag` affordance flips to an inline input on click. Enter commits,
 * Esc/blur cancels. Backspace on an empty input removes the most recent
 * typed tag — matching the standard chip-list interaction.
 */
export default function TagsEditor({
  tags,
  typed,
  onAdd,
  onRemove,
}: {
  tags: string[];
  typed: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = () => {
    const t = draft.trim().replace(/^#/, "").toLowerCase();
    setDraft("");
    setAdding(false);
    if (!t) return;
    // No dupes against existing typed or body-extracted tags.
    if (tags.some((x) => x.toLowerCase() === t)) return;
    onAdd(t);
  };

  const typedSet = new Set(typed.map((t) => t.toLowerCase()));

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
        <input
          ref={inputRef}
          className="ideas-tag-input"
          value={draft}
          placeholder="tag"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
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
            }
          }}
          onBlur={commit}
        />
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
