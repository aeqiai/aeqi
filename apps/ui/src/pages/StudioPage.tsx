import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banner, Button, Spinner, Textarea } from "@/components/ui";
import { apiRequest } from "@/api/client";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import "@/styles/studio.css";

/**
 * `/studio` — Architect surface (Wave 35 Phase 3 — multi-turn refinement).
 *
 * The Architect is a meta-agent that turns a free-text brief into a
 * deployable Blueprint. Wave 35 extends Phase 2's request/response shell
 * into a chat-shaped refinement loop:
 *
 *  1. Founder writes a one-paragraph brief → Submit.
 *  2. `architect.draft` runs (LLM-powered; stub fallback if no API key).
 *  3. The generated Blueprint card lands in the conversation column,
 *     paired with the brief that produced it.
 *  4. Founder types a refinement instruction below the latest card →
 *     Submit refinement.
 *  5. `architect.refine` runs with the FULL turn history (every prior
 *     brief + draft pair) and the new instruction; the model edits
 *     the prior blueprint in place. New card appended.
 *  6. "Deploy this" button only appears on the LATEST blueprint card —
 *     calls `architect.deploy`, navigates to `/c/<entity_id>`.
 *
 * Phase 3 does NOT persist drafts. Refresh = reset. Phase 4 will add
 * `architect_drafts` table + real streaming.
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

/** One round-trip: founder said something, architect drafted a blueprint. */
interface Turn {
  /** "brief" = original first turn; "refinement" = follow-up instruction. */
  kind: "brief" | "refinement";
  /** What the founder typed for this turn. */
  text: string;
  /** What the architect produced. */
  draft: GeneratedBlueprint;
  /** Synthetic id from the IPC layer; useful for debugging only. */
  draftId: string | null;
}

const PLACEHOLDER =
  "I want to build a foundation focused on open-source AI tooling. Two co-founders. Light governance, monthly community grants, a writing assistant that helps draft posts and respond to GitHub issues.";

const REFINEMENT_PLACEHOLDER =
  "Make it more focused on AI ethics. Drop the writing assistant; add a research lead.";

export default function StudioPage() {
  const navigate = useNavigate();
  const entitiesList = useDaemonStore((s) => s.entities);
  const [brief, setBrief] = useState("");
  const [refinement, setRefinement] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [refining, setRefining] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const briefFormRef = useRef<HTMLFormElement>(null);
  const refineFormRef = useRef<HTMLFormElement>(null);
  const latestCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "aeqi";
  }, []);

  // After every new turn lands, scroll the latest card into view so the
  // founder doesn't have to chase it.
  useEffect(() => {
    if (turns.length > 0 && latestCardRef.current) {
      latestCardRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length]);

  const submitBrief = useCallback(async () => {
    const trimmed = brief.trim();
    if (!trimmed || drafting || turns.length > 0) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await apiRequest<DraftResponse>("/architect/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: trimmed }),
      });
      if (!res.ok || !res.draft) {
        setError(res.error ?? "The Architect couldn't draft from that brief.");
      } else {
        setTurns([
          {
            kind: "brief",
            text: trimmed,
            draft: res.draft,
            draftId: res.draft_id ?? null,
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }, [brief, drafting, turns.length]);

  const submitRefinement = useCallback(async () => {
    const trimmed = refinement.trim();
    if (!trimmed || refining || turns.length === 0) return;
    setRefining(true);
    setError(null);
    try {
      const history = turns.map((t) => ({ brief: t.text, draft: t.draft }));
      const res = await apiRequest<DraftResponse>("/architect/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, instruction: trimmed }),
      });
      if (!res.ok || !res.draft) {
        setError(res.error ?? "The Architect couldn't refine from that instruction.");
      } else {
        setTurns((prev) => [
          ...prev,
          {
            kind: "refinement",
            text: trimmed,
            draft: res.draft as GeneratedBlueprint,
            draftId: res.draft_id ?? null,
          },
        ]);
        setRefinement("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefining(false);
    }
  }, [refinement, refining, turns]);

  const deploy = useCallback(async () => {
    const latest = turns[turns.length - 1];
    if (!latest || deploying) return;
    setDeploying(true);
    setError(null);
    try {
      const res = await apiRequest<DeployResponse>("/architect/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: latest.draft }),
      });
      if (!res.ok || !res.entity_id) {
        setError(res.error ?? "Deploy failed.");
        return;
      }
      navigate(entityPathFromId(entitiesList, res.entity_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeploying(false);
    }
  }, [turns, deploying, navigate, entitiesList]);

  const reset = useCallback(() => {
    setTurns([]);
    setBrief("");
    setRefinement("");
    setError(null);
  }, []);

  const onBriefKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submitBrief();
    }
  };

  const onRefinementKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submitRefinement();
    }
  };

  const hasTurns = turns.length > 0;

  return (
    <div className="studio-page">
      <header className="studio-hero">
        <span className="studio-hero-eyebrow">Architect · Phase 3</span>
        <h1 className="studio-hero-title">Studio.</h1>
        <p className="studio-hero-lede">
          Describe what you want to build. The Architect drafts a Blueprint, refines it on feedback,
          and deploys it.
        </p>
      </header>

      {error && (
        <Banner kind="error" className="studio-banner">
          {error}
        </Banner>
      )}

      {!hasTurns && (
        <section className="studio-grid">
          <form
            ref={briefFormRef}
            className="studio-brief-pane"
            onSubmit={(e) => {
              e.preventDefault();
              void submitBrief();
            }}
          >
            <label className="studio-field-label" htmlFor="studio-brief">
              Brief
            </label>
            <Textarea
              id="studio-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={onBriefKeyDown}
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
            <div className="studio-preview-empty">
              <p className="studio-preview-empty-title">No draft yet.</p>
              <p className="studio-preview-empty-body">
                Submit a brief and the Architect's proposal lands here.
              </p>
            </div>
          </aside>
        </section>
      )}

      {hasTurns && (
        <section className="studio-conversation" aria-label="Architect conversation">
          {turns.map((turn, idx) => {
            const isLatest = idx === turns.length - 1;
            return (
              <div
                key={`${turn.kind}-${idx}-${turn.draftId ?? "x"}`}
                className="studio-turn"
                ref={isLatest ? latestCardRef : null}
              >
                <article className="studio-turn-message" aria-label="Founder message">
                  <span className="studio-turn-message-label">
                    {turn.kind === "brief" ? "Brief" : "Refinement"}
                  </span>
                  <p className="studio-turn-message-body">{turn.text}</p>
                </article>
                <BlueprintCard
                  draft={turn.draft}
                  showDeploy={isLatest}
                  deploying={deploying}
                  onDeploy={deploy}
                  draftId={turn.draftId}
                />
              </div>
            );
          })}

          <form
            ref={refineFormRef}
            className="studio-refine-pane"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRefinement();
            }}
          >
            <label className="studio-field-label" htmlFor="studio-refinement">
              Refine
            </label>
            <Textarea
              id="studio-refinement"
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
              onKeyDown={onRefinementKeyDown}
              placeholder={REFINEMENT_PLACEHOLDER}
              rows={3}
              disabled={refining || deploying}
              aria-describedby="studio-refinement-hint"
            />
            <p id="studio-refinement-hint" className="studio-field-hint">
              Describe what to change. The Architect rewrites the latest Blueprint with your edits.
            </p>
            <div className="studio-actions-row">
              <Button
                type="button"
                variant="secondary"
                onClick={reset}
                disabled={refining || deploying}
              >
                Start over
              </Button>
              <div className="studio-actions-trail">
                <span className="studio-shortcut-hint">⌘↵ to submit</span>
                <Button type="submit" variant="primary" disabled={refining || !refinement.trim()}>
                  {refining ? <Spinner size="sm" /> : "Refine"}
                </Button>
              </div>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

interface BlueprintCardProps {
  draft: GeneratedBlueprint;
  showDeploy: boolean;
  deploying: boolean;
  onDeploy: () => void;
  draftId: string | null;
}

function BlueprintCard({ draft, showDeploy, deploying, onDeploy, draftId }: BlueprintCardProps) {
  const blueprintJson = useMemo(() => {
    try {
      return JSON.stringify(draft.blueprint, null, 2);
    } catch {
      return "";
    }
  }, [draft]);

  const slug = (draft.blueprint?.slug as string | undefined) ?? null;
  const template = (draft.blueprint?.template as string | undefined) ?? null;
  const name = (draft.blueprint?.name as string | undefined) ?? null;

  return (
    <article className="studio-blueprint-card" aria-label="Generated Blueprint">
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
          <span className="studio-preview-meta-value studio-preview-meta-mono">{slug ?? "—"}</span>
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

      {showDeploy && (
        <footer className="studio-preview-actions">
          <Button type="button" variant="primary" onClick={onDeploy} disabled={deploying}>
            {deploying ? <Spinner size="sm" /> : "Deploy this"}
          </Button>
        </footer>
      )}
      {draftId && (
        <p className="studio-preview-draft-id" aria-label="Draft id">
          Draft id: <code>{draftId}</code>
        </p>
      )}
    </article>
  );
}
