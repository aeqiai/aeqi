import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TrustViewsWorkbench from "@/components/TrustViewsWorkbench";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import type { Quest } from "@/lib/types";

const TRUST_ID = "root-views";

vi.mock("@/lib/api", () => ({
  api: {
    getTrustViews: vi.fn(),
    upsertTrustViews: vi.fn(),
  },
}));

const QUEST: Quest = {
  id: "quest-1",
  idea_id: "idea-1",
  idea: {
    id: "idea-1",
    name: "Launch canonical trust surface",
    content: "Polish the overview.",
  },
  status: "in_progress",
  priority: "normal",
  scope: "global",
  agent_id: "agent-1",
  cost_usd: 0,
  created_at: "2026-05-30T10:00:00Z",
};

describe("TrustViewsWorkbench", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getTrustViews).mockResolvedValue({
      ok: true,
      trust_id: TRUST_ID,
      views: [],
    });
    vi.mocked(api.upsertTrustViews).mockResolvedValue({
      ok: true,
      trust_id: TRUST_ID,
      views: [],
    });
    useDaemonStore.setState({
      entities: [
        {
          id: TRUST_ID,
          name: "Root Views",
          type: "trust",
          status: "active",
          created_at: "2026-05-30T10:00:00Z",
          slug: "root",
          public: true,
          trust_address: "0xroot",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          trust_id: TRUST_ID,
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
            content: "Should not render on this TRUST overview.",
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

  it("renders the canonical read-only overview scoped to this TRUST", () => {
    render(<TrustViewsWorkbench trustId={TRUST_ID} />);

    expect(screen.getByRole("heading", { name: "TRUST overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Launch canonical trust surface")).toBeInTheDocument();
    expect(screen.getByText("Reviewed launch surface")).toBeInTheDocument();
    expect(screen.queryByText("Global unrelated quest")).not.toBeInTheDocument();
    expect(screen.queryByText("Global unrelated event")).not.toBeInTheDocument();
    expect(screen.queryByText("Widget library")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New view" })).not.toBeInTheDocument();
    expect(api.getTrustViews).toHaveBeenCalledWith(TRUST_ID);
    expect(api.upsertTrustViews).not.toHaveBeenCalled();
  });

  it("hydrates read-only dashboard views from the API", async () => {
    vi.mocked(api.getTrustViews).mockResolvedValue({
      ok: true,
      trust_id: TRUST_ID,
      views: [
        {
          id: "backend-view-1",
          trust_id: TRUST_ID,
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

    render(<TrustViewsWorkbench trustId={TRUST_ID} />);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Operators" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByText("Chief of Staff - active")).toBeInTheDocument();
    expect(api.upsertTrustViews).not.toHaveBeenCalled();
  });

  it("creates a private view and toggles widgets", async () => {
    render(<TrustViewsWorkbench trustId={TRUST_ID} editable />);

    fireEvent.click(screen.getByRole("button", { name: "New view" }));

    expect(screen.getByRole("tab", { name: /View 4 private/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("Chief of Staff - active")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Agents agents/i }));

    expect(screen.getByText("Chief of Staff - active")).toBeInTheDocument();
    await waitFor(() => expect(api.upsertTrustViews).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.upsertTrustViews).mock.calls.at(-1)?.[0]).toBe(TRUST_ID);
    expect(vi.mocked(api.upsertTrustViews).mock.calls.at(-1)?.[1]).toEqual(
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

  it("persists the selected view per trust", () => {
    const { unmount } = render(<TrustViewsWorkbench trustId={TRUST_ID} editable />);

    fireEvent.click(screen.getByRole("tab", { name: /Data room public/i }));
    unmount();
    render(<TrustViewsWorkbench trustId={TRUST_ID} editable />);

    expect(screen.getByRole("tab", { name: /Data room public/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
