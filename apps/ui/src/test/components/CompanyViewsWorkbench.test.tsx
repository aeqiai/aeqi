import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CompanyViewsWorkbench from "@/components/CompanyViewsWorkbench";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import type { Quest } from "@/lib/types";

const COMPANY_ID = "root-views";

vi.mock("@/lib/api", () => ({
  api: {
    getCompanyViews: vi.fn(),
    upsertCompanyViews: vi.fn(),
  },
}));

const QUEST: Quest = {
  id: "quest-1",
  idea_id: "idea-1",
  idea: {
    id: "idea-1",
    name: "Launch canonical company surface",
    content: "Polish the overview.",
  },
  status: "in_progress",
  priority: "normal",
  scope: "global",
  agent_id: "agent-1",
  cost_usd: 0,
  created_at: "2026-05-30T10:00:00Z",
};

describe("CompanyViewsWorkbench", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getCompanyViews).mockResolvedValue({
      ok: true,
      company_id: COMPANY_ID,
      views: [],
    });
    vi.mocked(api.upsertCompanyViews).mockResolvedValue({
      ok: true,
      company_id: COMPANY_ID,
      views: [],
    });
    useDaemonStore.setState({
      entities: [
        {
          id: COMPANY_ID,
          name: "Root Views",
          type: "company",
          status: "active",
          created_at: "2026-05-30T10:00:00Z",
          slug: "root",
          public: true,
          company_address: "0xroot",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          company_id: COMPANY_ID,
        },
      ],
      quests: [
        QUEST,
        {
          ...QUEST,
          id: "quest-global",
          idea_id: "idea-global",
          idea: {
            id: "idea-global",
            name: "Global unrelated quest",
            content: "Should not render on this COMPANY overview.",
          },
          agent_id: "other-agent",
        },
      ],
      events: [
        {
          id: 1,
          timestamp: "2026-05-30T10:01:00Z",
          decision_type: "session.step",
          summary: "Reviewed launch surface",
          agent: "agent-1",
        },
        {
          id: 2,
          timestamp: "2026-05-30T10:02:00Z",
          decision_type: "session.step",
          summary: "Global unrelated event",
          agent: "other-agent",
        },
      ],
      initialLoaded: true,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the canonical read-only overview scoped to this COMPANY", () => {
    render(<CompanyViewsWorkbench companyId={COMPANY_ID} />);

    expect(screen.getByRole("heading", { name: "COMPANY overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Launch canonical company surface")).toBeInTheDocument();
    expect(screen.getByText("Reviewed launch surface")).toBeInTheDocument();
    expect(screen.queryByText("Global unrelated quest")).not.toBeInTheDocument();
    expect(screen.queryByText("Global unrelated event")).not.toBeInTheDocument();
    expect(screen.queryByText("Widget library")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New view" })).not.toBeInTheDocument();
    expect(api.getCompanyViews).toHaveBeenCalledWith(COMPANY_ID);
    expect(api.upsertCompanyViews).not.toHaveBeenCalled();
  });

  it("hydrates read-only dashboard views from the API", async () => {
    vi.mocked(api.getCompanyViews).mockResolvedValue({
      ok: true,
      company_id: COMPANY_ID,
      views: [
        {
          id: "backend-view-1",
          company_id: COMPANY_ID,
          owner_user_id: "user-1",
          key: "operators",
          label: "Operators",
          kind: "dashboard",
          scope: "private",
          layout_json: { widgets: ["agents", "quests"] },
          pinned: true,
          sort_order: 0,
          created_at: "2026-05-30T10:00:00Z",
          updated_at: "2026-05-30T10:00:00Z",
        },
      ],
    });

    render(<CompanyViewsWorkbench companyId={COMPANY_ID} />);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Operators" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByText("Chief of Staff - active")).toBeInTheDocument();
    expect(api.upsertCompanyViews).not.toHaveBeenCalled();
  });

  it("creates a private view and toggles widgets", async () => {
    render(<CompanyViewsWorkbench companyId={COMPANY_ID} editable />);

    fireEvent.click(screen.getByRole("button", { name: "New view" }));

    expect(screen.getByRole("tab", { name: /View 4 private/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("Chief of Staff - active")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Agents agents/i }));

    expect(screen.getByText("Chief of Staff - active")).toBeInTheDocument();
    await waitFor(() => expect(api.upsertCompanyViews).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.upsertCompanyViews).mock.calls.at(-1)?.[0]).toBe(COMPANY_ID);
    expect(vi.mocked(api.upsertCompanyViews).mock.calls.at(-1)?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dashboard",
          scope: "private",
          layout_json: expect.objectContaining({
            widgets: expect.arrayContaining(["agents"]),
          }),
        }),
      ]),
    );
  });

  it("persists the selected view per company", () => {
    const { unmount } = render(<CompanyViewsWorkbench companyId={COMPANY_ID} editable />);

    fireEvent.click(screen.getByRole("tab", { name: /Data room public/i }));
    unmount();
    render(<CompanyViewsWorkbench companyId={COMPANY_ID} editable />);

    expect(screen.getByRole("tab", { name: /Data room public/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
