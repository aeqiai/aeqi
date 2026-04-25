import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";

interface RailItem {
  id: string;
  label: string;
  badge?: number;
}

interface PageRailProps {
  tabs: RailItem[];
  defaultTab?: string;
  /**
   * Optional heading rendered at the top of the rail. Anchors the
   * column with a label so users see "Settings" / "Profile" / etc.
   * before the row list. Falls through to no heading when omitted.
   */
  title?: string;
  /**
   * Routing strategy — mirrors PageTabs:
   *   - "query" (default): tabs drive `?tab=…`. Used for sub-tab sets
   *     that live inside a single outer route.
   *   - "path": tabs map to `/<agentId>/:tab`. Used for agent-scoped
   *     settings sub-tabs.
   */
  mode?: "query" | "path";
}

/**
 * Vertical secondary rail — settings-page navigation.
 *
 * Same data shape and URL-driving logic as PageTabs but rendered as a
 * left-aligned column of rows. The horizontal pill layout caps out at
 * ~3-5 items before it crowds; settings pages routinely need 6+
 * sections and are read like a list, not a tab strip. This component
 * owns that shape.
 *
 * Pages wire it inside a two-column container — the rail on the left,
 * the active section's content on the right.
 */
export default function PageRail({ tabs, defaultTab, title, mode = "query" }: PageRailProps) {
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
      go(`/${id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (id === fallback) next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
  };

  return (
    <nav className="page-rail" role="tablist" aria-orientation="vertical">
      {title && <h2 className="page-rail-title">{title}</h2>}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`page-rail-item${active === tab.id ? " active" : ""}`}
          onClick={() => setTab(tab.id)}
        >
          <span className="page-rail-label">{tab.label}</span>
          {tab.badge != null && tab.badge > 0 && (
            <span className="page-rail-badge">{tab.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
