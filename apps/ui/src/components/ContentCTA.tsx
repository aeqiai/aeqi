import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import { useAgentDataStore } from "@/store/agentData";
import { useNav } from "@/hooks/useNav";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { ALL_TOOLS } from "@/lib/tools";
import type { AgentEvent, Agent, Idea } from "@/lib/types";

// Stable empty-array reference. Returning a fresh `[]` from a Zustand
// selector on every render triggers React error #185 (infinite update loop).
const NO_SESSIONS: SessionInfo[] = [];
const NO_EVENTS: AgentEvent[] = [];
const NO_CHANNELS: import("@/store/agentData").ChannelEntry[] = [];
const NO_IDEAS: Idea[] = [];

/** A single row in the rail. Uniform across every tab. */
interface RailItem {
  id: string;
  name: string;
  /** Small uppercase badge on the top row (e.g. TG, WA, Web, SYS). */
  badge?: string;
  /** Secondary line — preview text, pattern, or status. */
  preview?: string;
  /** Right-aligned meta on the bottom line — date or count. */
  meta?: string;
  /** Dim the row (e.g. disabled event). */
  dimmed?: boolean;
}

/** Header config: what the "+" button does and what it says. */
interface RailHeader {
  label: string;
  event: string;
}

function eventLabel(ev: AgentEvent): string {
  return ev.name.replace(/^on_/, "").replace(/_/g, " ");
}
function eventTransport(ev: AgentEvent): string | null {
  const prefix = ev.pattern.split(":")[0];
  if (prefix === "session") return null;
  return prefix.toUpperCase();
}

/**
 * Unified right rail inside the content card.
 *
 * The rail is the index column for a master/detail pair — the same pattern
 * regardless of tab. Each tab supplies its own rows; the detail pane
 * (whatever AgentPage renders in `.content-main`) reacts to `:itemId`.
 *
 *   sessions  → chat sessions list (store-backed)
 *   events    → agent events list  (store-backed, fetched on mount)
 *   channels  → messaging channels (store-backed, fetched on mount)
 *   tools     → static tool catalogue, on/off driven by agent.tool_deny
 *   other     → header-only (primary action button, nothing to list)
 */
export default function ContentCTA() {
  const { agentId, tab, itemId } = useParams<{
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const { goAgent } = useNav();
  const section = tab || "";

  // --- Sessions -----------------------------------------------------------
  const sessions = useChatStore((s) =>
    section === "sessions" && agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );

  // --- Events -------------------------------------------------------------
  const loadEvents = useAgentDataStore((s) => s.loadEvents);
  const events = useAgentDataStore((s) =>
    section === "events" && agentId ? s.eventsByAgent[agentId] || NO_EVENTS : NO_EVENTS,
  );
  useEffect(() => {
    if (section === "events" && agentId) loadEvents(agentId);
  }, [section, agentId, loadEvents]);

  // --- Channels -----------------------------------------------------------
  const loadChannels = useAgentDataStore((s) => s.loadChannels);
  const channels = useAgentDataStore((s) =>
    section === "channels" && agentId ? s.channelsByAgent[agentId] || NO_CHANNELS : NO_CHANNELS,
  );
  useEffect(() => {
    if (section === "channels" && agentId) loadChannels(agentId);
  }, [section, agentId, loadChannels]);

  // --- Ideas --------------------------------------------------------------
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);
  const ideas = useAgentDataStore((s) =>
    section === "ideas" && agentId ? s.ideasByAgent[agentId] || NO_IDEAS : NO_IDEAS,
  );
  useEffect(() => {
    if (section === "ideas" && agentId) loadIdeas(agentId);
  }, [section, agentId, loadIdeas]);

  // --- Tools --------------------------------------------------------------
  const agent: Agent | undefined = useDaemonStore((s) =>
    section === "tools" && agentId
      ? s.agents.find((a) => a.id === agentId || a.name === agentId)
      : undefined,
  );

  // Compose: which rows + which header action for this tab.
  let items: RailItem[] = [];
  let header: RailHeader | null = null;
  let emptyText = "";

  switch (section) {
    case "sessions":
      header = { label: "New chat", event: "aeqi:new-session" };
      items = sessions.map((s) => {
        const n = s.name?.toLowerCase() || "";
        const badge = n.includes("telegram")
          ? "TG"
          : n.includes("whatsapp")
            ? "WA"
            : s.session_type === "web"
              ? "Web"
              : undefined;
        const meta = s.created_at
          ? new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric" })
          : undefined;
        return {
          id: s.id,
          name: sessionLabel(s),
          badge,
          preview: s.first_message ? s.first_message.slice(0, 40) : undefined,
          meta,
        };
      });
      emptyText = "No sessions yet";
      break;

    case "events":
      header = { label: "New event", event: "aeqi:new-event" };
      items = events.map((ev) => {
        const transport = eventTransport(ev);
        return {
          id: ev.id,
          name: eventLabel(ev),
          badge: transport || undefined,
          preview: ev.pattern,
          meta: ev.idea_ids.length > 0 ? `${ev.idea_ids.length} ideas` : undefined,
          dimmed: !ev.enabled,
        };
      });
      emptyText = "No events yet";
      break;

    case "channels":
      header = { label: "Add channel", event: "aeqi:new-channel" };
      items = channels.map((c) => ({
        id: c.id,
        name: c.kind,
        badge: c.kind.toUpperCase(),
        preview: "Connected",
      }));
      emptyText = "No channels";
      break;

    case "tools":
      items = ALL_TOOLS.map((t) => {
        const allowed = agent ? !agent.tool_deny?.includes(t.id) : true;
        return {
          id: t.id,
          name: t.label,
          badge: allowed ? undefined : "OFF",
          preview: t.category,
          dimmed: !allowed,
        };
      });
      emptyText = "";
      break;

    case "quests":
      header = { label: "New quest", event: "aeqi:create" };
      break;
    case "ideas":
      header = { label: "New idea", event: "aeqi:new-idea" };
      items = ideas.map((idea) => {
        const firstTag = idea.tags && idea.tags.length > 0 ? idea.tags[0] : undefined;
        const meta =
          idea.tags && idea.tags.length > 1
            ? `+${idea.tags.length - 1}`
            : idea.agent_id
              ? undefined
              : "global";
        return {
          id: idea.id,
          name: idea.name,
          badge: firstTag ? firstTag.toUpperCase() : undefined,
          preview: idea.content.slice(0, 60),
          meta,
        };
      });
      emptyText = "No ideas yet";
      break;
    case "agents":
      header = { label: "New agent", event: "aeqi:create" };
      break;
    default:
      header = null;
  }

  const handleSelect = (id: string) => {
    if (!agentId) return;
    goAgent(agentId, section, id, { replace: true });
  };

  return (
    <div className="asv-sidebar">
      {/* Always render the header row — even when the tab has no +new
          action — so the rail's top edge aligns with the main pane's
          content-topbar (40px tall). Prevents the "rail jumps up on
          tools tab" effect. */}
      <div className="asv-sidebar-header">
        {header && (
          <button
            className="asv-session-new-btn"
            onClick={() => window.dispatchEvent(new CustomEvent(header!.event))}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            {header.label}
          </button>
        )}
      </div>
      <div className="asv-sidebar-list">
        {items.length === 0 && emptyText && <div className="asv-sidebar-empty">{emptyText}</div>}
        {items.map((item) => (
          <div
            key={item.id}
            className={`asv-session-item${item.id === itemId ? " active" : ""}${
              item.dimmed ? " asv-session-item--disabled" : ""
            }`}
            onClick={() => handleSelect(item.id)}
          >
            <div className="asv-session-item-top">
              <span className="asv-session-item-name">{item.name}</span>
              {item.badge && <span className="asv-session-item-transport">{item.badge}</span>}
            </div>
            {(item.preview || item.meta) && (
              <div className="asv-session-item-bottom">
                {item.preview && <span className="asv-session-item-preview">{item.preview}</span>}
                {item.meta && <span className="asv-session-item-date">{item.meta}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
