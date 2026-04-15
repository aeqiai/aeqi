import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

interface AgentEvent {
  id: string;
  name: string;
  pattern: string;
  idea_ids: string[];
  enabled: boolean;
  cooldown_secs: number;
  fire_count: number;
  last_fired?: string;
  system: boolean;
}

interface IdeaPreview {
  id: string;
  key: string;
  content: string;
  tags: string[];
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function AgentEventsTab({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<IdeaPreview[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<IdeaPreview[]>([]);
  const [searching, setSearching] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const data = await api.getAgentEvents(agentId);
      setEvents((data.events as AgentEvent[]) || []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const selected = events.find((e) => e.id === selectedId);

  // Load ideas when selection changes
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
      })
      .catch(() => setIdeas([]))
      .finally(() => setIdeasLoading(false));
  }, [selected?.id, selected?.idea_ids.length]);

  // Search ideas for linking
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await api.getIdeas({ query: searchQuery, limit: 10 });
      const items = ((data.ideas || data.entries || []) as IdeaPreview[]);
      // Filter out already-linked ideas
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
    setSearchResults((prev) => prev.filter((i) => i.id !== ideaId));
    loadEvents();
    // Reload ideas for the selected event
    const data = await api.getIdeasByIds(newIds).catch(() => ({ ok: false, ideas: [] }));
    if (data.ok) setIdeas(data.ideas);
  };

  const handleUnlinkIdea = async (ideaId: string) => {
    if (!selected) return;
    const newIds = selected.idea_ids.filter((id) => id !== ideaId);
    await api.updateEvent(selected.id, { idea_ids: newIds });
    setIdeas((prev) => prev.filter((i) => i.id !== ideaId));
    loadEvents();
  };

  if (loading) return <div className="events-empty">Loading...</div>;

  const sessionEvents = events.filter((e) => e.pattern.startsWith("session:"));
  const customEvents = events.filter((e) => !e.pattern.startsWith("session:"));

  return (
    <div className="events-split">
      {/* Sidebar: event list */}
      <div className="events-sidebar">
        <div className="events-sidebar-section">Session</div>
        {sessionEvents.map((ev) => (
          <div
            key={ev.id}
            className={`events-sidebar-item${ev.id === selectedId ? " active" : ""}${!ev.enabled ? " disabled" : ""}`}
            onClick={() => setSelectedId(ev.id)}
          >
            <span className="events-sidebar-name">{ev.name}</span>
            <span className="events-sidebar-meta">
              {ev.idea_ids.length > 0 ? `${ev.idea_ids.length} ideas` : ""}
            </span>
          </div>
        ))}
        {customEvents.length > 0 && (
          <>
            <div className="events-sidebar-section">Custom</div>
            {customEvents.map((ev) => {
              const prefix = ev.pattern.split(":")[0];
              return (
                <div
                  key={ev.id}
                  className={`events-sidebar-item${ev.id === selectedId ? " active" : ""}${!ev.enabled ? " disabled" : ""}`}
                  onClick={() => setSelectedId(ev.id)}
                >
                  <span className="events-sidebar-name">{ev.name}</span>
                  <span className="events-sidebar-badge">{prefix}</span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Main: selected event detail */}
      <div className="events-detail">
        {!selected ? (
          <div className="events-detail-empty">Select an event to view details</div>
        ) : (
          <>
            <div className="events-detail-header">
              <div>
                <h3 className="events-detail-name">{selected.name}</h3>
                <span className="events-detail-pattern">{selected.pattern}</span>
              </div>
              <div className="events-detail-actions">
                <button
                  className="btn"
                  onClick={async () => {
                    await api.updateEvent(selected.id, { enabled: !selected.enabled });
                    loadEvents();
                  }}
                >
                  {selected.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            </div>

            {selected.fire_count > 0 && (
              <div className="events-detail-stats">
                Fired {selected.fire_count} times
                {selected.last_fired ? ` · last ${timeAgo(selected.last_fired)}` : ""}
              </div>
            )}

            <div className="events-detail-ideas-header">
              <span>Injected Ideas ({selected.idea_ids.length})</span>
            </div>

            {ideasLoading ? (
              <div className="events-detail-loading">Loading ideas...</div>
            ) : ideas.length === 0 && selected.idea_ids.length === 0 ? (
              <div className="events-detail-loading">No ideas linked to this event.</div>
            ) : (
              <div className="events-detail-ideas">
                {ideas.map((idea) => (
                  <div key={idea.id} className="event-idea-card">
                    <div className="event-idea-header">
                      <span className="event-idea-key">{idea.key}</span>
                      <button
                        className="event-idea-unlink"
                        onClick={() => handleUnlinkIdea(idea.id)}
                        title="Unlink"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="event-idea-content">{idea.content}</div>
                    {idea.tags.length > 0 && (
                      <div className="event-idea-tags">
                        {idea.tags.map((t) => (
                          <span key={t} className="event-idea-tag">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Search and link ideas */}
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
                    <div key={idea.id} className="events-link-result" onClick={() => handleLinkIdea(idea.id)}>
                      <span className="events-link-result-key">{idea.key}</span>
                      <span className="events-link-result-preview">{idea.content.slice(0, 80)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
