import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import type { Idea, IdeaEdges, IdeaLink } from "@/lib/types";
import RefsRow, { type RefRecord } from "./RefsRow";

const NO_EDGES: IdeaEdges = { ok: true, links: [], backlinks: [] };
const NO_IDEAS: Idea[] = [];

/**
 * Edit-mode wrapper around <RefsRow>. Loads outgoing edges via the API,
 * adds explicit references as `adjacent`, removes only `adjacent` (the
 * picker-driven type — `mentions`/`embeds` are derived from body
 * markdown, the user removes them by editing the body). Compose mode
 * uses RefsRow directly with local pendingRefs state inside IdeaCanvas.
 */
export default function IdeaLinksPanel({ ideaId, agentId }: { ideaId: string; agentId: string }) {
  const { goAgent } = useNav();
  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId] ?? NO_IDEAS);
  const [edges, setEdges] = useState<IdeaEdges>(NO_EDGES);

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

  // Dedup outgoing edges by target — if a single idea is both mentioned
  // [[x]] and listed as adjacent, render one chip and prefer `adjacent`
  // so the chip remains removable. Body-derived rels stay non-removable.
  const refs = useMemo<RefRecord[]>(() => {
    const byTarget = new Map<string, IdeaLink>();
    for (const l of edges.links) {
      const existing = byTarget.get(l.target_id);
      if (!existing) {
        byTarget.set(l.target_id, l);
      } else if (existing.relation !== "adjacent" && l.relation === "adjacent") {
        byTarget.set(l.target_id, l);
      }
    }
    return Array.from(byTarget.values()).map((l) => ({
      target_id: l.target_id,
      name: l.name,
      relation: l.relation,
    }));
  }, [edges.links]);

  const handleAdd = async (target: Idea) => {
    try {
      await api.addIdeaEdge(ideaId, target.id, "adjacent");
      await loadEdges();
    } catch {
      /* user retries via picker */
    }
  };

  const handleRemove = async ({ target_id, relation }: { target_id: string; relation: string }) => {
    if (relation !== "adjacent") return;
    try {
      await api.removeIdeaEdge(ideaId, target_id, relation);
      await loadEdges();
    } catch {
      /* leave chip — user can retry */
    }
  };

  return (
    <RefsRow
      candidates={ideas}
      excludeId={ideaId}
      refs={refs}
      onAdd={handleAdd}
      onRemove={handleRemove}
      onOpen={(id) => goAgent(agentId, "ideas", id)}
    />
  );
}
