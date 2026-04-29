import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Textarea } from "@/components/ui";
import { Events, useTrack } from "@/lib/analytics";
import "@/styles/welcome.css";
import "@/styles/templates.css";
import "@/styles/modals.css";

/**
 * /new — sub-agent creation wizard.
 *
 * Always reached as `/new?parent=<agentId>`. Without `?parent=` we
 * redirect to `/start` — root creation lives there now (with Blueprint
 * pre-selection + trial-slot gating). This file is the surviving slice
 * of the legacy "agent creation" page.
 */
export default function NewAgentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const allAgents = useDaemonStore((s) => s.agents);

  const parentId = (searchParams.get("parent") || "").trim();
  const subAgentMode = parentId.length > 0;
  const parentAgent = useMemo(
    () => (subAgentMode ? allAgents.find((a) => a.id === parentId) : null),
    [allAgents, parentId, subAgentMode],
  );

  useEffect(() => {
    if (subAgentMode) document.title = "new sub-agent · æqi";
  }, [subAgentMode]);

  // Daemon store may be cold on direct URL load (/new lives outside
  // AppLayout, which is the usual bootstrap). Fetch once so parentAgent
  // resolves to a real label instead of the "this agent" fallback.
  useEffect(() => {
    if (subAgentMode && allAgents.length === 0) {
      fetchAgents().catch(() => {
        /* non-fatal — label falls back, spawn still works */
      });
    }
  }, [subAgentMode, allAgents.length, fetchAgents]);

  if (!subAgentMode) {
    return <Navigate to="/start" replace />;
  }

  return (
    <SubAgentForm
      navigate={navigate}
      parentId={parentId}
      parentLabel={parentAgent?.name || "this agent"}
      onSpawned={async (newId) => {
        await fetchAgents();
        navigate(`/${encodeURIComponent(newId)}`);
      }}
    />
  );
}

function SubAgentForm({
  navigate,
  parentId,
  parentLabel,
  onSpawned,
}: {
  navigate: (to: string) => void;
  parentId: string;
  parentLabel: string;
  onSpawned: (newAgentId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const track = useTrack();

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleCancel = () => navigate(`/${encodeURIComponent(parentId)}/agents`);
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const resp = await api.spawnAgent({
        name: name.trim(),
        parent_agent_id: parentId,
        ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
      });
      const newId = resp.agent?.id;
      track(Events.AgentCreated, { surface: "new-agent-page", parent: parentId ? "yes" : "no" });
      if (newId && newId.length > 0) {
        await onSpawned(newId);
      } else {
        await onSpawned(parentId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to spawn agent.");
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        handleCancel();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
        e.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, submitting]);

  return (
    <div className="new-co-page">
      <div className="new-co-container new-co-animate">
        <BackLink
          onClick={() => navigate(`/${encodeURIComponent(parentId)}/agents`)}
          label={`Back to ${parentLabel}`}
        />

        <header className="new-sub-hero">
          <p className="new-sub-eyebrow">Spawn sub-agent</p>
          <h1 className="new-sub-title">
            New agent under <span className="new-sub-parent">{parentLabel}</span>
          </h1>
          <p className="new-sub-desc">
            Give it a name and an identity. It joins the tree as a direct child.
          </p>
        </header>

        <section className="new-sub-section">
          <label className="new-sub-label" htmlFor="new-sub-name">
            Name
          </label>
          <input
            id="new-sub-name"
            type="text"
            className="new-sub-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Researcher"
            autoFocus
            maxLength={64}
            disabled={submitting}
          />
        </section>

        <section className="new-sub-section">
          <label className="new-sub-label" htmlFor="new-sub-system">
            Identity (optional)
          </label>
          <Textarea
            bare
            id="new-sub-system"
            className="new-sub-textarea"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="What does this agent do? Voice, scope, hard constraints…"
            rows={5}
            disabled={submitting}
          />
        </section>

        {error && (
          <p className="new-sub-error" role="alert">
            {error}
          </p>
        )}

        <div className="new-sub-actions">
          <button
            type="button"
            className="new-sub-cancel"
            onClick={handleCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="new-sub-submit"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitting ? "Spawning…" : "Spawn agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="new-co-back" onClick={onClick}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M8.5 3L4.5 7l4 4" />
      </svg>
      {label}
    </button>
  );
}
