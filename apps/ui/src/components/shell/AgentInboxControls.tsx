import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import SessionsFilterPopover, {
  type SessionsFilterState,
} from "@/components/sessions/SessionsFilterPopover";
import SessionsSortPopover, { type SessionsSort } from "@/components/sessions/SessionsSortPopover";
import SessionsToolbar from "@/components/sessions/SessionsToolbar";

const DEFAULT_FILTER: SessionsFilterState = { status: "all" };

interface AgentInboxControlsValue {
  query: string;
  setQuery: (query: string) => void;
  sort: SessionsSort;
  setSort: (sort: SessionsSort) => void;
  filter: SessionsFilterState;
  patchFilter: (patch: Partial<SessionsFilterState>) => void;
}

const AgentInboxControlsContext = createContext<AgentInboxControlsValue | null>(null);

export function AgentInboxControlsProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SessionsSort>("recent");
  const [filter, setFilter] = useState<SessionsFilterState>(DEFAULT_FILTER);

  const patchFilter = useCallback((patch: Partial<SessionsFilterState>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      sort,
      setSort,
      filter,
      patchFilter,
    }),
    [query, sort, filter, patchFilter],
  );

  return (
    <AgentInboxControlsContext.Provider value={value}>
      {children}
    </AgentInboxControlsContext.Provider>
  );
}

export function useAgentInboxControls() {
  const controls = useContext(AgentInboxControlsContext);
  if (!controls) {
    throw new Error("useAgentInboxControls must be used inside AgentInboxControlsProvider");
  }
  return controls;
}

export function AgentInboxToolbar() {
  const { query, setQuery, sort, setSort, filter, patchFilter } = useAgentInboxControls();

  return (
    <SessionsToolbar
      query={query}
      onQuery={setQuery}
      searchPlaceholder="Search sessions"
      sort={<SessionsSortPopover sort={sort} onChange={setSort} />}
      filter={<SessionsFilterPopover filter={filter} onChange={patchFilter} />}
    />
  );
}
