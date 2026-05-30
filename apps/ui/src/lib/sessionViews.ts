export const SESSIONS_VIEW_PARAM = "view";
export const USER_SESSIONS_VIEW_ID = "mine";
export const USER_SESSIONS_VIEW_LABEL = "My sessions";

export type SessionsViewId = "all" | typeof USER_SESSIONS_VIEW_ID;

export function sessionsViewFromSearch(search: string): SessionsViewId {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get(SESSIONS_VIEW_PARAM) === USER_SESSIONS_VIEW_ID ? USER_SESSIONS_VIEW_ID : "all";
}

export function userSessionsPath(base: string): string {
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${cleanBase}/sessions?${SESSIONS_VIEW_PARAM}=${USER_SESSIONS_VIEW_ID}`;
}

export function withUserSessionsView(path: string, search = ""): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(SESSIONS_VIEW_PARAM, USER_SESSIONS_VIEW_ID);
  const next = params.toString();
  return `${path}${next ? `?${next}` : ""}`;
}
