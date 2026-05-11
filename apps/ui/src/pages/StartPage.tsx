import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Banner, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { Events, useTrack } from "@/lib/analytics";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

function pickInitialBlueprintId(
  blueprints: Blueprint[],
  byBlueprintId: Map<string, Blueprint>,
): string | null {
  for (const id of RECOMMENDED_BLUEPRINTS) {
    if (byBlueprintId.has(id)) return id;
  }
  if (byBlueprintId.has(DEFAULT_BLUEPRINT_SLUG)) return DEFAULT_BLUEPRINT_SLUG;
  return blueprints[0] ? blueprintId(blueprints[0]) : null;
}

/**
 * `/launch` is the canonical launch selector. It stays intentionally small:
 * choose the default blueprint here, browse the catalog if you want another
 * option, then continue into `/launch/:blueprintId`.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const isAuthed = authMode === "none" || !!token;
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    const initial = pickInitialBlueprintId(blueprints, byBlueprintId);
    return initial ? (byBlueprintId.get(initial) ?? null) : null;
  }, [blueprints, byBlueprintId, selectedBlueprintId]);

  useEffect(() => {
    if (blueprints.length === 0) return;
    const initial = pickInitialBlueprintId(blueprints, byBlueprintId);
    if (!initial) return;
    setSelectedBlueprintId((current) =>
      current && byBlueprintId.has(current) ? current : initial,
    );
  }, [blueprints, byBlueprintId]);

  const handleContinue = useCallback(() => {
    if (!selectedBlueprint) return;
    navigate(`/launch/${encodeURIComponent(blueprintId(selectedBlueprint))}`);
  }, [navigate, selectedBlueprint]);

  if (!isAuthed) return null;

  return (
    <div className="start-page start-page--launch">
      <header className="start-head start-head--launch">
        <div className="start-head-copy">
          <p className="start-eyebrow">Launch</p>
          <h1 className="page-title">Start an organization.</h1>
          <p className="start-sub">
            Pick a blueprint here. Detailed previews live on the Blueprint page.
          </p>
        </div>
      </header>

      {loadError && (
        <Banner kind="error" className="start-banner">
          {loadError}
        </Banner>
      )}

      <section className="start-launch-minimal" aria-label="Launch selector">
        {loading ? (
          <div className="start-loading-state" role="status" aria-live="polite">
            <Spinner size="sm" /> Loading blueprints…
          </div>
        ) : selectedBlueprint ? (
          <>
            <Card variant="default" padding="md" className="start-selected-card">
              <div className="start-selected-card-top">
                <p className="start-selected-card-label">Selected blueprint</p>
                <span className="start-selected-card-pill">Default</span>
              </div>
              <h2 className="start-selected-card-name">{selectedBlueprint.name}</h2>
              <p className="start-selected-card-tagline">{selectedBlueprint.tagline}</p>
            </Card>

            <div className="start-launch-actions">
              <Link to="/blueprints" className="start-secondary-link">
                Browse blueprints
              </Link>
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleContinue}
                disabled={loading || !selectedBlueprint}
              >
                Launch
              </Button>
            </div>
          </>
        ) : (
          <div className="start-loading-state" role="status" aria-live="polite">
            No blueprints are available yet.
          </div>
        )}
      </section>
    </div>
  );
}
