import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrustSessionsTab from "@/components/TrustSessionsTab";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn().mockResolvedValue({ ok: true, participants: [] }),
}));

describe("TrustSessionsTab", () => {
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
    vi.spyOn(api, "createSession").mockResolvedValue({ ok: true, session_id: "session-2" });

    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-28T00:00:00Z",
          trust_address: "root-1",
          agent_id: "agent-1",
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
    useChatStore.setState({ streamingSessions: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  function renderTab(path = "/trust/root-1/sessions/session-1") {
    render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/trust/:trustAddress/sessions/:itemId?"
              element={<TrustSessionsTab trustId="root-1" itemId="session-1" />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("renders a compact Sessions header with search and New Session", async () => {
    renderTab();

    const header = screen.getByLabelText("Session controls");
    expect(within(header).getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(within(header).queryByText("Trust")).not.toBeInTheDocument();
    expect(within(header).queryByText(/All conversations/i)).not.toBeInTheDocument();
    expect(within(header).getByPlaceholderText("Search sessions")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "New Session" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("Ok let's get going").length).toBeGreaterThan(0);
    });
  });

  it("keeps the selected session detail above the rail and message canvas", async () => {
    renderTab();

    await waitFor(() => {
      expect(screen.getAllByText(/Chief of Staff.*1 messages/).length).toBeGreaterThan(0);
    });

    const detailStrip = document.querySelector(".trust-session-detail-strip");
    const shell = document.querySelector(".inbox-shell");
    const detailPane = document.querySelector(".inbox-pane-detail");

    expect(detailStrip).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(detailPane).toBeTruthy();
    expect(detailStrip?.compareDocumentPosition(shell as Element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(detailPane?.querySelector(".session-detail-header")).toBeNull();
  });

  it("sends from the selected trust-wide session composer", async () => {
    const user = userEvent.setup();
    renderTab();

    const input = await screen.findByLabelText("Message body");
    await user.type(input, "continue here");
    await user.keyboard("{Enter}");

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

    await user.click(screen.getByRole("button", { name: "New Session" }));

    await waitFor(() => {
      expect(api.createSession).toHaveBeenCalledWith("agent-1", "root-1");
    });
  });
});
