import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Composer from "@/components/composer/Composer";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { Banner, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import { Events, useTrack } from "@/lib/analytics";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

const START_PROMPTS = [
  "A company that ships AI agents for customer support and ops",
  "A crypto-native studio with treasury, vesting, and governance",
  "A small founder-led company with roles, hiring, and a clear roadmap",
];

type SelectionMode = "auto" | "manual";

function pickInitialBlueprintSlug(
  blueprints: Blueprint[],
  bySlug: Map<string, Blueprint>,
): string | null {
  for (const slug of RECOMMENDED_BLUEPRINTS) {
    if (bySlug.has(slug)) return slug;
  }
  if (bySlug.has(DEFAULT_BLUEPRINT_SLUG)) return DEFAULT_BLUEPRINT_SLUG;
  if (bySlug.has("blank")) return "blank";
  return blueprints[0]?.slug ?? null;
}

function guessBlueprintSlug(
  brief: string,
  blueprints: Blueprint[],
  bySlug: Map<string, Blueprint>,
): string | null {
  const text = brief.toLowerCase();
  if (!text.trim()) return pickInitialBlueprintSlug(blueprints, bySlug);

  const rules: Array<[RegExp, string[]]> = [
    [/\b(fund|treasury|capital|vesting|investment|portfolio|lp)\b/i, ["fund", "venture"]],
    [/\b(foundation|grant|public good|nonprofit|charity)\b/i, ["foundation", "community"]],
    [/\b(community|dao|membership|contributors)\b/i, ["community", "foundation"]],
    [/\b(solo|indie|personal|freelance|one founder)\b/i, ["solo-founder", "personal-os"]],
    [/\b(studio|agency|product team|software team|startup|saas)\b/i, ["tech-studio", "aeqi"]],
    [/\b(ai|agents|autonomous|company os|operating system)\b/i, ["aeqi", "tech-studio"]],
  ];

  for (const [pattern, candidates] of rules) {
    if (!pattern.test(text)) continue;
    for (const slug of candidates) {
      if (bySlug.has(slug)) return slug;
    }
  }

  return pickInitialBlueprintSlug(blueprints, bySlug);
}

function formatChoiceMeta(template: Blueprint): string {
  const parts: string[] = [];
  const agents = (template.seed_agents?.length ?? 0) + 1;
  const structures = countBlueprintStructures(template);
  const events = template.seed_events?.length ?? 0;
  const ideas = template.seed_ideas?.length ?? 0;
  const quests = template.seed_quests?.length ?? 0;
  parts.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
  if (structures > 1) parts.push(`${structures} structures`);
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  if (ideas > 0) parts.push(`${ideas} ${ideas === 1 ? "idea" : "ideas"}`);
  if (quests > 0) parts.push(`${quests} ${quests === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}

/**
 * `/launch` is the company studio. It gives the user one shell-native
 * formation surface: talk on the left, shape the blueprint on the right,
 * then continue into setup.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const isAuthed = authMode === "none" || !!token;
  const [brief, setBrief] = useState("");
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("auto");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    document.title = "Launch a company · aeqi";
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      navigate(`/signup?next=${encodeURIComponent("/launch")}`, { replace: true });
      return;
    }
    track(Events.CompanyCreateStart, { surface: "launch" });
  }, [isAuthed, navigate, track]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        setBlueprints((resp.blueprints ?? []).filter(isSingleBlueprint));
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message || "Could not reach the Blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bySlug = useMemo(() => {
    const m = new Map<string, Blueprint>();
    for (const blueprint of blueprints) {
      m.set(blueprint.slug, blueprint);
    }
    return m;
  }, [blueprints]);

  const selectedBlueprint = useMemo(() => {
    if (selectedSlug && bySlug.has(selectedSlug)) {
      return bySlug.get(selectedSlug) ?? null;
    }
    return pickInitialBlueprintSlug(blueprints, bySlug)
      ? (bySlug.get(pickInitialBlueprintSlug(blueprints, bySlug) as string) ?? null)
      : null;
  }, [blueprints, bySlug, selectedSlug]);

  useEffect(() => {
    if (blueprints.length === 0) return;
    const initial = pickInitialBlueprintSlug(blueprints, bySlug);
    if (!initial) return;
    setSelectedSlug((current) => (current && bySlug.has(current) ? current : initial));
  }, [blueprints, bySlug]);

  useEffect(() => {
    if (blueprints.length === 0 || selectionMode !== "auto") return;
    const next = guessBlueprintSlug(brief, blueprints, bySlug);
    if (!next) return;
    setSelectedSlug((current) => (current === next ? current : next));
  }, [brief, blueprints, bySlug, selectionMode]);

  const launchQuery = useMemo(() => {
    const trimmed = brief.trim();
    return trimmed ? `?brief=${encodeURIComponent(trimmed)}` : "";
  }, [brief]);

  const choiceBlueprints = useMemo(() => {
    const slugs: string[] = [];
    const add = (slug: string | null | undefined) => {
      if (!slug || slugs.includes(slug) || !bySlug.has(slug)) return;
      slugs.push(slug);
    };

    add("blank");
    for (const slug of RECOMMENDED_BLUEPRINTS) add(slug);
    for (const blueprint of blueprints) {
      if (slugs.length >= 7) break;
      add(blueprint.slug);
    }

    return slugs.map((slug) => bySlug.get(slug)).filter((t): t is Blueprint => !!t);
  }, [blueprints, bySlug]);

  const handleContinue = useCallback(() => {
    if (!selectedBlueprint) return;
    navigate(`/launch/${encodeURIComponent(selectedBlueprint.slug)}${launchQuery}`);
  }, [launchQuery, navigate, selectedBlueprint]);

  const handleBriefSend = useCallback(() => {
    handleContinue();
  }, [handleContinue]);

  const handlePrompt = useCallback((prompt: string) => {
    setSelectionMode("auto");
    setBrief(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const handleSelectBlueprint = useCallback((slug: string) => {
    setSelectionMode("manual");
    setSelectedSlug(slug);
  }, []);

  const resetAutoMatch = useCallback(() => {
    setSelectionMode("auto");
    const next = guessBlueprintSlug(brief, blueprints, bySlug);
    if (next) setSelectedSlug(next);
  }, [brief, blueprints, bySlug]);

  const briefValue = brief.trim();
  const previewLine =
    briefValue || selectedBlueprint?.tagline || "Write a brief and the canvas will adapt.";

  if (!isAuthed) return null;

  return (
    <div className="start-page start-page--studio">
      <header className="start-head start-head--studio">
        <p className="start-eyebrow">Launch studio</p>
        <h1 className="page-title">Describe the company. AEQI shapes the structure.</h1>
        <p className="start-sub">
          Talk on the left. The live canvas on the right recomposes as you change the brief or
          switch the blueprint. When it looks right, continue into setup.
        </p>
        <div className="start-step-row" aria-label="Launch steps">
          <span className="start-step">1 Brief</span>
          <span className="start-step">2 Blueprint</span>
          <span className="start-step">3 Review</span>
          <span className="start-step">4 Provision</span>
        </div>
      </header>

      {loadError && (
        <Banner kind="error" className="start-banner">
          {loadError}
        </Banner>
      )}

      <section className="start-studio-grid" aria-label="Launch studio">
        <aside className="start-session-pane">
          <div className="start-pane-head">
            <p className="start-section-kicker">Composer</p>
            <h2 className="start-section-title">Write the brief.</h2>
            <p className="start-section-sub">
              Keep it short. The studio will suggest a shape, and you can refine it on the canvas.
            </p>
          </div>

          <Composer
            value={brief}
            onChange={setBrief}
            onSend={handleBriefSend}
            composerRef={composerRef}
            variant="shell"
            placeholder="Tell AEQI what this company should do, who it serves, and what makes it different."
            sendLabel="Review setup"
            extraActions={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate("/blueprints")}
              >
                Browse blueprints
              </Button>
            }
          />

          <div className="start-brief-actions" aria-label="Quick prompts">
            {START_PROMPTS.map((prompt) => (
              <Button
                key={prompt}
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => handlePrompt(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>

          <div className="start-session-foot">
            <span className="start-session-foot-copy">
              {selectionMode === "auto" ? "Auto-matching to your brief." : "Pinned to your choice."}
            </span>
            <div className="start-session-foot-actions">
              <Button type="button" variant="secondary" size="sm" onClick={resetAutoMatch}>
                Re-suggest
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleContinue}
                disabled={loading || !selectedBlueprint}
              >
                Continue
              </Button>
            </div>
          </div>
        </aside>

        <main className="start-canvas-pane">
          <div className="start-canvas-head">
            <div className="start-canvas-head-copy">
              <p className="start-section-kicker">Live canvas</p>
              <h2 className="start-section-title">
                {selectedBlueprint?.name ?? "Loading blueprint"}
              </h2>
              <p className="start-section-sub">{selectedBlueprint?.tagline ?? previewLine}</p>
            </div>
            <div className="start-canvas-meta">
              <span className="start-canvas-meta-pill">
                {selectionMode === "auto" ? "Auto-match" : "Pinned"}
              </span>
              <span className="start-canvas-meta-text">updates as you type</span>
            </div>
          </div>

          <section className="start-proposal-panel" aria-label="Current proposal">
            <p className="start-proposal-label">Current brief</p>
            <p className="start-proposal-text">
              {briefValue || "Write a short brief to shape the first company."}
            </p>
            {selectedBlueprint && (
              <p className="start-proposal-foot">
                {formatChoiceMeta(selectedBlueprint)} · {selectedBlueprint.category ?? "company"}
              </p>
            )}
          </section>

          {loading ? (
            <div className="start-loading-state" role="status" aria-live="polite">
              <Spinner size="md" /> Loading blueprints…
            </div>
          ) : selectedBlueprint ? (
            <>
              <BlueprintSeedCounts template={selectedBlueprint} />
              <BlueprintTreePreview template={selectedBlueprint} />
            </>
          ) : (
            <div className="start-loading-state" role="status" aria-live="polite">
              No blueprints are available yet.
            </div>
          )}

          <section className="start-choice-section" aria-label="Blueprint patterns">
            <div className="start-choice-head">
              <p className="start-section-kicker">Patterns</p>
              <h3 className="start-section-title">Pick a starting structure</h3>
              <p className="start-section-sub">
                Click a pattern to pin the canvas. Keep typing to let AEQI auto-match again.
              </p>
            </div>

            <div className="start-choice-grid" role="list">
              {choiceBlueprints.map((template) => {
                const active = template.slug === selectedBlueprint?.slug;
                return (
                  <button
                    key={template.slug}
                    type="button"
                    className="start-choice-card-btn"
                    role="listitem"
                    onClick={() => handleSelectBlueprint(template.slug)}
                    aria-pressed={active}
                    aria-label={`${template.name}${template.tagline ? ` — ${template.tagline}` : ""}`}
                  >
                    <Card
                      variant="default"
                      padding="md"
                      interactive
                      className={`start-choice-card${active ? " start-choice-card--active" : ""}`}
                    >
                      <div className="start-choice-card-top">
                        <h4 className="start-choice-card-name">{template.name}</h4>
                        {active && <span className="start-choice-card-badge">Selected</span>}
                      </div>
                      {template.tagline && (
                        <p className="start-choice-card-tagline">{template.tagline}</p>
                      )}
                      <p className="start-choice-card-meta">{formatChoiceMeta(template)}</p>
                    </Card>
                  </button>
                );
              })}
            </div>

            <div className="start-canvas-foot">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate("/blueprints")}
              >
                Browse all blueprints
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleContinue}
                disabled={loading || !selectedBlueprint}
              >
                Use this blueprint
              </Button>
            </div>
          </section>
        </main>
      </section>
    </div>
  );
}
