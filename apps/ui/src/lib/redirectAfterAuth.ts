// Sanitized post-auth landing target. Only same-origin internal paths
// pass through; rejects protocol-relative ("//evil.com"), absolute
// ("https://…"), or empty values to block phishing-redirect abuse.
export function getRedirectAfterAuth(params: URLSearchParams, fallback: string = "/"): string {
  const next = params.get("next");
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.includes("://")) return fallback;
  return next;
}

export function buildAuthSwitchHref(baseHref: string, params: URLSearchParams): string {
  if (!baseHref) return "";

  const next = getRedirectAfterAuth(params, "");
  const invite = params.get("invite") ?? params.get("invite_code");
  const invitation = params.get("invitation") ?? params.get("invitation_token");
  const nextParams = new URLSearchParams();

  if (next) nextParams.set("next", next);
  if (baseHref === "/signup" && invite) nextParams.set("invite", invite);
  if (invitation) nextParams.set("invitation", invitation);

  const query = nextParams.toString();
  return query ? `${baseHref}?${query}` : baseHref;
}
