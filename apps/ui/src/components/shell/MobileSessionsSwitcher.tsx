import { useEffect, useId, useMemo, useState } from "react";
import { ChevronUp, MessagesSquare } from "lucide-react";
import { useLocation, useParams } from "react-router-dom";
import { Modal } from "@/components/ui";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { useChatStore } from "@/store/chat";
import { AgentInboxToolbar } from "./AgentInboxControls";
import SessionsRail from "./SessionsRail";

const NO_SESSIONS: SessionInfo[] = [];

function countLabel(count: number): string {
  if (count === 0) return "No sessions";
  return `${count} session${count === 1 ? "" : "s"}`;
}

export default function MobileSessionsSwitcher({ currentTitle }: { currentTitle: string }) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const location = useLocation();
  const { agentId, itemId } = useParams<{ agentId?: string; itemId?: string }>();
  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.session_type !== "task"),
    [sessions],
  );
  const activeTitle = useMemo(() => {
    const active = visibleSessions.find((session) => session.id === itemId);
    return active ? sessionLabel(active) : currentTitle;
  }, [currentTitle, itemId, visibleSessions]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const sessionCount = visibleSessions.length;

  return (
    <>
      <button
        type="button"
        className="mobile-session-switcher__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={`Switch session, current: ${activeTitle}`}
        onClick={() => setOpen(true)}
      >
        <MessagesSquare size={15} strokeWidth={1.5} aria-hidden="true" />
        <span className="mobile-session-switcher__copy">
          <span className="mobile-session-switcher__title">{activeTitle}</span>
          <span className="mobile-session-switcher__meta">{countLabel(sessionCount)}</span>
        </span>
        <ChevronUp
          className="mobile-session-switcher__chevron"
          size={15}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>

      <Modal
        id={dialogId}
        open={open}
        onClose={() => setOpen(false)}
        title="Sessions"
        className="mobile-session-drawer"
        closeLabel="Close session switcher"
      >
        <div className="mobile-session-drawer__body" data-testid="mobile-session-switcher-panel">
          <div className="mobile-session-drawer__toolbar">
            <AgentInboxToolbar />
          </div>
          <div className="mobile-session-drawer__rail">
            <SessionsRail onSelectSession={() => setOpen(false)} />
          </div>
        </div>
      </Modal>
    </>
  );
}
