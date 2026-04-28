import type { ReactNode } from "react";
import { useUIStore } from "@/store/ui";

interface SidebarGroupProps {
  title: string;
  groupKey: string;
  children: ReactNode;
  /** Mark the entire group as "coming soon" — appends a trailing chip to the
   * group title. Items inside still render; mark each as soon individually
   * if they're not yet reachable. */
  soon?: boolean;
}

export default function SidebarGroup({
  title,
  groupKey,
  children,
  soon = false,
}: SidebarGroupProps) {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const groupCollapsed = useUIStore((s) => !!s.collapsedGroups[groupKey]);
  const toggle = useUIStore((s) => s.toggleGroup);
  // When the whole rail is collapsed the group title is hidden, so the
  // user can't toggle anyway — force items visible so every nav row
  // remains reachable as a stack of icons.
  const collapsed = !sidebarCollapsed && groupCollapsed;

  return (
    <div
      className={`sidebar-group${collapsed ? " collapsed" : ""}${soon ? " sidebar-group--soon" : ""}`}
    >
      <button
        type="button"
        className="sidebar-group-title"
        onClick={() => toggle(groupKey)}
        aria-expanded={!collapsed}
        aria-controls={`sidebar-group-${groupKey}`}
      >
        <span className="sidebar-group-label">{title}</span>
        {soon && <span className="sidebar-group-soon">soon</span>}
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
      </button>
      {!collapsed && (
        <div className="sidebar-group-items" id={`sidebar-group-${groupKey}`}>
          {children}
        </div>
      )}
    </div>
  );
}
