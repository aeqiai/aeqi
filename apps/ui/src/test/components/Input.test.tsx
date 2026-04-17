import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Input } from "@/components/ui/Input";

describe("Input", () => {
  it("renders a textbox", () => {
    render(<Input placeholder="Enter value" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("associates a label with the input via htmlFor/id", () => {
    render(<Input label="Agent name" />);
    const input = screen.getByLabelText("Agent name");
    expect(input.tagName).toBe("INPUT");
    // Clicking the label focuses the input (verifies the for/id wiring).
    expect(input.id).toBeTruthy();
  });

  it("uses a provided id instead of generating one", () => {
    render(<Input id="agent-name" label="Agent name" />);
    expect(screen.getByLabelText("Agent name")).toHaveAttribute("id", "agent-name");
  });

  it("renders hint text when provided and no error", () => {
    render(<Input label="Slug" hint="Lowercase letters only" />);
    expect(screen.getByText("Lowercase letters only")).toBeInTheDocument();
  });

  it("prefers error over hint when both are provided", () => {
    render(<Input label="Slug" hint="Lowercase letters only" error="Slug is required" />);
    expect(screen.queryByText("Lowercase letters only")).not.toBeInTheDocument();
    expect(screen.getByText("Slug is required")).toBeInTheDocument();
  });

  it("sets aria-invalid and role=alert when error is present", () => {
    render(<Input label="Email" error="Invalid email" />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid email");
  });

  it("connects aria-describedby to hint text", () => {
    render(<Input label="Slug" hint="Lowercase only" />);
    const input = screen.getByRole("textbox");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Lowercase only");
  });

  it("fires onChange when user types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input label="Slug" onChange={onChange} />);
    await user.type(screen.getByLabelText("Slug"), "hi");
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards refs to the underlying input element", () => {
    let ref: HTMLInputElement | null = null;
    render(
      <Input
        label="Ref test"
        ref={(el) => {
          ref = el;
        }}
      />,
    );
    expect(ref).not.toBeNull();
    expect(ref!.tagName).toBe("INPUT");
  });
});
