import { type ReactNode, Fragment } from "react";
import type { ScopeValue } from "@/lib/types";

export const IDEA_SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];
export type IdeasFilter = "all" | ScopeValue | "inherited";
export const IDEA_FILTER_VALUES: IdeasFilter[] = [
  "all",
  "self",
  "siblings",
  "children",
  "branch",
  "global",
  "inherited",
];

/** Title-cased display labels for every scope/filter value. The
 *  underlying string identifiers stay lowercase (URL params, JSON
 *  keys); only human-facing labels Title Case per the lowercase-
 *  scope rule (aeqi is the only lowercase brand mark). */
export const SCOPE_LABEL: Record<IdeasFilter, string> = {
  all: "All",
  self: "Self",
  siblings: "Siblings",
  children: "Children",
  branch: "Branch",
  global: "Global",
  inherited: "Inherited",
};

export type SortMode = "tag" | "recent" | "alpha";
export const SORT_MODES: SortMode[] = ["tag", "recent", "alpha"];
export const SORT_LABELS: Record<SortMode, string> = {
  tag: "by tag",
  recent: "recent",
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

// Bucketed recency epochs — Linear/Things/Notion all chunk lists this way
// because relative time alone ("3w") doesn't read as a *journal*. The last
// bucket ("older") catches anything beyond the year so the index stays
// finite. Exported so both the grouping and the section labels share the
// same source of truth.
export type Epoch = "today" | "this-week" | "this-month" | "this-year" | "older";
export const EPOCH_LABELS: Record<Epoch, string> = {
  today: "today",
  "this-week": "this week",
  "this-month": "this month",
  "this-year": "this year",
  older: "older",
};
export const EPOCH_ORDER: Epoch[] = ["today", "this-week", "this-month", "this-year", "older"];

export function epochOf(iso: string | undefined, now = Date.now()): Epoch {
  if (!iso) return "older";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "older";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60 * 60 * 24) return "today";
  if (sec < 60 * 60 * 24 * 7) return "this-week";
  if (sec < 60 * 60 * 24 * 30) return "this-month";
  if (sec < 60 * 60 * 24 * 365) return "this-year";
  return "older";
}

export function parseScope(raw: string | null): IdeasFilter {
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
// typed every idea is equal and the caller's grouping order takes over.
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
