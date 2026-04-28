import { useEffect, useMemo, useRef, useState } from "react";
import type { Idea, IdeaRelation } from "@/lib/types";
import { ChipClose } from "@/components/ui";

export interface RefRecord {
  target_id: string;
  name: string | null;
  relation: IdeaRelation;
}

export interface RefsRowProps {
  /** Ideas the picker can pull from. The current idea is filtered out by
   *  the consumer (or via `excludeId`). */
  candidates: Idea[];
  excludeId?: string;
  refs: RefRecord[];
  onAdd: (target: Idea) => void;
  onRemove: (target: { target_id: string; relation: IdeaRelation }) => void;
  /** When provided, navigating to a ref's idea uses this hook. Compose
   *  mode usually omits it (no nav until the idea exists). */
  onOpen?: (targetId: string) => void;
}

/**
 * Inline reference strip — pure presentation. One row of `§name` pills
 * (matching the `#tag` shape) plus a `+ ref` picker. The three relation
 * types collapse into one chip language; the consumer decides which
 * chips are removable (only `adjacent` in practice).
 *
 * No data fetching, no API calls — wrap with a stateful container
 * (IdeaLinksPanel for edit mode, the canvas's local pendingRefs for
 * compose mode) and pass refs / onAdd / onRemove. This is the design-
 * system primitive; the wrappers are surface-specific.
 */
export default function RefsRow({
  candidates,
  excludeId,
  refs,
  onAdd,
  onRemove,
  onOpen,
}: RefsRowProps) {
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerActive, setPickerActive] = useState(0);
  const pickerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (picking) requestAnimationFrame(() => pickerInputRef.current?.focus());
    if (!picking) setPickerActive(0);
  }, [picking]);

  const linkedIds = useMemo(() => new Set(refs.map((r) => r.target_id)), [refs]);

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return candidates
      .filter((i) => i.id !== excludeId && !linkedIds.has(i.id))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
      .slice(0, 10);
  }, [candidates, excludeId, linkedIds, pickerQuery]);

  const handleAdd = (target: Idea) => {
    onAdd(target);
    setPicking(false);
    setPickerQuery("");
    setPickerActive(0);
  };

  return (
    <div className="ideas-refs">
      {refs.map((r) => {
        const removable = r.relation === "adjacent";
        const label = r.name ?? r.target_id.slice(0, 8);
        return (
          <span key={r.target_id} className={`ideas-ref-chip${removable ? " removable" : ""}`}>
            <button
              type="button"
              className="ideas-ref-chip-label"
              onClick={() => onOpen?.(r.target_id)}
              disabled={!onOpen}
              title={
                r.relation === "mentions"
                  ? `Mentioned in body — [[${label}]]`
                  : r.relation === "embeds"
                    ? `Embedded in body — ![[${label}]]`
                    : "Direct reference"
              }
            >
              §{label}
            </button>
            {removable && (
              <ChipClose
                label={`Remove reference to ${label}`}
                onClick={() => onRemove({ target_id: r.target_id, relation: r.relation })}
              />
            )}
          </span>
        );
      })}
      {picking ? (
        <span className="ideas-ref-picker">
          <input
            ref={pickerInputRef}
            className="ideas-ref-picker-input"
            type="text"
            placeholder="search ideas…"
            value={pickerQuery}
            onChange={(e) => {
              setPickerQuery(e.target.value);
              setPickerActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setPicking(false);
                setPickerQuery("");
              } else if (e.key === "ArrowDown" && pickerResults.length > 0) {
                e.preventDefault();
                setPickerActive((i) => Math.min(i + 1, pickerResults.length - 1));
              } else if (e.key === "ArrowUp" && pickerResults.length > 0) {
                e.preventDefault();
                setPickerActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && pickerResults.length > 0) {
                e.preventDefault();
                const target = pickerResults[Math.min(pickerActive, pickerResults.length - 1)];
                if (target) handleAdd(target);
              }
            }}
            onBlur={() => {
              // Defer so a mouse-click on a suggestion can land first.
              requestAnimationFrame(() => {
                if (document.activeElement !== pickerInputRef.current) {
                  setPicking(false);
                  setPickerQuery("");
                }
              });
            }}
          />
          {pickerResults.length > 0 && (
            <span className="ideas-ref-picker-list" role="listbox">
              {pickerResults.map((r, i) => (
                <button
                  type="button"
                  key={r.id}
                  role="option"
                  aria-selected={i === pickerActive}
                  className={`ideas-ref-picker-item${i === pickerActive ? " active" : ""}`}
                  onMouseEnter={() => setPickerActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleAdd(r);
                  }}
                >
                  §{r.name}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          className="ideas-ref-add"
          onClick={() => setPicking(true)}
          aria-label="Add reference"
        >
          + ref
        </button>
      )}
    </div>
  );
}
