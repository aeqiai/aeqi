import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  /**
   * When set, tabs navigate to `${basePath}/${tabId}` directly. The
   * default tab drops the suffix so the canonical home is `${basePath}`
   * (e.g. `/settings` rather than `/settings/profile`). Takes precedence
   * over `mode` — used by user-scope shells like `/settings` that don't
   * fit the agent-scoped `/:agentId/:tab` shape.
   */
  basePath?: string;
  /**
   * Optional content rendered at the bottom of the rail, separated by a
   * faint divider. Use for affordances that aren't tabs (e.g. a "+ New"
   * action that lives next to the navigation but isn't part of it).
   */
  footer?: React.ReactNode;
  /**
   * Override the active tab detection. PageRail's default lookup reads
   * `:tab` from useParams, which only works for routes named `:tab`.
   * Pages whose section param is named differently (e.g. `:section`) can
   * pass the resolved value here so the active state stays in sync.
   */
  currentValue?: string;
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
export default function PageRail({
  tabs,
  defaultTab,
  title,
  mode = "query",
  basePath,
  footer,
  currentValue,
}: PageRailProps) {
  const { go } = useNav();
  const navigate = useNavigate();
  const { agentId, tab: currentTab } = useParams<{ agentId?: string; tab?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = defaultTab || tabs[0]?.id || "";
  const queryTab = searchParams.get("tab");
  const usePath = mode === "path" && !!agentId;
  const useBasePath = !!basePath;
  const resolvedCurrent = currentValue ?? currentTab;
  const pathTab =
    resolvedCurrent && tabs.some((t) => t.id === resolvedCurrent) ? resolvedCurrent : null;
  const active = useBasePath
    ? pathTab || fallback
    : usePath
      ? pathTab || fallback
      : queryTab && tabs.some((t) => t.id === queryTab)
        ? queryTab
        : fallback;

  const setTab = (id: string) => {
    if (useBasePath && basePath) {
      const target = id === fallback ? basePath : `${basePath}/${id}`;
      navigate(target);
      return;
    }
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
      {footer && <div className="page-rail-footer">{footer}</div>}
    </nav>
  );
}
