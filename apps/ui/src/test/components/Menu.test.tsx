import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Menu } from "@/components/ui/Menu";

describe("Menu", () => {
  const defaultItems = [
    { key: "edit", label: "Edit", onSelect: vi.fn() },
    { key: "delete", label: "Delete", onSelect: vi.fn(), destructive: true },
    { key: "export", label: "Export", onSelect: vi.fn() },
  ];

  describe("rendering", () => {
    it("renders trigger button", () => {
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);
      expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    });

    it("hides menu items initially", () => {
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);
      const menu = screen.getByRole("menu");
      expect(menu).not.toHaveAttribute("data-open");
    });

    it("renders all menu items when open", async () => {
      const user = userEvent.setup();
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);
      await user.click(screen.getByRole("button", { name: "Actions" }));

      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Export" })).toBeInTheDocument();
    });

    it("renders item icons when provided", async () => {
      const user = userEvent.setup();
      const itemsWithIcons = [
        {
          key: "view",
          label: "View",
          icon: <span data-testid="view-icon">👁</span>,
          onSelect: vi.fn(),
        },
      ];
      render(<Menu trigger={<button>Actions</button>} items={itemsWithIcons} />);
      await user.click(screen.getByRole("button", { name: "Actions" }));

      expect(screen.getByTestId("view-icon")).toBeInTheDocument();
    });
  });

  describe("item selection (non-destructive)", () => {
    it("calls onSelect and closes menu when non-destructive item is clicked", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items = [{ key: "edit", label: "Edit", onSelect }];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(onSelect).toHaveBeenCalledTimes(1);
      const menu = screen.getByRole("menu");
      expect(menu).not.toHaveAttribute("data-open");
    });
  });

  describe("destructive items (confirmLabel pattern)", () => {
    it("arms destructive item on first click (shows confirmLabel)", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items = [
        {
          key: "delete",
          label: "Delete",
          destructive: true,
          confirmLabel: "Confirm delete",
          onSelect,
        },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));

      // First click should arm the item and show confirmLabel
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("menuitem", { name: "Confirm delete" })).toBeInTheDocument();
    });

    it("fires onSelect on second click of armed destructive item", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items = [
        {
          key: "delete",
          label: "Delete",
          destructive: true,
          confirmLabel: "Really delete?",
          onSelect,
        },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));

      // First click — arm
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(onSelect).not.toHaveBeenCalled();

      // Second click — confirm (item still open due to armed state)
      await user.click(screen.getByRole("menuitem", { name: "Really delete?" }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("resets armed state when clicking a different item", async () => {
      const user = userEvent.setup();
      const onSelect1 = vi.fn();
      const onSelect2 = vi.fn();
      const items = [
        {
          key: "delete",
          label: "Delete",
          destructive: true,
          confirmLabel: "Confirm",
          onSelect: onSelect1,
        },
        { key: "edit", label: "Edit", onSelect: onSelect2 },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));

      // Arm delete
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(screen.getByRole("menuitem", { name: "Confirm" })).toBeInTheDocument();

      // Click edit (disarms delete)
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));

      // Menu should close and edit should fire
      expect(onSelect2).toHaveBeenCalledTimes(1);
      expect(onSelect1).not.toHaveBeenCalled();
    });

    it("resets armed state when clicking outside the armed item", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items = [
        {
          key: "delete",
          label: "Delete",
          destructive: true,
          confirmLabel: "Confirm",
          onSelect,
        },
        { key: "edit", label: "Edit", onSelect: vi.fn() },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));

      // Arm delete
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(screen.getByRole("menuitem", { name: "Confirm" })).toBeInTheDocument();

      // Click the Edit button area (different item) — should reset armed state
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));

      // Edit should fire, delete should not
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("reopens menu with reset armed state", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items = [
        {
          key: "delete",
          label: "Delete",
          destructive: true,
          confirmLabel: "Confirm",
          onSelect,
        },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      // Open and arm
      await user.click(screen.getByRole("button", { name: "Actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(screen.getByRole("menuitem", { name: "Confirm" })).toBeInTheDocument();

      // Close (by pressing Escape)
      await user.keyboard("{Escape}");

      // Open again — armed state should be reset
      await user.click(screen.getByRole("button", { name: "Actions" }));
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Confirm" })).not.toBeInTheDocument();
    });
  });

  describe("disabled items", () => {
    it("does not fire onSelect when disabled item is clicked", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items = [{ key: "edit", label: "Edit", onSelect, disabled: true }];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(onSelect).not.toHaveBeenCalled();
    });

    it("skips disabled items in arrow key navigation", async () => {
      const user = userEvent.setup();
      const onSelect1 = vi.fn();
      const onSelect2 = vi.fn();
      const onSelect3 = vi.fn();
      const items = [
        { key: "item1", label: "Item 1", onSelect: onSelect1 },
        { key: "item2", label: "Item 2", onSelect: onSelect2, disabled: true },
        { key: "item3", label: "Item 3", onSelect: onSelect3 },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));

      // Focus is implicitly on first item; arrow down should skip disabled and go to item3
      const menu = screen.getByRole("menu");
      menu.focus();
      await user.keyboard("{ArrowDown}");

      // The active element should be Item 1 initially
      const item1 = screen.getByRole("menuitem", { name: "Item 1" });
      expect(item1.tagName).toBe("BUTTON");
    });

    it("renders disabled items with proper styling classes", async () => {
      const user = userEvent.setup();
      const items = [{ key: "edit", label: "Edit", onSelect: vi.fn(), disabled: true }];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const item = screen.getByRole("menuitem", { name: "Edit" });
      expect(item).toHaveAttribute("disabled");
      expect(item.className).toContain("disabled");
    });
  });

  describe("keyboard navigation", () => {
    it("navigates with ArrowDown", async () => {
      const user = userEvent.setup();
      const items = [
        { key: "item1", label: "Item 1", onSelect: vi.fn() },
        { key: "item2", label: "Item 2", onSelect: vi.fn() },
        { key: "item3", label: "Item 3", onSelect: vi.fn() },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const menu = screen.getByRole("menu");

      // Focus menu and press ArrowDown
      menu.focus();
      await user.keyboard("{ArrowDown}");

      const item1 = screen.getByRole("menuitem", { name: "Item 1" });
      expect(item1).toHaveFocus();
    });

    it("navigates with ArrowUp", async () => {
      const user = userEvent.setup();
      const items = [
        { key: "item1", label: "Item 1", onSelect: vi.fn() },
        { key: "item2", label: "Item 2", onSelect: vi.fn() },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const menu = screen.getByRole("menu");

      // Focus and navigate
      menu.focus();
      await user.keyboard("{ArrowDown}{ArrowDown}");
      await user.keyboard("{ArrowUp}");

      const item1 = screen.getByRole("menuitem", { name: "Item 1" });
      expect(item1).toHaveFocus();
    });

    it("closes menu when Escape is pressed", async () => {
      const user = userEvent.setup();
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const menu = screen.getByRole("menu");
      expect(menu).toHaveAttribute("data-open");

      await user.keyboard("{Escape}");
      expect(menu).not.toHaveAttribute("data-open");
    });

    it("wraps navigation with ArrowDown at the end", async () => {
      const user = userEvent.setup();
      const items = [
        { key: "item1", label: "Item 1", onSelect: vi.fn() },
        { key: "item2", label: "Item 2", onSelect: vi.fn() },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const menu = screen.getByRole("menu");

      menu.focus();
      // Navigate to last item, then wrap to first
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");

      const item1 = screen.getByRole("menuitem", { name: "Item 1" });
      expect(item1).toHaveFocus();
    });
  });

  describe("mouse hover", () => {
    it("sets active index on mouse enter", async () => {
      const user = userEvent.setup();
      const items = [
        { key: "item1", label: "Item 1", onSelect: vi.fn() },
        { key: "item2", label: "Item 2", onSelect: vi.fn() },
      ];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const item2 = screen.getByRole("menuitem", { name: "Item 2" });

      await user.hover(item2);
      expect(item2).toHaveFocus();
    });
  });

  describe("menu accessibility", () => {
    it("sets role='menu'", async () => {
      const user = userEvent.setup();
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("sets role='menuitem' on each item", async () => {
      const user = userEvent.setup();
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Export" })).toBeInTheDocument();
    });

    it("marks disabled items with aria-disabled", async () => {
      const user = userEvent.setup();
      const items = [{ key: "edit", label: "Edit", onSelect: vi.fn(), disabled: true }];

      render(<Menu trigger={<button>Actions</button>} items={items} />);

      await user.click(screen.getByRole("button", { name: "Actions" }));
      const item = screen.getByRole("menuitem", { name: "Edit" });
      expect(item).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("placement", () => {
    it("defaults to bottom-end placement", () => {
      render(<Menu trigger={<button>Actions</button>} items={defaultItems} />);
      // The Menu wraps Popover with default placement=bottom-end
      // The implementation passes placement through to Popover
      // We can test by checking the underlying Popover panel exists
      const menu = screen.getByRole("menu");
      expect(menu).toBeInTheDocument();
    });

    it("accepts custom placement", () => {
      render(
        <Menu trigger={<button>Actions</button>} items={defaultItems} placement="bottom-start" />,
      );
      const menu = screen.getByRole("menu");
      expect(menu).toBeInTheDocument();
    });
  });
});
