import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "@/components/ui/Spinner";

describe("Spinner", () => {
  it("exposes role=status for screen readers", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has an aria-label so assistive tech can name it", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("renders at every size variant without crashing", () => {
    const { rerender } = render(<Spinner size="sm" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<Spinner size="md" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<Spinner size="lg" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
