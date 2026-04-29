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
 * Renders inside `AppLayout` (LeftSidebar visible, same chrome as
 * `/economy/blueprints` and `/account`) — never a fullscreen wizard.
 * Drops the legacy plan-card / pricing surface; pricing lives on a
 * billing surface, not the picker. The picker is the shared
 * `BlueprintLaunchPicker` that `+ New agent` also renders, just in
 * `spawn-company` mode.
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
    document.title = "Start a Company · aeqi";
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      navigate(`/signup?next=${encodeURIComponent("/start")}`, { replace: true });
      return;
    }
    track(Events.CompanyCreateStart, { surface: "start" });
  }, [isAuthed, navigate, track]);

  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // After spawn, the platform returns the slug synchronously but the
  // canonical entity_id only materializes once the sandbox runtime
  // boots and reports back. Poll fetchEntities() until we have a real
  // entity record matching the slug, then navigate by entity_id. The
  // URL is /c/<entity_id>/... — never the slug.
  useEffect(() => {
    if (!pendingSlug) return;
    let cancelled = false;
    const start = Date.now();
    const timeoutMs = 60_000;
    const intervalMs = 1500;

    const tick = async () => {
      if (cancelled) return;
      await fetchEntities();
      if (cancelled) return;
      const entities = useDaemonStore.getState().entities;
      const match = entities.find(
        (e) => e.id === pendingSlug || (e as { slug?: string }).slug === pendingSlug,
      );
      if (match && match.id && match.id !== pendingSlug) {
        // entity_id is back-filled and is a real UUID, not the slug.
        setActiveEntity(match.id);
        await fetchAgents();
        navigate(`/c/${encodeURIComponent(match.id)}/positions`);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        setPollError(
          "Provisioning is taking longer than usual. Refresh in a minute and pick the new company from the switcher.",
        );
        setPendingSlug(null);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, [pendingSlug, fetchAgents, fetchEntities, navigate, setActiveEntity]);

  const handleSpawned = useCallback(
    (rootSlug: string) => {
      track(Events.CompanyCreated, { surface: "start", root: rootSlug });
      setPollError(null);
      setPendingSlug(rootSlug);
    },
    [track],
  );

  if (!isAuthed) return null;

  if (pendingSlug) {
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
        {pollError && (
          <p className="start-sub" role="alert">
            {pollError}
          </p>
        )}
      </header>
      <BlueprintLaunchPicker mode="spawn-company" onSpawnedCompany={handleSpawned} />
    </div>
  );
}
