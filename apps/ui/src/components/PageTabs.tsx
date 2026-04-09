import { useSearchParams } from "react-router-dom";

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
  const [params, setParams] = useSearchParams();
  const active = params.get("tab") || defaultTab || tabs[0]?.id || "";

  const setTab = (id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === (defaultTab || tabs[0]?.id)) {
        next.delete("tab");
      } else {
        next.set("tab", id);
      }
      return next;
    }, { replace: true });
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

export function useActiveTab(tabs: Tab[], defaultTab?: string): string {
  const [params] = useSearchParams();
  return params.get("tab") || defaultTab || tabs[0]?.id || "";
}
