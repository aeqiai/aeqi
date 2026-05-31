import { type ReactNode, Fragment } from "react";
import type { Idea, ScopeValue } from "@/lib/types";

export const IDEA_SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];
export const SCOPE_PICKER_VALUES: ScopeValue[] = ["self", "children", "global"];
export type IdeasFilter = "all" | ScopeValue | "inherited";
export const IDEA_FILTER_VALUES: IdeasFilter[] = ["all", "self", "children", "global", "inherited"];

/** Role-tree visibility labels. The wire values stay on the legacy
 *  agent-tree enum until the server-side role evaluator lands; this is
 *  deliberately only a presentation layer. */
export const SCOPE_LABEL: Record<IdeasFilter, string> = {
  all: "All",
  self: "Role",
  siblings: "COMPANY",
  children: "Team",
  branch: "COMPANY",
  global: "COMPANY",
  inherited: "Inherited",
};

export const SCOPE_HINT: Record<IdeasFilter, string> = {
  all: "Everything visible here",
  self: "Visible to this role and supervising roles",
  siblings: "Existing peer visibility, now shown as COMPANY",
  children: "Visible to this role's downstream team",
  branch: "Existing broad visibility, now shown as COMPANY",
  global: "Visible across this COMPANY",
  inherited: "Visible here, anchored elsewhere",
};

export const PUBLIC_VISIBILITY_LABEL = "Public";
export const PUBLIC_VISIBILITY_HINT =
  "Explicit public visibility is reserved until the backend public scope lands";

export function visibilityBucket(scope: ScopeValue): ScopeValue {
  if (scope === "siblings" || scope === "branch") return "global";
  return scope;
}

export function matchesVisibilityFilter(scope: ScopeValue, filter: ScopeValue): boolean {
  return visibilityBucket(scope) === filter;
}

export type SortMode = "tag" | "recent" | "alpha";
export const SORT_MODES: SortMode[] = ["tag", "recent", "alpha"];
export const SORT_LABELS: Record<SortMode, string> = {
  tag: "Nested",
  recent: "Recent",
  alpha: "A → Z",
};

export type FilterState = {
  scope: IdeasFilter;
  search: string;
  tags: string[];
  sort: SortMode;
  needsReview: boolean;
};

// Tags are stored in the URL as a single comma-separated `?tags=a,b,c`
// param, parsed back into a deduped array. Empty / missing → empty array
// (nothing filtered). Whitespace-only entries are dropped so a stray
// comma doesn't produce a phantom tag chip.
export function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(",")) {
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function serializeTags(tags: string[]): string {
  return tags.join(",");
}

export function parseScope(raw: string | null): IdeasFilter {
  if (raw === "siblings" || raw === "branch") return "global";
  return IDEA_FILTER_VALUES.includes(raw as IdeasFilter) ? (raw as IdeasFilter) : "all";
}

export function parseSort(raw: string | null): SortMode {
  return SORT_MODES.includes(raw as SortMode) ? (raw as SortMode) : "tag";
}

// Linear/Notion-style compact relative time: "now", "3m", "2h", "5d", "3w",
// "6mo", "2y". Falls back to empty string for missing or unparseable input
// so the row never shows a literal "Invalid date".
export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 45) return "now";
  if (sec < 60 * 60) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 60 * 60 * 24) return `${Math.floor(sec / 3600)}h`;
  if (sec < 60 * 60 * 24 * 7) return `${Math.floor(sec / 86400)}d`;
  if (sec < 60 * 60 * 24 * 30) return `${Math.floor(sec / (86400 * 7))}w`;
  if (sec < 60 * 60 * 24 * 365) return `${Math.floor(sec / (86400 * 30))}mo`;
  return `${Math.floor(sec / (86400 * 365))}y`;
}

export function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

export function snippetFor(text: string, query: string, length = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!query) return flat.slice(0, length);
  const words = queryTerms(query);
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
  const half = Math.floor(length / 2);
  const start = Math.max(0, matchIdx - half);
  const end = Math.min(flat.length, start + length);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return prefix + flat.slice(start, end) + suffix;
}

// Split `text` by every occurrence of any query term, wrapping matches
// in <mark> so the active search token is visible at a glance. Case-
// insensitive; runs over plain (already-flattened) snippet strings.
export function highlightMatches(text: string, query: string): ReactNode {
  const terms = queryTerms(query);
  if (!terms.length) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const splitter = new RegExp(`(${escaped.join("|")})`, "gi");
  const termSet = new Set(terms);
  return text.split(splitter).map((part, i) =>
    termSet.has(part.toLowerCase()) ? (
      <mark key={i} className="ideas-list-row-match">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// Match rank — lower = more relevant. Hoists exact-name matches to the
// top so "Thinking → Enter" always opens the most obvious target, then
// name-prefix, then name-contains, then content-only. When nothing is
// typed every idea is equal and the caller's current order takes over.
export function matchRank(idea: { name: string; content: string }, query: string): number {
  if (!query) return 3;
  const q = query.trim().toLowerCase();
  if (!q) return 3;
  const name = idea.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (idea.content.toLowerCase().includes(q)) return 3;
  return 4;
}

export function ideaParentId(idea: Pick<Idea, "parent_idea_id">): string | null {
  return idea.parent_idea_id || null;
}

export function isRootIdea(idea: Idea, knownIds: Set<string>): boolean {
  const parentId = ideaParentId(idea);
  return !parentId || !knownIds.has(parentId);
}

export function isDirectIdeaChildOf(
  idea: Idea,
  parentId: string | null,
  knownIds: Set<string>,
): boolean {
  if (parentId) return ideaParentId(idea) === parentId;
  return isRootIdea(idea, knownIds);
}

export function childCountsByIdeaParent(ideas: Idea[]): Map<string, number> {
  const knownIds = new Set(ideas.map((idea) => idea.id));
  const counts = new Map<string, number>();
  for (const idea of ideas) {
    const parentId = ideaParentId(idea);
    if (!parentId || !knownIds.has(parentId)) continue;
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  }
  return counts;
}

export function ideaAncestors(id: string, ideas: Idea[]): Idea[] {
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const ancestors: Idea[] = [];
  let cursor = byId.get(id);
  const seen = new Set<string>();
  while (cursor?.parent_idea_id && !seen.has(cursor.parent_idea_id)) {
    seen.add(cursor.parent_idea_id);
    const parent = byId.get(cursor.parent_idea_id);
    if (!parent) break;
    ancestors.unshift(parent);
    cursor = parent;
  }
  return ancestors;
}
