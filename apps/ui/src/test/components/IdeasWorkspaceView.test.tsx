import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Idea } from "@/lib/types";
import IdeasWorkspaceView from "@/components/ideas/IdeasWorkspaceView";
import type { FilterState, IdeasFilter } from "@/components/ideas/types";

vi.mock("@/hooks/useNav", () => ({
  useNav: () => ({
    goEntity: vi.fn(),
    companyId: "company-1",
  }),
}));

vi.mock("@/queries/ideas", () => ({
  useAgentIdeas: () => ({ data: [], isLoading: false }),
  useVisibleIdeas: () => ({ data: [], isLoading: false }),
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
          <div className="ideas-canvas-paper">
            <div className="ideas-canvas-content">
              {props.contentHeaderSlot}
              <h2>{props.idea?.name || props.initialName || "Untitled"}</h2>
            </div>
          </div>
        </section>
      );
    }),
  };
});

vi.mock("@/components/ideas/IdeaActivityFeed", () => ({
  default: () => <div>Activity feed</div>,
}));

const rootIdea: Idea = {
  id: "idea-root",
  name: "Eich Holding",
  content: "",
  tags: ["company"],
  scope: "global",
  parent_idea_id: null,
  properties: { aeqi_company_root: true },
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

function renderWorkspace(overrides: Partial<ComponentProps<typeof IdeasWorkspaceView>> = {}) {
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
          {...overrides}
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
    expect(screen.getByRole("button", { name: "Idea" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Idea" })).toBeInTheDocument();
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(details).toBeInTheDocument();
    expect(within(details).getByText("Scope")).toBeInTheDocument();
    expect(within(details).getByText("Type")).toBeInTheDocument();
    expect(within(details).queryByText(/^Activity/)).not.toBeInTheDocument();
    expect(within(details).queryByText("Import")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import/ })).toBeInTheDocument();
    const ideaSection = Array.from(
      details.querySelectorAll<HTMLDetailsElement>("details.role-inspector-group"),
    ).find((section) => section.querySelector("summary")?.textContent?.includes("Idea"));
    expect(ideaSection).toBeTruthy();
    expect(ideaSection).toHaveAttribute("open");
    expect(within(ideaSection!).getByText("Scope").closest("div")).toHaveClass(
      "role-inspector-row--readonly",
    );

    await user.click(ideaSection!.querySelector("summary")!);

    expect(ideaSection).not.toHaveAttribute("open");

    const main = screen.getByRole("main", { name: "Idea" });
    const canvas = screen.getByRole("region", { name: "Mock idea canvas" });
    expect(canvas).toHaveAttribute("data-conversation-activity", "combined");
    const workspace = container.firstElementChild;
    const pageHeader = workspace?.querySelector(".ideas-workspace-head");
    const contentSurface = workspace?.querySelector(".ideas-workspace-layout");
    const contentHeader = workspace?.querySelector(".ideas-workspace-card-head");
    const contentBody = workspace?.querySelector(".ideas-workspace-body");
    expect(pageHeader).toBeTruthy();
    expect(contentSurface).toBeTruthy();
    expect(contentHeader).toBeTruthy();
    expect(contentBody).toBeTruthy();
    expect(contentSurface?.contains(pageHeader ?? null)).toBe(false);
    expect(within(contentHeader as HTMLElement).getByText("Explorer")).toBeInTheDocument();
    expect(within(contentHeader as HTMLElement).getByText("Idea")).toBeInTheDocument();
    expect(within(contentHeader as HTMLElement).getByText("Details")).toBeInTheDocument();
    expect(within(contentHeader as HTMLElement).getByText("Eich Holding")).toBeInTheDocument();
    expect(contentSurface?.contains(contentHeader ?? null)).toBe(true);
    expect(contentSurface?.contains(contentBody ?? null)).toBe(true);
    expect(within(main).queryByText("Details")).not.toBeInTheDocument();
    expect(
      container
        .querySelector(".ideas-canvas-paper")
        ?.contains(container.querySelector(".ideas-workspace-document-head")),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Hide details" }));

    expect(container.firstElementChild).toHaveClass("ideas-workspace--details-collapsed");
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
  });

  it("keeps Explorer as a file tree instead of a metrics surface", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWorkspace({ onSelect });

    const explorer = screen.getByRole("complementary", { name: "Eich Holding idea explorer" });
    expect(within(explorer).getByRole("tree")).toBeInTheDocument();
    const rootRow = within(explorer).getByRole("treeitem", { name: /Eich Holding/i });
    expect(rootRow).toHaveAttribute("aria-expanded", "true");
    expect(rootRow.lastElementChild).toBe(
      within(rootRow).getByRole("button", { name: "Collapse idea" }),
    );
    expect(within(explorer).queryByLabelText("Explorer metrics")).not.toBeInTheDocument();
    expect(within(explorer).queryByText("Depth")).not.toBeInTheDocument();

    await user.click(within(explorer).getByRole("button", { name: "Collapse idea" }));

    expect(within(explorer).queryByText("Operating Notes")).not.toBeInTheDocument();
    expect(within(explorer).getByRole("button", { name: "Expand idea" })).toBeInTheDocument();

    await user.click(within(explorer).getByRole("button", { name: "Expand idea" }));
    await user.click(within(explorer).getByRole("button", { name: "Operating Notes" }));

    expect(onSelect).toHaveBeenCalledWith("idea-child");
  });

  it("opens Track as quest in a modal from the Details pane", async () => {
    const user = userEvent.setup();
    renderWorkspace({ selectedIdea: childIdea });

    await user.click(screen.getByRole("button", { name: "Track as quest" }));

    const dialog = screen.getByRole("dialog", { name: "Track as quest" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Operating Notes")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create quest" })).toBeInTheDocument();
  });
});
