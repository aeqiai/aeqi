import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { EmptyState } from "./ui";
import type { AgentEvent, Idea } from "@/lib/types";

// Stable empty-array reference — see selector-hygiene.test.ts.
const NO_EVENTS: AgentEvent[] = [];

/**
 * Event detail pane. The list now lives in the global right rail
 * (ContentCTA) — this component only renders the selected event.
 */
export default function AgentEventsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const events = useAgentDataStore((s) => s.eventsByAgent[agentId] ?? NO_EVENTS);
  const loadEvents = useAgentDataStore((s) => s.loadEvents);
  const patchEvent = useAgentDataStore((s) => s.patchEvent);
  const removeEvent = useAgentDataStore((s) => s.removeEvent);

  useEffect(() => {
    loadEvents(agentId);
  }, [agentId, loadEvents]);

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Idea[]>([]);
  const [searching, setSearching] = useState(false);

  const selected = events.find((e) => e.id === selectedId);

  // Re-fetch ideas when selected event or its idea_ids change.
  const selectedIdeaIdsKey = selected ? selected.idea_ids.join(",") : "";
  useEffect(() => {
    if (!selected || selected.idea_ids.length === 0) {
      setIdeas([]);
      return;
    }
    setIdeasLoading(true);
    api
      .getIdeasByIds(selected.idea_ids)
      .then((data) => {
        if (data.ok) setIdeas(data.ideas);
        else setIdeas([]);
      })
      .catch(() => setIdeas([]))
      .finally(() => setIdeasLoading(false));
    // Only the fields we actually read are tracked — see comment in prior
    // revision of this file; `selected` identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selectedIdeaIdsKey]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await api.getIdeas({ query: searchQuery, limit: 10 });
      const items = (data.ideas || data.entries || []) as Idea[];
      const linked = new Set(selected?.idea_ids || []);
      setSearchResults(items.filter((i) => !linked.has(i.id)));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, selected?.idea_ids]);

  const handleLinkIdea = async (ideaId: string) => {
    if (!selected) return;
    const newIds = [...selected.idea_ids, ideaId];
    await api.updateEvent(selected.id, { idea_ids: newIds });
    patchEvent(agentId, selected.id, { idea_ids: newIds });
    setSearchResults((prev) => prev.filter((i) => i.id !== ideaId));
    const data = await api.getIdeasByIds(newIds).catch(() => ({ ok: false, ideas: [] as Idea[] }));
    if (data.ok) setIdeas(data.ideas);
  };

  const handleUnlinkIdea = async (ideaId: string) => {
    if (!selected) return;
    const newIds = selected.idea_ids.filter((id) => id !== ideaId);
    await api.updateEvent(selected.id, { idea_ids: newIds });
    patchEvent(agentId, selected.id, { idea_ids: newIds });
    setIdeas((prev) => prev.filter((i) => i.id !== ideaId));
  };

  if (!selected) {
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        <EmptyState
          title="Select an event"
          description="Pick an event from the right to view or edit it."
        />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">{selected.name}</h3>
          <span className="events-detail-pattern">{selected.pattern}</span>
        </div>
        <div className="events-detail-actions">
          <button
            className="btn"
            onClick={async () => {
              const next = !selected.enabled;
              await api.updateEvent(selected.id, { enabled: next });
              patchEvent(agentId, selected.id, { enabled: next });
            }}
          >
            {selected.enabled ? "Disable" : "Enable"}
          </button>
          {!selected.system && !selected.pattern.startsWith("session:") && (
            <button
              className="btn channel-disconnect-btn"
              onClick={async () => {
                await api.deleteEvent(selected.id);
                removeEvent(agentId, selected.id);
                goAgent(agentId, "events", undefined, { replace: true });
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {selected.fire_count > 0 && (
        <div className="events-detail-stats">
          Fired {selected.fire_count} times
          {selected.last_fired ? ` · last ${new Date(selected.last_fired).toLocaleString()}` : ""}
        </div>
      )}

      <div className="events-detail-ideas-header">Injected Ideas ({selected.idea_ids.length})</div>

      {ideasLoading ? (
        <div className="events-detail-loading">Loading ideas...</div>
      ) : ideas.length === 0 && selected.idea_ids.length === 0 ? (
        <div className="events-detail-loading">No ideas linked. Search below to add one.</div>
      ) : (
        <div className="events-detail-ideas">
          {ideas.map((idea) => (
            <div key={idea.id} className="event-idea-card">
              <div className="event-idea-header">
                <span className="event-idea-key">{idea.name}</span>
                <button
                  className="event-idea-unlink"
                  onClick={() => handleUnlinkIdea(idea.id)}
                  title="Unlink"
                >
                  &times;
                </button>
              </div>
              <div className="event-idea-content">{idea.content}</div>
              {idea.tags && idea.tags.length > 0 && (
                <div className="event-idea-tags">
                  {idea.tags.map((t) => (
                    <span key={t} className="event-idea-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="events-link-section">
        <div className="events-link-search">
          <input
            className="events-link-input"
            type="text"
            placeholder="Search ideas to link..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
          <button className="events-link-search-btn" onClick={handleSearch} disabled={searching}>
            {searching ? "..." : "Search"}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="events-link-results">
            {searchResults.map((idea) => (
              <div
                key={idea.id}
                className="events-link-result"
                onClick={() => handleLinkIdea(idea.id)}
              >
                <span className="events-link-result-key">{idea.name}</span>
                <span className="events-link-result-preview">{idea.content.slice(0, 80)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
