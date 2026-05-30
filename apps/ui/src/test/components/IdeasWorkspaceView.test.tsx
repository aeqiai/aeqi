import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Idea } from "@/lib/types";
import IdeasWorkspaceView from "@/components/ideas/IdeasWorkspaceView";
import type { FilterState, IdeasFilter } from "@/components/ideas/types";

vi.mock("@/hooks/useNav", () => ({
  useNav: () => ({
    goEntity: vi.fn(),
    trustId: "trust-1",
  }),
}));

vi.mock("@/queries/ideas", () => ({
  useAgentIdeas: () => ({ data: [], isLoading: false }),
  useAgentIdeasCache: () => ({
    patchIdea: vi.fn(),
    removeIdea: vi.fn(),
    invalidateIdeas: vi.fn(),
  }),
}));

vi.mock("@/components/IdeaCanvas", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: React.forwardRef(function IdeaCanvasMock(
      props: {
        contentHeaderSlot?: React.ReactNode;
        conversationActivity?: string;
        idea?: Idea;
        initialName?: string;
      },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        commit: vi.fn(),
        revert: vi.fn(),
      }));

      return (
        <section
          aria-label="Mock idea canvas"
          data-conversation-activity={props.conversationActivity}
        >
          {props.contentHeaderSlot}
          <h2>{props.idea?.name || props.initialName || "Untitled"}</h2>
        </section>
      );
    }),
  };
});

const rootIdea: Idea = {
  id: "idea-root",
  name: "Eich Holding",
  content: "",
  tags: ["trust"],
  scope: "global",
  parent_idea_id: null,
  properties: { aeqi_trust_root: true },
};

const childIdea: Idea = {
  id: "idea-child",
  name: "Operating Notes",
  content: "Daily operating context",
  tags: ["ops"],
  scope: "global",
  parent_idea_id: "idea-root",
  properties: {},
};

const filter: FilterState = {
  scope: "all",
  search: "",
  tags: [],
  sort: "tag",
  needsReview: false,
};

const scopeCounts: Record<IdeasFilter, number> = {
  all: 2,
  self: 0,
  siblings: 0,
  children: 0,
  branch: 0,
  global: 2,
  inherited: 0,
};

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IdeasWorkspaceView
          agentId="agent-1"
          ideas={[rootIdea, childIdea]}
          filtered={[rootIdea, childIdea]}
          rootIdea={rootIdea}
          selectedIdea={rootIdea}
          composing={false}
          presetName=""
          composeParentId={null}
          trustName="Eich Holding"
          filter={filter}
          scopeCounts={scopeCounts}
          needsReviewCount={0}
          view="list"
          onViewChange={vi.fn()}
          onFilter={vi.fn()}
          onNew={vi.fn()}
          onSelect={vi.fn()}
          preparingRoot={false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("IdeasWorkspaceView", () => {
  it("renders the Ideas workspace as Explorer, Idea, and Details panes", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    expect(
      screen.getByRole("complementary", { name: "Eich Holding idea explorer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Idea" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Details" })).toBeInTheDocument();

    const canvas = screen.getByRole("region", { name: "Mock idea canvas" });
    expect(canvas).toHaveAttribute("data-conversation-activity", "combined");
    expect(within(canvas).getByText("Idea")).toHaveClass("ideas-workspace-document-title");

    await user.click(screen.getByRole("button", { name: "Hide details" }));

    expect(container.firstElementChild).toHaveClass("ideas-workspace--details-collapsed");
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
  });
});
