import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Banner, Spinner } from "@/components/ui";
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
 * Bare `/launch` is only the bootstrap entrypoint. Once blueprints load, it
 * replace-navigates to the canonical `/launch/:blueprintId` wizard so the
 * user sees one launch surface instead of a selector plus a wizard.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const isAuthed = authMode === "none" || !!token;
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
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

  const selectedBlueprintId = useMemo(
    () => pickInitialBlueprintId(blueprints, byBlueprintId),
    [blueprints, byBlueprintId],
  );

  if (!isAuthed) return null;

  if (!loading && !loadError && selectedBlueprintId) {
    return <Navigate to={`/launch/${encodeURIComponent(selectedBlueprintId)}`} replace />;
  }

  return (
    <div className="start-page start-page--launch">
      <header className="start-head start-head--launch">
        <div className="start-head-copy">
          <p className="start-eyebrow">Launch</p>
          <h1 className="page-title">Opening your launch wizard…</h1>
          <p className="start-sub">Loading the default blueprint.</p>
        </div>
      </header>

      {loadError && (
        <Banner kind="error" className="start-banner">
          {loadError}
        </Banner>
      )}

      <div className="start-loading-state" role="status" aria-live="polite">
        <Spinner size="sm" /> Loading blueprints…
        <Link to="/blueprints" className="start-secondary-link" style={{ marginLeft: 12 }}>
          Browse blueprints
        </Link>
      </div>
    </div>
  );
}
