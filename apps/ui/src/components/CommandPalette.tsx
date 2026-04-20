import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  section: string;
  action: () => void;
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const appMode = useAuthStore((s) => s.appMode);
  const { agentId } = useParams<{ agentId?: string }>();

  const go = useCallback(
    (path: string) => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(0);
      return;
    }
    inputRef.current?.focus();

    const scope = agentId ? `/${agentId}` : "";
    const buildItems = async () => {
      const navItems: PaletteItem[] = agentId
        ? [
            {
              id: "nav-inbox",
              label: "Inbox",
              hint: "Sessions",
              section: "Navigate",
              action: () => go(`${scope}/sessions`),
            },
            {
              id: "nav-agents-tab",
              label: "Agents",
              hint: "Sub-agents",
              section: "Navigate",
              action: () => go(`${scope}/agents`),
            },
            {
              id: "nav-quests",
              label: "Quests",
              hint: "Work items",
              section: "Navigate",
              action: () => go(`${scope}/quests`),
            },
            {
              id: "nav-events",
              label: "Events",
              hint: "Triggers",
              section: "Navigate",
              action: () => go(`${scope}/events`),
            },
            {
              id: "nav-ideas",
              label: "Ideas",
              hint: "Knowledge",
              section: "Navigate",
              action: () => go(`${scope}/ideas`),
            },
            {
              id: "nav-channels",
              label: "Channels",
              hint: "Integrations",
              section: "Navigate",
              action: () => go(`${scope}/channels`),
            },
            {
              id: "nav-drive",
              label: "Drive",
              hint: "Files",
              section: "Navigate",
              action: () => go(`${scope}/drive`),
            },
            {
              id: "nav-tools",
              label: "Tools",
              hint: "Capabilities",
              section: "Navigate",
              action: () => go(`${scope}/tools`),
            },
            {
              id: "nav-settings",
              label: "Settings",
              hint: "Configuration",
              section: "Navigate",
              action: () => go(`${scope}/settings`),
            },
          ]
        : [
            {
              id: "nav-new",
              label: "New agent",
              hint: "Create",
              section: "Navigate",
              action: () => go("/new"),
            },
          ];

      try {
        const [agentsData, questsData, ideasData] = await Promise.all([
          api.getAgents().catch(() => ({ agents: [] })),
          api.getQuests({}).catch(() => ({ quests: [] })),
          api.getIdeas({ limit: 30 }).catch(() => ({ ideas: [] })),
        ]);

        const rawAgents = (agentsData.agents || []) as Array<Record<string, unknown>>;
        const agentItems: PaletteItem[] = rawAgents.map((a) => ({
          id: `agent-${a.name}`,
          label: (a.display_name || a.name) as string,
          hint: ((a.model || a.status) as string) || "",
          section: "Agents",
          action: () => go(`/${a.name}`),
        }));

        const rawQuests = (questsData.quests || []) as Array<Record<string, unknown>>;
        const questItems: PaletteItem[] = rawQuests.slice(0, 20).map((q) => ({
          id: `quest-${q.id}`,
          label: `${q.id}: ${q.subject}`,
          hint: (q.status as string) || "",
          section: "Quests",
          action: () => go(agentId ? `${scope}/quests/${q.id}` : "/"),
        }));

        const rawIdeas = (ideasData.ideas || []) as Array<Record<string, unknown>>;
        const ideaItems: PaletteItem[] = rawIdeas.slice(0, 15).map((m) => ({
          id: `idea-${m.id || m.name}`,
          label: (m.name || m.title || "Idea") as string,
          hint: ((m.content || "") as string).slice(0, 50),
          section: "Ideas",
          action: () => go(agentId ? `${scope}/ideas/${m.id || m.name}` : "/"),
        }));

        setItems([...navItems, ...agentItems, ...questItems, ...ideaItems]);
      } catch {
        setItems(navItems);
      }
    };
    buildItems();
  }, [open, go, appMode, agentId]);

  const filtered = query
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          (item.hint || "").toLowerCase().includes(query.toLowerCase()),
      )
    : items;

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    }
    if (e.key === "Enter" && filtered[selected]) {
      filtered[selected].action();
    }
  };

  if (!open) return null;

  // Group by section
  const sections: Record<string, PaletteItem[]> = {};
  filtered.forEach((item) => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });

  let globalIndex = 0;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Where to?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-results">
          {Object.entries(sections).map(([section, sectionItems]) => (
            <div key={section}>
              <div className="palette-section">{section}</div>
              {sectionItems.map((item) => {
                const idx = globalIndex++;
                return (
                  <div
                    key={item.id}
                    className={`palette-item ${idx === selected ? "palette-item-active" : ""}`}
                    onClick={item.action}
                    onMouseEnter={() => setSelected(idx)}
                  >
                    <span className="palette-item-label">{item.label}</span>
                    {item.hint && <span className="palette-item-hint">{item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && <div className="palette-empty">No results</div>}
        </div>
      </div>
    </div>
  );
}
