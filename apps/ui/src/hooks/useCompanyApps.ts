import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import * as channelsApi from "@/api/channels";
import type { ChannelEntry } from "@/api/channels";
import { useDaemonStore } from "@/store/daemon";
import { channelKeys } from "@/queries/keys";
import { summarizeInstalledApps, summarizeCompanyApps } from "@/lib/companyApps";

const EMPTY_CHANNELS: ChannelEntry[] = [];

export function useCompanyApps(companyId: string) {
  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);

  const entity = useMemo(
    () => entities.find((item) => item.id === companyId) ?? null,
    [entities, companyId],
  );
  const trustAgents = useMemo(() => {
    const rootAgentId = entity?.agent_id ?? "";
    const companyAddress = entity?.company_address ?? "";
    return agents.filter(
      (agent) =>
        agent.id === companyId ||
        agent.id === rootAgentId ||
        agent.company_id === companyId ||
        agent.company_id === companyAddress ||
        (rootAgentId && agent.company_id === rootAgentId),
    );
  }, [agents, entity?.agent_id, entity?.company_address, companyId]);

  const channelQueries = useQueries({
    queries: trustAgents.map((agent) => ({
      queryKey: channelKeys.byAgent(agent.id),
      queryFn: async () => {
        const data = await channelsApi.listAgentChannels(agent.id);
        return data.channels ?? EMPTY_CHANNELS;
      },
      staleTime: 30_000,
    })),
  });

  const channels = useMemo(
    () => channelQueries.flatMap((query) => query.data ?? EMPTY_CHANNELS),
    [channelQueries],
  );
  const summaries = useMemo(
    () => summarizeCompanyApps(trustAgents, channels),
    [channels, trustAgents],
  );
  const installed = useMemo(() => summarizeInstalledApps(summaries), [summaries]);
  const isLoading = channelQueries.some((query) => query.isLoading);

  return {
    channels,
    defaultAgent:
      trustAgents.find((agent) => agent.id === entity?.agent_id) ?? trustAgents[0] ?? null,
    installed,
    isLoading,
    summaries,
    trustAgents,
  };
}
