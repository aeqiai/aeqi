import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageRail from "@/components/PageRail";
import ProfilePanel from "@/pages/Settings/ProfilePanel";
import BillingPanel from "@/pages/Settings/BillingPanel";
import SecurityPanel from "@/pages/Settings/SecurityPanel";
import DevicesPanel from "@/pages/Settings/DevicesPanel";
import SettingsIntegrationsPage from "@/pages/Settings/Integrations";
import ApiKeyPanel from "@/pages/Settings/ApiKeyPanel";
import InvitesPanel from "@/pages/Settings/InvitesPanel";
import PreferencesPanel from "@/pages/Settings/PreferencesPanel";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "billing", label: "Billing" },
  { id: "security", label: "Security" },
  { id: "devices", label: "Devices" },
  { id: "integrations", label: "Integrations" },
  { id: "api", label: "API keys" },
  { id: "invites", label: "Invites" },
  { id: "preferences", label: "Preferences" },
];

/**
 * `/settings` — user-scoped account settings shell. Each tab lives in
 * its own component under `pages/Settings/` and owns its own state +
 * data-fetching. This file is a thin router: pick the right panel for
 * the active tab. Splitting was driven by the page reaching 878 lines
 * with six tabs' worth of state interleaved in a single component;
 * the ApiKey + Integrations tabs were already external, the rest
 * followed.
 *
 * Tabs are path-based (`/settings/:tab`) to match the rest of the app;
 * legacy `?tab=` URLs redirect to the path form on mount.
 */
export default function ProfilePage() {
  const { tab } = useParams<{ tab?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Backwards-compat: old bookmarks of `/settings?tab=security` get
  // bounced to `/settings/security` once on mount, then the param is
  // dropped from the address bar.
  useEffect(() => {
    const legacy = searchParams.get("tab");
    if (!legacy) return;
    const known = TABS.some((t) => t.id === legacy);
    const target = known && legacy !== "profile" ? `/settings/${legacy}` : "/settings";
    navigate(target, { replace: true });
  }, [searchParams, navigate]);

  const activeTab = tab && TABS.some((t) => t.id === tab) ? tab : "profile";

  return (
    <div className="page-rail-shell">
      <PageRail tabs={TABS} defaultTab="profile" title="Settings" basePath="/settings" />
      <div className="account-page page-rail-content">
        {activeTab === "profile" && <ProfilePanel />}
        {activeTab === "billing" && <BillingPanel />}
        {activeTab === "security" && <SecurityPanel />}
        {activeTab === "devices" && <DevicesPanel />}
        {activeTab === "integrations" && <SettingsIntegrationsPage />}
        {activeTab === "api" && <ApiKeyPanel />}
        {activeTab === "invites" && <InvitesPanel />}
        {activeTab === "preferences" && <PreferencesPanel />}
      </div>
    </div>
  );
}
