import { lazy, Suspense, useMemo } from "react";
import { useParams, Navigate } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import MeInboxPage from "@/pages/MeInboxPage";
import TreasuryPage from "@/pages/TreasuryPage";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";

const ProfilePage = lazy(() => import("@/pages/ProfilePage"));

/**
 * Known settings sub-tab IDs that ProfilePage handles internally.
 * Any /me/<tab> matching these routes through ProfilePage.
 */
const SETTINGS_TABS = new Set([
  "profile",
  "billing",
  "security",
  "wallets",
  "devices",
  "integrations",
  "api",
  "invites",
  "preferences",
]);

/**
 * `/me` — personal entity dispatcher.
 *
 * Personal rail tab order (locked 2026-05-03):
 *   Inbox · Agents · Events · Quests · Ideas · Treasury · Settings
 *
 * `/me/settings` and any known settings sub-tabs route through ProfilePage.
 * All other personal-rail tabs render their entity-scoped pages against the
 * user's personal Company entity (the auto-created 1-owner entity from signup).
 *
 * Backward compat: existing bookmarks to /me/billing, /me/security, etc. keep
 * working — those IDs are in SETTINGS_TABS.
 */
export default function MePage() {
  const { tab } = useParams<{ tab?: string }>();

  // Bare /me → inbox
  if (!tab) return <Navigate to="/me/inbox" replace />;

  // Settings sub-tabs including the top-level "settings" tab
  if (tab === "settings" || SETTINGS_TABS.has(tab)) {
    return (
      <Suspense fallback={null}>
        <ProfilePage />
      </Suspense>
    );
  }

  // Personal-rail primitive tabs
  return <MePersonalRail tab={tab} />;
}

/**
 * Renders personal entity tabs (inbox / agents / events / quests / ideas / treasury).
 * Resolves the personal entity from the user's roots array against the entities list.
 * Falls back to the first entity when the roots match fails.
 */
function MePersonalRail({ tab }: { tab: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const user = useAuthStore((s) => s.user);

  // Resolve the personal entity: prefer the first entry in user.roots that
  // exists in our entities list; fall back to entities[0].
  const personalEntityId = useMemo(() => {
    const rootIds = user?.roots ?? [];
    for (const rid of rootIds) {
      if (entities.some((e) => e.id === rid)) return rid;
    }
    return entities[0]?.id ?? null;
  }, [user?.roots, entities]);

  const personalRootAgent = useMemo(
    () =>
      personalEntityId ? (agents.find((a) => a.entity_id === personalEntityId) ?? null) : null,
    [agents, personalEntityId],
  );

  if (tab === "inbox") return <MeInboxPage />;

  if (tab === "treasury") {
    if (!personalEntityId)
      return (
        <div
          style={{
            padding: "var(--space-6)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-base)",
          }}
        >
          No personal entity found.
        </div>
      );
    return <TreasuryPage entityId={personalEntityId} />;
  }

  // agents / events / quests / ideas — route through AgentPage on the personal root agent.
  if (tab === "agents" || tab === "events" || tab === "quests" || tab === "ideas") {
    if (!personalRootAgent?.id)
      return (
        <div
          style={{
            padding: "var(--space-6)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-base)",
          }}
        >
          No personal entity found.
        </div>
      );
    return <AgentPage agentId={personalRootAgent.id} tab={tab} />;
  }

  // Retired route — portfolio moved to treasury
  if (tab === "portfolio") return <Navigate to="/me/treasury" replace />;

  // Unknown tab — fall through to settings
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
