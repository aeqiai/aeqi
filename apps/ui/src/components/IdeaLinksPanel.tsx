import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import type { Idea, IdeaEdges, IdeaBacklink, IdeaRelation } from "@/lib/types";

const NO_EDGES: IdeaEdges = { ok: true, links: [], backlinks: [] };
const NO_IDEAS: Idea[] = [];

// Short labels for the chip dot tooltip and the picker menu.
const RELATION_LABEL: Record<IdeaRelation, string> = {
  related_to: "related",
  supports: "supports",
  contradicts: "contradicts",
  supersedes: "supersedes",
  caused_by: "caused by",
  derived_from: "derived from",
};

/**
 * Links + Referenced-by UI for a single idea. Outgoing edges are owned by
 * the viewer (can add / remove); backlinks are read-only (remove them from
 * the other side). The picker is a prefix-matched popover scoped to the
 * current agent's visible idea set.
 */
export default function IdeaLinksPanel({ ideaId, agentId }: { ideaId: string; agentId: string }) {
  const { goAgent } = useNav();
  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId] ?? NO_IDEAS);
  const [edges, setEdges] = useState<IdeaEdges>(NO_EDGES);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerInputRef = useRef<HTMLInputElement>(null);

  const loadEdges = useMemo(
    () => async () => {
      setLoading(true);
      try {
        const res = await api.getIdeaEdges(ideaId);
        setEdges(res ?? NO_EDGES);
      } catch {
        setEdges(NO_EDGES);
      } finally {
        setLoading(false);
      }
    },
    [ideaId],
  );

  useEffect(() => {
    loadEdges();
  }, [loadEdges]);

  useEffect(() => {
    if (picking) requestAnimationFrame(() => pickerInputRef.current?.focus());
  }, [picking]);

  // Ideas available to link to: everything visible to this agent, minus
  // self and already-linked targets. Substring match for the picker.
  const linkedIds = useMemo(() => new Set(edges.links.map((l) => l.target_id)), [edges.links]);
  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return ideas
      .filter((i) => i.id !== ideaId && !linkedIds.has(i.id))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
      .slice(0, 10);
  }, [ideas, ideaId, linkedIds, pickerQuery]);

  const addLink = async (targetId: string) => {
    try {
      await api.addIdeaEdge(ideaId, targetId, "related_to");
      setPicking(false);
      setPickerQuery("");
      await loadEdges();
    } catch {
      /* user retries via picker */
    }
  };

  const removeLink = async (targetId: string, relation: string) => {
    try {
      await api.removeIdeaEdge(ideaId, targetId, relation);
      await loadEdges();
    } catch {
      /* leave chip — user can retry */
    }
  };

  const goTo = (id: string) => goAgent(agentId, "ideas", id);

  const hasLinks = edges.links.length > 0;
  const hasBacklinks = edges.backlinks.length > 0;

  if (loading && !hasLinks && !hasBacklinks) return null;

  return (
    <div className="idea-links-panel">
      <div className="idea-links-row">
        <span className="idea-links-label">Links</span>
        <div className="idea-links-chips">
          {edges.links.map((l) => (
            <LinkChip
              key={`${l.target_id}-${l.relation}`}
              id={l.target_id}
              name={l.name}
              relation={l.relation}
              onClick={() => goTo(l.target_id)}
              onRemove={() => removeLink(l.target_id, l.relation)}
              removable
            />
          ))}
          {picking ? (
            <div className="idea-link-picker">
              <input
                ref={pickerInputRef}
                className="idea-link-picker-input"
                type="text"
                placeholder="Search ideas…"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setPicking(false);
                    setPickerQuery("");
                  }
                }}
              />
              <div className="idea-link-picker-list">
                {pickerResults.length === 0 ? (
                  <div className="idea-link-picker-empty">No matches</div>
                ) : (
                  pickerResults.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className="idea-link-picker-item"
                      onClick={() => addLink(r.id)}
                    >
                      {r.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <button type="button" className="idea-link-add" onClick={() => setPicking(true)}>
              + Link
            </button>
          )}
        </div>
      </div>
      {hasBacklinks && (
        <div className="idea-links-row">
          <span className="idea-links-label">Referenced by</span>
          <div className="idea-links-chips">
            {edges.backlinks.map((b: IdeaBacklink) => (
              <LinkChip
                key={`${b.source_id}-${b.relation}`}
                id={b.source_id}
                name={b.name}
                relation={b.relation}
                onClick={() => goTo(b.source_id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LinkChip({
  id,
  name,
  relation,
  onClick,
  onRemove,
  removable,
}: {
  id: string;
  name: string | null;
  relation: IdeaRelation;
  onClick: () => void;
  onRemove?: () => void;
  removable?: boolean;
}) {
  const label = name ?? id.slice(0, 8);
  return (
    <span className={`idea-link-chip rel-${relation}`} title={RELATION_LABEL[relation] ?? relation}>
      <span className="idea-link-chip-dot" />
      <button type="button" className="idea-link-chip-label" onClick={onClick}>
        {label}
      </button>
      {removable && onRemove && (
        <button
          type="button"
          className="idea-link-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove link"
        >
          ×
        </button>
      )}
    </span>
  );
}
