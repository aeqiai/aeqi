import type { ChannelEntry } from "@/api/channels";
import type { Agent } from "@/lib/types";

export type CompanyAppKind = "telegram" | "whatsapp" | "stripe";
export type CompanyAppCategory = "channel" | "billing";
export type CompanyAppStatus = "connected" | "available";

export interface CompanyAppCatalogEntry {
  kind: CompanyAppKind;
  name: string;
  category: CompanyAppCategory;
  summary: string;
  channelKinds: readonly string[];
}

export interface CompanyAppSummary {
  entry: CompanyAppCatalogEntry;
  status: CompanyAppStatus;
  connectedChannels: number;
  enabledChannels: number;
  allowedChats: number;
  agentCount: number;
}

export const COMPANY_APP_CATALOG: readonly CompanyAppCatalogEntry[] = [
  {
    kind: "telegram",
    name: "Telegram",
    category: "channel",
    summary: "Bot and group message gateway",
    channelKinds: ["telegram"],
  },
  {
    kind: "whatsapp",
    name: "WhatsApp",
    category: "channel",
    summary: "Cloud API or QR-paired gateway",
    channelKinds: ["whatsapp", "whatsapp-baileys"],
  },
  {
    kind: "stripe",
    name: "Stripe",
    category: "billing",
    summary: "Billing, subscriptions, and checkout events",
    channelKinds: [],
  },
] as const;

export function summarizeCompanyApps(
  agents: Agent[],
  channels: ChannelEntry[],
): CompanyAppSummary[] {
  const agentIds = new Set(agents.map((agent) => agent.id));

  return COMPANY_APP_CATALOG.map((entry) => {
    const appChannels = channels.filter(
      (channel) => agentIds.has(channel.agent_id) && entry.channelKinds.includes(channel.kind),
    );
    const appAgentIds = new Set(appChannels.map((channel) => channel.agent_id));
    const enabledChannels = appChannels.filter((channel) => channel.enabled).length;
    const allowedChats = appChannels.reduce(
      (sum, channel) => sum + channel.allowed_chats.length,
      0,
    );

    return {
      entry,
      status: appChannels.length > 0 ? "connected" : "available",
      connectedChannels: appChannels.length,
      enabledChannels,
      allowedChats,
      agentCount: appAgentIds.size,
    };
  });
}

export function summarizeInstalledApps(summaries: CompanyAppSummary[]) {
  return {
    connectedApps: summaries.filter((summary) => summary.status === "connected").length,
    enabledChannels: summaries.reduce((sum, summary) => sum + summary.enabledChannels, 0),
    connectedChannels: summaries.reduce((sum, summary) => sum + summary.connectedChannels, 0),
    allowedChats: summaries.reduce((sum, summary) => sum + summary.allowedChats, 0),
  };
}
