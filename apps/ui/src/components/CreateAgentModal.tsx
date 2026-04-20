import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Button, Input, Textarea } from "@/components/ui";
import "@/styles/modals.css";

interface Skill {
  name: string;
  tags?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selected parent in the dropdown. Falls back to activeRoot when absent. */
  defaultParentId?: string;
}

/**
 * Gather all descendants of `rootId` (inclusive) for parent-agent scoping —
 * a sub-agent should only attach under something in the current tree.
 */
function collectTree(agents: Array<{ id: string; parent_id?: string | null }>, rootId: string) {
  const children = new Map<string, string[]>();
  for (const a of agents) {
    const p = a.parent_id || "";
    if (!p) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(a.id);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const c of children.get(id) || []) walk(c);
  };
  walk(rootId);
  return new Set(out);
}

export default function CreateAgentModal({ open, onClose, defaultParentId }: Props) {
  const agents = useDaemonStore((s) => s.agents);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const activeRoot = useUIStore((s) => s.activeRoot);

  const [templates, setTemplates] = useState<string[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  const [template, setTemplate] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [parentId, setParentId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Fetch identity templates from skills
  useEffect(() => {
    if (!open) return;
    setLoadingTemplates(true);
    api
      .getSkills()
      .then((data) => {
        const skills: Skill[] = (data?.skills || data || []) as Skill[];
        const identity = skills.filter((s) => Array.isArray(s.tags) && s.tags.includes("identity"));
        if (identity.length > 0) {
          setTemplates(identity.map((s) => s.name));
          setUseFallback(false);
        } else {
          setTemplates([]);
          setUseFallback(true);
        }
      })
      .catch(() => {
        setTemplates([]);
        setUseFallback(true);
      })
      .finally(() => setLoadingTemplates(false));
  }, [open]);

  // Scoped parent list: only agents in the active tree.
  const scopedParents = useMemo(() => {
    if (!activeRoot) return agents;
    const set = collectTree(agents, activeRoot);
    return agents.filter((a) => set.has(a.id));
  }, [agents, activeRoot]);

  // Reset form state when opening, default parent to active root.
  useEffect(() => {
    if (open) {
      setTemplate("");
      setDisplayName("");
      setParentId(defaultParentId || activeRoot || "");
      setSystemPrompt("");
      setError("");
      setSuccess(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, activeRoot, defaultParentId]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (surfaceRef.current && !surfaceRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleSubmit = async () => {
    if (!template.trim()) {
      setError("Pick a template to continue.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.spawnAgent({
        template: template.trim(),
        ...(parentId ? { parent_id: parentId } : {}),
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
      });
      setSuccess(true);
      await fetchAgents();
      setTimeout(() => onClose(), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to spawn agent.");
    } finally {
      setSubmitting(false);
    }
  };

  const parentAgent = scopedParents.find((a) => a.id === parentId);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-surface cam-surface" ref={surfaceRef}>
        <header className="cam-hero">
          <div className="cam-hero-eyebrow">Spawn</div>
          <h2 className="cam-hero-title">New agent</h2>
          <p className="cam-hero-sub">
            {parentAgent
              ? `Attaches under ${parentAgent.display_name || parentAgent.name}.`
              : "A fresh root agent. No parent — its own tree."}
          </p>
        </header>

        {error && <div className="modal-error">{error}</div>}
        {success && <div className="modal-success">Agent spawned. Taking you back.</div>}

        <div className="modal-field">
          <label className="modal-label">Identity</label>
          {loadingTemplates ? (
            <div className="cam-skeleton" />
          ) : useFallback ? (
            <>
              <Input
                type="text"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="e.g. researcher"
              />
              <div className="cam-template-fallback-hint">
                No identity templates found. Enter one manually.
              </div>
            </>
          ) : (
            <div className="cam-template-grid" role="radiogroup" aria-label="Identity template">
              {templates.map((t) => {
                const active = template === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`cam-template-card${active ? " is-active" : ""}`}
                    onClick={() => setTemplate(t)}
                  >
                    <span className="cam-template-card-dot" />
                    <span className="cam-template-card-name">{t}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="cam-row">
          <div className="modal-field cam-field-grow">
            <label className="modal-label">Name</label>
            <Input
              ref={nameRef}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="modal-field cam-field-grow">
            <label className="modal-label">Parent</label>
            <select
              className="modal-select"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">None (root)</option>
              {scopedParents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name || a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-field">
          <label className="modal-label">System prompt override</label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Leave blank to inherit from the template."
            rows={3}
          />
        </div>

        <div className="modal-actions cam-actions">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting || success || !template.trim()}
          >
            {submitting ? "Spawning..." : success ? "Spawned" : "Spawn agent"}
          </Button>
        </div>
      </div>
    </div>
  );
}
