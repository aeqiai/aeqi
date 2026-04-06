export const STATUS_COLORS: Record<string, string> = {
  idle: "var(--text-secondary)",
  working: "var(--accent)",
  offline: "var(--text-muted)",
  active: "var(--success)",
  paused: "var(--text-muted)",
  pending: "var(--text-secondary)",
  in_progress: "var(--info)",
  done: "var(--success)",
  blocked: "var(--warning)",
  cancelled: "var(--text-muted)",
  failed: "var(--error)",
};

export const STATUS_BG_COLORS: Record<string, string> = {
  idle: "rgba(136, 136, 160, 0.1)",
  working: "rgba(99, 102, 241, 0.1)",
  offline: "rgba(85, 85, 106, 0.1)",
  active: "rgba(34, 197, 94, 0.1)",
  paused: "rgba(85, 85, 106, 0.1)",
  pending: "rgba(136, 136, 160, 0.1)",
  in_progress: "rgba(59, 130, 246, 0.1)",
  done: "rgba(34, 197, 94, 0.1)",
  blocked: "rgba(245, 158, 11, 0.1)",
  cancelled: "rgba(85, 85, 106, 0.1)",
  failed: "rgba(239, 68, 68, 0.1)",
};

export const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--error)",
  high: "var(--warning)",
  normal: "var(--text-primary)",
  low: "var(--text-muted)",
};

export const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "grid" },
  { label: "Quests", href: "/quests", icon: "list" },
  { label: "Sessions", href: "/sessions", icon: "message" },
  { label: "Events", href: "/events", icon: "activity" },
  { label: "Insights", href: "/insights", icon: "lightbulb" },
  { label: "Settings", href: "/settings", icon: "settings" },
] as const;
