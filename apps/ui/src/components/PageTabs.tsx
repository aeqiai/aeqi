import { useNavigate, useParams, useSearchParams } from "react-router-dom";

interface Tab {
  id: string;
  label: string;
  badge?: number;
}

interface PageTabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export default function PageTabs({ tabs, defaultTab }: PageTabsProps) {
  const navigate = useNavigate();
  const { agentId, tab: currentTab } = useParams<{ agentId?: string; tab?: string }>();
  const active =
    currentTab && tabs.some((t) => t.id === currentTab)
      ? currentTab
      : defaultTab || tabs[0]?.id || "";

  const setTab = (id: string) => {
    if (!agentId) return;
    if (id === (defaultTab || tabs[0]?.id)) {
      navigate(`/agents/${agentId}`);
    } else {
      navigate(`/agents/${agentId}/${id}`);
    }
  };

  return (
    <div className="page-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`page-tab${active === tab.id ? " active" : ""}`}
          onClick={() => setTab(tab.id)}
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span className="page-tab-badge">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Legacy helper for pages that still use query-param tabs. */
export function useActiveTab(tabs: { id: string }[], defaultTab?: string): string {
  const [params] = useSearchParams();
  return params.get("tab") || defaultTab || tabs[0]?.id || "";
}
