import { useNavigate } from "react-router-dom";
import BlockAvatar from "@/components/BlockAvatar";
import { timeAgo } from "@/lib/format";
import type { InboxItem as InboxItemData } from "@/lib/api";

interface InboxItemProps {
  item: InboxItemData;
}

/**
 * Single inbox row. Clicking the row navigates to the source session
 * — there is no inline reply panel and no expanded state. The work
 * happens in the session view; the inbox is purely a directory of
 * pending items.
 *
 * Visual language is intentionally restrained: small avatar, single
 * line of subject text, monospaced relative time. No accent rail, no
 * pulse dot, no entry animation. Hover is a quiet background tint;
 * focus reuses the same tint plus a focus ring from the button
 * primitive defaults.
 */
export default function InboxItem({ item }: InboxItemProps) {
  const navigate = useNavigate();
  const subject = item.awaiting_subject ?? item.session_name;
  // The agent_name join is best-effort; if the registry didn't surface
  // a name (orphaned/deleted), fall back to the session name so the
  // row never reads as nameless.
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
        <span className="inbox-row-avatar">
          <BlockAvatar name={agentLabel} size={24} />
        </span>
        <span className="inbox-row-meta">
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
        <span className="inbox-row-time">{timeAgo(item.awaiting_at)}</span>
      </button>
    </li>
  );
}
