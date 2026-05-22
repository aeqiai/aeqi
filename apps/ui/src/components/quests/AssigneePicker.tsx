import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "../ui/Popover";
import AssigneeAvatar from "./AssigneeAvatar";
import {
  formatAssignee,
  parseAssignee,
  resolveAssigneeDisplay,
  type AssigneeDisplay,
} from "@/lib/assignee";
import type { Agent, User } from "@/lib/types";

/**
 * Assignee picker popover. Native typing-as-search filters across
 * agents + the authenticated user; click commits an `agent:<id>` or
 * `user:<id>` write through `onChange`. The "Unassigned" row is
 * always present at the head of the list so the affordance to drop
 * an assignment is one click — not a hidden gesture.
 *
 * Trigger is fully delegated through `renderTrigger` so the same
 * picker hosts both the row-inline avatar (just the avatar) and the
 * detail-header avatar+name button. The picker doesn't care about
 * trigger chrome — only that it gets back a clickable element.
 */
export default function AssigneePicker({
  assignee,
  agents,
  users,
  onChange,
  quickActions = [],
  renderTrigger,
  placement = "bottom-start",
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  assignee: string | null | undefined;
  agents: Pick<Agent, "id" | "name">[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  onChange: (next: string | null) => void;
  quickActions?: {
    key: string;
    label: string;
    description?: string;
    assignee?: string | null;
    onSelect: () => void;
  }[];
  renderTrigger: (args: { open: boolean; display: AssigneeDisplay | null }) => ReactNode;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** Optional controlled-open. When provided, the parent owns the popover
   * state — used by the `A` keyboard shortcut on Quest detail to open
   * the picker without a click. Falls back to internal state otherwise. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChangeProp?.(next);
  };
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Native focus on open so the user lands directly in search.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const identity = parseAssignee(assignee);
  const display = identity ? resolveAssigneeDisplay(identity, agents, users) : null;

  // Flat candidate list — agents first (block avatar), then humans
  // (round avatar). The picker doesn't try to be clever about ranking;
  // for an MVP candidate set of <50 entries, alpha-sorted within each
  // group reads cleanly and beats a "search relevance" heuristic that
  // would surprise the user.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const agentRows = agents
      .map((a) => ({
        kind: "agent" as const,
        id: a.id,
        name: a.name,
        raw: formatAssignee("agent", a.id),
        avatarUrl: undefined as string | null | undefined,
      }))
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const userRows = users
      .map((u) => ({
        kind: "user" as const,
        id: u.id,
        name: u.name || u.email || u.id,
        raw: formatAssignee("user", u.id),
        avatarUrl: u.avatar_url ?? null,
      }))
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...agentRows, ...userRows];
  }, [agents, users, query]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      portal
      trigger={renderTrigger({ open, display })}
    >
      <div
        className="assignee-picker"
        role="dialog"
        aria-label="Assign quest"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <input
          ref={inputRef}
          type="search"
          className="assignee-picker-search"
          placeholder="Search people and agents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="assignee-picker-list" role="listbox">
          {quickActions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="option"
              aria-selected={false}
              className="assignee-picker-row assignee-picker-row--quick"
              onClick={() => {
                action.onSelect();
                setOpen(false);
              }}
            >
              <span className="assignee-picker-row-avatar" aria-hidden>
                <AssigneeAvatar
                  assignee={action.assignee}
                  agents={agents}
                  users={users}
                  size={18}
                />
              </span>
              <span className="assignee-picker-row-name">
                {action.label}
                {action.description && (
                  <span className="assignee-picker-row-description">{action.description}</span>
                )}
              </span>
              <span className="assignee-picker-row-kind">action</span>
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={!assignee}
            className={`assignee-picker-row${!assignee ? " is-active" : ""}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span className="assignee-picker-row-avatar" aria-hidden>
              <AssigneeAvatar assignee={null} agents={agents} users={users} size={18} />
            </span>
            <span className="assignee-picker-row-name">Unassigned</span>
          </button>
          {candidates.length === 0 && (
            <div className="assignee-picker-empty">No matching people or agents.</div>
          )}
          {candidates.map((row) => {
            const isActive = identity?.kind === row.kind && identity.id === row.id;
            return (
              <button
                key={row.raw}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`assignee-picker-row${isActive ? " is-active" : ""}`}
                onClick={() => {
                  onChange(row.raw);
                  setOpen(false);
                }}
              >
                <span className="assignee-picker-row-avatar" aria-hidden>
                  <AssigneeAvatar assignee={row.raw} agents={agents} users={users} size={18} />
                </span>
                <span className="assignee-picker-row-name">{row.name}</span>
                <span className="assignee-picker-row-kind">{row.kind}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
