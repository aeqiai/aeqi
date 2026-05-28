import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as channelsApi from "@/api/channels";
import { integrationsApi } from "@/api/integrations";
import TrustAppsTab from "@/components/TrustAppsTab";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

describe("TrustAppsTab", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(channelsApi, "listAgentChannels").mockResolvedValue({
      ok: true,
      channels: [
        {
          id: "channel-1",
          agent_id: "agent-1",
          kind: "whatsapp",
          label: "WhatsApp",
          enabled: true,
          allowed_chats: ["chat-1"],
        },
      ],
    } as never);
    vi.spyOn(integrationsApi, "getTrustGoogleStatus").mockResolvedValue({
      ok: true,
      connected: true,
    } as never);
    vi.spyOn(api, "getTrustEmailMessages").mockResolvedValue({ ok: true, messages: [] } as never);
    vi.spyOn(api, "getTrustWebsiteAnalytics").mockResolvedValue({
      ok: true,
      status: "ready",
      tracking_status: "installed",
      stats: { last_24h: { pageviews: 0 } },
    } as never);
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-23T00:00:00Z",
          trust_address: "root-1",
          agent_id: "agent-1",
          public: true,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          trust_id: "root-1",
        },
      ] as never,
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

  function renderTab() {
    render(
      <MemoryRouter initialEntries={["/trust/root-1/apps"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/trust/:trustAddress/apps" element={<TrustAppsTab trustId="root-1" />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("renders Apps as a plain identity inside the page toolbar", async () => {
    renderTab();

    const header = screen.getByLabelText("App controls");
    const heading = within(header).getByRole("heading", { name: "Apps" });
    const toolbar = header.querySelector(".trust-apps-toolbar");
    const actionSlot = header.querySelector(":scope > div:last-child");

    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(toolbar).not.toBeNull();
    expect(within(header).getByRole("button", { name: "Channels" })).toBeInTheDocument();
    expect(actionSlot).not.toBeNull();
    expect(heading.compareDocumentPosition(screen.getByText("Launch apps"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await waitFor(() => {
      expect(screen.getByText(/connected ·/)).toHaveClass("trust-apps-toolbar-summary");
    });
  });
});
