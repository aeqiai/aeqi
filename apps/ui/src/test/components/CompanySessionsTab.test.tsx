import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanySessionsTab from "@/components/CompanySessionsTab";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn().mockResolvedValue({ ok: true, participants: [] }),
}));

describe("CompanySessionsTab", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [
        {
          id: "session-1",
          agent_id: "agent-1",
          agent_name: "Chief of Staff",
          status: "active",
          created_at: "2026-05-28T10:00:00Z",
          last_active: "2026-05-28T10:10:00Z",
          first_message: "Ok let's get going",
          message_count: 1,
        },
      ],
    } as never);
    vi.spyOn(api, "getUserSessions").mockResolvedValue({
      items: [
        {
          session_id: "session-1",
          agent_id: "agent-1",
          agent_name: "Chief of Staff",
          company_id: "root-1",
          session_name: "Budget approval",
          awaiting_subject: "Approve the launch spend?",
          awaiting_at: "2026-05-28T10:12:00Z",
          last_agent_message: "Should I approve this budget?",
          last_active: "2026-05-28T10:12:00Z",
        },
      ],
    } as never);
    vi.spyOn(api, "getSessionMessages").mockResolvedValue({
      messages: [
        {
          id: 1,
          role: "assistant",
          content: "Ok let's get going",
          created_at: "2026-05-28T10:10:00Z",
        },
      ],
    } as never);
    vi.spyOn(api, "sendSessionMessage").mockResolvedValue({ ok: true } as never);
    vi.spyOn(api, "answerUserSession").mockResolvedValue({ ok: true } as never);
    vi.spyOn(api, "createSession").mockResolvedValue({ ok: true, session_id: "session-2" });

    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "company",
          status: "active",
          created_at: "2026-05-28T00:00:00Z",
          company_address: "root-1",
          agent_id: "agent-1",
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
    useChatStore.setState({ streamingSessions: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  function renderTab(path = "/company/root-1/sessions/session-1") {
    render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/company/:companyAddress/sessions/:itemId?"
              element={<CompanySessionsTab companyId="root-1" itemId="session-1" />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("renders a compact Sessions header with search and New session", async () => {
    renderTab();

    const header = screen.getByLabelText("Session controls");
    const heading = within(header).getByRole("heading", { name: /Sessions/ });
    expect(heading).toBeInTheDocument();
    await waitFor(() => {
      expect(within(heading).getByLabelText("1 shown")).toHaveTextContent("1");
    });
    expect(within(header).queryByText("Company")).not.toBeInTheDocument();
    expect(within(header).queryByText(/All conversations/i)).not.toBeInTheDocument();
    expect(within(header).getByPlaceholderText("Search sessions")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "New session" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("Ok let's get going").length).toBeGreaterThan(0);
    });
  });

  it("keeps the selected session detail above the rail and message canvas", async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getAllByText(/Chief of Staff.*1 messages/).length).toBeGreaterThan(0);
    });

    const detailStrip = document.querySelector(".company-session-detail-strip");
    const shell = document.querySelector(".inbox-shell");
    const detailPane = document.querySelector(".inbox-pane-detail");
    const composerDock = document.querySelector(".company-sessions-composer-dock");

    expect(detailStrip).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(detailPane).toBeTruthy();
    expect(composerDock).toBeTruthy();
    expect(composerDock?.querySelector(".composer-wrap")).toBeTruthy();
    expect(detailStrip?.compareDocumentPosition(shell as Element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(detailPane?.querySelector(".session-detail-header")).toBeNull();
    expect(detailPane?.querySelector(".inbox-composer-wrap")).toBeNull();
  });

  it("sends from the selected company-wide session composer", async () => {
    const user = userEvent.setup();
    renderTab();

    const input = await screen.findByLabelText("Message body");
    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });
    await user.type(input, "continue here");
    const send = screen.getByRole("button", { name: "Send" });
    await waitFor(() => {
      expect(send).not.toBeDisabled();
    });
    await user.click(send);

    await waitFor(() => {
      expect(api.sendSessionMessage).toHaveBeenCalledWith(
        {
          message: "continue here",
          agent_id: "agent-1",
          session_id: "session-1",
        },
        "root-1",
      );
    });
  });

  it("starts a new session from the page header", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "New session" }));
    const dialog = screen.getByRole("dialog", { name: "New session" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Agent")).toHaveValue("agent-1");
    expect(api.createSession).not.toHaveBeenCalled();

    await user.dblClick(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => {
      expect(api.createSession).toHaveBeenCalledWith("agent-1", "root-1");
    });
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });

  it("renders the pinned My sessions view from user-scoped session data", async () => {
    const user = userEvent.setup();
    renderTab("/company/root-1/sessions/session-1?view=mine");

    await waitFor(() => {
      expect(api.getUserSessions).toHaveBeenCalledWith("root-1");
    });

    const header = screen.getByLabelText("Session controls");
    expect(within(header).getByRole("heading", { name: /Sessions/ })).toBeInTheDocument();
    expect(within(header).getByPlaceholderText("Search my sessions")).toBeInTheDocument();
    expect(await screen.findAllByText("Approve the launch spend?")).toHaveLength(2);
    expect(screen.getAllByText(/Chief of Staff.*Awaiting you/).length).toBeGreaterThan(0);

    const input = await screen.findByLabelText("Message body");
    await user.type(input, "approved");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(api.answerUserSession).toHaveBeenCalledWith("session-1", "approved");
    });
    expect(api.sendSessionMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "approved" }),
      "root-1",
    );
  });
});
