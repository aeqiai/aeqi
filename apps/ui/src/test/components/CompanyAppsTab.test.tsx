import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as channelsApi from "@/api/channels";
import { integrationsApi } from "@/api/integrations";
import CompanyAppsTab from "@/components/CompanyAppsTab";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

describe("CompanyAppsTab", () => {
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
    vi.spyOn(integrationsApi, "getCompanyGoogleStatus").mockResolvedValue({
      ok: true,
      connected: true,
    } as never);
    vi.spyOn(integrationsApi, "getCompanyEtsyStatus").mockResolvedValue({
      ok: true,
      connected: false,
    } as never);
    vi.spyOn(api, "getCompanyEmailMessages").mockResolvedValue({ ok: true, messages: [] } as never);
    vi.spyOn(api, "getCompanyWebsiteAnalytics").mockResolvedValue({
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
          type: "company",
          status: "active",
          created_at: "2026-05-23T00:00:00Z",
          company_address: "root-1",
          agent_id: "agent-1",
          public: true,
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          company_id: "root-1",
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
    const segment = surface === "mail" ? "mails" : surface;
    render(
      <MemoryRouter initialEntries={[`/company/root-1/${segment}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/company/:companyAddress/:tab"
              element={<CompanyAppsTab companyId="root-1" surface={surface} />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("renders Integrations as a provider register with detail", async () => {
    renderTab();

    const header = screen.getByLabelText("Integrations controls");
    const heading = within(header).getByRole("heading", { name: "Integrations" });
    const toolbar = header.querySelector(".company-apps-toolbar");
    const actionSlot = header.querySelector(":scope > div:last-child");

    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(toolbar).toBeNull();
    expect(within(header).getByRole("button", { name: "New Integration" })).toBeInTheDocument();
    expect(actionSlot).not.toBeNull();
    expect(heading.compareDocumentPosition(screen.getByText("Providers"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await waitFor(() => {
      expect(screen.getByText(/workspace apps ·/)).toHaveClass("company-primitive-context-text");
    });
    expect(screen.getByRole("heading", { name: "Google Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("WeCom")).toBeInTheDocument();
    expect(
      screen.getByText("Enterprise WeChat messaging for company-owned company channels."),
    ).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getAllByText("Gateway").length).toBeGreaterThan(0);
    expect(screen.queryByText("Chats")).not.toBeInTheDocument();
  });

  it("renders Mails and Websites as simple registers with detail", async () => {
    renderTab("mail");
    expect(screen.getByRole("heading", { name: "Mails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Mail" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mailboxes" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("hello@root.aeqi.ai").length).toBeGreaterThan(0);
    });
    expect(screen.getByLabelText("Mailbox detail")).toBeInTheDocument();

    queryClient.clear();
    renderTab("websites");
    expect(screen.getAllByRole("heading", { name: "Websites" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "New Website" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Website detail")).toBeInTheDocument();
    expect(screen.getAllByText("root.aeqi.ai").length).toBeGreaterThan(0);
  });
});
