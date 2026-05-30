import { api } from "@/lib/api";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";
import { QUEST_SORT_MODES, type QuestSort } from "./QuestsSortPopover";
import type { Quest, QuestPriority, QuestStatus, ScopeValue } from "@/lib/types";
import { matchesVisibilityFilter } from "../ideas/types";

export const PRIORITY_RANK: Record<QuestPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const QUEST_ACTIVE_COLUMNS: Array<{ status: QuestStatus; label: string }> = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In progress" },
  { status: "in_review", label: "In review" },
  { status: "done", label: "Done" },
];

export const QUEST_ALL_COLUMNS: Array<{ status: QuestStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  ...QUEST_ACTIVE_COLUMNS,
  { status: "cancelled", label: "Cancelled" },
];

export const byUpdatedDesc = (a: Quest, b: Quest) =>
  (b.updated_at || "").localeCompare(a.updated_at || "");

export function sortQuests(arr: Quest[], mode: QuestSort): Quest[] {
  const sorted = [...arr];
  switch (mode) {
    case "updated":
      return sorted.sort(byUpdatedDesc);
    case "created":
      return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "priority":
      return sorted.sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byUpdatedDesc(a, b),
      );
    case "due":
      // Soonest due first; quests without a due-date sink to the
      // bottom (Linear convention). Same-day ties fall back to recent
      // update.
      return sorted.sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
        const db = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return byUpdatedDesc(a, b);
      });
    case "subject":
      return sorted.sort(
        (a, b) => (a.idea?.name ?? "").localeCompare(b.idea?.name ?? "") || byUpdatedDesc(a, b),
      );
  }
}

export function parseQuestSort(raw: string | null): QuestSort {
  return QUEST_SORT_MODES.includes(raw as QuestSort) ? (raw as QuestSort) : "updated";
}

export const QUEST_SCOPE_VALUES: ScopeValue[] = [
  "self",
  "siblings",
  "children",
  "branch",
  "global",
];
export type QuestFilter = "all" | ScopeValue | "inherited";
export const QUEST_FILTER_VALUES: QuestFilter[] = [
  "all",
  "self",
  "children",
  "global",
  "inherited",
];

export function parseQuestFilter(raw: string | null): QuestFilter {
  if (raw === "siblings" || raw === "branch") return "global";
  return QUEST_FILTER_VALUES.includes(raw as QuestFilter) ? (raw as QuestFilter) : "all";
}

export function isQuestInherited(q: Quest, agentId: string): boolean {
  return q.agent_id != null && q.agent_id !== agentId;
}

const QUEST_PRIORITIES = ["critical", "high", "normal", "low"] as const;
type QuestPriorityValue = (typeof QUEST_PRIORITIES)[number];

/**
 * Import a single markdown file as a quest. `subject` is the first H1
 * (or filename stripped of extension); `description` is the remaining
 * body. Frontmatter `priority` overrides the default `normal` if set
 * and recognized.
 */
export async function importQuestFromMarkdown(file: File, agentId: string): Promise<void> {
  const raw = await file.text();
  const { body, data } = parseFrontmatter(raw);
  const filenameSubject = file.name.replace(/\.(md|markdown)$/i, "") || "Untitled";
  // First-H1 wins over filename (frontmatter `subject` wins over both).
  const h1Match = /^\s*#\s+(.+?)\s*$/m.exec(body);
  const h1Subject = h1Match ? h1Match[1].trim() : "";
  const subject =
    (typeof data.subject === "string" && data.subject.trim()) || h1Subject || filenameSubject;
  const description = h1Match ? body.replace(h1Match[0], "").trim() : body.trim();
  const priorityRaw = typeof data.priority === "string" ? data.priority.toLowerCase() : "";
  const priority: QuestPriorityValue = (QUEST_PRIORITIES as readonly string[]).includes(priorityRaw)
    ? (priorityRaw as QuestPriorityValue)
    : "normal";
  const tags = asStringArray(data.tags);
  // Flow A: mint a fresh idea row, wrap a quest around it. The subject
  // becomes the idea name; the body becomes the idea content; quest
  // metadata (priority) lives on the quest row itself.
  await api.createQuest({
    project: agentId,
    priority,
    agent_id: agentId,
    idea: { name: subject, content: description, tags, agent_id: agentId },
  });
}

export function matchesQuestFilter(q: Quest, filter: QuestFilter, agentId: string): boolean {
  if (filter === "all") return true;
  if (filter === "inherited") return isQuestInherited(q, agentId);
  if (q.scope != null) return matchesVisibilityFilter(q.scope, filter);
  if (filter === "self") return q.agent_id === agentId;
  if (filter === "global") return q.agent_id == null;
  return false;
}

export function questParentId(id: string): string | null {
  const i = id.lastIndexOf(".");
  return i === -1 ? null : id.slice(0, i);
}

export function isRootQuest(q: Quest): boolean {
  return questParentId(q.id) === null;
}

export function isDirectChildOf(q: Quest, parentId: string | null): boolean {
  return questParentId(q.id) === parentId;
}

export function childCountsByParent(quests: Quest[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const q of quests) {
    const parentId = questParentId(q.id);
    if (!parentId) continue;
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  }
  return counts;
}

export function questAncestors(id: string, quests: Quest[]): Quest[] {
  const byId = new Map(quests.map((q) => [q.id, q]));
  const ancestors: Quest[] = [];
  let parentId = questParentId(id);
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = questParentId(parentId);
  }
  return ancestors;
}

export interface QuestDiscoveryHit {
  quest: Quest;
  score: number;
  reasons: string[];
}

const SEARCH_TOKEN_RE = /[a-z0-9]+/g;

const DIRECT_FIELD_WEIGHTS: Array<{ label: string; weight: number; value: (q: Quest) => string }> =
  [
    { label: "title", weight: 70, value: (q) => q.idea?.name ?? "" },
    { label: "body", weight: 38, value: (q) => q.idea?.content ?? "" },
    { label: "tags", weight: 46, value: (q) => (q.idea?.tags ?? []).join(" ") },
    { label: "id", weight: 62, value: (q) => q.id },
    { label: "assignee", weight: 18, value: (q) => q.assignee ?? "" },
    { label: "agent", weight: 16, value: (q) => q.agent_id ?? "" },
    { label: "status", weight: 12, value: (q) => q.status.replaceAll("_", " ") },
    { label: "priority", weight: 8, value: (q) => q.priority },
  ];

function normalizeSearch(raw: string): { phrase: string; tokens: string[] } {
  const lower = raw.trim().toLowerCase();
  const tokens = Array.from(new Set(lower.match(SEARCH_TOKEN_RE) ?? []));
  return { phrase: lower, tokens };
}

function scoreField(value: string, phrase: string, tokens: string[], weight: number): number {
  if (!value || tokens.length === 0) return 0;
  const haystack = value.toLowerCase();
  if (phrase && haystack.includes(phrase)) return weight;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  if (hits === 0) return 0;
  return Math.max(4, Math.round((weight * hits) / tokens.length / 2));
}

function addReason(reasons: string[], label: string): void {
  if (!reasons.includes(label)) reasons.push(label);
}

function addHit(
  hits: Map<string, { score: number; reasons: string[] }>,
  questId: string,
  score: number,
  reason: string,
): void {
  if (score <= 0) return;
  const current = hits.get(questId);
  if (!current) {
    hits.set(questId, { score, reasons: [reason] });
    return;
  }
  current.score += score;
  addReason(current.reasons, reason);
}

/**
 * Rank quests for the board search box.
 *
 * The board stays operational, but search becomes graph-aware:
 * direct quest fields score highest, then related quests get a smaller
 * boost when their parent/child/dependency/shared-spec neighbors match.
 */
export function rankQuestDiscovery(quests: Quest[], rawSearch: string): QuestDiscoveryHit[] {
  const { phrase, tokens } = normalizeSearch(rawSearch);
  if (tokens.length === 0) return [];

  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const childrenByParent = new Map<string, Quest[]>();
  const dependentsByTarget = new Map<string, Quest[]>();
  for (const quest of quests) {
    const parentId = questParentId(quest.id);
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(quest);
    childrenByParent.set(parentId, list);
  }
  for (const quest of quests) {
    for (const depId of quest.depends_on ?? []) {
      const list = dependentsByTarget.get(depId) ?? [];
      list.push(quest);
      dependentsByTarget.set(depId, list);
    }
  }

  const directHits = new Map<string, { score: number; reasons: string[] }>();
  for (const quest of quests) {
    const reasons: string[] = [];
    let score = 0;
    for (const field of DIRECT_FIELD_WEIGHTS) {
      const fieldScore = scoreField(field.value(quest), phrase, tokens, field.weight);
      if (fieldScore > 0) {
        score += fieldScore;
        addReason(reasons, field.label);
      }
    }
    if (score > 0) directHits.set(quest.id, { score, reasons });
  }

  const ranked = new Map<string, { score: number; reasons: string[] }>();
  for (const quest of quests) {
    const direct = directHits.get(quest.id);
    if (!direct) continue;
    ranked.set(quest.id, { score: direct.score, reasons: [...direct.reasons] });
  }

  for (const [questId, direct] of directHits.entries()) {
    const quest = byId.get(questId);
    if (!quest) continue;
    const boost = Math.max(4, Math.round(direct.score * 0.3));

    const parentId = questParentId(quest.id);
    if (parentId) {
      addHit(ranked, parentId, boost, "child");
    }

    for (const child of childrenByParent.get(quest.id) ?? []) {
      addHit(ranked, child.id, Math.max(4, Math.round(boost * 0.8)), "parent");
    }

    for (const dependent of dependentsByTarget.get(quest.id) ?? []) {
      addHit(ranked, dependent.id, Math.max(4, Math.round(boost * 0.9)), "dependency");
    }

    for (const siblingId of quest.sibling_quest_ids ?? []) {
      if (byId.has(siblingId)) {
        addHit(ranked, siblingId, Math.max(4, Math.round(boost * 0.85)), "shared spec");
      }
    }
  }

  return Array.from(ranked.entries())
    .map(([questId, hit]) => ({
      quest: byId.get(questId)!,
      score: hit.score,
      reasons: hit.reasons,
    }))
    .filter((hit) => hit.quest != null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.quest.updated_at ?? b.quest.created_at).localeCompare(
          a.quest.updated_at ?? a.quest.created_at,
        ) ||
        a.quest.id.localeCompare(b.quest.id),
    );
}

export function summarizeQuestDiscoveryReasons(reasons: string[]): string {
  const unique = Array.from(new Set(reasons));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  return `${unique[0]} +${unique.length - 1}`;
}
