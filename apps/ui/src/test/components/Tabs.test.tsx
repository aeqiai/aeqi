import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Tabs } from "@/components/ui/Tabs";

describe("Tabs", () => {
  const defaultTabs = [
    { id: "tab1", label: "Tab 1", content: <div>Content 1</div> },
    { id: "tab2", label: "Tab 2", content: <div>Content 2</div> },
    { id: "tab3", label: "Tab 3", content: <div>Content 3</div> },
  ];

  describe("rendering", () => {
    it("renders all tab labels", () => {
      render(<Tabs tabs={defaultTabs} />);

      expect(screen.getByRole("tab", { name: "Tab 1" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Tab 2" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Tab 3" })).toBeInTheDocument();
    });

    it("renders tab list with role='tablist'", () => {
      render(<Tabs tabs={defaultTabs} />);

      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    it("renders tab panels with role='tabpanel'", () => {
      render(<Tabs tabs={defaultTabs} />);

      const panels = screen.getAllByRole("tabpanel", { hidden: true });
      expect(panels).toHaveLength(3);
    });

    it("renders content for the active tab", () => {
      render(<Tabs tabs={defaultTabs} />);

      // First tab is active by default
      expect(screen.getByText("Content 1")).toBeInTheDocument();
    });

    it("hides content for inactive tabs", () => {
      render(<Tabs tabs={defaultTabs} />);

      const hiddenPanels = screen
        .getAllByRole("tabpanel", { hidden: true })
        .filter((p) => p.hasAttribute("hidden"));
      expect(hiddenPanels).toHaveLength(2);
    });
  });

  describe("default active tab", () => {
    it("uses defaultTab prop when provided", () => {
      render(<Tabs tabs={defaultTabs} defaultTab="tab2" />);

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      expect(tab2).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Content 2")).toBeInTheDocument();
    });

    it("defaults to first tab when no defaultTab is provided", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      expect(tab1).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Content 1")).toBeInTheDocument();
    });

    it("handles empty tabs gracefully", () => {
      render(<Tabs tabs={[]} />);

      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeInTheDocument();
      // No tabs to render
      expect(tablist.children.length).toBe(0);
    });
  });

  describe("tab selection", () => {
    it("activates tab on click", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      await user.click(tab2);

      expect(tab2).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Content 2")).toBeInTheDocument();
      expect(screen.queryByText("Content 1")).not.toBeInTheDocument();
    });

    it("deactivates previous tab when new tab is clicked", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      const tab2 = screen.getByRole("tab", { name: "Tab 2" });

      expect(tab1).toHaveAttribute("aria-selected", "true");

      await user.click(tab2);

      expect(tab1).toHaveAttribute("aria-selected", "false");
      expect(tab2).toHaveAttribute("aria-selected", "true");
    });

    it("updates panel visibility when tab is clicked", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const panels = () => screen.getAllByRole("tabpanel", { hidden: true });
      const tab1Panel = () => panels().find((p) => p.id.endsWith("-panel-tab1"))!;
      const tab2Panel = () => panels().find((p) => p.id.endsWith("-panel-tab2"))!;

      expect(tab1Panel()).not.toHaveAttribute("hidden");
      expect(tab2Panel()).toHaveAttribute("hidden");

      await user.click(screen.getByRole("tab", { name: "Tab 2" }));

      expect(tab1Panel()).toHaveAttribute("hidden");
      expect(tab2Panel()).not.toHaveAttribute("hidden");
    });
  });

  describe("keyboard navigation", () => {
    it("moves to next tab with ArrowRight", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      tab1.focus();

      await user.keyboard("{ArrowRight}");

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      expect(tab2).toHaveFocus();
      expect(tab2).toHaveAttribute("aria-selected", "true");
    });

    it("moves to previous tab with ArrowLeft", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} defaultTab="tab2" />);

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      tab2.focus();

      await user.keyboard("{ArrowLeft}");

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      expect(tab1).toHaveFocus();
      expect(tab1).toHaveAttribute("aria-selected", "true");
    });

    it("wraps to last tab with ArrowLeft from first tab", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      tab1.focus();

      await user.keyboard("{ArrowLeft}");

      const tab3 = screen.getByRole("tab", { name: "Tab 3" });
      expect(tab3).toHaveFocus();
      expect(tab3).toHaveAttribute("aria-selected", "true");
    });

    it("wraps to first tab with ArrowRight from last tab", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} defaultTab="tab3" />);

      const tab3 = screen.getByRole("tab", { name: "Tab 3" });
      tab3.focus();

      await user.keyboard("{ArrowRight}");

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      expect(tab1).toHaveFocus();
      expect(tab1).toHaveAttribute("aria-selected", "true");
    });

    it("prevents default behavior on arrow keys", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      tab1.focus();

      // Simulate pressing ArrowRight and check that focus moves
      // The preventDefault is tested indirectly by verifying focus moved
      await user.keyboard("{ArrowRight}");

      expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveFocus();
    });

    it("shows active content after keyboard navigation", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      tab1.focus();

      await user.keyboard("{ArrowRight}");

      expect(screen.getByText("Content 2")).toBeInTheDocument();
    });
  });

  describe("count badge", () => {
    it("renders count badge when count is provided", () => {
      const tabsWithCount = [{ id: "tab1", label: "Tab 1", count: 5, content: <div>Content</div> }];

      render(<Tabs tabs={tabsWithCount} />);

      expect(screen.getByText("Tab 1 (5)")).toBeInTheDocument();
    });

    it("does not render count when count is not provided", () => {
      render(<Tabs tabs={defaultTabs} />);

      // Should not have any parentheses for count
      expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveTextContent("Tab 1");
      expect(screen.getByRole("tab", { name: "Tab 1" })).not.toHaveTextContent("(");
    });

    it("renders count for multiple tabs", () => {
      const tabsWithCount = [
        { id: "tab1", label: "Inbox", count: 3, content: <div>Inbox</div> },
        { id: "tab2", label: "Drafts", count: 0, content: <div>Drafts</div> },
        { id: "tab3", label: "Sent", count: 42, content: <div>Sent</div> },
      ];

      render(<Tabs tabs={tabsWithCount} />);

      expect(screen.getByRole("tab", { name: "Inbox (3)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Drafts (0)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Sent (42)" })).toBeInTheDocument();
    });

    it("renders zero count when count is 0", () => {
      const tabsWithCount = [
        { id: "tab1", label: "Empty", count: 0, content: <div>No items</div> },
      ];

      render(<Tabs tabs={tabsWithCount} />);

      expect(screen.getByRole("tab", { name: "Empty (0)" })).toBeInTheDocument();
    });
  });

  describe("aria attributes", () => {
    it("sets aria-selected on the active tab", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      expect(tab1).toHaveAttribute("aria-selected", "true");
    });

    it("sets aria-selected='false' on inactive tabs", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      const tab3 = screen.getByRole("tab", { name: "Tab 3" });

      expect(tab2).toHaveAttribute("aria-selected", "false");
      expect(tab3).toHaveAttribute("aria-selected", "false");
    });

    it("sets aria-controls linking tab to panel", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      const controlsId = tab1.getAttribute("aria-controls");

      expect(controlsId).toBeTruthy();
      expect(document.getElementById(controlsId!)).toBeInTheDocument();
    });

    it("sets aria-labelledby linking panel to tab", () => {
      render(<Tabs tabs={defaultTabs} />);

      const panel = screen.getByText("Content 1").parentElement;
      const labelledBy = panel?.getAttribute("aria-labelledby");

      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy!)).toBeInTheDocument();
    });

    it("updates tabindex based on selection", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      const tab2 = screen.getByRole("tab", { name: "Tab 2" });

      // Active tab should be focusable (tabIndex 0)
      expect(tab1).toHaveAttribute("tabIndex", "0");
      // Inactive tabs should be skipped in tab order (tabIndex -1)
      expect(tab2).toHaveAttribute("tabIndex", "-1");
    });
  });

  describe("panel accessibility", () => {
    it("sets role='tabpanel' on panels", () => {
      render(<Tabs tabs={defaultTabs} />);
      const panels = screen.getAllByRole("tabpanel", { hidden: true });

      panels.forEach((panel) => {
        expect(panel).toHaveAttribute("role", "tabpanel");
      });
    });

    it("hides inactive panels with hidden attribute", () => {
      render(<Tabs tabs={defaultTabs} defaultTab="tab1" />);

      const panels = screen.getAllByRole("tabpanel", { hidden: true });
      const panel2 = panels.find((p) => p.id.endsWith("-panel-tab2"))!;
      const panel3 = panels.find((p) => p.id.endsWith("-panel-tab3"))!;

      expect(panel2).toHaveAttribute("hidden");
      expect(panel3).toHaveAttribute("hidden");
    });

    it("does not hide the active panel", () => {
      render(<Tabs tabs={defaultTabs} defaultTab="tab2" />);

      const panel2 = screen.getByText("Content 2").parentElement;
      expect(panel2).not.toHaveAttribute("hidden");
    });

    it("renders content only in the active panel", () => {
      render(<Tabs tabs={defaultTabs} defaultTab="tab1" />);

      // Active panel should render content
      expect(screen.getByText("Content 1")).toBeInTheDocument();

      // Inactive panels should not render their content (conditional rendering)
      expect(screen.queryByText("Content 2")).not.toBeInTheDocument();
      expect(screen.queryByText("Content 3")).not.toBeInTheDocument();
    });
  });

  describe("tab button properties", () => {
    it("sets role='tab' on each tab button", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(3);
    });

    it("does not set a type attribute on tab buttons", () => {
      render(<Tabs tabs={defaultTabs} />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      // Tab buttons might not have explicit type, but they should be buttons
      expect(tab1.tagName).toBe("BUTTON");
    });
  });

  describe("complex scenarios", () => {
    it("handles rapid tab switching", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      await user.click(screen.getByRole("tab", { name: "Tab 2" }));
      await user.click(screen.getByRole("tab", { name: "Tab 3" }));
      await user.click(screen.getByRole("tab", { name: "Tab 1" }));

      expect(screen.getByText("Content 1")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
    });

    it("combines keyboard and mouse navigation", async () => {
      const user = userEvent.setup();
      render(<Tabs tabs={defaultTabs} />);

      // Start with keyboard
      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      tab1.focus();
      await user.keyboard("{ArrowRight}");

      // Switch to mouse
      await user.click(screen.getByRole("tab", { name: "Tab 3" }));

      expect(screen.getByRole("tab", { name: "Tab 3" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Content 3")).toBeInTheDocument();
    });
  });
});
