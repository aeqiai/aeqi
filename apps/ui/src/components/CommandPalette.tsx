import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

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

  const go = useCallback((path: string) => { navigate(path); onClose(); }, [navigate, onClose]);

  useEffect(() => {
    if (!open) { setQuery(""); setSelected(0); return; }
    inputRef.current?.focus();

    const buildItems = async () => {
      const navItems: PaletteItem[] = [
        { id: "nav-dashboard", label: "Dashboard", hint: "Overview", section: "Navigate", action: () => go("/") },
        { id: "nav-quests", label: "Quests", hint: "View all quests", section: "Navigate", action: () => go("/quests") },
        { id: "nav-sessions", label: "Sessions", hint: "Agent sessions", section: "Navigate", action: () => go("/sessions") },
        { id: "nav-events", label: "Events", hint: "Event stream", section: "Navigate", action: () => go("/events") },
        { id: "nav-ideas", label: "Ideas", hint: "Agent knowledge", section: "Navigate", action: () => go("/ideas") },
        { id: "nav-settings", label: "Settings", hint: "Configuration", section: "Navigate", action: () => go("/settings") },
      ];

      try {
        const [agentsData, questsData, ideasData] = await Promise.all([
          api.getAgents().catch(() => ({ agents: [] })),
          api.getTasks({}).catch(() => ({ tasks: [] })),
          api.getIdeas({ limit: 30 }).catch(() => ({ ideas: [] })),
        ]);

        const rawAgents = (agentsData.agents || []) as Array<Record<string, unknown>>;
        const agentItems: PaletteItem[] = rawAgents.map((a) => ({
          id: `agent-${a.name}`,
          label: (a.display_name || a.name) as string,
          hint: ((a.model || a.status) as string) || "",
          section: "Agents",
          action: () => go(`/agents/${a.name}`),
        }));

        const rawQuests = (questsData.tasks || []) as Array<Record<string, unknown>>;
        const questItems: PaletteItem[] = rawQuests.slice(0, 20).map((q) => ({
          id: `quest-${q.id}`,
          label: `${q.id}: ${q.subject}`,
          hint: (q.status as string) || "",
          section: "Quests",
          action: () => go(`/quests`),
        }));

        const rawIdeas = (ideasData.ideas || []) as Array<Record<string, unknown>>;
        const ideaItems: PaletteItem[] = rawIdeas.slice(0, 15).map((m) => ({
          id: `idea-${m.id || m.key}`,
          label: (m.key || m.title || "Idea") as string,
          hint: ((m.content || "") as string).slice(0, 50),
          section: "Ideas",
          action: () => go(`/ideas`),
        }));

        setItems([...navItems, ...agentItems, ...questItems, ...ideaItems]);
      } catch {
        setItems(navItems);
      }
    };
    buildItems();
  }, [open, go]);

  const filtered = query
    ? items.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        (item.hint || "").toLowerCase().includes(query.toLowerCase())
      )
    : items;

  useEffect(() => { setSelected(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && filtered[selected]) { filtered[selected].action(); }
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
          {filtered.length === 0 && (
            <div className="palette-empty">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
