import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import type { Idea, IdeaEdges, IdeaLink } from "@/lib/types";

const NO_EDGES: IdeaEdges = { ok: true, links: [], backlinks: [] };
const NO_IDEAS: Idea[] = [];

/**
 * Inline reference strip — one row of `§name` pills below the tag row.
 * Collapses the three outgoing relation types (mentions / embeds /
 * adjacent) into a single visual class: a "reference" is a reference,
 * the runtime distinction lives in the data, not the UI.
 *
 *   #tag   → categorize
 *   §ref   → point at another idea
 *
 * Removable affordance only fires for `adjacent` (the explicit-picker
 * type). Mentions and embeds are derived from the body and surface as
 * non-removable chips — to drop one, the user removes the inline
 * `[[name]]` / `![[name]]` from the document. The chip language stays
 * uniform so the row reads as "what this idea points at" without the
 * implementation noise of the three rel types.
 */
export default function IdeaLinksPanel({ ideaId, agentId }: { ideaId: string; agentId: string }) {
  const { goAgent } = useNav();
  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId] ?? NO_IDEAS);
  const [edges, setEdges] = useState<IdeaEdges>(NO_EDGES);
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerActive, setPickerActive] = useState(0);
  const pickerInputRef = useRef<HTMLInputElement>(null);

  const loadEdges = useMemo(
    () => async () => {
      try {
        const res = await api.getIdeaEdges(ideaId);
        setEdges(res ?? NO_EDGES);
      } catch {
        setEdges(NO_EDGES);
      }
    },
    [ideaId],
  );

  useEffect(() => {
    loadEdges();
  }, [loadEdges]);

  useEffect(() => {
    if (picking) requestAnimationFrame(() => pickerInputRef.current?.focus());
    if (!picking) setPickerActive(0);
  }, [picking]);

  // De-duplicate the outgoing links by target — if a single idea is both
  // mentioned [[x]] and listed as adjacent, render one chip and prefer
  // `adjacent` (so the chip remains removable). Body-derived rels stay
  // non-removable; explicit picker rels surface their × affordance.
  const refs = useMemo<IdeaLink[]>(() => {
    const byTarget = new Map<string, IdeaLink>();
    for (const l of edges.links) {
      const existing = byTarget.get(l.target_id);
      if (!existing) {
        byTarget.set(l.target_id, l);
      } else if (existing.relation !== "adjacent" && l.relation === "adjacent") {
        byTarget.set(l.target_id, l);
      }
    }
    return Array.from(byTarget.values());
  }, [edges.links]);

  const linkedIds = useMemo(() => new Set(refs.map((l) => l.target_id)), [refs]);
  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return ideas
      .filter((i) => i.id !== ideaId && !linkedIds.has(i.id))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
      .slice(0, 10);
  }, [ideas, ideaId, linkedIds, pickerQuery]);

  const addRef = async (targetId: string) => {
    try {
      await api.addIdeaEdge(ideaId, targetId, "adjacent");
      setPicking(false);
      setPickerQuery("");
      setPickerActive(0);
      await loadEdges();
    } catch {
      /* user retries via picker */
    }
  };

  const removeRef = async (targetId: string, relation: string) => {
    if (relation !== "adjacent") return;
    try {
      await api.removeIdeaEdge(ideaId, targetId, relation);
      await loadEdges();
    } catch {
      /* leave chip — user can retry */
    }
  };

  const goTo = (id: string) => goAgent(agentId, "ideas", id);

  return (
    <div className="ideas-refs">
      {refs.map((l) => {
        const removable = l.relation === "adjacent";
        const label = l.name ?? l.target_id.slice(0, 8);
        return (
          <span key={l.target_id} className={`ideas-ref-chip${removable ? " removable" : ""}`}>
            <button
              type="button"
              className="ideas-ref-chip-label"
              onClick={() => goTo(l.target_id)}
              title={
                l.relation === "mentions"
                  ? `Mentioned in body — [[${label}]]`
                  : l.relation === "embeds"
                    ? `Embedded in body — ![[${label}]]`
                    : "Direct reference"
              }
            >
              §{label}
            </button>
            {removable && (
              <button
                type="button"
                className="ideas-ref-chip-x"
                onClick={() => removeRef(l.target_id, l.relation)}
                aria-label={`Remove reference to ${label}`}
              >
                ×
              </button>
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
                if (target) addRef(target.id);
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
                    addRef(r.id);
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
