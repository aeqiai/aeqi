import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useInboxStore, selectInboxCount, selectVisibleItems } from "@/store/inbox";
import { useDaemonStore } from "@/store/daemon";

/**
 * `/me/inbox` — the action queue. Blocking items waiting on you,
 * across every company you own. Distinct from `/` (the feed); the
 * feed is the pulse, the inbox is what you go to clear.
 *
 * No composer here. Each row navigates to the source session. Items
 * arrive via the WS stream into `useInboxStore` and are dismissed
 * either by the agent resolving the question or by the user
 * answering inline in the session view.
 */
export default function MeInboxPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const inboxCount = useInboxStore(selectInboxCount);
  const items = useInboxStore(selectVisibleItems);
  const agents = useDaemonStore((s) => s.agents);

  useEffect(() => {
    document.title = "inbox · æqi";
  }, []);

  const name = firstName(user?.name, user?.email);
  const heading = name ? `${name}'s inbox` : "Inbox";

  const status =
    inboxCount === 0
      ? "Nothing awaiting your input."
      : inboxCount === 1
        ? "1 awaiting your input."
        : `${inboxCount} awaiting your input.`;

  return (
    <div className="me-inbox">
      <header className="me-inbox-header">
        <h1 className="me-inbox-heading">{heading}</h1>
        <p className="me-inbox-status">{status}</p>
      </header>

      {items.length > 0 && (
        <ul className="me-inbox-list" role="list">
          {items.map((item) => {
            const agent = item.agent_id ? agents.find((a) => a.id === item.agent_id) : null;
            const fromName = agent?.name || item.agent_name || "Agent";
            const preview = item.awaiting_subject || item.last_agent_message || item.session_name;
            return (
              <li key={item.session_id} className="me-inbox-row">
                <button
                  type="button"
                  className="me-inbox-row-btn"
                  onClick={() => navigate(`/sessions/${encodeURIComponent(item.session_id)}`)}
                >
                  <span className="me-inbox-row-from">{fromName}</span>
                  <span className="me-inbox-row-preview">{preview}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function firstName(name: string | undefined, email: string | undefined): string | null {
  const raw = name || email?.split("@")[0] || "";
  if (!raw) return null;
  const seg = raw.split(/[\s._-]+/)[0];
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}
