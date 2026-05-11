import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Composer from "@/components/composer/Composer";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { Banner, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import { Events, useTrack } from "@/lib/analytics";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";
type SelectionMode = "auto" | "manual";

function pickInitialBlueprintId(
  blueprints: Blueprint[],
  byBlueprintId: Map<string, Blueprint>,
): string | null {
  for (const id of RECOMMENDED_BLUEPRINTS) {
    if (byBlueprintId.has(id)) return id;
  }
  if (byBlueprintId.has(DEFAULT_BLUEPRINT_SLUG)) return DEFAULT_BLUEPRINT_SLUG;
  if (byBlueprintId.has("blank")) return "blank";
  return blueprints[0] ? blueprintId(blueprints[0]) : null;
}

function guessBlueprintId(
  brief: string,
  blueprints: Blueprint[],
  byBlueprintId: Map<string, Blueprint>,
): string | null {
  const text = brief.toLowerCase();
  if (!text.trim()) return pickInitialBlueprintId(blueprints, byBlueprintId);

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
    for (const id of candidates) {
      if (byBlueprintId.has(id)) return id;
    }
  }

  return pickInitialBlueprintId(blueprints, byBlueprintId);
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
 * `/launch` is the organization studio. It gives the user one shell-native
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
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("auto");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    document.title = "Launch an organization · aeqi";
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

  const byBlueprintId = useMemo(() => {
    const m = new Map<string, Blueprint>();
    for (const blueprint of blueprints) {
      m.set(blueprintId(blueprint), blueprint);
    }
    return m;
  }, [blueprints]);

  const selectedBlueprint = useMemo(() => {
    if (selectedBlueprintId && byBlueprintId.has(selectedBlueprintId)) {
      return byBlueprintId.get(selectedBlueprintId) ?? null;
    }
    return pickInitialBlueprintId(blueprints, byBlueprintId)
      ? (byBlueprintId.get(pickInitialBlueprintId(blueprints, byBlueprintId) as string) ?? null)
      : null;
  }, [blueprints, byBlueprintId, selectedBlueprintId]);

  useEffect(() => {
    if (blueprints.length === 0) return;
    const initial = pickInitialBlueprintId(blueprints, byBlueprintId);
    if (!initial) return;
    setSelectedBlueprintId((current) =>
      current && byBlueprintId.has(current) ? current : initial,
    );
  }, [blueprints, byBlueprintId]);

  useEffect(() => {
    if (blueprints.length === 0 || selectionMode !== "auto") return;
    const next = guessBlueprintId(brief, blueprints, byBlueprintId);
    if (!next) return;
    setSelectedBlueprintId((current) => (current === next ? current : next));
  }, [brief, blueprints, byBlueprintId, selectionMode]);

  const launchQuery = useMemo(() => {
    const trimmed = brief.trim();
    return trimmed ? `?brief=${encodeURIComponent(trimmed)}` : "";
  }, [brief]);

  const choiceBlueprints = useMemo(() => {
    const ids: string[] = [];
    const add = (id: string | null | undefined) => {
      if (!id || ids.includes(id) || !byBlueprintId.has(id)) return;
      ids.push(id);
    };

    add("blank");
    for (const id of RECOMMENDED_BLUEPRINTS) add(id);
    for (const blueprint of blueprints) {
      if (ids.length >= 4) break;
      add(blueprintId(blueprint));
    }

    return ids.map((id) => byBlueprintId.get(id)).filter((t): t is Blueprint => !!t);
  }, [blueprints, byBlueprintId]);

  const handleContinue = useCallback(() => {
    if (!selectedBlueprint) return;
    navigate(`/launch/${encodeURIComponent(blueprintId(selectedBlueprint))}${launchQuery}`);
  }, [launchQuery, navigate, selectedBlueprint]);

  const handleBriefSend = useCallback(() => {
    handleContinue();
  }, [handleContinue]);

  const handleBriefChange = useCallback((next: string) => {
    setSelectionMode("auto");
    setBrief(next);
  }, []);

  const handleSelectBlueprint = useCallback((id: string) => {
    setSelectionMode("manual");
    setSelectedBlueprintId(id);
  }, []);

  if (!isAuthed) return null;

  return (
    <div className="start-page start-page--studio">
      <header className="start-head start-head--studio">
        <div className="start-head-copy">
          <p className="start-eyebrow">Launch</p>
          <h1 className="page-title">Start an organization.</h1>
          <p className="start-sub">Write the brief, pick the blueprint, and launch when ready.</p>
        </div>
        <div className="start-head-actions">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleContinue}
            disabled={loading || !selectedBlueprint}
          >
            Launch
          </Button>
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
            <p className="start-section-kicker">Brief</p>
            <h2 className="start-section-title">Describe the organization.</h2>
          </div>

          <div className="start-brief-panel">
            <Composer
              value={brief}
              onChange={handleBriefChange}
              onSend={handleBriefSend}
              composerRef={composerRef}
              variant="shell"
              placeholder="Tell AEQI what this organization should do, who it serves, and what makes it different."
              sendLabel="Launch"
            />
            <p className="start-help">AEQI will suggest the best blueprint as you type.</p>
          </div>
        </aside>

        <main className="start-canvas-pane">
          <div className="start-canvas-head">
            <div className="start-canvas-head-copy">
              <p className="start-section-kicker">Blueprint</p>
              <h2 className="start-section-title">
                {selectedBlueprint?.name ?? "Loading blueprints"}
              </h2>
              <p className="start-section-sub">
                {selectedBlueprint?.tagline ?? "Select a starting structure."}
              </p>
            </div>
            <div className="start-canvas-meta">
              <span className="start-canvas-meta-text">
                {selectionMode === "auto" ? "Auto" : "Pinned"}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="start-loading-state" role="status" aria-live="polite">
              <Spinner size="md" /> Loading blueprints…
            </div>
          ) : selectedBlueprint ? (
            <div className="start-canvas-stack">
              <BlueprintSeedCounts template={selectedBlueprint} />
              <BlueprintTreePreview template={selectedBlueprint} />
            </div>
          ) : (
            <div className="start-loading-state" role="status" aria-live="polite">
              No blueprints are available yet.
            </div>
          )}

          <section className="start-choice-section" aria-label="Blueprint patterns">
            <div className="start-choice-head">
              <p className="start-section-kicker">Recommended</p>
              <h3 className="start-section-title">Pick a starting structure.</h3>
            </div>

            <div className="start-choice-grid" role="list">
              {choiceBlueprints.map((template) => {
                const templateId = blueprintId(template);
                const active = selectedBlueprint
                  ? blueprintId(selectedBlueprint) === templateId
                  : false;
                return (
                  <button
                    key={templateId}
                    type="button"
                    className="start-choice-card-btn"
                    role="listitem"
                    onClick={() => handleSelectBlueprint(templateId)}
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

            <p className="start-help">
              Click a blueprint to pin it. Type to switch back to auto-match.
            </p>
          </section>
        </main>
      </section>
    </div>
  );
}
