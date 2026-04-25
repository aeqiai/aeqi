import { useRef } from "react";
import BlockAvatar from "@/components/BlockAvatar";
import { timeAgo } from "@/lib/format";
import type { InboxItem as InboxItemData } from "@/lib/api";
import InboxItemReply from "./InboxItemReply";

interface InboxItemProps {
  item: InboxItemData;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Called when the user successfully submits a reply. */
  onAnswered: () => void;
}

/**
 * One row of the director inbox.
 *
 * Composed of two pieces inside a single `<li>`:
 *   1. A `<button class="inbox-row">` that owns hover/focus/active state
 *      and the click-to-toggle accordion.
 *   2. A sibling `<InboxItemReply>` revealed below the button when
 *      `expanded` is true. Lives outside the button (a button cannot
 *      contain a textarea) but inside the same `<li>` so the whole
 *      row collapses together when the inbox row is dismissed.
 *
 * The avatar carries a small near-black ink dot at top-right that pulses
 * via `inbox-pulse` keyframe — purely a "this agent is waiting" cue,
 * deliberately not jade so jade stays reserved for success states.
 */
export default function InboxItem({ item, expanded, onToggleExpand, onAnswered }: InboxItemProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const subject = item.awaiting_subject ?? item.session_name;
  const showRoot =
    item.root_agent_id != null && item.agent_id != null && item.root_agent_id !== item.agent_id;
  // The `agent_name` join is best-effort; if the registry didn't surface
  // a name (orphaned/deleted), fall back to the session name so the row
  // never reads as nameless.
  const agentLabel = item.agent_name ?? item.session_name ?? "agent";

  const handleCancel = () => {
    onToggleExpand();
    // Return focus to the row button so screen readers announce the
    // collapsed state without losing the user's place in the list.
    buttonRef.current?.focus();
  };

  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        className="inbox-row"
        data-expanded={expanded}
        data-awaiting="true"
        data-testid="inbox-row"
        aria-expanded={expanded}
        aria-controls={`inbox-reply-${item.session_id}`}
        onClick={onToggleExpand}
      >
        <span className="inbox-row-avatar">
          <BlockAvatar name={agentLabel} size={28} />
          <span className="inbox-row-avatar-dot" aria-hidden="true" />
        </span>
        <span className="inbox-row-meta">
          <span>{agentLabel}</span>
          {showRoot && (
            <>
              <span className="inbox-row-meta-sep" aria-hidden="true">
                ·
              </span>
              <span className="inbox-row-meta-root">{item.root_agent_id}</span>
            </>
          )}
        </span>
        <span className="inbox-row-subject">{subject}</span>
        {item.last_agent_message && (
          <span className="inbox-row-excerpt">{item.last_agent_message}</span>
        )}
        <span className="inbox-row-time">{timeAgo(item.awaiting_at)}</span>
        <span className="inbox-row-arrow" aria-hidden="true">
          →
        </span>
      </button>
      {expanded && (
        <div id={`inbox-reply-${item.session_id}`}>
          <InboxItemReply
            sessionId={item.session_id}
            agentId={item.agent_id}
            onSubmitted={onAnswered}
            onCancel={handleCancel}
          />
        </div>
      )}
    </li>
  );
}
