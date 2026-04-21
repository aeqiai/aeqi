import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";

interface Tab {
  id: string;
  label: string;
  badge?: number;
}

interface PageTabsProps {
  tabs: Tab[];
  defaultTab?: string;
  /**
   * Tab routing strategy:
   *   - "path" (default): tabs map to `/:agentId/:tab`. Used by agent tabs.
   *   - "query": tabs map to `?tab=…`. Used by sub-tab sets that live inside
   *     a single outer route (e.g. Profile's Profile/Security/API/… tabs,
   *     which sit under `/:agentId/profile` and must not collide with the
   *     outer `:tab` slot).
   */
  mode?: "path" | "query";
}

export default function PageTabs({ tabs, defaultTab, mode = "path" }: PageTabsProps) {
  const { go } = useNav();
  const { agentId, tab: currentTab } = useParams<{ agentId?: string; tab?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = defaultTab || tabs[0]?.id || "";
  const queryTab = searchParams.get("tab");
  const usePath = mode === "path" && !!agentId;
  const pathTab = currentTab && tabs.some((t) => t.id === currentTab) ? currentTab : null;
  const active = usePath
    ? pathTab || fallback
    : queryTab && tabs.some((t) => t.id === queryTab)
      ? queryTab
      : fallback;

  const setTab = (id: string) => {
    if (usePath) {
      // Version B: every tab has its own `/:agentId/:tab` route.
      go(`/${id}`);
      return;
    }
    // Query-string sub-tabs.
    const next = new URLSearchParams(searchParams);
    if (id === fallback) next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
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
