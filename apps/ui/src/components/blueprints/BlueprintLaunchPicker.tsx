import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { Card, Loading } from "@/components/ui";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

export type BlueprintLaunchMode = "spawn-company" | "spawn-into-entity";

interface BlueprintLaunchPickerProps {
  mode: BlueprintLaunchMode;
  /** Required when `mode === "spawn-into-entity"`. The host entity that
   *  the picked Blueprint attaches under. */
  trustId?: string;
  /** Optional `parts` filter for `spawn-into-entity`. When set, only the
   *  named seed blocks materialize on spawn (e.g. `["ideas"]` for the
   *  Ideas Import flow). Omit for full-company import. */
  parts?: string[];
  /** Fired after a successful `spawn-into-entity`. Receives the id of the
   *  blueprint that was merged in (the modal version uses this to close
   *  itself + refresh). spawn-company mode no longer fires a callback —
   *  it navigates to the setup surface instead. */
  onSpawnedAgent?: (blueprintId: string) => void;
  /** Optional query string appended when `mode === "spawn-company"`.
   *  Used by `/launch` to carry the selected blueprint into setup. */
  launchQuery?: string;
}

/**
 * Shared picker UX for `/launch` and the `+ New agent` modal. Three sections:
 *
 *   1. Start blank — promoted top row.
 *   2. Recommended — 3-4 curated ids from `recommendedBlueprints.ts`.
 *   3. Browse all → /blueprints — full catalog.
 *
 * Branches on `mode`:
 *   - spawn-company → navigate to /launch/<blueprintId> (TrustSetupPage)
 *     so the operator confirms name + mission + plan before launch
 *   - spawn-into-entity → POST /api/blueprints/spawn-into
 *     (a "merge into existing company" flow — no naming or billing
 *     concerns to surface)
 *
 * No bespoke colors / sizes — reuses `Card`, `Loading`, and the
 * `bp-card-*` typography vocabulary from the catalog.
 */
export function BlueprintLaunchPicker({
  mode,
  trustId,
  parts,
  onSpawnedAgent,
  launchQuery,
}: BlueprintLaunchPickerProps) {
  const navigate = useNavigate();
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]); // only single blueprints
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingBlueprintId, setSubmittingBlueprintId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const byId = useMemo(() => {
    const m = new Map<string, Blueprint>();
    for (const b of blueprints) m.set(blueprintId(b), b);
    return m;
  }, [blueprints]);

  // Drop unknown ids silently — the catalog is the source of truth, so a
  // typo or a retired blueprint shouldn't render a broken card.
  const recommended = useMemo(
    () => RECOMMENDED_BLUEPRINTS.map((id) => byId.get(id)).filter((t): t is Blueprint => !!t),
    [byId],
  );

  const blank = byId.get("blank") ?? null;

  const launch = useCallback(
    async (id: string) => {
      const tpl = byId.get(id);
      if (!tpl) {
        setSubmitError(`Blueprint '${id}' is not available.`);
        return;
      }
      // spawn-company mode: route through the setup surface so the
      // operator can confirm a name, stage role overrides, and pick
      // a plan before the actual spawn fires. The picker no longer
      // launches directly — that was a pre-Phase-B shortcut.
      // spawn-into-entity stays direct because it's a "merge this
      // blueprint into my existing company" flow with no naming or
      // billing concerns to surface.
      if (mode === "spawn-company") {
        navigate(`/launch/${encodeURIComponent(blueprintId(tpl))}${launchQuery ?? ""}`);
        return;
      }
      setSubmittingBlueprintId(id);
      setSubmitError(null);
      try {
        if (!trustId) throw new Error("Missing entity id for spawn-into-entity.");
        await api.spawnBlueprintIntoEntity({
          blueprint: blueprintId(tpl),
          trust_id: trustId,
          parts,
        });
        onSpawnedAgent?.(blueprintId(tpl));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not spawn.";
        setSubmitError(msg);
        setSubmittingBlueprintId(null);
      }
    },
    [byId, mode, trustId, parts, onSpawnedAgent, navigate, launchQuery],
  );

  const isBusy = submittingBlueprintId !== null;

  if (loading) {
    return (
      <div className="bp-launch">
        <div className="bp-status">
          <Loading size="sm" /> Loading Blueprints…
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
          onClick={() => void launch(blueprintId(blank))}
          disabled={isBusy}
          aria-label={`${blank.name} — ${blank.tagline ?? ""}`}
        >
          <span className="bp-launch-blank-body">
            <span className="bp-launch-blank-name">Start blank</span>
            {blank.tagline && <span className="bp-launch-blank-tagline">{blank.tagline}</span>}
          </span>
          <span className="bp-launch-blank-cue" aria-hidden>
            {submittingBlueprintId === blueprintId(blank) ? <Loading size="sm" /> : "→"}
          </span>
        </button>
      )}

      {/* 2 — Recommended. 3-4 curated cards. */}
      {recommended.length > 0 && (
        <section className="bp-launch-section" aria-label="Recommended Blueprints">
          <h3 className="bp-launch-section-label">Recommended</h3>
          <div className="bp-launch-grid" role="list">
            {recommended.map((t) => {
              const busy = submittingBlueprintId === blueprintId(t);
              return (
                <button
                  key={blueprintId(t)}
                  type="button"
                  className="bp-launch-card-btn"
                  role="listitem"
                  onClick={() => void launch(blueprintId(t))}
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
                          <Loading size="sm" /> Launching…
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
        <Link to="/blueprints" className="bp-launch-browse-link">
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
function formatSeedMeta(t: Blueprint): string {
  const parts: string[] = [];
  const a = t.seed_agents?.length ?? 0;
  const i = t.seed_ideas?.length ?? 0;
  const e = t.seed_events?.length ?? 0;
  const q = t.seed_quests?.length ?? 0;
  const v = t.seed_views?.length ?? 0;
  const totalAgents = 1 + a;
  parts.push(`${totalAgents} ${totalAgents === 1 ? "agent" : "agents"}`);
  if (v > 0) parts.push(`${v} ${v === 1 ? "view" : "views"}`);
  if (i > 0) parts.push(`${i} ${i === 1 ? "idea" : "ideas"}`);
  if (e > 0) parts.push(`${e} ${e === 1 ? "event" : "events"}`);
  if (q > 0) parts.push(`${q} ${q === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}
