import { useState } from "react";
import { api } from "@/lib/api";
import type { AgentEvent, ScopeValue, ToolCall } from "@/lib/types";
import { Button } from "./ui";
import ToolCallRow from "./ToolCallRow";
import EventIdeaPicker from "./EventIdeaPicker";
import { COMMON_PATTERNS } from "./EventEditorConstants";

function ScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{scope}</span>;
}

function parseTagFilter(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function tagsToInput(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
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
          {event.scope && <ScopeChip scope={event.scope} />}
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
                  boxShadow: "var(--shadow-popover)",
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

      <EventIdeaPicker
        ideaIds={ideaIds}
        readOnly={readOnly}
        onLink={handleLinkIdea}
        onUnlink={handleUnlinkIdea}
      />
    </div>
  );
}
