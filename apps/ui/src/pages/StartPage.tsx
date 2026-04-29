import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";
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

  const handleSpawned = useCallback(
    async (rootSlug: string) => {
      track(Events.CompanyCreated, { surface: "start", root: rootSlug });
      setActiveEntity(rootSlug);
      await Promise.all([fetchAgents(), fetchEntities()]);
      navigate(`/${encodeURIComponent(rootSlug)}/positions`);
    },
    [fetchAgents, fetchEntities, navigate, setActiveEntity, track],
  );

  if (!isAuthed) return null;

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
