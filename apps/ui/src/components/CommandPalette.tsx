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
        { id: "nav-insights", label: "Insights", hint: "Agent knowledge", section: "Navigate", action: () => go("/insights") },
        { id: "nav-settings", label: "Settings", hint: "Configuration", section: "Navigate", action: () => go("/settings") },
      ];

      try {
        const [agentsData, questsData, insightsData] = await Promise.all([
          api.getAgents().catch(() => ({ agents: [] })),
          api.getTasks({}).catch(() => ({ tasks: [] })),
          api.getMemories({ limit: 30 }).catch(() => ({ memories: [] })),
        ]);

        const agentItems: PaletteItem[] = (agentsData.agents || []).map((a: any) => ({
          id: `agent-${a.name}`,
          label: a.display_name || a.name,
          hint: a.model || a.status,
          section: "Agents",
          action: () => go(`/agents/${a.name}`),
        }));

        const questItems: PaletteItem[] = (questsData.tasks || []).slice(0, 20).map((q: any) => ({
          id: `quest-${q.id}`,
          label: `${q.id}: ${q.subject}`,
          hint: q.status,
          section: "Quests",
          action: () => go(`/quests`),
        }));

        const insightItems: PaletteItem[] = (insightsData.memories || []).slice(0, 15).map((m: any) => ({
          id: `insight-${m.id || m.key}`,
          label: m.key || m.title || "Insight",
          hint: (m.content || "").slice(0, 50),
          section: "Insights",
          action: () => go(`/insights`),
        }));

        setItems([...navItems, ...agentItems, ...questItems, ...insightItems]);
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
