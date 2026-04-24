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

export type FilterState = {
  scope: IdeasFilter;
  search: string;
  tag: string | null;
};

export function parseScope(raw: string | null): IdeasFilter {
  return IDEA_FILTER_VALUES.includes(raw as IdeasFilter) ? (raw as IdeasFilter) : "all";
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
