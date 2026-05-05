import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import GovernancePage from "@/pages/GovernancePage";
import CompanySettingsPage from "@/pages/CompanySettingsPage";
import MeInboxPage from "@/pages/MeInboxPage";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";

const TAB_TITLES: Record<string, string> = {
  overview: "overview",
  inbox: "inbox",
  roles: "roles",
  ownership: "ownership",
  treasury: "treasury",
  governance: "governance",
  settings: "settings",
};

interface CompanyPageProps {
  agentId: string;
  entityId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/c/<entity>` URL renders Overview through this tab default. */
  tab: string;
  itemId?: string;
}

/**
 * Phase-1 sidebar lock: each former Company sub-tab is now a top-level
 * sidebar row. The internal `PageRail` is removed; CompanyPage just
 * dispatches the right component per tab.
 *
 * Routes:
 *   /c/:entityId               → AgentPage tab="overview" (cockpit)
 *   /c/:entityId/inbox         → MeInboxPage
 *   /c/:entityId/roles         → AgentPage tab="roles" (EntityRolesTab)
 *   /c/:entityId/ownership     → OwnershipPage
 *   /c/:entityId/treasury      → TreasuryPage
 *   /c/:entityId/governance    → GovernancePage
 *   /c/:entityId/settings      → CompanySettingsPage
 *
 * Every other tab name (agents, events, quests, ideas, sessions, …)
 * falls through to AgentPage, which is the canonical primitive surface.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { entity } = useCurrentCompany();

  // Title effect
  useEffect(() => {
    const section = TAB_TITLES[tab] ?? "company";
    document.title = `${section} · æqi`;
  }, [tab]);

  // Trust-address redirect: when entity gains a trust_address, redirect to
  // the canonical /trust/<address>/tab URL (once registerTRUST lands).
  // Idempotent: skips if already on /trust/ route.
  useEffect(() => {
    // Skip if we're already on the /trust/ canonical URL or if entity has no trust_address
    if (!entity?.trust_address || location.pathname.startsWith("/trust/")) {
      return;
    }

    // Construct the target path: /trust/<address>/<tab>[/itemId]
    const trustAddr = entity.trust_address.toLowerCase();
    let targetPath = `/trust/${encodeURIComponent(trustAddr)}/${tab}`;
    if (itemId) {
      targetPath += `/${encodeURIComponent(itemId)}`;
    }

    // Replace the history entry so the user doesn't pollute their back-button
    navigate(targetPath, { replace: true });
  }, [entity?.trust_address, tab, itemId, navigate, location.pathname]);

  // Inbox is the company-scoped action queue. Visually it's MeInbox
  // for now (Phase-1 cross-company aggregation lives at top-level
  // /inbox in WS-57).
  if (tab === "inbox") return <MeInboxPage />;
  if (tab === "ownership") return <OwnershipPage entityId={entityId} />;
  if (tab === "treasury") return <TreasuryPage entityId={entityId} />;
  if (tab === "governance") return <GovernancePage entityId={entityId} />;
  if (tab === "settings") return <CompanySettingsPage agentId={agentId} />;

  // Overview, Roles, and any other primitive tab (agents, events,
  // quests, ideas) render through AgentPage on the entity's root agent.
  return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
}
