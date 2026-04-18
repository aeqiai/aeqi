import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, EmptyState } from "./ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "./IdeaGraph";
import type { Idea } from "@/lib/types";

const NO_IDEAS: Idea[] = [];

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
  // draft fields.
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => {
      goAgent(agentId, "ideas", undefined, { replace: true });
      setNewName("");
      setNewContent("");
      setNewTags("");
      setCreateError(null);
    };
    window.addEventListener("aeqi:new-idea", handler);
    return () => window.removeEventListener("aeqi:new-idea", handler);
  }, [agentId, goAgent]);

  const handleCreate = async () => {
    setCreateError(null);
    if (!newName.trim() || !newContent.trim()) {
      setCreateError("Name and content are required");
      return;
    }
    setSaving(true);
    try {
      const tags = newTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await api.storeIdea({
        name: newName.trim(),
        content: newContent.trim(),
        tags,
        agent_id: agentId,
      });
      const created: Idea = {
        id: res.id,
        name: newName.trim(),
        content: newContent.trim(),
        tags,
        agent_id: agentId,
      };
      addIdea(agentId, created);
      setNewName("");
      setNewContent("");
      setNewTags("");
      goAgent(agentId, "ideas", res.id, { replace: true });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create idea");
    } finally {
      setSaving(false);
    }
  };

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
    // No idea selected → this is the "new idea" canvas. It's the default
    // state, not a modal over a stale selection.
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        {viewToggle}
        <h3 className="events-detail-name">New Idea</h3>
        <div style={{ marginTop: 12, marginBottom: 10 }}>
          <label className="agent-settings-label">Name</label>
          <input
            className="agent-settings-input"
            type="text"
            placeholder="e.g. coding_style"
            value={newName}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="agent-settings-label">Content</label>
          <textarea
            className="agent-settings-input"
            placeholder="What should the agent remember?"
            value={newContent}
            rows={8}
            style={{ width: "100%", marginTop: 4, fontFamily: "inherit" }}
            onChange={(e) => setNewContent(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="agent-settings-label">Tags (comma-separated)</label>
          <input
            className="agent-settings-input"
            type="text"
            placeholder="skill, workflow"
            value={newTags}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setNewTags(e.target.value)}
          />
        </div>
        {createError && <div className="channel-form-error">{createError}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="primary" onClick={handleCreate} loading={saving} disabled={saving}>
            {saving ? "Creating..." : "Create"}
          </Button>
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

      <div
        className="event-idea-content"
        style={{ marginTop: 16, whiteSpace: "pre-wrap", lineHeight: 1.6 }}
      >
        {selected.content}
      </div>
    </div>
  );
}
