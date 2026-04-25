import { useNavigate } from "react-router-dom";
import BlockAvatar from "@/components/BlockAvatar";
import { timeShort } from "@/lib/format";
import type { InboxItem as InboxItemData } from "@/lib/api";

interface InboxItemProps {
  item: InboxItemData;
}

/**
 * Single inbox row. Editorial-record layout: a 16px inline avatar
 * sits next to the agent name (whisper-meta), the subject is the only
 * confident line below, and the time anchors the right column in
 * tabular-num mono. Click navigates to the source session.
 *
 * Two grid rows, two columns: left content stack + right time column.
 * Avatar is INLINE inside the meta line (not its own column) — this
 * removes the "two-column card" feel of the previous shape and lets
 * the subject occupy the full row width.
 */
export default function InboxItem({ item }: InboxItemProps) {
  const navigate = useNavigate();
  const subject = item.awaiting_subject ?? item.session_name;
  // The agent_name join is best-effort; fall back to session_name so
  // the row is never nameless.
  const agentLabel = item.agent_name ?? item.session_name ?? "agent";
  const showRoot =
    item.root_agent_id != null && item.agent_id != null && item.root_agent_id !== item.agent_id;

  const onClick = () => {
    if (!item.agent_id) return;
    navigate(
      `/${encodeURIComponent(item.agent_id)}/sessions/${encodeURIComponent(item.session_id)}`,
    );
  };

  return (
    <li>
      <button type="button" className="inbox-row" data-testid="inbox-row" onClick={onClick}>
        <span className="inbox-row-meta">
          <span className="inbox-row-meta-avatar" aria-hidden="true">
            <BlockAvatar name={agentLabel} size={16} />
          </span>
          <span className="inbox-row-meta-agent">{agentLabel}</span>
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
        <time className="inbox-row-time" dateTime={item.awaiting_at}>
          {timeShort(item.awaiting_at)}
        </time>
      </button>
    </li>
  );
}
