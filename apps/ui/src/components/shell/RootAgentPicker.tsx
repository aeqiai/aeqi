import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BlockAvatar from "@/components/BlockAvatar";
import { useDaemonStore } from "@/store/daemon";

interface RootAgentPickerProps {
  /** The currently active root id (from URL ancestry). */
  rootId: string;
  /** Whether the sidebar is collapsed — determines compact rendering. */
  collapsed: boolean;
}

/**
 * Root-agent selector lifted into the persistent shell. The trigger
 * pins to the top of the agent tree; when opened, its menu takes over
 * the tree area underneath (not a floating popover) so picking a root
 * feels like switching workspaces, not dismissing a dropdown.
 */
export default function RootAgentPicker({ rootId, collapsed }: RootAgentPickerProps) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const roots = useMemo(() => agents.filter((a) => !a.parent_id), [agents]);
  const current = useMemo(() => roots.find((r) => r.id === rootId) || null, [roots, rootId]);
  const label = current?.display_name || current?.name || "Select root";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switchTo = (id: string) => {
    setOpen(false);
    if (id === rootId) return;
    navigate(`/${encodeURIComponent(id)}`);
  };

  return (
    <div className={`root-picker${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="root-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? label : undefined}
      >
        <BlockAvatar name={label} size={18} />
        {!collapsed && (
          <>
            <span className="root-picker-label">{label}</span>
            <svg
              className={`root-picker-chevron${open ? " flipped" : ""}`}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 4l2.5 2 2.5-2" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div className="root-picker-menu" role="menu">
          {roots.length === 0 && <div className="root-picker-empty">No roots yet</div>}
          {roots.map((r) => {
            const rLabel = r.display_name || r.name;
            const active = r.id === rootId;
            return (
              <button
                key={r.id}
                type="button"
                role="menuitem"
                className={`root-picker-item${active ? " active" : ""}`}
                onClick={() => switchTo(r.id)}
              >
                <BlockAvatar name={rLabel} size={18} />
                <span className="root-picker-item-label">{rLabel}</span>
                {active && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="2.5 6.5 5 9 9.5 3.5" />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="root-picker-divider" />
          <button
            type="button"
            role="menuitem"
            className="root-picker-item root-picker-item-new"
            onClick={() => {
              setOpen(false);
              navigate("/new");
            }}
          >
            <span className="root-picker-plus">+</span>
            <span className="root-picker-item-label">New root agent</span>
          </button>
        </div>
      )}
    </div>
  );
}
