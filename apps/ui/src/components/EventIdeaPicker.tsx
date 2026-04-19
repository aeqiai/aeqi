import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Idea } from "@/lib/types";

export default function EventIdeaPicker({
  ideaIds,
  readOnly,
  onLink,
  onUnlink,
}: {
  ideaIds: string[];
  readOnly: boolean;
  onLink: (id: string) => Promise<void>;
  onUnlink: (id: string) => Promise<void>;
}) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Idea[]>([]);
  const [searching, setSearching] = useState(false);

  const idsKey = ideaIds.join(",");
  useEffect(() => {
    if (ideaIds.length === 0) {
      setIdeas([]);
      return;
    }
    setLoading(true);
    api
      .getIdeasByIds(ideaIds)
      .then((d) => {
        if (d.ok) setIdeas(d.ideas);
        else setIdeas([]);
      })
      .catch(() => setIdeas([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const d = await api.getIdeas({ query: searchQuery, limit: 10 });
      const items = ((d.ideas || d.entries || []) as Idea[]).filter((i) => !ideaIds.includes(i.id));
      setSearchResults(items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, idsKey]);

  return (
    <div>
      <div className="events-detail-ideas-header" style={{ marginTop: 14 }}>
        Idea references ({ideaIds.length})
      </div>
      {loading ? (
        <div className="events-detail-loading">Loading…</div>
      ) : ideas.length === 0 ? (
        <div className="events-detail-loading">
          {readOnly ? "No ideas linked." : "No ideas linked. Search below to add one."}
        </div>
      ) : (
        <div className="events-detail-ideas">
          {ideas.map((idea) => (
            <div key={idea.id} className="event-idea-card">
              <div className="event-idea-header">
                <span className="event-idea-key">{idea.name}</span>
                {!readOnly && (
                  <button
                    className="event-idea-unlink"
                    onClick={() => onUnlink(idea.id)}
                    title="Unlink"
                  >
                    &times;
                  </button>
                )}
              </div>
              <div className="event-idea-content">{idea.content.slice(0, 120)}</div>
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
      {!readOnly && (
        <div className="events-link-section">
          <div className="events-link-search">
            <input
              className="events-link-input"
              type="text"
              placeholder="Search ideas to link…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
            />
            <button className="events-link-search-btn" onClick={handleSearch} disabled={searching}>
              {searching ? "…" : "Search"}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="events-link-results">
              {searchResults.map((idea) => (
                <div
                  key={idea.id}
                  className="events-link-result"
                  onClick={async () => {
                    await onLink(idea.id);
                    setSearchResults((prev) => prev.filter((i) => i.id !== idea.id));
                  }}
                >
                  <span className="events-link-result-key">{idea.name}</span>
                  <span className="events-link-result-preview">{idea.content.slice(0, 80)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
