import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";
import { Spinner } from "@/components/ui";
import { Events, useTrack } from "@/lib/analytics";

/**
 * `/start` — in-shell company creation.
 *
 * The platform mints `entity_id` (UUID) synchronously in
 * `/api/start/launch`, so we navigate to `/c/<entity_id>/positions`
 * immediately. The placement's `status` field flips from `pending` to
 * `ready` async; the destination route shows the inline provisioning
 * state until that flips. Tier-aware copy + timeout selection live on
 * the placement (sandbox: 30s, vps: ~3min) — the destination
 * route reads `placement_type` and renders accordingly.
 *
 * Auth gate: anonymous visitors bounce to `/signup?next=/start`.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const track = useTrack();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);

  const isAuthed = authMode === "none" || !!token;

  useEffect(() => {
    document.title = "Start a company · aeqi";
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      navigate(`/signup?next=${encodeURIComponent("/start")}`, { replace: true });
      return;
    }
    track(Events.CompanyCreateStart, { surface: "start" });
  }, [isAuthed, navigate, track]);

  const [navigating, setNavigating] = useState(false);

  const handleSpawned = useCallback(
    async (entityId: string) => {
      track(Events.CompanyCreated, { surface: "start", entity_id: entityId });
      setNavigating(true);
      setActiveEntity(entityId);
      // Refresh entities + agents so the destination route paints
      // immediately. Failures are non-fatal — the destination route
      // refetches on mount.
      await Promise.all([fetchEntities(), fetchAgents()]).catch(() => {});
      navigate(`/c/${encodeURIComponent(entityId)}/positions`);
    },
    [track, setActiveEntity, fetchEntities, fetchAgents, navigate],
  );

  if (!isAuthed) return null;

  if (navigating) {
    return (
      <div className="start-page">
        <header className="start-head">
          <h1 className="page-title">Provisioning your company…</h1>
          <p className="start-sub">
            <Spinner size="sm" /> Usually takes 5–15 seconds.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="start-page">
      <header className="start-head">
        <h1 className="page-title">Start a company</h1>
        <p className="start-sub">
          Pick a blueprint, or start blank. You can always add more agents later.
        </p>
      </header>
      <BlueprintLaunchPicker mode="spawn-company" onSpawnedCompany={handleSpawned} />
    </div>
  );
}
