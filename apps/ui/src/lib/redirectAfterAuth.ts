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
