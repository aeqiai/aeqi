import { useActiveTab } from "@/components/PageTabs";
import PageRail from "@/components/PageRail";
import ProfilePanel from "@/pages/Settings/ProfilePanel";
import SecurityPanel from "@/pages/Settings/SecurityPanel";
import DevicesPanel from "@/pages/Settings/DevicesPanel";
import SettingsIntegrationsPage from "@/pages/Settings/Integrations";
import ApiKeyPanel from "@/pages/Settings/ApiKeyPanel";
import InvitesPanel from "@/pages/Settings/InvitesPanel";
import PreferencesPanel from "@/pages/Settings/PreferencesPanel";

const TABS = [
  { id: "profile", label: "Profile" },
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
 */
export default function ProfilePage() {
  const activeTab = useActiveTab(TABS, "profile");

  return (
    <div className="settings-layout">
      <PageRail tabs={TABS} defaultTab="profile" title="Settings" />
      <div className="account-page settings-content">
        {activeTab === "profile" && <ProfilePanel />}
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
