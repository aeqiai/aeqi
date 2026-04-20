import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import type { CompanyTemplate } from "@/lib/types";
import { Button } from "@/components/ui";
import "@/styles/modals.css";
import "@/styles/templates.css";

interface Props {
  template: CompanyTemplate | null;
  open: boolean;
  onClose: () => void;
  onSpawned?: (rootAgentId: string) => void;
}

/**
 * Confirmation modal for "Start this company".
 *
 * Collects a display name (defaults to the template's own name), posts to
 * Stream C's `/api/templates/spawn`, then hands the new root_agent_id back
 * to the caller — TemplatesPage redirects to `/{root}/sessions` so the user
 * lands inside the freshly-threaded company immediately.
 */
export default function SpawnTemplateModal({ template, open, onClose, onSpawned }: Props) {
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const surfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && template) {
      setDisplayName(template.name);
      setError("");
      setSubmitting(false);
      setTimeout(() => inputRef.current?.select(), 60);
    }
  }, [open, template]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (submitting) return;
      if (surfaceRef.current && !surfaceRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose, submitting],
  );

  const handleSubmit = async () => {
    if (!template || !displayName.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const resp = await api.spawnTemplate({
        template: template.slug,
        display_name: displayName.trim(),
      });
      const rootId = resp?.root_agent_id;
      if (!rootId) {
        throw new Error("Spawn succeeded but no root_agent_id returned.");
      }
      // Prime client state so the redirected page renders populated
      setActiveRoot(rootId);
      try {
        await fetchAgents();
      } catch {
        // Non-fatal — the target page will refetch on mount
      }
      onSpawned?.(rootId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start company.");
      setSubmitting(false);
    }
  };

  if (!open || !template) return null;

  const counts = {
    agents: template.seed_agents?.length ?? 0,
    events: template.seed_events?.length ?? 0,
    ideas: template.seed_ideas?.length ?? 0,
    quests: template.seed_quests?.length ?? 0,
  };

  return createPortal(
    <div className="modal-backdrop" onClick={handleBackdrop} role="presentation">
      <div
        ref={surfaceRef}
        className="modal-surface"
        role="dialog"
        aria-modal="true"
        aria-label={`Start ${template.name}`}
      >
        <header className="tpl-modal-hero">
          <span className="tpl-modal-eyebrow">Start company</span>
          <h2 className="tpl-modal-title">{template.name}</h2>
          {template.tagline && <p className="tpl-modal-sub">{template.tagline}</p>}
        </header>

        {error && <div className="modal-error">{error}</div>}

        <div className="tpl-modal-field">
          <label className="tpl-modal-label" htmlFor="tpl-modal-name">
            Company name
          </label>
          <input
            ref={inputRef}
            id="tpl-modal-name"
            className="tpl-modal-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && displayName.trim() && !submitting) handleSubmit();
            }}
            placeholder={template.name}
            disabled={submitting}
            autoFocus
          />
          <p className="tpl-modal-hint">You can rename this anytime from the company home.</p>
        </div>

        <div className="tpl-modal-summary">
          <div className="tpl-modal-summary-row">
            <span>Seed agents</span>
            <span className="tpl-modal-summary-v">{counts.agents}</span>
          </div>
          <div className="tpl-modal-summary-row">
            <span>Seed events</span>
            <span className="tpl-modal-summary-v">{counts.events}</span>
          </div>
          <div className="tpl-modal-summary-row">
            <span>Seed ideas</span>
            <span className="tpl-modal-summary-v">{counts.ideas}</span>
          </div>
          <div className="tpl-modal-summary-row">
            <span>Seed quests</span>
            <span className="tpl-modal-summary-v">{counts.quests}</span>
          </div>
        </div>

        <div className="tpl-modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!displayName.trim() || submitting}
            loading={submitting}
          >
            {submitting ? "Starting..." : "Start company"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
