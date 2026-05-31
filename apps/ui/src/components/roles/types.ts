import type { OccupantKind } from "@/lib/types";

export type RolesView = "chart" | "cards" | "list";
export type RolesSort = "title" | "recent" | "kind";
export type OccupantFilter = "all" | OccupantKind;

export const ROLES_VIEW_VALUES: RolesView[] = ["chart", "cards", "list"];
export const ROLES_SORT_VALUES: RolesSort[] = ["title", "recent", "kind"];
export const OCCUPANT_FILTER_VALUES: OccupantFilter[] = [
  "all",
  "agent",
  "human",
  "company",
  "vacant",
];

export const ROLES_VIEW_LABEL: Record<RolesView, string> = {
  chart: "Org chart",
  cards: "Cards",
  list: "List",
};

export const ROLES_SORT_LABEL: Record<RolesSort, string> = {
  title: "Alphabetical",
  recent: "Most recent",
  kind: "By occupant",
};

export const OCCUPANT_FILTER_LABEL: Record<OccupantFilter, string> = {
  all: "All",
  agent: "Agent",
  human: "Human",
  company: "COMPANY",
  vacant: "Vacant",
};

export const parseView = (raw: string | null): RolesView =>
  raw && (ROLES_VIEW_VALUES as string[]).includes(raw) ? (raw as RolesView) : "chart";

export const parseSort = (raw: string | null): RolesSort =>
  raw && (ROLES_SORT_VALUES as string[]).includes(raw) ? (raw as RolesSort) : "title";

export const parseOccupantFilter = (raw: string | null): OccupantFilter =>
  raw && (OCCUPANT_FILTER_VALUES as string[]).includes(raw) ? (raw as OccupantFilter) : "all";

export interface RolesFilterState {
  search: string;
  sort: RolesSort;
  occupant: OccupantFilter;
}
