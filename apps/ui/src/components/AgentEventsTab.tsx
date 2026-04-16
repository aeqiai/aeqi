import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import type { AgentEvent, Idea } from "@/lib/types";

function eventLabel(ev: AgentEvent): string {
  return ev.name.replace(/^on_/, "").replace(/_/g, " ");
}

function eventTransport(ev: AgentEvent): string | null {
  const prefix = ev.pattern.split(":")[0];
  if (prefix === "session") return null;
  return prefix.toUpperCase();
}

export default function AgentEventsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Idea[]>([]);
  const [searching, setSearching] = useState(false);

  const setSelectedId = useCallback(
    (id: string | null) => {
      goAgent(agentId, "events", id || undefined, { replace: true });
    },
    [agentId, goAgent],
  );

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
    // `selected` itself is intentionally omitted: its identity changes on
    // every parent render, which would cause infinite refetches. The only
    // fields we read are `.id` and `.idea_ids`, both of which are already
    // tracked by `selected?.id` + `selectedIdeaIdsKey` below.
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
    setSearchResults((prev) => prev.filter((i) => i.id !== ideaId));
    loadEvents();
    const data = await api.getIdeasByIds(newIds).catch(() => ({ ok: false, ideas: [] as Idea[] }));
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

  return (
    <div className="asv">
      {/* Sidebar — same style as session sidebar */}
      <div className="asv-sidebar">
        <div className="asv-sidebar-header">
          <button
            className="asv-session-new-btn"
            onClick={() => {
              // TODO: add event creation flow
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            Add Event
          </button>
        </div>
        <div className="asv-sidebar-list">
          {events.map((ev) => {
            const transport = eventTransport(ev);
            return (
              <div
                key={ev.id}
                className={`asv-session-item${ev.id === selectedId ? " active" : ""}${!ev.enabled ? " asv-session-item--disabled" : ""}`}
                onClick={() => setSelectedId(ev.id)}
              >
                <div className="asv-session-item-top">
                  <span className="asv-session-item-name">{eventLabel(ev)}</span>
                  {transport && <span className="asv-session-item-transport">{transport}</span>}
                </div>
                <div className="asv-session-item-bottom">
                  <span className="asv-session-item-preview">{ev.pattern}</span>
                  {ev.idea_ids.length > 0 && (
                    <span className="asv-session-item-date">{ev.idea_ids.length} ideas</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail — main area */}
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        {!selected ? (
          <div className="events-detail-empty">Select an event</div>
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
                {!selected.system && !selected.pattern.startsWith("session:") && (
                  <button
                    className="btn channel-disconnect-btn"
                    onClick={async () => {
                      await api.deleteEvent(selected.id);
                      setSelectedId(null);
                      loadEvents();
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
                {selected.last_fired
                  ? ` · last ${new Date(selected.last_fired).toLocaleString()}`
                  : ""}
              </div>
            )}

            <div className="events-detail-ideas-header">
              Injected Ideas ({selected.idea_ids.length})
            </div>

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
                <button
                  className="events-link-search-btn"
                  onClick={handleSearch}
                  disabled={searching}
                >
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
                      <span className="events-link-result-preview">
                        {idea.content.slice(0, 80)}
                      </span>
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
