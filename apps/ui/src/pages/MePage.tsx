import { lazy, Suspense, useMemo } from "react";
import { useParams, Navigate, useNavigate } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import MeInboxPage from "@/pages/MeInboxPage";
import TreasuryPage from "@/pages/TreasuryPage";
import { Button, EmptyState } from "@/components/ui";
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
 *
 * Resolution order for the personal Entity:
 *   1. The first `host`-typed entity (the platform-owner placement carved out
 *      for the user's own workspace — see `architecture_user_account_is_company.md`).
 *   2. The first entry in `user.roots` that exists in `entities`.
 *   3. `entities[0]` as final fallback.
 *
 * Once resolved, `entity.agent_id` is the root agent UUID directly off the
 * `/api/entities` payload — no entity-scoped agents fetch required (the
 * daemon's `agents` array is filtered by active X-Entity scope and may not
 * include the personal entity's root when the user is scoped to a company).
 */
function MePersonalRail({ tab }: { tab: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const user = useAuthStore((s) => s.user);

  const personalEntity = useMemo(() => {
    if (entities.length === 0) return null;
    const host = entities.find((e) => e.placement_type === "host");
    if (host) return host;
    const rootIds = user?.roots ?? [];
    for (const rid of rootIds) {
      const match = entities.find((e) => e.id === rid);
      if (match) return match;
    }
    return entities[0] ?? null;
  }, [user?.roots, entities]);

  const personalEntityId = personalEntity?.id ?? null;
  const personalRootAgentId = personalEntity?.agent_id ?? null;

  if (tab === "inbox") return <MeInboxPage />;

  if (tab === "treasury") {
    if (!personalEntityId) return <NoPersonalEntity loaded={initialLoaded} />;
    return <TreasuryPage entityId={personalEntityId} />;
  }

  // agents / events / quests / ideas — route through AgentPage on the personal root agent.
  if (tab === "agents" || tab === "events" || tab === "quests" || tab === "ideas") {
    if (!personalRootAgentId) return <NoPersonalEntity loaded={initialLoaded} />;
    return <AgentPage agentId={personalRootAgentId} tab={tab} />;
  }

  // Unknown tab — fall through to settings.
  // Note: `/me/portfolio` is NOT a personal-rail tab (the locked tabs are
  // Inbox · Agents · Events · Quests · Ideas · Treasury · Settings, per
  // project_personal_rail_v1.md). The previous 308-to-/me/treasury was a
  // dead-end that confused habitual users; dropped 2026-05-08 (UX walk v24).
  // Falls through to ProfilePage (Settings) here, matching every other
  // unknown `/me/<tab>` value.
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}

/**
 * Empty-state fallback for `/me/{agents,quests,ideas,events,treasury}` when
 * the user's personal Entity hasn't materialised yet (initial load in flight,
 * or a pre-2026-05-03 account whose signup pre-dated the auto-create rule).
 *
 * The CTA routes the user to `/start`, which gates on subscription tier and
 * either provisions a personal Company synchronously or surfaces the
 * subscription paywall.
 */
function NoPersonalEntity({ loaded }: { loaded: boolean }) {
  const navigate = useNavigate();
  if (!loaded) {
    // Still loading entities — render nothing rather than flashing the CTA.
    return null;
  }
  return (
    <div style={{ padding: "var(--space-6)" }}>
      <EmptyState
        title="Your personal workspace isn't set up yet"
        description="A personal workspace gives you a private surface for agents, quests, and ideas — separate from any company you join. Spin yours up from /start; it takes about a minute."
        action={
          <Button variant="primary" onClick={() => navigate("/start")}>
            Create my personal workspace
          </Button>
        }
      />
    </div>
  );
}
