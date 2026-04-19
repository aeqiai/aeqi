import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AgentEvent, Idea, ToolCall } from "@/lib/types";
import { Button } from "./ui";

const KNOWN_TOOLS = [
  "agents",
  "quests",
  "events",
  "code",
  "ideas",
  "web",
  "ideas.assemble",
  "ideas.search",
  "transcript.inject",
  "session.status",
  "session.spawn",
  "context.compress",
];

const COMMON_PATTERNS = [
  "session:start",
  "session:step_start",
  "session:quest_start",
  "session:quest_end",
  "session:quest_result",
  "session:recap_on_resume",
  "session:execution_start",
  "loop:detected",
];

function parseTagFilter(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function tagsToInput(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
}

function ToolCallRow({
  tc,
  index,
  readOnly,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  tc: ToolCall;
  index: number;
  readOnly: boolean;
  onChange: (index: number, updated: ToolCall) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [argsText, setArgsText] = useState(() => JSON.stringify(tc.args, null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = KNOWN_TOOLS.filter((t) => t.startsWith(tc.tool) && t !== tc.tool);

  const handleToolChange = (val: string) => {
    setShowSuggestions(true);
    onChange(index, { ...tc, tool: val });
  };

  const handleArgChange = (val: string) => {
    setArgsText(val);
    try {
      const parsed = JSON.parse(val);
      setArgsError(null);
      onChange(index, { ...tc, args: parsed as Record<string, unknown> });
    } catch {
      setArgsError("Invalid JSON");
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 6,
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--text-muted)",
            minWidth: 14,
            textAlign: "right",
          }}
        >
          {index + 1}
        </span>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            ref={inputRef}
            className="agent-settings-input"
            type="text"
            placeholder="tool name"
            value={tc.tool}
            readOnly={readOnly}
            disabled={readOnly}
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
            onChange={(e) => handleToolChange(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          />
          {!readOnly && showSuggestions && filtered.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 20,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-base)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                overflow: "hidden",
              }}
            >
              {filtered.map((t) => (
                <button
                  key={t}
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                  }}
                  onMouseDown={() => {
                    onChange(index, { ...tc, tool: t });
                    setShowSuggestions(false);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              title="Move up"
              disabled={isFirst}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: isFirst ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontSize: 11,
                opacity: isFirst ? 0.35 : 1,
                color: "var(--text-muted)",
              }}
              onClick={() => onMoveUp(index)}
            >
              ↑
            </button>
            <button
              type="button"
              title="Move down"
              disabled={isLast}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: isLast ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontSize: 11,
                opacity: isLast ? 0.35 : 1,
                color: "var(--text-muted)",
              }}
              onClick={() => onMoveDown(index)}
            >
              ↓
            </button>
            <button
              type="button"
              title="Remove"
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: "pointer",
                padding: "2px 6px",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <textarea
        className="agent-settings-input"
        placeholder={readOnly ? "(no args)" : '{"key": "value"}'}
        value={argsText}
        readOnly={readOnly}
        disabled={readOnly}
        rows={3}
        style={{
          width: "100%",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          resize: "vertical",
          minHeight: 56,
        }}
        onChange={(e) => handleArgChange(e.target.value)}
      />
      {argsError && (
        <div style={{ fontSize: 11, color: "var(--error)", marginTop: 2 }}>{argsError}</div>
      )}
    </div>
  );
}

function IdeaPickerSection({
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

export interface EventEditorSaveFields {
  name?: string;
  pattern?: string;
  idea_ids?: string[];
  query_template?: string | null;
  query_top_k?: number | null;
  query_tag_filter?: string[] | null;
  tool_calls?: ToolCall[] | null;
  cooldown_secs?: number;
  enabled?: boolean;
}

export default function EventEditor({
  event,
  readOnly = false,
  onSave,
}: {
  event: AgentEvent;
  readOnly?: boolean;
  onSave: (fields: EventEditorSaveFields) => Promise<void>;
}) {
  const [name, setName] = useState(event.name);
  const [pattern, setPattern] = useState(event.pattern);
  const [ideaIds, setIdeaIds] = useState<string[]>(event.idea_ids);
  const [queryTemplate, setQueryTemplate] = useState(event.query_template ?? "");
  const [queryTopK, setQueryTopK] = useState(
    event.query_top_k != null ? String(event.query_top_k) : "",
  );
  const [tagFilter, setTagFilter] = useState(tagsToInput(event.query_tag_filter));
  const [toolCalls, setToolCalls] = useState<ToolCall[]>(event.tool_calls ?? []);
  const [cooldownSecs, setCooldownSecs] = useState(String(event.cooldown_secs ?? 0));
  const [enabled, setEnabled] = useState(event.enabled);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPatternSuggestions, setShowPatternSuggestions] = useState(false);

  const patternSuggestions = COMMON_PATTERNS.filter((p) => p.startsWith(pattern) && p !== pattern);

  const savedTagsInput = tagsToInput(event.query_tag_filter);
  const savedToolCallsJson = JSON.stringify(event.tool_calls ?? []);

  const dirty =
    name !== event.name ||
    pattern !== event.pattern ||
    ideaIds.join(",") !== event.idea_ids.join(",") ||
    (queryTemplate.trim() || null) !== (event.query_template ?? null) ||
    (queryTopK.trim() || null) !== (event.query_top_k != null ? String(event.query_top_k) : null) ||
    tagFilter.trim() !== savedTagsInput ||
    JSON.stringify(toolCalls) !== savedToolCallsJson ||
    Number(cooldownSecs) !== event.cooldown_secs ||
    enabled !== event.enabled;

  const handleSave = async () => {
    if (!name.trim() || !pattern.trim()) {
      setErr("Name and pattern are required");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const parsedTopK = parseInt(queryTopK, 10);
      const parsedTags = parseTagFilter(tagFilter);
      const parsedCooldown = parseInt(cooldownSecs, 10);
      await onSave({
        name: name.trim(),
        pattern: pattern.trim(),
        idea_ids: ideaIds,
        query_template: queryTemplate.trim() ? queryTemplate.trim() : null,
        query_top_k: Number.isFinite(parsedTopK) && parsedTopK > 0 ? parsedTopK : null,
        query_tag_filter: parsedTags.length > 0 ? parsedTags : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        cooldown_secs: Number.isFinite(parsedCooldown) && parsedCooldown >= 0 ? parsedCooldown : 0,
        enabled,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setName(event.name);
    setPattern(event.pattern);
    setIdeaIds(event.idea_ids);
    setQueryTemplate(event.query_template ?? "");
    setQueryTopK(event.query_top_k != null ? String(event.query_top_k) : "");
    setTagFilter(tagsToInput(event.query_tag_filter));
    setToolCalls(event.tool_calls ?? []);
    setCooldownSecs(String(event.cooldown_secs ?? 0));
    setEnabled(event.enabled);
    setErr(null);
  };

  const handleToolCallChange = (index: number, updated: ToolCall) => {
    setToolCalls((prev) => prev.map((tc, i) => (i === index ? updated : tc)));
  };

  const handleToolCallRemove = (index: number) => {
    setToolCalls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleToolCallMoveUp = (index: number) => {
    if (index === 0) return;
    setToolCalls((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const handleToolCallMoveDown = (index: number) => {
    setToolCalls((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const handleAddToolCall = () => {
    setToolCalls((prev) => [...prev, { tool: "", args: {} }]);
  };

  const handleLinkIdea = async (ideaId: string) => {
    const newIds = [...ideaIds, ideaId];
    await api.updateEvent(event.id, { idea_ids: newIds });
    setIdeaIds(newIds);
  };

  const handleUnlinkIdea = async (ideaId: string) => {
    const newIds = ideaIds.filter((id) => id !== ideaId);
    await api.updateEvent(event.id, { idea_ids: newIds });
    setIdeaIds(newIds);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div className="events-detail-ideas-header" style={{ margin: 0 }}>
          Event settings
          {readOnly && (
            <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 8, opacity: 0.55 }}>
              (read-only — system event)
            </span>
          )}
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              loading={saving}
              disabled={saving || !dirty}
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving || !dirty}>
              Reset
            </Button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label className="agent-settings-label">Name</label>
          <input
            className="agent-settings-input"
            type="text"
            placeholder="on_session_start"
            value={name}
            readOnly={readOnly}
            disabled={readOnly}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="agent-settings-label">Pattern</label>
          <div style={{ position: "relative" }}>
            <input
              className="agent-settings-input"
              type="text"
              placeholder="session:start"
              value={pattern}
              readOnly={readOnly}
              disabled={readOnly}
              style={{ width: "100%", marginTop: 4 }}
              onChange={(e) => {
                setPattern(e.target.value);
                setShowPatternSuggestions(true);
              }}
              onFocus={() => setShowPatternSuggestions(true)}
              onBlur={() => setTimeout(() => setShowPatternSuggestions(false), 150)}
            />
            {!readOnly && showPatternSuggestions && patternSuggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 2px)",
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg-base)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  overflow: "hidden",
                }}
              >
                {patternSuggestions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                    onMouseDown={() => {
                      setPattern(p);
                      setShowPatternSuggestions(false);
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!readOnly && (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
              Common: {COMMON_PATTERNS.slice(0, 4).join(", ")}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="agent-settings-label">Cooldown (seconds)</label>
            <input
              className="agent-settings-input"
              type="number"
              min={0}
              placeholder="0"
              value={cooldownSecs}
              readOnly={readOnly}
              disabled={readOnly}
              style={{ width: "100%", marginTop: 4 }}
              onChange={(e) => setCooldownSecs(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: readOnly ? "default" : "pointer",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <input
                type="checkbox"
                checked={enabled}
                disabled={readOnly}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ cursor: readOnly ? "default" : "pointer" }}
              />
              Enabled
            </label>
          </div>
        </div>

        <div>
          <div className="events-detail-ideas-header" style={{ marginTop: 6 }}>
            Tool calls ({toolCalls.length})
            {!readOnly && (
              <button
                type="button"
                onClick={handleAddToolCall}
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 8px",
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  textTransform: "none",
                  letterSpacing: "normal",
                }}
              >
                + add
              </button>
            )}
          </div>
          {toolCalls.length === 0 ? (
            <div className="events-detail-loading">
              {readOnly ? "No tool calls configured." : "No tool calls. Add one above."}
            </div>
          ) : (
            toolCalls.map((tc, i) => (
              <ToolCallRow
                key={i}
                tc={tc}
                index={i}
                readOnly={readOnly}
                onChange={handleToolCallChange}
                onRemove={handleToolCallRemove}
                onMoveUp={handleToolCallMoveUp}
                onMoveDown={handleToolCallMoveDown}
                isFirst={i === 0}
                isLast={i === toolCalls.length - 1}
              />
            ))
          )}
          {!readOnly && toolCalls.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
              Tool calls fire in order when the pattern matches. Args are JSON — use{" "}
              <code>{"{user_input}"}</code>, <code>{"{tool_output}"}</code>,{" "}
              <code>{"{quest_description}"}</code> as string placeholders.
            </div>
          )}
        </div>

        <div>
          <div className="events-detail-ideas-header" style={{ marginTop: 6 }}>
            Dynamic query (legacy ideas.search shorthand)
          </div>
          <input
            className="agent-settings-input"
            type="text"
            placeholder={readOnly ? "(none)" : "recall for {user_input}"}
            value={queryTemplate}
            readOnly={readOnly}
            disabled={readOnly}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setQueryTemplate(e.target.value)}
          />
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            Expanded at fire-time and run through semantic search. Placeholders:{" "}
            <code>{"{user_input}"}</code>, <code>{"{tool_output}"}</code>,{" "}
            <code>{"{quest_description}"}</code>.
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div>
              <label className="agent-settings-label" style={{ margin: 0 }}>
                top-k
              </label>
              <input
                className="agent-settings-input"
                type="number"
                min={1}
                placeholder="5"
                value={queryTopK}
                readOnly={readOnly}
                disabled={readOnly}
                style={{ width: 100, marginTop: 4 }}
                onChange={(e) => setQueryTopK(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="agent-settings-label" style={{ margin: 0 }}>
                Tag filter
              </label>
              <input
                className="agent-settings-input"
                type="text"
                placeholder={readOnly ? "(none)" : "promoted, skill"}
                value={tagFilter}
                readOnly={readOnly}
                disabled={readOnly}
                style={{ width: "100%", marginTop: 4 }}
                onChange={(e) => setTagFilter(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="channel-form-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}

      <IdeaPickerSection
        ideaIds={ideaIds}
        readOnly={readOnly}
        onLink={handleLinkIdea}
        onUnlink={handleUnlinkIdea}
      />
    </div>
  );
}
