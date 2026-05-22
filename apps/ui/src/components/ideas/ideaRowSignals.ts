import type { Idea } from "@/lib/types";

const WIKI_REF_RE = /!?\[\[([^\]]+)\]\]/g;
const SCOPE_LABELS = {
  self: "Self",
  siblings: "Siblings",
  children: "Children",
  branch: "Branch",
  global: "Global",
} as const;
const PACK_SIGNAL_TAGS = new Set([
  "decision",
  "evergreen",
  "fact",
  "preference",
  "procedure",
  "skill",
]);
const SOURCE_PROPERTY_KEYS = [
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
];
const SOURCE_CONFIDENCE_PROPERTY_KEYS = [
  "confidence",
  "confidence_score",
  "confidence_pct",
  "source_confidence",
  "source_confidence_score",
  "source_confidence_pct",
];
const SOURCE_IMPORT_PROPERTY_KEYS = ["imported_from"];
const RELATIONSHIP_PROPERTY_KEYS = [
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
];
const RELATIONSHIP_LABEL_KEYS = [
  "name",
  "title",
  "label",
  "target",
  "ref",
  "id",
  "idea_id",
  "slug",
];
const RELATIONSHIP_VERB_LABELS: Record<string, string> = {
  relationship: "related",
  relationships: "related",
  related: "related",
  related_to: "related",
  related_idea: "related",
  related_ideas: "related",
  linked_idea: "links",
  linked_ideas: "links",
  links_to: "links",
  see_also: "see also",
  mentions: "mentions",
  embeds: "embeds",
  depends_on: "depends on",
  derived_from: "derived from",
  supersedes: "supersedes",
  superseded_by: "superseded by",
  supports: "supports",
  contradicts: "contradicts",
};

export function isSourcePropertyKey(key: string): boolean {
  return SOURCE_PROPERTY_KEYS.includes(key.toLowerCase());
}

export function isSourceMetadataPropertyKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    SOURCE_PROPERTY_KEYS.includes(normalized) ||
    SOURCE_CONFIDENCE_PROPERTY_KEYS.includes(normalized) ||
    SOURCE_IMPORT_PROPERTY_KEYS.includes(normalized)
  );
}

export function isRelationshipPropertyKey(key: string): boolean {
  return RELATIONSHIP_PROPERTY_KEYS.includes(key.toLowerCase());
}

function normalizedTags(tags: string[]): string[] {
  return tags.map((tag) => tag.toLowerCase());
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1).replace(/[-_]/g, " ");
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function propertyValueForKey(properties: Record<string, unknown>, candidateKey: string): unknown {
  if (candidateKey in properties) return properties[candidateKey];
  const normalizedCandidate = candidateKey.toLowerCase();
  const matchingKey = Object.keys(properties).find(
    (key) => key.toLowerCase() === normalizedCandidate,
  );
  return matchingKey ? properties[matchingKey] : undefined;
}

export function ideaKindLabel(idea: Idea): string {
  if (idea.kind === "file" || idea.file_id) return "File";
  if (idea.kind === "goal") return "Goal";
  if (idea.kind?.startsWith("custom:")) return sentenceCase(idea.kind.slice("custom:".length));
  return "Note";
}

export function ideaScopeLabel(idea: Idea, activeAgentId: string): string {
  if (idea.scope) return SCOPE_LABELS[idea.scope];
  if (idea.agent_id == null) return SCOPE_LABELS.global;
  if (idea.agent_id !== activeAgentId) return "Inherited";
  return SCOPE_LABELS.self;
}

export function ideaSourceLabel(idea: Idea, activeAgentId: string): string {
  const scopeLabel = ideaScopeLabel(idea, activeAgentId);
  if (scopeLabel === "Inherited") return "Inherited memory";
  if (scopeLabel === "Self") return "Role memory";
  if (scopeLabel === "Children") return "Team memory";
  return `${scopeLabel} memory`;
}

function sourceStringLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.hostname.replace(/^www\./, "");
  } catch {
    const fileName = trimmed.split(/[\\/]/).filter(Boolean).at(-1);
    return fileName || trimmed;
  }
}

function sourceValueLabel(value: unknown): string | null {
  if (typeof value === "string") return sourceStringLabel(value);
  if (Array.isArray(value)) {
    const labels = value.map(sourceValueLabel).filter((label): label is string => label !== null);
    if (labels.length === 0) return null;
    const uniqueLabels = [...new Set(labels)];
    return `${uniqueLabels[0]}${uniqueLabels.length > 1 ? ` +${uniqueLabels.length - 1}` : ""}`;
  }
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    for (const key of SOURCE_PROPERTY_KEYS) {
      const label = sourceValueLabel(propertyValueForKey(nested, key));
      if (label) return label;
    }
  }
  return null;
}

function relationshipStringLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const wikiMatch = trimmed.match(/^!?\[\[([^\]]+)\]\]$/);
  if (wikiMatch?.[1]) return wikiMatch[1].trim() || null;
  try {
    const url = new URL(trimmed);
    return url.hostname.replace(/^www\./, "");
  } catch {
    const fileName = trimmed.split(/[\\/]/).filter(Boolean).at(-1);
    return fileName || trimmed;
  }
}

function relationshipValueLabels(value: unknown): string[] {
  if (typeof value === "string") {
    const label = relationshipStringLabel(value);
    return label ? [label] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(relationshipValueLabels);
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    for (const key of RELATIONSHIP_LABEL_KEYS) {
      const labels = relationshipValueLabels(propertyValueForKey(nested, key));
      if (labels.length > 0) return labels;
    }
  }
  return [];
}

function relationshipPropertyLabels(
  properties: Record<string, unknown> | null | undefined,
): string[] {
  const seen = new Set<string>();
  return relationshipPropertyEntries(properties)
    .map((entry) => entry.label)
    .filter((label) => {
      const normalized = label.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function relationshipPropertyEntries(
  properties: Record<string, unknown> | null | undefined,
): { verb: string; label: string }[] {
  if (!properties) return [];
  const entries = RELATIONSHIP_PROPERTY_KEYS.flatMap((key) => {
    const labels = relationshipValueLabels(propertyValueForKey(properties, key));
    return labels.map((label) => ({
      verb: RELATIONSHIP_VERB_LABELS[key] ?? "related",
      label,
    }));
  });
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const normalized = entry.label.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function relationshipPropertyGroups(
  properties: Record<string, unknown> | null | undefined,
): { verb: string; labels: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const entry of relationshipPropertyEntries(properties)) {
    const labels = groups.get(entry.verb) ?? [];
    labels.push(entry.label);
    groups.set(entry.verb, labels);
  }
  return [...groups.entries()].map(([verb, labels]) => ({ verb, labels }));
}

export function ideaSourceDetailLabel(idea: Idea): string | null {
  if (idea.kind === "file" || idea.file_id) return "Source: file";
  const properties = idea.properties ?? {};
  for (const key of SOURCE_PROPERTY_KEYS) {
    const label = sourceValueLabel(propertyValueForKey(properties, key));
    if (label) return `Source: ${label}`;
  }
  return null;
}

export function ideaSourceClarityLabel(idea: Idea): string {
  return ideaSourceDetailLabel(idea) ?? "No source detail";
}

export function ideaSourceOriginLabel(idea: Idea): string | null {
  const properties = idea.properties ?? {};
  for (const key of SOURCE_IMPORT_PROPERTY_KEYS) {
    const label = sourceValueLabel(propertyValueForKey(properties, key));
    if (label) return `Imported: ${label}`;
  }
  return null;
}

export function ideaSourceEvidenceLabel(idea: Idea): string {
  const hasDetail = ideaSourceDetailLabel(idea) !== null;
  if (!hasDetail) return "Evidence missing";
  const hasOrigin = ideaSourceOriginLabel(idea) !== null;
  const hasConfidence = ideaSourceConfidenceLabel(idea) !== null;
  if (hasOrigin && hasConfidence) return "Evidence: import + confidence";
  if (hasConfidence) return "Evidence: confidence";
  if (hasOrigin) return "Evidence: import";
  if (idea.kind === "file" || idea.file_id) return "Evidence: file";
  return "Evidence: named";
}

function sourceConfidenceValueLabel(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > 0 && value <= 1 ? Math.round(value * 100) : Math.round(value);
    return normalized >= 0 && normalized <= 100 ? `${normalized}% confidence` : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed.replace(/%$/, ""));
  if (Number.isFinite(numeric)) {
    const normalized = trimmed.endsWith("%")
      ? Math.round(numeric)
      : numeric > 0 && numeric <= 1
        ? Math.round(numeric * 100)
        : Math.round(numeric);
    return normalized >= 0 && normalized <= 100 ? `${normalized}% confidence` : null;
  }
  return `${sentenceCase(trimmed)} confidence`;
}

export function ideaSourceConfidenceLabel(idea: Idea): string | null {
  const properties = idea.properties ?? {};
  for (const key of SOURCE_CONFIDENCE_PROPERTY_KEYS) {
    const label = sourceConfidenceValueLabel(propertyValueForKey(properties, key));
    if (label) return label;
  }
  return null;
}

export function relationshipCountFor(
  content: string,
  childCount: number,
  properties?: Record<string, unknown> | null,
): number {
  const refs = wikiRelationshipRefs(content);
  const uniqueRefs = new Set([...refs.links.keys(), ...refs.embeds.keys()]);
  for (const label of relationshipPropertyLabels(properties)) {
    uniqueRefs.add(label.toLowerCase());
  }
  return uniqueRefs.size + childCount;
}

function wikiRelationshipRefs(content: string): {
  links: Map<string, string>;
  embeds: Map<string, string>;
} {
  const linkRefs = new Map<string, string>();
  const embedRefs = new Map<string, string>();
  for (const match of content.matchAll(WIKI_REF_RE)) {
    const rawRef = match[1]?.trim();
    if (!rawRef) continue;
    const normalized = rawRef.toLowerCase();
    const targetRefs = match[0].startsWith("![[") ? embedRefs : linkRefs;
    if (!targetRefs.has(normalized)) targetRefs.set(normalized, rawRef);
  }
  return { links: linkRefs, embeds: embedRefs };
}

export function relationshipSummaryLabelFor(
  content: string,
  childCount: number,
  properties?: Record<string, unknown> | null,
): string | null {
  const refs = wikiRelationshipRefs(content);
  const propertyGroups = relationshipPropertyGroups(properties);
  const labels: string[] = [];
  if (refs.links.size > 0) labels.push(plural(refs.links.size, "link"));
  if (refs.embeds.size > 0) labels.push(plural(refs.embeds.size, "embed"));
  for (const group of propertyGroups) {
    labels.push(plural(group.labels.length, group.verb, group.verb));
  }
  if (childCount > 0) labels.push(plural(childCount, "child idea"));
  return labels.length > 0 ? labels.join(" / ") : null;
}

export function relationshipLabelFor(
  content: string,
  childCount: number,
  properties?: Record<string, unknown> | null,
): string | null {
  const refs = wikiRelationshipRefs(content);
  const propertyGroups = relationshipPropertyGroups(properties);
  const labels: string[] = [];
  const linkLabels = [...refs.links.values()];
  if (linkLabels.length > 0) {
    const visibleRefs = linkLabels.slice(0, 2).join(", ");
    const hiddenRefs = linkLabels.length > 2 ? ` +${linkLabels.length - 2}` : "";
    labels.push(`links ${visibleRefs}${hiddenRefs}`);
  }
  const embedLabels = [...refs.embeds.values()];
  if (embedLabels.length > 0) {
    const visibleRefs = embedLabels.slice(0, 2).join(", ");
    const hiddenRefs = embedLabels.length > 2 ? ` +${embedLabels.length - 2}` : "";
    labels.push(`embeds ${visibleRefs}${hiddenRefs}`);
  }
  for (const group of propertyGroups) {
    const visibleRefs = group.labels.slice(0, 2).join(", ");
    const hiddenRefs = group.labels.length > 2 ? ` +${group.labels.length - 2}` : "";
    labels.push(`${group.verb} ${visibleRefs}${hiddenRefs}`);
  }
  if (childCount > 0) {
    labels.push(plural(childCount, "child idea"));
  }
  return labels.length > 0 ? labels.join(" / ") : null;
}

export function tagCoverageLabel(tags: string[]): string {
  if (tags.length === 0) return "No tags";
  if (tags.length === 1) return `#${tags[0]}`;
  return `${plural(tags.length, "tag")}: #${tags.slice(0, 2).join(", #")}${
    tags.length > 2 ? ` +${tags.length - 2}` : ""
  }`;
}

export function topTagSummaryLabel(tagCounts: [string, number][]): string | null {
  if (tagCounts.length === 0) return null;
  const visible = tagCounts.slice(0, 3);
  const summary = visible.map(([tag, count]) => `#${tag} ${count}`).join(" / ");
  return `${summary}${tagCounts.length > visible.length ? ` / +${tagCounts.length - visible.length}` : ""}`;
}

export function decisionLabel(tags: string[]): string | null {
  const normalized = normalizedTags(tags);
  if (normalized.includes("promoted")) return "Promoted";
  if (normalized.includes("rejected")) return "Rejected";
  if (normalized.includes("candidate")) return "Candidate";
  if (normalized.includes("decision")) return "Decision";
  return null;
}

export function knowledgePackLabel(
  tags: string[],
  wordCount: number,
  relationshipCount: number,
): string | null {
  const normalized = normalizedTags(tags);
  if (normalized.includes("candidate")) {
    return tags.length >= 2 && (wordCount >= 24 || relationshipCount > 0) ? "Pack draft" : null;
  }
  if (normalized.includes("rejected")) return null;
  const hasPackSignal = normalized.some((tag) => PACK_SIGNAL_TAGS.has(tag));
  if (hasPackSignal && wordCount >= 24) return "Pack core";
  if (tags.length >= 2 && (wordCount >= 80 || relationshipCount > 0)) return "Pack draft";
  return null;
}

export function knowledgePackActionLabel(
  tags: string[],
  wordCount: number,
  relationshipCount: number,
  hasSourceDetail: boolean,
): string | null {
  const packLabel = knowledgePackLabel(tags, wordCount, relationshipCount);
  if (!packLabel) return null;
  if (!hasSourceDetail && relationshipCount === 0) return "Pack needs source + links";
  if (!hasSourceDetail) return "Pack needs source";
  if (relationshipCount === 0) return "Pack needs links";
  return "Pack ready";
}

export function knowledgePackProgressLabel(
  tags: string[],
  wordCount: number,
  relationshipCount: number,
  hasSourceDetail: boolean,
): string | null {
  const packLabel = knowledgePackLabel(tags, wordCount, relationshipCount);
  if (!packLabel) return null;
  const readyCount = 1 + (hasSourceDetail ? 1 : 0) + (relationshipCount > 0 ? 1 : 0);
  return `Pack ${readyCount}/3`;
}

export function knowledgePackChecklistLabel(
  tags: string[],
  wordCount: number,
  relationshipCount: number,
  hasSourceDetail: boolean,
): string | null {
  const action = knowledgePackActionLabel(tags, wordCount, relationshipCount, hasSourceDetail);
  if (action === "Pack needs source + links") return "Missing source + links";
  if (action === "Pack needs source") return "Missing source";
  if (action === "Pack needs links") return "Missing links";
  if (action === "Pack ready") return "Source + links ready";
  return null;
}

export function knowledgePackReadinessLabel(
  tags: string[],
  wordCount: number,
  relationshipCount: number,
  hasSourceDetail: boolean,
): string | null {
  const packLabel = knowledgePackLabel(tags, wordCount, relationshipCount);
  if (!packLabel) return null;
  const readyCount = 1 + (hasSourceDetail ? 1 : 0) + (relationshipCount > 0 ? 1 : 0);
  const missing: string[] = [];
  if (!hasSourceDetail) missing.push("source");
  if (relationshipCount === 0) missing.push("links");
  if (missing.length === 0) return "3/3 ready: source + links";
  return `${readyCount}/3 ready: missing ${missing.join(" + ")}`;
}

export function knowledgePackStageLabel(
  tags: string[],
  wordCount: number,
  relationshipCount: number,
  hasSourceDetail: boolean,
): string | null {
  const packLabel = knowledgePackLabel(tags, wordCount, relationshipCount);
  if (!packLabel) return null;
  const missing: string[] = [];
  if (!hasSourceDetail) missing.push("source");
  if (relationshipCount === 0) missing.push("links");
  if (missing.length === 0) return `${packLabel} ready`;
  return `${packLabel} needs ${missing.join(" + ")}`;
}

export function memoryReadinessLabel({
  tags,
  hasSourceDetail,
  relationshipCount,
}: {
  tags: string[];
  hasSourceDetail: boolean;
  relationshipCount: number;
}): string {
  const readyCount =
    (tags.length > 0 ? 1 : 0) + (hasSourceDetail ? 1 : 0) + (relationshipCount > 0 ? 1 : 0);
  return `Ready ${readyCount}/3`;
}

export function ideaPrimarySignalLabel({
  decision,
  knowledgePack,
  packAction,
  relationshipCount,
  sourceLabel,
}: {
  decision: string | null;
  knowledgePack: string | null;
  packAction: string | null;
  relationshipCount: number;
  sourceLabel: string;
}): string {
  if (decision === "Candidate" || decision === "Rejected") return decision;
  return (
    packAction ??
    knowledgePack ??
    decision ??
    (relationshipCount > 0 ? "Linked memory" : sourceLabel)
  );
}

export function ideaSignalTone(
  tags: string[],
  decision: string | null,
  knowledgePack: string | null,
  packAction: string | null = null,
): "info" | "warning" | "success" | "muted" {
  const normalized = normalizedTags(tags);
  if (packAction?.includes("needs")) return "warning";
  if (decision === "Candidate" || normalized.includes("candidate")) return "warning";
  if (packAction === "Pack ready") return "success";
  if (decision === "Promoted" || decision === "Decision" || knowledgePack === "Pack core") {
    return "success";
  }
  if (knowledgePack === "Pack draft") {
    return "warning";
  }
  if (tags.length > 0) return "info";
  return "muted";
}
