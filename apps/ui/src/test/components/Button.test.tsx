import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("renders children inside a button element", () => {
    render(<Button>Create quest</Button>);
    const btn = screen.getByRole("button", { name: "Create quest" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("defaults to type='submit'-safe behavior by not forcing a type (caller decides)", () => {
    // The primitive intentionally does not override `type`; forms work as-is.
    render(<Button>Default</Button>);
    const btn = screen.getByRole("button");
    // React does not set a default type — HTML default ("submit") applies.
    expect(btn).not.toHaveAttribute("type");
  });

  it("fires onClick when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ship</Button>);
    await user.click(screen.getByRole("button", { name: "Ship" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Ship
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Ship" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("sets aria-busy and disables the button while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving...
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
  });

  it("does not fire onClick while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving...
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards refs to the underlying button element", () => {
    let ref: HTMLButtonElement | null = null;
    render(
      <Button
        ref={(el) => {
          ref = el;
        }}
      >
        Ref test
      </Button>,
    );
    expect(ref).not.toBeNull();
    expect(ref!.tagName).toBe("BUTTON");
  });

  it("passes through arbitrary HTML attributes (data-*, aria-*)", () => {
    render(
      <Button data-testid="cta" aria-describedby="hint-1">
        Learn more
      </Button>,
    );
    const btn = screen.getByTestId("cta");
    expect(btn).toHaveAttribute("aria-describedby", "hint-1");
  });

  it("renders leadingIcon before the label and marks it decorative", () => {
    render(<Button leadingIcon={<span data-testid="lead">+</span>}>New idea</Button>);
    const lead = screen.getByTestId("lead");
    // Wrapper span owns the decorative role; the icon itself is just a child.
    expect(lead.parentElement).toHaveAttribute("aria-hidden", "true");
    // DOM order: leading icon precedes the label text.
    const btn = screen.getByRole("button", { name: "New idea" });
    const labelNode = Array.from(btn.querySelectorAll("span")).find(
      (s) => s.textContent === "New idea",
    );
    expect(labelNode).toBeTruthy();
    expect(lead.parentElement!.compareDocumentPosition(labelNode!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("hides leadingIcon while loading (spinner takes the slot)", () => {
    render(
      <Button loading leadingIcon={<span data-testid="lead">+</span>}>
        Saving
      </Button>,
    );
    expect(screen.queryByTestId("lead")).toBeNull();
  });
});
