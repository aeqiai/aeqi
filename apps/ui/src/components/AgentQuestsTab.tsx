import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Loading } from "./ui";
import QuestCanvas from "./QuestCanvas";
import type { Quest, QuestStatus, User } from "@/lib/types";
import type { QuestsView } from "./quests/questView";
import type { QuestSort } from "./quests/QuestsSortPopover";
import QuestBoard from "./quests/QuestBoard";
import TrackIdeaAsQuestModal from "./quests/TrackIdeaAsQuestModal";
import {
  childCountsByParent,
  isDirectChildOf,
  matchesQuestFilter,
  parseQuestFilter,
  parseQuestSort,
  questAncestors,
  questParentId,
} from "./quests/agentQuestsHelpers";

const QUEST_STATUS_VALUES: QuestStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

function parseQuestStatus(raw: string | null): QuestStatus | null {
  return raw && QUEST_STATUS_VALUES.includes(raw as QuestStatus) ? (raw as QuestStatus) : null;
}

export default function AgentQuestsTab({
  agentId,
  scope = "agent",
  kind,
}: {
  agentId: string;
  scope?: "agent" | "entity";
  kind?: "project";
}) {
  const { goEntity, companyId } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  // `/<agentId>/quests/new` is the dedicated compose surface; any other
  // `:itemId` is a quest id to look up. The literal `"new"` slug is
  // reserved — quest ids carry a numeric `prefix-NNN` shape so there's
  // no collision risk.
  const composing = itemId === "new";
  const selectedId = !composing && itemId ? itemId : null;

  // View + sort persist in URL (mirrors AgentIdeasTab idiom). The
  // compose page also accepts `?fromIdea=<id>` to pre-pin Flow B.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: QuestsView = searchParams.get("view") === "list" ? "list" : "board";
  const sort: QuestSort = parseQuestSort(searchParams.get("sort"));
  const query = searchParams.get("q") ?? "";
  const questFilter = parseQuestFilter(searchParams.get("visibility"));
  const boardScopeId = searchParams.get("scope") || null;
  const fromIdeaId = searchParams.get("fromIdea");
  const composingFromIdea = composing && Boolean(fromIdeaId);
  const presetStatus = parseQuestStatus(searchParams.get("status"));
  const parentQuestId = searchParams.get("parent") ?? null;

  const openCompose = useCallback(
    (opts?: { fromIdea?: string; status?: QuestStatus; parent?: string }) => {
      const search: Record<string, string> = {};
      if (opts?.fromIdea) search.fromIdea = opts.fromIdea;
      if (opts?.status) search.status = opts.status;
      if (opts?.parent) search.parent = opts.parent;
      goEntity(companyId, "quests", "new", {
        replace: false,
        search: Object.keys(search).length > 0 ? search : undefined,
      });
    },
    [companyId, goEntity],
  );

  const setView = useCallback(
    (next: QuestsView) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next === "list") np.set("view", "list");
          else np.delete("view");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSort = useCallback(
    (next: QuestSort) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next !== "updated") np.set("sort", next);
          else np.delete("sort");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setQuery = useCallback(
    (next: string) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next) np.set("q", next);
          else np.delete("q");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setQuestFilter = useCallback(
    (next: ReturnType<typeof parseQuestFilter>) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next !== "all") np.set("visibility", next);
          else np.delete("visibility");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const questsLoaded = useDaemonStore((s) => s.initialLoaded);
  const currentUser = useAuthStore((s) => s.user);
  // Candidate humans for the assignee picker. Today this is just the
  // authenticated user — every quest is reassignable to "me." A future
  // ship adds collaborators via a `GET /agents/:id/users` endpoint
  // backed by the platform's `user_access` junction.
  const assigneeUsers = useMemo<Pick<User, "id" | "name" | "email" | "avatar_url">[]>(() => {
    if (!currentUser) return [];
    return [
      {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        avatar_url: currentUser.avatar_url,
      },
    ];
  }, [currentUser]);

  const agent = agents.find((a) => a.id === agentId);
  const listQuest = selectedId ? quests.find((q) => q.id === selectedId) : undefined;

  // Detail view fetches the joined `{ quest, idea }` shape from
  // `GET /quests/:id` so the body renders the linked idea via `<IdeaCanvas>`.
  // The list payload is the fallback while the detail is in flight.
  const [questDetail, setQuestDetail] = useState<Quest | undefined>(undefined);
  useEffect(() => {
    if (!selectedId) {
      setQuestDetail(undefined);
      return;
    }
    let cancelled = false;
    api
      .getQuest(selectedId)
      .then((res) => {
        if (cancelled || !res?.quest) return;
        // Splice the top-level `idea` and the joined fields back onto the
        // quest so consumers can read `quest.idea?.content` uniformly.
        setQuestDetail({ ...res.quest, idea: res.idea ?? res.quest.idea });
      })
      .catch(() => {
        if (!cancelled) setQuestDetail(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, listQuest?.updated_at]);

  const quest = questDetail ?? listQuest;

  const closeTrackModal = useCallback(() => {
    const preserved: Record<string, string> = {};
    for (const key of ["view", "sort", "q", "visibility", "scope"]) {
      const value = searchParams.get(key);
      if (value) preserved[key] = value;
    }
    goEntity(companyId, "quests", undefined, {
      replace: true,
      search: Object.keys(preserved).length > 0 ? preserved : undefined,
    });
  }, [goEntity, searchParams, companyId]);

  const handleTrackedQuestCreated = useCallback(
    async (created: Quest) => {
      await fetchQuests();
      goEntity(companyId, "quests", created.id, { replace: true });
    },
    [fetchQuests, goEntity, companyId],
  );

  // Rail's create button → navigate to the dedicated compose page.
  useEffect(() => {
    const handler = () => openCompose();
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, [openCompose]);

  // Compose and view land on the same `<QuestCanvas>` unless the route
  // carries `?fromIdea=<id>`. That flow wraps an existing idea, so it uses
  // the compact modal instead of the full idea editor.
  if (composing && !composingFromIdea) {
    return <QuestCanvas kind="compose" agentId={agentId} resolvedAgentId={agent?.id || agentId} />;
  }

  if (!quest) {
    if (!questsLoaded) {
      return (
        <div className="quest-board-loading">
          <Loading variant="section" size="md" label="Loading quests" showLabel />
        </div>
      );
    }
    // Company tabs are already scoped by the X-Company header. Do not
    // re-narrow them to the default agent, or quests owned by sibling
    // agents disappear from /company/<addr>/quests.
    const visibleQuests =
      scope === "entity"
        ? quests
        : quests.filter((q) => q.agent_id === agent?.id || q.agent_id == null);
    const kindFilteredQuests = kind
      ? visibleQuests.filter((q) => (q.kind ?? "task") === kind)
      : visibleQuests;
    const filteredQuests =
      questFilter === "all"
        ? kindFilteredQuests
        : kindFilteredQuests.filter((q) =>
            matchesQuestFilter(q, questFilter, agent?.id ?? agentId),
          );
    const visibleQuestIds = new Set(filteredQuests.map((q) => q.id));
    const activeScopeId = boardScopeId && visibleQuestIds.has(boardScopeId) ? boardScopeId : null;
    // When scoped, the board renders the parent quest itself alongside
    // its direct children — the parent appears in its own status column
    // with the scope-highlight ring so it's clear the user can still
    // drag-move it without leaving the scoped view.
    const scopedQuests = activeScopeId
      ? filteredQuests.filter((q) => q.id === activeScopeId || isDirectChildOf(q, activeScopeId))
      : filteredQuests.filter((q) => isDirectChildOf(q, null));
    const childCounts = childCountsByParent(filteredQuests);
    const scopeQuest = activeScopeId ? filteredQuests.find((q) => q.id === activeScopeId) : null;
    const scopeAncestors = activeScopeId ? questAncestors(activeScopeId, filteredQuests) : [];
    const setBoardScope = (next: string | null) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next) np.set("scope", next);
          else np.delete("scope");
          return np;
        },
        { replace: false },
      );
    };
    const board = (
      <QuestBoard
        agentId={agentId}
        resolvedAgentId={agent?.id || agentId}
        companyId={companyId}
        quests={scopedQuests}
        allQuests={visibleQuests}
        scopeFilter={questFilter}
        onScopeChange={setQuestFilter}
        onCreated={fetchQuests}
        onPick={(id) => {
          if ((childCounts.get(id) ?? 0) > 0) setBoardScope(id);
          else goEntity(companyId, "quests", id);
        }}
        onCompose={(status) =>
          openCompose({
            ...(status ? { status } : {}),
            ...(activeScopeId ? { parent: activeScopeId } : {}),
          })
        }
        boardScopeId={activeScopeId}
        boardScopeQuest={scopeQuest ?? undefined}
        boardScopeAncestors={scopeAncestors}
        childCounts={childCounts}
        onBoardScopeChange={setBoardScope}
        onOpenQuest={(id) => goEntity(companyId, "quests", id)}
        onOpenParent={(id) => setBoardScope(questParentId(id))}
        search={query}
        onSearchChange={setQuery}
        view={view}
        onViewChange={setView}
        sort={sort}
        onSortChange={setSort}
        agents={agents}
        users={assigneeUsers}
        splitLayout={scope === "entity"}
      />
    );
    const content = scope === "entity" ? <div className="company-quests">{board}</div> : board;
    if (!composingFromIdea) return content;
    return (
      <>
        {content}
        <TrackIdeaAsQuestModal
          open
          ideaId={fromIdeaId}
          agentId={agent?.id || agentId}
          companyId={companyId}
          initialStatus={presetStatus ?? "todo"}
          parentQuestId={parentQuestId}
          onClose={closeTrackModal}
          onCreated={handleTrackedQuestCreated}
        />
      </>
    );
  }

  return (
    <QuestCanvas
      kind="view"
      agentId={agentId}
      resolvedAgentId={agent?.id || agentId}
      quest={quest}
    />
  );
}
