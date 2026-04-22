/**
 * identityApi.ts — thin wrappers for identity-wiring API calls.
 *
 * These are additive exports that extend the base `api` object without
 * modifying it (parallel agents own api.ts). The only new capability here
 * is `scope` on idea creation, which `api.storeIdea` does not currently
 * accept in its typed signature.
 */

import { api } from "@/lib/api";
import type { ScopeValue } from "@/lib/types";

/** Create an idea with an explicit scope field. */
export function storeIdentityIdea(data: {
  name: string;
  content: string;
  tags?: string[];
  agent_id?: string;
  scope?: ScopeValue;
}): Promise<{ ok: boolean; id: string }> {
  // Delegate to the generic storeIdea endpoint — the server accepts `scope`
  // even though the client type doesn't declare it. Cast at the boundary.
  return api.storeIdea(data as Parameters<typeof api.storeIdea>[0]);
}
