import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as channelsApi from "@/api/channels";
import AgentChannelsTab from "@/components/AgentChannelsTab";
import { useDaemonStore } from "@/store/daemon";

describe("AgentChannelsTab", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(channelsApi, "listAgentChannels").mockResolvedValue({
      channels: [
        {
          id: "channel-1",
          agent_id: "agent-1",
          kind: "whatsapp-baileys",
          config: { kind: "whatsapp-baileys" },
          enabled: true,
          allowed_chats: [{ chat_id: "491234@s.whatsapp.net", reply_allowed: true }],
        },
      ],
    });
    vi.spyOn(channelsApi, "listChannelSessions").mockResolvedValue({
      sessions: [
        {
          channel_key: "whatsapp-baileys:491234@s.whatsapp.net",
          session_id: "session-1",
          chat_id: "491234@s.whatsapp.net",
          transport: "whatsapp-baileys",
          created_at: "2026-05-28T00:00:00Z",
        },
      ],
    });
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-28T00:00:00Z",
          trust_address: "root",
          agent_id: "agent-1",
        },
      ],
      agents: [],
      quests: [],
      events: [],
      workerEvents: [],
      initialLoaded: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  function renderGateways(path = "/trust/root/gateways") {
    render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/trust/:trustAddress/gateways/:itemId?"
              element={<AgentChannelsTab agentId="agent-1" />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("uses native gateway surface chrome and session terminology", async () => {
    renderGateways();

    const header = screen.getByLabelText("Gateway controls");
    expect(within(header).getByRole("heading", { name: "Gateways" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "New Gateway" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("1 gateway · 1 session · 1 allowed route")).toBeInTheDocument();
    });
    expect(screen.getByText("1 session")).toBeInTheDocument();
    expect(screen.queryByText(/1 chat/i)).not.toBeInTheDocument();
  });

  it("labels gateway detail bindings as sessions", async () => {
    renderGateways("/trust/root/gateways/channel-1");

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(
      screen.getByText("WhatsApp (QR pair) · 1 session · 1 allowed route"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/active chats/i)).not.toBeInTheDocument();
  });
});
