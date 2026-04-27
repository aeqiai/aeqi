import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import { useDaemonStore } from "@/store/daemon";
import type { Idea, Quest, QuestPriority, ScopeValue } from "@/lib/types";
import { Button, Input } from "./ui";
import IdeaCanvas from "./IdeaCanvas";
import QuestPriorityPopover from "./quests/QuestPriorityPopover";
import IdeasScopePopover from "./ideas/IdeasScopePopover";

const PRIORITY_LABELS: Record<QuestPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};
void PRIORITY_LABELS;

/**
 * Dedicated quest-compose surface. Replaces the modal — quest creation
 * is now an editor-shaped flow (idea + lifecycle), so it earns the same
 * full-page treatment idea creation gets.
 *
 * Three entry shapes:
 *   - Fresh:     `/agentId/quests?compose=1`           Flow A or B by typing
 *   - From idea: `/agentId/quests?compose=1&fromIdea=` Flow B, idea pinned
 *   - From name: `/agentId/quests?compose=1&name=…`    Flow A, name pre-filled
 */
export default function QuestComposePage({
  agentId,
  resolvedAgentId,
}: {
  agentId: string;
  resolvedAgentId: string;
}) {
  const { goAgent } = useNav();
  const [searchParams] = useSearchParams();
  const fromIdeaId = searchParams.get("fromIdea") ?? null;
  const presetName = searchParams.get("name") ?? "";

  const ideas = useAgentDataStore((s) => s.ideasByAgent[resolvedAgentId]) ?? [];
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);
  const allQuests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);

  const [query, setQuery] = useState(presetName);
  const [pinnedIdea, setPinnedIdea] = useState<Idea | null>(null);
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [scope, setScope] = useState<ScopeValue>("self");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Make sure the agent's idea index is loaded — the compose surface
  // can be deep-linked without first visiting the ideas tab.
  useEffect(() => {
    void loadIdeas(resolvedAgentId);
  }, [loadIdeas, resolvedAgentId]);

  // "+ Track as quest" prefills the pinned idea — resolve it as soon as
  // the agent's idea index lands. Until then `pinnedIdea` stays `null`
  // and the input shows the empty state.
  useEffect(() => {
    if (!fromIdeaId) {
      setPinnedIdea(null);
      return;
    }
    const found = ideas.find((i) => i.id === fromIdeaId);
    if (found) {
      setPinnedIdea(found);
      setQuery(found.name);
    }
  }, [fromIdeaId, ideas]);

  // Idea suggestions ranked by quest count so the most-trafficked specs
  // bubble up first. Mirrors the old modal's logic verbatim — no new
  // ranking heuristic.
  const ideaSuggestions = useMemo(() => {
    if (pinnedIdea) return [];
    const q = query.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const quest of allQuests) {
      if (quest.idea_id) counts.set(quest.idea_id, (counts.get(quest.idea_id) ?? 0) + 1);
    }
    const matches = q ? ideas.filter((i) => i.name.toLowerCase().includes(q)) : ideas.slice(0, 8);
    return matches.slice(0, 8).map((i) => ({ idea: i, questCount: counts.get(i.id) ?? 0 }));
  }, [ideas, query, allQuests, pinnedIdea]);

  const trimmedQuery = query.trim();
  const exactMatch = useMemo(
    () => ideas.find((i) => i.name.toLowerCase() === trimmedQuery.toLowerCase()) ?? null,
    [ideas, trimmedQuery],
  );

  // Body preview source — shown only when a real idea is in scope (pinned
  // or exact match). Fresh-name compose intentionally hides the body
  // editor: the new idea's body lives on its detail page after creation
  // (mirrors how a fresh idea is created without a quest wrapper).
  const bodyIdea = pinnedIdea ?? exactMatch;

  const submit = useCallback(async () => {
    if (busy) return;
    const idea_id = pinnedIdea?.id ?? exactMatch?.id;
    const name = trimmedQuery;
    if (!idea_id && !name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.createQuest({
        project: resolvedAgentId,
        agent_id: resolvedAgentId,
        priority,
        scope,
        ...(idea_id ? { idea_id } : { idea: { name }, subject: name }),
      });
      const newId = res?.quest?.id;
      await fetchQuests();
      if (newId) {
        goAgent(agentId, "quests", newId, { replace: true });
      } else {
        goAgent(agentId, "quests", undefined, { replace: true });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create quest");
      setBusy(false);
    }
  }, [
    busy,
    pinnedIdea?.id,
    exactMatch?.id,
    trimmedQuery,
    priority,
    scope,
    resolvedAgentId,
    fetchQuests,
    goAgent,
    agentId,
  ]);

  const cancel = useCallback(() => {
    goAgent(agentId, "quests", undefined, { replace: true });
  }, [agentId, goAgent]);

  // ⌘↵ commits, Esc bails. Both work anywhere on the page so the user
  // never has to grab the mouse to ship.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submit, cancel]);

  const canSubmit = !!(pinnedIdea || exactMatch || trimmedQuery);

  return (
    <div className="asv-main quest-compose">
      <div className="ideas-list-head">
        <div className="ideas-toolbar">
          <Button variant="secondary" size="sm" onClick={cancel} title="Back to quests">
            <svg
              width="11"
              height="11"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M8 3 L4.5 6.5 L8 10" />
            </svg>
            Quests
          </Button>
          <QuestPriorityPopover priority={priority} onChange={setPriority} />
          <IdeasScopePopover scope={scope} onChange={setScope} />
          <div className="ideas-toolbar-spacer" aria-hidden />
          <Button variant="secondary" size="sm" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
            loading={busy}
            title="Create quest (⌘↵)"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2.8 6.6 L5.4 9.2 L10.2 4" />
            </svg>
            Create
          </Button>
        </div>
      </div>

      <div className="quest-detail-scroll">
        <div className="quest-detail-col">
          <div className="quest-detail-eyebrow">
            <span className="quest-status-dot quest-status-dot--pending" />
            <span className="quest-detail-eyebrow-kind">Quest</span>
            <span className="quest-detail-eyebrow-sep" aria-hidden>
              ·
            </span>
            <span className="quest-detail-eyebrow-id">new</span>
          </div>

          <div className="quest-compose-combobox">
            <Input
              ref={inputRef}
              label="Idea"
              placeholder="Pick an idea or type a new name…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (pinnedIdea) setPinnedIdea(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={busy || !!pinnedIdea}
              autoFocus
              error={err ?? undefined}
            />
            {!pinnedIdea && ideaSuggestions.length > 0 && (
              <div className="quest-compose-suggestions" role="listbox">
                {ideaSuggestions.map(({ idea, questCount }) => (
                  <button
                    key={idea.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="quest-compose-suggestion"
                    onClick={() => {
                      setPinnedIdea(idea);
                      setQuery(idea.name);
                    }}
                  >
                    <span className="quest-compose-suggestion-name">{idea.name}</span>
                    {questCount > 0 && (
                      <span className="quest-compose-suggestion-meta">
                        · {questCount} quest{questCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>
                ))}
                {!exactMatch && trimmedQuery && (
                  <div className="quest-compose-suggestion-hint">
                    ⌘↵ creates a new idea “{trimmedQuery}”
                  </div>
                )}
              </div>
            )}
            {pinnedIdea && (
              <button
                type="button"
                className="quest-compose-unpin"
                onClick={() => {
                  setPinnedIdea(null);
                  setQuery("");
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                Detach idea
              </button>
            )}
          </div>

          {bodyIdea ? (
            <IdeaCanvas
              embedded
              agentId={resolvedAgentId}
              idea={bodyIdea}
              onBack={cancel}
              onNew={cancel}
            />
          ) : (
            trimmedQuery && (
              <p className="quest-compose-hint">
                A new idea named “{trimmedQuery}” will be created with the quest. You can fill in
                the body on the quest detail page.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
