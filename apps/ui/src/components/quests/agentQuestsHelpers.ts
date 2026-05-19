import { api } from "@/lib/api";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";
import { QUEST_SORT_MODES, type QuestSort } from "./QuestsSortPopover";
import type { Quest, QuestPriority, ScopeValue } from "@/lib/types";
import { matchesVisibilityFilter } from "../ideas/types";

export const PRIORITY_RANK: Record<QuestPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

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
