import { useSearchParams } from "react-router-dom";

interface RailItem {
  id: string;
  label: string;
  badge?: number;
}

interface PageRailProps {
  tabs: RailItem[];
  defaultTab?: string;
}

/**
 * Vertical secondary rail — settings-page navigation.
 *
 * Same data shape and URL-driving logic as PageTabs but rendered as a
 * left-aligned column of rows instead of a row of horizontal pills.
 * The horizontal pill layout caps out at ~3-5 items before it crowds;
 * settings pages routinely need 6+ sections (Profile / Security /
 * Integrations / API keys / Invites / Preferences / …) and are
 * read like a list, not a tab strip. This component owns that shape.
 *
 * Active state driven by the `?tab=…` query param (matches PageTabs
 * `mode="query"`). Pages wire it inside a two-column container — the
 * rail on the left, the active section's content on the right.
 */
export default function PageRail({ tabs, defaultTab }: PageRailProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = defaultTab || tabs[0]?.id || "";
  const queryTab = searchParams.get("tab");
  const active = queryTab && tabs.some((t) => t.id === queryTab) ? queryTab : fallback;

  const setTab = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id === fallback) next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
  };

  return (
    <nav className="page-rail" role="tablist" aria-orientation="vertical">
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
