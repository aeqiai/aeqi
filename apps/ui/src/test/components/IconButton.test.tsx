import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { IconButton } from "@/components/ui/IconButton";

function Glyph() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M4 4l8 8" />
    </svg>
  );
}

describe("IconButton", () => {
  it("renders children inside a button element", () => {
    render(
      <IconButton aria-label="Close">
        <Glyph />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("defaults to type='button' (prevents accidental form submit)", () => {
    render(
      <IconButton aria-label="Close">
        <Glyph />
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("requires aria-label to be exposed as the accessible name", () => {
    render(
      <IconButton aria-label="Delete quest">
        <Glyph />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Delete quest" })).toBeInTheDocument();
  });

  it("fires onClick when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Delete" onClick={onClick}>
        <Glyph />
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Delete" onClick={onClick} disabled>
        <Glyph />
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("respects an explicit type override", () => {
    render(
      <IconButton aria-label="Submit" type="submit">
        <Glyph />
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("forwards refs to the underlying button element", () => {
    let ref: HTMLButtonElement | null = null;
    render(
      <IconButton
        aria-label="Ref test"
        ref={(el) => {
          ref = el;
        }}
      >
        <Glyph />
      </IconButton>,
    );
    expect(ref).not.toBeNull();
    expect(ref!.tagName).toBe("BUTTON");
  });
});
