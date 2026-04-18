import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, EmptyState } from "./ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "./IdeaGraph";
import type { Idea } from "@/lib/types";

const NO_IDEAS: Idea[] = [];

/** Pull `#hashtag` tokens out of a body of text. Dedupes, strips the `#`. */
function extractHashtags(text: string): string[] {
  const re = /(?:^|\s)#([a-z0-9_-]+)/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].toLowerCase());
  return Array.from(out);
}

/**
 * Idea detail pane. The list lives in the global right rail (ContentCTA) —
 * this component renders the selected idea and handles create/edit/delete.
 */
export default function AgentIdeasTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId] ?? NO_IDEAS);
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);
  const patchIdea = useAgentDataStore((s) => s.patchIdea);
  const removeIdea = useAgentDataStore((s) => s.removeIdea);
  const addIdea = useAgentDataStore((s) => s.addIdea);

  useEffect(() => {
    loadIdeas(agentId);
  }, [agentId, loadIdeas]);

  // View toggle: "list" (detail pane) vs "graph" (obsidian-style canvas).
  const [view, setView] = useState<"list" | "graph">("list");
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    if (view !== "graph") return;
    setGraphLoading(true);
    api
      .getIdeaGraph({ agent_id: agentId, limit: 200 })
      .then((d) => {
        setGraphData({
          nodes: ((d.nodes || []) as GraphNode[]).map((n) => ({
            ...n,
            tags: Array.isArray(n.tags) ? n.tags.filter(Boolean) : [],
          })),
          edges: (d.edges || []) as GraphEdge[],
        });
      })
      .catch(() => setGraphData({ nodes: [], edges: [] }))
      .finally(() => setGraphLoading(false));
  }, [view, agentId]);

  const handleGraphSelect = (node: GraphNode | null) => {
    if (!node) return;
    goAgent(agentId, "ideas", node.id, { replace: true });
  };

  // The create form IS the default state when no :itemId — no modal, no
  // overlay. Rail's "New idea" button just clears the URL and resets the
  // draft. Tags are extracted inline from `#hashtags` in the body.
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => {
      goAgent(agentId, "ideas", undefined, { replace: true });
      setNewName("");
      setNewContent("");
      setCreateError(null);
      // Focus the title the next paint so the user can start typing.
      requestAnimationFrame(() => titleRef.current?.focus());
    };
    window.addEventListener("aeqi:new-idea", handler);
    return () => window.removeEventListener("aeqi:new-idea", handler);
  }, [agentId, goAgent]);

  // Auto-focus the title whenever we land on the compose canvas (no :itemId).
  useEffect(() => {
    if (!selectedId) {
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [selectedId]);

  const handleCreate = async () => {
    setCreateError(null);
    const content = newContent.trim();
    if (!content) {
      setCreateError("Write something first");
      return;
    }
    // Title defaults to the first line of the body if left empty — so
    // capturing a quick thought never gets blocked by a required-field.
    const name = newName.trim() || content.split("\n")[0].slice(0, 60).trim() || "Untitled";
    const tags = extractHashtags(content);
    setSaving(true);
    try {
      const res = await api.storeIdea({ name, content, tags, agent_id: agentId });
      const created: Idea = { id: res.id, name, content, tags, agent_id: agentId };
      addIdea(agentId, created);
      setNewName("");
      setNewContent("");
      goAgent(agentId, "ideas", res.id, { replace: true });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create idea");
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl + Enter from the compose canvas saves. Scoped to when no idea
  // is selected — otherwise the shortcut would fire on the detail pane too.
  useEffect(() => {
    if (selectedId) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleCreate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, newName, newContent]);

  const selected = ideas.find((i) => i.id === selectedId);

  // Edit form state — mirrors the selected idea when editing.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setEditError(null);
  }, [selectedId]);

  const startEdit = () => {
    if (!selected) return;
    setEditName(selected.name);
    setEditContent(selected.content);
    setEditTags((selected.tags || []).join(", "));
    setEditError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!selected) return;
    setEditError(null);
    if (!editName.trim() || !editContent.trim()) {
      setEditError("Name and content are required");
      return;
    }
    setEditSaving(true);
    try {
      const tags = editTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.updateIdea(selected.id, {
        name: editName.trim(),
        content: editContent.trim(),
        tags,
      });
      patchIdea(agentId, selected.id, {
        name: editName.trim(),
        content: editContent.trim(),
        tags,
      });
      setEditing(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save idea");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await api.deleteIdea(selected.id);
      removeIdea(agentId, selected.id);
      goAgent(agentId, "ideas", undefined, { replace: true });
    } catch {
      // Leave the row — user can retry.
    }
  };

  const viewToggle = (
    <div className="ideas-view-toggle" style={{ marginBottom: 12 }}>
      <button
        className={`view-btn ${view === "list" ? "active" : ""}`}
        onClick={() => setView("list")}
      >
        List
      </button>
      <button
        className={`view-btn ${view === "graph" ? "active" : ""}`}
        onClick={() => setView("graph")}
      >
        Graph
      </button>
    </div>
  );

  if (view === "graph") {
    return (
      <div
        className="asv-main"
        style={{
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {viewToggle}
        {graphLoading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading graph…</div>
        ) : graphData.nodes.length === 0 ? (
          <EmptyState
            title="No ideas to graph"
            description="Create ideas to see them connected here."
          />
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>
            <IdeaGraph
              nodes={graphData.nodes}
              edges={graphData.edges}
              onSelect={handleGraphSelect}
              selectedId={selectedId}
            />
          </div>
        )}
      </div>
    );
  }

  if (!selected) {
    // No idea selected → the compose canvas. Apple-Notes feel: borderless
    // title, body is the whole page, inline #hashtags become tags on save.
    const inlineTags = extractHashtags(newContent);
    return (
      <div className="asv-main ideas-canvas">
        {viewToggle}
        <input
          ref={titleRef}
          className="ideas-canvas-title"
          type="text"
          placeholder="Title"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <textarea
          className="ideas-canvas-body"
          placeholder="Start typing… use #hashtags inline."
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
        />
        <div className="ideas-canvas-footer">
          <div className="ideas-canvas-tags">
            {inlineTags.map((t) => (
              <span key={t} className="event-idea-tag">
                #{t}
              </span>
            ))}
          </div>
          <div className="ideas-canvas-actions">
            {createError && <span className="ideas-canvas-error">{createError}</span>}
            <span className="ideas-canvas-hint">⌘ + Enter</span>
            <Button variant="primary" onClick={handleCreate} loading={saving} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        <h3 className="events-detail-name">Edit Idea</h3>
        <div style={{ marginTop: 12, marginBottom: 10 }}>
          <label className="agent-settings-label">Name</label>
          <input
            className="agent-settings-input"
            type="text"
            value={editName}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="agent-settings-label">Content</label>
          <textarea
            className="agent-settings-input"
            value={editContent}
            rows={12}
            style={{ width: "100%", marginTop: 4, fontFamily: "inherit" }}
            onChange={(e) => setEditContent(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="agent-settings-label">Tags (comma-separated)</label>
          <input
            className="agent-settings-input"
            type="text"
            value={editTags}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setEditTags(e.target.value)}
          />
        </div>
        {editError && <div className="channel-form-error">{editError}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="primary" onClick={handleSave} loading={editSaving} disabled={editSaving}>
            {editSaving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setEditError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      {viewToggle}
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">{selected.name}</h3>
          <span className="events-detail-pattern">
            {selected.agent_id ? "agent-scoped" : "global"}
            {selected.created_at ? ` · ${new Date(selected.created_at).toLocaleDateString()}` : ""}
          </span>
        </div>
        <div className="events-detail-actions">
          <Button variant="secondary" onClick={startEdit}>
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="channel-disconnect-btn"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </div>

      {selected.tags && selected.tags.length > 0 && (
        <div className="event-idea-tags" style={{ marginTop: 8 }}>
          {selected.tags.map((t) => (
            <span key={t} className="event-idea-tag">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="event-idea-content ideas-markdown">
        <Markdown>{selected.content}</Markdown>
      </div>
    </div>
  );
}
