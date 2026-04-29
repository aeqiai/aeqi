import { apiRequest } from "@/api/client";
import type { ActivityEntry } from "@/lib/types";

export interface ActivityStreamResponse {
  events?: ActivityEntry[];
}

export function listActivityStream(params?: {
  last?: number;
  root?: string;
}): Promise<ActivityStreamResponse> {
  const query = new URLSearchParams();
  if (params?.last) query.set("last", String(params.last));
  if (params?.root) query.set("root", params.root);
  const qs = query.toString();
  return apiRequest<ActivityStreamResponse>(`/activity${qs ? `?${qs}` : ""}`);
}
