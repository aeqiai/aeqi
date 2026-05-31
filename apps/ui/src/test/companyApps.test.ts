import { describe, expect, it } from "vitest";

import type { ChannelEntry } from "@/api/channels";
import type { Agent } from "@/lib/types";
import { summarizeInstalledApps, summarizeCompanyApps } from "@/lib/companyApps";

const agents: Agent[] = [
  { id: "agent-1", name: "Operator", status: "active", company_id: "company-1" },
  { id: "agent-2", name: "Support", status: "active", company_id: "company-1" },
];

function channel(
  partial: Partial<ChannelEntry> & Pick<ChannelEntry, "id" | "agent_id" | "kind">,
): ChannelEntry {
  return {
    config: {},
    enabled: true,
    allowed_chats: [],
    ...partial,
  };
}

describe("company app summaries", () => {
  it("marks catalog apps as available when no matching channels exist", () => {
    const summaries = summarizeCompanyApps(agents, []);

    expect(summaries.map((summary) => [summary.entry.kind, summary.status])).toEqual([
      ["telegram", "available"],
      ["whatsapp", "available"],
      ["stripe", "available"],
    ]);
  });

  it("summarizes channel-backed app connections across company agents", () => {
    const summaries = summarizeCompanyApps(agents, [
      channel({
        id: "telegram-1",
        agent_id: "agent-1",
        kind: "telegram",
        allowed_chats: [{ chat_id: "123", reply_allowed: true }],
      }),
      channel({
        id: "whatsapp-1",
        agent_id: "agent-1",
        kind: "whatsapp-baileys",
        enabled: false,
      }),
      channel({
        id: "whatsapp-2",
        agent_id: "agent-2",
        kind: "whatsapp",
        allowed_chats: [{ chat_id: "abc@s.whatsapp.net", reply_allowed: false }],
      }),
      channel({ id: "ignored", agent_id: "outside", kind: "telegram" }),
    ]);

    const telegram = summaries.find((summary) => summary.entry.kind === "telegram");
    const whatsapp = summaries.find((summary) => summary.entry.kind === "whatsapp");
    const stripe = summaries.find((summary) => summary.entry.kind === "stripe");

    expect(telegram).toMatchObject({
      status: "connected",
      connectedChannels: 1,
      enabledChannels: 1,
      allowedChats: 1,
      agentCount: 1,
    });
    expect(whatsapp).toMatchObject({
      status: "connected",
      connectedChannels: 2,
      enabledChannels: 1,
      allowedChats: 1,
      agentCount: 2,
    });
    expect(stripe).toMatchObject({
      status: "available",
      connectedChannels: 0,
      enabledChannels: 0,
      allowedChats: 0,
      agentCount: 0,
    });
    expect(summarizeInstalledApps(summaries)).toMatchObject({
      connectedApps: 2,
      connectedChannels: 3,
      enabledChannels: 2,
      allowedChats: 2,
    });
  });
});
