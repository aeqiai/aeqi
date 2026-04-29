import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { CompanyTemplate } from "@/lib/types";
import { Card, Spinner } from "@/components/ui";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

export type BlueprintLaunchMode = "spawn-company" | "spawn-into-entity";

interface BlueprintLaunchPickerProps {
  mode: BlueprintLaunchMode;
  /** Required when `mode === "spawn-into-entity"`. The host entity that
   *  the picked Blueprint attaches under. */
  entityId?: string;
  /** Fired after a successful `spawn-company`. Receives the new entity slug
   *  so callers can navigate. */
  onSpawnedCompany?: (slug: string) => void;
  /** Fired after a successful `spawn-into-entity`. Receives the slug of the
   *  blueprint that was merged in (the modal version uses this to close
   *  itself + refresh). */
  onSpawnedAgent?: (slug: string) => void;
}

/**
 * Shared picker UX for `/start` and the `+ New agent` modal. Three sections:
 *
 *   1. Start blank — promoted top row, spawns the `blank` blueprint.
 *   2. Recommended — 3-4 curated slugs from `recommendedBlueprints.ts`.
 *   3. Browse all → /economy/blueprints — full catalog.
 *
 * Branches on `mode` for the spawn API:
 *   - spawn-company → POST /api/start/launch
 *   - spawn-into-entity → POST /api/blueprints/spawn-into
 *
 * No bespoke colors / sizes — reuses `Card`, `Spinner`, and the
 * `bp-card-*` typography vocabulary from the catalog.
 */
export function BlueprintLaunchPicker({
  mode,
  entityId,
  onSpawnedCompany,
  onSpawnedAgent,
}: BlueprintLaunchPickerProps) {
  const [blueprints, setBlueprints] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingSlug, setSubmittingSlug] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        setBlueprints(resp.blueprints ?? []);
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
    const m = new Map<string, CompanyTemplate>();
    for (const b of blueprints) m.set(b.slug, b);
    return m;
  }, [blueprints]);

  // Drop unknown slugs silently — the catalog is the source of truth, so a
  // typo or a retired blueprint shouldn't render a broken card.
  const recommended = useMemo(
    () =>
      RECOMMENDED_BLUEPRINTS.map((slug) => bySlug.get(slug)).filter(
        (t): t is CompanyTemplate => !!t,
      ),
    [bySlug],
  );

  const blank = bySlug.get("blank") ?? null;

  const launch = useCallback(
    async (slug: string) => {
      const tpl = bySlug.get(slug);
      if (!tpl) {
        setSubmitError(`Blueprint '${slug}' is not available.`);
        return;
      }
      setSubmittingSlug(slug);
      setSubmitError(null);
      try {
        if (mode === "spawn-company") {
          const resp = await api.startLaunch({ template: tpl.slug, name: tpl.name });
          if (!resp.ok || !resp.root) throw new Error("Launch returned no slug.");
          onSpawnedCompany?.(resp.root);
        } else {
          if (!entityId) throw new Error("Missing entity id for spawn-into-entity.");
          await api.spawnBlueprintIntoEntity({ blueprint: tpl.slug, entity_id: entityId });
          onSpawnedAgent?.(tpl.slug);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not spawn.";
        setSubmitError(msg);
        setSubmittingSlug(null);
      }
    },
    [bySlug, mode, entityId, onSpawnedCompany, onSpawnedAgent],
  );

  const isBusy = submittingSlug !== null;

  if (loading) {
    return (
      <div className="bp-launch">
        <div className="bp-status">
          <Spinner size="sm" /> Loading Blueprints…
        </div>
      </div>
    );
  }

  return (
    <div className="bp-launch">
      {loadError && (
        <div className="bp-error" role="alert">
          {loadError}
        </div>
      )}

      {submitError && (
        <div className="bp-error" role="alert">
          {submitError}
        </div>
      )}

      {/* 1 — Start blank. Promoted single row at the top. */}
      {blank && (
        <button
          type="button"
          className="bp-launch-blank"
          onClick={() => void launch(blank.slug)}
          disabled={isBusy}
          aria-label={`${blank.name} — ${blank.tagline ?? ""}`}
        >
          <span className="bp-launch-blank-body">
            <span className="bp-launch-blank-name">Start blank</span>
            {blank.tagline && <span className="bp-launch-blank-tagline">{blank.tagline}</span>}
          </span>
          <span className="bp-launch-blank-cue" aria-hidden>
            {submittingSlug === blank.slug ? <Spinner size="sm" /> : "→"}
          </span>
        </button>
      )}

      {/* 2 — Recommended. 3-4 curated cards. */}
      {recommended.length > 0 && (
        <section className="bp-launch-section" aria-label="Recommended Blueprints">
          <h3 className="bp-launch-section-label">Recommended</h3>
          <div className="bp-launch-grid" role="list">
            {recommended.map((t) => {
              const busy = submittingSlug === t.slug;
              return (
                <button
                  key={t.slug}
                  type="button"
                  className="bp-launch-card-btn"
                  role="listitem"
                  onClick={() => void launch(t.slug)}
                  disabled={isBusy}
                  aria-label={`${t.name}${t.tagline ? ` — ${t.tagline}` : ""}`}
                >
                  <Card
                    variant="default"
                    padding="md"
                    interactive
                    className="bp-card bp-launch-card"
                  >
                    <h4 className="bp-card-name">{t.name}</h4>
                    {t.tagline && <p className="bp-card-tagline">{t.tagline}</p>}
                    <p className="bp-card-meta">
                      {busy ? (
                        <span className="bp-launch-card-busy">
                          <Spinner size="sm" /> Launching…
                        </span>
                      ) : (
                        formatSeedMeta(t)
                      )}
                    </p>
                  </Card>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 3 — Browse all. Link out to the full catalog. */}
      <div className="bp-launch-foot">
        <Link to="/economy/blueprints" className="bp-launch-browse-link">
          Browse all Blueprints →
        </Link>
      </div>
    </div>
  );
}

/** Compact human meta — "2 agents · 1 idea · 1 event", zeros skipped.
 *  Kept inline (and not extracted to a shared util) because the catalog's
 *  `formatSeedMeta` lives in `BlueprintCard.tsx` as a private helper too —
 *  duplicating one tiny pure function is cheaper than introducing a util
 *  module both files have to import. */
function formatSeedMeta(t: CompanyTemplate): string {
  const parts: string[] = [];
  const a = t.seed_agents?.length ?? 0;
  const i = t.seed_ideas?.length ?? 0;
  const e = t.seed_events?.length ?? 0;
  const q = t.seed_quests?.length ?? 0;
  const totalAgents = 1 + a;
  parts.push(`${totalAgents} ${totalAgents === 1 ? "agent" : "agents"}`);
  if (i > 0) parts.push(`${i} ${i === 1 ? "idea" : "ideas"}`);
  if (e > 0) parts.push(`${e} ${e === 1 ? "event" : "events"}`);
  if (q > 0) parts.push(`${q} ${q === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}
