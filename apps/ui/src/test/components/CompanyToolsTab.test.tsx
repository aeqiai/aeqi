import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import CompanyToolsTab from "@/components/CompanyToolsTab";
import { ALL_TOOLS } from "@/lib/tools";
import { useDaemonStore } from "@/store/daemon";

describe("CompanyToolsTab", () => {
  beforeEach(() => {
    useDaemonStore.setState({
      entities: [],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          company_id: "root-1",
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

  it("renders Tools as a flattened register below the page header", () => {
    render(<CompanyToolsTab agentId="agent-1" />);

    const header = screen.getByLabelText("Tool controls");
    const main = screen.getByRole("main", { name: "Company tools" });
    const card = screen.getByLabelText("Tool register");
    const heading = within(header).getByRole("heading", { name: "Tools" });
    const root = header.closest(".company-tools-page");

    expect(root).toHaveClass("company-primitive-shell");
    expect(root).not.toHaveClass("company-overview");
    expect(root).not.toHaveClass("company-apps-page");
    expect(header).toHaveClass("company-tools-page-header");
    expect(header).toHaveClass("company-primitive-shell-header");
    expect(header).not.toHaveClass("company-apps-page-header--summary");
    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(main).toHaveClass("company-primitive-shell-surface");
    expect(card).toHaveClass("company-tools-card");
    expect(header.querySelector(".company-tools-header-count")).not.toBeInTheDocument();
    expect(within(header).getByText(`${ALL_TOOLS.length - 1}`)).toHaveClass(
      "company-primitive-page-count",
    );
    expect(screen.getByText("Chief of Staff")).toHaveClass("company-tools-register-title");
    expect(screen.getByRole("searchbox", { name: /search tools/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter: All" })).toBeInTheDocument();
    expect(heading.compareDocumentPosition(main)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("button", { name: /Shell/i })).toHaveClass("is-off");
    const readFileRow = screen.getByRole("button", { name: /Read file/i });
    const readFileState = within(readFileRow).getByText("On");
    expect(readFileState).toHaveClass("agent-settings-tool-state");
  });

  it("keeps a register empty state when the company has no default agent yet", () => {
    useDaemonStore.setState({ agents: [] });

    render(<CompanyToolsTab agentId="" />);

    const header = screen.getByLabelText("Tool controls");
    expect(within(header).getByRole("heading", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByText("No agent assigned")).toHaveClass("company-tools-register-title");
    expect(
      screen.getByText("Tool access is available after this company has an agent."),
    ).toBeInTheDocument();
  });
});
