import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import TrustToolsTab from "@/components/TrustToolsTab";
import { ALL_TOOLS } from "@/lib/tools";
import { useDaemonStore } from "@/store/daemon";

describe("TrustToolsTab", () => {
  beforeEach(() => {
    useDaemonStore.setState({
      entities: [],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          trust_id: "root-1",
          tool_deny: ["shell"],
          can_ask_director: true,
        },
      ] as never,
      quests: [],
      events: [],
      workerEvents: [],
      initialLoaded: true,
    });
  });

  it("renders Tools as a plain page toolbar identity before the settings list", () => {
    render(<TrustToolsTab agentId="agent-1" />);

    const header = screen.getByLabelText("Tool controls");
    const main = screen.getByRole("main", { name: "Trust tools" });
    const heading = within(header).getByRole("heading", { name: "Tools" });
    const summary = within(header).getByText("Default agent policy for Chief of Staff.");
    const count = within(header).getByText(`${ALL_TOOLS.length - 1}/${ALL_TOOLS.length}`);

    expect(header).toHaveClass("trust-tools-page-header");
    expect(summary.closest(".trust-tools-toolbar")).not.toBeNull();
    expect(count).toHaveClass("trust-tools-toolbar-count");
    expect(screen.getAllByText(`${ALL_TOOLS.length - 1}/${ALL_TOOLS.length}`)).toHaveLength(1);
    expect(heading.compareDocumentPosition(main)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Allow or block what this agent can call.")).toBeInTheDocument();
  });

  it("keeps the toolbar when the trust has no default agent yet", () => {
    useDaemonStore.setState({ agents: [] });

    render(<TrustToolsTab agentId="" />);

    const header = screen.getByLabelText("Tool controls");
    expect(within(header).getByRole("heading", { name: "Tools" })).toBeInTheDocument();
    expect(
      within(header).getByText("Tool access is scoped to the trust's default agent."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tool access is available after this trust has an agent."),
    ).toBeInTheDocument();
  });
});
