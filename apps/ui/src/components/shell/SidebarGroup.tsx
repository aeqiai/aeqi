import type { ReactNode } from "react";
import { useUIStore } from "@/store/ui";

interface SidebarGroupProps {
  title: string;
  groupKey: string;
  children: ReactNode;
}

export default function SidebarGroup({ title, groupKey, children }: SidebarGroupProps) {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const groupCollapsed = useUIStore((s) => !!s.collapsedGroups[groupKey]);
  const toggle = useUIStore((s) => s.toggleGroup);
  // When the whole rail is collapsed the group title is hidden, so the
  // user can't toggle anyway — force items visible so every nav row
  // remains reachable as a stack of icons.
  const collapsed = !sidebarCollapsed && groupCollapsed;

  return (
    <div className={`sidebar-group${collapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-group-title"
        onClick={() => toggle(groupKey)}
        aria-expanded={!collapsed}
        aria-controls={`sidebar-group-${groupKey}`}
      >
        <span className="sidebar-group-chevron" aria-hidden="true">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            width={9}
            height={9}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
        <span className="sidebar-group-label">{title}</span>
      </button>
      {!collapsed && (
        <div className="sidebar-group-items" id={`sidebar-group-${groupKey}`}>
          {children}
        </div>
      )}
    </div>
  );
}
