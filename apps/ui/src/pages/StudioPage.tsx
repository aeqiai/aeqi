import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banner, Button, Spinner, Textarea } from "@/components/ui";
import { apiRequest } from "@/api/client";
import "@/styles/studio.css";

/**
 * `/studio` — Architect surface (Wave 34 Phase 1).
 *
 * The Architect is a meta-agent that turns a free-text brief into a
 * deployable Blueprint. Phase 1 ships the request/response shell:
 *
 *  1. Founder writes a one-paragraph brief.
 *  2. `architect.draft` runs (stub generator → hard-coded foundation
 *     template with the brief interpolated).
 *  3. The generated Blueprint JSON renders in a preview panel with the
 *     architect's rationale above it.
 *  4. "Deploy this" calls `architect.deploy`, which routes through the
 *     same `spawn_blueprint` provisioner the catalog uses, then
 *     navigates to `/c/<entity_id>`.
 *
 * Phase 2 will swap the stub for an LLM-powered generator and add a
 * refine loop. Phase 3 adds streaming.
 */

interface GeneratorProvenance {
  kind: string;
  version: string;
}

interface GeneratedBlueprint {
  kind: string;
  rationale: string;
  blueprint: Record<string, unknown>;
  generator: GeneratorProvenance;
}

interface DraftResponse {
  ok: boolean;
  draft_id?: string;
  draft?: GeneratedBlueprint;
  error?: string;
  code?: string;
}

interface DeployResponse {
  ok: boolean;
  entity_id?: string;
  error?: string;
  code?: string;
}

const PLACEHOLDER =
  "I want to build a foundation focused on open-source AI tooling. Two co-founders. Light governance, monthly community grants, a writing assistant that helps draft posts and respond to GitHub issues.";

export default function StudioPage() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedBlueprint | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    document.title = "studio · aeqi";
  }, []);

  const submit = useCallback(async () => {
    const trimmed = brief.trim();
    if (!trimmed || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await apiRequest<DraftResponse>("/api/architect/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: trimmed }),
      });
      if (!res.ok || !res.draft) {
        setError(res.error ?? "The Architect couldn't draft from that brief.");
        setDraft(null);
        setDraftId(null);
      } else {
        setDraft(res.draft);
        setDraftId(res.draft_id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }, [brief, drafting]);

  const deploy = useCallback(async () => {
    if (!draft || deploying) return;
    setDeploying(true);
    setError(null);
    try {
      const res = await apiRequest<DeployResponse>("/api/architect/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      if (!res.ok || !res.entity_id) {
        setError(res.error ?? "Deploy failed.");
        return;
      }
      // Mirror the BlueprintsPage success path: navigate to the new
      // company's overview. The platform-side server returns the entity_id
      // we just minted; AppLayout resolves the entity and renders the
      // company shell at the canonical /c/<id>.
      navigate(`/c/${encodeURIComponent(res.entity_id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeploying(false);
    }
  }, [draft, deploying, navigate]);

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter submits — same shortcut as the chat composer so
    // the muscle memory transfers.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  const blueprintJson = useMemo(() => {
    if (!draft) return "";
    try {
      return JSON.stringify(draft.blueprint, null, 2);
    } catch {
      return "";
    }
  }, [draft]);

  const slug = (draft?.blueprint?.slug as string | undefined) ?? null;
  const template = (draft?.blueprint?.template as string | undefined) ?? null;
  const name = (draft?.blueprint?.name as string | undefined) ?? null;

  return (
    <div className="studio-page">
      <header className="studio-hero">
        <span className="studio-hero-eyebrow">Architect · Phase 1</span>
        <h1 className="studio-hero-title">Studio.</h1>
        <p className="studio-hero-lede">
          Describe what you want to build. The Architect drafts a Blueprint and deploys it.
        </p>
      </header>

      <section className="studio-grid">
        <form
          ref={formRef}
          className="studio-brief-pane"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="studio-field-label" htmlFor="studio-brief">
            Brief
          </label>
          <Textarea
            id="studio-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={PLACEHOLDER}
            rows={10}
            disabled={drafting || deploying}
            aria-describedby="studio-brief-hint"
          />
          <p id="studio-brief-hint" className="studio-field-hint">
            One paragraph. The Architect picks the on-chain template, root agent persona, and
            kickoff quest from your brief. Up to 8 000 characters.
          </p>
          <div className="studio-actions-row">
            <Button type="submit" variant="primary" disabled={drafting || !brief.trim()}>
              {drafting ? <Spinner size="sm" /> : "Draft Blueprint"}
            </Button>
            <span className="studio-shortcut-hint">⌘↵ to submit</span>
          </div>
        </form>

        <aside className="studio-preview-pane" aria-label="Generated Blueprint preview">
          {error && (
            <Banner kind="error" className="studio-banner">
              {error}
            </Banner>
          )}
          {!draft && !error && (
            <div className="studio-preview-empty">
              <p className="studio-preview-empty-title">No draft yet.</p>
              <p className="studio-preview-empty-body">
                Submit a brief and the Architect's proposal lands here.
              </p>
            </div>
          )}
          {draft && (
            <div className="studio-preview-body">
              <header className="studio-preview-head">
                <div className="studio-preview-meta">
                  <span className="studio-preview-meta-label">Template</span>
                  <span className="studio-preview-meta-value">{template ?? "—"}</span>
                </div>
                <div className="studio-preview-meta">
                  <span className="studio-preview-meta-label">Name</span>
                  <span className="studio-preview-meta-value">{name ?? "—"}</span>
                </div>
                <div className="studio-preview-meta">
                  <span className="studio-preview-meta-label">Slug</span>
                  <span className="studio-preview-meta-value studio-preview-meta-mono">
                    {slug ?? "—"}
                  </span>
                </div>
                <div className="studio-preview-meta">
                  <span className="studio-preview-meta-label">Generator</span>
                  <span className="studio-preview-meta-value">
                    {draft.generator.kind} · {draft.generator.version}
                  </span>
                </div>
              </header>

              <section className="studio-preview-rationale">
                <h2 className="studio-preview-section-title">Rationale</h2>
                <p>{draft.rationale}</p>
              </section>

              <section className="studio-preview-json">
                <h2 className="studio-preview-section-title">Blueprint JSON</h2>
                <pre className="studio-preview-json-pre">{blueprintJson}</pre>
              </section>

              <footer className="studio-preview-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDraft(null);
                    setDraftId(null);
                  }}
                  disabled={deploying}
                >
                  Discard
                </Button>
                <Button type="button" variant="primary" onClick={deploy} disabled={deploying}>
                  {deploying ? <Spinner size="sm" /> : "Deploy this"}
                </Button>
              </footer>
              {draftId && (
                <p className="studio-preview-draft-id" aria-label="Draft id">
                  Draft id: <code>{draftId}</code>
                </p>
              )}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
