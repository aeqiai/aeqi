import { apiRequest } from "@/api/client";
import type { Quest } from "@/lib/types";

export interface QuestsResponse {
  quests?: Quest[];
}

export function listQuests(params?: { status?: string; root?: string }): Promise<QuestsResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.root) query.set("root", params.root);
  const qs = query.toString();
  return apiRequest<QuestsResponse>(`/quests${qs ? `?${qs}` : ""}`);
}
