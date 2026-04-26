import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Popover } from "@/components/ui/Popover";

// CSS Module classes are hashed at build time, so assert by substring on className.
function isOpen(panel: HTMLElement): boolean {
  return /\bopen\b|_open_/.test(panel.className);
}

describe("Popover", () => {
  describe("uncontrolled mode (no open prop)", () => {
    it("renders trigger", () => {
      render(
        <Popover trigger={<button>Open Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      expect(screen.getByRole("button", { name: "Open Menu" })).toBeInTheDocument();
    });

    it("hides panel initially", () => {
      render(
        <Popover trigger={<button>Open Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByRole("dialog");
      expect(isOpen(panel)).toBe(false);
    });

    it("opens panel when trigger is clicked", async () => {
      const user = userEvent.setup();
      render(
        <Popover trigger={<button>Open Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      await user.click(screen.getByRole("button", { name: "Open Menu" }));
      expect(isOpen(screen.getByRole("dialog"))).toBe(true);
    });

    it("closes panel when trigger is clicked again", async () => {
      const user = userEvent.setup();
      render(
        <Popover trigger={<button>Toggle Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const trigger = screen.getByRole("button", { name: "Toggle Menu" });

      await user.click(trigger);
      expect(isOpen(screen.getByRole("dialog"))).toBe(true);

      await user.click(trigger);
      expect(isOpen(screen.getByRole("dialog"))).toBe(false);
    });

    it("closes panel when Escape is pressed", async () => {
      const user = userEvent.setup();
      render(
        <Popover trigger={<button>Open Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const trigger = screen.getByRole("button", { name: "Open Menu" });

      await user.click(trigger);
      expect(isOpen(screen.getByRole("dialog"))).toBe(true);

      await user.keyboard("{Escape}");
      expect(isOpen(screen.getByRole("dialog"))).toBe(false);
    });

    it("closes panel when clicking outside", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <button>Outside button</button>
          <Popover trigger={<button>Open Menu</button>}>
            <div>Panel content</div>
          </Popover>
        </div>,
      );

      await user.click(screen.getByRole("button", { name: "Open Menu" }));
      expect(isOpen(screen.getByRole("dialog"))).toBe(true);

      await user.click(screen.getByRole("button", { name: "Outside button" }));
      expect(isOpen(screen.getByRole("dialog"))).toBe(false);
    });
  });

  describe("controlled mode (open prop + onOpenChange)", () => {
    it("uses controlled open state", async () => {
      const onOpenChange = vi.fn();

      const { rerender } = render(
        <Popover trigger={<button>Menu</button>} open={false} onOpenChange={onOpenChange}>
          <div>Panel content</div>
        </Popover>,
      );

      expect(isOpen(screen.getByRole("dialog"))).toBe(false);

      rerender(
        <Popover trigger={<button>Menu</button>} open={true} onOpenChange={onOpenChange}>
          <div>Panel content</div>
        </Popover>,
      );

      expect(isOpen(screen.getByRole("dialog"))).toBe(true);
    });

    it("calls onOpenChange when Escape is pressed", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <Popover trigger={<button>Menu</button>} open={true} onOpenChange={onOpenChange}>
          <div>Panel content</div>
        </Popover>,
      );

      await user.keyboard("{Escape}");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("calls onOpenChange when clicking outside", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <div>
          <button>Outside</button>
          <Popover trigger={<button>Menu</button>} open={true} onOpenChange={onOpenChange}>
            <div>Panel content</div>
          </Popover>
        </div>,
      );

      await user.click(screen.getByRole("button", { name: "Outside" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("placement", () => {
    it("applies bottom-start placement class", () => {
      render(
        <Popover trigger={<button>Menu</button>} placement="bottom-start">
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByText("Panel content").parentElement;
      expect(panel?.className).toContain("bottom_start");
    });

    it("applies bottom-end placement class", () => {
      render(
        <Popover trigger={<button>Menu</button>} placement="bottom-end">
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByText("Panel content").parentElement;
      expect(panel?.className).toContain("bottom_end");
    });

    it("applies top-start placement class", () => {
      render(
        <Popover trigger={<button>Menu</button>} placement="top-start">
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByText("Panel content").parentElement;
      expect(panel?.className).toContain("top_start");
    });

    it("applies top-end placement class", () => {
      render(
        <Popover trigger={<button>Menu</button>} placement="top-end">
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByText("Panel content").parentElement;
      expect(panel?.className).toContain("top_end");
    });

    it("defaults to bottom-start when no placement is provided", () => {
      render(
        <Popover trigger={<button>Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByText("Panel content").parentElement;
      expect(panel?.className).toContain("bottom_start");
    });
  });

  describe("trigger wrapper", () => {
    it("sets aria-haspopup on trigger slot", () => {
      render(
        <Popover trigger={<button>Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const triggerSlot = screen.getByRole("button", { name: "Menu" }).parentElement;
      expect(triggerSlot).toHaveAttribute("aria-haspopup", "dialog");
    });

    it("updates aria-expanded when panel opens/closes", async () => {
      const user = userEvent.setup();
      render(
        <Popover trigger={<button>Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const triggerSlot = screen.getByRole("button", { name: "Menu" }).parentElement;

      expect(triggerSlot).toHaveAttribute("aria-expanded", "false");

      await user.click(screen.getByRole("button", { name: "Menu" }));
      expect(triggerSlot).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("panel accessibility", () => {
    it("has role='dialog'", () => {
      render(
        <Popover trigger={<button>Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByRole("dialog", { hidden: true });
      expect(panel).toHaveAttribute("role", "dialog");
    });

    it("has aria-modal='false'", () => {
      render(
        <Popover trigger={<button>Menu</button>}>
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByRole("dialog", { hidden: true });
      expect(panel).toHaveAttribute("aria-modal", "false");
    });
  });

  describe("custom className", () => {
    it("applies custom className to panel", () => {
      render(
        <Popover trigger={<button>Menu</button>} className="custom-panel">
          <div>Panel content</div>
        </Popover>,
      );
      const panel = screen.getByText("Panel content").parentElement;
      expect(panel?.className).toContain("custom-panel");
    });
  });
});
