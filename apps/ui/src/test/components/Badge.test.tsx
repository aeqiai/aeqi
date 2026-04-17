import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, StatusBadge } from "@/components/ui/Badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>v1.2.3</Badge>);
    expect(screen.getByText("v1.2.3")).toBeInTheDocument();
  });

  it("renders a dot when dot prop is set", () => {
    const { container } = render(<Badge dot>active</Badge>);
    // Dot is a span marked aria-hidden.
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });

  it("does not render a dot by default", () => {
    const { container } = render(<Badge>v1.2.3</Badge>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("forwards className", () => {
    render(
      <Badge className="custom-cls" data-testid="b">
        x
      </Badge>,
    );
    // Type escape: Badge spread passes through className only (no data-*), so
    // assert via text parent instead.
    const el = screen.getByText("x");
    expect(el.className).toContain("custom-cls");
  });
});

describe("StatusBadge", () => {
  it("renders the humanized label for known statuses", () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("renders the raw status when unknown", () => {
    render(<StatusBadge status="weird_custom_state" />);
    expect(screen.getByText("weird_custom_state")).toBeInTheDocument();
  });

  it("always includes a dot (uses Badge with dot=true)", () => {
    const { container } = render(<StatusBadge status="active" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("maps 'done' to the success variant label 'Done'", () => {
    render(<StatusBadge status="done" />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("maps 'blocked' to 'Blocked'", () => {
    render(<StatusBadge status="blocked" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });
});
