import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import { useAgentDataStore } from "@/store/agentData";
import { useNav } from "@/hooks/useNav";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { ALL_TOOLS } from "@/lib/tools";
import type { AgentEvent, Agent, Idea, Quest } from "@/lib/types";

/**
 * Extract a short preview snippet from `text`, centered on the first
 * occurrence of any query word.  Falls back to the leading 80 chars.
 *
 * @param text    Full content string.
 * @param query   The user's current search string (may be empty).
 * @param length  Max snippet length (default 80).
 */
function snippetFor(text: string, query: string, length = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!query) return flat.slice(0, length);

  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest word first for best anchor

  const lower = flat.toLowerCase();
  let matchIdx = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i !== -1) {
      matchIdx = i;
      break;
    }
  }

  if (matchIdx === -1) return flat.slice(0, length);

  // Centre the window on the match, but keep it in-bounds.
  const half = Math.floor(length / 2);
  const start = Math.max(0, matchIdx - half);
  const end = Math.min(flat.length, start + length);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return prefix + flat.slice(start, end) + suffix;
}

// Stable empty-array reference. Returning a fresh `[]` from a Zustand
// selector on every render triggers React error #185 (infinite update loop).
const NO_SESSIONS: SessionInfo[] = [];
const NO_EVENTS: AgentEvent[] = [];
const NO_CHANNELS: import("@/store/agentData").ChannelEntry[] = [];
const NO_IDEAS: Idea[] = [];
const NO_QUESTS: Quest[] = [];

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
  /** Session/item status — drives accent-bar color on the row. */
  status?: string;
  /** Optional group bucket — triggers a group header above the row when the
   *  bucket changes. Only used by the Inbox rail for date chunks. */
  group?: string;
  /** Raw timestamp used to derive the group — kept for sorting. */
  sortKey?: number;
}

function recencyBucket(ts: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  if (ts >= today) return "Today";
  if (ts >= today - dayMs) return "Yesterday";
  if (ts >= today - 7 * dayMs) return "This week";
  if (ts >= today - 30 * dayMs) return "This month";
  return "Earlier";
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

type IdeasScope = "all" | "mine" | "global" | "inherited";

/**
 * Ideas rail filter panel. Search is always visible. Scope and tag
 * facets hide behind a disclosure so the default rail stays quiet —
 * the user flips them open only when their idea list gets big enough
 * to need filtering.
 */
function IdeasRailFilters({
  search,
  onSearch,
  scope,
  onScope,
  tag,
  onTag,
  tagCounts,
  shownCount,
  totalCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  scope: IdeasScope;
  onScope: (v: IdeasScope) => void;
  tag: string | null;
  onTag: (v: string | null) => void;
  tagCounts: Array<[string, number]>;
  shownCount: number;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const hasFilters = scope !== "all" || tag !== null;
  const isFiltered = hasFilters || search.trim() !== "";
  const clearAll = () => {
    onSearch("");
    onScope("all");
    onTag(null);
  };
  return (
    <div className="ideas-rail-filters">
      <div className="ideas-rail-search-row">
        <span className="ideas-rail-search-field">
          <input
            className="ideas-rail-search"
            type="text"
            placeholder="Search ideas…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="ideas-rail-search-clear"
              onClick={() => onSearch("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </span>
        <button
          type="button"
          className={`ideas-rail-filter-toggle${open || hasFilters ? " active" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="Filters"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M1.5 3h9M3 6h6M4.5 9h3" />
          </svg>
          {hasFilters && <span className="ideas-rail-filter-dot" aria-hidden />}
        </button>
      </div>
      <div className="ideas-rail-count-row">
        <span className="ideas-rail-count">
          {isFiltered ? `${shownCount} of ${totalCount}` : `${totalCount}`}
          <span className="ideas-rail-count-label"> {totalCount === 1 ? "idea" : "ideas"}</span>
        </span>
        {isFiltered && (
          <button type="button" className="ideas-rail-clear-all" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="ideas-rail-filter-body">
          <div className="ideas-rail-scope">
            {(["all", "mine", "global", "inherited"] as IdeasScope[]).map((s) => (
              <button
                key={s}
                className={`ideas-rail-scope-btn${scope === s ? " active" : ""}`}
                onClick={() => onScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
          {tagCounts.length > 0 && (
            <div className="ideas-rail-tags">
              {tagCounts.slice(0, 18).map(([t, n]) => (
                <button
                  key={t}
                  className={`ideas-rail-tag${tag === t ? " active" : ""}`}
                  onClick={() => onTag(tag === t ? null : t)}
                >
                  {t} <span className="ideas-rail-tag-count">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  // No tab means Inbox — treat it identically to the "sessions" section so the
  // rail (session list + "New message" CTA) renders on /:agentId.
  const section = tab || "sessions";

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

  // --- Quests -------------------------------------------------------------
  const allQuests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const agents = useDaemonStore((s) => s.agents);
  const questAgent = useMemo(
    () =>
      section === "quests" && agentId
        ? agents.find((a) => a.id === agentId || a.name === agentId)
        : undefined,
    [section, agents, agentId],
  );
  const scopedQuests = useMemo(() => {
    if (section !== "quests") return NO_QUESTS;
    if (!questAgent) return NO_QUESTS;
    return allQuests.filter((q) => q.agent_id === questAgent.id);
  }, [section, allQuests, questAgent]);

  // --- Ideas --------------------------------------------------------------
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);
  const ideas = useAgentDataStore((s) =>
    section === "ideas" && agentId ? s.ideasByAgent[agentId] || NO_IDEAS : NO_IDEAS,
  );
  useEffect(() => {
    if (section === "ideas" && agentId) loadIdeas(agentId);
  }, [section, agentId, loadIdeas]);

  // Ideas-only filter state. The rail is the index column, so filters live
  // here. State stays resident across section switches — cheap and keeps
  // the user's in-flight filters when they flip back.
  const [ideasSearch, setIdeasSearch] = useState("");
  const [ideasScope, setIdeasScope] = useState<IdeasScope>("all");
  const [ideasTag, setIdeasTag] = useState<string | null>(null);

  const tagCounts = useMemo(() => {
    if (section !== "ideas") return [] as Array<[string, number]>;
    const counts: Record<string, number> = {};
    for (const idea of ideas) {
      for (const t of idea.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [ideas, section]);

  const filteredIdeas = useMemo(() => {
    if (section !== "ideas") return ideas;
    const q = ideasSearch.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (ideasScope === "mine" && idea.agent_id !== agentId) return false;
      if (ideasScope === "global" && idea.agent_id != null) return false;
      if (ideasScope === "inherited" && (idea.agent_id == null || idea.agent_id === agentId))
        return false;
      if (ideasTag && !(idea.tags || []).includes(ideasTag)) return false;
      if (q) {
        const inName = idea.name.toLowerCase().includes(q);
        const inContent = idea.content.toLowerCase().includes(q);
        if (!inName && !inContent) return false;
      }
      return true;
    });
  }, [ideas, section, ideasSearch, ideasScope, ideasTag, agentId]);

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
      header = { label: "New message", event: "aeqi:new-session" };
      items = sessions
        // Quest execution sessions belong in the Quests tab, not the Inbox.
        .filter((s) => s.session_type !== "task")
        .map((s) => {
          const n = s.name?.toLowerCase() || "";
          const badge = n.includes("telegram")
            ? "TG"
            : n.includes("whatsapp")
              ? "WA"
              : s.session_type === "web"
                ? "Web"
                : undefined;
          const tsRaw = s.last_active || s.created_at;
          const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
          const label = sessionLabel(s);
          const meta =
            s.message_count != null && s.message_count > 0 ? `${s.message_count}` : undefined;
          return {
            id: s.id,
            name: label,
            badge,
            // If the label came from first_message, don't repeat it as preview.
            preview: undefined,
            meta,
            status: s.status,
            group: ts ? recencyBucket(ts) : "Earlier",
            sortKey: ts,
          };
        })
        .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
      emptyText = "No threads yet. Type below to start one.";
      break;

    case "events":
      header = { label: "New event", event: "aeqi:new-event" };
      items = events.map((ev) => {
        const transport = eventTransport(ev);
        const isGlobal = ev.agent_id == null;
        const meta =
          ev.fire_count > 0
            ? `${ev.fire_count} fire${ev.fire_count === 1 ? "" : "s"}`
            : ev.idea_ids.length > 0
              ? `${ev.idea_ids.length} ideas`
              : undefined;
        return {
          id: ev.id,
          name: eventLabel(ev),
          badge: isGlobal ? "GLOBAL" : transport || undefined,
          preview: ev.pattern,
          meta,
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
      emptyText = "No channels yet";
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
      items = scopedQuests.map((q) => {
        const isClosed = q.status === "done" || q.status === "cancelled";
        return {
          id: q.id,
          name: q.subject,
          badge: q.status === "in_progress" ? "●" : q.status === "blocked" ? "!" : undefined,
          preview: q.description ? q.description.slice(0, 50) : undefined,
          meta: q.priority !== "normal" ? q.priority : undefined,
          dimmed: isClosed,
        };
      });
      emptyText = "No quests yet";
      break;
    case "ideas":
      header = { label: "New idea", event: "aeqi:new-idea" };
      items = filteredIdeas.map((idea) => {
        const ideaTags = idea.tags ?? [];
        const isSkillCandidate =
          ideaTags.includes("skill") &&
          ideaTags.includes("candidate") &&
          !ideaTags.includes("promoted") &&
          !ideaTags.includes("rejected");
        const firstTag = ideaTags.length > 0 ? ideaTags[0] : undefined;
        const meta =
          ideaTags.length > 1 ? `+${ideaTags.length - 1}` : idea.agent_id ? undefined : "global";
        return {
          id: idea.id,
          name: idea.name,
          badge: isSkillCandidate ? "SKILL ★" : firstTag ? firstTag.toUpperCase() : undefined,
          preview: snippetFor(idea.content, ideasSearch),
          meta,
        };
      });
      emptyText = ideas.length === 0 ? "No ideas yet" : "No matches";
      break;
    case "agents": {
      header = { label: "New agent", event: "aeqi:create" };
      const parent = agents.find((a) => a.id === agentId || a.name === agentId);
      if (parent) {
        const children = agents.filter((a) => a.parent_id === parent.id);
        items = children.map((c) => ({
          id: c.id,
          name: c.display_name || c.name,
          preview: c.status,
          meta: c.session_count ? `${c.session_count}` : undefined,
          status: c.status,
        }));
      }
      emptyText = "No sub-agents yet";
      break;
    }
    default:
      header = null;
  }

  const handleSelect = (id: string) => {
    if (!agentId) return;
    // Agents tab: picking a child navigates INTO that agent's home, not into
    // a child-detail route on the parent. The other tabs keep their normal
    // master/detail pattern.
    if (section === "agents") {
      goAgent(id);
      return;
    }
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
      {section === "ideas" && (
        <IdeasRailFilters
          search={ideasSearch}
          onSearch={setIdeasSearch}
          scope={ideasScope}
          onScope={setIdeasScope}
          tag={ideasTag}
          onTag={setIdeasTag}
          tagCounts={tagCounts}
          shownCount={filteredIdeas.length}
          totalCount={ideas.length}
        />
      )}
      <div className="asv-sidebar-list">
        {items.length === 0 &&
          emptyText &&
          (header && section !== "sessions" && emptyText !== "No matches" ? (
            <button
              type="button"
              className="asv-sidebar-empty-cta"
              onClick={() => window.dispatchEvent(new CustomEvent(header!.event))}
            >
              <span className="asv-sidebar-empty-cta-label">{emptyText}</span>
              <span className="asv-sidebar-empty-cta-hint">{header.label}</span>
            </button>
          ) : (
            <div className="asv-sidebar-empty">{emptyText}</div>
          ))}
        {items.map((item, i) => {
          const showHeader = !!item.group && (i === 0 || items[i - 1]?.group !== item.group);
          return (
            <div key={item.id} className="asv-sidebar-row">
              {showHeader && <div className="asv-sidebar-group-header">{item.group}</div>}
              <button
                type="button"
                className={`asv-session-item${item.id === itemId ? " active" : ""}${
                  item.dimmed ? " asv-session-item--disabled" : ""
                }`}
                data-status={item.status}
                aria-current={item.id === itemId ? "true" : undefined}
                onClick={() => handleSelect(item.id)}
              >
                <div className="asv-session-item-top">
                  <span className="asv-session-item-name">{item.name}</span>
                  {item.badge && <span className="asv-session-item-transport">{item.badge}</span>}
                </div>
                {(item.preview || item.meta) && (
                  <div className="asv-session-item-bottom">
                    {item.preview && (
                      <span className="asv-session-item-preview">{item.preview}</span>
                    )}
                    {item.meta && (
                      <span
                        className={
                          section === "sessions"
                            ? "asv-session-item-count"
                            : "asv-session-item-date"
                        }
                      >
                        {item.meta}
                      </span>
                    )}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
