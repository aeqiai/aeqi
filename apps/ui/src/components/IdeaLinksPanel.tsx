import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import type { Idea, IdeaEdges, IdeaBacklink, IdeaLink, IdeaRelation } from "@/lib/types";

const NO_EDGES: IdeaEdges = { ok: true, links: [], backlinks: [] };
const NO_IDEAS: Idea[] = [];

// Runtime behavior differs per relation, so the labels should reflect what
// the user will actually see in their agent's context.
const RELATION_LABEL: Record<IdeaRelation, string> = {
  mentions: "mentions",
  embeds: "embeds",
  adjacent: "adjacent",
};

const RELATION_HINT: Record<IdeaRelation, string> = {
  mentions: "inline [[link]] in the body",
  embeds: "inline ![[transclusion]] in the body",
  adjacent: "also see — not in body",
};

/**
 * Outgoing edges + backlinks for a single idea. Edge taxonomy:
 *   - mentions / embeds — derived from `[[X]]` / `![[X]]` in the body
 *     (read-only here; removed by editing the body)
 *   - adjacent — explicit picker links ("+ Link" button)
 *
 * The picker only creates `adjacent` edges. Body parsing (backend side)
 * reconciles mentions/embeds on every save.
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

  const linkedIds = useMemo(
    () => new Set(edges.links.filter((l) => l.relation === "adjacent").map((l) => l.target_id)),
    [edges.links],
  );
  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return ideas
      .filter((i) => i.id !== ideaId && !linkedIds.has(i.id))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
      .slice(0, 10);
  }, [ideas, ideaId, linkedIds, pickerQuery]);

  const addLink = async (targetId: string) => {
    try {
      await api.addIdeaEdge(ideaId, targetId, "adjacent");
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

  // Bucket outgoing edges by relation for separate rows.
  const buckets = useMemo(() => {
    const out: Record<IdeaRelation, IdeaLink[]> = { mentions: [], embeds: [], adjacent: [] };
    for (const l of edges.links) {
      const r = (l.relation in out ? l.relation : "adjacent") as IdeaRelation;
      out[r].push(l);
    }
    return out;
  }, [edges.links]);

  const hasAnyLink = edges.links.length > 0;
  const hasBacklinks = edges.backlinks.length > 0;

  if (loading && !hasAnyLink && !hasBacklinks) return null;

  return (
    <div className="idea-links-panel">
      {buckets.mentions.length > 0 && (
        <LinkRow
          label="MENTIONS"
          hint={RELATION_HINT.mentions}
          chips={buckets.mentions.map((l) => (
            <LinkChip
              key={`m-${l.target_id}`}
              name={l.name}
              id={l.target_id}
              relation="mentions"
              onClick={() => goTo(l.target_id)}
            />
          ))}
        />
      )}
      {buckets.embeds.length > 0 && (
        <LinkRow
          label="EMBEDS"
          hint={RELATION_HINT.embeds}
          chips={buckets.embeds.map((l) => (
            <LinkChip
              key={`e-${l.target_id}`}
              name={l.name}
              id={l.target_id}
              relation="embeds"
              onClick={() => goTo(l.target_id)}
            />
          ))}
        />
      )}
      <LinkRow
        label="ADJACENT"
        hint={RELATION_HINT.adjacent}
        chips={
          <>
            {buckets.adjacent.map((l) => (
              <LinkChip
                key={`a-${l.target_id}`}
                name={l.name}
                id={l.target_id}
                relation="adjacent"
                onClick={() => goTo(l.target_id)}
                onRemove={() => removeLink(l.target_id, "adjacent")}
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
          </>
        }
      />
      {hasBacklinks && (
        <LinkRow
          label="REFERENCED BY"
          hint="Incoming — any relation"
          chips={edges.backlinks.map((b: IdeaBacklink) => (
            <LinkChip
              key={`b-${b.source_id}-${b.relation}`}
              name={b.name}
              id={b.source_id}
              relation={(b.relation in RELATION_LABEL ? b.relation : "adjacent") as IdeaRelation}
              onClick={() => goTo(b.source_id)}
            />
          ))}
        />
      )}
    </div>
  );
}

function LinkRow({ label, hint, chips }: { label: string; hint: string; chips: React.ReactNode }) {
  return (
    <div className="idea-links-row">
      <span className="idea-links-label" title={hint}>
        {label}
      </span>
      <div className="idea-links-chips">{chips}</div>
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
    <span className={`idea-link-chip rel-${relation}`} title={RELATION_HINT[relation] ?? relation}>
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
