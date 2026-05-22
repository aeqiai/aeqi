import type { ScopeValue } from "@/lib/types";
import { asStringArray } from "@/lib/frontmatter";

const FRONTMATTER_SOURCE_KEYS = [
  "source",
  "sources",
  "source_label",
  "source_title",
  "source_url",
  "source_urls",
  "reference",
  "references",
  "citation",
  "citations",
  "origin",
  "origin_url",
  "url",
  "link",
  "links",
  "document",
  "document_url",
  "href",
  "path",
  "file",
  "filename",
] as const;

const FRONTMATTER_SOURCE_CONFIDENCE_KEYS = [
  "confidence",
  "confidence_score",
  "confidence_pct",
  "source_confidence",
  "source_confidence_score",
  "source_confidence_pct",
] as const;

const FRONTMATTER_RELATIONSHIP_KEYS = [
  "relationship",
  "relationships",
  "related",
  "related_to",
  "related_idea",
  "related_ideas",
  "linked_idea",
  "linked_ideas",
  "links_to",
  "see_also",
  "mentions",
  "embeds",
  "depends_on",
  "derived_from",
  "supersedes",
  "superseded_by",
  "supports",
  "contradicts",
] as const;

const FRONTMATTER_SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];

export function isMarkdownFile(file: File): boolean {
  return /\.(md|markdown)$/i.test(file.name) || file.type === "text/markdown";
}

export function importIdeaProperties(
  data: Record<string, string | string[]>,
  fileName: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of FRONTMATTER_SOURCE_KEYS) {
    const value = data[key];
    if (value && (!Array.isArray(value) || value.length > 0)) {
      properties.source = value;
      break;
    }
  }
  if (!properties.source) properties.source = fileName;
  if (properties.source !== fileName) properties.imported_from = fileName;
  for (const key of FRONTMATTER_SOURCE_CONFIDENCE_KEYS) {
    const value = data[key];
    if (value && (!Array.isArray(value) || value.length > 0)) {
      properties.source_confidence = value;
      break;
    }
  }
  for (const key of FRONTMATTER_RELATIONSHIP_KEYS) {
    const value = data[key];
    if (value && (!Array.isArray(value) || value.length > 0)) {
      properties[key] = value;
    }
  }
  return properties;
}

export function importIdeaScope(data: Record<string, string | string[]>): ScopeValue | undefined {
  const [rawScope] = asStringArray(data.scope);
  if (!rawScope) return undefined;
  const normalized = rawScope.trim().toLowerCase();
  return FRONTMATTER_SCOPE_VALUES.includes(normalized as ScopeValue)
    ? (normalized as ScopeValue)
    : undefined;
}
