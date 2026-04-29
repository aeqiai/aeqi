import { apiRequest } from "@/api/client";

export type RuntimePayload = Record<string, unknown>;

export function getDashboard(): Promise<RuntimePayload> {
  return apiRequest<RuntimePayload>("/dashboard");
}

export function getStatus(): Promise<RuntimePayload> {
  return apiRequest<RuntimePayload>("/status");
}

export function getCost(): Promise<RuntimePayload> {
  return apiRequest<RuntimePayload>("/cost");
}
