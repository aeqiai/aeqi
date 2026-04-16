import { useState, useId } from "react";
import styles from "./Tabs.module.css";

export interface Tab {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id || "");
  const baseId = useId();

  return (
    <>
      <div className={styles.tablist} role="tablist">
        {tabs.map((tab) => {
          const isSelected = active === tab.id;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              className={styles.tab}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => {
                const idx = tabs.findIndex((t) => t.id === active);
                let next = -1;
                if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
                if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
                if (next >= 0) {
                  e.preventDefault();
                  setActive(tabs[next].id);
                  const el = document.getElementById(`${baseId}-tab-${tabs[next].id}`);
                  el?.focus();
                }
              }}
            >
              {tab.label}
              {tab.count != null ? ` (${tab.count})` : ""}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          className={styles.tabpanel}
          tabIndex={0}
          hidden={active !== tab.id}
        >
          {active === tab.id && tab.content}
        </div>
      ))}
    </>
  );
}

Tabs.displayName = "Tabs";
