import { useRef, useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";

export type PrimitiveKind = "agent" | "event" | "idea" | "quest";

export interface ResolvedAgent {
  kind: "agent";
  id: string;
  name: string;
  display_name?: string;
  parent_id?: string | null;
}

export interface ResolvedEvent {
  kind: "event";
  id: string;
  name: string;
  pattern: string;
  agent_id?: string | null;
}

export interface ResolvedIdea {
  kind: "idea";
  id: string;
  name: string;
  tags: string[];
  agent_id?: string | null;
}

export interface ResolvedQuest {
  kind: "quest";
  id: string;
  name: string;
  status: string;
  agent_id?: string | null;
}

export type ResolvedPrimitive = ResolvedAgent | ResolvedEvent | ResolvedIdea | ResolvedQuest;

export interface PrimitiveResult {
  data: ResolvedPrimitive | null;
  loading: boolean;
  error: boolean;
}

// Module-level cache shared across all hook instances — avoids redundant fetches
// for the same primitive ID across multiple cards in the same render tree.
const cache = new Map<string, ResolvedPrimitive | null>();
// Track in-flight requests so parallel mounts don't double-fetch.
const inflight = new Map<string, Promise<ResolvedPrimitive | null>>();

async function fetchAgent(id: string): Promise<ResolvedPrimitive | null> {
  try {
    // No single-agent GET endpoint — resolve from the list.
    const res = await api.getAgents();
    const list = (res as { agents?: Agent[] }).agents ?? [];
    const found = list.find((a) => a.id === id);
    if (!found) return null;
    return {
      kind: "agent",
      id: found.id,
      name: found.display_name ?? found.name,
      display_name: found.display_name,
      parent_id: found.parent_id,
    };
  } catch {
    return null;
  }
}

async function fetchIdea(id: string): Promise<ResolvedPrimitive | null> {
  try {
    // /ideas/by-ids is the most direct path.
    const res = await api.getIdeasByIds([id]);
    const idea = res.ideas[0];
    if (!idea) return null;
    return {
      kind: "idea",
      id: idea.id,
      name: idea.name,
      tags: idea.tags ?? [],
      agent_id: idea.agent_id,
    };
  } catch {
    return null;
  }
}

async function fetchEvent(id: string): Promise<ResolvedPrimitive | null> {
  try {
    const res = await api.getEvent(id);
    const event = res.event;
    if (!event?.id) return null;
    return {
      kind: "event",
      id: event.id,
      name: event.name,
      pattern: event.pattern,
      agent_id: event.agent_id,
    };
  } catch {
    return null;
  }
}

async function fetchQuest(id: string): Promise<ResolvedPrimitive | null> {
  try {
    const res = await api.getQuest(id);
    const q = res.quest;
    if (!q?.id) return null;
    return {
      kind: "quest",
      id: q.id,
      name: q.subject,
      status: q.status,
      agent_id: q.agent_id,
    };
  } catch {
    return null;
  }
}

async function resolve(kind: PrimitiveKind | null, id: string): Promise<ResolvedPrimitive | null> {
  if (kind === "agent") return fetchAgent(id);
  if (kind === "idea") return fetchIdea(id);
  if (kind === "event") return fetchEvent(id);
  if (kind === "quest") return fetchQuest(id);

  // Untyped — try each in order. First non-null wins.
  for (const fn of [fetchIdea, fetchQuest, fetchAgent, fetchEvent]) {
    const result = await fn(id);
    if (result) return result;
  }
  return null;
}

function cacheKey(kind: PrimitiveKind | null, id: string): string {
  return kind ? `${kind}:${id}` : `auto:${id}`;
}

export function usePrimitiveResolver(kind: PrimitiveKind | null, id: string): PrimitiveResult {
  const key = cacheKey(kind, id);
  const [state, setState] = useState<PrimitiveResult>(() => {
    if (cache.has(key)) {
      const hit = cache.get(key)!;
      return { data: hit, loading: false, error: hit === null };
    }
    return { data: null, loading: true, error: false };
  });
  const mountedRef = useRef(true);

  const run = useCallback(async () => {
    if (cache.has(key)) {
      const hit = cache.get(key)!;
      setState({ data: hit, loading: false, error: hit === null });
      return;
    }

    if (!inflight.has(key)) {
      inflight.set(
        key,
        resolve(kind, id).then((result) => {
          cache.set(key, result);
          inflight.delete(key);
          return result;
        }),
      );
    }

    const result = await inflight.get(key)!;
    if (mountedRef.current) {
      setState({ data: result, loading: false, error: result === null });
    }
  }, [key, kind, id]);

  useEffect(() => {
    mountedRef.current = true;
    if (!cache.has(key)) {
      run();
    } else {
      const hit = cache.get(key)!;
      setState({ data: hit, loading: false, error: hit === null });
    }
    return () => {
      mountedRef.current = false;
    };
  }, [key, run]);

  return state;
}
