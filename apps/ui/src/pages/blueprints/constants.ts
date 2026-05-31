import type { BlueprintCategory } from "@/lib/types";

export type Kind = "companies" | "agents" | "events" | "quests" | "ideas";
export type Sort = "recent" | "alpha-asc" | "alpha-desc" | "complexity";
export type View = "grid" | "list";

export const KIND_TABS: { id: Kind; label: string }[] = [
  { id: "companies", label: "Companies" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
];
export const KIND_IDS = KIND_TABS.map((t) => t.id);

export const SORT_LABELS: Record<Sort, string> = {
  recent: "Recently added",
  "alpha-asc": "Name (A→Z)",
  "alpha-desc": "Name (Z→A)",
  complexity: "Complexity",
};
export const SORT_ORDER: Sort[] = ["recent", "alpha-asc", "alpha-desc", "complexity"];
export const SORT_VALUES = new Set<Sort>(SORT_ORDER);

export const VIEW_LABELS: Record<View, string> = { grid: "Grid", list: "List" };
export const VIEW_ORDER: View[] = ["grid", "list"];
export const VIEW_VALUES = new Set<View>(VIEW_ORDER);

/** Display order for category sections. Foundation always shown (even empty). */
export const CATEGORY_ORDER: BlueprintCategory[] = ["company", "foundation", "fund"];

export const CATEGORY_LABELS: Record<BlueprintCategory, string> = {
  company: "Operating Company",
  foundation: "Foundation COMPANY",
  fund: "Fund COMPANY",
};

export const CATEGORY_DESCRIPTIONS: Record<BlueprintCategory, string> = {
  company: "Launch a canonical company package with roles, agents, and runtime memory.",
  foundation: "Draft lane for public-good COMPANY packages; not shipped in v1.",
  fund: "Draft lane for investment COMPANY packages; not shipped in v1.",
};

/** Set of valid category param values. */
export const CATEGORY_VALUES = new Set<BlueprintCategory>(CATEGORY_ORDER);

export const V1_SHIPPED_COMPANY_PACKAGE_COUNT = 1;
