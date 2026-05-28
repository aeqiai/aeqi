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
    vi.spyOn(api, "listHostingDomains").mockResolvedValue({ ok: true, domains: [] });
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

  function renderTab(surface: "integrations" | "mail" | "websites" = "integrations") {
    render(
      <MemoryRouter initialEntries={[`/trust/root-1/${surface}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/trust/:trustAddress/:tab"
              element={<TrustAppsTab trustId="root-1" surface={surface} />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("renders Integrations with status below the page header", async () => {
    renderTab();

    const header = screen.getByLabelText("Integrations controls");
    const heading = within(header).getByRole("heading", { name: "Integrations" });
    const toolbar = header.querySelector(".trust-apps-toolbar");
    const actionSlot = header.querySelector(":scope > div:last-child");

    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(toolbar).toBeNull();
    expect(within(header).getByRole("button", { name: "Gateways" })).toBeInTheDocument();
    expect(actionSlot).not.toBeNull();
    expect(heading.compareDocumentPosition(screen.getByText("Google Workspace"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await waitFor(() => {
      expect(screen.getByText(/workspace apps ·/)).toHaveClass("trust-primitive-context-text");
    });
    expect(screen.getByRole("heading", { name: "Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Docs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sheets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slides" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect Workspace" })).toBeInTheDocument();
    expect(screen.getAllByText("Routes")).toHaveLength(2);
    expect(screen.queryByText("Chats")).not.toBeInTheDocument();
  });

  it("renders Mails and Websites as native trust surfaces", async () => {
    renderTab("mail");
    expect(screen.getByRole("heading", { name: "Mails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Mail" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mailboxes" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("hello@root.aeqi.ai").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("heading", { name: "Access" })).toBeInTheDocument();

    queryClient.clear();
    renderTab("websites");
    expect(screen.getByRole("heading", { name: "Websites" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Website" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Canonical website" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Domains" })).toBeInTheDocument();
  });
});
